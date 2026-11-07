// Core management projection. No business content or arbitrary store queries.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { LOOP_LIMITS } from './loop.js'

const ref = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(value) ? value : null
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row?.[key] ?? null]))
const counts = (rows, key, values) => Object.fromEntries(values.map(value => [value, rows.filter(row => row[key] === value).length]))
const compare = (a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)
const invalid = () => ({ ok: false, code: 'LOOP_QUERY_INVALID' })
const notFound = () => ({ ok: false, code: 'LOOP_NOT_FOUND' })
const loopKeys = ['version', 'id', 'personaId', 'kind', 'status', 'stage', 'turnId', 'decisionId', 'unknownId', 'taskId', 'firstDetectedTurnId', 'moduleId', 'runtimeGeneration', 'startedAt', 'createdAt', 'updatedAt', 'completedAt', 'reasonCode', 'stages', 'receiptRefs', 'unknownRefs']
const receiptKeys = ['version', 'id', 'loopId', 'personaId', 'kind', 'turnId', 'decisionId', 'taskId', 'moduleId', 'runtimeGeneration', 'attemptId', 'eventId', 'occurredAt', 'recordedAt', 'status', 'completedAt', 'reasonCode', 'attemptedParts']
const dataKeys = {
  delivery: ['status', 'parts', 'failedPart', 'errorCode'],
  feedback: ['source', 'sourceEventId', 'attribution', 'attributionConfidence', 'observation', 'reward', 'outcomeId', 'policyUpdated'],
  research: ['status', 'unknownId', 'firstDetectedTurnId', 'evidenceCount', 'claimId', 'errorCode'],
}
const receiptView = row => ({ ...pick(row, receiptKeys), data: row.data && dataKeys[row.kind] ? pick(row.data, dataKeys[row.kind]) : null })
const betaView = row => row ? Object.fromEntries(['alpha', 'beta', 'trials', 'rewardSum'].map(key => [key, Number.isFinite(row[key]) ? row[key] : null])) : null
const outcomeView = row => ({ ...pick(row, ['id', 'decisionId', 'createdAt', 'reward']),
  source: ['incoming', 'reaction', 'manual', 'unknown'].includes(row.source) ? row.source : 'unknown',
  sourceEventId: ref(row.sourceEventId), attribution: ['direct', 'heuristic', 'unobserved'].includes(row.attribution) ? row.attribution : null,
  attributionConfidence: Number.isFinite(row.attributionConfidence) ? Math.max(0, Math.min(1, row.attributionConfidence)) : null,
  policyUpdated: typeof row.policyUpdated === 'boolean' ? row.policyUpdated : null, policyBefore: betaView(row.policyBefore), policyAfter: betaView(row.policyAfter) })

