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
import { CONFIG_GROUPS } from '../src/core/config.js'
import { createLearningEngine } from '../src/modules/builtin/learning/engine.js'
import { setup } from '../src/modules/builtin/learning/index.js'
import { harness, deferred } from './helpers/learning.js'

const descriptor = builtinRegistry.find(r => r.manifest.id === 'builtin-learning')
test('default autoResearch false has no enqueue/network; manual works; timer starts at 30s then 60s, one due pending per tick', async t => {
  const h = harness(t); h.engine.start(); h.engine.start()
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 30000)
  h.detect(); assert.equal(h.store.count('learning_task'), 0)
  h.seed(); await h.tick(); assert.equal(h.calls.length, 0)
  assert.equal([...h.timers.values()][0].delay, 60000)
  assert.equal((await h.engine.runPending())[0].ok, true)
  h.seed('future', { nextRunAt: h.clock.now() + 1000 }); h.seed('suggested', { status: 'suggested' })
  h.seed('a'); h.seed('b'); h.config.cognition.learning.autoResearch = true
  await h.tick(); assert.equal(h.store.list('learning_task', { where: r => r.status === 'done' }).length, 2)
  assert.equal(h.store.get('learning_task', 'future').attempts, 0); assert.equal(h.store.get('learning_task', 'suggested').attempts, 0)
  h.engine.stop(); h.engine.stop(); assert.equal(h.timers.size, 0)
  assert.equal((await h.engine.runPending()).reason, 'MODULE_DISABLED')
})

test('single-flight and stop/restart during extraction revoke leases before waiting, no late claim or timer', async t => {
  const h = harness(t, { autoResearch: true }); h.engine.start(); h.detect()
  const entered = deferred(), gate = deferred()
  h.services.llm = { async completeJson() { entered.resolve(); await gate.promise; return { ok: true, json: { claim: 'late' } } } }
  const work = h.tick(); await entered.promise
  assert.equal((await h.engine.runPending()).reason, 'busy')
  h.engine.stop(); assert.equal(h.timers.size, 0)
  assert.equal(h.store.list('learning_task')[0].status, 'pending')
  h.detect('stopped'); assert.equal(h.store.count('learning_task'), 1)
  h.services.llm = null
  const replacement = createLearningEngine({ port: h.port, getConfig: () => h.config.cognition.learning, scheduler: h.scheduler })
  replacement.start(); assert.equal((await replacement.runPending())[0].ok, true)
  gate.resolve(); await work
  assert.equal(h.store.count('knowledge_claim'), 1); assert.equal(h.store.count('learning_evidence'), 2)
  assert.equal(h.store.get('unknown', h.store.list('learning_task')[0].unknownId).status, 'resolved')
  assert.equal(h.timers.size, 1); replacement.stop()
})

test('manual gates cognition/learning/pause/private; no evidence fails while preserving unknown; cancel future and retry APIs', async t => {
  const h = harness(t); h.engine.start(); h.seed()
  for (const [object, key, value] of [[h.config.cognition, 'enabled', false], [h.config.cognition, 'paused', true], [h.config.cognition.learning, 'enabled', false]]) {
    const original = object[key]; object[key] = value
    await h.engine.runPending(); assert.equal(h.calls.length, 0); assert.equal(h.store.get('learning_task', 't').attempts, 0)
    object[key] = original
  }
  h.source.search = async () => []
  assert.equal((await h.engine.runPending())[0].error, 'no_evidence')
  assert.equal(h.store.get('unknown', 'ut').status, 'open')
  h.seed('future', { nextRunAt: h.clock.now() + 1000 })
  h.config.cognition.paused = true
  assert.equal(h.engine.cancel('future').status, 'cancelled')
  assert.equal(h.engine.retry('future').status, 'pending')
})

