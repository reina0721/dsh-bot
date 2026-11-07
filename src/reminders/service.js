import { reportEngine } from '../modules/health.js'
// Shared reminder rules; all persistence and delivery enter through injected ports.
import { hashText, uid } from '../cognition/util.js'

export function createReminderEngine({ repository, getConfig, owner, clock = { now: Date.now }, scheduler, deliver, logger, health }) {
  let running = false
  let started = false
  let disposed = false
  let generation = 0
  let pending = null
  let timer = null
  const bounded = (value, fallback, min, max) => Number.isFinite(Number(value))
    ? Math.max(min, Math.min(max, Math.floor(Number(value)))) : fallback
  const config = () => {
    const raw = getConfig() || {}
    const minIntervalSeconds = bounded(raw.minIntervalSeconds, 60, 60, 2592000)
    return {
      enabled: raw.enabled === true,
      maxActive: bounded(raw.maxActive, 50, 1, 1000),
      minIntervalSeconds,
      maxIntervalSeconds: bounded(raw.maxIntervalSeconds, 2592000, minIntervalSeconds, 2592000),
      tickMs: bounded(raw.tickMs, 30000, 1000, 3600000),
    }
  }
  const fail = (code) => { throw new Error(code) }
  const scope = (chatType, chatId) => {
    const id = String(chatId ?? '')
    if (!['private', 'group'].includes(chatType) || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) fail('INVALID_TARGET')
    return { scopeType: chatType, scopeId: id }
  }
  const matches = (row, target) => row.scopeType === target.scopeType && row.scopeId === target.scopeId
  const publicRecord = (row) => {
    const { id, scopeType, scopeId, text, at, everySeconds, nextAt, status, createdBy, createdAt, sentCount, lastError } = row
    return { id, scopeType, scopeId, text, at, everySeconds, nextAt, status, createdBy, createdAt, sentCount, lastError }
  }
  function add({ chatType, chatId, text, at, everySeconds, createdBy } = {}) {
    const cfg = config()
    if (!cfg.enabled || disposed) fail('REMINDERS_DISABLED')
    owner(createdBy)
    const target = scope(chatType, chatId)
    if (typeof text !== 'string' || !text.trim() || Array.from(text).length > 500) fail('INVALID_TEXT')
    const once = at !== undefined && at !== null
    const recurring = everySeconds !== undefined && everySeconds !== null
    if (once === recurring) fail('INVALID_SCHEDULE')
    const now = clock.now()
    const due = once ? (typeof at === 'number' ? at : typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(at) ? Date.parse(at) : NaN) : now + everySeconds * 1000
    if (once && (!Number.isFinite(due) || due <= now || !Number.isFinite(new Date(due).getTime()))) fail('INVALID_AT')
    if (recurring && (!Number.isInteger(everySeconds) || everySeconds < cfg.minIntervalSeconds || everySeconds > cfg.maxIntervalSeconds)) fail('INVALID_INTERVAL')
    const active = repository.all('active')
    if (active.some((row) => matches(row, target) && row.text === text && (once ? row.at === due : row.everySeconds === everySeconds))) fail('REMINDER_DUPLICATE')
    if (active.length >= cfg.maxActive) fail('MAX_ACTIVE')
    const id = `rem_${hashText(uid('reminder'), 24)}`
    return publicRecord(repository.put({ id,
      ...target, text, at: once ? due : null, everySeconds: recurring ? everySeconds : null,
      nextAt: due, status: 'active', createdBy: String(createdBy), createdAt: now, sentCount: 0, lastError: '',
    }))
  }
  function list({ chatType, chatId, status = 'active', limit = 50 } = {}) {
    const target = scope(chatType, chatId)
    return repository.all(status).filter(row => matches(row, target)).slice(0, bounded(limit, 50, 1, 50)).map(publicRecord)
  }
  function cancel(id, { chatType, chatId, operatorId } = {}) {
    owner(operatorId)
    const target = scope(chatType, chatId)
    if (typeof id !== 'string' || !/^rem_[0-9a-f]{24}$/.test(id)) fail('REMINDER_NOT_FOUND')
    const row = repository.get(id)
    if (!row || !matches(row, target) || row.status !== 'active') fail('REMINDER_NOT_FOUND')
    return publicRecord(repository.put({ id, ...row, status: 'cancelled' }))
  }
  function tick() {
    if (disposed || running) return Promise.resolve()
    if (!config().enabled) {
      reportEngine(health, 'started')
      reportEngine(health, 'skipped', 'BUSINESS_DISABLED')
      return Promise.resolve()
    }
    running = true
    reportEngine(health, 'started')
    const epoch = generation
    pending = runTick(epoch)
    return pending
  }
  async function runTick(epoch) {
    let failed = false
    try {
      const captured = repository.capture()
      const due = captured.findDue(clock.now(), 20)
      for (const item of due) {
        if (disposed || epoch !== generation || !config().enabled || !captured.isCurrent()) break
        const row = captured.get(item.id)
        if (!row || row.status !== 'active' || row.nextAt > clock.now()) continue
        let result
        try {
          result = await deliver({ chatType: row.scopeType, chatId: row.scopeId,
            text: row.text, source: 'reminder' })
        } catch { result = { ok: false } }
        if (result?.ok !== true) failed = true
        if (disposed) break
        const current = captured.get(row.id)
        if (!current || JSON.stringify(current) !== JSON.stringify(row)) continue
        const now = clock.now()
        const patch = result?.ok === true
          ? { status: row.everySeconds ? 'active' : 'sent', nextAt: row.everySeconds ? now + row.everySeconds * 1000 : row.nextAt,
              sentCount: row.sentCount + 1, lastError: '' }
          : { lastError: ['ACCESS_DENIED', 'RATE_LIMITED', 'LEAK_BLOCKED', 'GATEWAY_UNAVAILABLE', 'SEND_FAILED'].includes(result?.error) ? result.error : 'SEND_FAILED',
              nextAt: now + Math.max(60, config().minIntervalSeconds) * 1000 }
        captured.put({ ...current, ...patch })
      }
      reportEngine(health, failed ? 'failure' : due.length ? 'success' : 'skipped', failed ? 'REMINDER_TICK_FAILED' : due.length ? null : 'NO_TASK')
    } catch (error) {
      reportEngine(health, 'failure', 'REMINDER_TICK_FAILED')
      throw error
    } finally { running = false; pending = null }
  }
  function schedule(epoch) {
    if (!started || disposed || epoch !== generation) return
    timer = scheduler.setTimeout(async () => {
      timer = null
      try { await tick() } catch { logger?.warn?.('提醒调度失败：REMINDER_TICK_FAILED') }
      finally { schedule(epoch) }
    }, config().tickMs)
  }
  function start() {
    if (started || disposed) return
    started = true
    schedule(generation)
  }
  function stop() {
    started = false
    generation++
    if (timer !== null) scheduler.clearTimeout(timer?.id || timer)
    timer = null
    return pending || Promise.resolve()
  }
  function dispose() {
    disposed = true
    return stop()
  }
  return { add, list, cancel, tick, start, stop, dispose }
}
