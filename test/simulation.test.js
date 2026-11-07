import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createSimulationService } from '../src/simulation/service.js'
import { createCapturingTransport, createFixtureSources, createVirtualScheduler } from '../src/simulation/adapters.js'
import { assembleServices } from '../src/services/assembly.js'
import { createStore } from '../src/cognition/store.js'
import { defaultConfig } from '../src/core/config.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const message = (requestId, text, chatType = 'private', extra = {}) => ({ requestId, kind: 'message', chatType, text, ...extra })
const sends = state => state.captures.filter(row => row.action === 'send_private_msg' || row.action === 'send_group_msg')
const content = capture => capture.params.message.filter(segment => segment.type === 'text').map(segment => segment.data.text).join('')
async function boot(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-simulation-'))
  const service = createSimulationService({ dataRoot: root })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, service }
}
async function send(service, id, event) {
  const receipt = await service.submit(id, event)
  await service.advance(id, 12000)
  return receipt
}

test('two simulation graphs use real ingress/aggregation/cognition/delivery with private persona, stores and sessions', async t => {
  const { service, root } = await boot(t)
  const environment = { ...process.env }
  const fetchReference = globalThis.fetch
  const options = { persona: { displayName: '甲' }, model: { reply: '甲的回答。' }, typing: true }
  const a = await service.create(options)
  options.persona.displayName = '外部修改'
  const b = await service.create({ persona: { displayName: '乙' }, model: { reply: '乙的回答。' } })
  await send(service, a.id, message('a1', '你好！'))
  let first = await service.read(a.id)
  let second = await service.read(b.id)
  assert.equal(sends(first).length, 1)
  assert.equal(content(sends(first)[0]), '甲的回答。')
  assert.equal(second.captures.length, 0)
  assert.equal(second.stats.raw, 0)
  assert.ok(first.now > second.now)
  assert.notEqual(first.persona.id, second.persona.id)
  assert.equal(first.persona.profile.displayName, '甲')
  assert.equal(second.persona.profile.displayName, '乙')
  assert.ok(first.sessions[0].sessionId.startsWith(a.id + ':1:'))
  assert.equal(first.deliveryReceipts.length, 1)
  assert.equal(first.deliveryReceipts[0].data.parts, 1)
  assert.deepEqual(first.captures.filter(row => row.action === 'set_input_status').map(row => row.params.event_type), [1, 2])
  assert.ok(first.captures.every(row => row.realSend === false && row.environment === 'simulation'))
  await send(service, b.id, message('b1', '你好！', 'group', { addressed: true }))
  second = await service.read(b.id)
  assert.equal(sends(second)[0].action, 'send_group_msg')
  assert.ok(content(sends(second)[0]).includes('乙的回答。'))
  first.transcript.length = 0
  first.captures[0].params.user_id = 'modified'
  assert.equal((await service.read(a.id)).transcript.length, 2)
  assert.equal(globalThis.fetch, fetchReference)
  assert.deepEqual({ ...process.env }, environment)
  const directories = await readdir(root)
  assert.equal(directories.length, 2)
  for (const dir of directories) {
    const cfg = JSON.parse(await readFile(join(root, dir, 'config.json'), 'utf8'))
    assert.equal(cfg.onebot.httpToken, '')
    assert.equal(cfg.onebot.wsUrl, '')
    assert.ok((await readdir(join(root, dir, 'cognition'))).includes('cognition.sqlite'))
    assert.ok((await readFile(join(root, dir, 'events.jsonl'), 'utf8')).includes('910002'))
  }
})

test('commands mutate only their sandbox; access rejects before raw persistence', async t => {
  const { service, root } = await boot(t)
  const a = await service.create({ persona: { displayName: '甲' } })
  const b = await service.create({ persona: { displayName: '乙' }, access: { private: false, group: false } })
  await send(service, a.id, message('help', '/help'))
  assert.match(content(sends(await service.read(a.id))[0]), /可用命令/)
  await send(service, a.id, message('remember', '/remember 只属于甲的记忆'))
  assert.ok((await service.read(a.id)).counts.memory > 0)
  assert.equal((await service.read(b.id)).counts.memory, 0)
  await send(service, a.id, message('active', '/active'))
  const configs = await Promise.all((await readdir(root)).map(async dir => JSON.parse(await readFile(join(root, dir, 'config.json'), 'utf8'))))
  assert.equal(configs.find(cfg => cfg.cognition.persona.profile.displayName === '甲').cognition.proactivity.enabled, true)
  assert.equal(configs.find(cfg => cfg.cognition.persona.profile.displayName === '乙').cognition.proactivity.enabled, false)
  await send(service, a.id, message('quiet', '/quiet'))
  await send(service, a.id, message('like', '/like'))
  await send(service, a.id, message('poke', '/poke'))
  assert.ok((await service.read(a.id)).captures.some(row => row.action === 'send_like'))
  assert.ok((await service.read(a.id)).captures.some(row => row.action === 'friend_poke'))
  const blocked = await service.submit(b.id, message('blocked', '不能进入原始存储'))
  const blockedGroup = await service.submit(b.id, message('blocked_group', '/help', 'group'))
  assert.equal(blocked.reason, 'private_not_allowed')
  assert.equal(blockedGroup.reason, 'group_not_allowed')
  const state = await service.read(b.id)
  assert.equal(state.stats.raw, 0)
  assert.equal(state.captures.length, 0)
  assert.equal(state.access.counters.inboundBlocked, 2)
  assert.equal(state.environment, 'simulation')
})

