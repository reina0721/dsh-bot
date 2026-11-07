// Core-owned actions only. Neither manifests nor request bodies supply executors.
import { randomUUID } from 'node:crypto'
import { ID_RE } from './manifest.js'
import { PERSONA_ID_RE } from '../cognition/persona.js'

export const MODULE_ACTIONS = Object.freeze([
  'module.enable', 'module.disable', 'module.restart', 'module.reload',
  'proactivity.runOnce', 'learning.runPending',
])
const terminal = new Set(['succeeded', 'failed', 'cancelled'])
const fields = ['moduleId', 'actionId', 'expectedGeneration', 'requestId', 'expectedPersonaId', 'expectedPersonaGeneration']
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export const moduleActionError = code => Object.assign(new Error(code), { code })
const fail = code => { throw moduleActionError(code) }
const copy = value => structuredClone(value)

export function normalizeActionResult(actionId, value) {
  if (actionId.startsWith('module.')) {
    const ok = actionId === 'module.disable' ? value?.enabled === false && value?.runtimeGeneration == null
      : value?.status === 'loaded' || (actionId === 'module.reload' && value?.status === 'disabled')
    return { ok, code: ok ? null : 'MODULE_ACTION_FAILED' }
  }
  const results = Array.isArray(value) ? value : [value]
  const ok = results.length > 0 && results.every(item => item?.ok === true)
  const busy = results.some(item => item?.reason === 'busy')
  return { ok, code: ok ? null : busy ? 'BUSY' : results.length ? 'MODULE_RUN_FAILED' : 'NO_TASK' }
}

