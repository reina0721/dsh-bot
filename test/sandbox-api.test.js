import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { channel } from 'node:diagnostics_channel'
import { createSimulationService } from '../src/simulation/service.js'
import { createSandboxChatApi, SANDBOX_CHAT_LIMITS } from '../src/http/sandbox-chat.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-chat-api-'))
  const simulations = createSimulationService({ dataRoot: root })
  const fake = createFakeDsh()
  let personaId = 'persona-a', serial = 0
  const unavailable = new Proxy({}, { get() { throw Error('LIVE_CAPABILITY_USED') } })
  createRoutes({ ctx: fake.ctx, simulations, cognition: { activePersonaId: () => personaId }, gateway: unavailable, events: unavailable, ingress: unavailable, getConfig: () => { throw Error('LIVE_CONFIG_USED') } })
  t.after(async () => { fake.dispose(); await simulations.dispose(); await rm(root, { recursive: true, force: true }) })
  const call = async (action, body, init) => fake.call('/onebot-qq/api/sandbox/chat/' + action,
    body === undefined ? undefined : { requestId: `test_${++serial}`, ...body }, { method: body === undefined ? 'GET' : 'POST', ...init })
  const ok = async (action, body) => {
    const result = await call(action, body)
    assert.equal(result.status, 200, result.text)
    assert.equal(result.json.ok, true, result.text)
    assert.equal(result.json.environment, 'simulation'); assert.equal(result.json.realSends, 0)
    assert.ok(result.json.requestId)
    for (const key of ['transcript', 'capturedActions', 'receipts', 'deliveryReceipts', 'loops', 'stages']) assert.ok(Array.isArray(result.json[key]))
    return result.json
  }
  return { fake, call, ok, switchPersona: id => { personaId = id } }
}
const message = (chatType, text) => ({ kind: 'message', chatType, text, ...(chatType === 'group' ? { addressed: true } : {}) })
const sends = state => state.captures.filter(row => /^send_(private|group)_msg$/.test(row.action))

test('chat API: private/group text, commands, timer/reminder, captures, receipts/stages and zero network/live capabilities', async t => {
  const h = await harness(t), environment = { ...process.env }, fetchRef = globalThis.fetch
  let network = 0
  const listener = () => network++
  for (const name of ['undici:request:create', 'http.client.request.start', 'net.client.socket']) { channel(name).subscribe(listener); t.after(() => channel(name).unsubscribe(listener)) }
  const { id } = await h.ok('create', {})
  assert.deepEqual((await h.ok('list')).items, [{ id }])
  let state = await h.ok('event', { id, event: message('private', '你好！') })
  assert.equal(sends(state).length, 0)
  state = await h.ok('advance', { id, ms: 100 })
  assert.equal(sends(state).length, 0)
  state = await h.ok('advance', { id, ms: 11900 })
  assert.equal(sends(state)[0].action, 'send_private_msg')
  assert.ok(state.deliveryReceipts.length); assert.ok(state.loops.length); assert.ok(state.stages.length)
  assert.equal(state.boundPersonaId, 'persona-a')
  assert.equal(state.configSnapshot.network, false); assert.equal(state.configSnapshot.model, 'fixture/offline')
  for (const [chatType, text] of [['group', '你好！'], ['private', '/help'], ['group', '/help'], ['private', '/like'], ['private', '/remind 60 离线提醒']]) {
    await h.ok('event', { id, event: message(chatType, text) })
    state = await h.ok('advance', { id, ms: 12000 })
  }
  assert.ok(sends(state).some(row => row.action === 'send_group_msg'))
  assert.ok(state.captures.some(row => row.action === 'send_like'))
  assert.ok(state.transcript.some(row => row.direction === 'out' && /可用命令/.test(row.text)))
  const before = sends(state).length
  state = await h.ok('advance', { id, ms: 120000 })
  assert.ok(sends(state).length > before)
  assert.ok(state.captures.every(row => row.environment === 'simulation' && row.realSend === false))
  const submitted = { requestId: 'dedupe', id, event: message('private', '/help') }
  const first = await h.ok('event', submitted), repeated = await h.ok('event', submitted)
  assert.deepEqual(first.receipt, repeated.receipt)
  assert.equal(repeated.transcript.length, first.transcript.length)
  assert.equal((await h.call('event', { ...submitted, event: message('private', 'different') })).status, 409)
  assert.equal(network, 0); assert.deepEqual({ ...process.env }, environment); assert.equal(globalThis.fetch, fetchRef)
})

