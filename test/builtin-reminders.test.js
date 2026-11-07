import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createBuiltinReminders } from '../src/modules/builtin/reminders.js'
import { builtinRegistry } from '../src/modules/registry.js'
import { createModuleKernel } from '../src/modules/kernel.js'
import { createProviderRegistry } from '../src/extensions/providers.js'
import { createReminderService } from '../src/cognition/reminders.js'
import { createCommandService } from '../src/cognition/commands.js'
import { createStore } from '../src/cognition/store.js'
import { createPersonaScopedStore } from '../src/cognition/persona-scope.js'
import { createFakeScheduler } from '../src/cognition/util.js'
import { createAccess } from '../src/core/access.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createOutbound } from '../src/cognition/outbound.js'

const NOW = Date.parse('2026-11-06T12:00:00Z')
const target = { chatType: 'private', chatId: '10001' }
const descriptor = builtinRegistry.find(row => row.manifest.id === 'builtin-reminders')
const flush = () => new Promise(setImmediate)

async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-builtin-reminders-'))
  const scheduler = createFakeScheduler(NOW), clock = { now: scheduler.now }
  const base = createStore({ clock })
  let persona = 'self', service, api
  const store = createPersonaScopedStore({ base, getPersonaId: () => persona })
  const config = { access: { mode: 'allowlist', ownerQQ: '10001', groups: ['20001'], operators: ['10002'] },
    cognition: { reminders: { enabled: true, ...options.config }, permissions: { deniedCommands: [] } } }
  const sent = []
  const access = createAccess({ getConfig: () => config })
  const delivery = options.delivery || createDeliveryService({ outbound: { async deliver(payload) {
    sent.push(payload); return { ok: true }
  } } })
  const core = createReminderService({ store, getConfig: () => config, clock, scheduler,
    outbound: { deliver: payload => delivery.deliver(payload) } })
  const commands = createCommandService({ getConfig: () => config, access, delivery, reminders: core })
  const providers = createProviderRegistry()
  const kernel = createModuleKernel({ dataDir: root, personaStore: store, access, delivery, commands,
    getConfig: () => config, providerRegistry: providers,
    registry: [{ ...descriptor, load: () => ({ setup(value) {
      api = value
      service = createBuiltinReminders({
        legacyConfig: api.legacyConfig, reminderRepository: api.reminderRepository, scheduler: options.nativeScheduler ? api.scheduler : scheduler,
        health: api.health, delivery: api.delivery, access: api.access, log: api.log,
        registerCommand: api.registerCommand, providers: api.providers,
      }, { clock })
      return () => service.dispose()
    } }) }],
  })
  await kernel.start()
  assert.equal(kernel.list()[0].status, 'loaded', kernel.list()[0].error)
  t.after(async () => { await kernel.dispose(); core.dispose(); base.close(); await rm(root, { recursive: true, force: true }) })
  return { api, root, kernel, providers, config, store, base, core, service, scheduler, sent, delivery,
    command: (text, extra = {}) => commands.handle({ ...target, senderId: '10001', text, ...extra }),
    add: (extra = {}) => service.add({ ...target, createdBy: '10001', text: '喝水 💧', everySeconds: 60, ...extra }),
    switchPersona(id) { persona = id },
  }
}