export function createLoopQuery({ observer, store, getGeneration = () => null, clock = { now: Date.now } }) {
  const secret = randomBytes(32)
  const sign = data => createHmac('sha256', secret).update(data).digest('base64url')
  function encode(value) {
    const data = Buffer.from(JSON.stringify(value)).toString('base64url')
    return `${data}.${sign(data)}`
  }
  function decode(value) {
    if (typeof value !== 'string' || value.length > 1024) throw Error('CURSOR_INVALID')
    const [data, mac, extra] = value.split('.')
    const expected = sign(data || '')
    if (extra || !mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw Error('CURSOR_INVALID')
    return JSON.parse(Buffer.from(data, 'base64url').toString())
  }
  function runs(query = {}) {
    if (Object.keys(query).some(key => !['limit', 'before', 'kind', 'state'].includes(key))
      || (query.kind != null && !['social', 'proactivity', 'research'].includes(query.kind))
      || (query.state != null && !['running', 'completed', 'failed', 'interrupted'].includes(query.state))
      || (query.limit != null && !/^[1-9]\d*$/.test(String(query.limit)))) return invalid()
    const limit = Math.min(200, Number(query.limit ?? 50))
    if (!Number.isSafeInteger(limit)) return invalid()
    const view = observer.retained()
    const binding = JSON.stringify([view.personaId, getGeneration(), query.kind ?? null, query.state ?? null])
    let cursor = null
    if (query.before != null) {
      try {
        cursor = decode(query.before)
        if (cursor.binding !== binding || !Number.isSafeInteger(cursor.createdAt) || !ref(cursor.id)) return invalid()
      } catch { return invalid() }
    }
    const rows = view.loops.filter(row => (!query.kind || row.kind === query.kind) && (!query.state || row.status === query.state)
      && (!cursor || compare(row, cursor) > 0)).sort(compare)
    const items = rows.slice(0, limit).map(row => pick(row, loopKeys))
    const last = items.at(-1)
    return { ok: true, items, nextBefore: rows.length > limit ? encode({ binding, createdAt: last.createdAt, id: last.id }) : null }
  }
  function researchLinks(loop) {
    const unknownIds = [...new Set([loop.unknownId, ...(loop.unknownRefs || [])].filter(ref))].slice(0, LOOP_LIMITS.unknowns)
    const unknowns = unknownIds.map(id => store.get('unknown', id)).filter(Boolean)
    const linkedTask = row => row.id === loop.taskId || unknownIds.includes(row.unknownId)
    const tasks = store.list('learning_task', { limit: 200, where: linkedTask })
    const taskIds = new Set(tasks.map(row => row.id))
    const linkedEvidence = row => taskIds.has(row.taskId)
    const evidence = store.list('learning_evidence', { limit: 200, where: linkedEvidence })
    const evidenceIds = new Set(evidence.map(row => row.id))
    const linkedClaim = row => taskIds.has(row.taskId) && tasks.some(t => t.id === row.taskId && t.claimId === row.id)
    const claims = store.list('knowledge_claim', { limit: 200, where: linkedClaim })
    return {
      unknowns: unknowns.map(row => ({ id: row.id, status: ['open', 'resolved', 'deferred', 'failed'].includes(row.status) ? row.status : 'unknown', firstDetectedTurnId: ref(row.firstDetectedTurnId) })),
      tasks: tasks.map(row => ({ id: row.id, unknownId: ref(row.unknownId), status: ['pending', 'suggested', 'running', 'done', 'failed', 'cancelled'].includes(row.status) ? row.status : 'unknown', attempts: row.attempts || 0, claimId: claims.some(c => c.id === row.claimId) ? row.claimId : null })),
      evidence: evidence.map(row => ({ id: row.id, taskId: row.taskId })),
      claims: claims.map(row => ({ id: row.id, taskId: row.taskId, status: ['active', 'disputed', 'deprecated'].includes(row.status) ? row.status : 'unknown', evidenceIds: (row.evidenceIds || []).filter(id => evidenceIds.has(id)).slice(0, 200) })),
      taskCount: store.count('learning_task', linkedTask), evidenceCount: store.count('learning_evidence', linkedEvidence), claimCount: store.count('knowledge_claim', linkedClaim),
      linksLimited: tasks.length === 200 || evidence.length === 200,
    }
  }
  function detail(query = {}) {
    if (Object.keys(query).some(key => !['id', 'decisionId'].includes(key)) || Boolean(query.id) === Boolean(query.decisionId)
      || !ref(query.id || query.decisionId)) return invalid()
    const view = observer.retained()
    const loop = view.loops.filter(row => query.id ? row.id === query.id : row.decisionId === query.decisionId).sort(compare)[0]
    if (!loop) return notFound()
    const outcomes = loop.decisionId ? store.list('outcome', { limit: 200, where: row => row.decisionId === loop.decisionId }) : []
    return { ok: true, item: pick(loop, loopKeys),
      receipts: view.receipts.filter(row => row.loopId === loop.id).sort((a, b) => a.recordedAt - b.recordedAt || a.id.localeCompare(b.id)).slice(0, 200).map(receiptView),
      feedback: outcomes.map(outcomeView), feedbackCount: loop.decisionId ? store.count('outcome', row => row.decisionId === loop.decisionId) : 0,
      research: researchLinks(loop) }
  }
  function summary() {
    const { personaId, loops, receipts } = observer.retained()
    const deliveries = receipts.filter(row => row.kind === 'delivery')
    const feedback = receipts.filter(row => row.kind === 'feedback')
    const deliveredLoops = new Set(deliveries.filter(row => row.status === 'completed' && row.data).map(row => row.loopId))
    const observedLoops = new Set(feedback.map(row => row.loopId))
    const states = (kind, values) => Object.fromEntries(values.map(state => [state, store.count(kind, row => row.status === state)]))
    return { ok: true, personaId, collectedAt: clock.now(),
      processLifetime: { observationFailures: observer.failures() },
      retained: { retentionMs: LOOP_LIMITS.retentionMs, maxRecords: LOOP_LIMITS.records, loops: loops.length, receipts: receipts.length,
        loopStates: counts(loops, 'status', ['running', 'completed', 'failed', 'interrupted']),
        stages: counts(loops, 'stage', ['detected', 'decided', 'generating', 'delivering', 'observing', 'researching', 'closed']),
        receiptKinds: counts(receipts, 'kind', ['delivery', 'feedback', 'research']),
        receiptStates: counts(receipts, 'status', ['running', 'completed', 'interrupted']),
        deliveryStates: counts(deliveries.map(row => row.data || {}), 'status', ['sent', 'partial', 'failed', 'dry_run', 'empty']),
        attemptedDeliveries: deliveries.length,
        // Count part evaluations at the execution boundary, including gates/dry-run; legacy missing counters stay unknown.
        attemptedParts: deliveries.some(row => row.attemptedParts == null) ? null : deliveries.reduce((n, row) => n + row.attemptedParts, 0),
        attemptedPartsKnown: deliveries.reduce((n, row) => n + (row.attemptedParts || 0), 0),
        sentPartsComplete: deliveries.every(row => row.data != null),
        sentParts: deliveries.reduce((n, row) => n + (row.data?.parts || 0), 0),
        coverage: { loopsWithDeliveryResult: loops.filter(row => deliveredLoops.has(row.id)).length, loopsWithoutDeliveryResult: loops.filter(row => !deliveredLoops.has(row.id)).length,
          loopsWithFeedback: loops.filter(row => observedLoops.has(row.id)).length, deliveryResultUnknown: deliveries.filter(row => !row.data).length },
        feedback: { count: feedback.length, policyCommitted: feedback.filter(row => row.data?.policyUpdated === true).length,
          rewardSum: feedback.reduce((n, row) => n + (row.data?.reward || 0), 0),
          sources: counts(feedback.map(row => row.data || {}), 'source', ['incoming', 'reaction', 'manual', 'unknown']),
          attribution: counts(feedback.map(row => row.data || {}), 'attribution', ['direct', 'heuristic', 'unobserved']) } },
      businessRecords: { scope: 'current-persona stored records; independent of loop retention',
        unknownStates: states('unknown', ['open', 'resolved', 'deferred', 'failed']),
        taskStates: states('learning_task', ['pending', 'suggested', 'running', 'done', 'failed', 'cancelled']),
        evidenceCount: store.count('learning_evidence'), claimStates: states('knowledge_claim', ['active', 'disputed', 'deprecated']),
        outcomeCount: store.count('outcome'), legacyProvenanceUnknown: store.count('outcome', row => !row.source || row.source === 'unknown') } }
  }
  const safe = fn => (...args) => { try { return fn(...args) } catch { return { ok: false, code: 'LOOP_READ_UNAVAILABLE' } } }
  return Object.freeze({ runs: safe(runs), detail: safe(detail), summary: safe(summary) })
}
