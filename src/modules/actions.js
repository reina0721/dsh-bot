// Core-owned actions only. Neither manifests nor request bodies supply executors.
import { randomUUID } from 'node:crypto'
import { ACTION_AUDIT_LIMIT, ACTION_AUDIT_TTL_MS } from './action-audit.js'
import { ID_RE } from './manifest.js'
import { PERSONA_ID_RE } from '../cognition/persona.js'

export const MODULE_ACTIONS = Object.freeze([
  'module.enable', 'module.disable', 'module.restart', 'module.reload',
  'proactivity.runOnce', 'learning.runPending',
])
const executionCodes = new Set(['MODULE_RUNTIME_CONFLICT', 'MODULE_PERSONA_CONFLICT', 'MODULE_ACTION_UNAVAILABLE', 'MODULE_ACTION_BUSY', 'MODULE_STATE_WRITE_FAILED', 'MODULE_AUDIT_WRITE_FAILED', 'MODULE_MANIFEST_DISABLED', 'MODULE_BUILTIN_RELOAD', 'PROVIDER_STOP_FAILED', 'MODULE_CLEANUP_FAILED', 'MODULE_KERNEL_DISPOSED'])
const auditCodes = new Set([...executionCodes, 'MODULE_ACTION_FAILED', 'MODULE_RUN_FAILED', 'BUSY', 'NO_TASK', 'PROCESS_RESTART'])
const terminal = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
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