test('event request IDs deduplicate before admission and reject conflicting replays', async t => {
  const { service } = await boot(t)
  const { id } = await service.create()
  const event = message('same', '你好！')
  const receipt = await service.submit(id, event)
  assert.deepEqual(await service.submit(id, { ...event }), receipt)
  await assert.rejects(service.submit(id, { ...event, text: '冲突' }), /REQUEST_CONFLICT/)
  await service.advance(id, 12000)
  assert.equal((await service.read(id)).stats.raw, 1)
  assert.equal(sends(await service.read(id)).length, 1)
})

test('notices and requests pass normalization, and approval actions remain captures', async t => {
  const { service } = await boot(t)
  const { id } = await service.create()
  for (const [chatType, type] of [['group', 'group_increase'], ['private', 'friend_add']]) {
    await service.submit(id, { requestId: type, kind: 'notice', chatType, type })
  }
  for (const chatType of ['private', 'group']) {
    await service.submit(id, { requestId: `request_${chatType}`, kind: 'request', chatType, type: chatType === 'group' ? 'group' : 'friend' })
  }
  let state = await service.read(id)
  assert.equal(state.notices.length, 2)
  assert.equal(state.requests.length, 2)
  assert.equal(state.captures.length, 0)
  const request = state.requests.find(row => row.type === 'friend')
  await send(service, id, message('approve', `/approve ${request.id} confirm`))
  state = await service.read(id)
  assert.equal(state.requests.length, 1)
  const approval = state.captures.find(row => row.action === 'set_friend_add_request')
  assert.ok(approval)
  assert.equal(approval.realSend, false)
})

test('virtual aggregation and reminder timers advance only on explicit advance', async t => {
  const { service } = await boot(t)
  const { id } = await service.create({ reminders: true })
  await service.submit(id, message('hello', '你好！'))
  assert.equal(sends(await service.read(id)).length, 0)
  await service.advance(id, 100)
  assert.equal(sends(await service.read(id)).length, 0)
  await service.advance(id, 11900)
  assert.equal(sends(await service.read(id)).length, 1)
  await send(service, id, message('reminder', '/remind 60 模拟提醒'))
  let state = await service.read(id)
  const before = sends(state).length
  assert.ok(sends(state).some(row => /提醒/.test(content(row))))
  await service.advance(id, 90000)
  state = await service.read(id)
  assert.equal(sends(state).length, before + 1)
  assert.equal(content(sends(state).at(-1)), '模拟提醒')
})

test('capturing OneBot transport covers sends/uploads/status/social/admin/requests; raw and unknown fail closed', async () => {
  const driver = createVirtualScheduler()
  const transport = createCapturingTransport({ clock: driver })
  const actions = transport.actions
  await actions.sendPrivate('2', 'hello')
  await actions.sendGroup('3', 'hello')
  await actions.uploadGroupFile('3', '/never/read', 'file')
  await actions.uploadPrivateFile('2', '/never/read', 'file')
  await actions.sendLike('2')
  await actions.groupPoke('3', '2')
  await actions.friendPoke('2')
  await actions.setInputStatus('2', 1)
  await actions.setGroupBan('3', '2', 10)
  await actions.setGroupKick('3', '2')
  await actions.setGroupAdmin('3', '2', true)
  await actions.setGroupWholeBan('3', true)
  await actions.setFriendAddRequest('fixture', true)
  await actions.setGroupAddRequest('fixture2', 'add', false)
  await assert.rejects(actions.raw('send_private_msg', { user_id: '2' }), /SIMULATION_ACTION_BLOCKED/)
  await assert.rejects(actions.futureDangerousAction({}), /SIMULATION_ACTION_BLOCKED/)
  await assert.rejects(transport.call('unknown_wire_action', {}), /SIMULATION_ACTION_BLOCKED/)
  assert.equal(transport.captures().length, 17)
  assert.equal(transport.captures().filter(row => row.status === 'blocked').length, 3)
  assert.ok(transport.captures().every(row => !row.realSend))
  transport.close()
  await assert.rejects(actions.sendPrivate('2', 'closed'), /SIMULATION_ACTION_BLOCKED/)
  driver.dispose()
})

