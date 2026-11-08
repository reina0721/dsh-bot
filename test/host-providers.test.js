import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { apply } from '../src/host.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

async function boot(t, { builtin = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-providers-'))
  if (!builtin) {
    await mkdir(join(root, 'modules'))
    await writeFile(join(root, 'modules/state.json'), JSON.stringify({ disabled: ['builtin-reminders'] }))
  }
  const previous = process.env.DSH_BOT_DATA_DIR
  process.env.DSH_BOT_DATA_DIR = root
  const fake = createFakeDsh()
  const host = apply(fake.ctx, { enabled: false })
  t.after(async () => {
    host.dispose()
    await host.ready
    await host.modules.dispose()
    fake.dispose()
    if (previous === undefined) delete process.env.DSH_BOT_DATA_DIR
    else process.env.DSH_BOT_DATA_DIR = previous
    try { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) } catch {}
  })
  const coreStart = t.mock.method(host.cognition.services.reminders, 'start')
  return { host, fake, coreStart }
}

test('host default install starts core reminders exactly once after module setup', async t => {
  const { host, coreStart } = await boot(t)
  assert.equal(coreStart.mock.callCount(), 0)
  assert.deepEqual(host.providerRegistry.list(), [])
  await host.ready
  assert.equal(coreStart.mock.callCount(), 1)
  const health = host.modules.health('builtin-reminders').items[0]
  assert.equal(health.lifecycle, 'disabled')
  assert.equal(health.health, 'stopped')
  assert.equal(health.providers[0].owner, 'core')
  assert.deepEqual(health.providers[0].fallback, { active: true, reasonCode: 'NO_PROVIDER' })
  assert.equal(host.modules.list().filter(record => record.builtin).length, 7)
  host.cognition.startReminders()
  await host.ready
  await host.modules.start()
  assert.equal(coreStart.mock.callCount(), 1)
})

test('host waits for provider start before gateway readiness; provider owns reminders and stops before cognition', async t => {
  const { host, coreStart } = await boot(t)
  const order = []
  let release, started
  const starting = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  host.providerRegistry.register('reminders', {
    async start() {
      assert.ok(host.modules.list().every(record => ['loaded', 'disabled'].includes(record.status)))
      order.push('provider start'); started(); await gate
    },
    stop() { order.push('provider stop'); assert.equal(host.cognition.state.ready, true) },
  }, { moduleId: 'builtin-test' })
  t.mock.method(host.gateway, 'stop', () => { order.push('gateway stop') })
  await starting
  assert.deepEqual(order, ['provider start'])
  const startingHealth = host.providerRegistry.health().items.find(item => item.name === 'reminders')
  assert.equal(startingHealth.state, 'starting')
  assert.equal(startingHealth.ownerModuleId, 'builtin-test')
  assert.equal(coreStart.mock.callCount(), 0)
  release()
  await host.ready
  await host.ready
  assert.deepEqual(order, ['provider start', 'gateway stop'])
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(host.dispose(), undefined)
  assert.equal(host.cognition.state.ready, false)
  host.dispose()
  assert.equal(order.filter(item => item === 'provider stop').length, 1)
})

test('host cleans up failed provider startup then falls back to core once with safe logs', async t => {
  for (const asyncFailure of [false, true]) {
    await t.test(asyncFailure ? 'rejection' : 'throw', async t => {
      const { host, fake, coreStart } = await boot(t)
      let starts = 0, stops = 0
      host.providerRegistry.register('reminders', {
        start() {
          starts++
          if (asyncFailure) return Promise.reject(new Error('secret-start-marker'))
          throw new Error('secret-start-marker')
        },
        async stop() { stops++; assert.equal(coreStart.mock.callCount(), 0) },
      }, { moduleId: 'builtin-test' })
      await host.ready
      await host.ready
      assert.equal(starts, 1)
      assert.equal(stops, 1)
      assert.equal(coreStart.mock.callCount(), 1)
      const health = host.providerRegistry.health().items.find(item => item.name === 'reminders')
      assert.equal(health.registeredModuleId, 'builtin-test')
      assert.equal(health.owner, 'core')
      assert.equal(health.ownerModuleId, null)
      assert.equal(health.ownerRuntimeGeneration, null)
      assert.deepEqual(health.fallback, { active: true, reasonCode: 'PROVIDER_START_FAILED' })
      assert.ok(fake.logs.some(entry => /回退核心提醒/.test(entry.message)))
      assert.ok(fake.logs.every(entry => !entry.message.includes('secret-start-marker')))
      host.dispose()
      assert.equal(stops, 1)
    })
  }
})