export function createModuleActions({ getModule, getPersona = () => ({}), eligibility, affected, execute, now = Date.now, timers = globalThis } = {}) {
  const operations = new Map(), requests = new Map(), reservations = new Map(), completions = new Map()
  function prune() {
    for (const [id, operation] of operations) if (terminal.has(operation.status) && now() - operation.completedAt >= 3600000) {
      operations.delete(id); requests.delete(operation.requestId)
    }
  }
  function validate(input) {
    if (!input || typeof input !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
      || Reflect.ownKeys(input).some(key => !fields.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key), 'value'))
      || !ID_RE.test(input.moduleId || '') || typeof input.moduleId !== 'string'
      || !MODULE_ACTIONS.includes(input.actionId) || !token(input.requestId)
      || !(input.expectedGeneration === null || token(input.expectedGeneration))
      || (Object.hasOwn(input, 'expectedPersonaId') && (typeof input.expectedPersonaId !== 'string' || !PERSONA_ID_RE.test(input.expectedPersonaId)))
      || (Object.hasOwn(input, 'expectedPersonaGeneration') && (!Number.isSafeInteger(input.expectedPersonaGeneration) || input.expectedPersonaGeneration < 0))) fail('MODULE_ACTION_INVALID')
    return Object.fromEntries(fields.filter(key => Object.hasOwn(input, key)).map(key => [key, input[key]]))
  }
  function check(input) {
    const record = getModule(input.moduleId)
    if (!record) fail('MODULE_NOT_FOUND')
    if (input.expectedGeneration !== (record.runtimeGeneration || record.generation)) fail('MODULE_RUNTIME_CONFLICT')
    const persona = getPersona()
    if ((input.expectedPersonaId !== undefined && input.expectedPersonaId !== persona.id)
      || (input.expectedPersonaGeneration !== undefined && input.expectedPersonaGeneration !== persona.generation)) fail('MODULE_PERSONA_CONFLICT')
    const reason = eligibility(record, input.actionId)
    if (reason) fail(reason)
  }
  function catalog(moduleId) {
    const record = getModule(moduleId)
    if (!record) return { ok: false, code: 'MODULE_NOT_FOUND' }
    const persona = getPersona()
    return { ok: true, moduleId, expectedGeneration: record.runtimeGeneration || record.generation,
      expectedPersonaId: persona.id ?? null, expectedPersonaGeneration: persona.generation ?? null,
      items: MODULE_ACTIONS.map(actionId => {
        const closure = actionId.startsWith('module.') ? affected(moduleId, actionId) : [moduleId]
        const reasonCode = [...closure].some(id => reservations.has(id)) ? 'MODULE_ACTION_BUSY' : eligibility(record, actionId)
        return { actionId, available: !reasonCode, reasonCode: reasonCode || null }
      }) }
  }
  function getOperation({ id, requestId } = {}) {
    prune()
    if ((id === undefined) === (requestId === undefined)) return { ok: false, code: 'MODULE_ACTION_INVALID' }
    const operation = operations.get(id ?? requests.get(requestId))
    return operation ? { ok: true, operation: copy(operation) } : { ok: false, code: 'MODULE_OPERATION_NOT_FOUND' }
  }
  function submitInternal(value, legacyMax = 1) {
    const input = validate(value)
    prune()
    const existing = operations.get(requests.get(input.requestId))
    const signature = JSON.stringify(input)
    if (existing) {
      if (existing.signature !== signature) fail('MODULE_REQUEST_CONFLICT')
      return { ok: true, operation: snapshot(existing) }
    }
    check(input)
    const closure = [...new Set(affected(input.moduleId, input.actionId))]
    if (closure.some(id => reservations.has(id))) fail('MODULE_ACTION_BUSY')
    if (operations.size >= 128) fail('MODULE_OPERATION_LIMIT')
    const operation = { id: randomUUID(), ...input, status: 'queued', phase: 'queued', code: null,
      createdAt: now(), updatedAt: now(), completedAt: null, result: null, resultRuntimeGeneration: null }
    Object.defineProperty(operation, 'signature', { value: signature })
    operations.set(operation.id, operation); requests.set(input.requestId, operation.id)
    for (const id of closure) reservations.set(id, operation.id)
    let timer = null
    const update = phase => {
      operation.phase = phase; operation.updatedAt = now()
      if (phase === 'draining' && timer === null) {
        timer = timers.setTimeout(() => {
          if (operation.phase === 'draining' && !terminal.has(operation.status)) {
            operation.status = 'STOP_PENDING'; operation.code = 'STOP_PENDING'; operation.updatedAt = now()
          }
        }, 10000)
        timer?.unref?.()
      }
      if (phase !== 'draining' && timer !== null) {
        timers.clearTimeout(timer); timer = null
        operation.status = 'running'; operation.code = null
      }
    }
    // Capture persona for run actions even when the client omitted its optional guard.
    const persona = getPersona()
    const run = !input.actionId.startsWith('module.')
    const guarded = run ? { ...input, expectedPersonaId: persona.id, expectedPersonaGeneration: persona.generation } : input
    const completion = Promise.resolve().then(async () => {
      operation.status = 'running'; operation.updatedAt = now()
      const result = await execute(input, { check: () => check(guarded), update, closure, max: legacyMax })
      const normalized = normalizeActionResult(input.actionId, result)
      operation.result = normalized; operation.code = normalized.code
      operation.status = normalized.ok ? 'succeeded' : 'failed'
      operation.resultRuntimeGeneration = getModule(input.moduleId)?.runtimeGeneration || null
      return result
    }).catch(error => {
      const code = ['MODULE_RUNTIME_CONFLICT', 'MODULE_PERSONA_CONFLICT', 'MODULE_ACTION_UNAVAILABLE', 'MODULE_ACTION_BUSY', 'MODULE_STATE_WRITE_FAILED', 'MODULE_MANIFEST_DISABLED', 'MODULE_BUILTIN_RELOAD', 'PROVIDER_STOP_FAILED', 'MODULE_CLEANUP_FAILED', 'MODULE_KERNEL_DISPOSED'].includes(error?.code) ? error.code : 'MODULE_ACTION_FAILED'
      operation.status = ['MODULE_RUNTIME_CONFLICT', 'MODULE_PERSONA_CONFLICT', 'MODULE_KERNEL_DISPOSED'].includes(code) ? 'cancelled' : 'failed'
      operation.code = code; operation.result = { ok: false, code }
      throw moduleActionError(code)
    }).finally(() => {
      if (timer !== null) timers.clearTimeout(timer)
      operation.phase = 'done'; operation.completedAt = now(); operation.updatedAt = now()
      for (const id of closure) if (reservations.get(id) === operation.id) reservations.delete(id)
      completions.delete(operation.id)
    })
    completions.set(operation.id, completion)
    completion.catch(() => {})
    return { ok: true, operation: snapshot(operation) }
  }
  function snapshot(operation) { return copy(operation) }
  async function performLegacy(moduleId, actionId, max = 1) {
    const record = getModule(moduleId)
    if (actionId === 'module.reload' && record?.builtin) throw Object.assign(new Error('内置模块不能重载'), { code: 'MODULE_BUILTIN_RELOAD' })
    if (actionId === 'module.enable' || actionId === 'module.disable') {
      if (record && !record.canToggle) fail('MODULE_MANIFEST_DISABLED')
      if (record?.enabled === (actionId === 'module.enable') && !['error', 'blocked'].includes(record.status)) {
        if (reservations.has(moduleId)) fail('MODULE_ACTION_BUSY')
        return record
      }
    }
    if (!actionId.startsWith('module.') && record && eligibility(record, actionId)) return { ok: false, reason: 'MODULE_DISABLED' }
    const accepted = submitInternal({ moduleId, actionId, expectedGeneration: record?.runtimeGeneration || record?.generation || null, requestId: randomUUID() }, Math.max(1, Math.min(50, Math.floor(Number(max) || 1))))
    return completions.get(accepted.operation.id)
  }
  return Object.freeze({ catalog, submit: value => submitInternal(value), getOperation, performLegacy, isReserved: id => reservations.has(id) })
}