test('builtin reminders descriptor, defaults, validation, scoped list/cancel, duplicate and limits past 50 rows', async t => {
  assert.equal(descriptor.defaultEnabled, true)
  assert.deepEqual(descriptor.provides, ['reminders'])
  const h = await harness(t, { config: { maxActive: 70 } })
  assert.throws(() => h.add({ everySeconds: 59 }), /INVALID_INTERVAL/)
  assert.throws(() => h.add({ at: NOW + 1 }), /INVALID_SCHEDULE/)
  assert.throws(() => h.add({ everySeconds: undefined, at: NOW }), /INVALID_AT/)
  assert.throws(() => h.add({ text: '💧'.repeat(501) }), /INVALID_TEXT/)
  assert.throws(() => h.add({ chatId: '0' }), /INVALID_TARGET/)
  const first = h.add()
  for (let i = 0; i < 60; i++) h.add({ text: `group ${i}`, chatType: 'group', chatId: '20001' })
  assert.throws(() => h.add(), /REMINDER_DUPLICATE/)
  assert.deepEqual(h.service.list(target), [first])
  assert.throws(() => h.service.cancel(first.id, { chatType: 'group', chatId: '20001' }), /REMINDER_NOT_FOUND/)
  assert.equal(h.service.cancel(first.id, target).status, 'cancelled')
  assert.deepEqual(h.service.list(target), [])
  for (let i = 0; i < 10; i++) h.add({ text: `extra ${i}` })
  assert.throws(() => h.add({ text: 'full' }), /MAX_ACTIVE/)
  const disabled = await harness(t, { config: { enabled: false } })
  assert.throws(() => disabled.add(), /REMINDERS_DISABLED/)
  assert.equal((await disabled.command('/reminders')).reply, '提醒未启用（cognition.reminders.enabled）。')
  const binding = disabled.api.legacyConfig.section('cognition.reminders')
  assert.deepEqual(binding, { enabled: false, maxActive: 50, minIntervalSeconds: 60, maxIntervalSeconds: 2592000, tickMs: 30000 })
})

test('builtin reminder commands enforce owner/access/denied before side effects and use command delivery', async t => {
  const h = await harness(t)
  for (const senderId of ['10002', '10003']) {
    assert.deepEqual(await h.command('/remind 60 blocked', { senderId, chatType: 'group', chatId: '20001' }), { handled: true, reply: '' })
  }
  assert.equal((await h.command('/remind 60 blocked', { chatType: 'group', chatId: '20002' })).error, 'ACCESS_DENIED')
  assert.equal(h.api.reminderRepository.countActive(), 0)
  assert.equal(h.sent.length, 0)
  h.config.cognition.permissions.deniedCommands = ['remind']
  assert.equal((await h.command('/remind 60 blocked')).reply, '该命令已被操作员禁用。')
  assert.equal(h.api.reminderRepository.countActive(), 0)
  h.config.cognition.permissions.deniedCommands = []
  assert.match((await h.command('/remind 60 water')).reply, /已创建提醒/)
  assert.equal(h.sent.at(-1).source, 'command')
  assert.equal(h.sent.at(-1).segments.length, 1)
  const row = h.service.list(target)[0]
  assert.match((await h.command('/reminders')).reply, new RegExp(row.id))
  assert.equal((await h.command(`/forgetreminder ${row.id}`)).reply, `已取消提醒 ${row.id}。`)
  await h.kernel.setEnabled('builtin-reminders', false)
  assert.equal(h.providers.get('reminders'), null)
  assert.match((await h.command('/remind 60 fallback')).reply, /已创建提醒/)
  assert.equal(h.core.list(target)[0].text, 'fallback')
})

test('builtin/core reminder commands and persisted business fields have exact parity', async t => {
  const h = await harness(t)
  const scrub = text => text.replace(/rem_[a-f0-9]+/g, 'rem_ID')
  async function scenario() {
    const replies = []
    for (const text of ['/reminders', '/remind', '/remind later text', '/remind 59 short', '/remind 2592001 long',
      '/remind 2020-01-01T00:00:00Z past', '/remind 2099-99-99Tbad invalid', `/remind 60 ${'💧'.repeat(501)}`,
      '/remind 60 water', '/remind 60 water', '/remind 2099-01-01T00:00:00Z future', '/reminders extra',
      '/forgetreminder', '/forgetreminder rem_a', '/reminders', '/help']) {
      replies.push(scrub((await h.command(text)).reply))
    }
    const rows = h.core.list(target)
    for (const row of rows) replies.push(scrub((await h.command(`/forgetreminder ${row.id}`)).reply))
    replies.push((await h.command('/reminders')).reply)
    return { replies, rows: rows.map(({ id, ...row }) => row).sort((a, b) => a.text.localeCompare(b.text)) }
  }
  const moduleResult = await scenario()
  await h.kernel.setEnabled('builtin-reminders', false)
  const coreResult = await scenario()
  assert.deepEqual(moduleResult, coreResult)
  assert.equal(h.store.count('reminder'), 4)
})

