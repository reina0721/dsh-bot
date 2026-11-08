import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModuleKernel } from '../src/modules/kernel.js'
import { builtinRegistry } from '../src/modules/registry.js'
import { createProviderRegistry } from '../src/extensions/providers.js'
import { validateManifest } from '../src/modules/manifest.js'
import { createCognition } from '../src/cognition/index.js'
import { normalizeConfig, CONFIG_GROUPS } from '../src/core/config.js'
import { setup } from '../src/modules/builtin/proactivity/index.js'
import { harness, deferred } from './helpers/proactivity.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const descriptor = builtinRegistry.find(row => row.manifest.id === 'builtin-proactivity')
async function moduleHarness(t, { disabled = false, fail = false, missingPort = false, sendMessage } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proactive-'))
  if (disabled) await writeFile(join(root, 'state.json'), JSON.stringify({ disabled: ['builtin-proactivity'] }))
  const h = harness(t, { sendMessage })
  h.engine.stop()
  let api
  const providers = createProviderRegistry()
  const kernel = createModuleKernel({ dataDir: root, getConfig: () => h.config, personaStore: h.store, delivery: h.delivery, providerRegistry: providers,
    cognition: { services: { ...h.services, proactivityState: () => ({ ready: true, now: h.port.snapshot().now }) } },
    registry: [{ ...descriptor, manifest: { ...descriptor.manifest, permissions: missingPort ? descriptor.manifest.permissions.filter(p => p !== 'proactivity:service') : descriptor.manifest.permissions }, load: () => ({ setup(value) { api = value; const cleanup = setup(value); if (fail) throw Error('setup failed'); return cleanup } }) }],
  })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  return { ...h, providers, kernel, api: () => api }
}

test('builtin provider and exact four permissions; disabled is lazy, no fallback, setup failure cleans timer/provider', async t => {
  assert.equal(descriptor.defaultEnabled, true)
  assert.deepEqual(descriptor.manifest.permissions, ['providers:register', 'scheduler', 'config:read', 'proactivity:service'])
  const nativeTimers = new Map()
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => { const handle = { fn, delay }; nativeTimers.set(handle, delay); return handle })
  t.mock.method(globalThis, 'clearTimeout', handle => nativeTimers.delete(handle))
  const h = await moduleHarness(t, { disabled: true })
  assert.equal(nativeTimers.size, 0)
  assert.equal(h.api(), undefined); assert.equal(h.providers.get('proactivity'), null)
  await h.kernel.setEnabled('builtin-proactivity', true)
  const api = h.api(), provider = h.providers.get('proactivity')
  assert.ok(provider); assert.equal(provider.stats().active, true)
  provider.start(); provider.start(); assert.equal(nativeTimers.size, 1)
  assert.ok([...nativeTimers.values()][0] <= 300000)
  assert.equal(api.proactivity.storage, undefined)
  for (const field of ['storage', 'cognition']) assert.throws(() => api[field], /permission/)
  await assert.rejects(api.sendText({}), /permission/)
  assert.throws(() => api.delivery.send({}), /permission/)
  assert.throws(() => api.legacyConfig.section('cognition.reminders'), /cognition.proactivity/)
  h.config.cognition.proactivity.secret = 'RAW_SECRET_URL'
  assert.doesNotMatch(JSON.stringify([api.legacyConfig.section('cognition.proactivity'), api.proactivity.snapshot()]), /RAW_SECRET/)
  assert.equal((await provider.tick()).ok, true)
  await h.kernel.setEnabled('builtin-proactivity', false)
  assert.equal(h.providers.get('proactivity'), null)
  assert.equal(nativeTimers.size, 0)
  assert.equal((await provider.tick()).reason, 'MODULE_DISABLED')
  assert.throws(() => api.proactivity.begin(), /停止/)
  await h.kernel.setEnabled('builtin-proactivity', true)
  assert.notEqual(h.providers.get('proactivity'), provider)
  assert.throws(() => api.proactivity.snapshot(), /停止/)
  const failed = await moduleHarness(t, { fail: true })
  assert.equal(failed.kernel.list()[0].status, 'error'); assert.equal(failed.providers.get('proactivity'), null)
  assert.throws(() => failed.api().proactivity.snapshot(), /停止/)
  assert.equal(nativeTimers.size, 1, 'failed setup leaves only the other live runtime timer')
  const absent = await moduleHarness(t, { missingPort: true })
  assert.equal(absent.api().proactivity, undefined)
})