test('host uncertain provider stop retains failed ownership and suppresses fallback with synchronous disposal', async t => {
  for (const startFails of [false, true]) {
    await t.test(startFails ? 'fallback' : 'dispose', async t => {
      const { host, coreStart } = await boot(t)
      host.providerRegistry.register('reminders', {
        start() { if (startFails) throw new Error('start failed') },
        stop() { return Promise.reject(new Error('secret-stop-marker')) },
      }, { moduleId: 'builtin-test' })
      await host.ready
      assert.equal(coreStart.mock.callCount(), 0, 'uncertain stop must never start a second scheduler')
      if (startFails) {
        const health = host.providerRegistry.health().items.find(item => item.name === 'reminders')
        assert.equal(health.state, 'failed')
        assert.equal(health.owner, 'module')
        assert.equal(health.ownerModuleId, 'builtin-test')
        assert.equal(health.reasonCode, 'PROVIDER_STOP_FAILED')
        assert.equal(health.fallback.active, false, 'cannot certify fallback ownership after uncertain stop')
      }
      assert.equal(host.dispose(), undefined)
      await new Promise(setImmediate)
      assert.equal(host.cognition.state.ready, false)
    })
  }
})

test('host disposal before modules settle prevents all reminder and gateway startup', async t => {
  const { host, coreStart } = await boot(t)
  const start = t.mock.fn()
  host.providerRegistry.register('reminders', { start, stop() {} }, { moduleId: 'builtin-test' })
  host.dispose()
  await host.ready
  assert.equal(start.mock.callCount(), 0)
  assert.equal(coreStart.mock.callCount(), 0)
})

test('host disposal during asynchronous provider start stops late startup without core fallback', async t => {
  const { host, coreStart } = await boot(t)
  let release, started, stops = 0
  const starting = new Promise(resolve => { started = resolve })
  const gate = new Promise(resolve => { release = resolve })
  host.providerRegistry.register('reminders', {
    async start() { started(); await gate },
    stop() { stops++ },
  }, { moduleId: 'builtin-test' })
  await starting
  host.dispose()
  assert.equal(stops, 1)
  release()
  await host.ready
  assert.equal(stops, 2) // cleanup again after the in-flight start settles
  assert.equal(coreStart.mock.callCount(), 0)
})

test('host production builtin owns reminders; toggles restore core commands and unchanged data', async t => {
  const { host, coreStart } = await boot(t, { builtin: true })
  await host.ready
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(host.providerRegistry.list().find(row => row.name === 'reminders').moduleId, 'builtin-reminders')
  assert.equal(host.modules.list().find(row => row.id === 'builtin-reminders').status, 'loaded')
  for (const [name, id] of [['reminders', 'builtin-reminders'], ['learning', 'builtin-learning'], ['proactivity', 'builtin-proactivity'], ['mediaFeatures', 'builtin-media-features']]) {
    const health = host.modules.health(id).items[0]
    const provider = health.providers.find(item => item.name === name)
    assert.equal(provider.state, 'active')
    assert.equal(provider.owner, 'module')
    assert.equal(provider.ownerModuleId, id)
    assert.equal(provider.ownerRuntimeGeneration, health.runtimeGeneration)
    assert.equal(provider.fallback.active, false)
    assert.equal(health.health, 'healthy', 'successful builtin setup is known idle')
    assert.equal(health.engine.runs, null, 'activation must not invent a business run')
  }
  host.setConfig({ ...host.getConfig(), access: { ownerQQ: '10001' },
    cognition: { ...host.getConfig().cognition, dryRun: true, reminders: { enabled: true } } })
  const settings = host.cognition.services.settings
  settings.patch({ scope: 'profile', id: host.cognition.activePersonaId(),
    revision: settings.view({ scope: 'profile', id: host.cognition.activePersonaId() }).revision, patch: { 'cognition.dryRun': true } })
  const add = t.mock.method(host.cognition.services.reminders, 'add')
  const command = text => host.cognition.services.commands.handle({ text, senderId: '10001', chatType: 'private', chatId: '10001' })
  const created = await command('/remind 60 shared')
  assert.match(created.reply, /已创建提醒/)
  assert.equal(add.mock.callCount(), 0)
  const row = host.cognition.services.reminders.list({ chatType: 'private', chatId: '10001' })[0]
  const stopCore = t.mock.method(host.cognition, 'stopReminders')
  await host.modules.setEnabled('builtin-reminders', false)
  await host.syncReminderOwnership()
  assert.equal(coreStart.mock.callCount(), 1)
  assert.equal(host.providerRegistry.get('reminders'), null)
  assert.equal((await command('/remind 60 shared')).reply, '已有相同活跃提醒。')
  assert.equal(add.mock.callCount(), 1)
  await host.modules.setEnabled('builtin-reminders', true)
  await host.syncReminderOwnership()
  assert.equal(stopCore.mock.callCount(), 1)
  assert.match((await command('/reminders')).reply, new RegExp(row.id))
  assert.equal((await command(`/forgetreminder ${row.id}`)).reply, `已取消提醒 ${row.id}。`)
  assert.equal(host.cognition.services.reminders.list({ chatType: 'private', chatId: '10001' }).length, 0)
  await host.modules.setEnabled('builtin-reminders', false)
  await host.syncReminderOwnership()
  assert.equal(coreStart.mock.callCount(), 2)
})

