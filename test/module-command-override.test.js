import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createAccess } from '../src/core/access.js'
import { createCommandService } from '../src/cognition/commands.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createModuleKernel } from '../src/modules/kernel.js'

// 只注入测试描述符，生产 registry 使用四个内置模块。
function builtin(id, setup, manifest = {}) {
  return {
    manifest: { id, permissions: ['commands', 'commands:override'], ...manifest },
    defaultEnabled: true,
    load: () => ({ setup }),
  }
}

async function harness(t, registry = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-command-override-'))
  const config = {
    access: { mode: 'allowlist', ownerQQ: '10001', operators: ['10002'], groups: ['20001'] },
    cognition: { permissions: { deniedCommands: [] } },
  }
  const sent = [], coreCalls = []
  let sendResult = { ok: true }
  const access = createAccess({ getConfig: () => config })
  const delivery = createDeliveryService({ outbound: {
    async deliver(payload) { sent.push(payload); return sendResult },
  } })
  const commands = createCommandService({
    getConfig: () => config, access, delivery,
    runtime: { summary() { coreCalls.push('status'); return { active: true, sessions: 2 } } },
  })
  const kernel = createModuleKernel({ dataDir: root, registry, commands })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  const turn = (text = '/status', extra = {}) => ({ text, senderId: '10001', chatType: 'private', chatId: '10001', ...extra })
  return { root, kernel, commands, config, sent, coreCalls, turn, setSendResult(value) { sendResult = value } }
}

async function external(root, id, manifest, source) {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', ...manifest }))
  await writeFile(join(dir, 'index.mjs'), source)
}

test('command override: explicit service opt-in, duplicates and registration-owned idempotent disposer', async (t) => {
  const h = await harness(t)
  for (const allowProtected of [undefined, false, 'true', 1]) {
    assert.throws(() => h.commands.registerCommand('status', () => '', { allowProtected }), /已注册/)
  }
  const off = h.commands.registerCommand('STATUS', () => 'override', { allowProtected: true })
  assert.equal((await h.commands.handle(h.turn('/StAtUs'))).reply, 'override')
  assert.deepEqual(h.coreCalls, [])
  for (const allowProtected of [false, true]) {
    assert.throws(() => h.commands.registerCommand('status', () => 'duplicate', { allowProtected }), /已注册/)
  }
  off(); off()
  assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
  const replacement = h.commands.registerCommand('status', () => 'replacement', { allowProtected: true })
  off()
  assert.equal((await h.commands.handle(h.turn())).reply, 'replacement')
  replacement()
  const ordinary = h.commands.registerCommand('echo', () => 'echo')
  assert.throws(() => h.commands.registerCommand('ECHO', () => '', { allowProtected: true }), /已注册/)
  ordinary()
})

test('command override: builtin wins, shares command delivery, disable/re-enable/dispose restore core', async (t) => {
  const apis = [], received = []
  const h = await harness(t, [builtin('builtin-override', api => {
    apis.push(api)
    api.registerCommand('status', input => { received.push(input); return { reply: `module:${input.args}` } }, { overrideBuiltin: true })
  })])
  await h.kernel.start()
  assert.equal(h.kernel.list()[0].status, 'loaded')
  assert.equal((await h.commands.handle(h.turn('/StAtUs hello'))).reply, 'module:hello')
  assert.equal(received[0].parsed.name, 'status')
  assert.equal(received[0].turn.senderId, '10001')
  assert.deepEqual(h.coreCalls, [])
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].source, 'command')
  assert.deepEqual(h.sent[0].segments, [{ type: 'text', data: { text: 'module:hello' } }])

  await h.kernel.setEnabled('builtin-override', false)
  assert.match((await h.commands.handle(h.turn())).reply, /会话：2/)
  assert.throws(() => apis[0].registerCommand('status', () => '', { overrideBuiltin: true }), /已停止/)
  await h.kernel.setEnabled('builtin-override', true)
  assert.equal((await h.commands.handle(h.turn())).reply, 'module:')
  assert.equal(apis.length, 2)
  await h.kernel.dispose()
  assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
  assert.throws(() => apis[1].registerCommand('status', () => '', { overrideBuiltin: true }), /已停止/)
  assert.equal(received.length, 2)
})

