// Host-only learning service. All writes and external data stay in core.
import { observeLoop } from '../observability/loop.js'
import { createPersonaScopedStore } from '../cognition/persona-scope.js'
import { extractResearchClaim } from '../cognition/research.js'
import { hashText, uid } from '../cognition/util.js'

// Shared across runtimes: an old attempt cannot compete with a replacement runtime.
const owners = new WeakMap()
const bounded = (value, max, fallback) => Math.max(1, Math.min(max, Math.floor(Number(value) || fallback)))
const token = () => Object.freeze({})
const taskReceipt = task => task ? { id: task.id, status: task.status, version: task.version, attempts: task.attempts || 0, nextRunAt: task.nextRunAt || 0 } : null
export function createLearningPort({ getConfig, store, services = {}, getState = () => ({}), assertActive = () => {}, clock = { now: () => getState().now ?? Date.now() }, moduleId = 'builtin-learning', runtimeGeneration = null } = {}) {
  const leases = new WeakMap(), unknowns = new WeakMap()
  const cfg = () => getConfig?.()?.cognition || {}
  const observer = services.loopObserver
  function researchEvent(run, status, result = {}) {
    observeLoop(observer, 'research', run.loop, { status, unknownId: run.task.unknownId,
      firstDetectedTurnId: run.firstDetectedTurnId, evidenceCount: run.evidence.size,
      claimId: result.claimId || null, errorCode: result.error === 'no_evidence' ? 'NO_EVIDENCE' : result.error || null })
    if (status !== 'running') observeLoop(observer, 'finishLoop', run.loop, {
      status: status === 'failed' ? 'failed' : status === 'interrupted' || status === 'cancelled' ? 'interrupted' : 'completed',
      reasonCode: status === 'cancelled' ? 'CANCELLED' : status === 'interrupted' ? 'STALE_CONTEXT' : null })
  }
  const event = name => services.knowledge?.recordResearchEvent?.(name)
  const persona = () => store?.currentPersonaId?.() || 'self'
  const generation = () => services.persona?.scopeGeneration?.()
  function enabled(auto = false) {
    assertActive()
    const s = getState(), c = cfg()
    if (!s.ready || !(s.enabled ?? c.enabled) || s.paused || c.paused || !c.learning?.enabled || (auto && !c.learning.autoResearch)) throw Error('LEARNING_DISABLED')
  }
  function privateCheck(bound, task) {
    const u = bound.get('unknown', task.unknownId)
    if (cfg().privacy?.learnFromPrivate === false && [u?.scopeType, u?.chatType, task.scopeType, task.chatType].includes('private')) throw Error('PRIVATE_POLICY')
    return u
  }
  function checked(lease, { completed = false } = {}) {
    enabled()
    const run = lease && leases.get(lease)
    if (!run || run.released || persona() !== run.personaId || generation() !== run.generation) throw Error('LEASE_CANCELLED')
    const task = run.bound.get('learning_task', run.task.id)
    if (!task || task.version !== run.version || task.status !== (run.result && completed ? 'done' : 'running')) throw Error('LEASE_CANCELLED')
    if (run.mode === 'auto' && !cfg().learning.autoResearch) throw Error('LEARNING_DISABLED')
    privateCheck(run.bound, task)
    return run
  }
  function onUnknownDetected(handler) {
    assertActive()
    if (typeof handler !== 'function') throw Error('INVALID_HANDLER')
    return services.knowledge?.onUnknownDetected?.(u => {
      try {
        enabled(true)
        privateCheck(store, { unknownId: u.id })
        const unknownRef = token()
        unknowns.set(unknownRef, { id: u.id, personaId: persona(), generation: generation() })
        handler(Object.freeze({ unknownRef, surface: String(u.surface || '').slice(0, 120) }))
        // An event is an enqueue opportunity, not a retrospective capability.
        unknowns.delete(unknownRef)
      } catch {}
    }) || (() => {})
  }
  function enqueueAuto({ unknownRef, plan } = {}) {
    enabled(true)
    const ref = unknownRef && unknowns.get(unknownRef)
    if (!ref || ref.personaId !== persona() || ref.generation !== generation()) throw Error('INVALID_UNKNOWN_REF')
    unknowns.delete(unknownRef)
    if (!Array.isArray(plan) || !plan.length || plan.length > 3 || plan.some(s => typeof s !== 'string' || s.length > 256)) throw Error('INVALID_PLAN')
    return store.tx(() => {
      const u = store.get('unknown', ref.id)
      if (!u || u.status !== 'open') return null
      privateCheck(store, { unknownId: u.id })
      if (store.list('learning_task', { limit: 1, where: t => t.unknownId === u.id }).length) return null
      const id = uid('task'), now = clock.now()
      const task = { id, unknownId: u.id, surface: u.surface, plan: [...plan], status: 'pending', attempts: 0, nextRunAt: now, budgetTokens: Number(cfg().learning.dailyTokenBudget || 20000), createdAt: now, updatedAt: now, version: 1 }
      store.put('learning_task', id, task)
      event('tasks')
      return { taskId: id, expectedVersion: 1 }
    })
  }
  function pending({ limit = 1 } = {}) {
    enabled()
    return store.list('learning_task', { limit: bounded(limit, 50, 1), where: t => t.status === 'pending' && Number(t.nextRunAt || 0) <= clock.now() })
      .map(t => ({ taskId: t.id, expectedVersion: t.version || 1 }))
  }
  function claim({ taskId, expectedVersion, mode = 'manual' } = {}) {
    if (mode === 'cancel') assertActive()
    else enabled(mode === 'auto')
    if (!['manual', 'auto', 'cancel'].includes(mode) || typeof taskId !== 'string' || taskId.length > 256) throw Error('INVALID_TASK')
    const personaId = persona(), bound = store.base ? createPersonaScopedStore({ base: store.base, getPersonaId: () => personaId }) : store
    const ownerKey = store.base || store
    if (mode !== 'cancel' && owners.has(ownerKey)) throw Error('LEASE_BUSY')
    return bound.tx(() => {
      const task = bound.get('learning_task', taskId)
      if (!task || (expectedVersion !== undefined && (task.version || 1) !== expectedVersion)) return null
      // Cancellation is a repository transition, including future/suggested tasks; no attempt.
      if (mode === 'cancel') {
        const result = services.knowledge.cancel(taskId)
        const owner = owners.get(ownerKey)
        if (owner?.personaId === personaId && owner.task.id === taskId) { researchEvent(owner, 'cancelled'); release({ lease: owner.lease }) }
        return taskReceipt(result)
      }
      if (expectedVersion === undefined || !['pending', ...(mode === 'manual' ? ['suggested'] : [])].includes(task.status) || Number(task.nextRunAt || 0) > clock.now()) return null
      const unknown = privateCheck(bound, task)
      if (bound.list('learning_task', { limit: 1000, where: t => t.createdAt >= clock.now() - 3600000 }).length > Number(cfg().learning.maxTasksPerHour ?? 3) && task.status === 'pending') {
        bound.put('learning_task', task.id, { ...task, nextRunAt: clock.now() + 3600000, version: (task.version || 1) + 1 })
        return null
      }
      const lease = token(), version = (task.version || 1) + 1
      bound.put('learning_task', task.id, { ...task, status: 'running', attempts: (task.attempts || 0) + 1, startedAt: clock.now(), updatedAt: clock.now(), version })
      const run = { task, bound, personaId, generation: generation(), version, mode, ownerKey, lease, evidence: new Map(), sourceRefs: new Map(), collected: new Set(), extracting: false, draft: null, claimRef: null }
      run.firstDetectedTurnId = unknown?.firstDetectedTurnId || null
      run.loop = observeLoop(observer, 'begin', { kind: 'research', taskId: task.id, unknownId: task.unknownId, firstDetectedTurnId: unknown?.firstDetectedTurnId || null, moduleId, runtimeGeneration })
      observeLoop(observer, 'recordStage', run.loop, 'researching', { unknownRefs: [task.unknownId] })
      researchEvent(run, 'running')
      leases.set(lease, run); owners.set(ownerKey, run)
      return { lease, query: String(task.surface || task.plan?.[0] || '').slice(0, 256) }
    })
  }
  function sources({ lease } = {}) {
    const run = checked(lease)
    if (!run.sourceRefs.size) for (const source of (services.sources?.list?.() || []).slice(0, 32)) {
      if (typeof source.search === 'function') run.sourceRefs.set(token(), source)
    }
    return [...run.sourceRefs.keys()].map(sourceRef => ({ sourceRef }))
  }
  async function collectFromSource({ lease, sourceRef, query, maxResults = 3 } = {}) {
    const run = checked(lease), source = run.sourceRefs.get(sourceRef)
    const actualQuery = String(run.task.surface || run.task.plan?.[0] || '').slice(0, 256)
    if (!source || run.collected.has(sourceRef) || query !== actualQuery || run.extracting) throw Error('INVALID_SOURCE_REQUEST')
    if (!(services.sources?.list?.() || []).includes(source)) throw Error('SOURCE_DISABLED')
    run.collected.add(sourceRef) // Consume before any await, including a failed search.
    const max = Math.min(bounded(maxResults, 3, 3), bounded(cfg().learning.maxSources, 10, 5))
    let results
    try { results = await source.search(actualQuery, { maxResults: max }) } catch { checked(lease); return [] }
    checked(lease)
    const refs = []
    for (const result of (Array.isArray(results) ? results : []).slice(0, max)) {
      checked(lease)
      // A source may be switched off while a request is in flight.
      if (!(services.sources?.list?.() || []).includes(source)) throw Error('SOURCE_DISABLED')
      if (run.evidence.size >= 8) break
      let page
      try { page = await source.fetch?.(result.url) } catch {}
      checked(lease)
      if (!(services.sources?.list?.() || []).includes(source)) throw Error('SOURCE_DISABLED')
      if (run.evidence.size >= 8) break
      const text = String(page?.text || result.snippet || '').slice(0, 4000)
      if (!text) continue
      const contentHash = hashText(text), url = String(page?.url || result.url || '')
      const old = run.bound.list('learning_evidence', { limit: 1, where: e => e.taskId === run.task.id && e.sourceId === source.id && e.url === url && e.contentHash === contentHash })[0]
      const record = old || { id: uid('evidence'), taskId: run.task.id, sourceId: source.id, url, title: String(page?.title || result.title || ''), fetchedAt: clock.now(), excerpt: text.slice(0, 1200), contentHash, reliability: Number(source.reliability || 0.5), stance: 'support', createdAt: clock.now() }
      if ([...run.evidence.values()].some(e => e.id === record.id)) continue
      if (!old) run.bound.tx(() => { checked(lease); run.bound.put('learning_evidence', record.id, record) })
      const ref = token(); run.evidence.set(ref, record); refs.push(ref)
    }
    return refs
  }
  async function extractClaim({ lease, evidenceRefs } = {}) {
    const run = checked(lease)
    if (run.extracting || !Array.isArray(evidenceRefs) || !evidenceRefs.length || evidenceRefs.length > 8 || new Set(evidenceRefs).size !== evidenceRefs.length || evidenceRefs.some(ref => !run.evidence.has(ref))) throw Error('INVALID_EVIDENCE_REFS')
    run.extracting = true
    const evidence = evidenceRefs.map(ref => run.evidence.get(ref))
    run.draft = await extractResearchClaim({ task: run.task, evidence, store: run.bound, getConfig, clock, llm: services.llm, assertActive: () => checked(lease) })
    checked(lease)
    run.extracted = true
    run.claimRef = run.draft ? token() : null
    return { claimRef: run.claimRef }
  }
  function complete({ lease, claimRef } = {}) {
    const run = checked(lease, { completed: true })
    if (run.result) return run.result
    if (!run.extracted || claimRef !== run.claimRef) throw Error('INVALID_CLAIM_REF')
    let createdClaim = false
    const result = run.bound.tx(() => {
      checked(lease)
      let claim = run.draft
      const task = run.bound.get('learning_task', run.task.id)
      if (claim) {
        const prior = run.bound.list('knowledge_claim', { limit: 1, where: c => c.taskId === task.id && c.concept === claim.concept && c.claim === claim.claim && c.status === claim.status && JSON.stringify([...(c.evidenceIds || [])].sort()) === JSON.stringify([...claim.evidenceIds].sort()) })[0]
        if (prior) claim = prior
        else { run.bound.put('knowledge_claim', claim.id, claim); createdClaim = true }
        const u = run.bound.get('unknown', task.unknownId)
        if (u) run.bound.put('unknown', u.id, { ...u, status: 'resolved', claimId: claim.id, updatedAt: clock.now(), version: (u.version || 1) + 1 })
      }
      run.bound.put('learning_task', task.id, { ...task, status: 'done', finishedAt: clock.now(), evidenceCount: run.evidence.size, claimId: claim?.id || '', updatedAt: clock.now() })
      return Object.freeze({ ok: true, taskId: task.id, claimId: claim?.id || '', evidenceCount: run.evidence.size })
    })
    run.result = result; researchEvent(run, 'completed', result); event('done'); if (createdClaim) event('claims')
    return result
  }
  function fail({ lease, error } = {}) {
    const run = checked(lease)
    const safe = ['no_evidence', 'SOURCE_DISABLED'].includes(error) ? error : 'RESEARCH_FAILED'
    run.bound.tx(() => {
      checked(lease)
      const task = run.bound.get('learning_task', run.task.id)
      run.bound.put('learning_task', task.id, { ...task, status: 'failed', error: safe, updatedAt: clock.now(), version: task.version + 1 })
    })
    researchEvent(run, 'failed', { error: safe })
    event('failed')
    return { ok: false, error: safe }
  }
  function release({ lease } = {}) {
    const run = lease && leases.get(lease)
    if (!run || run.released) return
    run.released = true
    if (owners.get(run.ownerKey) === run) owners.delete(run.ownerKey)
    // Stop is synchronous; revoke first, then leave interrupted tasks pending in the captured persona.
    const task = run.bound.get('learning_task', run.task.id)
    if (task?.status === 'running' && task.version === run.version) {
      run.bound.tx(() => run.bound.put('learning_task', task.id, { ...task, status: 'pending', updatedAt: clock.now(), version: task.version + 1 }))
      researchEvent(run, 'interrupted')
    }
  }
  function retry({ taskId } = {}) {
    assertActive()
    const owner = owners.get(store.base || store)
    if (owner?.task.id === taskId) throw Error('LEASE_BUSY')
    if (typeof taskId !== 'string' || taskId.length > 256) throw Error('INVALID_TASK')
    return taskReceipt(services.knowledge.retry(taskId))
  }
  return Object.freeze({ onUnknownDetected, enqueueAuto, pending, claim, sources, collectFromSource, extractClaim, complete, fail, release, retry })
}
