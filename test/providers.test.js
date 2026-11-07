import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createProviderRegistry } from '../src/extensions/providers.js'
import { createModuleKernel } from '../src/modules/kernel.js'

const provider = () => ({ start() {}, stop() {}, status() { return { secret: 'not metadata' } } })
const builtin = (id, setup, permissions = ['providers:register']) => ({
  manifest: { id, permissions }, defaultEnabled: true, load: () => ({ setup }),
})

async function harness(t, registry = [], options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-providers-'))
  const providers = createProviderRegistry()
  const kernel = createModuleKernel({ dataDir: root, registry, providerRegistry: providers, ...options })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, providers, kernel }
}

test('provider registry validates fixed slots, builtin source, module identity and provider interface', () => {
  const registry = createProviderRegistry()
  assert.equal(registry.get('reminders'), null)
  assert.equal(registry.get('media'), null)
  for (const name of ['media', 'constructor', '__proto__', '', null]) {
    assert.throws(() => registry.register(name, provider(), { moduleId: 'builtin-a' }), /未知/)
  }
  for (const source of ['external', '', null, true]) {
    assert.throws(() => registry.register('reminders', provider(), { moduleId: 'a', source }), /内置/)
  }
  for (const moduleId of [undefined, null, '', ' ', 1, {}]) {
    assert.throws(() => registry.register('reminders', provider(), { moduleId }), /moduleId/)
  }
  for (const value of [null, [], () => {}, {}, { start() {} }, { stop() {} }, { start() {}, stop() {}, status: {} }]) {
    assert.throws(() => registry.register('reminders', value, { moduleId: 'a' }), /start\/stop/)
  }
  assert.deepEqual(registry.list(), [])
})

test('provider registry rejects duplicate names/modules and exposes only fresh metadata', () => {
  const registry = createProviderRegistry(), first = provider(), second = { start() {}, stop() {} }
  const off = registry.register('reminders', first, { moduleId: 'builtin-a' })
  assert.equal(registry.get('reminders'), first)
  assert.deepEqual(registry.list(), [{ name: 'reminders', moduleId: 'builtin-a', source: 'builtin' }])
  registry.list()[0].moduleId = 'mutated'
  assert.equal(registry.list()[0].moduleId, 'builtin-a')
  for (const moduleId of ['builtin-a', 'builtin-b']) {
    assert.throws(() => registry.register('reminders', second, { moduleId }), /已注册/)
  }
  assert.equal(registry.remove('unknown'), false)
  assert.equal(registry.get('reminders'), first)
  off(); off()
  assert.equal(registry.get('reminders'), null)
  registry.register('reminders', second, { moduleId: 'builtin-a' })
  off()
  assert.equal(registry.get('reminders'), second)
  assert.equal(registry.remove('builtin-a'), true)
  assert.equal(registry.remove('builtin-a'), false)
  registry.register('reminders', first, { moduleId: 'builtin-b' })
  assert.equal(registry.get('reminders'), first)
})

test('provider API is builtin and permission gated; external source spoofing cannot register', async t => {
  const h = await harness(t, [
    builtin('builtin-missing', api => api.providers.register('reminders', provider()), []),
    builtin('builtin-ok', api => api.providers.register('reminders', provider())),
  ])
  const dir = join(h.root, 'external-provider')
  await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({
    id: 'external-provider', entry: 'index.mjs', permissions: ['providers:register'], source: 'builtin', builtin: true,
  }))
  await writeFile(join(dir, 'index.mjs'), `export function setup(api) {
    api.providers.register('reminders', { start() {}, stop() {} }, { source: 'builtin', moduleId: 'builtin-fake' })
  }`)
  await h.kernel.start()
  const records = new Map(h.kernel.list().map(record => [record.id, record]))
  assert.equal(records.get('builtin-ok').status, 'loaded')
  assert.match(records.get('builtin-missing').error, /providers:register/)
  assert.match(records.get('external-provider').error, /内置/)
  assert.equal(records.get('external-provider').source, 'external')
  assert.deepEqual(h.providers.list().map(entry => entry.moduleId), ['builtin-ok'])
})

