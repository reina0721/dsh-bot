import { reportEngine } from '../../health.js'
// Policy, prompts and timing belong to the module; state, model and sends use a narrow port.
export function isQuietHour(hour, start, end) {
  const s = Number(start), e = Number(end)
  if (!Number.isFinite(s) || !Number.isFinite(e) || s === e) return false
  return s < e ? hour >= s && hour < e : hour >= s || hour < e
}

export function createProactivityEngine({ port, getConfig, scheduler, health } = {}) {
  let active = false, timer = null, generation = 0, running = false, token = null, sendWork = null
  const state = { lastTickAt: 0, lastError: '', sent: 0, skipped: 0 }
  async function tick() {
    if (!active) return { ok: false, reason: 'MODULE_DISABLED' }
    if (running) return { ok: false, reason: 'busy' }
    running = true
    reportEngine(health, 'started')
    const epoch = generation
    let run = null
    try {
      const p = getConfig()
      const s = port.snapshot()
      state.lastTickAt = s.now
      const skip = reason => {
        state.skipped++
        const code = { disabled: 'BUSINESS_DISABLED', quiet_hours: 'QUIET_HOURS', daily_budget: 'BUDGET_EXHAUSTED', BUDGET_EXHAUSTED: 'BUDGET_EXHAUSTED', no_candidate: 'NO_CANDIDATE', no_person: 'NO_CANDIDATE', backoff: 'BACKOFF', MODULE_DISABLED: 'MODULE_DISABLED' }[reason]
        reportEngine(health, code ? 'skipped' : 'failure', code || 'PROACTIVITY_RUN_FAILED')
        return { ok: false, reason }
      }
      if (!p.enabled || !s.ready || !s.enabled || s.paused) return skip('disabled')
      if (isQuietHour(new Date(s.now).getHours(), p.quietStart, p.quietEnd)) return skip('quiet_hours')
      if (s.dailyCount >= Number(p.maxPrivatePerDay ?? 1)) return skip('daily_budget')
      run = port.begin()
      token = run
      const candidates = port.candidates(run).filter(item => item.familiarity >= Number(p.minFamiliarity ?? 0.5))
        .sort((a, b) => (b.initiative + b.affinity) - (a.initiative + a.affinity))
      if (!candidates.length) return skip('no_candidate')
      const rel = candidates[0]
      if (rel.lastInteractionAt && s.now - rel.lastInteractionAt < Number(p.backoffHours ?? 24) * 3600000) return skip('backoff')
      const context = await port.context(run, rel.id)
      if (!active || epoch !== generation) return skip('MODULE_DISABLED')
      if (!context) return skip('no_person')
      const system = [
        '你在为一段持续的私聊主动发起一句话。',
        '只输出一条可直接发送的短文本，不要解释、不要提 AI/系统/记忆库。',
        '自然、短、具体；不质问对方为什么没回；不制造压力；不编造未提供的事实。',
        '如果最近记忆不足，就只做轻量问候/关心。',
      ].join('\n')
      const user = [
        `对方：${context.displayName || '对方'}`,
        `关系：熟悉 ${rel.familiarity}, 好感 ${rel.affinity}, 信任 ${rel.trust}, 亲密 ${rel.intimacy}`,
        `最近记忆：${context.memories.join('；') || '(无)'}`,
        `当前人格风格：正式度 ${context.style.formality}, 温暖 ${context.style.warmth}, 话痨 ${context.style.verbosity}`,
      ].join('\n')
      const completion = await port.complete(run, { system, user })
      if (!active || epoch !== generation) return skip('MODULE_DISABLED')
      if (!completion.ok) { state.lastError = completion.reason; return skip(completion.reason) }
      sendWork = port.send(run)
      const result = await sendWork
      if (result.ok) { state.sent++; state.lastError = '' } else state.lastError = result.reason
      reportEngine(health, result.ok ? 'success' : result.reason === 'BUDGET_EXHAUSTED' ? 'skipped' : 'failure', result.ok ? null : result.reason === 'BUDGET_EXHAUSTED' ? 'BUDGET_EXHAUSTED' : 'PROACTIVITY_RUN_FAILED')
      return result
    } catch {
      state.skipped++
      reportEngine(health, 'failure', 'PROACTIVITY_RUN_FAILED')
      return { ok: false, reason: active && epoch === generation ? 'RUN_CANCELLED' : 'MODULE_DISABLED' }
    } finally {
      if (run) port.release(run)
      if (token === run) token = null
      sendWork = null
      running = false
    }
  }
  function arm(delay, epoch) {
    timer = scheduler.setTimeout(async () => {
      if (!active || epoch !== generation) return
      timer = null
      await tick()
      if (active && epoch === generation) arm(600000, epoch)
    }, delay)
  }
  function start() {
    if (active) return
    active = true
    arm(300000, ++generation)
    health?.report({ state: 'healthy', result: 'observation' })
  }
  function stop() {
    if (!active) return sendWork?.then(() => {}, () => {})
    active = false
    generation++
    if (timer) scheduler.clearTimeout(timer.id ?? timer)
    timer = null
    if (token) port.release(token)
    return sendWork?.then(() => {}, () => {})
  }
  function stats() {
    let dailyCount = 0
    if (active) { try { dailyCount = port.snapshot().dailyCount } catch {} }
    return { ...state, active, running, dailyCount }
  }
  return Object.freeze({ tick, start, stop, stats })
}
