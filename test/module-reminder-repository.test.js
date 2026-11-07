import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createModuleKernel } from '../src/modules/kernel.js'
import { validateManifest } from '../src/modules/manifest.js'
import { createReminderRepository } from '../src/modules/reminder-repository.js'
import { createStore } from '../src/cognition/store.js'
import { createPersonaScopedStore, scopedPersonaKind } from '../src/cognition/persona-scope.js'
import { createReminderService } from '../src/cognition/reminders.js'
import { createCognition } from '../src/cognition/index.js'
import { createFakeScheduler } from '../src/cognition/util.js'
import { normalizeConfig } from '../src/core/config.js'

const permissions = ['reminders:service', 'config:read']
const id = n => `rem_${n.toString(16).padStart(24, '0')}`
const row = (n = 1, patch = {}) => ({
  id: id(n), scopeType: 'private', scopeId: '123', text: 'Reminder', at: 5000, everySeconds: null,
  nextAt: 5000, status: 'active', createdBy: '123', createdAt: 1000, sentCount: 0, lastError: '', ...patch,
})
const builtin = (name, setup, manifest = {}) => ({
  manifest: { id: `builtin-${name}`, permissions, ...manifest }, defaultEnabled: true, load: () => ({ setup }),
})

async function harness(t, registry, { fallback = false, store, getConfig } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reminder-port-'))
  const file = join(root, 'fallback.sqlite')
  if (fallback) await mkdir(file)
  const base = createStore({ file: fallback ? file : ':memory:' })
  let persona = 'self'
  const scoped = createPersonaScopedStore({ base, getPersonaId: () => persona })
  const kernel = createModuleKernel({ dataDir: root, registry, getConfig, personaStore: store === undefined ? scoped : store })
  t.after(async () => { await kernel.dispose(); base.close(); await rm(root, { recursive: true, force: true }) })
  return { root, base, scoped, kernel, activate(value) { persona = value } }
}

test('reminder repository: core rows, CRUD, current status and clones on SQLite and JSON', async t => {
  for (const fallback of [false, true]) await t.test(fallback ? 'json' : 'sqlite', async t => {
    let repo
    const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })], { fallback })
    await h.kernel.start()
    assert.equal(h.base.mode, fallback ? 'json' : 'sqlite')
    assert.ok(Object.isFrozen(repo))
    assert.deepEqual(Object.keys(repo).sort(), ['all', 'capture', 'countActive', 'findDue', 'get', 'list', 'put', 'remove', 'update'])
    for (const key of ['base', 'store', 'kind', 'dir', 'file', 'path', 'sql', 'query', 'scopedKind', 'currentPersonaId']) assert.equal(repo[key], undefined)
    assert.equal(repo.get(id(1)), null)
    assert.equal(repo.update(id(1), { status: 'cancelled' }), null)
    assert.equal(repo.remove(id(1)), false)
    const input = row(), saved = repo.put(input)
    assert.equal(saved.then, undefined)
    assert.deepEqual(saved, row())
    input.text = 'input mutation'; saved.text = 'output mutation'
    repo.get(id(1)).text = 'get mutation'
    repo.list()[0].text = 'list mutation'
    repo.findDue(5000)[0].text = 'due mutation'
    assert.deepEqual(repo.get(id(1)), row())
    assert.equal(h.scoped.get('reminder', id(1)).text, 'Reminder')
    assert.equal(repo.countActive(), 1)
    const patch = { status: 'cancelled', sentCount: 1, lastError: 'SEND_FAILED', nextAt: 6000 }
    const updated = repo.update(id(1), patch)
    patch.status = 'active'; updated.text = 'update mutation'
    assert.equal(repo.get(id(1)).status, 'cancelled')
    assert.equal(repo.countActive(), 0); assert.deepEqual(repo.list(), [])
    assert.equal(repo.list({ status: 'cancelled' }).length, 1)
    assert.deepEqual(repo.findDue(10000), [])
    const replaced = repo.put(row(1, { text: 'replacement', createdAt: 2000, at: null, everySeconds: 60 }))
    assert.equal(replaced.createdAt, 1000)
    assert.equal(replaced.everySeconds, 60); assert.equal(replaced.text, 'replacement')
    h.scoped.put('reminder', id(2), row(2, { status: 'sent' }), { createdAt: 1000 })
    assert.deepEqual(repo.list({ status: 'sent' }), [row(2, { status: 'sent' })])
    assert.doesNotMatch(JSON.stringify(repo.list()), /kind|persona_self|updatedAt/)
    assert.equal(repo.remove(id(1)), true); assert.equal(repo.remove(id(1)), false)
    assert.equal(repo.get(id(1)), null)
  })
})