test('command override: external source spoofing and missing permissions fail setup', async (t) => {
  const h = await harness(t, [
    builtin('builtin-no-override', api => api.registerCommand('status', () => 'bad', { overrideBuiltin: true }), { permissions: ['commands'] }),
    builtin('builtin-no-commands', api => api.registerCommand('status', () => 'bad', { overrideBuiltin: true }), { permissions: ['commands:override'] }),
    builtin('builtin-no-opt-in', api => api.registerCommand('status', () => 'bad')),
  ])
  for (const id of ['external-with-permission', 'external-no-permission', 'external-raw-option']) {
    await external(h.root, id, {
      permissions: id === 'external-no-permission' ? ['commands'] : ['commands', 'commands:override'],
      source: 'builtin', builtin: true,
    }, `export function setup(api) {
      api.registerCommand('status', () => 'bad', ${id === 'external-raw-option' ? '{ allowProtected: true }' : '{ overrideBuiltin: true }'})
    }`)
  }
  await h.kernel.start()
  const rows = Object.fromEntries(h.kernel.list().map(row => [row.id, row]))
  assert.ok(Object.values(rows).every(row => row.status === 'error'))
  assert.match(rows['builtin-no-override'].error, /permission: commands:override/)
  assert.match(rows['builtin-no-commands'].error, /permission: commands/)
  assert.match(rows['builtin-no-opt-in'].error, /已注册/)
  for (const id of ['external-with-permission', 'external-no-permission']) {
    assert.equal(rows[id].builtin, false)
    assert.match(rows[id].error, /仅允许内置/)
  }
  assert.match(rows['external-raw-option'].error, /已注册/)
  assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
})

test('command override: ownerOnly defaults to true even for core read-only operators; access gates side effects', async (t) => {
  let calls = 0
  const h = await harness(t, [builtin('builtin-private', api => {
    api.registerCommand('status', () => { calls++; return 'private' }, { overrideBuiltin: true })
  })])
  await h.kernel.start()
  for (const senderId of ['10002', '10003']) {
    assert.deepEqual(await h.commands.handle(h.turn('/status', { senderId })), { handled: true, reply: '' })
  }
  assert.deepEqual(await h.commands.handle(h.turn('/status', { chatType: 'group', chatId: '20002' })), { handled: true, reply: '', error: 'ACCESS_DENIED' })
  assert.equal(calls, 0)
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.coreCalls, [])
  assert.equal((await h.commands.handle(h.turn())).reply, 'private')
  assert.equal(calls, 1)
})

test('command override: explicit public handlers still obey access and dynamic normalized deny-list', async (t) => {
  let calls = 0
  const h = await harness(t, [builtin('builtin-public', api => {
    api.registerCommand('STATUS', () => { calls++; return 'public' }, { overrideBuiltin: true, ownerOnly: false })
  })])
  await h.kernel.start()
  for (const senderId of ['10002', '10003']) {
    const extra = { senderId, chatType: 'group', chatId: '20001' }
    assert.equal((await h.commands.handle(h.turn('/status', extra))).reply, 'public')
    assert.equal((await h.commands.handle(h.turn('/status', { ...extra, chatId: '20002' }))).error, 'ACCESS_DENIED')
  }
  h.config.cognition.permissions.deniedCommands = ['status']
  assert.equal((await h.commands.handle(h.turn('/StAtUs'))).reply, '该命令已被操作员禁用。')
  const sentBefore = h.sent.length
  for (const senderId of ['10002', '10003']) {
    assert.deepEqual(await h.commands.handle(h.turn('/STATUS', { senderId, chatType: 'group', chatId: '20001' })), { handled: true, reply: '' })
  }
  assert.equal(h.sent.length, sentBefore)
  assert.equal(calls, 2)
  assert.deepEqual(h.coreCalls, [])
  h.config.cognition.permissions.deniedCommands = []
  assert.equal((await h.commands.handle(h.turn())).reply, 'public')
  assert.equal(calls, 3)
})

test('command override: absent or failing access fails closed before handler execution', async () => {
  for (const access of [null, {}, { canSend() { throw new Error('unavailable') } }]) {
    let calls = 0
    const commands = createCommandService({ getConfig: () => ({}), access })
    commands.registerCommand('remind', () => { calls++; return 'bad' }, { allowProtected: true, ownerOnly: false })
    assert.deepEqual(await commands.handle({ text: '/remind', chatType: 'group', chatId: '20001', senderId: '10003' }), { handled: true, reply: '', error: 'ACCESS_DENIED' })
    assert.equal(calls, 0)
  }
})

test('command override: delivery rejection and handler error never execute core or retry', async (t) => {
  let calls = 0
  const h = await harness(t, [builtin('builtin-failures', api => {
    api.registerCommand('status', ({ args }) => {
      calls++
      if (args === 'fail') throw new Error('private handler detail')
      return 'module'
    }, { overrideBuiltin: true })
  })])
  await h.kernel.start()
  h.setSendResult({ ok: false, error: 'RATE_LIMITED' })
  assert.deepEqual(await h.commands.handle(h.turn()), { handled: true, reply: '', error: 'RATE_LIMITED' })
  assert.equal(h.sent.length, 1)
  h.setSendResult({ ok: true })
  assert.equal((await h.commands.handle(h.turn('/status fail'))).reply, '命令 /status 执行失败。')
  assert.equal(h.sent.length, 2)
  assert.doesNotMatch(JSON.stringify(h.sent), /private handler detail/)
  assert.equal(calls, 2)
  assert.deepEqual(h.coreCalls, [])
})