test('proactivity slot and permission reject other identities and external manifests; reminder events remain isolated', () => {
  const registry = createProviderRegistry(), events = []
  const provider = { start() {}, stop() {}, tick() {}, stats() {} }
  assert.throws(() => registry.register('proactivity', provider, { moduleId: 'builtin-other' }), /builtin-proactivity/)
  assert.throws(() => registry.register('proactivity', provider, { moduleId: 'builtin-proactivity', source: 'external' }), /内置/)
  assert.throws(() => registry.register('proactivity', { start() {}, stop() {} }, { moduleId: 'builtin-proactivity' }), /tick\/stats/)
  assert.throws(() => validateManifest({ id: 'external', permissions: ['proactivity:service'] }), /内置/)
  assert.throws(() => validateManifest({ ...descriptor.manifest, id: 'builtin-other' }, { builtin: true }), /builtin-proactivity/)
  registry.subscribe(event => { if (event.name === 'reminders') events.push(event) })
  const off = registry.register('proactivity', provider, { moduleId: 'builtin-proactivity' })
  assert.throws(() => registry.register('proactivity', provider, { moduleId: 'builtin-proactivity' }), /已注册/)
  off(); off(); assert.deepEqual(events, [])
})

test('port projects private scope <=1000, immutable target selection, bounded context, one send per opaque token', async t => {
  const h = harness(t)
  h.engine.stop()
  h.seed('invalid', { scopeId: '0' }); h.seed('group', { scopeType: 'group' }); h.seed('missing-person', { personId: 'missing' })
  const token = h.port.begin()
  assert.deepEqual(token, {})
  const candidates = h.port.candidates(token)
  assert.equal(candidates.length, 1); assert.equal(candidates[0].scopeId, '10001')
  assert.equal('dimensions' in candidates[0], false); assert.equal(candidates[0].familiarity, 0.9)
  candidates[0].scopeId = '99999'
  assert.equal(await h.port.context(token, 'forged'), null)
  assert.ok(await h.port.context(token, 'r1'))
  await h.port.complete(token, { system: '', user: '', purpose: 'other', maxTokens: 99999, chat: { chatType: 'group', chatId: '99999' }, provider: 'evil' })
  const [first, second] = await Promise.all([h.port.send(token, { text: 'evil', chatId: '99999', action: 'reply' }), h.port.send(token)])
  assert.equal(first.ok, true); assert.equal(second.reason, 'INVALID_RUN'); assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].chatId, '10001'); assert.equal(h.calls[0].message[0].data.text, 'hello')
  assert.deepEqual(h.modelCalls[0].chat, { chatType: 'private', chatId: '10001' }); assert.equal(h.modelCalls[0].maxTokens, 220)
  h.port.release(token); h.port.release(token)
  assert.throws(() => h.port.candidates(token), /RUN_CANCELLED/)
  assert.throws(() => h.port.candidates({}), /RUN_CANCELLED/)
  h.store.remove('relationship', 'missing-person')
  for (let i = 0; i < 1005; i++) h.seed('extra' + i)
  const next = h.port.begin()
  assert.equal(h.port.candidates(next).length, 1000)
  h.port.release(next)
})