test('reminder repository: bounds and earliest-due selection before truncation, inclusive now, deterministic ties', async t => {
  let repo
  const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })])
  await h.kernel.start()
  for (let n = 1; n <= 60; n++) repo.put(row(n, { nextAt: n * 1000, createdAt: n * 1000 }))
  repo.put(row(61, { status: 'sent', nextAt: 1 }))
  repo.put(row(62, { status: 'cancelled', nextAt: 1 }))
  repo.put(row(63, { nextAt: 1000 }))
  assert.equal(repo.countActive(), 61)
  assert.equal(repo.list().length, 50)
  assert.equal(repo.list({ limit: 1 })[0].id, id(60))
  assert.deepEqual(repo.findDue(1000).map(r => r.id), [id(1), id(63)])
  assert.equal(repo.findDue(60000).length, 20)
  assert.deepEqual(repo.findDue(60000, 2).map(r => r.id), [id(1), id(63)])
  assert.equal(repo.findDue(60000).at(-1).id, id(19))
  assert.deepEqual(repo.findDue(999), [])
})

test('reminder repository: strict IDs, status, limits, plain options and argument counts', async t => {
  let repo
  const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })])
  await h.kernel.start()
  for (const value of ['', 'rem_x', 'rem_' + 'A'.repeat(24), 'rem_' + 'a'.repeat(25), '../reminder', 'persona_self:reminder', 'memory', 1, null, {}, undefined]) {
    for (const work of [() => repo.get(value), () => repo.remove(value), () => repo.update(value, {}), () => repo.put(row(1, { id: value }))]) assert.throws(work, /ID/)
  }
  for (const value of [0, -1, 1.5, '1', null, NaN, Infinity, 51]) assert.throws(() => repo.list({ limit: value }), /limit/)
  for (const value of [0, -1, 1.5, '1', null, NaN, Infinity, 21]) assert.throws(() => repo.findDue(10000, value), /limit/)
  for (const value of ['', 'all', 'pending', null, 1, {}]) {
    assert.throws(() => repo.list({ status: value }), /status/)
    assert.throws(() => repo.put(row(1, { status: value })), /status/)
    assert.throws(() => repo.update(id(1), { status: value }), /status/)
  }
  for (const options of [null, [], 'x', new Date(), { kind: 'memory' }, { personaId: 'self' }, { path: '/tmp' }, { where: () => true }, { [Symbol('scope')]: 'self' }]) assert.throws(() => repo.list(options))
  for (const work of [
    () => repo.get(), () => repo.get(id(1), 'self'), () => repo.put(), () => repo.put(row(), 'reminder'),
    () => repo.update(id(1)), () => repo.update(id(1), {}, 'self'), () => repo.remove(), () => repo.remove(id(1), 'self'),
    () => repo.list({}, 'self'), () => repo.findDue(), () => repo.findDue(1000, 20, 'self'), () => repo.countActive('self'),
  ]) assert.throws(work, /参数/)
  assert.equal(repo.countActive(), 0)
})

