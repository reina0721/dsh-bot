import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { defaultConfig } from '../core/config.js'
import { writeJson } from '../core/store.js'
import { createStore } from '../cognition/store.js'
import { builtinRegistry } from '../modules/registry.js'
import { assembleServices } from '../services/assembly.js'
import { createCapturingTransport, createFixtureModel, createFixtureRuntime, createFixtureSources, createVirtualScheduler } from './adapters.js'

const copy = value => structuredClone(value)
const BOT = '910001'
const MEMBER = '910002'
const GROUP = '910003'
const log = { info() {}, debug() {}, warn() {}, error() {}, child() { return this } }
const SIMULATION_MODULES = new Set(['builtin-typing', 'builtin-reply-delivery', 'builtin-reminders', 'builtin-sample'])
const invalid = () => { throw new Error('INVALID_SIMULATION_INPUT') }
function fields(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) invalid()
}
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid()
}
function optionsOf(input) {
  fields(input, ['persona', 'model', 'knowledge', 'access', 'typing', 'reminders'])
  if (input.persona !== undefined) {
    fields(input.persona, ['displayName', 'identity', 'background', 'speakingStyle'])
    for (const value of Object.values(input.persona)) text(value, 1500)
  }
  if (input.model !== undefined) {
    fields(input.model, ['reply', 'analysis'])
    if (input.model.reply !== undefined) text(input.model.reply, 4000, true)
    if (input.model.analysis !== undefined) {
      fields(input.model.analysis, ['intent', 'confidence', 'risk', 'replyGoal'])
      for (const [key, value] of Object.entries(input.model.analysis)) {
        if (['confidence', 'risk'].includes(key)) {
          if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid()
        } else text(value, 200)
      }
    }
  }
  if (input.access !== undefined) {
    fields(input.access, ['private', 'group'])
    if (Object.values(input.access).some(value => typeof value !== 'boolean')) invalid()
  }
  for (const key of ['typing', 'reminders']) if (input[key] !== undefined && typeof input[key] !== 'boolean') invalid()
  if (input.knowledge !== undefined) {
    if (!Array.isArray(input.knowledge) || input.knowledge.length > 20) invalid()
    for (const page of input.knowledge) {
      fields(page, ['url', 'title', 'text'])
      text(page.url, 200, true); text(page.title, 200); text(page.text, 8000)
      if (!page.url.startsWith('fixture:')) invalid()
    }
  }
  return copy(input)
}

function eventOf(input, clock, serial) {
  fields(input, ['requestId', 'kind', 'chatType', 'text', 'addressed', 'type'])
  text(input.requestId, 100, true)
  if (!/^[a-zA-Z0-9_-]+$/.test(input.requestId)) invalid()
  if (!['private', 'group'].includes(input.chatType) || !['message', 'notice', 'request'].includes(input.kind)) invalid()
  const base = { self_id: BOT, time: Math.floor(clock.now() / 1000), post_type: input.kind,
    user_id: MEMBER, ...(input.chatType === 'group' ? { group_id: GROUP } : {}) }
  if (input.kind === 'message') {
    if (input.type !== undefined) invalid()
    text(input.text, 4000, true)
    if (input.addressed !== undefined && typeof input.addressed !== 'boolean') invalid()
    return { ...base, message_type: input.chatType, sub_type: input.chatType === 'group' ? 'normal' : 'friend',
      message_id: serial, sender: { user_id: MEMBER, nickname: '模拟参与者', role: 'member' },
      message: [...(input.addressed && input.chatType === 'group' ? [{ type: 'at', data: { qq: BOT } }] : []), { type: 'text', data: { text: input.text } }] }
  }
  if (input.addressed !== undefined || input.text !== undefined) invalid()
  if (input.kind === 'notice') {
    if (input.type !== (input.chatType === 'group' ? 'group_increase' : 'friend_add')) invalid()
    return { ...base, notice_type: input.type, sub_type: 'approve', operator_id: MEMBER }
  }
  if (input.type !== (input.chatType === 'group' ? 'group' : 'friend')) invalid()
  return { ...base, request_type: input.type, sub_type: 'add', flag: `fixture-request-${serial}`, comment: '离线模拟请求' }
}