test('host serializes runtime handoff and waits for old owner before starting replacement or core', async t => {
  const { host, coreStart } = await boot(t)
  await host.ready
  const order = []
  const originalStop = host.cognition.stopReminders
  const coreStop = t.mock.method(host.cognition, 'stopReminders', async () => { order.push('core stop'); await originalStop() })
  let release, entered
  const stopped = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  host.providerRegistry.register('reminders', {
    start() { order.push('first start') },
    async stop() { order.push('first stop'); entered(); await gate; order.push('first drained') },
  }, { moduleId: 'builtin-first' })
  await host.syncReminderOwnership()
  assert.equal(coreStart.mock.callCount(), 1)
  host.providerRegistry.remove('builtin-first')
  await stopped
  host.providerRegistry.register('reminders', {
    start() { order.push('second start') }, stop() { order.push('second stop') },
  }, { moduleId: 'builtin-second' })
  const work = host.syncReminderOwnership()
  await new Promise(setImmediate)
  assert.deepEqual(order, ['core stop', 'first start', 'first stop'])
  assert.equal(coreStart.mock.callCount(), 1)
  const draining = host.providerRegistry.health().items.find(item => item.name === 'reminders')
  assert.equal(draining.state, 'draining')
  assert.equal(draining.ownerModuleId, 'builtin-first')
  assert.equal(draining.registeredModuleId, 'builtin-second')
  release(); await work
  assert.deepEqual(order, ['core stop', 'first start', 'first stop', 'first drained', 'core stop', 'second start'])
  assert.equal(coreStop.mock.callCount(), 2)
  host.providerRegistry.remove('builtin-second')
  await host.syncReminderOwnership()
  assert.equal(coreStart.mock.callCount(), 2)
})

test('host runtime provider failure drains failed owner and resumes core without repeated startup', async t => {
  const { host, coreStart } = await boot(t)
  await host.ready
  const order = []
  host.providerRegistry.register('reminders', {
    start() { order.push('start'); throw Error('private failure') },
    stop() { order.push('stop') },
  }, { moduleId: 'builtin-failed-runtime' })
  await host.syncReminderOwnership()
  await host.syncReminderOwnership()
  assert.deepEqual(order, ['start', 'stop'])
  assert.equal(coreStart.mock.callCount(), 2)
})

test('host waits for a real in-flight core reminder to commit before activating a provider', async t => {
  const { host } = await boot(t)
  await host.ready
  host.setConfig({ ...host.getConfig(), access: { ownerQQ: '10001' },
    cognition: { ...host.getConfig().cognition, reminders: { enabled: true } } })
  let release, starts = 0
  t.mock.method(host.cognition.services.outbound, 'deliver', () => new Promise(resolve => { release = resolve }))
  const row = host.cognition.services.reminders.add({ chatType: 'private', chatId: '10001', createdBy: '10001', text: 'drain', everySeconds: 60 })
  host.cognition.services.personaStore.put('reminder', row.id, { ...row, nextAt: 0 })
  const pending = host.cognition.services.reminders.tick()
  host.providerRegistry.register('reminders', {
    start() {
      starts++
      assert.equal(host.cognition.services.personaStore.get('reminder', row.id).sentCount, 1)
    }, stop() {},
  }, { moduleId: 'builtin-drain' })
  const work = host.syncReminderOwnership()
  await new Promise(setImmediate)
  assert.equal(starts, 0)
  release({ ok: true }); await pending; await work
  assert.equal(starts, 1)
})

