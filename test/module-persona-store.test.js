import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createModuleKernel } from '../src/modules/kernel.js'
import { createModulePersonaStore } from '../src/modules/persona-store.js'
import { validateManifest } from '../src/modules/manifest.js'
import { createStore } from '../src/cognition/store.js'
import { createPersonaService } from '../src/cognition/persona.js'
import { createPersonaScopedStore, dropPersonaData, MODULE_STORE_KIND, scopedPersonaKind } from '../src/cognition/persona-scope.js'
import { createCognition } from '../src/cognition/index.js'
import { createFakeScheduler } from '../src/cognition/util.js'

function builtin(id, setup, manifest = {}) {
  return { manifest: { id, permissions: ['persona:store'], ...manifest }, defaultEnabled: true, load: () => ({ setup }) }
}

async function harness(t, registry, { fallback = false, personaStore } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-store-'))
  const file = join(root, 'fallback.sqlite')
  if (fallback) await mkdir(file) // SQLite 打开目录失败，沿用真正 JSON fallback。
  const base = createStore({ file: fallback ? file : ':memory:' })
  const persona = createPersonaService({ store: base, getConfig: () => ({}), clock: { now: () => 1000 } })
  persona.ensure()
  const scoped = createPersonaScopedStore({ base, getPersonaId: () => persona.activeId() })
  const kernel = createModuleKernel({ dataDir: root, registry, personaStore: personaStore === undefined ? scoped : personaStore })
  t.after(async () => { await kernel.dispose(); base.close(); await rm(root, { recursive: true, force: true }) })
  return { root, base, persona, scoped, kernel }
}

test('persona store: synchronous minimal API, module namespaces and core kinds isolated on both backends', async t => {
  for (const fallback of [false, true]) await t.test(fallback ? 'json' : 'sqlite', async t => {
    const apis = {}
    const h = await harness(t, ['a', 'a_b'].map(id => builtin(`builtin-${id}`, api => { apis[id] = api })), { fallback })
    assert.equal(h.base.mode, fallback ? 'json' : 'sqlite')
    await h.kernel.start()
    const a = apis.a.personaStore, b = apis.a_b.personaStore
    assert.ok(Object.isFrozen(a))
    assert.deepEqual(Object.keys(a).sort(), ['count', 'get', 'list', 'put', 'remove'])
    for (const forbidden of ['base', 'store', 'dir', 'file', 'sql', 'query', 'scopedKind', 'currentPersonaId']) assert.equal(a[forbidden], undefined)
    h.scoped.put('memory', 'shared', { text: 'core' })
    h.base.put('setting', 'shared', { value: 'global' })
    assert.equal(a.get('shared'), null)
    assert.equal(a.put('shared', { text: 'a' }).then, undefined)
    b.put('shared', 'b')
    a.put('memory', { kind: 'setting', id: 'shared', value: 'opaque' })
    assert.deepEqual(a.get('shared'), { text: 'a' })
    assert.equal(b.get('shared'), 'b')
    assert.equal(a.count(), 2); assert.equal(b.count(), 1)
    assert.deepEqual(b.list(), [{ key: 'shared', value: 'b' }])
    assert.equal(a.list({ limit: 1 }).length, 1)
    assert.equal(b.remove('memory'), false)
    assert.equal(a.remove('shared'), true); assert.equal(a.remove('shared'), false)
    assert.equal(b.get('shared'), 'b')
    assert.equal(h.scoped.get('memory', 'shared').text, 'core')
    assert.equal(h.base.get('setting', 'shared').value, 'global')
    assert.deepEqual(h.base.get(scopedPersonaKind('self', MODULE_STORE_KIND), 'module:builtin-a:memory').value, { kind: 'setting', id: 'shared', value: 'opaque' })
    assert.doesNotMatch(JSON.stringify(a.list()), /persona_self|module:builtin|createdAt|updatedAt/)
  })
})

