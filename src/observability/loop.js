// Core-only, content-free observation. Handles capture a persona; never ambient trace state.
import { randomUUID } from 'node:crypto'
import { scopedPersonaKind } from '../cognition/persona-scope.js'

export const LOOP_RUN_KIND = 'loop_run'
export const DELIVERY_RECEIPT_KIND = 'delivery_receipt'
export const LOOP_LIMITS = Object.freeze({ stages: 16, receipts: 16, unknowns: 4, bytes: 8192, records: 5000, retentionMs: 7 * 86400000 })
const stages = new Set(['detected', 'decided', 'generating', 'delivering', 'observing', 'researching', 'closed'])
const reasons = new Set(['PROCESS_RESTART', 'EXECUTION_THROW', 'COMPOSE_FAILED', 'SEND_FAILED', 'WAIT', 'SILENCE', 'LEARN_ONLY', 'COMPOSE_SKIP', 'GATED', 'EMPTY_OUTPUT', 'CANCELLED', 'MODULE_DISABLED', 'STALE_CONTEXT'])
const errors = new Set(['SEND_FAILED', 'PARTIAL_SEND', 'EMPTY_MESSAGE', 'INVALID_TARGET', 'OUTBOUND_UNAVAILABLE', 'GATEWAY_UNAVAILABLE', 'ACCESS_DENIED', 'RATE_LIMITED', 'LEAK_BLOCKED'])
const statuses = new Set(['sent', 'partial', 'failed', 'dry_run', 'empty'])
// Only trusted internal references enter here; never pass platform IDs or source text.
const ref = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(value) ? value : null
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0
const code = value => reasons.has(value) ? value : null
const id = prefix => `${prefix}_${randomUUID()}`
const only = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).every(key => keys.includes(key) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))

// Also isolates injected/broken observers at each business boundary.
export function observeLoop(observer, method, ...args) {
  try { return observer?.[method]?.(...args) ?? null } catch { return null }
}

// DeliveryData projection happens before crossing the observer boundary. Raw
// results, platform message IDs, gateway errors and reason strings never enter it.
export function deliveryObservation(result) {
  if (!statuses.has(result?.status) || !Number.isSafeInteger(result?.parts) || result.parts < 0) return null
  return {
    status: statuses.has(result?.status) ? result.status : null,
    parts: count(result?.parts),
    failedPart: Number.isSafeInteger(result?.failedPart) && result.failedPart >= 0 ? result.failedPart : null,
    errorCode: errors.has(result?.error) ? result.error : result?.error ? 'SEND_FAILED' : null,
  }
}

/**
 * LoopRun v1: ADR-019 Loop + bounded stages/receiptRefs/unknownRefs.
 * DeliveryReceipt v1: ADR-019 delivery Receipt + lifecycle status/completedAt/
 * reasonCode and module attribution. Pending/interrupted data is null (unknown).
 * Direct attempts have loopId:null; no synthetic turn, decision or loop.
 * Physical record kinds are separate from logical kind (store reserves `kind`).
 */