test('reminder repository: row/patch validation rejects unsafe targets, schedules, nonfinite values and arbitrary fields without writes', async t => {
  let repo
  const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })])
  await h.kernel.start()
  repo.put(row())
  for (const patch of [
    { scopeType: 'global' }, ...['', '0', '01', '../1', '1\n', '9007199254740992', 123, null].map(scopeId => ({ scopeId })),
    { createdBy: '' }, { createdBy: 123 }, { text: '' }, { text: ' ' }, { text: '😀'.repeat(501) }, { text: {} },
    { at: null }, { everySeconds: 60 }, { at: null, everySeconds: 59 }, { at: null, everySeconds: 2592001 },
    { at: null, everySeconds: 60.5 }, { at: null, everySeconds: '60' },
    { sentCount: -1 }, { sentCount: 1.5 }, { sentCount: Infinity }, { sentCount: Number.MAX_SAFE_INTEGER + 1 },
    { lastError: '/private/database SELECT secret' }, { lastError: null }, { kind: 'memory' }, { persona: 'other' },
    { personaId: 'other' }, { path: '/tmp' }, { extra: true }, { [Symbol('kind')]: 'setting' },
  ]) {
    assert.throws(() => repo.put(row(1, patch)))
    assert.deepEqual(repo.get(id(1)), row())
  }
  for (const value of [NaN, Infinity, -Infinity, -1, 8640000000000001, '2026-11-07', new Date(), undefined]) {
    for (const field of ['at', 'nextAt', 'createdAt']) assert.throws(() => repo.put(row(1, { [field]: value })))
    assert.throws(() => repo.findDue(value)); assert.throws(() => repo.update(id(1), { nextAt: value }))
  }
  for (const field of Object.keys(row())) {
    const partial = row(); delete partial[field]
    assert.throws(() => repo.put(partial), /完整行/)
  }
  for (const patch of [{ id: id(2) }, { text: 'changed' }, { scopeId: '456' }, { createdAt: 2 }, { at: 1 }, { kind: 'setting' }, { personaId: 'self' }, { sentCount: -1 }, { lastError: 'secret' }, null, []]) assert.throws(() => repo.update(id(99), patch))
  let accessed = false
  const accessor = { get status() { accessed = true; h.activate('other'); return 'sent' } }
  assert.throws(() => repo.update(id(1), accessor)); assert.equal(accessed, false)
  assert.deepEqual(repo.get(id(1)), row())
  assert.equal(repo.put(row(2, { text: '😀'.repeat(500), at: null, everySeconds: 2592000 })).text.length, 1000)
})

test('reminder repository: same ID stays within current persona and core reminder kind; facade internals never used', async t => {
  let repo
  const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })])
  for (const property of ['base', 'scopedKind', 'currentPersonaId']) Object.defineProperty(h.scoped, property, { get() { throw Error('raw access forbidden') } })
  await h.kernel.start()
  h.scoped.put('memory', id(1), { text: 'memory' })
  h.base.put('reminder', id(1), row(1, { text: 'unscoped legacy' }))
  repo.put(row(1, { text: 'self' }))
  h.activate('other')
  assert.equal(repo.get(id(1)), null); assert.equal(repo.countActive(), 0)
  assert.deepEqual(repo.list(), []); assert.deepEqual(repo.findDue(10000), [])
  assert.equal(repo.update(id(1), { status: 'sent' }), null); assert.equal(repo.remove(id(1)), false)
  repo.put(row(1, { text: 'other' })); repo.update(id(1), { status: 'sent' })
  h.activate('self')
  assert.equal(repo.get(id(1)).text, 'self'); assert.equal(repo.countActive(), 1)
  repo.remove(id(1))
  assert.equal(h.base.get(scopedPersonaKind('other', 'reminder'), id(1)).text, 'other')
  assert.equal(h.scoped.get('memory', id(1)).text, 'memory')
  assert.equal(h.base.get('reminder', id(1)).text, 'unscoped legacy')
})

test('reminder repository: core reminder service and port share unchanged row shape and status', async t => {
  let repo
  const config = { access: { ownerQQ: '123' }, cognition: { reminders: { enabled: true } } }
  const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })])
  const service = createReminderService({ store: h.scoped, getConfig: () => config, access: { isOwner: () => true }, clock: { now: () => 1000 } })
  t.after(() => service.dispose())
  await h.kernel.start()
  const added = service.add({ chatType: 'group', chatId: '456', text: 'Core', at: 5000, createdBy: '123' })
  assert.deepEqual(repo.get(added.id), added)
  repo.update(added.id, { status: 'cancelled' })
  assert.deepEqual(service.list({ chatType: 'group', chatId: '456' }), [])
  assert.equal(service.list({ chatType: 'group', chatId: '456', status: 'cancelled' })[0].text, 'Core')
})

