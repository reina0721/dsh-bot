// Bounded, host-owned telemetry. Projections never execute module/provider code.
export const HEALTH_STATES = Object.freeze(['unknown', 'healthy', 'degraded', 'unhealthy', 'stopped'])
export const PROVIDER_NAMES = Object.freeze(['reminders', 'mediaFeatures', 'proactivity', 'learning'])
export const REASON_CODES = Object.freeze([
  'MODULE_HEALTH_UNKNOWN', 'MODULE_DISABLED', 'MODULE_LOADING', 'MODULE_STOPPED', 'MODULE_SETUP_FAILED',
  'DEPENDENCY_BLOCKED', 'PROVIDER_UNAVAILABLE', 'PROVIDER_START_FAILED', 'PROVIDER_STOP_FAILED',
  'NO_PROVIDER', 'STOP_PENDING', 'BUSINESS_DISABLED', 'QUIET_HOURS', 'BUDGET_EXHAUSTED',
  'NO_CANDIDATE', 'NO_TASK', 'BUSY', 'BACKOFF', 'RUN_CANCELLED', 'ENGINE_FAILED',
  'REMINDER_TICK_FAILED', 'PROACTIVITY_RUN_FAILED', 'LEARNING_RUN_FAILED', 'TYPING_STATUS_FAILED',
  'MEDIA_OPERATION_FAILED', 'REPLY_PLAN_FAILED', 'SCHEDULER_CALLBACK_FAILED', 'COMMAND_FAILED', 'EVENT_FAILED', 'CONFIG_LISTENER_FAILED',
])
const codes = new Set(REASON_CODES)
export const reasonCode = value => value == null ? null : codes.has(value) ? value : 'MODULE_HEALTH_UNKNOWN'
export const increment = value => Math.min(Number.MAX_SAFE_INTEGER, value + 1)
export function validateHealthReport(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['state', 'result', 'reasonCode'].includes(key))
    || !['healthy', 'degraded', 'unhealthy', 'unknown'].includes(value.state)
    || !['started', 'success', 'failure', 'skipped', 'observation'].includes(value.result)) throw new TypeError('模块健康报告无效')
  return { state: value.state, result: value.result, reasonCode: reasonCode(value.reasonCode) }
}
export function createModuleHealth(runtimeGeneration = null, scheduler = false) {
  return {
    runtimeGeneration, phase: runtimeGeneration ? 'starting' : 'inactive', health: 'unknown',
    reasonCode: null, reasons: [], observedAt: null, lastError: null,
    telemetry: { lastStartedAt: null, lastStoppedAt: null, lastSuccessAt: null, lastFailureAt: null, nextRunAt: null, inFlight: null, timerScheduled: scheduler ? false : null },
    scheduler: Object.fromEntries(['active', 'running', 'scheduled', 'fired', 'cancelled', 'completed', 'failed', 'nextDueAt'].map(key => [key, scheduler && key !== 'nextDueAt' ? 0 : null])),
    engine: { runs: null, succeeded: null, failed: null, skipped: null, inFlight: null },
  }
}
export function observeHealth(cache, { state, result = 'observation', reasonCode: code = null }, now = Date.now()) {
  code = reasonCode(code)
  cache.health = state
  cache.reasonCode = code
  cache.reasons = code ? [code, ...cache.reasons.filter(item => item !== code)].slice(0, 8) : cache.reasons
  cache.observedAt = now
  if (result !== 'observation') {
    for (const key of Object.keys(cache.engine)) cache.engine[key] ??= 0
    if (result === 'started') { cache.engine.runs = increment(cache.engine.runs); cache.engine.inFlight = increment(cache.engine.inFlight) }
    else {
      // A terminal report may be the first observed event for synchronous work.
      if (cache.engine.inFlight === 0) cache.engine.runs = increment(cache.engine.runs)
      cache.engine.inFlight = Math.max(0, cache.engine.inFlight - 1)
      const key = { success: 'succeeded', failure: 'failed', skipped: 'skipped' }[result]
      cache.engine[key] = increment(cache.engine[key])
    }
    cache.telemetry.inFlight = cache.engine.inFlight
  }
  if (result === 'success' || result === 'skipped') cache.telemetry.lastSuccessAt = now
  if (result === 'failure' || (['degraded', 'unhealthy'].includes(state) && (code?.endsWith('_FAILED') || code === 'DEPENDENCY_BLOCKED'))) {
    cache.telemetry.lastFailureAt = now
    cache.lastError = { reasonCode: code || 'MODULE_HEALTH_UNKNOWN', observedAt: now, runtimeGeneration: cache.runtimeGeneration }
  }
}
export function projectModuleHealth(record, providers = []) {
  const cache = record.health || createModuleHealth()
  let health = cache.health, code = cache.reasonCode
  if (record.status === 'error') { health = 'unhealthy'; code = cache.lastError?.reasonCode || cache.reasonCode || 'MODULE_SETUP_FAILED' }
  else if (record.status === 'blocked') { health = 'stopped'; code = 'DEPENDENCY_BLOCKED' }
  else if (providers.some(provider => provider.ownerModuleId === record.id && provider.state === 'failed')) { health = 'degraded'; code = 'PROVIDER_UNAVAILABLE' }
  else if (!record.runtime) { health = 'stopped'; code = record.enabled ? 'MODULE_STOPPED' : 'MODULE_DISABLED' }
  else if (record.status === 'loaded' && providers.some(provider => provider.registeredModuleId !== record.id || provider.owner !== 'module' || provider.ownerModuleId !== record.id || provider.ownerRuntimeGeneration !== record.runtime.runtimeGeneration || provider.state !== 'active')) {
    if (health !== 'unhealthy') { health = 'degraded'; code = 'PROVIDER_UNAVAILABLE' }
  }
  return structuredClone({
    version: 1, moduleId: record.id, lifecycle: record.status,
    runtimeGeneration: record.runtime?.runtimeGeneration || null,
    telemetryGeneration: cache.runtimeGeneration, phase: cache.phase, health, reasonCode: code,
    reasons: [...new Set([code, ...cache.reasons].filter(Boolean))].slice(0, 8),
    observedAt: cache.observedAt, lastError: cache.lastError,
    dependencies: (record.requires || []).map(id => ({ moduleId: id, available: record.dependencyStatus?.[id] ?? null })),
    telemetry: cache.telemetry, scheduler: cache.scheduler, engine: cache.engine, providers,
    actions: [],
  })
}
// Engine adapters map internal outcomes to this fixed public vocabulary.
export function reportEngine(health, result, code = null) {
  health?.report({ state: result === 'failure' ? 'degraded' : 'healthy', result, reasonCode: code })
}
export function createProviderHealth(name, expectedModuleId = null) {
  return { name, expectedModuleId, registeredModuleId: null, owner: null, ownerModuleId: null,
    ownerRuntimeGeneration: null, state: 'unknown', phase: 'unknown', reasonCode: null,
    fallback: { active: false, reasonCode: null }, observedAt: null }
}