test('command override: competing builtin registration fails without removing the first override', async (t) => {
  const h = await harness(t, ['a', 'b'].map(id => builtin(`builtin-${id}`, api => {
    api.registerCommand('status', () => id, { overrideBuiltin: true })
  })))
  await h.kernel.start()
  assert.equal(h.kernel.list()[0].status, 'loaded')
  assert.equal(h.kernel.list()[1].status, 'error')
  assert.match(h.kernel.list()[1].error, /已注册/)
  assert.equal((await h.commands.handle(h.turn())).reply, 'a')
  await h.kernel.setEnabled('builtin-b', false)
  assert.equal((await h.commands.handle(h.turn())).reply, 'a')
  await h.kernel.setEnabled('builtin-a', false)
  assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
})

test('command override: partial setup failure and event isolation remove overrides', async (t) => {
  for (const failure of ['setup', 'duplicate', 'event']) {
    await t.test(failure, async (t) => {
      let staleApi
      const h = await harness(t, [builtin('builtin-failure', api => {
        staleApi = api
        api.registerCommand('status', () => 'module', { overrideBuiltin: true })
        if (failure === 'setup') throw new Error('setup failed')
        if (failure === 'duplicate') api.registerCommand('status', () => 'duplicate', { overrideBuiltin: true })
        if (failure === 'event') api.on('message', () => { throw new Error('event failed') })
      }, { permissions: ['commands', 'commands:override', 'events'] })])
      await h.kernel.start()
      if (failure === 'event') {
        assert.equal((await h.commands.handle(h.turn())).reply, 'module')
        await h.kernel.dispatch({ kind: 'message' })
      }
      assert.equal(h.kernel.list()[0].status, 'error')
      assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
      assert.throws(() => staleApi.registerCommand('status', () => '', { overrideBuiltin: true }), /已停止/)
    })
  }
})

test('command override: dependency reload gets a fresh registration; dependency disable restores core', async (t) => {
  const apis = []
  const h = await harness(t, [builtin('builtin-dependent', api => {
    apis.push(api)
    api.registerCommand('status', () => `generation:${apis.length}`, { overrideBuiltin: true })
  }, { requires: ['dependency'] })])
  await external(h.root, 'dependency', {}, 'export function setup() {}')
  await h.kernel.start()
  assert.equal((await h.commands.handle(h.turn())).reply, 'generation:1')
  await h.kernel.reload('dependency')
  assert.equal((await h.commands.handle(h.turn())).reply, 'generation:2')
  assert.throws(() => apis[0].registerCommand('status', () => '', { overrideBuiltin: true }), /已停止/)
  await h.kernel.setEnabled('dependency', false)
  assert.equal(h.kernel.list().find(row => row.id === 'builtin-dependent').status, 'blocked')
  assert.match((await h.commands.handle(h.turn())).reply, /dsh-bot 状态/)
})

test('command override: ordinary external commands retain ownerOnly, public dispatch and disposal', async (t) => {
  const h = await harness(t)
  await external(h.root, 'echo', { permissions: ['commands', 'commands:override'] }, `export function setup(api) {
    api.registerCommand('echo', ({ args }) => 'echo:' + args)
    api.registerCommand('public', () => 'public', { ownerOnly: false, overrideBuiltin: false })
  }`)
  await h.kernel.start()
  assert.equal(h.kernel.list()[0].status, 'loaded')
  assert.equal((await h.commands.handle(h.turn('/echo hi'))).reply, 'echo:hi')
  assert.deepEqual(await h.commands.handle(h.turn('/echo hi', { senderId: '10003' })), { handled: true, reply: '' })
  assert.equal((await h.commands.handle(h.turn('/public', { senderId: '10003' }))).reply, 'public')
  await h.kernel.setEnabled('echo', false)
  assert.match((await h.commands.handle(h.turn('/echo'))).reply, /未知命令/)
})

test('command audience is builtin-only and rejects invalid values', async t => {
  const h = await harness(t, [builtin('builtin-invalid-audience', api => {
    api.registerCommand('status', () => '', { overrideBuiltin: true, audience: 'everyone' })
  })])
  await external(h.root, 'external-audience', { permissions: ['commands'] }, `export function setup(api) {
    api.registerCommand('public-test', () => 'bad', { ownerOnly: false, audience: 'owner-or-operator' })
  }`)
  await h.kernel.start()
  const rows = Object.fromEntries(h.kernel.list().map(row => [row.id, row]))
  assert.match(rows['builtin-invalid-audience'].error, /audience 不合法/)
  assert.match(rows['external-audience'].error, /audience 仅允许内置/)
})