test('persona store: current persona only, explicit scope/raw-kind arguments denied, delete cleans every module', async t => {
  let a, b
  const h = await harness(t, [builtin('builtin-a', api => { a = api.personaStore }), builtin('builtin-b', api => { b = api.personaStore })])
  await h.kernel.start()
  const other = h.persona.create({ name: 'Other' }).persona.id
  h.persona.activate('self')
  a.put('shared', 'self-a'); b.put('shared', 'self-b')
  h.persona.activate(other)
  assert.equal(a.get('shared'), null); assert.equal(a.count(), 0); assert.deepEqual(b.list(), [])
  a.put('shared', 'other-a'); b.put('shared', 'other-b')
  for (const work of [
    () => a.get('shared', 'self'), () => a.put('shared', 'bad', { personaId: 'self' }),
    () => a.remove('shared', 'self'), () => a.list({ personaId: 'self' }),
    () => a.list({ kind: 'memory' }), () => a.list({}, 'self'), () => a.count('self'),
    () => a.get('persona_self:module_store'), () => a.get('module:builtin-b:shared'),
  ]) assert.throws(work)
  assert.equal(a.get('shared'), 'other-a')
  assert.equal(dropPersonaData({ base: h.base, personaId: 'self' }), 2)
  assert.equal(a.get('shared'), 'other-a'); assert.equal(b.get('shared'), 'other-b')
  h.persona.activate('self')
  assert.equal(a.count(), 0); assert.equal(b.count(), 0)
})

test('persona store: strict safe keys, bounded list and validated module namespaces', async t => {
  let store
  const h = await harness(t, [builtin('builtin-a', api => { store = api.personaStore })])
  await h.kernel.start()
  for (const key of ['', 'A', '_a', '-a', '../memory', 'a/b', 'a:b', 'a.b', 'a b', 'a\n', 'a'.repeat(65), 1, {}, null, undefined]) {
    for (const work of [() => store.get(key), () => store.put(key, 1), () => store.remove(key)]) assert.throws(work, /key/)
  }
  for (const key of ['0', 'a_-09', 'a'.repeat(64)]) assert.equal(store.put(key, key), key)
  for (const options of [null, [], 'x', { limit: 0 }, { limit: -1 }, { limit: 1001 }, { limit: 1.5 }, { limit: '1' }, { limit: NaN }, { limit: Infinity }, { where: () => true }, { offset: 0 }, { [Symbol('scope')]: 'self' }]) assert.throws(() => store.list(options))
  assert.equal(store.list({ limit: 1000 }).length, 3)
  assert.equal(store.list().length, 3)
  for (const moduleId of ['external', 'builtin-../x', 'builtin-A', 'builtin-a:b', 'builtin-' + 'a'.repeat(64), null]) {
    assert.throws(() => createModulePersonaStore({ moduleId }), /命名空间/)
  }
})

test('persona store: clones inputs and all outputs, preserves nested JSON and rejects invalid values without writes', async t => {
  let store
  const h = await harness(t, [builtin('builtin-a', api => { store = api.personaStore })])
  await h.kernel.start()
  const input = { nested: [{ hello: 'world' }], n: null, b: false }
  const returned = store.put('value', input)
  input.nested[0].hello = 'input mutation'; returned.nested[0].hello = 'return mutation'
  const read = store.get('value'); read.nested.push('read mutation')
  const listed = store.list(); listed[0].value.nested[0].hello = 'list mutation'
  assert.deepEqual(store.get('value'), { nested: [{ hello: 'world' }], n: null, b: false })
  const cycle = {}; cycle.self = cycle
  for (const value of [undefined, () => {}, Symbol('x'), 1n, NaN, Infinity, { x: undefined }, [undefined], new Array(1), new Date(), new Map(), new Set(), new Uint8Array(1), /x/, cycle, { [Symbol('x')]: 1 }, { toJSON() { return 'hidden' } }]) {
    assert.throws(() => store.put('value', value), /JSON/)
    assert.equal(store.count(), 1)
    assert.equal(store.get('value').nested[0].hello, 'world')
  }
  for (const value of [null, false, 0, '', [1, true, null]]) assert.deepEqual(store.put('scalar', value), value)
})

test('persona store: 64 KiB UTF-8 JSON value bound including quotes; rejected replacement preserves old value', async t => {
  let store
  const h = await harness(t, [builtin('builtin-a', api => { store = api.personaStore })])
  await h.kernel.start()
  const exact = 'x'.repeat(65534)
  assert.equal(Buffer.byteLength(JSON.stringify(exact)), 65536)
  assert.equal(store.put('max', exact), exact)
  assert.throws(() => store.put('max', exact + 'x'), /64 KiB/)
  assert.equal(store.get('max'), exact)
  assert.throws(() => store.put('multibyte', '中'.repeat(21845)), /64 KiB/)
  assert.throws(() => store.put('escaped', '\n'.repeat(32768)), /64 KiB/)
  assert.equal(store.count(), 1)
})