test('builtin tick selects earliest 20, recurs from completion, retries safe errors, accepts dry run', async t => {
  let result = { ok: false, error: 'private-secret' }
  const payloads = []
  const h = await harness(t, { delivery: { async deliver(payload) { payloads.push(payload); return result } } })
  const row = h.add({ everySeconds: undefined, at: NOW + 1 })
  h.scheduler.advance(1); await h.service.tick()
  assert.equal(h.store.get('reminder', row.id).lastError, 'SEND_FAILED')
  assert.equal(h.store.get('reminder', row.id).nextAt, NOW + 60001)
  await h.service.tick(); assert.equal(payloads.length, 1)
  result = { ok: false, error: 'RATE_LIMITED' }
  h.scheduler.advance(60000); await h.service.tick()
  assert.equal(h.store.get('reminder', row.id).lastError, 'RATE_LIMITED')
  result = { ok: true, status: 'dry_run' }
  h.scheduler.advance(60000); await h.service.tick()
  assert.equal(h.store.get('reminder', row.id).status, 'sent')
  assert.equal(h.store.get('reminder', row.id).lastError, '')
  assert.equal(payloads[0].source, 'reminder')
  assert.deepEqual(payloads[0].segments, [{ type: 'text', data: { text: row.text } }])
  const repeat = h.add()
  h.scheduler.advance(180000); await h.service.tick()
  assert.equal(h.store.get('reminder', repeat.id).nextAt, h.scheduler.now() + 60000)
  for (let i = 0; i < 25; i++) h.add({ text: `once ${i}`, everySeconds: undefined, at: h.scheduler.now() + 26 - i })
  h.scheduler.advance(26)
  const count = payloads.length
  await h.service.tick()
  assert.equal(payloads.length - count, 20)
  assert.equal(payloads[count].segments[0].data.text, 'once 24')
  await h.service.tick(); assert.equal(payloads.length - count, 25)
})

test('builtin scheduler is one self-rescheduling timeout, no overlap, drains send before disable and clears resources', async t => {
  let release, calls = 0
  const h = await harness(t, { delivery: { deliver() { calls++; return new Promise(resolve => { release = resolve }) } } })
  const set = t.mock.method(h.scheduler, 'setTimeout')
  const clear = t.mock.method(h.scheduler, 'clearTimeout')
  const provider = h.providers.get('reminders')
  provider.start(); provider.start()
  assert.equal(set.mock.callCount(), 1)
  const row = h.add({ everySeconds: undefined, at: NOW + 1 })
  h.scheduler.advance(30000)
  await h.service.tick(); assert.equal(calls, 1)
  assert.equal(set.mock.callCount(), 1)
  let disabled = false
  let entered
  const stopped = new Promise(resolve => { entered = resolve })
  const originalStop = provider.stop
  t.mock.method(provider, 'stop', (...args) => { entered(); return originalStop(...args) })
  const stopping = h.kernel.setEnabled('builtin-reminders', false).then(() => { disabled = true })
  await stopped
  assert.equal(disabled, false)
  release({ ok: true }); await stopping; await flush()
  assert.equal(h.store.get('reminder', row.id).status, 'sent')
  assert.equal(set.mock.callCount(), 1)
  assert.equal(h.providers.get('reminders'), null)
  h.scheduler.advance(60000); assert.equal(calls, 1)
  assert.throws(() => h.api.reminderRepository.get(row.id), /已停止/)
  await h.kernel.setEnabled('builtin-reminders', true)
  h.providers.get('reminders').start()
  await h.kernel.setEnabled('builtin-reminders', false)
  assert.ok(clear.mock.callCount() >= 1)
})