test('kernel disable during LLM await revokes old token and late reply; module UI/config metadata stays pure', async t => {
  const h = await moduleHarness(t)
  const entered = deferred(), gate = deferred()
  h.services.llm.complete = async () => { entered.resolve(); await gate.promise; return { ok: true, text: 'late' } }
  const work = h.providers.get('proactivity').tick(); await entered.promise
  const catalog = h.kernel.uiCatalog()
  assert.deepEqual(catalog, h.kernel.uiCatalog())
  const item = catalog.items[0]
  assert.deepEqual(item.config, { binding: 'legacy-core', schemaVersion: 1, available: true })
  assert.deepEqual(item.surfaces.map(row => row.hook), ['module.detail', 'module.config'])
  assert.equal(item.surfaces[0].componentKey, 'proactivity.preview')
  assert.equal(CONFIG_GROUPS.flatMap(row => row.fields).filter(row => row.module === descriptor.manifest.id).length, 7)
  await h.kernel.setEnabled('builtin-proactivity', false)
  gate.resolve(); assert.equal((await work).reason, 'MODULE_DISABLED')
  assert.equal(h.calls.length, 0); assert.equal(h.store.count('decision'), 0)
})

test('core constructs no engine/timer; facade/HTTP safe when absent, /active cannot start disabled module', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-proactive-core-'))
  const providers = createProviderRegistry()
  const config = normalizeConfig({ access: { ownerQQ: '10001' }, cognition: { enabled: true, proactivity: { enabled: false } } }).config
  const delays = []
  const cognition = createCognition({ dataRoot: root, getConfig: () => config, setConfig: next => Object.assign(config, normalizeConfig(next).config), providerRegistry: providers,
    scheduler: { setTimeout(fn, ms) { delays.push(ms); return 1 }, clearTimeout() {}, dispose() {} },
  })
  const fake = createFakeDsh()
  const routes = createRoutes({ ctx: fake.ctx, getConfig: () => config, cognition })
  t.after(async () => { routes.dispose(); fake.dispose(); cognition.dispose(); await rm(root, { recursive: true, force: true }) })
  assert.equal(cognition.state.ready, true)
  assert.equal(cognition.services.proactivity, undefined)
  assert.ok(!delays.includes(300000)); assert.ok(!delays.includes(600000))
  assert.equal(cognition.proactivityStats().reason, 'MODULE_DISABLED')
  assert.deepEqual(await cognition.runProactivity(), { ok: false, reason: 'MODULE_DISABLED' })
  const result = await cognition.services.commands.handle({ text: '/active', senderId: '10001', chatType: 'private', chatId: '10001', isOwner: true })
  assert.equal(result.handled, true)
  assert.equal(config.cognition.proactivity.enabled, false)
  assert.equal(cognition.services.settings.resolveConfig().cognition.turn.groupReplyMode, 'addressed')
  assert.equal(providers.get('proactivity'), null)
  const get = (await fake.call('/onebot-qq/api/cognition/proactivity', undefined, { method: 'GET' })).json
  const run = (await fake.call('/onebot-qq/api/cognition/proactivity/run', {}, { method: 'POST' })).json
  assert.equal(get.stats.reason, 'MODULE_DISABLED'); assert.equal(run.result.reason, 'MODULE_DISABLED')
  const provider = { start() {}, stop() {}, stats: () => ({ active: true }), tick: async () => ({ ok: true }) }
  const off = providers.register('proactivity', provider, { moduleId: 'builtin-proactivity' })
  assert.deepEqual(cognition.proactivityStats(), { active: true }); assert.deepEqual(await cognition.runProactivity(), { ok: true })
  off(); assert.equal((await cognition.runProactivity()).reason, 'MODULE_DISABLED')
})


test('disable drains an admitted send before a new runtime; receipt remains in captured persona', async t => {
  const entered = deferred(), gate = deferred()
  t.after(() => gate.resolve())
  const h = await moduleHarness(t, { sendMessage: async () => { entered.resolve(); await gate.promise; return { message_id: 'admitted' } } })
  const work = h.providers.get('proactivity').tick(); await entered.promise
  const provider = h.providers.get('proactivity')
  const draining = provider.stop()
  assert.equal(provider.stats().active, false)
  let disabled = false
  const stopping = h.kernel.setEnabled('builtin-proactivity', false).then(() => { disabled = true })
  await new Promise(setImmediate)
  assert.equal(disabled, false)
  assert.equal((await h.providers.get('proactivity').tick()).reason, 'MODULE_DISABLED')
  h.switchPersona('other'); gate.resolve()
  assert.equal((await work).ok, true); await draining; await stopping
  assert.equal(h.providers.get('proactivity'), null)
  assert.equal(h.base.list('persona_self:decision')[0].messageId, 'admitted')
  assert.equal(h.base.count('persona_self:proactive_intent'), 1)
  assert.equal(h.base.count('persona_other:decision'), 0)
  await h.kernel.setEnabled('builtin-proactivity', true)
  assert.equal(h.providers.get('proactivity').stats().active, true)
})

