// 统一模块目录：包内静态注册表 + 操作员安装的本地 JavaScript。
// 模块是任意本地代码；这里的 permissions 约束稳定 API 的暴露面，不是进程沙箱。

import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { access, lstat, mkdir, readFile, readdir, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createModuleActions, moduleActionError } from './actions.js'
import { createModuleHealth, observeHealth, projectModuleHealth, validateHealthReport, increment, PROVIDER_NAMES, createProviderHealth } from './health.js'
import { ID_RE, validateManifest } from './manifest.js'
import { analyzeDependencies, dependentClosure } from './dependencies.js'
import { builtinRegistry } from './registry.js'
import { buildModuleUiCatalog, loadWebuiDescriptor, sandboxEligible } from './webui.js'
import { readUiArtifact } from './sandbox.js'
import { createModulePersonaStore } from './persona-store.js'
import { createReminderRepository } from './reminder-repository.js'
import { createLearningPort } from './learning-port.js'
import { createProactivityPort } from './proactivity-port.js'
import { createMediaFeaturesPort } from './media-features-port.js'
import { createLegacyConfig } from './legacy-config.js'
import { MAX_CONFIG_BYTES, validateConfigSchema, validateConfigValues } from './config.js'
const COMMAND_RE = /^[a-z][a-z0-9_-]{0,31}$/
const EVENT_NAMES = new Set(['message', 'notice', 'request', 'meta_event', 'any'])
const MAX_STORAGE_BYTES = 1024 * 1024
const MAX_SCHEDULER_DELAY_MS = 2_592_000_000
const MAX_MODULE_TIMERS = 64
const MAX_NATIVE_TIMEOUT_MS = 2_147_483_647

function messageOf(error) {
  return String(error?.message || error || '未知错误').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function clone(value) {
  if (value === undefined) return undefined
  return structuredClone(value)
}

function inside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel))
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { return clone(fallback) }
}

async function writeJsonAtomic(file, value) {
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, file)
  } finally { await unlink(temporary).catch(() => {}) }
}

function publicRecord(record) {
  return {
    id: record.id,
    name: record.name,
    version: record.version,
    description: record.description,
    source: record.source,
    builtin: record.builtin,
    apiVersion: record.apiVersion,
    requires: [...record.requires],
    canReload: !record.builtin,
    canToggle: record.builtin || (record.valid && record.manifestEnabled),
    hasConfig: Boolean(record.configSchema),
    configWarning: record.configWarning || '',
    permissions: [...record.permissions],
    enabled: Boolean(record.enabled),
    status: record.status,
    error: record.error,
    loadedAt: record.loadedAt,
    generation: record.generation,
    runtimeGeneration: record.runtime?.runtimeGeneration || null,
    uiRevision: record.uiRevision || 'none',
  }
}

/**
 * @param {object} options
 * @param {string} options.dataDir `<plugin data>/modules`
 */