test('persona store: 1000 records per module/persona, overwrite allowed at quota, remove frees space', async t => {
  let a, b
  const h = await harness(t, [builtin('builtin-a', api => { a = api.personaStore }), builtin('builtin-b', api => { b = api.personaStore })])
  await h.kernel.start()
  for (let i = 0; i < 1000; i++) a.put(`k${i}`, i)
  assert.equal(a.count(), 1000); assert.equal(a.list().length, 100); assert.equal(a.list({ limit: 1000 }).length, 1000)
  assert.throws(() => a.put('overflow', 1), /1000/)
  assert.equal(a.get('overflow'), null); assert.equal(a.count(), 1000)
  assert.equal(a.put('k0', 'updated'), 'updated')
  assert.equal(b.put('overflow', 1), 1)
  assert.equal(a.remove('k1'), true); a.put('replacement', 2); assert.equal(a.count(), 1000)
  const other = h.persona.create({ name: 'Other' }).persona.id
  assert.equal(h.persona.activeId(), other)
  assert.equal(a.put('overflow', 3), 3); assert.equal(a.count(), 1)
  h.persona.activate('self'); assert.equal(a.count(), 1000)
})

test('persona store: permission absent means no API; external declarations/forged builtin rejected before import', async t => {
  let api
  const h = await harness(t, [builtin('builtin-denied', value => { api = value }, { permissions: [] })])
  for (const id of ['external', 'forged']) {
    const dir = join(h.root, id)
    await mkdir(dir)
    await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', permissions: ['persona:store'], builtin: true, source: 'builtin' }))
    await writeFile(join(dir, 'index.mjs'), "throw Error('must not import')")
  }
  await h.kernel.start()
  assert.equal(Object.hasOwn(api, 'personaStore'), false)
  for (const row of h.kernel.list().filter(row => !row.builtin)) {
    assert.equal(row.status, 'error'); assert.match(row.error, /persona:store.*内置/)
    assert.doesNotMatch(row.error, /must not import|未知 permission/)
  }
  assert.throws(() => validateManifest({ id: 'forged', permissions: ['persona:store'], builtin: true }), /仅允许内置/)
})

test('persona store: disable/re-enable/dispose revoke every old method without data loss', async t => {
  const stores = [], cleanup = []
  const h = await harness(t, [builtin('builtin-a', api => {
    stores.push(api.personaStore)
    return () => cleanup.push(assert.throws(() => api.personaStore.put('key', 'bad')))
  })])
  await h.kernel.start()
  stores[0].put('key', 'saved')
  await h.kernel.setEnabled('builtin-a', false)
  const stopped = store => {
    for (const work of [() => store.get('key'), () => store.put('key', 'bad'), () => store.remove('key'), () => store.list(), () => store.count()]) assert.throws(work, /已停止|生命周期/)
  }
  stopped(stores[0])
  await h.kernel.setEnabled('builtin-a', true)
  assert.notEqual(stores[0], stores[1]); stopped(stores[0]); assert.equal(stores[1].get('key'), 'saved')
  await h.kernel.dispose(); stopped(stores[1]); assert.equal(cleanup.length, 2)
  assert.equal(h.scoped.get(MODULE_STORE_KIND, 'module:builtin-a:key').value, 'saved')
})