async function moduleHarness(t, { disabled = false, fail = false } = {}) {
  const h = harness(t, { autoResearch: true }), root = await mkdtemp(join(tmpdir(), 'dsh-learning-module-'))
  if (disabled) await writeFile(join(root, 'state.json'), JSON.stringify({ disabled: ['builtin-learning'] }))
  const providers = createProviderRegistry(); let api
  h.services.learningState = () => ({ ready: true, now: h.clock.now() })
  const kernel = createModuleKernel({ dataDir: root, getConfig: () => h.config, personaStore: h.store, providerRegistry: providers,
    cognition: { services: h.services },
    registry: [{ ...descriptor, load: () => ({ setup(value) { api = value; const cleanup = setup(value); if (fail) throw Error('setup failed'); return cleanup } }) }],
  })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  return { ...h, kernel, providers, api: () => api }
}
test('fixed builtin slot/permission, lazy disable, setup failure cleanup and UI metadata; other subscriptions isolated', async t => {
  assert.equal(descriptor.defaultEnabled, true)
  assert.deepEqual(descriptor.manifest.permissions, ['providers:register', 'scheduler', 'config:read', 'learning:service'])
  const registry = createProviderRegistry(), events = [], provider = { start() {}, stop() {}, runPending() {}, cancel() {}, retry() {}, stats() {} }
  assert.throws(() => registry.register('learning', provider, { moduleId: 'builtin-other' }), /builtin-learning/)
  assert.throws(() => registry.register('learning', provider, { moduleId: 'builtin-learning', source: 'external' }), /内置/)
  assert.throws(() => validateManifest({ id: 'external', permissions: ['learning:service'] }), /内置/)
  assert.throws(() => validateManifest({ ...descriptor.manifest, id: 'builtin-other' }, { builtin: true }), /builtin-learning/)
  registry.subscribe(e => { if (['reminders', 'mediaFeatures', 'proactivity'].includes(e.name)) events.push(e) })
  const off = registry.register('learning', provider, { moduleId: 'builtin-learning' }); off(); assert.deepEqual(events, [])
  const h = await moduleHarness(t, { disabled: true })
  assert.equal(h.api(), undefined); assert.equal(h.providers.get('learning'), null)
  h.detect('old'); await h.kernel.setEnabled('builtin-learning', true)
  assert.equal(h.store.count('learning_task'), 0)
  const api = h.api(); assert.ok(api.learning)
  for (const key of ['storage', 'cognition']) assert.throws(() => api[key], /permission/)
  assert.throws(() => api.legacyConfig.section('cognition.proactivity'), /cognition.learning/)
  h.config.cognition.learning.secret = 'SECRET'
  assert.doesNotMatch(JSON.stringify(api.legacyConfig.section('cognition.learning')), /SECRET/)
  const catalog = h.kernel.uiCatalog(); assert.deepEqual(catalog, h.kernel.uiCatalog())
  assert.equal(catalog.items[0].surfaces[0].componentKey, 'learning.preview')
  assert.deepEqual(catalog.items[0].surfaces.map(s => s.hook), ['module.detail', 'module.config'])
  assert.equal(CONFIG_GROUPS.flatMap(g => g.fields).filter(f => f.module === 'builtin-learning').length, 16)
  h.detect('new'); assert.equal(h.store.count('learning_task'), 1)
  const old = h.providers.get('learning')
  await h.kernel.setEnabled('builtin-learning', false)
  assert.equal(h.providers.get('learning'), null); assert.equal((await old.runPending()).reason, 'MODULE_DISABLED')
  h.detect('disabled'); assert.equal(h.store.count('learning_task'), 1)
  assert.throws(() => api.learning.pending({}), /停止/)
  await h.kernel.setEnabled('builtin-learning', true)
  assert.notEqual(h.providers.get('learning'), old)
  assert.equal((await h.providers.get('learning').runPending())[0].ok, true)
  assert.equal(h.store.count('knowledge_claim'), 1)
  const failed = await moduleHarness(t, { fail: true })
  assert.equal(failed.kernel.list()[0].status, 'error'); assert.equal(failed.providers.get('learning'), null)
  failed.detect('failed'); assert.equal(failed.store.count('learning_task'), 0)
})

test('core owns no learning timer/runner; read APIs preserve old records; facades use active provider only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-learning-core-')), h = harness(t)
  const registry = createProviderRegistry(), delays = []
  const cognition = createCognition({ dataRoot: root, getConfig: () => h.config, providerRegistry: registry, scheduler: { setTimeout(fn, ms) { delays.push(ms); return 1 }, clearTimeout() {}, dispose() {} } })
  t.after(async () => { cognition.dispose(); await rm(root, { recursive: true, force: true }) })
  assert.equal(cognition.state.ready, true); assert.equal(cognition.services.knowledge.runPending, undefined); assert.equal(cognition.services.knowledge.runTask, undefined)
  assert.ok(!delays.includes(30000)); assert.ok(!delays.includes(60000))
  for (const call of [() => cognition.runLearning(), () => cognition.retryTask('old'), () => cognition.cancelTask('old')]) assert.equal((await call()).reason, 'MODULE_DISABLED')
  const store = cognition.state.scopedStore
  store.put('learning_task', 'old', { id: 'old', status: 'suggested', attempts: 2, plan: ['original'] })
  store.put('knowledge_claim', 'claim-old', { id: 'claim-old', claim: 'original' })
  store.put('learning_evidence', 'e-old', { id: 'e-old', taskId: 'old' })
  assert.equal(cognition.learningTasks()[0].id, 'old'); assert.equal(cognition.claims()[0].claim, 'original')
  const provider = { start() {}, stop() {}, runPending: q => q, retry: id => id, cancel: id => id, stats() {} }
  const off = registry.register('learning', provider, { moduleId: 'builtin-learning' })
  assert.deepEqual(await cognition.runLearning({ max: 2 }), { max: 2 }); assert.equal(cognition.retryTask('old'), 'old'); assert.equal(cognition.cancelTask('old'), 'old')
  off(); assert.equal((await cognition.runLearning()).reason, 'MODULE_DISABLED')
  assert.equal(store.get('learning_evidence', 'e-old').taskId, 'old')
})