test('builtin in-flight persona pinning, cancellation/removal/replacement survive and stop drains before restart', async t => {
  let release, calls = 0
  const h = await harness(t, { delivery: { deliver() { calls++; return new Promise(resolve => { release = resolve }) } } })
  const row = h.add({ everySeconds: undefined, at: NOW + 1 })
  h.add({ text: 'second', everySeconds: undefined, at: NOW + 2 })
  h.scheduler.advance(2)
  const pending = h.service.tick()
  h.switchPersona('other')
  release({ ok: true }); await pending
  assert.equal(h.base.get('persona_self:reminder', row.id).status, 'sent')
  assert.equal(h.base.count('persona_other:reminder'), 0)
  assert.equal(calls, 1)
  h.switchPersona('self')
  for (const action of ['cancel', 'remove', 'replace']) {
    const old = h.service.list(target)[0]
    const work = h.service.tick()
    if (action === 'cancel') h.service.cancel(old.id, target)
    if (action === 'remove') h.api.reminderRepository.remove(old.id)
    if (action === 'replace') h.api.reminderRepository.put({ ...old, text: 'replacement', nextAt: NOW + 90000 })
    release({ ok: true }); await work
    const current = h.api.reminderRepository.get(old.id)
    if (action === 'cancel') assert.equal(current.status, 'cancelled')
    if (action === 'remove') assert.equal(current, null)
    if (action === 'replace') { assert.equal(current.text, 'replacement'); assert.equal(current.sentCount, 0) }
    if (action !== 'replace') h.add({ text: action, everySeconds: undefined, at: h.scheduler.now() + 1 })
    h.scheduler.advance(1)
  }
})

test('builtin delivery retains real access/rate/leak/dryRun gates without a gateway bypass', async t => {
  let allowed = false, rate = false, gatewayCalls = 0
  const config = { cognition: { dryRun: false }, security: { leakGuard: { enabled: true, action: 'block' } } }
  const outbound = createOutbound({ getConfig: () => config, access: { canSend: () => ({ allowed }) },
    policy: { canSend: () => ({ ok: rate }) }, gateway: { actions: { async sendMessage() { gatewayCalls++; return {} } } } })
  const h = await harness(t, { delivery: createDeliveryService({ outbound }) })
  const row = h.add({ text: 'api_key=abcdefghijklmnopqrstuvwxyz', everySeconds: undefined, at: NOW + 1 })
  h.scheduler.advance(1)
  for (const error of ['ACCESS_DENIED', 'RATE_LIMITED', 'LEAK_BLOCKED']) {
    await h.service.tick()
    assert.equal(h.store.get('reminder', row.id).lastError, error)
    allowed = true
    if (error === 'RATE_LIMITED') rate = true
    h.scheduler.advance(60000)
  }
  config.security.leakGuard.action = 'redact'; config.cognition.dryRun = true
  await h.service.tick()
  assert.equal(h.store.get('reminder', row.id).status, 'sent')
  assert.equal(gatewayCalls, 0)
})