async function createGraph(root, namespace, options) {
  const scheduler = createVirtualScheduler()
  const clock = { now: scheduler.now }
  const eventBus = new EventEmitter()
  const transport = createCapturingTransport({ clock, namespace })
  const models = createFixtureModel(options.model)
  const runtime = createFixtureRuntime({ namespace, models })
  const config = defaultConfig()
  config.enabled = false
  config.botQQ = BOT
  config.access = { ...config.access, mode: 'allowlist', ownerQQ: options.access?.private === false ? '' : MEMBER,
    operators: [], private: [], groups: options.access?.group === false ? [] : [GROUP] }
  config.cognition.enabled = true
  config.cognition.dryRun = false
  config.cognition.persona.profile = copy(options.persona || { displayName: '模拟人格' })
  config.cognition.llm.mode = 'direct'
  config.cognition.llm.fallbackToDsh = false
  config.cognition.typing.enabled = options.typing === true
  config.cognition.reminders.enabled = options.reminders === true
  config.cognition.memory.embedding.enabled = false
  config.events.persist.enabled = true
  const store = createStore({ file: join(root, 'cognition', 'cognition.sqlite'), clock, log })
  let snapshot = copy(config)
  let graph
  try {
    graph = assembleServices({
      dataRoot: root, store, clock, scheduler, eventBus,
      getConfig: () => snapshot,
      setConfig: next => {
        snapshot = copy(next)
        writeJson(join(root, 'config.json'), snapshot)
        return { config: snapshot, issues: [] }
      },
      actionTransport: transport, modelAdapter: models, runtimeAdapter: runtime,
      sourceRegistry: createFixtureSources(options.knowledge),
      embeddingAdapter: { enabled: () => false, status: () => ({ enabled: false }), embed: async () => { throw new Error('SIMULATION_EMBEDDINGS_DISABLED') } },
      deliverySleep: ms => scheduler.sleep(ms), logger: log,
      registry: builtinRegistry.filter(entry => SIMULATION_MODULES.has(entry.manifest.id)), discoverExternal: false,
    })
    await graph.modulesReady
    if (!(await graph.cognition.ready)) throw new Error('SIMULATION_GRAPH_UNAVAILABLE')
    // Assign a dedicated persona ID even though the physical store is already private.
    const persona = graph.cognition.createPersona({ profile: config.cognition.persona.profile })
    if (!persona.ok) throw new Error('SIMULATION_PERSONA_UNAVAILABLE')
    const reminderProvider = graph.providerRegistry.get('reminders')
    if (reminderProvider) await reminderProvider.start()
    else graph.cognition.startReminders()
    writeJson(join(root, 'config.json'), graph.getConfig())
  } catch (error) {
    transport.close(); scheduler.dispose()
    if (graph) { await graph.modules.dispose(); graph.cognition.dispose() }
    else store.close()
    throw error
  }
  const receipts = new Map()
  const transcript = []
  let serial = 0
  let closed = false
  return {
    async submit(input) {
      const raw = eventOf(input, clock, serial + 1)
      const previous = receipts.get(input.requestId)
      if (previous) {
        if (JSON.stringify(Object.entries(previous.input).sort()) !== JSON.stringify(Object.entries(input).sort())) throw new Error('SIMULATION_REQUEST_CONFLICT')
        return copy(previous.receipt)
      }
      serial++
      const receipt = { environment: 'simulation', requestId: input.requestId, at: clock.now(), ...graph.ingress.handleRaw(raw) }
      receipts.set(input.requestId, { input: copy(input), receipt })
      transcript.push({ environment: 'simulation', direction: 'in', ...copy(input), at: clock.now() })
      await scheduler.advance(0)
      writeJson(join(root, 'config.json'), graph.getConfig())
      return copy(receipt)
    },
    advance: ms => scheduler.advance(ms),
    read() {
      const scoped = graph.cognition.services.personaStore
      const captures = transport.captures()
      const outgoing = captures.filter(row => row.status === 'captured' && ['send_private_msg', 'send_group_msg'].includes(row.action)).map(row => ({
        environment: 'simulation', direction: 'out', at: row.at, captureId: row.id,
        chatType: row.action === 'send_group_msg' ? 'group' : 'private',
        text: row.params.message.filter(segment => segment.type === 'text').map(segment => segment.data.text).join(''),
        segments: row.params.message, captured: true, realSend: false,
      }))
      return copy({ environment: 'simulation', now: clock.now(),
        transcript: [...transcript, ...outgoing].sort((a, b) => a.at - b.at), captures,
        receipts: [...receipts.values()].map(item => item.receipt),
        deliveryReceipts: scoped.list('delivery_receipt', { limit: 200 }).map(row => ({ ...row, environment: 'simulation', realSend: false })),
        loops: scoped.list('loop_run', { limit: 200 }),
        persona: graph.cognition.personaState(), sessions: runtime.sessions(),
        configSnapshot: { model: 'fixture/offline', network: false, media: false, execution: false,
          typing: options.typing === true, reminders: options.reminders === true,
          access: copy(options.access || { private: true, group: true }) },
        notices: scoped.list('timeline_event', { limit: 200 }), requests: graph.cognition.services.notices.list(),
        stats: graph.cognition.snapshot().stats, counts: graph.cognition.snapshot().counts, access: graph.access.summary(),
      })
    },
    async dispose() {
      if (closed) return
      closed = true
      transport.close(); scheduler.dispose()
      await graph.cognition.whenIdle()
      await graph.modules.dispose()
      graph.cognition.dispose(); graph.events.dispose(); eventBus.removeAllListeners(); models.dispose()
    },
  }
}