export function createModuleActions({ getModule, getPersona = () => ({}), eligibility, affected, execute, now = Date.now, timers = globalThis, audit = null, onAuditError = () => {} } = {}) {
  const counts = { admitted: 0, rejected: 0, completed: 0, failed: 0, firstAt: null, lastAt: null }
  const stamp = () => { try { counts.lastAt = now(); counts.firstAt ??= counts.lastAt } catch {} }
  const operations = new Map(), requests = new Map(), reservations = new Map(), completions = new Map()
  function prune() {
    for (const [id, operation] of operations) if (terminal.has(operation.status) && now() - operation.completedAt >= ACTION_AUDIT_TTL_MS) {
      operations.delete(id); requests.delete(operation.requestId)
    }
  }
  function persist() {
    if (!audit) return
    try { audit.save([...operations.values()].map(snapshot)) }
    catch { fail('MODULE_AUDIT_WRITE_FAILED') }
  }
  // After I/O, a failed terminal write cannot undo the effect or trigger a retry.
  // The prior durable queued/running record will become interrupted on restart.
  function observePersist() {
    try { persist() } catch { try { onAuditError('MODULE_AUDIT_WRITE_FAILED') } catch {} }
  }
  function restore() {
    if (!audit) return
    try {
      const saved = audit.load()
      if (!Array.isArray(saved) || saved.length > ACTION_AUDIT_LIMIT) throw Error('invalid audit')
      for (const row of saved) {
        const input = validate(Object.fromEntries(fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])))
        if (!token(row.id) || operations.has(row.id) || requests.has(input.requestId)
          || !['queued', 'running', 'STOP_PENDING', ...terminal].includes(row.status)
          || !['queued', 'draining', 'starting', 'running', 'done'].includes(row.phase)
          || !Number.isFinite(row.createdAt) || !Number.isFinite(row.updatedAt)
          || !(row.completedAt === null || Number.isFinite(row.completedAt))
          || (terminal.has(row.status) && row.completedAt === null)) throw Error('invalid audit')
        // Whitelist persisted metadata; never load an executor, body or original error.
        const done = terminal.has(row.status)
        const code = done ? (row.code === null ? null : auditCodes.has(row.code) ? row.code : 'MODULE_ACTION_FAILED') : 'PROCESS_RESTART'
        const operation = { id: row.id, ...input, status: done ? row.status : 'interrupted', phase: 'done', code,
          createdAt: row.createdAt, updatedAt: done ? row.updatedAt : now(), completedAt: done ? row.completedAt : now(),
          result: { ok: row.status === 'succeeded', code }, resultRuntimeGeneration: token(row.resultRuntimeGeneration) ? row.resultRuntimeGeneration : null }
        Object.defineProperty(operation, 'signature', { value: JSON.stringify(input) })
        operations.set(operation.id, operation); requests.set(input.requestId, operation.id)
      }
      prune()
      if (saved.length) persist() // Persist interruption before admitting anything new.
    } catch (error) {
      fail(error?.code === 'MODULE_AUDIT_WRITE_FAILED' ? error.code : 'MODULE_AUDIT_READ_FAILED')
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
    if (operations.size >= ACTION_AUDIT_LIMIT) fail('MODULE_OPERATION_LIMIT')
    const operation = { id: randomUUID(), ...input, status: 'queued', phase: 'queued', code: null,
      createdAt: now(), updatedAt: now(), completedAt: null, result: null, resultRuntimeGeneration: null }
    Object.defineProperty(operation, 'signature', { value: signature })
    operations.set(operation.id, operation); requests.set(input.requestId, operation.id)
    // Admission is durable before scheduling an executor or taking ownership.
    try { persist() } catch (error) {
      operations.delete(operation.id); requests.delete(input.requestId)
      throw error
    }
    counts.admitted += 1; stamp()
    for (const id of closure) reservations.set(id, operation.id)
    let timer = null
    const update = phase => {
      operation.phase = phase; operation.updatedAt = now()
      if (phase === 'draining' && timer === null) {
        timer = timers.setTimeout(() => {
          if (operation.phase === 'draining' && !terminal.has(operation.status)) {
            operation.status = 'STOP_PENDING'; operation.code = 'STOP_PENDING'; operation.updatedAt = now()
            observePersist()
          }
        }, 10000)
        timer?.unref?.()
      }
      if (phase !== 'draining' && timer !== null) {
        timers.clearTimeout(timer); timer = null
        operation.status = 'running'; operation.code = null
      }
      observePersist()
    }
    // Capture persona for run actions even when the client omitted its optional guard.
    const persona = getPersona()
    const run = !input.actionId.startsWith('module.')
    const guarded = run ? { ...input, expectedPersonaId: persona.id, expectedPersonaGeneration: persona.generation } : input
    const completion = Promise.resolve().then(async () => {
      operation.status = 'running'; operation.phase = 'running'; operation.updatedAt = now()
      persist()
      const result = await execute(input, { check: () => check(guarded), update, closure, max: legacyMax })
      const normalized = normalizeActionResult(input.actionId, result)
      operation.result = normalized; operation.code = normalized.code
      operation.status = normalized.ok ? 'succeeded' : 'failed'
      operation.resultRuntimeGeneration = getModule(input.moduleId)?.runtimeGeneration || null
      return result
    }).catch(error => {
      const code = executionCodes.has(error?.code) ? error.code : 'MODULE_ACTION_FAILED'
      operation.status = ['MODULE_RUNTIME_CONFLICT', 'MODULE_PERSONA_CONFLICT', 'MODULE_KERNEL_DISPOSED'].includes(code) ? 'cancelled' : 'failed'
      operation.code = code; operation.result = { ok: false, code }
      throw moduleActionError(code)
    }).finally(() => {
      if (timer !== null) timers.clearTimeout(timer)
      counts[operation.status === 'succeeded' ? 'completed' : 'failed'] += 1; stamp()
      operation.phase = 'done'; operation.completedAt = now(); operation.updatedAt = now()
      observePersist()
      for (const id of closure) if (reservations.get(id) === operation.id) reservations.delete(id)
      completions.delete(operation.id)
    })
    completions.set(operation.id, completion)
    completion.catch(() => {})
    return { ok: true, operation: snapshot(operation) }
  }
  function submit(value, max) {
    try { return submitInternal(value, max) } catch (error) { counts.rejected += 1; stamp(); throw error }
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
    const accepted = submit({ moduleId, actionId, expectedGeneration: record?.runtimeGeneration || record?.generation || null, requestId: randomUUID() }, Math.max(1, Math.min(50, Math.floor(Number(max) || 1))))
    return completions.get(accepted.operation.id)
  }
  restore()
  return Object.freeze({ catalog, submit: value => submit(value), stats: () => ({ ...counts }), getOperation, performLegacy, isReserved: id => reservations.has(id) })
}