test('access/delivery module APIs enforce builtin permissions, lifecycle and source, and fail closed', async t => {
  const h = await harness(t)
  assert.deepEqual(h.api.access.canSend({ chatType: 'group', chatId: '20002' }), { allowed: false })
  assert.throws(() => h.api.delivery.send({ ...target, text: 'hello', source: 'command' }), /source/)
  await h.api.delivery.send({ ...target, text: ' text ' })
  assert.equal(h.sent.at(-1).source, 'module:builtin-reminders')
  assert.equal(h.sent.at(-1).segments[0].data.text, ' text ')
  await h.kernel.setEnabled('builtin-reminders', false)
  assert.throws(() => h.api.access.canSend(target), /已停止/)
  assert.throws(() => h.api.delivery.send({ ...target, text: 'hello' }), /已停止/)
  const root = await mkdtemp(join(tmpdir(), 'dsh-reminder-api-'))
  const apis = []
  const registry = [[], ['access:check', 'delivery:send']].map((permissions, n) => ({
    manifest: { id: `builtin-port-${n}`, permissions }, defaultEnabled: true,
    load: () => ({ setup(api) { apis.push(api) } }),
  }))
  const kernel = createModuleKernel({ dataDir: root, registry, delivery: h.delivery, access: { canSend() { throw Error('secret') } } })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  for (const work of [() => apis[0].access.canSend(target), () => apis[0].delivery.send({ ...target, text: 'hi' })]) assert.throws(work, /permission/)
  assert.deepEqual(apis[1].access.canSend(target), { allowed: false })
  assert.throws(() => apis[1].delivery.send({ ...target, text: 'hi', source: 'reminder' }), /source/)
  for (const permission of ['access:check', 'delivery:send', 'providers:register']) {
    const id = permission.replace(':', '-')
    const dir = join(root, id); await mkdir(dir)
    await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', permissions: [permission], source: 'builtin' }))
    await writeFile(join(dir, 'index.mjs'), permission === 'providers:register'
      ? `export function setup(api) { api.providers.register('reminders', {start(){},stop(){}}) }` : 'export function setup() { throw Error("must not import") }')
    await kernel.reload(id)
    const record = kernel.list().find(row => row.id === id)
    assert.equal(record.status, 'error'); assert.match(record.error, /内置/)
  }
})

test('production module scheduler releases native timers on disable and suppresses late callbacks', async t => {
  const pending = new Map(), history = []
  let next = 0
  t.mock.method(globalThis, 'setTimeout', fn => { const id = ++next; pending.set(id, fn); history.push(fn); return id })
  t.mock.method(globalThis, 'clearTimeout', id => pending.delete(id))
  const h = await harness(t, { nativeScheduler: true })
  const provider = h.providers.get('reminders')
  provider.start(); provider.start()
  assert.equal(pending.size, 1)
  await h.kernel.setEnabled('builtin-reminders', false)
  assert.equal(pending.size, 0)
  for (const fn of history) fn()
  assert.equal(pending.size, 0)
  assert.equal(h.sent.length, 0)
})

test('synchronous host-style final stop suppresses post-await writes after the store closes', async t => {
  let release
  const h = await harness(t, { delivery: { deliver: () => new Promise(resolve => { release = resolve }) } })
  h.add({ everySeconds: undefined, at: NOW + 1 }); h.scheduler.advance(1)
  const work = h.service.tick()
  const stopping = h.providers.get('reminders').stop({ dispose: true })
  h.base.close()
  release({ ok: true })
  await work; await stopping
})


test('reminder health observes disabled/no-task idle and captured delivery failures', async t => {
  const h = await harness(t, { delivery: { async deliver() { return { ok: false, error: 'PRIVATE_ERROR' } } } })
  const read = () => h.kernel.health('builtin-reminders').items[0]
  await h.service.tick()
  assert.equal(read().health, 'degraded', 'registration alone has not acquired host ownership')
  assert.equal(read().engine.skipped, 1)
  assert.ok(read().reasons.includes('NO_TASK'))
  h.config.cognition.reminders.enabled = false
  await h.service.tick()
  assert.ok(read().reasons.includes('BUSINESS_DISABLED'))
  h.config.cognition.reminders.enabled = true
  h.add()
  await h.scheduler.advance(60000)
  await h.service.tick()
  assert.ok(read().engine.failed >= 1)
  assert.equal(read().lastError.reasonCode, 'REMINDER_TICK_FAILED')
  assert.equal(read().lifecycle, 'loaded')
  assert.doesNotMatch(JSON.stringify(read()), /PRIVATE_ERROR/)
})