test('fixture knowledge never follows URLs; virtual scheduler handles nested async deadlines and cancellation', async () => {
  const sources = createFixtureSources([{ url: 'fixture:one', title: 'topic', text: 'offline evidence' }])
  const source = sources.get('fixture')
  assert.equal((await source.search('topic')).length, 1)
  assert.equal((await source.fetch('fixture:one')).text, 'offline evidence')
  assert.equal(await source.fetch('https://example.invalid'), null)
  const driver = createVirtualScheduler(1000)
  const times = []
  driver.setTimeout(async () => { times.push(driver.now()); await driver.sleep(25); times.push(driver.now()) }, 50)
  await driver.advance(100)
  assert.deepEqual(times, [1050, 1075])
  const sleep = driver.sleep(100)
  driver.dispose()
  await sleep
  await assert.rejects(driver.advance(1), /DISPOSED/)
})

test('reset/delete remove persona/session/store/timer state and do not revive pending work', async t => {
  const { service, root } = await boot(t)
  const { id } = await service.create({ reminders: true, model: { reply: '甲'.repeat(750) } })
  await send(service, id, message('remind', '/remind 60 不应复活'))
  const old = await service.read(id)
  await service.submit(id, message('pending', '还未完成的轮次'))
  // Stop with one part captured and the executor waiting on a virtual inter-part delay.
  let partial
  for (let step = 0; step < 24; step++) {
    await service.advance(id, 500)
    partial = await service.read(id)
    if (sends(partial).length > sends(old).length) break
  }
  assert.equal(sends(partial).length, sends(old).length + 1)
  assert.ok(partial.sessions.length > 0)
  const reset = await service.reset(id)
  assert.equal(reset.generation, 2)
  const fresh = await service.read(id)
  assert.notEqual(old.persona.id, fresh.persona.id)
  assert.deepEqual(fresh.sessions, [])
  assert.deepEqual(fresh.captures, [])
  assert.deepEqual(fresh.receipts, [])
  assert.deepEqual(fresh.transcript, [])
  await service.advance(id, 120000)
  assert.equal((await service.read(id)).captures.length, 0)
  await service.delete(id)
  await assert.rejects(service.read(id), /NOT_FOUND/)
  await assert.rejects(service.advance(id, 1000), /NOT_FOUND/)
  assert.deepEqual(await readdir(root), [])
})

test('simulation backend has separate methods/paths, opaque-frame rejection and no identity/raw/config injection', async t => {
  const { service } = await boot(t)
  const fake = createFakeDsh()
  createRoutes({ ctx: fake.ctx, simulations: service, getConfig: () => ({}), logger: { child() { return this } } })
  const path = '/onebot-qq/api/simulations/'
  let response = await fake.call(path + 'create', {}, { method: 'POST', headers: { origin: 'null' } })
  assert.equal(response.status, 403)
  response = await fake.call(path + 'create', {}, { method: 'GET' })
  assert.equal(response.status, 405)
  for (const input of [{ config: {} }, { personaId: 'live' }, { dataRoot: '../' }, { ownerQQ: '123' }, { model: { apiKey: 'secret' } }, { persona: { secret: 'secret' } }]) {
    response = await fake.call(path + 'create', input, { method: 'POST' })
    assert.equal(response.json.ok, false)
  }
  response = await fake.call(path + 'create', {}, { method: 'POST' })
  assert.equal(response.json.environment, 'simulation')
  const id = response.json.id
  for (const extra of [{ userId: '123' }, { self_id: '123' }, { role: 'admin' }, { raw: { post_type: 'message' } }, { owner: true }, { sender: {} }]) {
    response = await fake.call(path + 'events', { id, event: { ...message('rejected', 'hello'), ...extra } }, { method: 'POST' })
    assert.equal(response.json.ok, false)
  }
  response = await fake.call(path + 'events', { id, event: message('ok', '你好！') }, { method: 'POST' })
  assert.equal(response.json.accepted, true)
  await fake.call(path + 'advance', { id, ms: 12000 }, { method: 'POST' })
  response = await fake.call(path + 'state?id=' + id, undefined, { method: 'GET' })
  assert.equal(response.json.captures.length, 1)
  const blocked = await fake.call(path + 'state?id=' + id, undefined, { method: 'GET', headers: { 'sec-fetch-dest': 'iframe' } })
  assert.equal(blocked.status, 403)
  await fake.call(path + 'reset', { id }, { method: 'POST' })
  response = await fake.call(path + 'state?id=' + id, undefined, { method: 'GET' })
  assert.equal(response.json.captures.length, 0)
  await fake.call(path + 'delete', { id }, { method: 'POST' })
  response = await fake.call(path + 'state?id=' + id, undefined, { method: 'GET' })
  assert.equal(response.json.ok, false)
})