test('persona store: setup/event failure and dependency reload revoke APIs while retaining committed records', async t => {
  const stores = {}
  const h = await harness(t, [
    builtin('builtin-failed', api => { stores.failed = api.personaStore; stores.failed.put('key', 1); throw Error('setup failed') }),
    builtin('builtin-event', api => { stores.event = api.personaStore; stores.event.put('key', 2); api.on('message', () => { throw Error('event failed') }) }, { permissions: ['persona:store', 'events'] }),
    builtin('builtin-dependent', api => { (stores.dependent ||= []).push(api.personaStore) }, { requires: ['dependency'] }),
  ])
  const dir = join(h.root, 'dependency'); await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id: 'dependency', entry: 'index.mjs' }))
  await writeFile(join(dir, 'index.mjs'), 'export function setup() {}')
  await h.kernel.start()
  assert.throws(() => stores.failed.get('key'), /已停止/)
  stores.dependent[0].put('key', 3)
  await h.kernel.dispatch({ kind: 'message' })
  assert.throws(() => stores.event.count(), /已停止/)
  await h.kernel.reload('dependency')
  assert.equal(stores.dependent.length, 2)
  assert.throws(() => stores.dependent[0].get('key'), /已停止/)
  assert.equal(stores.dependent[1].get('key'), 3)
  await h.kernel.setEnabled('dependency', false)
  assert.throws(() => stores.dependent[1].remove('key'), /已停止/)
  for (const [module, value] of [['failed', 1], ['event', 2], ['dependent', 3]]) assert.equal(h.scoped.get(MODULE_STORE_KIND, `module:builtin-${module}:key`).value, value)
})

test('persona store: unavailable service and backend errors expose no paths, SQL, payload, stack cause or metadata', async t => {
  const secret = '/private/cognition.sqlite SELECT secret chatId=123456 payload=secret'
  const broken = Object.fromEntries(['get', 'put', 'remove', 'list', 'count', 'tx'].map(name => [name, () => { throw Error(secret) }]))
  let store
  const h = await harness(t, [builtin('builtin-a', api => { store = api.personaStore })], { personaStore: broken })
  await h.kernel.start()
  for (const work of [() => store.get('x'), () => store.put('x', 1), () => store.remove('x'), () => store.list(), () => store.count()]) {
    assert.throws(work, error => {
      assert.equal(error.message, '人格仓库操作失败'); assert.equal(error.cause, undefined)
      assert.doesNotMatch(error.stack, /private\/cognition|SELECT|chatId|payload=secret/)
      return true
    })
  }
  let unavailable
  const missing = await harness(t, [builtin('builtin-b', api => { unavailable = api.personaStore })], { personaStore: null })
  await missing.kernel.start()
  assert.throws(() => unavailable.count(), /服务不可用/)
  assert.doesNotMatch(JSON.stringify(h.kernel.list()), /private\/cognition|SELECT|chatId|payload=secret/)
})

test('persona store: production cognition service wiring, restart persistence and persona deletion cleanup', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-persona-store-cognition-'))
  const modules = join(root, 'modules'), cognitionRoot = join(root, 'cognition')
  const makeCognition = () => createCognition({ dataRoot: cognitionRoot, getConfig: () => ({ cognition: { enabled: false } }), scheduler: createFakeScheduler() })
  let cognition = makeCognition(), kernel, store
  const registry = [builtin('builtin-test', api => { store = api.personaStore })]
  const makeKernel = () => createModuleKernel({ dataDir: modules, registry, personaStore: cognition.services.personaStore })
  t.after(async () => { await kernel?.dispose(); await cognition.dispose(); await rm(root, { recursive: true, force: true }) })
  kernel = makeKernel(); await kernel.start()
  assert.ok(cognition.services.personaStore)
  const originalId = cognition.activePersonaId()
  store.put('key', { saved: true })
  await kernel.dispose(); await cognition.dispose()
  cognition = makeCognition(); kernel = makeKernel(); await kernel.start()
  assert.deepEqual(store.get('key'), { saved: true })
  const other = cognition.createPersona({ name: 'Other' }).persona.id
  assert.equal(store.get('key'), null); store.put('key', 'other')
  assert.equal(cognition.deletePersona(originalId).ok, true)
  assert.equal(store.get('key'), 'other')
  // 直接检查旧人格的内部集合，证明 deletePersona 清理了孤儿记录。
  const facade = cognition.services.personaStore
  const originalKind = scopedPersonaKind(originalId, MODULE_STORE_KIND)
  assert.equal(facade.base.count(originalKind), 0)
  assert.equal(cognition.activePersonaId(), other)
  const host = await readFile(new URL('../src/host.js', import.meta.url), 'utf8')
  assert.match(host, /assembleServices\(/)
  const assembly = await readFile(new URL('../src/services/assembly.js', import.meta.url), 'utf8')
  assert.match(assembly, /personaStore: cognition\.services\.personaStore/)
})
