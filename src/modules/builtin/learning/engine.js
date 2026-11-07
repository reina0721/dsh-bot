import { reportEngine } from '../../health.js'
// Learning policy and orchestration; core owns all records, external content and model calls.
export function createLearningEngine({ port, getConfig, scheduler, health } = {}) {
  let active = false, timer = null, generation = 0, unsubscribe = null, flight = null, currentLease = null
  const state = { lastError: '', completed: 0 }
  const live = epoch => active && epoch === generation
  async function runTask(task, { mode = 'manual', epoch = generation } = {}) {
    if (!live(epoch)) return { ok: false, reason: 'MODULE_DISABLED' }
    let lease
    try {
      const attempt = port.claim({ ...task, mode })
      if (!attempt) return null
      lease = attempt.lease; currentLease = lease
      const refs = []
      for (const { sourceRef } of port.sources({ lease })) {
        if (!live(epoch)) return { ok: false, reason: 'MODULE_DISABLED' }
        refs.push(...await port.collectFromSource({ lease, sourceRef, query: attempt.query, maxResults: Math.min(3, Math.max(1, Number(getConfig().maxSources ?? 5))) }))
        if (refs.length >= 8) break
      }
      if (!live(epoch)) return { ok: false, reason: 'MODULE_DISABLED' }
      if (!refs.length) return port.fail({ lease, error: 'no_evidence' })
      const claim = await port.extractClaim({ lease, evidenceRefs: refs })
      if (!live(epoch)) return { ok: false, reason: 'MODULE_DISABLED' }
      const result = port.complete({ lease, ...claim })
      state.completed++; state.lastError = ''
      return result
    } catch (error) {
      state.lastError = live(epoch) ? 'RESEARCH_FAILED' : 'MODULE_DISABLED'
      if (lease && live(epoch)) { try { return port.fail({ lease, error: error.message }) } catch {} }
      return { ok: false, reason: state.lastError }
    } finally {
      if (lease) port.release({ lease })
      if (currentLease === lease) currentLease = null
    }
  }
  function runPending({ max = 1, automatic = false } = {}) {
    if (!active) return Promise.resolve({ ok: false, reason: 'MODULE_DISABLED' })
    if (flight) return Promise.resolve({ ok: false, reason: 'busy' })
    const epoch = generation
    // Defer work so even synchronous failures are inside the shared single-flight.
    const work = Promise.resolve().then(async () => {
      reportEngine(health, 'started')
      const config = getConfig()
      if (!config.enabled || (automatic && !config.autoResearch)) { reportEngine(health, 'skipped', 'BUSINESS_DISABLED'); return [] }
      const tasks = port.pending({ limit: automatic ? 1 : Math.max(1, Math.min(50, Number(max) || 1)) })
      const results = []
      for (const task of tasks) {
        if (!live(epoch)) break
        results.push(await runTask(task, { mode: automatic ? 'auto' : 'manual', epoch }))
      }
      if (!live(epoch)) return results
      const failed = results.some(result => result?.ok === false)
      const completed = results.some(result => result?.ok === true)
      reportEngine(health, failed ? 'failure' : completed ? 'success' : 'skipped', failed ? 'LEARNING_RUN_FAILED' : completed ? null : 'NO_TASK')
      return results
    }).catch(() => {
      reportEngine(health, 'failure', 'LEARNING_RUN_FAILED')
      return { ok: false, reason: live(epoch) ? 'LEARNING_DISABLED' : 'MODULE_DISABLED' }
    })
    flight = work
    work.finally(() => { if (flight === work) flight = null })
    return work
  }
  function arm(delay, epoch) {
    timer = scheduler.setTimeout(async () => {
      if (!live(epoch)) return
      timer = null
      await (flight || runPending({ automatic: true }))
      if (live(epoch)) arm(60000, epoch)
    }, delay)
  }
  function start() {
    if (active) return
    active = true
    const epoch = ++generation
    unsubscribe = port.onUnknownDetected(({ unknownRef, surface }) => {
      if (!live(epoch) || !getConfig().enabled || !getConfig().autoResearch) return
      port.enqueueAuto({ unknownRef, plan: [`「${surface}」在当前语境中是什么意思？`, '来源/首次出现/常见用法是什么？', '是否存在反讽、圈层或争议用法？'] })
    })
    arm(30000, epoch)
    health?.report({ state: 'healthy', result: 'observation' })
  }
  function stop() {
    active = false; generation++
    unsubscribe?.(); unsubscribe = null
    if (timer !== null) scheduler.clearTimeout(timer.id ?? timer)
    timer = null
    if (currentLease) port.release({ lease: currentLease })
    currentLease = null
    flight = null
    // Await-free revocation: a stalled network/model call cannot block disable.
  }
  function cancel(taskId) {
    if (!active) return { ok: false, reason: 'MODULE_DISABLED' }
    return port.claim({ taskId, mode: 'cancel' })
  }
  function retry(taskId) {
    if (!active) return { ok: false, reason: 'MODULE_DISABLED' }
    return port.retry({ taskId })
  }
  return Object.freeze({ start, stop, runPending, cancel, retry, stats: () => ({ ...state, active, running: Boolean(flight) }) })
}