test('one live apply coexists with simulation without live bus/store/persona/send/env/fetch/secret mutation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-simulation-live-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  // Configure the child at process creation; never switch this process's environment or fetch.
  const source = `
    import assert from 'node:assert/strict';
    import { apply } from './src/host.js';
    import { createFakeDsh } from './test/helpers/fake-dsh.js';
    import { redact } from './src/core/redact.js';
    import { channel } from 'node:diagnostics_channel';
    const fake = createFakeDsh();
    const host = apply(fake.ctx, { enabled: false, onebot: { httpToken: 'live-secret-sentinel' } });
    await host.ready;
    const env = { ...process.env }; const fetchRef = globalThis.fetch;
    const active = host.cognition.activePersonaId();
    host.cognition.store.put('setting', 'live-sentinel', { value: 'live' });
    const raw = host.cognition.store.count('raw_event');
    const emitted = fake.emitted.length;
    let networkRequests = 0;
    for (const name of ['undici:request:create', 'http.client.request.start', 'net.client.socket']) channel(name).subscribe(() => networkRequests++);
    let realSends = 0;
    host.gateway.actions.sendMessage = () => { realSends++; throw new Error('LIVE_TRANSPORT_USED') };
    const { id } = await host.simulations.create({ persona: { displayName: 'simulation-only' } });
    await host.simulations.submit(id, { requestId: 'hi', kind: 'message', chatType: 'private', text: '你好！' });
    await host.simulations.advance(id, 12000);
    const state = await host.simulations.read(id);
    assert.equal(state.captures.length, 1);
    assert.equal(networkRequests, 0); assert.equal(realSends, 0); assert.equal(fake.emitted.length, emitted);
    assert.equal(host.cognition.activePersonaId(), active);
    assert.equal(host.cognition.store.count('raw_event'), raw);
    assert.equal(host.cognition.store.get('setting', 'live-sentinel').value, 'live');
    assert.equal(redact('live-secret-sentinel'), '***');
    assert.deepEqual({ ...process.env }, env); assert.equal(globalThis.fetch, fetchRef);
    await host.simulations.dispose(); host.dispose(); await host.modules.dispose();
  `
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(), env: { ...process.env, DSH_BOT_DATA_DIR: root, SIMULATION_SECRET_SENTINEL: 'must-never-copy' }, timeout: 20000,
  })
})


test('shared assembly injects store/config/clock/transport and confines runtime directories and approval state', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-assembly-'))
  const graphs = []
  t.after(async () => {
    for (const { graph, driver } of graphs) {
      driver.dispose(); await graph.cognition.whenIdle(); await graph.modules.dispose(); graph.cognition.dispose(); graph.events.dispose()
    }
    await rm(root, { recursive: true, force: true })
  })
  async function graphAt(name) {
    const driver = createVirtualScheduler()
    const config = defaultConfig()
    config.cognition.enabled = true
    config.cognition.dryRun = false
    config.access.ownerQQ = '2'
    config.cognition.qqAdmin.enabled = true
    config.cognition.qqAdmin.requireApproval = true
    const store = createStore({ file: join(root, name, 'cognition.sqlite'), clock: driver })
    const transport = createCapturingTransport({ clock: driver, namespace: name })
    const graph = assembleServices({ dataRoot: join(root, name), configSnapshot: config, store,
      clock: driver, scheduler: driver, registry: [], discoverExternal: false,
      actionTransport: transport, logger: { debug() {}, warn() {}, info() {} },
    })
    graphs.push({ graph, driver })
    await graph.modulesReady
    assert.equal(graph.cognition.store, store)
    assert.equal(graph.cognition.services.runtime.summary().workspaceDir, join(root, name, 'runtime', 'workspace'))
    return { graph, driver, transport, store }
  }
  const a = await graphAt('a')
  const b = await graphAt('b')
  let serial = 0
  async function command(text) {
    a.graph.ingress.handleRaw({ post_type: 'message', self_id: '1', message_type: 'private',
      user_id: '2', sender: { user_id: '2' }, message_id: ++serial, message: [{ type: 'text', data: { text } }] })
    await a.driver.advance(12000)
  }
  await command('/profile 模拟昵称')
  const pending = a.graph.cognition.services.approvals.list()
  assert.equal(pending.length, 1)
  assert.equal(b.graph.cognition.services.approvals.list().length, 0)
  assert.equal(a.transport.captures().some(row => row.action === 'set_qq_profile'), false)
  await command('/approve ' + pending[0].id + ' confirm')
  assert.equal(a.graph.cognition.services.approvals.get(pending[0].id).status, 'executed')
  assert.equal(a.transport.captures().filter(row => row.action === 'set_qq_profile').length, 1)
  assert.equal(b.transport.captures().length, 0)
  assert.equal(b.store.count('qq_admin_approval'), 0)
})
