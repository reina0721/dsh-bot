// DSH Session 运行时：把 QQ 会话接到 DSH Agent。
//
// 结构：
//   - 每个 (chatType, chatId) 对应一个 DSH Session；preset 由访问档位决定；
//   - compose() 把认知侧准备好的 system 上下文挂到 agent 的 systemPrompt.context，
//     以 user 消息驱动 agent.followup()，等 turn/end 取最终 assistant 文本；
//   - 没有 sessionController/workspaceRegistry/agents 或 engine=oneshot 时 active=false，
//     调用方回退到现有一次性 LLM 路径。
//
// 边界：
//   - 只做「回复生成」；工具结果由 DSH 自己记录，认知侧不重复执行工具；
//   - 每个 Session 串行执行 compose，避免同一会话并发 turn 互相抢 pending；
//   - 超时/撤销先关闭工具接纳、取消作业，再退休 Session；迟到事件不再结算。

import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { readJson, writeJson } from '../core/store.js'
import { isOwner } from '../core/access.js'
import { createQqTools } from './qq-tools.js'
import { createSandboxTools, sandboxAdmission, sandboxContext } from './sandbox-tools.js'
import { digest, normalizeSandbox, policyGeneration } from '../sandbox/policy.js'

export const PRIVATE_PRESET = 'dsh-bot-private'
export const SOCIAL_PRESET = 'dsh-bot-social'
// Separate presets must contain no generic fs/web/exec plugins. See ADR-022 preset gap.
export const SANDBOX_PRIVATE_PRESET = 'dsh-bot-sandbox-private'
export const SANDBOX_SOCIAL_PRESET = 'dsh-bot-sandbox-social'
const SESSION_FILE = 'sessions.json'
const MAX_CONTEXT_CHARS = 12000

function safeGet(ctx, name) {
  try {
    if (ctx && typeof ctx.get === 'function') return ctx.get(name)
  } catch (error) {}
  try {
    return ctx?.[name]
  } catch (error) {
    return undefined
  }
}

function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim()
}

function hasToolCall(content) {
  return Array.isArray(content) && content.some((block) => block && block.type === 'tool-call')
}

function clampText(text, max = MAX_CONTEXT_CHARS) {
  const value = String(text || '')
  return value.length > max ? value.slice(0, max) : value
}

/**
 * @param {object} o
 * @param {object} o.ctx DSH 插件上下文（可含 sessionController/workspaceRegistry/agents/systemPrompt）
 * @param {() => object} o.getConfig 完整插件配置
 * @param {object} [o.access] createAccess() 产物（用于判断主人）
 * @param {object} [o.logger]
 * @param {string} [o.dataRoot] 运行时数据目录（sessions.json/workspace）
 */