test('reminder/config ports: independent permissions, external and forged builtin declarations rejected before import', async t => {
  const apis = {}
  const h = await harness(t, [
    builtin('denied', api => { apis.denied = api }, { permissions: [] }),
    builtin('repo', api => { apis.repo = api }, { permissions: ['reminders:service'] }),
    builtin('config', api => { apis.config = api }, { permissions: ['config:read'] }),
  ])
  for (const [n, permission] of permissions.entries()) {
    const name = `external-${n}`, dir = join(h.root, name)
    await mkdir(dir)
    const manifest = { id: name, entry: 'index.mjs', permissions: [permission], builtin: true, source: 'builtin' }
    await writeFile(join(dir, 'module.json'), JSON.stringify(manifest))
    await writeFile(join(dir, 'index.mjs'), "throw Error('must not import')")
    assert.throws(() => validateManifest(manifest), /仅允许内置/)
  }
  await h.kernel.start()
  assert.equal(Object.hasOwn(apis.denied, 'reminderRepository'), false)
  assert.equal(Object.hasOwn(apis.denied, 'legacyConfig'), false)
  assert.equal(Object.hasOwn(apis.repo, 'legacyConfig'), false)
  assert.equal(Object.hasOwn(apis.config, 'reminderRepository'), false)
  assert.ok(apis.repo.reminderRepository); assert.ok(apis.config.legacyConfig)
  for (const record of h.kernel.list().filter(r => !r.builtin)) {
    assert.equal(record.status, 'error'); assert.match(record.error, /仅允许内置/)
    assert.doesNotMatch(record.error, /must not import|未知 permission/)
  }
})

const calls = repo => [() => repo.get(id(1)), () => repo.list(), () => repo.all(), () => repo.findDue(10000), () => repo.countActive(), () => repo.put(row()), () => repo.update(id(1), { status: 'sent' }), () => repo.remove(id(1))]
function revoked(api) {
  for (const work of [...calls(api.reminderRepository), () => api.legacyConfig.section('cognition.reminders')]) assert.throws(work, /已停止|生命周期/)
}

test('reminder/config ports: disable, cleanup, re-enable and dispose revoke every old method, retaining rows', async t => {
  const apis = []
  let cleaned = 0
  const h = await harness(t, [builtin('test', api => {
    apis.push(api)
    return () => { revoked(api); cleaned++ }
  })])
  await h.kernel.start()
  apis[0].reminderRepository.put(row())
  await h.kernel.setEnabled('builtin-test', false); revoked(apis[0])
  await h.kernel.setEnabled('builtin-test', true); revoked(apis[0])
  assert.notEqual(apis[0].reminderRepository, apis[1].reminderRepository)
  assert.deepEqual(apis[1].reminderRepository.get(id(1)), row())
  await h.kernel.dispose(); revoked(apis[1]); assert.equal(cleaned, 2)
  assert.equal(h.scoped.get('reminder', id(1)).text, 'Reminder')
})

test('reminder/config ports: setup/event failure and dependency reload/disable revoke handles', async t => {
  const apis = {}
  const h = await harness(t, [
    builtin('failed', api => { apis.failed = api; throw Error('setup failed') }),
    builtin('event', api => { apis.event = api; api.on('message', () => { throw Error('event failed') }) }, { permissions: [...permissions, 'events'] }),
    builtin('dependent', api => { (apis.dependent ||= []).push(api) }, { requires: ['dependency'] }),
  ])
  const dir = join(h.root, 'dependency'); await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id: 'dependency', entry: 'index.mjs' }))
  await writeFile(join(dir, 'index.mjs'), 'export function setup() {}')
  await h.kernel.start(); revoked(apis.failed)
  await h.kernel.dispatch({ kind: 'message' }); revoked(apis.event)
  await h.kernel.reload('dependency'); revoked(apis.dependent[0]); assert.equal(apis.dependent.length, 2)
  await h.kernel.setEnabled('dependency', false); revoked(apis.dependent[1])
})