test('chat API scopes opaque IDs to current persona; reset/delete clear state and cancel timers', async t => {
  const h = await harness(t), { id } = await h.ok('create', {})
  await h.ok('event', { id, event: message('private', '/remind 60 删除前提醒') })
  const previous = await h.ok('advance', { id, ms: 12000 })
  h.switchPersona('persona-b')
  assert.deepEqual((await h.ok('list')).items, [])
  for (const [action, body] of [['detail?id=' + id, undefined], ['event', { id, event: message('private', 'x') }], ['advance', { id, ms: 10 }], ['reset', { id }], ['delete', { id }]]) {
    const foreign = await h.call(action, body)
    assert.equal(foreign.status, 404); assert.equal(foreign.json.code, 'SIMULATION_NOT_FOUND')
    assert.deepEqual(foreign.json.transcript, [])
  }
  const other = await h.ok('create', {})
  assert.notEqual(other.id, id)
  h.switchPersona('persona-a')
  const fresh = await h.ok('reset', { id })
  assert.equal(fresh.generation, 2); assert.notEqual(fresh.persona.id, previous.persona.id)
  for (const key of ['transcript', 'captures', 'receipts', 'deliveryReceipts', 'loops', 'stages', 'sessions']) assert.deepEqual(fresh[key], [])
  assert.equal((await h.ok('advance', { id, ms: 120000 })).captures.length, 0)
  await h.ok('delete', { id })
  for (const badId of [id, 'unknown', '../live', 'sim_' + 'f'.repeat(36), 'sim_00000000-0000-4000-8000-000000000000']) {
    assert.equal((await h.call('detail?id=' + encodeURIComponent(badId))).json.code, 'SIMULATION_NOT_FOUND')
  }
  assert.deepEqual((await h.ok('list')).items, [])
})

test('chat API rejects opaque frames, wrong method, privileged/raw/unknown fields, oversized and malformed input', async t => {
  const h = await harness(t), { id } = await h.ok('create', {})
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'cross-site' }]) {
    for (const action of ['create', 'event', 'advance', 'reset', 'delete', 'detail', 'list']) {
      const rejected = await h.call(action, {}, { headers })
      assert.equal(rejected.status, 403); assert.equal(rejected.json.environment, 'simulation')
      assert.equal(rejected.json.realSends, 0); assert.ok(rejected.json.requestId)
    }
  }
  assert.equal((await h.call('create', {}, { method: 'GET' })).status, 405)
  assert.equal(h.fake.routes.has('/onebot-qq/api/simulations/create'), false)
  for (const input of [{ personaId: 'live' }, { ownerQQ: '123' }, { config: {} }, { model: { apiKey: 'secret' } }, { persona: {} }, { typing: 1 }]) assert.equal((await h.call('create', input)).status, 400)
  for (const extra of [{ sender: { role: 'owner' } }, { raw: {} }, { action: 'send_group_msg' }, { userId: '123' }, { self_id: '123' }, { requestId: 'injected' }, { role: 'admin' }]) {
    assert.equal((await h.call('event', { id, event: { ...message('private', 'x'), ...extra } })).status, 400)
  }
  for (const event of [message('other', 'x'), message('private', ''), message('private', 'x'.repeat(4001)), { kind: 'unknown', chatType: 'private' }, { kind: 'notice', chatType: 'group', type: 'group_ban' }]) assert.equal((await h.call('event', { id, event })).status, 400)
  for (const ms of [-1, 86400001, 1.5, '12000', null]) assert.equal((await h.call('advance', { id, ms })).status, 400)
  for (const query of ['detail?id=' + id + '&id=' + id, 'detail?id=' + id + '&personaId=live', 'list?owner=live']) assert.equal((await h.call(query)).status, 400)
  for (const body of [[], 'no-json', { requestId: '' }, { requestId: 'x', text: 'x'.repeat(SANDBOX_CHAT_LIMITS.bodyBytes) }]) {
    assert.equal((await h.fake.call('/onebot-qq/api/sandbox/chat/create', body)).status, 400)
  }
  const state = await h.ok('detail?id=' + id)
  assert.deepEqual(state.transcript, []); assert.deepEqual(state.captures, [])
  for (const [chatType, kind, type] of [['private', 'notice', 'friend_add'], ['group', 'notice', 'group_increase'], ['private', 'request', 'friend'], ['group', 'request', 'group']]) await h.ok('event', { id, event: { kind, chatType, type } })
})