export function createLoopObserver({ base, getPersonaId = () => 'self', clock = { now: Date.now } } = {}) {
  const failures = {}
  const handles = new WeakMap()
  const indexes = new Map()
  const now = () => {
    const value = clock.now()
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('OBSERVATION_CLOCK_INVALID')
    return value
  }
  const kind = (personaId, name) => scopedPersonaKind(personaId, name)
  const read = (personaId, name, key) => {
    const row = base.get(kind(personaId, name), key)
    if (!row) return null
    const { kind: storageKind, loopKind, receiptKind, ...rest } = row
    return { ...rest, kind: name === LOOP_RUN_KIND ? loopKind : receiptKind }
  }
  function write(personaId, name, row) {
    if (Buffer.byteLength(JSON.stringify(row)) > LOOP_LIMITS.bytes) return false
    const { kind: logicalKind, ...rest } = row
    base.put(kind(personaId, name), row.id, { ...rest, [name === LOOP_RUN_KIND ? 'loopKind' : 'receiptKind']: logicalKind }, { createdAt: row.createdAt ?? row.startedAt ?? row.recordedAt })
    return true
  }
  function remove(personaId, name, key) {
    base.remove(kind(personaId, name), key)
    indexes.get(personaId)?.[name].delete(key)
  }
  function prune(personaId, reserve = 0) {
    const index = indexes.get(personaId)
    const cutoff = now() - LOOP_LIMITS.retentionMs
    const dropLoop = key => {
      remove(personaId, LOOP_RUN_KIND, key)
      for (const [receiptId, receipt] of index[DELIVERY_RECEIPT_KIND]) if (receipt.loopId === key) remove(personaId, DELIVERY_RECEIPT_KIND, receiptId)
    }
    for (const [key, row] of index[LOOP_RUN_KIND]) if (row.at < cutoff) dropLoop(key)
    for (const [key, row] of index[DELIVERY_RECEIPT_KIND]) if (row.at < cutoff || (row.loopId && !index[LOOP_RUN_KIND].has(row.loopId))) remove(personaId, DELIVERY_RECEIPT_KIND, key)
    while (index[LOOP_RUN_KIND].size + index[DELIVERY_RECEIPT_KIND].size > LOOP_LIMITS.records - reserve) {
      const loop = index[LOOP_RUN_KIND].entries().next().value
      const receipt = index[DELIVERY_RECEIPT_KIND].entries().next().value
      if (loop && (!receipt || loop[1].at <= receipt[1].at || receipt[1].loopId)) dropLoop(loop[0])
      else remove(personaId, DELIVERY_RECEIPT_KIND, receipt[0])
    }
  }
  function initialize(personaId) {
    if (indexes.has(personaId)) return
    const index = { [LOOP_RUN_KIND]: new Map(), [DELIVERY_RECEIPT_KIND]: new Map(), existed: Boolean(base.get('persona', personaId)) }
    indexes.set(personaId, index)
    // Existing records are bounded by this owner; one startup scan, then incremental indexes.
    for (const name of [LOOP_RUN_KIND, DELIVERY_RECEIPT_KIND]) {
      for (const row of base.list(kind(personaId, name), { limit: 1000000, order: 'asc' })) {
        index[name].set(row.id, { at: name === LOOP_RUN_KIND ? row.startedAt : row.createdAt, loopId: row.loopId })
        if (row.status === 'running') {
          const current = read(personaId, name, row.id)
          write(personaId, name, { ...current, status: 'interrupted', ...(name === LOOP_RUN_KIND ? { stage: 'closed' } : {}), reasonCode: 'PROCESS_RESTART', updatedAt: now(), completedAt: now() })
        }
      }
    }
    prune(personaId)
  }
  function captured(token, type) {
    const handle = token && handles.get(token)
    if (!handle || handle.type !== type) return null
    const index = indexes.get(handle.personaId)
    if (index.existed && !base.get('persona', handle.personaId)) return null
    prune(handle.personaId)
    return read(handle.personaId, type === 'loop' ? LOOP_RUN_KIND : DELIVERY_RECEIPT_KIND, handle.id) ? handle : null
  }
  function token(type, personaId, key) {
    const value = Object.freeze({})
    handles.set(value, { type, personaId, id: key })
    return value
  }
  function begin(input = {}) {
    if (!only(input, ['kind', 'turnId', 'taskId', 'unknownId', 'firstDetectedTurnId', 'moduleId', 'runtimeGeneration'])) return null
    const personaId = ref(getPersonaId())
    if (!personaId) return null
    initialize(personaId)
    const time = now(), key = id('loop')
    const row = {
      version: 1, id: key, personaId, kind: ['social', 'proactivity', 'research'].includes(input.kind) ? input.kind : 'social',
      status: 'running', stage: 'detected', turnId: ref(input.turnId), decisionId: null,
      unknownId: ref(input.unknownId), taskId: ref(input.taskId), firstDetectedTurnId: ref(input.firstDetectedTurnId),
      moduleId: ref(input.moduleId), runtimeGeneration: ref(input.runtimeGeneration),
      startedAt: time, updatedAt: time, completedAt: null, reasonCode: null,
      stages: [{ stage: 'detected', at: time }], receiptRefs: [], unknownRefs: [],
    }
    if (!write(personaId, LOOP_RUN_KIND, row)) return null
    indexes.get(personaId)[LOOP_RUN_KIND].set(key, { at: time })
    prune(personaId)
    return token('loop', personaId, key)
  }
  function recordStage(loop, stage, input = {}) {
    if (!only(input, ['decisionId', 'unknownRefs'])) return null
    const h = captured(loop, 'loop')
    if (!h || !stages.has(stage)) return
    const row = read(h.personaId, LOOP_RUN_KIND, h.id)
    if (row.status !== 'running') return
    const time = now()
    const samePersona = ref(getPersonaId()) === h.personaId
    const unknownRefs = [...new Set([...row.unknownRefs, ...(samePersona && Array.isArray(input.unknownRefs) ? input.unknownRefs.slice(0, LOOP_LIMITS.unknowns).map(ref).filter(Boolean) : [])])].slice(0, LOOP_LIMITS.unknowns)
    write(h.personaId, LOOP_RUN_KIND, { ...row, stage, updatedAt: time,
      decisionId: row.decisionId || (samePersona ? ref(input.decisionId) : null), unknownRefs, unknownId: unknownRefs[0] || null,
      stages: [...row.stages, { stage, at: time }].slice(-LOOP_LIMITS.stages),
    })
  }
  function beginDelivery(loop = null, input = {}) {
    if (!only(input, ['turnId', 'decisionId', 'moduleId', 'runtimeGeneration'])) return null
    const parent = loop ? captured(loop, 'loop') : null
    if (loop && !parent) return null // Evicted parents never recreate history.
    const personaId = parent?.personaId || ref(getPersonaId())
    if (!personaId) return null
    initialize(personaId)
    const row = parent ? read(personaId, LOOP_RUN_KIND, parent.id) : null
    if (row && (row.status !== 'running' || row.receiptRefs.length >= LOOP_LIMITS.receipts)) return null
    const time = now(), key = id('receipt')
    const receipt = {
      version: 1, id: key, loopId: parent?.id || null, personaId, kind: 'delivery',
      turnId: row?.turnId || ref(input.turnId), decisionId: row?.decisionId || (ref(getPersonaId()) === personaId ? ref(input.decisionId) : null), taskId: row?.taskId || null,
      moduleId: row?.moduleId || ref(input.moduleId), runtimeGeneration: row?.runtimeGeneration || ref(input.runtimeGeneration),
      attemptId: id('attempt'), eventId: id('event'), occurredAt: time, recordedAt: time,
      status: 'running', completedAt: null, reasonCode: null, attemptedParts: null, data: null,
    }
    if (!write(personaId, DELIVERY_RECEIPT_KIND, receipt)) return null
    indexes.get(personaId)[DELIVERY_RECEIPT_KIND].set(key, { at: time, loopId: receipt.loopId })
    if (row) write(personaId, LOOP_RUN_KIND, { ...row, receiptRefs: [...row.receiptRefs, key] })
    prune(personaId)
    return token('delivery', personaId, key)
  }
  function finishDelivery(attempt, result, { threw = false, attemptedParts = null } = {}) {
    if (!threw && (!only(result, ['status', 'parts', 'failedPart', 'errorCode'])
      || !statuses.has(result.status) || !Number.isSafeInteger(result.parts) || result.parts < 0
      || !(result.failedPart == null || (Number.isSafeInteger(result.failedPart) && result.failedPart >= 0))
      || !(result.errorCode == null || errors.has(result.errorCode)))) return null
    const h = captured(attempt, 'delivery')
    if (!h) return
    const row = read(h.personaId, DELIVERY_RECEIPT_KIND, h.id)
    if (row.status !== 'running') return // One final result per admitted attempt.
    const data = !threw && statuses.has(result?.status) ? {
      status: result.status, parts: count(result.parts),
      failedPart: Number.isSafeInteger(result.failedPart) && result.failedPart >= 0 ? result.failedPart : null,
      errorCode: errors.has(result.errorCode) ? result.errorCode : result.errorCode ? 'SEND_FAILED' : null,
    } : null
    const time = now()
    write(h.personaId, DELIVERY_RECEIPT_KIND, { ...row, occurredAt: time, recordedAt: time, completedAt: time,
      status: data ? 'completed' : 'interrupted', reasonCode: data ? null : 'EXECUTION_THROW', attemptedParts: Number.isSafeInteger(attemptedParts) && attemptedParts >= 0 ? attemptedParts : null, data })
  }
  function finishLoop(loop, { status = 'completed', reasonCode = null } = {}) {
    const h = captured(loop, 'loop')
    if (!h) return
    const row = read(h.personaId, LOOP_RUN_KIND, h.id)
    if (row.status !== 'running') return
    write(h.personaId, LOOP_RUN_KIND, { ...row, status: ['completed', 'failed', 'interrupted'].includes(status) ? status : 'completed',
      stage: 'closed', reasonCode: code(reasonCode), updatedAt: now(), completedAt: now(),
      stages: [...row.stages, { stage: 'closed', at: now() }].slice(-LOOP_LIMITS.stages) })
  }
  // Read-only retention view: never initialize, recover or prune from a GET.
  function retained() {
    const personaId = ref(getPersonaId()), cutoff = now() - LOOP_LIMITS.retentionMs
    const loops = base.list(kind(personaId, LOOP_RUN_KIND), { limit: LOOP_LIMITS.records, since: cutoff })
      .filter(row => row.startedAt >= cutoff).map(row => read(personaId, LOOP_RUN_KIND, row.id))
    const parents = new Set(loops.map(row => row.id))
    const receipts = base.list(kind(personaId, DELIVERY_RECEIPT_KIND), { limit: LOOP_LIMITS.records, since: cutoff })
      .filter(row => !row.loopId || parents.has(row.loopId)).map(row => read(personaId, DELIVERY_RECEIPT_KIND, row.id))
    return { personaId, loops, receipts }
  }
  function appendReceipt(personaId, parent, receiptKind, data, eventId = id('event')) {
    if (!parent || parent.receiptRefs.length >= LOOP_LIMITS.receipts) throw Error('FEEDBACK_OBSERVATION_UNAVAILABLE')
    const time = now(), key = id('receipt')
    const row = { version: 1, id: key, personaId, loopId: parent.id, kind: receiptKind,
      turnId: parent.turnId, decisionId: parent.decisionId, taskId: parent.taskId,
      moduleId: parent.moduleId, runtimeGeneration: parent.runtimeGeneration,
      attemptId: parent.id, eventId, occurredAt: time, recordedAt: time,
      status: 'completed', completedAt: time, reasonCode: null, data }
    if (!write(personaId, DELIVERY_RECEIPT_KIND, row)
      || !write(personaId, LOOP_RUN_KIND, { ...parent, receiptRefs: [...parent.receiptRefs, key] })) throw Error('FEEDBACK_OBSERVATION_UNAVAILABLE')
    return row
  }
  function indexReceipt(row) {
    indexes.get(row.personaId)?.[DELIVERY_RECEIPT_KIND].set(row.id, { at: row.recordedAt, loopId: row.loopId })
  }
  // Strict owner boundary: callback, outcome, policy and receipt share the SAME
  // synchronous transaction. Unlike best-effort execution observation, failures propagate.
  function commitFeedback(decisionId, commit) {
    if (base.atomicTransactions !== true) throw Error('FEEDBACK_ATOMICITY_UNAVAILABLE')
    let receipt
    try {
      // Reserve capacity before the feedback transaction; never accept a trial
      // whose parent/evidence was evicted by that reservation.
      const personaId = ref(getPersonaId())
      if (!indexes.has(personaId)) throw Error('FEEDBACK_DELIVERY_UNOBSERVED')
      prune(personaId, 1)
      const result = base.tx(() => {
        const view = retained()
        const delivery = view.receipts.find(r => r.decisionId === decisionId && r.loopId
          && r.status === 'completed' && r.kind === 'delivery' && r.data?.parts > 0
          && ['sent', 'partial', 'dry_run'].includes(r.data?.status))
        const parent = delivery && view.loops.find(r => r.id === delivery.loopId && r.decisionId === decisionId)
        if (!parent) throw Error('FEEDBACK_DELIVERY_UNOBSERVED')
        const result = commit()
        if (result.duplicate) return result.outcome
        receipt = appendReceipt(view.personaId, parent, 'feedback', result.data, result.data.sourceEventId)
        return result.outcome
      })
      if (receipt) indexReceipt(receipt)
      return result
    } catch (error) {
      failures.feedback = Math.min(Number.MAX_SAFE_INTEGER, (failures.feedback || 0) + 1)
      const known = ['FEEDBACK_DELIVERY_UNOBSERVED', 'FEEDBACK_DECISION_NOT_FOUND', 'FEEDBACK_OBSERVATION_UNAVAILABLE']
      throw Error(known.includes(error?.message) ? error.message : 'FEEDBACK_COMMIT_FAILED')
    }
  }
  function research(loop, input) {
    if (!only(input, ['status', 'unknownId', 'firstDetectedTurnId', 'evidenceCount', 'claimId', 'errorCode'])
      || !['running', 'completed', 'failed', 'cancelled', 'interrupted'].includes(input.status)) return null
    const h = captured(loop, 'loop')
    if (!h) return null
    let receipt
    base.tx(() => {
      const parent = read(h.personaId, LOOP_RUN_KIND, h.id)
      if (parent.status !== 'running') return
      receipt = appendReceipt(h.personaId, parent, 'research', {
        status: input.status, unknownId: ref(input.unknownId), firstDetectedTurnId: ref(input.firstDetectedTurnId),
        evidenceCount: count(input.evidenceCount), claimId: ref(input.claimId),
        errorCode: ['RESEARCH_FAILED', 'SOURCE_DISABLED', 'NO_EVIDENCE'].includes(input.errorCode) ? input.errorCode : null,
      })
    })
    if (receipt) { indexReceipt(receipt); prune(receipt.personaId) }
  }
  const api = { begin, recordStage, beginDelivery, finishDelivery, finishLoop, initialize, research }
  const safe = Object.fromEntries(Object.entries(api).map(([name, fn]) => [name, (...args) => { try { return fn(...args) } catch { failures[name] = Math.min(Number.MAX_SAFE_INTEGER, (failures[name] || 0) + 1); return null } }]))
  // Recover every persisted persona before services admit work, never during a GET.
  try { for (const persona of base.list('persona', { limit: 1000000 })) safe.initialize(persona.id) } catch {}
  return Object.freeze({ ...safe, retained, commitFeedback, ownsFeedbackStore: store => (store?.base || store) === base, failures: () => ({ ...failures }) })
}
