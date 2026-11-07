import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createModuleKernel } from '../src/modules/kernel.js'
import { builtinRegistry } from '../src/modules/registry.js'
import { createProviderRegistry } from '../src/extensions/providers.js'
import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { createTurnHooks } from '../src/cognition/turn-hooks.js'

async function harness(t, registry = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-module-boundary-'))
  const providers = createProviderRegistry(), planners = createDeliveryRegistry(), hooks = createTurnHooks()
  const calls = []
  const kernel = createModuleKernel({
    dataDir: root, registry, providerRegistry: providers, deliveryRegistry: planners, turnHooks: hooks,
    gateway: { actions: { setInputStatus: (...args) => { calls.push(['status', ...args]) } } },
    delivery: { deliver: (...args) => { calls.push(['delivery', ...args]) } },
    access: { canSend: (...args) => { calls.push(['access', ...args]); return { allowed: true } } },
    commands: { registerCommand: (...args) => { calls.push(['command', ...args]); return () => {} } },
  })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, kernel, providers, planners, hooks, calls }
}

async function external(root, id, permissions, setup, spoof = false) {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({
    id, entry: 'index.mjs', permissions,
    ...(spoof ? { source: 'builtin', builtin: true, provides: ['reminders'], config: { version: 1, fields: [] } } : {}),
  }))
  await writeFile(join(dir, 'index.mjs'), `
    import assert from 'node:assert/strict'
    import { writeFileSync } from 'node:fs'
    writeFileSync(new URL('./imported', import.meta.url), '')
    export function setup(api) {
      assert.equal(api.source, 'external')
      assert.equal(api.builtin, false)
      ${setup}
    }
  `)
  return dir
}

// Some legacy permissions are accepted in the manifest but rejected at use.
// Keep both denial stages explicit without changing the production contract.
const privileged = [
  ['providers:register', "api.providers.register('reminders', { start() {}, stop() {} })", /provider.*内置/, false],
  ['delivery:plan', "api.delivery.registerPlanner({ id: api.id, stage: 'format', plan() {} })", /交付规划.*内置/, false],
  ['turn:lifecycle', 'api.turn.register({ id: api.id, onStart() {} })', /turn.*内置/, false],
  ['status:write', "api.status.setInputStatus('123', 1)", /输入状态.*内置/, false],
  ['scheduler', 'api.scheduler.setTimeout(() => {}, 0)', /setTimeout/, false],
  ['persona:store', "api.personaStore.put('key', {})", /persona:store.*仅允许内置/, true],
  ['reminders:service', 'api.reminderRepository.list()', /reminders:service.*仅允许内置/, true],
  ['media:features', 'api.mediaFeatures.status()', /media:features.*仅允许内置/, true],
  ['config:read', "api.legacyConfig.section('cognition.reminders')", /config:read.*仅允许内置/, true],
  ['commands:override', "api.registerCommand('remind', () => '', { overrideBuiltin: true })", /受保护命令.*内置/, false],
  ['delivery:send', "api.delivery.send({ chatType: 'private', chatId: '123', text: 'denied' })", /delivery:send.*仅允许内置/, true],
  ['access:check', "api.access.canSend({ chatType: 'private', chatId: '123' })", /access:check.*仅允许内置/, true],
]

test('final module boundary: every external privileged use fails, including manifest source spoofing', async t => {
  for (const spoof of [false, true]) {
    for (const [permission, attempt, error, beforeImport] of privileged) {
      await t.test(`${permission}${spoof ? ' / forged builtin' : ''}`, async t => {
        const h = await harness(t)
        const dir = await external(h.root, 'external-test',
          permission === 'commands:override' ? ['commands', permission] : [permission], attempt, spoof)
        const [record] = await h.kernel.start()
        assert.equal(record.status, 'error')
        assert.equal(record.source, 'external'); assert.equal(record.builtin, false)
        assert.match(record.error, error)
        assert.equal(existsSync(join(dir, 'imported')), !beforeImport)
        assert.deepEqual(h.providers.list(), [])
        assert.deepEqual(h.planners.list(), [])
        assert.deepEqual(h.hooks.list(), [])
        assert.deepEqual(h.calls, [])
      })
    }
  }
})