test('chat API admission limits are bounded and recover; queued/in-flight persona changes fail closed', async () => {
  let time = 0, persona = 'a', resolveCreate, calls = 0
  const id = 'sim_00000000-0000-4000-8000-000000000000'
  const service = { create: async () => { calls++; return new Promise(resolve => { resolveCreate = resolve }) }, delete: async key => { assert.equal(key, id) } }
  const api = createSandboxChatApi({ simulations: service, currentPersonaId: () => persona, now: () => time })
  const jobs = Array.from({ length: 8 }, (_, i) => api.handle('create', { requestId: 'c' + i }))
  assert.equal((await api.handle('list', {})).status, 429)
  await new Promise(resolve => setImmediate(resolve))
  persona = 'b'; resolveCreate({ id })
  for (const result of await Promise.all(jobs)) assert.equal(result.body.code, 'SIMULATION_NOT_FOUND')
  assert.equal(calls, 1)
  for (let i = 0; i < 111; i++) assert.equal((await api.handle('list', {})).status, 200)
  assert.equal((await api.handle('list', {})).status, 429)
  time = 60000
  assert.equal((await api.handle('list', {})).status, 200)
})

test('chat API bounds session operations, recovers on reset/delete and hides internal errors', async () => {
  let time = 0, operations = 0
  const id = 'sim_00000000-0000-4000-8000-000000000000'
  const service = {
    create: async () => ({ id }),
    read: async () => ({ ok: true, id, captures: [], loops: [] }),
    advance: async () => { operations++; return {} }, reset: async () => {}, delete: async () => {},
    submit: async () => { throw Error('/private/path/SECRET') },
  }
  const api = createSandboxChatApi({ simulations: service, currentPersonaId: () => 'a', now: () => time })
  const handle = (action, body) => api.handle(action, { requestId: 'request', ...body })
  await handle('create', {})
  const error = await handle('event', { id, event: {} })
  assert.equal(error.status, 503); assert.doesNotMatch(JSON.stringify(error), /SECRET|private/)
  for (let n = 0; n < SANDBOX_CHAT_LIMITS.operations; n++) {
    if (n % 100 === 0) time += 60000
    assert.equal((await handle('advance', { id, ms: 1 })).status, 200)
  }
  assert.equal((await handle('advance', { id, ms: 1 })).body.code, 'SIMULATION_OPERATION_LIMIT')
  assert.equal(operations, SANDBOX_CHAT_LIMITS.operations)
  assert.equal((await handle('reset', { id })).status, 200)
  assert.equal((await handle('advance', { id, ms: 1 })).status, 200)
  assert.equal((await handle('delete', { id })).status, 200)
  assert.equal((await handle('advance', { id, ms: 1 })).body.code, 'SIMULATION_NOT_FOUND')
})