test('provider registrations clean up on disable, dispose, setup failure and stale API calls', async t => {
  const apis = []
  const h = await harness(t, [builtin('builtin-provider', api => {
    apis.push(api)
    api.providers.register('reminders', provider())
  })])
  await h.kernel.start()
  assert.equal(h.providers.list().length, 1)
  await h.kernel.setEnabled('builtin-provider', false)
  assert.deepEqual(h.providers.list(), [])
  assert.throws(() => apis[0].providers.register('reminders', provider()), /已停止/)
  await h.kernel.setEnabled('builtin-provider', true)
  assert.equal(h.providers.list().length, 1)
  await h.kernel.dispose()
  assert.deepEqual(h.providers.list(), [])
  assert.throws(() => apis[1].providers.register('reminders', provider()), /已停止/)

  const failed = await harness(t, [builtin('builtin-failed', api => {
    api.providers.register('reminders', provider())
    throw new Error('setup failed')
  })])
  await failed.kernel.start()
  assert.equal(failed.kernel.list()[0].status, 'error')
  assert.deepEqual(failed.providers.list(), [])
})

test('competing provider setup failure cannot remove the first registration; missing registry fails safely', async t => {
  const h = await harness(t, ['a', 'b'].map(id => builtin(`builtin-${id}`, api => api.providers.register('reminders', provider()))))
  await h.kernel.start()
  assert.deepEqual(h.kernel.list().map(record => record.status), ['loaded', 'error'])
  assert.equal(h.providers.list()[0].moduleId, 'builtin-a')
  const missing = await harness(t, [builtin('builtin-a', api => api.providers.register('reminders', provider()))], { providerRegistry: null })
  await missing.kernel.start()
  assert.match(missing.kernel.list()[0].error, /注册表不可用/)
})

test('provider subscriptions notify add/remove with isolated immutable metadata and identity-safe disposal', async () => {
  const registry = createProviderRegistry(), events = [], other = []
  assert.throws(() => registry.subscribe(null), /listener/)
  const offBad = registry.subscribe(() => { throw Error('secret listener error') })
  const offAsync = registry.subscribe(async () => { throw Error('secret async error') })
  const off = registry.subscribe(event => { events.push(event); assert.ok(Object.isFrozen(event)) })
  registry.subscribe(event => other.push(event))
  const remove = registry.register('reminders', provider(), { moduleId: 'builtin-test' })
  assert.deepEqual(events, [{ name: 'reminders', moduleId: 'builtin-test' }])
  assert.equal(registry.remove('absent'), false)
  remove(); remove()
  assert.equal(events.length, 2)
  off(); off(); offBad(); offAsync()
  registry.register('reminders', provider(), { moduleId: 'builtin-next' })
  remove()
  registry.remove('builtin-next')
  assert.equal(events.length, 2)
  assert.equal(other.length, 4)
  assert.ok(other.every(event => Object.keys(event).sort().join() === 'moduleId,name'))
  await new Promise(setImmediate)
})

test('provider health separates registration, expected module and actual owner, without executing providers', () => {
  const registry = createProviderRegistry()
  const read = () => registry.health().items.find(item => item.name === 'reminders')
  assert.equal(read().state, 'unknown')
  assert.equal(read().observedAt, null)
  assert.equal(read().expectedModuleId, 'builtin-reminders')
  const off = registry.register('reminders', { start() { throw Error('must not start') }, stop() {}, status() { throw Error('must not probe') } }, { moduleId: 'builtin-test', runtimeGeneration: 'runtime' })
  assert.equal(read().registeredModuleId, 'builtin-test')
  assert.equal(read().owner, null)
  registry.publishHealth('reminders', { owner: 'core', state: 'active', fallback: { active: true, reasonCode: 'PROVIDER_START_FAILED' } })
  assert.equal(read().registeredModuleId, 'builtin-test')
  assert.equal(read().owner, 'core')
  assert.equal(read().ownerModuleId, null)
  assert.equal(read().ownerRuntimeGeneration, null)
  assert.deepEqual(read().fallback, { active: true, reasonCode: 'PROVIDER_START_FAILED' })
  const snapshot = registry.health(); snapshot.items[0].owner = 'module'
  assert.equal(read().owner, 'core')
  const revision = registry.health().revision
  assert.equal(registry.health().revision, revision)
  off()
  assert.equal(read().registeredModuleId, null)
  assert.equal(read().owner, 'core', 'unregistration does not prove owner stopped')
  registry.publishHealth('reminders', { owner: 'module', ownerModuleId: 'builtin-test', ownerRuntimeGeneration: 'runtime', state: 'failed', reasonCode: 'SECRET' })
  assert.equal(read().reasonCode, 'MODULE_HEALTH_UNKNOWN')
  assert.equal(read().ownerRuntimeGeneration, 'runtime')
})
