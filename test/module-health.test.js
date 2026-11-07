import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModuleKernel } from '../src/modules/kernel.js'
import { createProviderRegistry } from '../src/extensions/providers.js'
import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { REASON_CODES, createModuleHealth, observeHealth, validateHealthReport, increment } from '../src/modules/health.js'

const builtin = (id, setup = () => {}, extra = {}) => ({ manifest: { id, permissions: [], ...extra.manifest }, defaultEnabled: true, load: () => ({ setup }), ...extra })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { resolve, promise } }
async function harness(t, registry, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-health-'))
  const providers = createProviderRegistry()
  const kernel = createModuleKernel({ dataDir: root, registry, providerRegistry: providers, ...options })
  const fake = createFakeDsh()
  createRoutes({ ctx: fake.ctx, modules: kernel })
  t.after(async () => { fake.dispose(); await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  const read = id => kernel.health(id).items[0]
  const get = query => fake.call('/onebot-qq/api/modules/health' + (query || ''), undefined, { method: 'GET' })
  return { root, providers, kernel, fake, read, get }
}
async function external(root, id, manifest = {}, source = 'export function setup(api) { if (api.health) throw Error("external health exposed") }') {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', ...manifest }))
  await writeFile(join(dir, 'index.mjs'), source)
  return dir
}

test('health report validation, bounded fixed reasons, safe errors, null and counter saturation', () => {
  const cache = createModuleHealth('runtime')
  assert.ok(Object.values(cache.scheduler).every(value => value === null))
  assert.ok(Object.values(cache.engine).every(value => value === null))
  for (const input of [null, [], {}, { state: 'stopped', result: 'success' }, { state: 'healthy', result: 'arbitrary' }, { state: 'healthy', result: 'success', observedAt: 1 }]) assert.throws(() => validateHealthReport(input))
  for (const code of REASON_CODES) observeHealth(cache, validateHealthReport({ state: 'degraded', result: 'failure', reasonCode: code }), 100)
  assert.equal(cache.reasons.length, 8)
  observeHealth(cache, validateHealthReport({ state: 'degraded', result: 'failure', reasonCode: 'SECRET/path/token' }), 200)
  assert.equal(cache.reasonCode, 'MODULE_HEALTH_UNKNOWN')
  assert.deepEqual(cache.lastError, { reasonCode: 'MODULE_HEALTH_UNKNOWN', observedAt: 200, runtimeGeneration: 'runtime' })
  assert.doesNotMatch(JSON.stringify(cache), /SECRET/)
  assert.equal(increment(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER)
})

test('lifecycle remains independent: disabled/sample, loaded unknown, degraded, blocked and error', async t => {
  let active
  const h = await harness(t, [
    builtin('builtin-sample', undefined, { defaultEnabled: false }),
    builtin('builtin-loaded', api => { active = api }),
    builtin('builtin-missing', undefined, { provides: ['reminders'] }),
    builtin('builtin-error', () => { throw Error('SECRET /private/path') }),
    builtin('builtin-blocked', undefined, { manifest: { id: 'builtin-blocked', permissions: [], requires: ['builtin-sample'] } }),
  ])
  await external(h.root, 'external', { provides: ['reminders'], builtin: true, source: 'builtin' })
  await h.kernel.start()
  assert.equal(h.read('builtin-sample').health, 'stopped')
  assert.equal(h.read('builtin-sample').runtimeGeneration, null)
  assert.equal(h.read('builtin-sample').telemetry.lastSuccessAt, null)
  assert.equal(h.read('builtin-loaded').health, 'unknown')
  assert.equal(h.read('builtin-loaded').reasonCode, null)
  assert.equal(h.read('external').health, 'unknown')
  assert.deepEqual(h.read('external').providers, [])
  assert.equal(h.read('builtin-missing').health, 'degraded')
  assert.equal(h.read('builtin-missing').reasonCode, 'PROVIDER_UNAVAILABLE')
  assert.equal(h.read('builtin-error').health, 'unhealthy')
  assert.equal(h.read('builtin-error').lifecycle, 'error')
  assert.equal(h.read('builtin-error').engine.failed, null)
  assert.equal(h.read('builtin-blocked').lifecycle, 'blocked')
  assert.equal(h.read('builtin-blocked').reasonCode, 'DEPENDENCY_BLOCKED')
  assert.deepEqual(h.read('builtin-blocked').dependencies, [{ moduleId: 'builtin-sample', available: false }])
  assert.ok(Object.isFrozen(active.health))
  active.health.report({ state: 'healthy', result: 'started' })
  active.health.report({ state: 'healthy', result: 'skipped', reasonCode: 'BUSINESS_DISABLED' })
  assert.equal(h.read('builtin-loaded').health, 'healthy')
  assert.deepEqual(h.read('builtin-loaded').engine, { runs: 1, succeeded: 0, failed: 0, skipped: 1, inFlight: 0 })
  active.health.report({ state: 'degraded', result: 'failure', reasonCode: 'ENGINE_FAILED' })
  assert.equal(h.read('builtin-loaded').lifecycle, 'loaded')
  assert.equal(h.read('builtin-loaded').lastError.reasonCode, 'ENGINE_FAILED')
  assert.throws(() => active.health.report({ state: 'healthy', result: 'success', runtimeGeneration: 'fake' }))
  const response = await h.get('?id=builtin-loaded')
  assert.equal(response.json.ok, true)
  assert.equal(response.json.items.length, 1)
  assert.equal(response.json.summary.degraded, 1)
  assert.equal((await h.get('?id=unknown')).json.code, 'MODULE_NOT_FOUND')
  assert.doesNotMatch(JSON.stringify(h.kernel.health()), /SECRET|private\/path|configValues|entryPath/)
})

test('runtime generation rotates only for setup, survives UI authorization and isolates stale reports', async t => {
  const apis = []
  const h = await harness(t, [builtin('builtin-worker', api => { apis.push(api) })])
  const dir = await external(h.root, 'external', {
    permissions: ['ui:sandbox'], webui: { version: 1, sandbox: { entry: 'webui/index.html' }, requestedCapabilities: ['ui.sandbox'], surfaces: [{ id: 'panel', hook: 'module.panel', renderer: 'sandbox' }] },
  })
  await mkdir(join(dir, 'webui')); await writeFile(join(dir, 'webui/index.html'), '<title>test</title>')
  await h.kernel.start()
  const before = h.kernel.list().find(item => item.id === 'external')
  await h.kernel.setUiGrant('external', true)
  const after = h.kernel.list().find(item => item.id === 'external')
  assert.notEqual(before.generation, after.generation)
  assert.equal(before.runtimeGeneration, after.runtimeGeneration)
  assert.notEqual(before.runtimeGeneration, before.generation)
  const first = h.read('builtin-worker').runtimeGeneration
  apis[0].health.report({ state: 'degraded', result: 'failure', reasonCode: 'ENGINE_FAILED' })
  await h.kernel.setEnabled('builtin-worker', false)
  const stopped = h.read('builtin-worker')
  assert.equal(stopped.health, 'stopped'); assert.equal(stopped.runtimeGeneration, null)
  assert.equal(stopped.telemetryGeneration, first)
  assert.equal(stopped.lastError.runtimeGeneration, first)
  assert.ok(stopped.telemetry.lastStoppedAt)
  assert.equal(apis[0].health.report({ state: 'healthy', result: 'success' }), false)
  await h.kernel.setEnabled('builtin-worker', true)
  assert.notEqual(h.read('builtin-worker').runtimeGeneration, first)
  assert.equal(h.read('builtin-worker').lastError, null)
  const revision = h.kernel.health().revision
  assert.equal(apis[0].health.report({ state: 'unhealthy', result: 'failure', reasonCode: 'ENGINE_FAILED' }), false)
  assert.equal(h.kernel.health().revision, revision)
  assert.equal(h.read('builtin-worker').health, 'unknown')
})

test('GET is fresh and side-effect-free, available while provider stop holds lifecycle queue', async t => {
  const gate = deferred(), entered = deferred()
  let loads = 0, starts = 0, stops = 0
  const provider = { start() { starts++ }, stop() { stops++; entered.resolve(); return gate.promise }, status() { throw Error('probe forbidden') } }
  const h = await harness(t, [builtin('builtin-worker', api => {
    loads++
    api.providers.register('reminders', provider)
  }, { manifest: { id: 'builtin-worker', permissions: ['providers:register'] }, provides: ['reminders'] })])
  await h.kernel.start()
  const snapshot = h.kernel.health()
  const read = await h.get()
  assert.equal(read.json.revision, snapshot.revision)
  assert.equal(loads, 1); assert.equal(starts, 0); assert.equal(stops, 0)
  snapshot.items[0].telemetry.lastFailureAt = 10
  snapshot.items[0].providers[0].owner = 'core'
  assert.equal(h.read('builtin-worker').telemetry.lastFailureAt, null)
  assert.equal(h.read('builtin-worker').providers[0].owner, null)
  const stop = h.kernel.setEnabled('builtin-worker', false)
  await entered.promise
  t.after(() => gate.resolve())
  try {
    const pending = await h.get('?id=builtin-worker')
    assert.equal(pending.json.ok, true)
    assert.equal(pending.json.items[0].phase, 'draining')
    assert.ok(pending.json.items[0].reasons.includes('STOP_PENDING'))
    assert.equal(pending.json.items[0].runtimeGeneration, h.read('builtin-worker').runtimeGeneration)
    assert.equal(stops, 1)
  } finally { gate.resolve(); await stop }
  assert.equal(h.read('builtin-worker').health, 'stopped')
  const final = h.kernel.health()
  await h.get(); await h.get()
  assert.equal(h.kernel.health().revision, final.revision)
  assert.deepEqual(h.kernel.health().items, final.items)
})

test('command/config/event/status/planner callbacks report fixed codes and retain lifecycle behavior', async t => {
  const handlers = new Map(), planners = createDeliveryRegistry()
  let api, failPlan = true
  const h = await harness(t, [builtin('builtin-observer', value => {
    api = value
    api.registerCommand('observe', () => { throw Error('SECRET') })
    api.config.onChange(async () => { throw Error('SECRET') })
    api.on('message', () => { throw Error('SECRET') })
    api.delivery.registerPlanner({ id: 'observer', stage: 'format', plan() { if (failPlan) throw Error('SECRET'); return { plan: true } } })
  }, { manifest: { id: 'builtin-observer', permissions: ['commands', 'events', 'delivery:plan', 'status:write'] }, config: { version: 1, fields: [{ path: 'label', label: 'Label', type: 'text', default: 'a' }] } })], {
    commands: { registerCommand(name, handler) { handlers.set(name, handler); return () => handlers.delete(name) } },
    deliveryRegistry: planners, gateway: { actions: { setInputStatus() { return Promise.reject(Error('SECRET')) } } },
  })
  await h.kernel.start()
  assert.throws(() => handlers.get('observe')({}))
  assert.equal(h.read('builtin-observer').reasonCode, 'COMMAND_FAILED')
  await assert.rejects(api.status.setInputStatus('10001', 1))
  assert.equal(h.read('builtin-observer').reasonCode, 'TYPING_STATUS_FAILED')
  assert.throws(() => planners.resolve().plan())
  assert.equal(h.read('builtin-observer').reasonCode, 'REPLY_PLAN_FAILED')
  failPlan = false; assert.deepEqual(planners.resolve().plan(), { plan: true })
  assert.equal(h.read('builtin-observer').health, 'healthy')
  await h.kernel.setModuleConfig('builtin-observer', { label: 'b' }, 0)
  await new Promise(setImmediate)
  assert.equal(h.read('builtin-observer').reasonCode, 'CONFIG_LISTENER_FAILED')
  assert.equal(h.read('builtin-observer').lifecycle, 'loaded')
  await h.kernel.dispatch({ kind: 'message' })
  assert.equal(h.read('builtin-observer').lifecycle, 'error')
  assert.equal(h.read('builtin-observer').reasonCode, 'EVENT_FAILED')
  assert.doesNotMatch(JSON.stringify(h.kernel.health()), /SECRET/)
})


test('typing adapter reports unavailable gateway even when builtin swallows the failure', async t => {
  let hooks
  const { setup } = await import('../src/modules/builtin/typing.js')
  const h = await harness(t, [builtin('builtin-typing', setup, { manifest: { id: 'builtin-typing', permissions: ['turn:lifecycle', 'status:write'] } })], {
    turnHooks: { register(value) { hooks = value; return () => {} } },
  })
  await h.kernel.start()
  await hooks.onStart({ turn: { chatType: 'private', chatId: '10001' }, settings: { typingEnabled: false } })
  assert.equal(h.read('builtin-typing').reasonCode, 'BUSINESS_DISABLED')
  assert.equal(h.read('builtin-typing').health, 'healthy')
  await hooks.onStart({ turn: { chatType: 'private', chatId: '10001' }, settings: { typingEnabled: true } })
  assert.equal(h.read('builtin-typing').reasonCode, 'TYPING_STATUS_FAILED')
  assert.equal(h.read('builtin-typing').health, 'degraded')
  assert.equal(h.read('builtin-typing').engine.failed, 1)
})

test('draining runtime generation remains visible until asynchronous cleanup completes', async t => {
  const gate = deferred(), entered = deferred()
  const h = await harness(t, [builtin('builtin-cleanup', () => async () => { entered.resolve(); await gate.promise })])
  await h.kernel.start()
  const generation = h.read('builtin-cleanup').runtimeGeneration
  const stopping = h.kernel.setEnabled('builtin-cleanup', false)
  await entered.promise
  try {
    const health = (await h.get()).json.items[0]
    assert.equal(health.runtimeGeneration, generation)
    assert.equal(health.phase, 'draining')
  } finally { gate.resolve(); await stopping }
  assert.equal(h.read('builtin-cleanup').runtimeGeneration, null)
  assert.equal(h.read('builtin-cleanup').telemetryGeneration, generation)
})

test('GET collectedAt is fresh while observedAt, cached counters and revision do not advance', async t => {
  let api
  const h = await harness(t, [builtin('builtin-worker', value => { api = value })])
  await h.kernel.start()
  api.health.report({ state: 'healthy', result: 'observation', reasonCode: 'BUSINESS_DISABLED' })
  const first = h.kernel.health()
  t.mock.method(Date, 'now', () => first.collectedAt + 1000)
  const second = (await h.get()).json
  assert.equal(second.collectedAt, first.collectedAt + 1000)
  assert.equal(second.revision, first.revision)
  assert.deepEqual(second.items, first.items)
})