test('host final dispose reaches the provider while runtime handoff is waiting for its stop', async t => {
  const { host, coreStart } = await boot(t)
  await host.ready
  let release, entered
  const stopped = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const options = []
  host.providerRegistry.register('reminders', {
    start() {},
    stop(value) { options.push(value); entered(); return gate },
  }, { moduleId: 'builtin-drain-dispose' })
  await host.syncReminderOwnership()
  host.providerRegistry.remove('builtin-drain-dispose')
  await stopped
  const work = host.syncReminderOwnership()
  assert.equal(host.dispose(), undefined)
  assert.deepEqual(options, [{ dispose: false }, { dispose: true }])
  release(); await work
  assert.equal(coreStart.mock.callCount(), 1)
})

test('host treats re-registration of the same provider object as a fresh ownership generation', async t => {
  const { host } = await boot(t)
  await host.ready
  let starts = 0, stops = 0
  const provider = { start() { starts++ }, stop() { stops++ } }
  host.providerRegistry.register('reminders', provider, { moduleId: 'builtin-same' })
  await host.syncReminderOwnership()
  host.providerRegistry.remove('builtin-same')
  host.providerRegistry.register('reminders', provider, { moduleId: 'builtin-same' })
  await host.syncReminderOwnership()
  assert.equal(starts, 2)
  assert.equal(stops, 1)
})


test('host learning/media/proactivity provider toggles never restart reminder ownership', async t => {
  const { host, coreStart } = await boot(t, { builtin: true })
  await host.ready
  const reminder = host.providerRegistry.get('reminders')
  const coreStop = t.mock.method(host.cognition, 'stopReminders')
  for (const id of ['builtin-learning', 'builtin-media-features', 'builtin-proactivity']) for (const enabled of [false, true, false, true]) {
    await host.modules.setEnabled(id, enabled)
    const providerHealth = host.modules.health(id).items[0].providers[0]
    assert.equal(providerHealth.state, enabled ? 'active' : 'unowned')
    assert.equal(providerHealth.owner, enabled ? 'module' : null)
    assert.equal(providerHealth.fallback.active, false)
    await new Promise(setImmediate)
    assert.equal(host.providerRegistry.get('reminders'), reminder)
  }
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(coreStop.mock.callCount(), 0)
})

test('host actions: reminder restart holds ownership through STOP_PENDING and never starts fallback or replacement early', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, coreStart } = await boot(t, { builtin: true })
  await host.ready
  const old = host.providerRegistry.get('reminders')
  const generation = host.modules.actions('builtin-reminders').expectedGeneration
  let release, entered, stops = 0
  const stopped = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.mock.method(old, 'stop', async () => { stops++; entered(); await gate })
  const input = { moduleId: 'builtin-reminders', actionId: 'module.restart', expectedGeneration: generation, requestId: 'host-restart' }
  host.modules.action(input)
  await stopped
  t.mock.timers.tick(10000)
  assert.equal(host.modules.getOperation({ requestId: input.requestId }).operation.status, 'STOP_PENDING')
  assert.equal(host.providerRegistry.get('reminders'), old)
  assert.equal(host.modules.list().find(x => x.id === input.moduleId).runtimeGeneration, generation)
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(host.providerRegistry.health().items.find(x => x.name === 'reminders').state, 'draining')
  for (let i = 0; i < 5; i++) { host.modules.health(); host.modules.action(input); await host.syncReminderOwnership() }
  assert.equal(stops, 1)
  assert.equal(coreStart.mock.callCount(), 0)
  release()
  while (!host.modules.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  const result = host.modules.getOperation({ requestId: input.requestId }).operation
  assert.equal(result.status, 'succeeded')
  assert.notEqual(host.providerRegistry.get('reminders'), old)
  assert.notEqual(result.resultRuntimeGeneration, generation)
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(stops, 1)
  assert.equal(host.providerRegistry.health().items.find(x => x.name === 'reminders').state, 'active')
  t.mock.timers.reset()
})