test('reminder repository: missing backend unavailable, backend errors contain no path/SQL/payload', async t => {
  const broken = Object.fromEntries(['get', 'list', 'count', 'put', 'tx', 'remove'].map(key => [key, () => { throw Error('/private/db SELECT secret payload=123') }]))
  for (const store of [null, broken]) {
    let repo
    const h = await harness(t, [builtin('test', api => { repo = api.reminderRepository })], { store })
    await h.kernel.start()
    for (const work of calls(repo)) assert.throws(work, error => {
      assert.equal(error.message, store ? '提醒仓库操作失败' : '提醒仓库服务不可用')
      assert.equal(error.cause, undefined); assert.doesNotMatch(error.stack, /private\/db|SELECT|payload=123/)
      return true
    })
  }
  const stub = createReminderRepository({ store: { get: () => row() }, assertActive() {} })
  assert.deepEqual(stub.get(id(1)), row())
})

test('legacy config: exact path only, normalized current snapshot, clone isolation, no secrets or other config', async t => {
  let api, current = {
    onebot: { accessToken: 'top-secret' }, cognition: { llm: { apiKey: 'llm-secret' }, reminders: {
      enabled: true, maxActive: 2000, minIntervalSeconds: 120, maxIntervalSeconds: 60, tickMs: 1,
      apiKey: 'nested-secret', nested: { secret: 'hidden' },
    } },
  }
  const h = await harness(t, [builtin('test', value => { api = value })], { getConfig: () => current })
  await h.kernel.start()
  const binding = api.legacyConfig
  assert.ok(Object.isFrozen(binding)); assert.deepEqual(Object.keys(binding), ['section'])
  const result = binding.section('cognition.reminders')
  assert.deepEqual(result, normalizeConfig(current).config.cognition.reminders)
  assert.deepEqual(result, { enabled: true, maxActive: 1000, minIntervalSeconds: 120, maxIntervalSeconds: 120, tickMs: 1000 })
  assert.doesNotMatch(JSON.stringify(result), /secret|apiKey|onebot|llm|nested/)
  result.enabled = false
  assert.equal(binding.section('cognition.reminders').enabled, true)
  current.cognition.reminders.maxActive = 4
  assert.equal(binding.section('cognition.reminders').maxActive, 4)
  current = {}
  assert.deepEqual(binding.section('cognition.reminders'), normalizeConfig({}).config.cognition.reminders)
  for (const path of ['cognition', 'cognition.reminders.enabled', 'cognition.reminders.', ' cognition.reminders', 'cognition/reminders', 'cognition.llm', 'onebot.accessToken', '__proto__', null, undefined, ['cognition.reminders'], new String('cognition.reminders')]) assert.throws(() => binding.section(path), /只允许/)
  assert.throws(() => binding.section('cognition.reminders', 'self'), /只允许/)
})

test('legacy config: missing getter uses defaults and getter failures expose no secrets', async t => {
  let binding
  const defaults = await harness(t, [builtin('defaults', api => { binding = api.legacyConfig })])
  await defaults.kernel.start()
  assert.deepEqual(binding.section('cognition.reminders'), normalizeConfig({}).config.cognition.reminders)
  const broken = await harness(t, [builtin('broken', api => { binding = api.legacyConfig })], { getConfig() { throw Error('token=secret /private/config') } })
  await broken.kernel.start()
  assert.throws(() => binding.section('cognition.reminders'), error => {
    assert.equal(error.message, '提醒配置读取失败'); assert.equal(error.cause, undefined)
    assert.doesNotMatch(error.stack, /token=secret|private\/config/)
    return true
  })
})