export function createModuleKernel({ dataDir, getConfig, ctx = null, logger = null, cognition = null, outbound = null, delivery = null, commands = null, registry = builtinRegistry, deliveryRegistry = null, turnHooks = null, gateway = null, personaStore = null, providerRegistry = null, access: accessControl = null, media = null, stickers = null, reminderControl = null } = {}) {
  if (!dataDir) throw new Error('module kernel 需要 dataDir')
  const root = resolve(dataDir)
  const stateFile = join(root, 'state.json')
  const log = logger?.child?.('modules') || logger || { info() {}, warn() {}, debug() {}, error() {}, child() { return this } }
  const records = new Map()
  let disabled = new Set()
  let enabledIds = new Set()
  let uiGrants = new Map()
  let importGeneration = 0
  let started = false
  let disposed = false
  let disposing = false
  let operation = Promise.resolve()
  let healthRevision = 0
  const touchHealth = () => { healthRevision = increment(healthRevision) }

  const serialize = (work) => {
    const next = operation.then(work, work)
    operation = next.catch(() => {})
    return next
  }

  function safeMessage(error) {
    return messageOf(error)
      .replaceAll(root, '<modules>')
      .replaceAll(pathToFileURL(root).href, 'file://<modules>')
      .replace(/(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/)[^\s'"<>]+/g, '<path>')
  }

  async function requireModuleDirectory(id) {
    try {
      const info = await stat(join(root, id))
      if (!info.isDirectory()) throw new Error('不是目录')
    } catch (error) {
      throw new Error(`模块 ${id} 不存在`)
    }
  }

  async function loadState() {
    const state = await readJson(stateFile, {})
    const ids = (value) => new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string' && ID_RE.test(id)) : [])
    disabled = ids(state?.disabled)
    enabledIds = ids(state?.enabled)
    const savedGrants = state?.uiGrants && typeof state.uiGrants === 'object' && !Array.isArray(state.uiGrants) ? state.uiGrants : {}
    uiGrants = new Map(Object.entries(savedGrants)
      .filter(([id, grant]) => ID_RE.test(id) && grant?.id === id && /^[a-f0-9]{64}$/.test(grant.uiRevision) && /^[a-f0-9]{64}$/.test(grant.artifactHash) && typeof grant.entry === 'string')
      .map(([id, grant]) => [id, { id, uiRevision: grant.uiRevision, entry: grant.entry, artifactHash: grant.artifactHash }]))
  }

  function effectiveEnabled(record) {
    if (disabled.has(record.id)) return false
    return record.builtin ? (enabledIds.has(record.id) || record.defaultEnabled) : record.manifestEnabled
  }

  async function manifestFor(moduleDir, directoryName) {
    let raw
    try { raw = JSON.parse(await readFile(join(moduleDir, 'module.json'), 'utf8')) }
    catch (error) { throw new Error(`module.json 无法读取：${messageOf(error)}`) }
    const manifest = validateManifest(raw, { directoryName })
    const entry = manifest.entry
    if (!entry || isAbsolute(entry) || !['.js', '.mjs'].includes(extname(entry).toLowerCase())) throw new Error('manifest.entry 必须是模块目录内的相对 .js/.mjs 文件')
    const entryPath = resolve(moduleDir, entry)
    if (!inside(moduleDir, entryPath)) throw new Error('manifest.entry 不能离开模块目录')
    const realModuleDir = await realpath(moduleDir)
    const realRoot = await realpath(root)
    if (!inside(realRoot, realModuleDir)) throw new Error('模块目录不能通过符号链接离开 modules 目录')
    await access(entryPath, constants.R_OK)
    const realEntry = await realpath(entryPath)
    if (!inside(realModuleDir, realEntry)) throw new Error('manifest.entry 不能通过符号链接离开模块目录')
    const configSchema = raw.config === undefined ? null : validateConfigSchema(raw.config)
    const record = { ...manifest, configSchema, ...loadWebuiDescriptor(raw.webui, { source: 'external', configSchema }), source: 'external', builtin: false, valid: true, moduleDir: realModuleDir, entryPath: realEntry, uiArtifactHash: null }
    if (sandboxEligible(record)) {
      try { record.uiArtifactHash = (await readUiArtifact(root, record)).hash } catch {}
    }
    return record
  }

  function makeRecord(manifest) {
    return { ...manifest, health: createModuleHealth(), provides: manifest.builtin ? [...(manifest.provides || [])] : [], generation: randomUUID(), enabled: effectiveEnabled(manifest), status: 'disabled', error: '', loadedAt: null, runtime: null, storage: null }
  }

  function errorRecord(id, error, previous = null) {
    return {
      id, name: previous?.name || id, version: previous?.version || '', description: previous?.description || '',
      permissions: previous?.permissions || [], requires: [], apiVersion: previous?.apiVersion || 1,
      source: 'external', builtin: false, valid: false, manifestEnabled: false,
      enabled: false, status: 'error', error: safeMessage(error), loadedAt: null, runtime: null,
      health: createModuleHealth(), provides: [], generation: randomUUID(), ui: null, uiRevision: 'none', uiWarning: '',
    }
  }

  function actionError(message, code) {
    return Object.assign(new Error(message), { code })
  }

  // 写目录与文件都需要 realpath containment；包内源码路径从不作为写入目标。
  async function storagePath(record, filename = 'data.json') {
    const realRoot = await realpath(root)
    if (record.builtin) {
      const base = join(root, '.builtin')
      await mkdir(base, { recursive: true })
      const realBase = await realpath(base)
      if (!inside(realRoot, realBase)) throw new Error('内置存储不能通过符号链接离开 modules 目录')
      await mkdir(record.moduleDir, { recursive: true })
      if (!inside(realBase, await realpath(record.moduleDir))) throw new Error('内置存储目录符号链接逃逸')
    }
    const dir = await realpath(record.moduleDir)
    if (!inside(realRoot, dir)) throw new Error('模块存储目录符号链接逃逸')
    if (filename === 'config.json' && !record.builtin) {
      const installedDir = join(root, record.id)
      if ((await lstat(installedDir)).isSymbolicLink() || dir !== record.moduleDir || (await realpath(installedDir)) !== dir) throw new Error('模块配置目录不能是符号链接或被替换')
    }
    const file = join(dir, filename)
    try {
      if (filename === 'config.json' && !record.builtin && (await lstat(file)).isSymbolicLink()) throw new Error('模块配置文件不能是符号链接')
      if (!inside(dir, await realpath(file))) throw new Error('模块存储文件符号链接逃逸')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    return file
  }

  async function loadModuleConfig(record) {
    if (!record.configSchema) return
    record.configValues = validateConfigValues(record.configSchema, {})
    record.configRevision = 0
    record.configWarning = ''
    try {
      const file = await storagePath(record, 'config.json')
      if ((await stat(file)).size > MAX_CONFIG_BYTES) throw new Error('配置文件超过 64 KiB')
      const bytes = await readFile(file)
      if (bytes.length > MAX_CONFIG_BYTES) throw new Error('配置文件超过 64 KiB')
      const saved = JSON.parse(bytes.toString('utf8'))
      if (saved?.version !== record.configSchema.version || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new Error('配置版本或 revision 不合法')
      record.configValues = validateConfigValues(record.configSchema, saved.values)
      record.configRevision = saved.revision
    } catch (error) {
      record.configWarning = error.code === 'ENOENT' ? '配置文件缺失，使用默认值' : '配置文件不可用，使用默认值'
      log.warn?.(`模块 ${record.id}：${record.configWarning}`)
    }
  }

  async function disposeRuntime(record, strict = false) {
    const runtime = record?.runtime
    if (!runtime) return
    record.health.phase = 'draining'
    observeHealth(record.health, { state: record.health.health, reasonCode: 'STOP_PENDING' })
    touchHealth()
    // Close admission first; captured reminder repositories remain valid through drain.
    runtime.accepting = false
    for (const timer of runtime.timers.values()) globalThis.clearTimeout(timer.native)
    // Drain provider sends while repository leases are still valid, then revoke APIs.
    for (const stop of runtime.providerStops) {
      try { await stop() } catch {
        observeHealth(record.health, { state: 'degraded', reasonCode: 'PROVIDER_STOP_FAILED' })
        touchHealth()
        log.warn?.(`模块 ${record.id} provider 停止失败`)
        if (strict) { runtime.stopFailed = true; record.status = 'error'; throw moduleActionError('PROVIDER_STOP_FAILED') }
      }
    }
    runtime.active = false
    for (const timer of runtime.timers.values()) {
      globalThis.clearTimeout(timer.native)
      record.health.scheduler.cancelled = increment(record.health.scheduler.cancelled)
    }
    runtime.timers.clear()
    if (record.health.scheduler.active !== null) schedulerSnapshot(record, runtime)
    const disposers = [...runtime.disposers].reverse()
    runtime.disposers.length = 0
    let cleanupFailed = false
    for (const dispose of disposers) {
      try { await dispose() } catch (error) { cleanupFailed = true; if (strict) runtime.disposers.unshift(dispose); log.warn?.(`模块 ${record.id} 清理失败：${messageOf(error)}`) }
    }
    if (strict && cleanupFailed) { runtime.stopFailed = true; record.status = 'error'; throw moduleActionError('MODULE_CLEANUP_FAILED') }
    await record.drainStorage?.()
    record.storage = null
    record.drainStorage = null
    record.runtime = null
    record.health.phase = 'stopped'
    record.health.telemetry.lastStoppedAt = Date.now()
    observeHealth(record.health, { state: 'stopped', reasonCode: 'MODULE_STOPPED' })
    touchHealth()
  }

  function requirePermission(record, permission) {
    if (!record.permissions.includes(permission)) throw new Error(`模块 ${record.id} 缺少 permission: ${permission}`)
  }

  function storageApi(record) {
    const filePromise = storagePath(record)
    let valuesPromise = (async () => {
      const file = await filePromise
      try {
        const info = await stat(file)
        if (info.size > MAX_STORAGE_BYTES) throw new Error(`模块存储超过 ${MAX_STORAGE_BYTES} bytes`)
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
      }
      return readJson(file, {})
    })()
    valuesPromise.catch(() => {})
    let writes = Promise.resolve()
    record.drainStorage = () => writes
    const values = async () => {
      const current = await valuesPromise
      return current && typeof current === 'object' && !Array.isArray(current) ? current : {}
    }
    const mutate = (work) => {
      const next = writes.then(async () => {
        const current = await values()
        const draft = clone(current)
        const result = work(draft)
        const text = JSON.stringify(draft, null, 2)
        if (Buffer.byteLength(text) > MAX_STORAGE_BYTES) throw new Error(`模块存储超过 ${MAX_STORAGE_BYTES} bytes`)
        await writeJsonAtomic(await storagePath(record), draft)
        valuesPromise = Promise.resolve(draft)
        return result
      })
      writes = next.catch(() => {})
      return next
    }
    return {
      async get(key, fallback = undefined) {
        const current = await values()
        return Object.hasOwn(current, String(key)) ? clone(current[String(key)]) : clone(fallback)
      },
      set(key, value) {
        return mutate((draft) => { draft[String(key)] = clone(value); return clone(value) })
      },
      delete(key) {
        return mutate((draft) => delete draft[String(key)])
      },
      async all() { return clone(await values()) },
    }
  }

  function currentRuntime(record, runtime) {
    return runtime.active && record.runtime === runtime && records.get(record.id) === record
  }
  function report(record, runtime, value) {
    if (!currentRuntime(record, runtime)) return false
    observeHealth(record.health, value)
    touchHealth()
    return true
  }
  function invoke(record, runtime, code, fn) {
    if (!currentRuntime(record, runtime)) return undefined
    report(record, runtime, { state: record.health.health, result: 'started' })
    const done = (failed, value) => {
      report(record, runtime, { state: failed ? 'degraded' : 'healthy', result: failed ? 'failure' : 'success', reasonCode: failed ? code : null })
      if (failed) throw value
      return value
    }
    try {
      const result = fn()
      if (result && typeof result.then === 'function') return Promise.resolve(result).then(value => done(false, value), error => done(true, error))
      return done(false, result)
    } catch (error) { return done(true, error) }
  }
  function schedulerSnapshot(record, runtime) {
    const cache = record.health
    cache.scheduler.active = runtime.timers.size
    cache.scheduler.nextDueAt = runtime.timers.size ? Math.min(...[...runtime.timers.values()].map(timer => timer.dueAt)) : null
    cache.telemetry.timerScheduled = runtime.timers.size > 0
    cache.telemetry.nextRunAt = cache.scheduler.nextDueAt
    cache.observedAt = Date.now()
    touchHealth()
  }
  function schedulerApi(record, runtime) {
    const isCurrent = () => !disposed && !disposing && runtime.active && runtime.accepting && record.runtime === runtime && records.get(record.id) === record
    const warn = () => {
      // 不读取回调异常：其中可能包含聊天 ID、正文或其它秘密。
      try { log.warn?.(`模块 ${record.id} 调度回调失败`) } catch {}
    }
    function clearTimeout(id) {
      const timer = runtime.timers.get(id)
      if (!timer) return false
      globalThis.clearTimeout(timer.native)
      runtime.timers.delete(id)
      record.health.scheduler.cancelled = increment(record.health.scheduler.cancelled)
      schedulerSnapshot(record, runtime)
      return true
    }
    return Object.freeze({
      setTimeout(fn, delayMs) {
        requireActive(runtime)
        requirePermission(record, 'scheduler')
        if (!record.builtin || !isCurrent()) throw new Error('调度器仅允许当前运行的内置模块使用')
        if (typeof fn !== 'function') throw new Error('调度回调必须是函数')
        if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > MAX_SCHEDULER_DELAY_MS) throw new Error('调度延迟必须是 0–2592000000 ms 的整数')
        if (runtime.timers.size >= MAX_MODULE_TIMERS) throw new Error('模块最多允许 64 个活跃定时器')
        const id = randomUUID()
        const timer = { native: null, deadline: performance.now() + delayMs, dueAt: Date.now() + delayMs }
        const run = () => {
          // runtime 身份即本次 setup 的 generation；旧回调不能进入新生命周期。
          if (!isCurrent() || runtime.timers.get(id) !== timer) return
          const remaining = timer.deadline - performance.now()
          if (remaining > 0) { schedule(remaining); return }
          runtime.timers.delete(id)
          const counters = record.health.scheduler
          counters.fired = increment(counters.fired)
          counters.running = increment(counters.running)
          schedulerSnapshot(record, runtime)
          const finish = failed => {
            if (!currentRuntime(record, runtime)) return
            counters.running = Math.max(0, counters.running - 1)
            counters[failed ? 'failed' : 'completed'] = increment(counters[failed ? 'failed' : 'completed'])
            if (failed) report(record, runtime, { state: 'degraded', reasonCode: 'SCHEDULER_CALLBACK_FAILED', result: 'observation' })
            schedulerSnapshot(record, runtime)
          }
          try { Promise.resolve(fn()).then(() => finish(false), () => { finish(true); warn() }) } catch { finish(true); warn() }
        }
        // Node 超过有符号 32 位毫秒会退化为 1 ms，按单调时钟分段等待。
        const schedule = (remaining) => {
          timer.native = globalThis.setTimeout(run, Math.min(MAX_NATIVE_TIMEOUT_MS, Math.ceil(remaining)))
        }
        schedule(delayMs)
        runtime.timers.set(id, timer)
        record.health.scheduler.scheduled = increment(record.health.scheduler.scheduled)
        schedulerSnapshot(record, runtime)
        return Object.freeze({ id, dispose: () => clearTimeout(id) })
      },
      clearTimeout,
    })
  }

  function apiFor(record, runtime) {
    const moduleLog = log?.child?.(record.id) || log
    const mediaPort = record.builtin && record.id === 'builtin-media-features' && record.permissions.includes('media:features')
      ? createMediaFeaturesPort({ getConfig, media, stickers, delivery, access: accessControl, authorizeStickerSend: () => providerRegistry?.get('mediaFeatures')?.authorizeStickerSend(), assertActive() {
        requireActive(runtime)
        if (disposed || record.runtime !== runtime || records.get(record.id) !== record) throw new Error('媒体端口生命周期已结束')
      } }) : null
    const proactivityPort = record.builtin && record.id === 'builtin-proactivity' && record.permissions.includes('proactivity:service')
      ? createProactivityPort({
        getConfig, store: personaStore, services: cognition?.services, delivery, outbound,
        moduleId: record.id, runtimeGeneration: runtime.runtimeGeneration,
        getState: () => cognition?.services?.proactivityState?.() || { ready: false },
        assertActive() {
          requireActive(runtime)
          requirePermission(record, 'proactivity:service')
          if (disposed || record.runtime !== runtime || records.get(record.id) !== record) throw new Error('MODULE_DISABLED')
        },
      }) : null
    const learningPort = record.builtin && record.id === 'builtin-learning' && record.permissions.includes('learning:service')
      ? createLearningPort({ getConfig, store: personaStore, services: cognition?.services,
        getState: () => cognition?.services?.learningState?.() || { ready: false },
        assertActive() {
          requireActive(runtime)
          requirePermission(record, 'learning:service')
          if (disposed || record.runtime !== runtime || records.get(record.id) !== record) throw new Error('MODULE_DISABLED')
        },
      }) : null
    const api = {
      ...(learningPort ? { learning: learningPort } : {}),
      ...(proactivityPort ? { proactivity: proactivityPort } : {}),
      ...(mediaPort ? { mediaFeatures: mediaPort.api } : {}),
      id: record.id,
      source: record.source,
      builtin: record.builtin,
      name: record.name,
      version: record.version,
      dir: record.moduleDir,
      permissions: Object.freeze([...record.permissions]),
      log: moduleLog,
      providers: Object.freeze({
        ...(record.builtin ? { started(name) {
          requireActive(runtime)
          requirePermission(record, 'providers:register')
          if (!record.builtin || name === 'reminders' || !currentRuntime(record, runtime)) throw new Error('provider 生命周期不可用')
          const registered = providerRegistry?.registration(name)
          if (registered?.moduleId !== record.id || registered.runtimeGeneration !== runtime.runtimeGeneration) throw new Error('provider 未注册')
          providerRegistry.publishHealth(name, { owner: 'module', ownerModuleId: record.id, ownerRuntimeGeneration: runtime.runtimeGeneration, state: 'active' })
        } } : {}),
        register(name, provider) {
          requireActive(runtime)
          requirePermission(record, 'providers:register')
          if (!record.builtin) throw new Error('provider 仅允许内置模块注册')
          if (!providerRegistry?.register) throw new Error('provider 注册表不可用')
          const dispose = providerRegistry.register(name, provider, { moduleId: record.id, source: record.source, runtimeGeneration: runtime.runtimeGeneration })
          runtime.providerStops.push(async () => {
            const owner = { owner: 'module', ownerModuleId: record.id, ownerRuntimeGeneration: runtime.runtimeGeneration }
            const owns = () => {
              const cached = providerRegistry.health().items.find(item => item.name === name)
              return cached?.owner === 'module' && cached.ownerModuleId === record.id && cached.ownerRuntimeGeneration === runtime.runtimeGeneration
            }
            if (owns()) providerRegistry.publishHealth(name, { ...owner, state: 'draining' })
            try {
              if (name !== 'reminders' || !await reminderControl?.stop?.(provider)) await provider.stop({ dispose: disposed || disposing })
              if (owns()) providerRegistry.publishHealth(name, { state: 'unowned' })
            } catch (error) {
              if (owns()) providerRegistry.publishHealth(name, { ...owner, state: 'failed', reasonCode: 'PROVIDER_STOP_FAILED' })
              throw error
            }
          })
          runtime.disposers.push(dispose)
          return dispose
        },
      }),
      turn: Object.freeze({
        register(descriptor) {
          requireActive(runtime)
          requirePermission(record, 'turn:lifecycle')
          if (!record.builtin) throw new Error('turn 生命周期仅允许内置模块注册')
          if (!turnHooks?.register) throw new Error('turn 生命周期服务不可用')
          const dispose = turnHooks.register(descriptor)
          runtime.disposers.push(dispose)
          return dispose
        },
      }),
      status: Object.freeze({
        setInputStatus(userId, eventType) {
          requireActive(runtime)
          requirePermission(record, 'status:write')
          if (!record.builtin) throw new Error('输入状态仅允许内置模块写入')
          return invoke(record, runtime, 'TYPING_STATUS_FAILED', () => {
            if (typeof gateway?.actions?.setInputStatus !== 'function') throw new Error('输入状态服务不可用')
            return gateway.actions.setInputStatus(String(userId), eventType)
          })
        },
      }),
      access: Object.freeze({
        canSend({ chatType, chatId } = {}) {
          requireActive(runtime)
          requirePermission(record, 'access:check')
          if (!record.builtin) throw new Error('访问检查仅允许内置模块使用')
          try { return { allowed: accessControl?.canSend?.({ chatType, chatId })?.allowed === true } }
          catch { return { allowed: false } }
        },
      }),
      delivery: Object.freeze({
        send({ chatType, chatId, text, source } = {}) {
          requireActive(runtime)
          requirePermission(record, 'delivery:send')
          if (!record.builtin) throw new Error('交付发送仅允许内置模块使用')
          if (!delivery?.deliver) throw new Error('交付服务不可用')
          const moduleSource = `module:${record.id}`
          if (source !== undefined && source !== moduleSource && !(record.id === 'builtin-reminders' && source === 'reminder')) throw new Error('交付 source 不合法')
          if (!['private', 'group'].includes(chatType) || !/^[1-9]\d*$/.test(String(chatId ?? '')) || !Number.isSafeInteger(Number(chatId)) || typeof text !== 'string' || !text.trim()) throw new Error('交付需要 chatType、chatId、text')
          return delivery.deliver({ chatType, chatId, segments: [{ type: 'text', data: { text } }], source: source || moduleSource, moduleId: record.id, runtimeGeneration: runtime.runtimeGeneration })
        },
        registerPlanner(descriptor) {
          requireActive(runtime)
          requirePermission(record, 'delivery:plan')
          if (!record.builtin) throw new Error('交付规划仅允许内置模块注册')
          if (!deliveryRegistry?.register) throw new Error('交付规划服务不可用')
          const dispose = deliveryRegistry.register(typeof descriptor?.plan === 'function'
            ? { ...descriptor, plan: (...args) => invoke(record, runtime, 'REPLY_PLAN_FAILED', () => descriptor.plan(...args)) } : descriptor)
          runtime.disposers.push(dispose)
          return dispose
        },
      }),
      on(eventName, handler) {
        requireActive(runtime)
        requirePermission(record, 'events')
        const name = String(eventName || '')
        if (!EVENT_NAMES.has(name)) throw new Error(`不支持的事件名：${name}`)
        if (typeof handler !== 'function') throw new Error('事件 handler 必须是函数')
        const registration = { name, handler }
        runtime.handlers.add(registration)
        const dispose = () => runtime.handlers.delete(registration)
        runtime.disposers.push(dispose)
        return dispose
      },
      registerCommand(name, handler, { ownerOnly = true, overrideBuiltin = false, audience } = {}) {
        requireActive(runtime)
        requirePermission(record, 'commands')
        if (overrideBuiltin === true) {
          if (!record.builtin) throw new Error('受保护命令覆盖仅允许内置模块注册')
          requirePermission(record, 'commands:override')
        }
        if (audience !== undefined && !record.builtin) throw new Error('命令 audience 仅允许内置模块注册')
        const normalized = String(name || '').toLowerCase()
        if (!COMMAND_RE.test(normalized)) throw new Error('命令名不合法')
        if (typeof handler !== 'function') throw new Error('命令 handler 必须是函数')
        if (!commands?.registerCommand) throw new Error('命令服务不可用')
        const dispose = commands.registerCommand(normalized, input => {
          if (!runtime.active || !runtime.accepting) return undefined
          if (!mediaPort) return invoke(record, runtime, 'COMMAND_FAILED', () => handler(input))
          const result = normalized === 'sticker'
            ? invoke(record, runtime, 'COMMAND_FAILED', () => mediaPort.withCommand(input.turn, commandToken => handler({ ...input, commandToken })))
            : invoke(record, runtime, 'COMMAND_FAILED', () => handler(input))
          return Promise.resolve(result).then(value => runtime.active ? value : undefined)
        }, { ownerOnly: ownerOnly !== false, allowProtected: overrideBuiltin === true, moduleId: record.id, runtimeGeneration: runtime.runtimeGeneration, ...(audience !== undefined ? { audience } : {}) })
        runtime.disposers.push(dispose)
        return dispose
      },
      async sendText({ chatType, chatId, text } = {}) {
        requireActive(runtime)
        requirePermission(record, 'send:text')
        const sender = delivery?.deliver ? delivery : outbound
        if (!sender?.deliver) throw new Error('出站服务不可用')
        const type = chatType === 'group' ? 'group' : chatType === 'private' ? 'private' : ''
        const id = String(chatId ?? '').trim()
        const value = String(text ?? '').trim()
        if (!type || !id || !value) throw new Error('sendText 需要 chatType、chatId、text')
        return sender.deliver({ chatType: type, chatId: id, segments: [{ type: 'text', data: { text: value } }], source: `module:${record.id}`, moduleId: record.id, runtimeGeneration: runtime.runtimeGeneration })
      },
      registerKnowledgeSource(source) {
        requireActive(runtime)
        requirePermission(record, 'knowledge')
        if (!cognition?.registerKnowledgeSource) throw new Error('认知服务不可用')
        const dispose = cognition.registerKnowledgeSource(source)
        runtime.disposers.push(dispose)
        return dispose
      },
      registerCapability(name, impl) {
        requireActive(runtime)
        requirePermission(record, 'capabilities')
        if (!cognition?.registerCapability) throw new Error('认知服务不可用')
        const dispose = cognition.registerCapability(name, impl)
        runtime.disposers.push(dispose)
        return dispose
      },
    }
    if (record.builtin) api.health = Object.freeze({ report: value => {
      if (!currentRuntime(record, runtime)) return false
      return report(record, runtime, validateHealthReport(value))
    } })
    if (record.builtin && record.permissions.includes('scheduler')) api.scheduler = schedulerApi(record, runtime)
    for (const [permission, property, create] of [
      ['reminders:service', 'reminderRepository', assertActive => createReminderRepository({ store: personaStore, assertActive, assertDrain: () => {
        requireActiveDrain(runtime)
        if (disposed || disposing || record.runtime !== runtime) throw new Error('模块已停止')
      } })],
      ['config:read', 'legacyConfig', assertActive => createLegacyConfig({ getConfig, assertActive, moduleId: record.id })],
    ]) {
      if (record.builtin && record.permissions.includes(permission)) {
        api[property] = create(() => {
          requireActive(runtime)
          requirePermission(record, permission)
          if (disposed || !runtime.accepting || record.runtime !== runtime || records.get(record.id) !== record) throw new Error('模块服务生命周期已结束')
        })
      }
    }
    if (record.builtin && record.permissions.includes('persona:store')) {
      api.personaStore = createModulePersonaStore({
        store: personaStore, moduleId: record.id,
        assertActive() {
          requireActive(runtime)
          requirePermission(record, 'persona:store')
          if (disposed || record.runtime !== runtime || records.get(record.id) !== record) throw new Error('人格仓库生命周期已结束')
        },
      })
    }
    if (record.configSchema) {
      api.config = Object.freeze({
        get: () => clone(record.configValues),
        onChange(handler) {
          requireActive(runtime)
          if (typeof handler !== 'function') throw new Error('配置 handler 必须是函数')
          // 每次注册有独立身份；disposer 幂等，生命周期清理后不再通知。
          const registration = { handler }
          runtime.configListeners.add(registration)
          const dispose = () => runtime.configListeners.delete(registration)
          runtime.disposers.push(dispose)
          return dispose
        },
      })
    }
    Object.defineProperty(api, 'storage', {
      enumerable: true,
      get() { requirePermission(record, 'storage'); return runtime.storage },
    })
    Object.defineProperty(api, 'cognition', {
      enumerable: true,
      get() {
        requirePermission(record, 'cognition:read')
        return Object.freeze({
          snapshot: (...args) => cognition?.snapshot?.(...args),
          overview: (...args) => cognition?.overview?.(...args),
          memories: (...args) => cognition?.memories?.(...args),
          personDetail: (...args) => cognition?.personDetail?.(...args),
          relationshipsList: (...args) => cognition?.relationshipsList?.(...args),
          timeline: (...args) => cognition?.timeline?.(...args),
        })
      },
    })
    return Object.freeze(api)
  }

  function requireActiveDrain(runtime) {
    if (!runtime.active) throw new Error('模块已停止')
  }

  function requireActive(runtime) {
    if (!runtime.active || !runtime.accepting) throw new Error('模块已停止')
  }

  async function loadRecord(record, strict = false) {
    if (disposed || disposing) throw moduleActionError('MODULE_KERNEL_DISPOSED')
    record.generation = randomUUID()
    const runtime = { runtimeGeneration: randomUUID(), active: true, accepting: true, handlers: new Set(), configListeners: new Set(), timers: new Map(), disposers: [], providerStops: [], storage: null }
    record.runtime = runtime
    record.status = 'loading'
    record.health = createModuleHealth(runtime.runtimeGeneration, record.builtin && record.permissions.includes('scheduler'))
    record.health.telemetry.lastStartedAt = Date.now()
    observeHealth(record.health, { state: 'unknown', reasonCode: 'MODULE_LOADING' })
    touchHealth()
    try {
      if (record.builtin) await storagePath(record)
      if (!record.storage) record.storage = storageApi(record)
      runtime.storage = record.storage
      // 初始化和校验存储，避免未被模块访问的拒绝 Promise 泄漏。
      await runtime.storage.all()
      runtime.storage = Object.freeze(Object.fromEntries(Object.entries(record.storage).map(([key, method]) => [key, (...args) => {
        requireActive(runtime)
        return method(...args)
      }])))
      let imported
      if (record.builtin) {
        record.imported ||= Promise.resolve().then(() => record.load())
        imported = await record.imported
      } else {
        const fileStat = await stat(record.entryPath)
        imported = await import(`${pathToFileURL(record.entryPath).href}?v=${fileStat.mtimeMs}-${++importGeneration}-${Date.now()}`)
      }
      const setup = typeof imported.setup === 'function' ? imported.setup : (typeof imported.default === 'function' ? imported.default : imported.default?.setup)
      if (typeof setup !== 'function') throw new Error('入口必须导出 setup(api)（named 或 default）')
      if (disposed || disposing) throw moduleActionError('MODULE_KERNEL_DISPOSED')
      const cleanup = await setup(apiFor(record, runtime))
      if (cleanup !== undefined && typeof cleanup !== 'function') throw new Error('setup 返回值必须是 cleanup 函数或 undefined')
      if (cleanup) runtime.disposers.push(cleanup)
      record.status = 'loaded'
      record.health.phase = 'active'
      if (record.health.reasonCode === 'MODULE_LOADING') observeHealth(record.health, { state: 'unknown' })
      touchHealth()
      record.error = ''
      record.loadedAt = Date.now()
      log.info?.(`模块 ${record.id} 已加载`)
    } catch (error) {
      try { await disposeRuntime(record, strict) } catch (stopError) { record.error = '模块停止未完成'; throw stopError }
      record.status = 'error'
      observeHealth(record.health, { state: 'unhealthy', reasonCode: 'MODULE_SETUP_FAILED' })
      touchHealth()
      record.error = safeMessage(error)
      log.warn?.(`模块 ${record.id} 加载失败：${record.error}`)
    }
  }

  async function stop(ids, strict = false, retryFailed = false) {
    const { order } = analyzeDependencies(records)
    for (const id of ids) if (records.get(id)?.runtime) records.get(id).runtime.accepting = false
    for (const id of order.reverse()) if (ids.has(id)) {
      const record = records.get(id)
      if (record?.runtime?.stopFailed && !retryFailed && !disposed) continue
      await disposeRuntime(record, strict)
    }
  }

  async function reconcile(strict = false) {
    const { order, errors } = analyzeDependencies(records)
    // 先计算不可运行闭包并逆序清理，再按拓扑顺序 setup。
    const unavailable = new Set()
    for (const id of order) {
      const record = records.get(id)
      record.enabled = effectiveEnabled(record)
      if (!record.valid || errors.has(id) || !record.enabled || record.status === 'error' || record.requires.some((dep) => unavailable.has(dep))) unavailable.add(id)
    }
    await stop(unavailable, strict)
    for (const id of order) {
      const record = records.get(id)
      record.dependencyStatus = Object.fromEntries(record.requires.map(dep => [dep, records.get(dep)?.status === 'loaded']))
      touchHealth()
      if (!record.valid) continue
      if (record.runtime?.stopFailed) { record.status = 'error'; continue }
      if (errors.has(id)) {
        record.status = 'error'; record.error = errors.get(id)
        observeHealth(record.health, { state: 'unhealthy', reasonCode: 'DEPENDENCY_BLOCKED' })
        continue
      }
      if (!record.enabled) { record.status = 'disabled'; record.error = ''; continue }
      const missing = record.requires.find((dep) => records.get(dep)?.status !== 'loaded')
      if (missing) { record.status = 'blocked'; record.error = `依赖未加载：${missing}`; continue }
      if (!record.runtime && record.status !== 'error') await loadRecord(record, strict)
    }
  }

  async function scan() {
    await mkdir(root, { recursive: true })
    await loadState()
    for (const descriptor of registry) {
      const manifest = validateManifest(descriptor.manifest, { builtin: true })
      if (records.has(manifest.id)) throw new Error('内置注册表 id 重复')
      if (typeof descriptor.load !== 'function') throw new Error('内置注册表缺少 lazy loader')
      const record = makeRecord({ ...manifest, source: 'builtin', builtin: true, valid: true,
        ...loadWebuiDescriptor(descriptor.ui, { source: 'builtin' }),
        configSchema: descriptor.config === undefined ? null : validateConfigSchema(descriptor.config),
        provides: Array.isArray(descriptor.provides) ? [...new Set(descriptor.provides.filter(name => PROVIDER_NAMES.includes(name)))] : [],
        defaultEnabled: descriptor.defaultEnabled === true, load: descriptor.load, moduleDir: join(root, '.builtin', manifest.id) })
      await loadModuleConfig(record)
      for (const name of record.provides) providerRegistry?.expect(name, record.id)
      records.set(manifest.id, record)
    }
    const entries = await readdir(root, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.builtin' || (!entry.isDirectory() && !entry.isSymbolicLink())) continue
      // 保留命名空间的外部目录不可能覆盖真正的内置记录。
      if (records.has(entry.name)) { log.warn?.(`忽略保留的内置模块目录：${entry.name}`); continue }
      try {
        const record = makeRecord(await manifestFor(join(root, entry.name), entry.name))
        await loadModuleConfig(record)
        records.set(entry.name, record)
      }
      catch (error) { records.set(entry.name, errorRecord(entry.name, error)) }
    }
    await reconcile()
  }

  function start() {
    return serialize(async () => {
      if (disposed) throw new Error('module kernel 已释放')
      if (started) return list()
      await scan()
      started = true
      return list()
    })
  }

  function list() {
    return [...records.values()].map(publicRecord).sort((a, b) => a.id.localeCompare(b.id))
  }

  // Deliberately bypass serialize(): reads must complete even during stalled drain.
  function health(id) {
    if (id !== undefined && (typeof id !== 'string' || !records.has(id))) return { ok: false, code: 'MODULE_NOT_FOUND' }
    const providerSnapshot = providerRegistry?.health() || { revision: 0, items: [] }
    const selected = id === undefined ? [...records.values()] : [records.get(id)]
    const items = selected.map(record => projectModuleHealth(record, record.provides?.map(name => providerSnapshot.items.find(item => item.name === name) || createProviderHealth(name, record.id)).filter(Boolean) || []))
      .sort((a, b) => a.moduleId.localeCompare(b.moduleId))
    const summary = Object.fromEntries(['unknown', 'healthy', 'degraded', 'unhealthy', 'stopped'].map(state => [state, items.filter(item => item.health === state).length]))
    return { ok: true, collectedAt: Date.now(), revision: Math.min(Number.MAX_SAFE_INTEGER, healthRevision + providerSnapshot.revision), items, summary }
  }

  function uiCatalog() {
    return buildModuleUiCatalog(records.values(), hasUiGrant)
  }

  function hasUiGrant(record) {
    const grant = uiGrants.get(record.id)
    return Boolean(sandboxEligible(record) && record.uiArtifactHash && grant?.id === record.id && grant.uiRevision === record.uiRevision && grant.entry === record.ui.sandbox.entry && grant.artifactHash === record.uiArtifactHash)
  }

  async function checkedArtifact(record) {
    if (!record?.uiArtifactHash || !sandboxEligible(record)) return null
    try {
      const artifact = await readUiArtifact(root, record)
      if (artifact.hash === record.uiArtifactHash) return artifact
    } catch {}
    // Latch closed until reload: restoring bytes must not silently restore access.
    record.uiArtifactHash = null
    return null
  }

  function refreshUiCatalog() {
    return serialize(async () => {
      for (const record of records.values()) if (sandboxEligible(record)) await checkedArtifact(record)
      return uiCatalog()
    })
  }

  function stateSnapshot(nextDisabled = disabled, nextEnabled = enabledIds, nextGrants = uiGrants) {
    return { disabled: [...nextDisabled].sort(), enabled: [...nextEnabled].sort(), uiGrants: Object.fromEntries(nextGrants) }
  }

  function setUiGrant(id, enabled) {
    return serialize(async () => {
      const record = records.get(checkAction(id))
      if (typeof id !== 'string' || typeof enabled !== 'boolean' || !record || !sandboxEligible(record)) throw actionError('仅允许声明隔离 UI 和 ui:sandbox 权限的外部模块授权', 'MODULE_UI_UNAVAILABLE')
      if (enabled && !await checkedArtifact(record)) throw actionError('隔离 UI 资源不可用，请重载后重新授权', 'MODULE_UI_UNAVAILABLE')
      const next = new Map(uiGrants)
      if (enabled) next.set(id, { id, uiRevision: record.uiRevision, entry: record.ui.sandbox.entry, artifactHash: record.uiArtifactHash })
      else next.delete(id)
      try { await writeJsonAtomic(stateFile, stateSnapshot(disabled, enabledIds, next)) }
      catch { throw actionError('隔离 UI 授权保存失败', 'MODULE_UI_WRITE_FAILED') }
      uiGrants = next
      record.generation = randomUUID()
      return uiCatalog().items.find((item) => item.moduleId === id)
    })
  }

  function readSandboxAsset(id, generation, path) {
    return serialize(async () => {
      const record = records.get(id)
      if (disposed || !record || !record.enabled || record.status !== 'loaded' || record.generation !== generation || !hasUiGrant(record)) return null
      const artifact = await checkedArtifact(record)
      return artifact && hasUiGrant(record) ? artifact.files.get(path) || null : null
    })
  }

  function checkAction(id) {
    if (disposed) throw new Error('module kernel 已释放')
    const normalized = String(id || '')
    if (!ID_RE.test(normalized)) throw new Error('模块 id 不合法')
    return normalized
  }

  async function reloadWork(id, strict = false, onStopped = () => {}) {
    const normalized = checkAction(id)
    const previous = records.get(normalized)
    if (previous?.builtin || normalized.startsWith('builtin-')) throw actionError('内置模块不能重载', 'MODULE_BUILTIN_RELOAD')
    const affected = dependentClosure(records, [normalized])
    await stop(affected, strict, true)
    onStopped()
    for (const id of affected) {
      const record = records.get(id)
      if (record?.valid) { record.status = 'disabled'; record.error = '' }
    }
    try { await requireModuleDirectory(normalized) }
    catch (error) {
      records.delete(normalized)
      await reconcile(strict)
      throw error
    }
    try {
      const record = makeRecord(await manifestFor(join(root, normalized), normalized))
      await loadModuleConfig(record)
      records.set(normalized, record)
    }
    catch (error) { records.set(normalized, errorRecord(normalized, error, previous)) }
    await reconcile(strict)
    return publicRecord(records.get(normalized))
  }

  async function setEnabledWork(id, enabled, strict = false, onStopped = () => {}) {
    const normalized = checkAction(id)
    if (typeof enabled !== 'boolean') throw new Error('enabled 必须是 boolean')
    const previous = records.get(normalized)
    if (!previous) throw new Error('模块不存在；请先重载外部模块')
    if (!previous.builtin && (!previous.valid || !previous.manifestEnabled)) throw actionError('外部模块清单禁止启停，请编辑 manifest 后重载', 'MODULE_MANIFEST_DISABLED')
    const nextDisabled = new Set(disabled), nextEnabled = new Set(enabledIds)
    if (enabled) { nextDisabled.delete(normalized); nextEnabled.add(normalized) }
    else { nextDisabled.add(normalized); nextEnabled.delete(normalized) }
    try { await writeJsonAtomic(stateFile, stateSnapshot(nextDisabled, nextEnabled)) }
    catch { throw actionError('模块状态保存失败，运行状态未改变', 'MODULE_STATE_WRITE_FAILED') }
    disabled = nextDisabled; enabledIds = nextEnabled
    previous.enabled = effectiveEnabled(previous)
    const affected = dependentClosure(records, [normalized])
    await stop(affected, strict, true)
    onStopped()
    for (const id of affected) {
      const record = records.get(id)
      if (record?.valid) { record.status = 'disabled'; record.error = '' }
    }
    await reconcile(strict)
    return publicRecord(records.get(normalized))
  }

  const getActionModule = id => records.has(id) ? publicRecord(records.get(id)) : null
  const getActionPersona = () => disposed || disposing ? {} : ({ id: cognition?.services?.persona?.activeId?.(), generation: cognition?.services?.persona?.scopeGeneration?.() })
  function eligibility(record, actionId) {
    if (disposed || disposing) return 'MODULE_KERNEL_DISPOSED'
    if (actionId === 'module.reload') return record.builtin ? 'MODULE_ACTION_UNAVAILABLE' : null
    if (actionId === 'module.enable') return record.canToggle && (!record.enabled || ['error', 'blocked'].includes(record.status)) ? null : 'MODULE_ACTION_UNAVAILABLE'
    if (actionId === 'module.disable') return record.canToggle && record.enabled ? null : 'MODULE_ACTION_UNAVAILABLE'
    if (actionId === 'module.restart') return record.builtin && record.enabled && record.status === 'loaded' && record.runtimeGeneration ? null : 'MODULE_ACTION_UNAVAILABLE'
    const name = actionId === 'proactivity.runOnce' ? 'proactivity' : 'learning'
    if (!record.builtin || record.id !== `builtin-${name}` || !record.enabled || record.status !== 'loaded' || !providerRegistry?.get(name)) return 'MODULE_ACTION_UNAVAILABLE'
    const c = getConfig?.()?.cognition
    return c?.enabled && !c.paused && c[name]?.enabled && cognition?.state?.ready ? null : 'MODULE_ACTION_UNAVAILABLE'
  }
  const actions = createModuleActions({
    getModule: getActionModule, getPersona: getActionPersona, eligibility,
    affected: (id, actionId) => actionId.startsWith('module.') ? dependentClosure(records, [id]) : [id],
    execute: (input, context) => serialize(async () => {
      if (disposed || disposing) throw moduleActionError('MODULE_KERNEL_DISPOSED')
      context.check()
      if (!input.actionId.startsWith('module.')) {
        context.update('running')
        // Return the flight inside an envelope: network waits do not hold the lifecycle queue.
        const flight = Promise.resolve(input.actionId === 'proactivity.runOnce'
          ? providerRegistry.get('proactivity').tick() : providerRegistry.get('learning').runPending({ max: context.max }))
        flight.catch(() => {})
        return { flight }
      }
      const closure = dependentClosure(records, [input.moduleId])
      if ([...closure].some(id => !context.closure.includes(id))) throw moduleActionError('MODULE_ACTION_BUSY')
      const reminders = [...closure].some(id => records.get(id)?.provides.includes('reminders'))
      let recoveryHeld = false
      try {
        context.update('draining')
        if (reminders) { await reminderControl?.begin?.(); recoveryHeld = true }
        context.check()
        if (input.actionId === 'module.restart') {
          // Only runtimes present at admission are eligible for replacement.
          const running = new Set([...closure].filter(id => records.get(id)?.runtime))
          for (const id of running) records.get(id).runtime.accepting = false
          await stop(running, true, true)
          if (disposed || disposing) throw moduleActionError('MODULE_KERNEL_DISPOSED')
          context.update('starting')
          const { order } = analyzeDependencies(records)
          for (const id of order) if (running.has(id)) {
            const record = records.get(id)
            record.dependencyStatus = Object.fromEntries(record.requires.map(dep => [dep, records.get(dep)?.status === 'loaded']))
            touchHealth()
            if (record.requires.some(dep => records.get(dep)?.status !== 'loaded')) {
              record.status = 'blocked'; record.error = '依赖未加载'; continue
            }
            await loadRecord(record, true)
          }
          if ([...running].some(id => records.get(id)?.status !== 'loaded')) throw moduleActionError('MODULE_ACTION_FAILED')
          return publicRecord(records.get(input.moduleId))
        }
        const starting = () => {
          if (disposed || disposing) throw moduleActionError('MODULE_KERNEL_DISPOSED')
          context.update('starting')
        }
        const result = input.actionId === 'module.reload' ? await reloadWork(input.moduleId, true, starting)
          : await setEnabledWork(input.moduleId, input.actionId === 'module.enable', true, starting)
        context.update('starting')
        return result
      } catch (error) {
        for (const id of closure) {
          const record = records.get(id)
          if (record?.enabled && !record.runtime && record.status !== 'error') { record.status = 'blocked'; record.error = '恢复未完成' }
        }
        throw error
      } finally {
        if (recoveryHeld) await reminderControl?.end?.()
      }
    }).then(async result => {
      if (result?.flight) return await result.flight
      if (input.actionId !== 'module.disable' && providerRegistry) {
        const owners = providerRegistry.health().items
        for (const id of context.closure) {
          const record = records.get(id)
          if (!record?.runtime || record.status !== 'loaded') continue
          if (record.provides.some(name => !owners.some(owner => owner.name === name && owner.state === 'active' && owner.ownerModuleId === id && owner.ownerRuntimeGeneration === record.runtime.runtimeGeneration))) throw moduleActionError('MODULE_ACTION_FAILED')
        }
      }
      return result
    }),
  })
  function unreserved(id) {
    if ([...dependentClosure(records, [id])].some(member => actions.isReserved(member))) throw moduleActionError('MODULE_ACTION_BUSY')
  }
  function reload(id) {
    unreserved(id)
    return serialize(() => { unreserved(id); return reloadWork(id, true) })
  }
  function setEnabled(id, enabled) {
    unreserved(id)
    return serialize(() => { unreserved(id); return setEnabledWork(id, enabled, true) })
  }

  function configRecord(id) {
    if (disposed) throw actionError('模块内核已释放', 'MODULE_CONFIG_UNAVAILABLE')
    const record = typeof id === 'string' ? records.get(id) : null
    if (!record?.configSchema) throw actionError('模块不存在或不支持模块配置', 'MODULE_CONFIG_UNAVAILABLE')
    return record
  }

  function configSnapshot(record) {
    return { id: record.id, source: record.source, schema: clone(record.configSchema), values: clone(record.configValues), revision: record.configRevision }
  }

  function getModuleConfig(id) {
    return serialize(() => configSnapshot(configRecord(id)))
  }

  function setModuleConfig(id, values, revision) {
    // 在进入队列前复制调用参数，避免等待期间被调用者修改。
    let draft
    try { draft = clone(values) } catch { return Promise.reject(actionError('配置 values 必须可复制', 'MODULE_CONFIG_INVALID')) }
    return serialize(async () => {
      const record = configRecord(id)
      if (!Number.isSafeInteger(revision) || revision < 0) throw actionError('需要非负整数 revision', 'MODULE_CONFIG_INVALID')
      if (revision !== record.configRevision) throw actionError('配置已被修改，请重新加载后再保存', 'MODULE_CONFIG_CONFLICT')
      const validated = validateConfigValues(record.configSchema, draft)
      const nextRevision = revision + 1
      if (!Number.isSafeInteger(nextRevision)) throw actionError('配置 revision 已达上限', 'MODULE_CONFIG_INVALID')
      const saved = { version: record.configSchema.version, revision: nextRevision, values: validated }
      if (Buffer.byteLength(JSON.stringify(saved, null, 2)) > MAX_CONFIG_BYTES) throw actionError('模块配置超过 64 KiB', 'MODULE_CONFIG_INVALID')
      try { await writeJsonAtomic(await storagePath(record, 'config.json'), saved) }
      catch { throw actionError('模块配置保存失败，当前值未改变', 'MODULE_CONFIG_WRITE_FAILED') }
      record.configValues = validated
      record.configRevision = nextRevision
      record.configWarning = ''
      const runtime = record.runtime
      for (const registration of [...(runtime?.configListeners || [])]) {
        if (!runtime.active || !runtime.configListeners.has(registration)) continue
        try {
          // 不等待 handler，避免 handler 排队启停/保存时和生命周期队列互锁。
          Promise.resolve(invoke(record, runtime, 'CONFIG_LISTENER_FAILED', () => registration.handler(clone(validated)))).catch(() => log.warn?.(`模块 ${record.id} 配置监听器失败`))
        } catch { log.warn?.(`模块 ${record.id} 配置监听器失败`) }
      }
      return configSnapshot(record)
    })
  }

  async function dispatch(normalizedEvent) {
    if (disposed || !normalizedEvent) return
    const tasks = []
    for (const record of records.values()) {
      if (record.status !== 'loaded' || !record.runtime) continue
      for (const registration of record.runtime.handlers) {
        if (registration.name !== 'any' && registration.name !== normalizedEvent.kind) continue
        const runtime = record.runtime
        tasks.push(Promise.resolve().then(() => {
          if (runtime.active && runtime.accepting && record.runtime === runtime) return invoke(record, runtime, 'EVENT_FAILED', () => registration.handler(normalizedEvent))
        }).catch((error) => serialize(async () => {
          if (!runtime.active || record.runtime !== runtime || records.get(record.id) !== record) return
          await stop(dependentClosure(records, [record.id]))
          record.status = 'error'
          observeHealth(record.health, { state: 'unhealthy', reasonCode: 'EVENT_FAILED' })
          touchHealth()
          record.error = `事件处理失败：${safeMessage(error)}`
          await reconcile()
          log.warn?.(`模块 ${record.id} 事件处理失败：${messageOf(error)}`)
        })))
      }
    }
    await Promise.allSettled(tasks)
  }

  function dispose() {
    disposing = true
    return serialize(async () => {
      if (disposed) return
      disposed = true
      await stop(new Set(records.keys()))
    })
  }

  return { start, list, health, actions: actions.catalog, action: actions.submit, getOperation: actions.getOperation, performLegacyAction: actions.performLegacy, uiCatalog, refreshUiCatalog, setUiGrant, readSandboxAsset, reload, setEnabled, getModuleConfig, setModuleConfig, dispatch, dispose }
}