for (const spoof of [false, true]) test(`final module boundary: external ${spoof ? 'with config/source spoof' : 'without config'} has no undeclared privileges or media resources/routes`, async t => {
  const h = await harness(t)
  await external(h.root, 'external-probe', ['commands', 'cognition:read'], `
    for (const key of ['health', 'actions', 'action', 'getOperation', 'scheduler', 'personaStore', 'reminderRepository', 'legacyConfig',
      'media', 'stickers', 'gateway', 'routes', 'http', 'ctx', 'store', 'providerRegistry', 'deliveryRegistry', 'turnHooks']) {
      assert.equal(Object.hasOwn(api, key), false, key)
    }
    if (${spoof}) {
      assert.deepEqual(api.config.get(), {})
      assert.equal(typeof api.config.onChange, 'function')
    } else assert.equal(Object.hasOwn(api, 'config'), false)
    assert.deepEqual(Object.keys(api.providers), ['register'])
    assert.deepEqual(Object.keys(api.cognition).sort(),
      ['snapshot', 'overview', 'memories', 'personDetail', 'relationshipsList', 'timeline'].sort())
    assert.throws(() => api.providers.register('reminders', { start() {}, stop() {} }), /providers:register/)
    assert.throws(() => api.delivery.registerPlanner({ id: api.id, stage: 'format', plan() {} }), /delivery:plan/)
    assert.throws(() => api.turn.register({ id: api.id, onStart() {} }), /turn:lifecycle/)
    assert.throws(() => api.status.setInputStatus('123', 1), /status:write/)
    assert.throws(() => api.delivery.send({ chatType: 'private', chatId: '123', text: 'denied' }), /delivery:send/)
    assert.throws(() => api.access.canSend({ chatType: 'private', chatId: '123' }), /access:check/)
    assert.throws(() => api.registerCommand('remind', () => '', { overrideBuiltin: true }), /内置/)
  `, spoof)
  const [record] = await h.kernel.start()
  assert.equal(record.status, 'loaded'); assert.equal(record.hasConfig, spoof)
  assert.deepEqual(h.providers.list(), []); assert.deepEqual(h.planners.list(), [])
  assert.deepEqual(h.hooks.list(), []); assert.deepEqual(h.calls, [])
})

test('final module boundary: media permissions and provider slot cannot be introduced by a module', async t => {
  const h = await harness(t)
  for (const [n, permission] of ['media', 'media:read', 'media:write', 'media:routes'].entries()) {
    const dir = await external(h.root, `external-media-${n}`, [permission], "throw Error('must not setup')", true)
    assert.equal(existsSync(join(dir, 'imported')), false)
  }
  const records = await h.kernel.start()
  for (const record of records) {
    assert.equal(record.status, 'error'); assert.match(record.error, /未知 permission：media/)
    assert.equal(existsSync(join(h.root, record.id, 'imported')), false)
  }
  assert.throws(() => h.providers.register('media', { start() {}, stop() {} },
    { moduleId: 'builtin-test', source: 'builtin' }), /未知 provider/)
  assert.deepEqual(h.providers.list(), [])
})

test('final module boundary: provider registration needs both loader-owned source and permission', async t => {
  let trustedApi
  const provider = { start() {}, stop() {} }
  const h = await harness(t, [
    { manifest: { id: 'builtin-denied', permissions: [] }, defaultEnabled: true,
      load: () => ({ setup(api) { api.providers.register('reminders', provider) } }) },
    { manifest: { id: 'builtin-trusted', permissions: ['providers:register'] }, defaultEnabled: true,
      load: () => ({ setup(api) { trustedApi = api; api.providers.register('reminders', provider) } }) },
  ])
  const records = await h.kernel.start()
  assert.equal(records[0].status, 'error'); assert.match(records[0].error, /缺少 permission: providers:register/)
  assert.equal(records[1].status, 'loaded')
  assert.equal(trustedApi.source, 'builtin'); assert.equal(trustedApi.builtin, true)
  assert.deepEqual(h.providers.list(), [{ name: 'reminders', moduleId: 'builtin-trusted', source: 'builtin' }])
  await h.kernel.setEnabled('builtin-trusted', false)
  assert.deepEqual(h.providers.list(), [])
  assert.throws(() => trustedApi.providers.register('reminders', provider), /已停止/)
  assert.throws(() => h.providers.register('reminders', provider,
    { moduleId: 'external-test', source: 'external' }), /仅允许内置/)
})

test('final module boundary: production catalog has seven builtins with isolated reminder, proactivity and media providers', async t => {
  const h = await harness(t, builtinRegistry)
  const records = await h.kernel.start()
  assert.deepEqual(records.map(({ id, source, status }) => ({ id, source, status })), [
    { id: 'builtin-learning', source: 'builtin', status: 'loaded' },
    { id: 'builtin-media-features', source: 'builtin', status: 'loaded' },
    { id: 'builtin-proactivity', source: 'builtin', status: 'loaded' },
    { id: 'builtin-reminders', source: 'builtin', status: 'loaded' },
    { id: 'builtin-reply-delivery', source: 'builtin', status: 'loaded' },
    { id: 'builtin-sample', source: 'builtin', status: 'disabled' },
    { id: 'builtin-typing', source: 'builtin', status: 'loaded' },
  ])
  assert.deepEqual(builtinRegistry.filter(item => item.provides?.length).map(item =>
    ({ id: item.manifest.id, provides: [...item.provides] })),
  [{ id: 'builtin-learning', provides: ['learning'] }, { id: 'builtin-proactivity', provides: ['proactivity'] }, { id: 'builtin-media-features', provides: ['mediaFeatures'] }, { id: 'builtin-reminders', provides: ['reminders'] }])
  assert.deepEqual(h.providers.list(), [{ name: 'learning', moduleId: 'builtin-learning', source: 'builtin' }, { name: 'mediaFeatures', moduleId: 'builtin-media-features', source: 'builtin' }, { name: 'proactivity', moduleId: 'builtin-proactivity', source: 'builtin' }, { name: 'reminders', moduleId: 'builtin-reminders', source: 'builtin' }])
  assert.equal(h.providers.get('media'), null)
  assert.equal(h.planners.resolve().id, 'builtin-reply-delivery')
  assert.equal(h.hooks.list()[0].id, 'builtin-typing')
})