test('kernel disable during model await returns immediately and prevents late claim/unknown writes; re-enable permits manual', async t => {
  const h = await moduleHarness(t)
  const entered = deferred(), gate = deferred()
  h.services.llm = { async completeJson() { entered.resolve(); await gate.promise; return { ok: true, json: { claim: 'late' } } } }
  h.detect('before'); const work = h.providers.get('learning').runPending(); await entered.promise
  await h.kernel.setEnabled('builtin-learning', false)
  assert.equal(h.providers.get('learning'), null)
  h.detect('during'); assert.equal(h.store.count('learning_task'), 1)
  gate.resolve(); await work
  assert.equal(h.store.count('knowledge_claim'), 0)
  assert.equal(h.store.list('unknown').every(u => u.status === 'open'), true)
  h.config.cognition.learning.autoResearch = false; h.services.llm = null
  await h.kernel.setEnabled('builtin-learning', true)
  assert.equal(h.store.count('learning_task'), 1)
  assert.equal((await h.providers.get('learning').runPending())[0].ok, true)
})

test('existing task/evidence/claim IDs and persona namespaces survive storage restart and remain readable disabled', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-learning-restart-')), h = harness(t)
  const registry = createProviderRegistry()
  const start = () => createCognition({ dataRoot: root, getConfig: () => h.config, providerRegistry: registry, scheduler: { setTimeout() { return 1 }, clearTimeout() {}, dispose() {} } })
  let cognition = start()
  t.after(async () => { cognition.dispose(); await rm(root, { recursive: true, force: true }) })
  let store = cognition.state.scopedStore
  store.put('unknown', 'legacy-u', { id: 'legacy-u', surface: 'old', status: 'open', scopeType: 'group' })
  store.put('learning_task', 'legacy-t', { id: 'legacy-t', unknownId: 'legacy-u', surface: 'old', status: 'pending', attempts: 2, nextRunAt: 0 })
  store.put('learning_evidence', 'legacy-e', { id: 'legacy-e', taskId: 'legacy-t', excerpt: 'existing evidence' })
  store.put('knowledge_claim', 'legacy-c', { id: 'legacy-c', claim: 'existing claim' })
  cognition.dispose(); cognition = start(); store = cognition.state.scopedStore
  assert.equal(cognition.learningTasks()[0].id, 'legacy-t'); assert.equal(cognition.claims()[0].id, 'legacy-c')
  assert.equal(store.get('learning_evidence', 'legacy-e').excerpt, 'existing evidence')
  assert.equal(cognition.store.count('persona_self:learning_task'), 1)
  assert.equal((await cognition.runLearning()).reason, 'MODULE_DISABLED')
  const source = { id: 'fake', async search() { return [{ url: 'https://a.example', snippet: 'new evidence' }] } }
  cognition.registerKnowledgeSource(source)
  const kernel = createModuleKernel({ dataDir: join(root, 'modules'), getConfig: () => h.config, personaStore: store, cognition, providerRegistry: registry, registry: [descriptor] })
  try {
    await kernel.start(); assert.equal((await cognition.runLearning())[0].ok, true)
    assert.equal(store.get('learning_task', 'legacy-t').attempts, 3)
    assert.equal(store.get('learning_evidence', 'legacy-e').excerpt, 'existing evidence')
    assert.equal(store.get('knowledge_claim', 'legacy-c').claim, 'existing claim')
    await kernel.setEnabled('builtin-learning', false)
    assert.equal(cognition.claims().length, 2)
  } finally { await kernel.dispose() }
})

test('background tick waits for an admitted manual flight before arming its next 60s timeout', async t => {
  const h = harness(t, { autoResearch: true }), entered = deferred(), gate = deferred()
  h.seed(); h.engine.start()
  h.source.search = async () => { entered.resolve(); await gate.promise; return [{ url: 'https://a.example', snippet: 'evidence' }] }
  const manual = h.engine.runPending(); await entered.promise
  const tick = h.tick(); await new Promise(setImmediate)
  assert.equal(h.timers.size, 0)
  gate.resolve(); await manual; await tick
  assert.equal(h.timers.size, 1); assert.equal([...h.timers.values()][0].delay, 60000)
  assert.equal(h.store.get('learning_task', 't').attempts, 1)
})


test('learning health records no-task/disabled idle and captured research failure', async t => {
  const h = await moduleHarness(t)
  const read = () => h.kernel.health('builtin-learning').items[0]
  const provider = h.providers.get('learning')
  await provider.runPending()
  assert.equal(read().health, 'healthy')
  assert.equal(read().reasonCode, 'NO_TASK')
  h.config.cognition.learning.enabled = false
  await provider.runPending()
  assert.equal(read().reasonCode, 'BUSINESS_DISABLED')
  h.config.cognition.learning.enabled = true
  h.seed()
  h.source.search = async () => []
  await provider.runPending()
  assert.equal(read().health, 'degraded')
  assert.equal(read().lastError.reasonCode, 'LEARNING_RUN_FAILED')
  assert.equal(read().engine.failed, 1)
  assert.equal(read().engine.inFlight, 0)
  assert.equal(read().lifecycle, 'loaded')
})