export function createAgentRuntime({ ctx, getConfig, access = null, gateway = null, outbound = null, delivery = null, logger = null, dataRoot, executionSandbox = null,
  getPersona = () => ({ id: 'self', generation: 0 }), environment = 'live' } = {}) {
  const log = logger?.child?.('runtime') || logger || { info() {}, warn() {}, debug() {} }
  const baseDir = dataRoot || join(process.cwd(), '.dsh-bot-runtime')
  const sessionFile = join(baseDir, SESSION_FILE)
  const cfg = () => {
    try {
      return (getConfig && getConfig()) || {}
    } catch (error) {
      return {}
    }
  }
  const runtimeCfg = () => cfg().runtime || {}

  const runtimeInstance = randomUUID()
  const state = {
    disposed: false,
    sandboxMode: false,
    bindings: new Map(),
    retired: new Set(),
    mapLoaded: false,
    chats: {},
    pending: new Map(), // sessionId → { text, resolve, timer, ... }
    locks: new Map(), // sessionId → Promise chain
    contexts: new Map(), // sessionId → system context text
    contextDisposers: new Map(), // sessionId → () => void
    toolDisposers: new Map(), // sessionId → (() => void)[]
    listenerOff: null,
    stats: {
      composes: 0,
      steers: 0,
      ok: 0,
      failed: 0,
      timeouts: 0,
      sessions: 0,
      lastError: '',
      lastAt: 0,
    },
  }

  function services() {
    return {
      sessionController: safeGet(ctx, 'sessionController'),
      workspaceRegistry: safeGet(ctx, 'workspaceRegistry'),
      agents: safeGet(ctx, 'agents'),
      systemPrompt: safeGet(ctx, 'systemPrompt'),
    }
  }

  function available() {
    const s = services()
    return Boolean(s.sessionController && s.workspaceRegistry && s.agents)
  }

  function engine() {
    const value = runtimeCfg().engine
    return value === 'agent' ? 'agent' : 'oneshot'
  }

  function active() {
    return !state.disposed && engine() === 'agent' && available()
  }

  function levelFor(turn = {}) {
    if (turn.chatType === 'private') {
      const owner = isOwner(cfg(), turn.senderId || turn.chatId)
      return owner ? 'full' : 'social'
    }
    return 'social'
  }

  function presetFor(level) {
    return level === 'full' ? PRIVATE_PRESET : SOCIAL_PRESET
  }

  function workspaceDir() {
    const configured = String(runtimeCfg().workspaceDir || '').trim()
    return configured || join(baseDir, 'workspace')
  }

  function loadMap() {
    if (state.mapLoaded) return state.chats
    state.mapLoaded = true
    const raw = readJson(sessionFile, null)
    const chats = raw && typeof raw === 'object' && raw.chats && typeof raw.chats === 'object' ? raw.chats : {}
    state.chats = {}
    for (const [key, entry] of Object.entries(chats)) {
      if (!entry || typeof entry !== 'object' || !entry.sessionId) continue
      state.chats[key] = {
        sessionId: String(entry.sessionId),
        preset: String(entry.preset || ''),
        level: String(entry.level || ''),
        createdAt: Number(entry.createdAt) || Date.now(),
        updatedAt: Number(entry.updatedAt) || Date.now(),
      }
    }
    state.stats.sessions = Object.keys(state.chats).length
    return state.chats
  }

  function saveMap() {
    try {
      writeJson(sessionFile, { version: 1, chats: state.chats })
    } catch (error) {
      log.warn?.('保存会话映射失败：', error.message)
    }
  }

  async function ensureWorkspace() {
    const registry = services().workspaceRegistry
    if (!registry) throw new Error('WORKSPACE_REGISTRY_UNAVAILABLE')
    const dir = workspaceDir()
    mkdirSync(dir, { recursive: true })
    const norm = (value) => String(value || '').replace(/[\\/]+$/, '').toLowerCase()
    let list = []
    try {
      list = typeof registry.list === 'function' ? registry.list() : []
    } catch (error) {
      list = []
    }
    const found = Array.isArray(list) ? list.find((item) => norm(item?.path) === norm(dir)) : null
    if (found) return found
    if (typeof registry.create !== 'function') throw new Error('WORKSPACE_CREATE_UNAVAILABLE')
    return registry.create(dir, 'dsh-bot')
  }

  async function createSession(turn, preset, level) {
    const controller = services().sessionController
    if (!controller) throw new Error('SESSION_CONTROLLER_UNAVAILABLE')
    const workspace = await ensureWorkspace()
    const created = await controller.create({ workspaceId: workspace.id, agentPreset: preset })
    const sessionId = String(created?.sessionId || '')
    if (!sessionId) throw new Error('SESSION_CREATE_EMPTY')
    try {
      if (typeof controller.rename === 'function') {
        const title = turn.chatType === 'group'
          ? `QQ 群 · ${turn.chatId}`
          : `QQ 私聊 · ${turn.senderId || turn.chatId}`
        await controller.rename({ sessionId, title })
      }
    } catch (error) {
      log.debug?.('会话改名失败')
    }
    log.info?.(`已为 ${turn.chatType}:${turn.chatId} 新建 DSH 会话（${preset}/${level}）`)
    return sessionId
  }

  async function resolveAgent(sessionId) {
    const s = services()
    if (s.agents && typeof s.agents.get === 'function') {
      const live = s.agents.get(sessionId)
      if (live) return live
    }
    if (s.sessionController && typeof s.sessionController.resolveAgent === 'function') {
      const result = await s.sessionController.resolveAgent(sessionId)
      if (result?.agent) return result.agent
      if (result?.error) throw new Error(result.error.message || result.error.code || 'SESSION_RESOLVE_FAILED')
    }
    throw new Error('SESSION_RESOLVE_FAILED')
  }

  function bindingCurrent(binding) {
    if (state.disposed || !binding?.admitted || !active()) return false
    try {
      const persona = getPersona()
      return persona.id === binding.personaId && persona.generation === binding.personaGeneration
        && policyGeneration(cfg()) === binding.policyGeneration
    } catch { return false }
  }

  function retire(sessionId, error = 'SESSION_REVOKED') {
    const binding = state.bindings.get(sessionId)
    if (!binding || !binding.admitted) return
    // Revoke before invoking any asynchronous cancellation or host method.
    binding.admitted = false
    state.retired.add(sessionId)
    binding.abort.abort()
    const pending = state.pending.get(sessionId)
    if (pending) {
      clearTimeout(pending.timer)
      state.pending.delete(sessionId)
      pending.resolve({ ok: false, error, sessionId })
    }
    try { Promise.resolve(binding.agent?.abort?.()).catch(() => {}) } catch {}
    for (const off of state.toolDisposers.get(sessionId) || []) { try { off() } catch {} }
    state.toolDisposers.delete(sessionId)
    try { state.contextDisposers.get(sessionId)?.() } catch {}
    state.contextDisposers.delete(sessionId)
    state.contexts.delete(sessionId)
    state.bindings.delete(sessionId)
    for (const [key, entry] of Object.entries(state.chats)) {
      if (entry.sessionId === sessionId) delete state.chats[key]
    }
    state.stats.sessions = Object.keys(state.chats).length
    saveMap()
  }

  function assertBinding(binding) {
    if (!bindingCurrent(binding)) {
      retire(binding?.sessionId)
      throw Object.assign(new Error('SESSION_REVOKED'), { code: 'SESSION_REVOKED' })
    }
  }

  function sandboxOptions(binding) {
    return { broker: executionSandbox, binding, getConfig: cfg, getPersona,
      isAdmitted: () => bindingCurrent(binding), signal: binding.abort.signal,
      onRevoke: code => retire(binding.sessionId, code) }
  }

  async function sandboxReady(binding) {
    if (!normalizeSandbox(cfg().sandbox).enabled || !executionSandbox) return false
    try {
      // A ready broker is necessary for mounting; permissions are checked separately.
      const status = await executionSandbox.status(sandboxContext(binding))
      return status?.state === 'ready' && status.policyGeneration === binding.policyGeneration
    } catch { return false }
  }

  async function mount(agent, sessionId, info = {}, binding) {
    if (!agent) return
    const systemPrompt = agent?.ctx?.systemPrompt || services().systemPrompt
    if (!state.contextDisposers.has(sessionId) && systemPrompt && typeof systemPrompt.context === 'function') {
      try {
        const off = systemPrompt.context({
          name: `dsh-bot:cognition:${sessionId}`,
          order: 100,
          text: () => clampText(state.contexts.get(sessionId) || ''),
        })
        if (typeof off === 'function') state.contextDisposers.set(sessionId, off)
      } catch (error) {
        log.debug?.('挂载认知上下文失败：', error.message)
      }
    }
    if (state.toolDisposers.has(sessionId)) return
    const disposers = []
    state.toolDisposers.set(sessionId, disposers)
    let sandboxTools = []
    if (binding.sandboxReady) {
      try {
        const policy = await sandboxAdmission(sandboxOptions(binding))
        if (policy.capabilities.length) sandboxTools = createSandboxTools(sandboxOptions(binding))
      } catch { retire(sessionId); throw new Error('SESSION_REVOKED') }
    }
    assertBinding(binding)
    const qqTools = info.level === 'full'
      ? createQqTools({ chat: info, gateway, outbound, delivery, getConfig, logger: log }) : []
    const registry = agent?.ctx?.tools
    for (const tool of [...qqTools, ...sandboxTools]) {
      try {
        if (typeof registry?.register !== 'function') throw new Error('TOOLS_REGISTER_UNAVAILABLE')
        const execute = tool.execute
        const off = registry.register({ ...tool, async execute(...args) {
          assertBinding(binding)
          return execute(...args)
        } })
        if (typeof off === 'function') disposers.push(off)
      } catch {
        log.warn?.('注册 Agent 工具失败')
        if (sandboxTools.includes(tool)) { retire(sessionId); throw new Error('SESSION_REVOKED') }
      }
    }
  }

  function sessionFor(turn) {
    // Serialize session resolution only; steer must not wait for compose's turn/end.
    return withLock(`session:${turn.chatType}:${turn.chatId}`, () => resolveSessionFor(turn))
  }

  async function resolveSessionFor(turn) {
    const key = `${turn.chatType}:${turn.chatId}`
    const level = levelFor(turn)
    const persona = getPersona()
    const candidate = {
      environment, runtimeInstance, personaId: persona.id, personaGeneration: persona.generation,
      principalId: String(turn.senderId || turn.chatId), chatType: turn.chatType, chatId: String(turn.chatId),
      policyGeneration: policyGeneration(cfg()), scopeId: digest([environment, runtimeInstance, randomUUID()]),
      admitted: true, abort: new AbortController(),
    }
    state.sandboxMode ||= normalizeSandbox(cfg().sandbox).enabled
    candidate.sandboxReady = await sandboxReady(candidate)
    if (state.disposed) throw new Error('RUNTIME_DISPOSED')
    const preset = state.sandboxMode
      ? (level === 'full' ? SANDBOX_PRIVATE_PRESET : SANDBOX_SOCIAL_PRESET) : presetFor(level)
    candidate.preset = preset
    // Session identity includes every trusted dimension; a new session gets a new scopeId.
    candidate.identity = digest([environment, runtimeInstance, persona.id, persona.generation,
      candidate.principalId, turn.chatType, String(turn.chatId), preset, candidate.policyGeneration, candidate.sandboxReady])
    loadMap()
    const entry = state.chats[key]
    const old = state.bindings.get(entry?.sessionId)
    let sessionId = old && old.identity === candidate.identity && bindingCurrent(old) ? entry.sessionId : ''
    if (entry && !sessionId) retire(entry.sessionId)
    let agent = null
    if (sessionId) {
      try { agent = await resolveAgent(sessionId) } catch {
        retire(sessionId)
        sessionId = ''
      }
    }
    if (!sessionId) {
      sessionId = await createSession(turn, preset, level)
      if (state.retired.has(sessionId)) throw new Error('SESSION_REVOKED')
      candidate.sessionId = sessionId
      state.bindings.set(sessionId, candidate)
      try {
        assertBinding(candidate)
        agent = await resolveAgent(sessionId)
        candidate.agent = agent
        assertBinding(candidate)
      } catch { retire(sessionId); throw new Error('SESSION_REVOKED') }
      state.chats[key] = { sessionId, preset, level, createdAt: Date.now(), updatedAt: Date.now() }
      state.stats.sessions = Object.keys(state.chats).length
    } else {
      state.chats[key].updatedAt = Date.now()
    }
    saveMap()
    const binding = state.bindings.get(sessionId)
    await mount(agent, sessionId, { level, chatType: turn.chatType, chatId: turn.chatId, senderId: turn.senderId }, binding)
    assertBinding(binding)
    return { agent, sessionId, preset, level, key }
  }

  async function withLock(sessionId, work) {
    const previous = state.locks.get(sessionId) || Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const chained = previous.then(() => gate)
    state.locks.set(sessionId, chained)
    await previous.catch(() => {})
    try {
      return await work()
    } finally {
      release()
      if (state.locks.get(sessionId) === chained) state.locks.delete(sessionId)
    }
  }

  function promptAgent(agent, sessionId, message) {
    return new Promise((resolve) => {
      const timeoutMs = Math.max(1000, Number(runtimeCfg().replyTimeoutMs) || 120000)
      const pending = { text: '', sawTool: false, started: false, resolve, timer: null }
      state.pending.set(sessionId, pending)
      pending.timer = setTimeout(() => {
        if (state.pending.get(sessionId) !== pending) return
        state.stats.timeouts += 1
        state.stats.failed += 1
        state.stats.lastError = 'TIMEOUT'
        state.stats.lastAt = Date.now()
        retire(sessionId, 'TIMEOUT')
      }, timeoutMs)
      try {
        assertBinding(state.bindings.get(sessionId))
        Promise.resolve(agent.followup(message)).catch(() => retire(sessionId, 'PROMPT_FAILED'))
      } catch (error) {
        clearTimeout(pending.timer)
        state.pending.delete(sessionId)
        state.stats.failed += 1
        state.stats.lastError = 'PROMPT_FAILED'
        state.stats.lastAt = Date.now()
        retire(sessionId, 'PROMPT_FAILED')
        resolve({ ok: false, error: 'PROMPT_FAILED', sessionId })
      }
    })
  }

  function onSessionEvent(session, event) {
    const sessionId = String(session?.id || '')
    const pending = state.pending.get(sessionId)
    if (!pending || !event || pending.ending) return
    const binding = state.bindings.get(sessionId)
    if (!bindingCurrent(binding)) { retire(sessionId); return }
    if (event.type === 'turn/start') {
      pending.started = true
      return
    }
    if (event.type === 'assistant/message') {
      const content = event.message?.content || []
      const text = textOfContent(content)
      if (hasToolCall(content)) pending.sawTool = true
      else if (text) pending.text = text
      return
    }
    if (event.type === 'turn/end') {
      pending.ending = true
      const finish = () => {
        if (state.pending.get(sessionId) !== pending) return
        if (!bindingCurrent(binding)) { retire(sessionId); return }
        clearTimeout(pending.timer)
        state.pending.delete(sessionId)
        state.stats.lastAt = Date.now()
        if (pending.text) {
          state.stats.ok += 1
          state.stats.lastError = ''
          pending.resolve({ ok: true, text: pending.text, sessionId })
        } else {
          state.stats.failed += 1
          state.stats.lastError = 'EMPTY_REPLY'
          pending.resolve({ ok: false, error: 'EMPTY_REPLY', sessionId, sawTool: pending.sawTool })
        }
      }
      if (binding.sandboxReady) {
        // Do not deliver a result after readiness was lost between monitor ticks.
        sandboxReady(binding).then(ready => ready ? finish() : retire(sessionId)).catch(() => retire(sessionId))
      } else finish()
    }
  }

  function attach() {
    if (state.listenerOff) return
    if (!ctx || typeof ctx.on !== 'function') return
    const off = ctx.on('session/event', onSessionEvent)
    state.listenerOff = typeof off === 'function' ? off : () => {}
  }

  /**
   * 用 DSH Agent 生成一条回复。
   * @param {{turn:object, system?:string, user:string, maxTokens?:number}} o
   * @returns {Promise<{ok:boolean,text?:string,sessionId?:string,error?:string,message?:string}>}
   */
  async function compose({ turn, system = '', user = '', maxTokens = null } = {}) {
    if (!active()) return { ok: false, error: 'RUNTIME_INACTIVE' }
    if (!turn || !turn.chatType || !turn.chatId) return { ok: false, error: 'INVALID_TURN' }
    if (!String(user || '').trim()) return { ok: false, error: 'EMPTY_PROMPT' }
    state.stats.composes += 1
    attach()
    const lockKey = `${turn.chatType}:${turn.chatId}`
    try {
      return await withLock(lockKey, async () => {
        const { agent, sessionId } = await sessionFor(turn)
        assertBinding(state.bindings.get(sessionId))
        const hasContext = state.contextDisposers.has(sessionId)
        state.contexts.set(sessionId, clampText(system))
        const promptText = hasContext
          ? String(user)
          : [
              system ? `【本轮上下文】\n${clampText(system)}\n` : '',
              `【对方消息】\n${String(user)}`,
            ].filter(Boolean).join('\n')
        const message = {
          id: randomUUID(),
          role: 'user',
          content: [{ type: 'text', text: promptText }],
          source: { kind: 'user' },
        }
        return await promptAgent(agent, sessionId, message)
      })
    } catch (error) {
      state.stats.failed += 1
      state.stats.lastError = 'RUNTIME_FAILED'
      state.stats.lastAt = Date.now()
      log.warn?.('Agent 生成失败')
      return { ok: false, error: 'RUNTIME_FAILED' }
    }
  }

  /** Explicit owner command entry; normal turns continue to use compose/followup. */
  async function steer(turn, text) {
    if (!active()) return { ok: false, error: 'RUNTIME_INACTIVE' }
    if (!['private', 'group'].includes(turn?.chatType)
      || !/^[1-9]\d*$/.test(String(turn?.chatId || ''))
      || !Number.isSafeInteger(Number(turn.chatId))) return { ok: false, error: 'INVALID_TURN' }
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 1000) {
      return { ok: false, error: 'INVALID_TEXT' }
    }
    try {
      const { agent, sessionId } = await sessionFor(turn)
      assertBinding(state.bindings.get(sessionId))
      if (typeof agent.steer !== 'function') return { ok: false, error: 'STEER_UNAVAILABLE' }
      await agent.steer({ content: [{ type: 'text', text }], source: { kind: 'user' } })
      assertBinding(state.bindings.get(sessionId))
      state.stats.steers += 1
      state.stats.lastAt = Date.now()
      return { ok: true, sessionId }
    } catch {
      state.stats.lastError = 'STEER_FAILED'
      state.stats.lastAt = Date.now()
      return { ok: false, error: 'STEER_FAILED' }
    }
  }

  function summary() {
    const s = services()
    return {
      engine: engine(),
      available: available(),
      active: active(),
      has: {
        sessionController: Boolean(s.sessionController),
        workspaceRegistry: Boolean(s.workspaceRegistry),
        agents: Boolean(s.agents),
        systemPrompt: Boolean(s.systemPrompt),
      },
      workspaceDir: workspaceDir(),
      sessions: state.stats.sessions,
      stats: { ...state.stats },
    }
  }

  function sessions() {
    loadMap()
    return Object.entries(state.chats).map(([key, entry]) => ({
      key,
      sessionId: entry.sessionId,
      preset: entry.preset,
      level: entry.level,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }))
  }

  function dispose() {
    if (state.disposed) return
    state.disposed = true
    clearInterval(monitor)
    for (const id of [...state.bindings.keys()]) retire(id, 'RUNTIME_DISPOSED')
    try {
      if (typeof state.listenerOff === 'function') state.listenerOff()
    } catch (error) {}
    state.listenerOff = null
    for (const pending of state.pending.values()) {
      try { clearTimeout(pending.timer) } catch (error) {}
      try { pending.resolve({ ok: false, error: 'RUNTIME_DISPOSED' }) } catch (error) {}
    }
    state.pending.clear()
    for (const off of state.contextDisposers.values()) {
      try { if (typeof off === 'function') off() } catch (error) {}
    }
    state.contextDisposers.clear()
    for (const disposers of state.toolDisposers.values()) {
      for (const off of disposers) {
        try { if (typeof off === 'function') off() } catch (error) {}
      }
    }
    state.toolDisposers.clear()
    state.contexts.clear()
    state.locks.clear()
  }

  const monitor = setInterval(() => {
    for (const [id, binding] of state.bindings) {
      if (!bindingCurrent(binding)) { retire(id); continue }
      if (binding.sandboxReady && !binding.checking) {
        binding.checking = true
        sandboxReady(binding).then(ready => { if (!ready) retire(id) })
          .catch(() => retire(id)).finally(() => { binding.checking = false })
      }
    }
  }, 100)
  monitor.unref()

  // 监听可以早挂：没有服务时 compose 不会走到这里，但事件先收到也无害。
  attach()

  return {
    available,
    active,
    engine,
    levelFor,
    presetFor,
    compose,
    steer,
    summary,
    sessions,
    dispose,
  }
}