test('context projection is <=4 summaries of <=160 characters and rejects other persons/scopes', async t => {
  const h = harness(t, { memoryFactory: () => ({ async retrieveAsync() {
    return [
      { memory: { personId: 'other', scopeType: 'global', summary: 'OTHER_PERSON' } },
      { memory: { personId: 'p1', scopeType: 'group', scopeId: '20001', summary: 'GROUP' } },
      { memory: { personId: 'p1', scopeType: 'private', scopeId: '10002', summary: 'OTHER_CHAT' } },
      ...Array.from({ length: 8 }, (_, i) => ({ memory: { personId: 'p1', scopeType: 'private', scopeId: '10001', summary: String(i).repeat(300), secret: 'RAW_SECRET' } })),
    ]
  } }) })
  const token = h.port.begin(); h.port.candidates(token)
  const context = await h.port.context(token, 'r1')
  assert.equal(context.memories.length, 4)
  assert.ok(context.memories.every(text => text.length === 160))
  assert.deepEqual(Object.keys(context).sort(), ['displayName', 'memories', 'style'])
  assert.doesNotMatch(JSON.stringify(context), /OTHER_PERSON|OTHER_CHAT|GROUP|RAW_SECRET/)
  h.port.release(token)
})


test('proactivity health records healthy policy skips and captured failures', async t => {
  const h = await moduleHarness(t)
  const read = () => h.kernel.health('builtin-proactivity').items[0]
  const provider = h.providers.get('proactivity')
  h.config.cognition.proactivity.enabled = false
  await provider.tick()
  assert.equal(read().health, 'healthy')
  assert.equal(read().reasonCode, 'BUSINESS_DISABLED')
  assert.equal(read().engine.skipped, 1)
  h.config.cognition.proactivity.enabled = true
  h.services.llm.complete = async () => ({ ok: false, error: 'BUDGET_EXHAUSTED' })
  await provider.tick()
  assert.equal(read().health, 'healthy')
  assert.equal(read().reasonCode, 'BUDGET_EXHAUSTED')
  h.services.llm.complete = async () => { throw Error('SECRET') }
  await provider.tick()
  assert.equal(read().health, 'degraded')
  assert.equal(read().lastError.reasonCode, 'PROACTIVITY_RUN_FAILED')
  assert.equal(read().engine.inFlight, 0)
  assert.equal(read().lifecycle, 'loaded')
})

test('C04 manual restart revokes old proactivity token before replacement while old model is unresolved', async t => {
  const h = await moduleHarness(t)
  const gate = deferred(), entered = deferred()
  h.services.llm.complete = async () => { entered.resolve(); await gate.promise; return { ok: true, text: 'stale-model-result' } }
  const old = h.providers.get('proactivity'), work = old.tick()
  await entered.promise
  const input = { moduleId: 'builtin-proactivity', actionId: 'module.restart', expectedGeneration: h.kernel.actions('builtin-proactivity').expectedGeneration, requestId: 'token-recovery' }
  h.kernel.action(input)
  while (!h.kernel.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  assert.equal(h.kernel.getOperation({ requestId: input.requestId }).operation.status, 'succeeded')
  assert.notEqual(h.providers.get('proactivity'), old)
  gate.resolve()
  assert.equal((await work).reason, 'MODULE_DISABLED')
  assert.equal(h.calls.length, 0); assert.equal(h.store.count('decision'), 0)
})
