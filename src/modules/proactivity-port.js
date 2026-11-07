// Host-only bridge: tokens capture a persona and this runtime's assertActive closure.
import { normalizeConfig } from '../core/config.js'
import { createPersonaScopedStore } from '../cognition/persona-scope.js'
import { createMemoryService } from '../cognition/memory.js'
import { createPolicyService } from '../cognition/policy.js'
import { uid } from '../cognition/util.js'

const targetValid = value => /^[1-9]\d*$/.test(String(value || '')) && Number.isSafeInteger(Number(value))
const dimension = value => Number.isFinite(Number(value)) ? Number(value) : 0
const safeReasons = new Set(['ACCESS_DENIED', 'RATE_LIMITED', 'LEAK_BLOCKED', 'GATEWAY_UNAVAILABLE', 'OUTBOUND_UNAVAILABLE', 'BUDGET_EXHAUSTED', 'LLM_ROUTE_UNAVAILABLE'])
const failure = reason => ({ ok: false, reason })

export function createProactivityPort({ getConfig, store, services = {}, delivery, outbound, getState = () => ({}), assertActive = () => {}, clock = { now: () => getState().now ?? Date.now() }, memoryFactory = createMemoryService } = {}) {
  const runs = new WeakMap()
  let current = null
  const state = () => {
    assertActive()
    const c = getConfig?.()?.cognition || {}
    const core = getState()
    return { ready: core.ready === true, enabled: core.enabled ?? c.enabled === true, paused: Boolean(core.paused || c.paused) }
  }
  const dailyCount = bound => bound?.count('decision', item => item.action === 'proactive' && item.createdAt >= clock.now() - 86400000) || 0
  function snapshot() {
    const s = state()
    return { ...s, now: clock.now(), dailyCount: s.ready ? dailyCount(store) : 0 }
  }
  function checked(token) {
    const s = state()
    const run = token && runs.get(token)
    if (!run || run.released || !s.ready || store.currentPersonaId() !== run.personaId || services.persona?.scopeGeneration?.() !== run.scopeGeneration) throw new Error('RUN_CANCELLED')
    if (!s.enabled || s.paused || !normalizeConfig({ cognition: { proactivity: getConfig?.()?.cognition?.proactivity } }).config.cognition.proactivity.enabled) throw new Error('RUN_CANCELLED')
    return run
  }
  function begin() {
    const s = state()
    if (!s.ready || !store?.base || !s.enabled || s.paused) throw new Error('RUN_CANCELLED')
    if (current) throw new Error('RUN_BUSY')
    const personaId = store.currentPersonaId()
    const bound = createPersonaScopedStore({ base: store.base, getPersonaId: () => personaId })
    const token = Object.freeze({})
    runs.set(token, { personaId, scopeGeneration: services.persona?.scopeGeneration?.(), bound, candidates: new Map(), selected: null, completed: false, consumed: false, released: false, text: '' })
    current = token
    return token
  }
  function candidates(token) {
    const run = checked(token)
    // Query exact private scope directly: relationship.list also filters scopeId when omitted.
    const rows = run.bound.list('relationship', { limit: 1000, where: item => item.scopeType === 'private' && targetValid(item.scopeId) })
    run.candidates.clear()
    for (const row of rows.slice(0, 1000)) {
      if (row.scopeType !== 'private' || !targetValid(row.scopeId) || typeof row.personId !== 'string' || !row.personId || !run.bound.get('person', row.personId)) continue
      const candidate = { id: row.id, personId: row.personId, scopeId: String(row.scopeId), lastInteractionAt: dimension(row.lastInteractionAt) }
      if (typeof candidate.id !== 'string' || !candidate.id || candidate.id.length > 256) continue
      for (const key of ['familiarity', 'affinity', 'trust', 'intimacy', 'initiative']) candidate[key] = dimension(row[key])
      run.candidates.set(candidate.id, Object.freeze(candidate))
    }
    return [...run.candidates.values()].map(item => ({ ...item }))
  }
  async function context(token, candidateId) {
    const run = checked(token)
    const candidate = run.candidates.get(candidateId)
    if (!candidate || run.selected) return null
    run.selected = candidate
    const person = run.bound.get('person', candidate.personId)
    if (!person) return null
    // Guard even memory reinforcement against stop/switch during asynchronous retrieval.
    const guarded = Object.fromEntries(['get', 'put', 'list', 'search', 'tx', 'currentPersonaId'].map(name => [name, (...args) => { checked(token); return run.bound[name](...args) }]))
    const memory = memoryFactory({ store: guarded, getConfig, clock })
    const memories = await memory.retrieveAsync({ query: '', personId: candidate.personId, scope: { scopeType: 'private', scopeId: candidate.scopeId }, emotion: services.emotion?.get?.() || {}, relationship: candidate, limit: 4 })
    checked(token)
    const style = services.persona?.get?.()?.style || {}
    return {
      displayName: String(person.displayName || '对方').slice(0, 160),
      memories: memories.filter(item => {
        const m = item?.memory
        return m && (!m.personId || m.personId === candidate.personId) && (m.scopeType === 'global' || (m.scopeType === 'private' && String(m.scopeId) === candidate.scopeId))
      }).slice(0, 4).map(item => String(item.memory.summary || item.memory.content || '').slice(0, 160)),
      style: Object.fromEntries(['formality', 'warmth', 'verbosity'].map(key => [key, dimension(style[key])])),
    }
  }
  async function complete(token, { system, user } = {}) {
    const run = checked(token)
    if (!run.selected || run.completed || typeof system !== 'string' || typeof user !== 'string' || system.length > 4000 || user.length > 8000) return failure('INVALID_REQUEST')
    run.completed = true
    let result
    try {
      result = await services.llm?.complete({ system, user, purpose: 'proactive', maxTokens: 220, temperature: 0.8, chat: { chatType: 'private', chatId: run.selected.scopeId } })
    } catch { checked(token); return failure('LLM_FAILED') }
    checked(token)
    if (!result?.ok) return failure(safeReasons.has(result?.error) ? result.error : 'LLM_FAILED')
    run.text = String(result.text || '').trim().slice(0, 4000)
    return run.text ? { ok: true } : failure('no_text')
  }
  async function send(token) {
    const run = checked(token)
    if (run.consumed || !run.text || !run.selected) return failure('INVALID_RUN')
    run.consumed = true // Consume synchronously, before delivery or any await, including failures.
    const rel = run.selected
    const now = clock.now()
    const decision = {
      id: uid('decision'), turnId: '', chatType: 'private', chatId: rel.scopeId, personId: rel.personId,
      action: 'proactive', contextKey: 'proactive:private', candidates: [],
      features: { familiarity: rel.familiarity, affinity: rel.affinity, initiative: rel.initiative },
      expectedUtility: 0.5, confidence: 0.5, reason: '主动发起：关系允许且无近期互动',
      status: 'pending', createdAt: now, updatedAt: now, atHour: Math.floor(now / 3600000),
    }
    checked(token)
    run.bound.put('decision', decision.id, decision)
    // Outbound rate checks stay core-owned; only decision receipts use the captured store.
    const decisionPolicy = createPolicyService({ store: run.bound, getConfig, clock })
    let result
    try {
      const sender = delivery?.deliver ? delivery : outbound
      result = await sender?.deliver({ chatType: 'private', chatId: rel.scopeId, segments: [{ type: 'text', data: { text: run.text } }], decisionId: decision.id, source: 'proactivity', dryRun: getConfig?.()?.cognition?.dryRun ? true : null, decisionPolicy })
    } catch { result = null }
    // An admitted send can finish after stop/switch, always in the captured persona.
    if (!result?.ok) {
      const reason = safeReasons.has(result?.error) ? result.error : 'SEND_FAILED'
      decisionPolicy.markFailed(decision.id, reason)
      return { ok: false, reason, blocked: result?.blocked === true, decisionId: decision.id }
    }
    const messageId = String(result.messageId || '').slice(0, 128)
    const dryRun = result.dryRun === true
    decisionPolicy.markSent(decision.id, { messageId, dryRun })
    run.bound.put('proactive_intent', uid('proactive'), { personId: rel.personId, chatId: rel.scopeId, decisionId: decision.id, text: run.text, messageId, dryRun, at: clock.now() })
    return { ok: true, decisionId: decision.id, dryRun }
  }
  function release(token) {
    const run = token && runs.get(token)
    if (run) { run.released = true; runs.delete(token) }
    if (current === token) current = null
  }
  return Object.freeze({ snapshot, begin, candidates, context, complete, send, release })
}