test('host actions: failed reminder drain keeps owner/runtime, blocks new owners and never automatically retries', async t => {
  const { host, coreStart } = await boot(t, { builtin: true })
  await host.ready
  const provider = host.providerRegistry.get('reminders')
  let stops = 0
  t.mock.method(provider, 'stop', () => { stops++; throw Error('private-stop-error') })
  const input = { moduleId: 'builtin-reminders', actionId: 'module.restart', expectedGeneration: host.modules.actions('builtin-reminders').expectedGeneration, requestId: 'failed-host-restart' }
  host.modules.action(input)
  while (!host.modules.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  const result = host.modules.getOperation({ requestId: input.requestId }).operation
  assert.equal(result.status, 'failed')
  assert.equal(result.code, 'PROVIDER_STOP_FAILED')
  assert.equal(host.modules.list().find(x => x.id === input.moduleId).runtimeGeneration, input.expectedGeneration)
  assert.equal(host.modules.list().find(x => x.id === input.moduleId).status, 'error')
  for (let i = 0; i < 5; i++) { await host.syncReminderOwnership(); host.modules.health(); host.modules.action(input) }
  const unrelated = { moduleId: 'builtin-sample', actionId: 'module.enable', expectedGeneration: host.modules.actions('builtin-sample').expectedGeneration, requestId: 'unrelated-enable' }
  host.modules.action(unrelated)
  while (!host.modules.getOperation({ requestId: unrelated.requestId }).operation.completedAt) await new Promise(setImmediate)
  assert.equal(host.modules.getOperation({ requestId: unrelated.requestId }).operation.status, 'succeeded')
  assert.equal(stops, 1, 'unrelated reconciliation must not retry a failed drain')
  assert.equal(coreStart.mock.callCount(), 0)
  assert.equal(host.providerRegistry.get('reminders'), provider)
  const owner = host.providerRegistry.health().items.find(x => x.name === 'reminders')
  assert.equal(owner.state, 'failed')
  assert.equal(owner.ownerRuntimeGeneration, input.expectedGeneration)
})

test('host actions: synchronous disposal during drain cancels replacement after the same cleanup finishes', async t => {
  const { host } = await boot(t, { builtin: true })
  await host.ready
  const provider = host.providerRegistry.get('reminders')
  const originalStop = provider.stop
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const stopping = new Promise(resolve => { entered = resolve })
  t.mock.method(provider, 'stop', async options => { entered(); await gate; return originalStop(options) })
  const input = { moduleId: 'builtin-reminders', actionId: 'module.restart', requestId: 'dispose-during-drain', expectedGeneration: host.modules.actions('builtin-reminders').expectedGeneration }
  host.modules.action(input); await stopping
  host.dispose()
  release()
  while (!host.modules.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  assert.equal(host.modules.getOperation({ requestId: input.requestId }).operation.status, 'cancelled')
  assert.equal(host.providerRegistry.get('reminders'), null)
})

test('host actions: enabling reminders observes core drain as STOP_PENDING and waits for accepted core write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, coreStart } = await boot(t)
  await host.ready
  host.setConfig({ ...host.getConfig(), access: { ownerQQ: '10001' }, cognition: { ...host.getConfig().cognition, reminders: { enabled: true } } })
  let release, entered
  const gate = new Promise(resolve => { release = resolve })
  const sending = new Promise(resolve => { entered = resolve })
  t.mock.method(host.cognition.services.outbound, 'deliver', async () => { entered(); await gate; return { ok: true } })
  const row = host.cognition.services.reminders.add({ chatType: 'private', chatId: '10001', createdBy: '10001', text: 'accepted-core-write', everySeconds: 60 })
  host.cognition.services.personaStore.put('reminder', row.id, { ...row, nextAt: 0 })
  const flight = host.cognition.services.reminders.tick()
  await sending
  const input = { moduleId: 'builtin-reminders', actionId: 'module.enable', expectedGeneration: host.modules.actions('builtin-reminders').expectedGeneration, requestId: 'core-drain-enable' }
  host.modules.action(input)
  await new Promise(setImmediate)
  t.mock.timers.tick(10000)
  assert.equal(host.modules.getOperation({ requestId: input.requestId }).operation.status, 'STOP_PENDING')
  assert.equal(host.providerRegistry.get('reminders'), null)
  assert.equal(host.providerRegistry.health().items.find(x => x.name === 'reminders').owner, 'core')
  release(); await flight
  while (!host.modules.getOperation({ requestId: input.requestId }).operation.completedAt) await new Promise(setImmediate)
  assert.equal(host.modules.getOperation({ requestId: input.requestId }).operation.status, 'succeeded')
  assert.equal(host.cognition.services.personaStore.get('reminder', row.id).sentCount, 1)
  assert.equal(coreStart.mock.callCount(), 1)
  assert.equal(host.providerRegistry.health().items.find(x => x.name === 'reminders').owner, 'module')
})