test('reminder repository: production cognition facade wiring and persistence require no migration or service activation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-reminder-port-cognition-'))
  let cognition, kernel, repo
  const boot = async () => {
    cognition = createCognition({ dataRoot: join(root, 'cognition'), getConfig: () => ({ cognition: { enabled: false } }), scheduler: createFakeScheduler() })
    kernel = createModuleKernel({ dataDir: join(root, 'modules'), personaStore: cognition.services.personaStore,
      registry: [builtin('test', api => { repo = api.reminderRepository })] })
    await kernel.start()
  }
  t.after(async () => { await kernel?.dispose(); await cognition?.dispose(); await rm(root, { recursive: true, force: true }) })
  await boot(); repo.put(row())
  await kernel.dispose(); await cognition.dispose()
  await boot(); assert.deepEqual(repo.get(id(1)), row())
  cognition.createPersona({ name: 'Other' })
  assert.equal(repo.get(id(1)), null); assert.equal(repo.countActive(), 0)
})

test('reminder repository capture pins original persona without exposing identity, and revokes with runtime', async t => {
  let repo
  const h = await harness(t, [builtin('capture', api => { repo = api.reminderRepository })])
  await h.kernel.start()
  repo.put(row())
  const captured = repo.capture()
  assert.ok(Object.isFrozen(captured)); assert.equal(captured.isCurrent(), true)
  for (const key of ['base', 'store', 'kind', 'personaId', 'currentPersonaId', 'scopedKind']) assert.equal(captured[key], undefined)
  h.activate('other')
  assert.equal(captured.isCurrent(), false)
  assert.equal(repo.get(id(1)), null)
  captured.update(id(1), { status: 'sent' })
  assert.equal(captured.get(id(1)).status, 'sent')
  assert.equal(h.base.count('persona_other:reminder'), 0)
  await h.kernel.setEnabled('builtin-capture', false)
  assert.throws(() => captured.get(id(1)), /已停止/)
  assert.throws(() => captured.isCurrent(), /已停止/)
  assert.throws(() => repo.capture(), /已停止/)
  assert.throws(() => repo.all(), /已停止/)
})

test('final reminder boundary: all/capture stay persona-confined on both backends; config is only the global five-field snapshot', async t => {
  for (const fallback of [false, true]) await t.test(fallback ? 'json' : 'sqlite', async t => {
    let api
    const config = { media: { dataDir: '/private/media' }, onebot: { accessToken: 'secret-token' },
      cognition: { reminders: { enabled: true, path: '/private/reminders', personaId: 'other', apiKey: 'secret-key' } } }
    const h = await harness(t, [builtin('final', value => { api = value })], { fallback, getConfig: () => config })
    await h.kernel.start()
    assert.equal(h.base.mode, fallback ? 'json' : 'sqlite')
    const repo = api.reminderRepository, binding = api.legacyConfig
    repo.put(row(1, { text: 'original persona' }))
    const captured = repo.capture()
    h.activate('other')
    assert.deepEqual(repo.all(), []); assert.equal(captured.isCurrent(), false)
    repo.put(row(1, { text: 'current persona' }))
    assert.equal(repo.all()[0].text, 'current persona')
    assert.equal(captured.all()[0].text, 'original persona')
    assert.equal(captured.capture(), captured)
    assert.throws(() => repo.all('active', 'self'), /参数/)
    assert.throws(() => repo.capture('self'), /参数/)
    assert.throws(() => captured.capture('other'), /参数/)
    for (const port of [repo, captured, binding]) {
      assert.ok(Object.isFrozen(port))
      for (const key of ['base', 'store', 'kind', 'path', 'dir', 'file', 'sql', 'personaId', 'currentPersonaId']) {
        assert.equal(Object.hasOwn(port, key), false, key)
      }
    }
    const snapshot = binding.section('cognition.reminders')
    assert.deepEqual(Object.keys(snapshot).sort(),
      ['enabled', 'maxActive', 'minIntervalSeconds', 'maxIntervalSeconds', 'tickMs'].sort())
    assert.doesNotMatch(JSON.stringify(snapshot), /private|secret|path|personaId/)
    snapshot.enabled = false
    assert.equal(binding.section('cognition.reminders').enabled, true)
    for (const path of ['media', 'onebot', 'cognition', 'cognition.reminders.path']) {
      assert.throws(() => binding.section(path), /只允许读取 cognition.reminders/)
    }
    h.activate('self')
    assert.equal(repo.all()[0].text, 'original persona'); assert.equal(captured.isCurrent(), true)
    await h.kernel.setEnabled('builtin-final', false)
    assert.throws(() => captured.all(), /已停止/)
    assert.throws(() => captured.capture(), /已停止/)
    assert.throws(() => binding.section('cognition.reminders'), /已停止/)
  })
})