// This manager never receives the live config, persona, gateway, context, or model registry.
export function createSimulationService({ dataRoot, maxSessions = 16 } = {}) {
  if (!dataRoot) throw new Error('Simulation service requires dataRoot')
  const sessions = new Map()
  let queue = Promise.resolve()
  let disposed = false
  let disposal = null
  const serialize = work => {
    const next = queue.then(() => { if (disposed) throw new Error('SIMULATION_DISPOSED'); return work() })
    queue = next.catch(() => {})
    return next
  }
  const find = id => {
    if (typeof id !== 'string' || !/^sim_[a-f0-9-]{36}$/.test(id) || !sessions.has(id)) throw new Error('SIMULATION_NOT_FOUND')
    return sessions.get(id)
  }
  return {
    create: (input = {}) => serialize(async () => {
      const options = optionsOf(input)
      if (sessions.size >= maxSessions) throw new Error('SIMULATION_SESSION_LIMIT')
      await mkdir(dataRoot, { recursive: true })
      const root = await mkdtemp(join(dataRoot, 'session-'))
      const id = `sim_${randomUUID()}`
      try {
        const graph = await createGraph(root, `${id}:1`, options)
        sessions.set(id, { graph, root, options, generation: 1 })
      } catch (error) { await rm(root, { recursive: true, force: true }); throw error }
      return { ok: true, environment: 'simulation', id, generation: 1 }
    }),
    submit: (id, input) => serialize(() => find(id).graph.submit(copy(input))),
    advance: (id, ms) => serialize(async () => ({ environment: 'simulation', ...await find(id).graph.advance(ms) })),
    read: id => serialize(() => ({ ok: true, id, generation: find(id).generation, ...find(id).graph.read() })),
    reset: id => serialize(async () => {
      const session = find(id)
      await session.graph.dispose()
      await rm(session.root, { recursive: true, force: true })
      sessions.delete(id)
      session.generation++
      try { session.graph = await createGraph(session.root, `${id}:${session.generation}`, session.options) }
      catch (error) { await rm(session.root, { recursive: true, force: true }); throw error }
      sessions.set(id, session)
      return { ok: true, environment: 'simulation', id, generation: session.generation }
    }),
    delete: id => serialize(async () => {
      const session = find(id)
      await session.graph.dispose()
      await rm(session.root, { recursive: true, force: true })
      sessions.delete(id)
      return { ok: true, environment: 'simulation', id }
    }),
    dispose() {
      if (disposal) return disposal
      disposed = true
      disposal = (async () => {
        await queue
        for (const session of sessions.values()) {
          await session.graph.dispose()
          await rm(session.root, { recursive: true, force: true })
        }
        sessions.clear()
      })()
      return disposal
    },
  }
}