test('reminder repository: closed admission rejects new captures while accepted persona writes drain, then all leases revoke', () => {
  const base = createStore({ file: ':memory:' })
  let persona = 'self', accepting = true, live = true
  const scoped = createPersonaScopedStore({ base, getPersonaId: () => persona })
  const repository = createReminderRepository({ store: scoped,
    assertActive() { if (!accepting || !live) throw Error('admission closed') },
    assertDrain() { if (!live) throw Error('drain ended') },
  })
  repository.put(row())
  const accepted = repository.capture()
  accepting = false; persona = 'other'
  assert.throws(() => repository.capture(), /admission closed/)
  assert.throws(() => repository.put(row(2)), /admission closed/)
  assert.equal(accepted.isCurrent(), false)
  assert.equal(accepted.get(row().id).sentCount, 0)
  accepted.update(row().id, { status: 'sent', sentCount: 1 })
  persona = 'self'
  assert.equal(scoped.get('reminder', row().id).status, 'sent')
  live = false
  assert.throws(() => accepted.get(row().id), /drain ended/)
  assert.throws(() => accepted.capture(), /drain ended/)
  base.close()
})

test('C04 kernel restart closes repository admission while an accepted provider write drains before replacement', async t => {
  const { createProviderRegistry } = await import('../src/extensions/providers.js')
  const providers = createProviderRegistry()
  const base = createStore({ file: ':memory:' })
  const root = await mkdtemp(join(tmpdir(), 'dsh-c04-drain-'))
  const scoped = createPersonaScopedStore({ base, getPersonaId: () => 'self' })
  let current, captured, release, entered, setups = 0
  const gate = new Promise(resolve => { release = resolve })
  const stopping = new Promise(resolve => { entered = resolve })
  const kernel = createModuleKernel({ dataDir: root, personaStore: scoped, providerRegistry: providers,
    registry: [{ ...builtin('drain', api => {
      current = api.reminderRepository; setups++
      if (setups === 1) { current.put(row()); captured = current.capture() }
      api.providers.register('reminders', { start() {}, async stop() {
        if (setups !== 1) return
        entered(); await gate
        captured.update(row().id, { status: 'sent', sentCount: 1 })
      } })
      providers.publishHealth('reminders', { owner: 'module', ownerModuleId: api.id, ownerRuntimeGeneration: providers.registration('reminders').runtimeGeneration, state: 'active' })
    }, { permissions: ['reminders:service', 'providers:register'] }), provides: ['reminders'] }],
  })
  t.after(async () => { await kernel.dispose(); base.close(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  const old = current
  const input = { moduleId: 'builtin-drain', actionId: 'module.restart', expectedGeneration: kernel.actions('builtin-drain').expectedGeneration, requestId: 'accepted-write' }
  kernel.action(input); await stopping
  assert.throws(() => old.capture(), /停止|结束/)
  assert.throws(() => old.put(row(2)), /停止|结束/)
  assert.equal(captured.get(row().id).status, 'active')
  assert.equal(setups, 1)
  release()
  while (!kernel.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  assert.equal(kernel.getOperation({ requestId: input.requestId }).operation.status, 'succeeded')
  assert.equal(setups, 2)
  assert.equal(current.get(row().id).status, 'sent')
  assert.equal(current.get(row().id).sentCount, 1)
  assert.throws(() => captured.get(row().id), /停止/)
})
