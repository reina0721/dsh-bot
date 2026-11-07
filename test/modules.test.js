import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { createTurnHooks } from '../src/cognition/turn-hooks.js'
import { builtinRegistry } from '../src/modules/registry.js'
import { createModuleKernel } from '../src/modules/kernel.js'
import { createCommandService } from '../src/cognition/commands.js'
import { MAX_CONFIG_BYTES, validateConfigSchema, validateConfigValues } from '../src/modules/config.js'

async function moduleDir(root, id, manifest, source) {
  const dir = join(root, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', ...manifest }), 'utf8')
  await writeFile(join(dir, 'index.mjs'), source, 'utf8')
  return dir
}

async function harness(registry = [], logger = null, delivery = null, gateway = null) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-modules-'))
  const deliveryRegistry = createDeliveryRegistry()
  const turnHooks = createTurnHooks({ logger })
  const sent = []
  const commandReplies = []
  const commands = createCommandService({
    getConfig: () => ({ access: { ownerQQ: 'owner' } }),
    access: { isOwner: (_cfg, id) => id === 'owner' },
    outbound: { async deliver(payload) { commandReplies.push(payload); return { ok: true } } },
  })
  const kernel = createModuleKernel({
    dataDir: root,
    registry,
    deliveryRegistry,
    turnHooks,
    gateway,
    delivery,
    logger,
    getConfig: () => ({}),
    commands,
    outbound: { async deliver(payload) { sent.push(payload); return { ok: true } } },
    cognition: {
      snapshot: () => ({ ready: true }), overview: async () => ({ ok: true }), memories: () => [],
      personDetail: () => null, relationshipsList: () => [], timeline: () => [],
      registerKnowledgeSource: () => () => {}, registerCapability: () => () => {},
    },
  })
  const turn = (text, senderId = 'owner') => ({ text, senderId, chatType: 'private', chatId: senderId })
  return { root, sent, commandReplies, commands, kernel, turn, deliveryRegistry, turnHooks }
}

test('modules：加载、稳定 API、存储、事件与命令可用，列表不泄露路径', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  const dir = await moduleDir(h.root, 'echo', {
    name: 'Echo', version: '1.0.0', description: 'test', permissions: ['commands', 'events', 'storage'],
  }, `
    export async function setup(api) {
      await api.storage.set('count', 0)
      api.on('message', async () => api.storage.set('count', (await api.storage.get('count', 0)) + 1))
      api.registerCommand('echo', async ({ args }) => ({ reply: args + ':' + await api.storage.get('count', 0) }))
    }
  `)
  await h.kernel.start()
  const items = h.kernel.list()
  assert.equal(items[0].status, 'loaded')
  assert.equal(items[0].name, 'Echo')
  assert.doesNotMatch(JSON.stringify(items), new RegExp(h.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  await h.kernel.dispatch({ kind: 'message', message: { text: 'hi' } })
  const stored = JSON.parse(await readFile(join(dir, 'data.json'), 'utf8'))
  assert.equal(stored.count, 1)
  const result = await h.commands.handle(h.turn('/echo hello'))
  assert.equal(result.reply, 'hello:1')
  assert.equal(h.commandReplies.length, 1)
})

test('modules：缺少 commands/send:text 权限时 setup 失败', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'no-command', {}, `export function setup(api) { api.registerCommand('denied', () => 'no') }`)
  await moduleDir(h.root, 'no-send', {}, `export async function setup(api) { await api.sendText({ chatType:'private', chatId:'1', text:'no' }) }`)
  await h.kernel.start()
  const byId = Object.fromEntries(h.kernel.list().map((item) => [item.id, item]))
  assert.equal(byId['no-command'].status, 'error')
  assert.match(byId['no-command'].error, /permission: commands/)
  assert.equal(byId['no-send'].status, 'error')
  assert.match(byId['no-send'].error, /permission: send:text/)
  assert.equal(h.sent.length, 0)
})

test('modules：setup 抛错与语法错误被隔离，列表仍可读取', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'throws', {}, `export function setup() { throw new Error('boom') }`)
  await moduleDir(h.root, 'syntax', {}, `export function setup( {`)
  await moduleDir(h.root, 'healthy', {}, `export function setup() {}`)
  await h.kernel.start()
  const byId = Object.fromEntries(h.kernel.list().map((item) => [item.id, item]))
  assert.equal(byId.healthy.status, 'loaded')
  assert.equal(byId.throws.status, 'error')
  assert.match(byId.throws.error, /boom/)
  assert.equal(byId.syntax.status, 'error')
})

test('modules：热重载更新行为，停用移除命令/事件，启用重新加载', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  const dir = await moduleDir(h.root, 'reloadable', { permissions: ['commands', 'events', 'storage'] }, `
    export function setup(api) {
      api.registerCommand('versioned', () => 'v1')
      api.on('message', async () => api.storage.set('events', (await api.storage.get('events', 0)) + 1))
    }
  `)
  await h.kernel.start()
  assert.equal((await h.commands.handle(h.turn('/versioned'))).reply, 'v1')
  await writeFile(join(dir, 'index.mjs'), `export function setup(api) { api.registerCommand('versioned', () => 'v2'); api.on('message', async () => api.storage.set('events', (await api.storage.get('events', 0)) + 10)) }`, 'utf8')
  assert.equal((await h.kernel.reload('reloadable')).status, 'loaded')
  assert.equal((await h.commands.handle(h.turn('/versioned'))).reply, 'v2')
  await h.kernel.dispatch({ kind: 'message' })
  assert.equal(JSON.parse(await readFile(join(dir, 'data.json'), 'utf8')).events, 10)

  const disabled = await h.kernel.setEnabled('reloadable', false)
  assert.equal(disabled.status, 'disabled')
  const replacementDispose = h.commands.registerCommand('versioned', () => 'replacement')
  await h.kernel.dispatch({ kind: 'message' })
  assert.equal(JSON.parse(await readFile(join(dir, 'data.json'), 'utf8')).events, 10)
  replacementDispose()

  const enabled = await h.kernel.setEnabled('reloadable', true)
  assert.equal(enabled.status, 'loaded')
  assert.equal((await h.commands.handle(h.turn('/versioned'))).reply, 'v2')
})

test('modules：损坏 state.json 可容忍，entry 路径与符号链接逃逸被拒绝', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  await writeFile(join(h.root, 'state.json'), '{broken', 'utf8')
  await moduleDir(h.root, 'ok', {}, `export function setup() {}`)
  const escapeDir = join(h.root, 'escape')
  await mkdir(escapeDir)
  await writeFile(join(escapeDir, 'module.json'), JSON.stringify({ id: 'escape', entry: '../outside.mjs' }), 'utf8')
  await writeFile(join(h.root, 'outside.mjs'), 'export function setup() {}', 'utf8')
  const linkDir = join(h.root, 'link')
  await mkdir(linkDir)
  await writeFile(join(linkDir, 'module.json'), JSON.stringify({ id: 'link', entry: 'index.mjs' }), 'utf8')
  await symlink(join(h.root, 'outside.mjs'), join(linkDir, 'index.mjs'))
  await h.kernel.start()
  const byId = Object.fromEntries(h.kernel.list().map((item) => [item.id, item]))
  assert.equal(byId.ok.status, 'loaded')
  assert.match(byId.escape.error, /不能离开/)
  assert.match(byId.link.error, /符号链接/)
})


test('modules：事件 handler 异常会隔离模块并清理命令', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'bad-event', { permissions: ['events', 'commands'] }, `
    export function setup(api) {
      api.on('message', () => { throw new Error('event-boom') })
      api.registerCommand('bad', () => 'still-here')
    }
  `)
  await h.kernel.start()
  assert.equal((await h.commands.handle(h.turn('/bad'))).reply, 'still-here')
  await h.kernel.dispatch({ kind: 'message' })
  const item = h.kernel.list().find((row) => row.id === 'bad-event')
  assert.equal(item.status, 'error')
  assert.match(item.error, /event-boom/)
  assert.match((await h.commands.handle(h.turn('/bad'))).reply, /未知命令/)
})

function builtin(id, load, extra = {}, defaultEnabled = false) {
  return { manifest: { id, name: id, version: '1', ...extra }, defaultEnabled, load }
}
const row = (kernel, id) => kernel.list().find((item) => item.id === id)

test('typing module: default enabled, legacy config, private-only, awaited status and isolated errors', async (t) => {
  const calls = [], logs = []
  let failure = null
  const logger = { warn: (...args) => logs.push(args) }
  const h = await harness(builtinRegistry, logger, null, { actions: { async setInputStatus(id, event) {
    await new Promise(setImmediate)
    calls.push([id, event])
    if (failure) throw failure
  } } })
  t.after(() => h.kernel.dispose())
  await h.kernel.start()
  const item = row(h.kernel, 'builtin-typing')
  assert.equal(item.enabled, true)
  assert.equal(item.status, 'loaded')
  assert.equal(item.hasConfig, false)
  assert.deepEqual(item.permissions, ['turn:lifecycle', 'status:write'])
  assert.deepEqual(h.turnHooks.list().map(hook => hook.id), ['builtin-typing'])
  await assert.rejects(h.kernel.getModuleConfig(item.id), /配置/)
  const context = (typingEnabled, chatType = 'private') => ({ turn: { chatType, chatId: 1000199876543 }, settings: { typingEnabled } })
  for (const value of [undefined, false, 'true', 1]) {
    await h.turnHooks.start(context(value)); await h.turnHooks.end(context(value))
  }
  await h.turnHooks.start(context(true, 'group')); await h.turnHooks.end(context(true, 'group'))
  assert.deepEqual(calls, [])
  await h.turnHooks.start(context(true))
  assert.deepEqual(calls, [['1000199876543', 1]])
  await h.turnHooks.end(context(true))
  assert.deepEqual(calls, [['1000199876543', 1], ['1000199876543', 2]])
  failure = Error('raw gateway error for 1000199876543')
  await h.turnHooks.start(context(true)); await h.turnHooks.end(context(true))
  assert.equal(calls.length, 4)
  assert.equal(row(h.kernel, item.id).status, 'loaded')
  assert.doesNotMatch(JSON.stringify(logs), /1000199876543|raw gateway/)
  await h.kernel.setEnabled(item.id, false)
  assert.deepEqual(h.turnHooks.list(), [])
  await h.turnHooks.start(context(true)); await h.turnHooks.end(context(true))
  assert.equal(calls.length, 4)
  await h.kernel.setEnabled(item.id, true)
  assert.equal(h.turnHooks.list().length, 1)
  await h.kernel.dispose()
  assert.deepEqual(h.turnHooks.list(), [])
})

test('typing module: missing action and synchronous gateway failure are best effort', async (t) => {
  for (const gateway of [null, { actions: {} }, { actions: { setInputStatus() { throw Error('private gateway failure') } } }]) {
    const h = await harness(builtinRegistry, null, null, gateway)
    t.after(() => h.kernel.dispose())
    await h.kernel.start()
    const context = { turn: { chatType: 'private', chatId: '123' }, settings: { typingEnabled: true } }
    await h.turnHooks.start(context); await h.turnHooks.end(context)
    assert.equal(row(h.kernel, 'builtin-typing').status, 'loaded')
  }
})

test('turn/status API: permissions, active runtime, gateway validation and errors preserved', async (t) => {
  let api, error = null
  const calls = [], result = { ok: true }
  const h = await harness([
    builtin('builtin-no-turn', () => ({ setup(api) { api.turn.register({ id: 'denied', onStart() {} }) } }), {}, true),
    builtin('builtin-no-status', () => ({ setup(api) { api.status.setInputStatus('1', 1) } }), {}, true),
    builtin('builtin-status', () => ({ setup(value) { api = value } }), { permissions: ['turn:lifecycle', 'status:write'] }, true),
  ], null, null, { actions: { setInputStatus(id, event) { calls.push([id, event]); if (error) throw error; return result } } })
  t.after(() => h.kernel.dispose())
  await h.kernel.start()
  assert.match(row(h.kernel, 'builtin-no-turn').error, /permission: turn:lifecycle/)
  assert.match(row(h.kernel, 'builtin-no-status').error, /permission: status:write/)
  assert.equal(api.config, undefined)
  assert.equal(api.status.setInputStatus(123, 1), result)
  assert.deepEqual(calls, [['123', 1]])
  error = Error('gateway validation error')
  assert.throws(() => api.status.setInputStatus(' invalid ', 3), value => value === error)
  assert.deepEqual(calls.at(-1), [' invalid ', 3])
  error = null
  await h.kernel.setEnabled(api.id, false)
  assert.throws(() => api.turn.register({ id: 'stopped', onEnd() {} }), /模块已停止/)
  assert.throws(() => api.status.setInputStatus('123', 2), /模块已停止/)
  assert.equal(calls.length, 2)
})

test('turn/status API: external rejected even with permissions and forged source', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  for (const [id, code] of [['external-turn', "api.turn.register({ id: 'external', onStart() {} })"], ['external-status', "api.status.setInputStatus('123', 1)"]]) {
    await moduleDir(h.root, id, { permissions: ['turn:lifecycle', 'status:write'], builtin: true, source: 'builtin' }, `export function setup(api) { ${code} }`)
  }
  await h.kernel.start()
  for (const id of ['external-turn', 'external-status']) {
    assert.equal(row(h.kernel, id).status, 'error')
    assert.match(row(h.kernel, id).error, /仅允许内置模块/)
  }
  assert.deepEqual(h.turnHooks.list(), [])
})

test('turn API: setup failure, dependency reload/disable and dispose remove hooks and listeners', async (t) => {
  let starts = 0, events = 0
  const h = await harness([
    builtin('builtin-failed-turn', () => ({ setup(api) {
      api.turn.register({ id: 'failed', onStart() { starts++ } })
      api.on('message', () => events++)
      throw Error('setup failed')
    } }), { permissions: ['turn:lifecycle', 'events'] }, true),
    builtin('builtin-dependent-turn', () => ({ setup(api) {
      api.turn.register({ id: 'dependent', onStart() { starts++ } })
      api.on('message', () => events++)
    } }), { permissions: ['turn:lifecycle', 'events'], requires: ['dependency'] }, true),
  ])
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'dependency', {}, 'export function setup() {}')
  await h.kernel.start()
  assert.equal(row(h.kernel, 'builtin-failed-turn').status, 'error')
  assert.deepEqual(h.turnHooks.list().map(hook => hook.id), ['dependent'])
  await h.turnHooks.start({}); await h.kernel.dispatch({ kind: 'message' })
  assert.equal(starts, 1); assert.equal(events, 1)
  await h.kernel.reload('dependency')
  assert.equal(h.turnHooks.list().length, 1)
  await h.kernel.setEnabled('dependency', false)
  assert.deepEqual(h.turnHooks.list(), [])
  await h.turnHooks.start({}); await h.kernel.dispatch({ kind: 'message' })
  assert.equal(starts, 1); assert.equal(events, 1)
  await h.kernel.setEnabled('dependency', true)
  assert.equal(h.turnHooks.list().length, 1)
  await h.kernel.dispose()
  assert.deepEqual(h.turnHooks.list(), [])
  await h.turnHooks.start({}); await h.kernel.dispatch({ kind: 'message' })
  assert.equal(starts, 1); assert.equal(events, 1)
})

const configSchema = { version: 1, fields: [
  { path: 'message', type: 'text', label: '回复', default: '默认', maxChars: 4 },
  { path: 'enabled', type: 'switch', label: '开关' },
  { path: 'details', type: 'textarea', label: '说明' },
  { path: 'count', type: 'number', label: '数量', default: 2, min: 1, max: 3 },
  { path: 'mode', type: 'select', label: '模式', options: [{ value: 'a', label: 'A' }, { value: 'b' }] },
  { path: 'names', type: 'string-list', label: '名称', default: ['a'], maxChars: 3, maxItems: 2 },
  { path: 'numbers', type: 'number-list', label: '数字', default: [1], min: 0, max: 10, minItems: 1, maxItems: 2 },
] }

test('modules config：schema 类型、默认、平面键、边界、未知字段与总大小验证', () => {
  const schema = validateConfigSchema(configSchema)
  const defaults = validateConfigValues(schema, {})
  assert.deepEqual(defaults, { message: '默认', enabled: false, details: '', count: 2, mode: 'a', names: ['a'], numbers: [1] })
  for (const fields of [
    [{ path: 'a.b', type: 'text', label: 'x' }],
    [{ path: 'A', type: 'text', label: 'x' }],
    [{ path: 'a'.repeat(65), type: 'text', label: 'x' }],
    [{ path: 'secret', type: 'secret', label: 'x' }],
    [{ path: 'test', type: 'text', label: ' ' }],
    [{ path: 'test', type: 'text', label: 'x', default: false }],
    [{ path: 'test', type: 'number', label: 'x', min: 1 }],
    [{ path: 'test', type: 'number', label: 'x', default: NaN }],
    [{ path: 'test', type: 'number', label: 'x', min: 3, max: 1 }],
    [{ path: 'test', type: 'select', label: 'x', options: [] }],
    [{ path: 'test', type: 'select', label: 'x', options: [{ value: 'a' }, { value: 'a' }] }],
    [{ path: 'test', type: 'text', label: 'x', maxChars: -1 }],
    [{ path: 'test', type: 'string-list', label: 'x', maxItems: 1001 }],
    [configSchema.fields[0], configSchema.fields[0]],
    Array.from({ length: 33 }, (_, i) => ({ path: 'field' + i, label: 'x', type: 'text' })),
  ]) assert.throws(() => validateConfigSchema({ version: 1, fields }), { code: 'MODULE_CONFIG_INVALID' })
  assert.throws(() => validateConfigSchema({ ...configSchema, version: 2 }))
  for (const values of [null, [], { extra: 'x' }, { message: '12345' }, { enabled: 1 }, { details: false },
    { count: '2' }, { count: Infinity }, { count: 0 }, { count: 4 }, { mode: 'c' },
    { names: ['abcd'] }, { names: [1] }, { names: ['a', 'b', 'c'] },
    { numbers: [] }, { numbers: ['1'] }, { numbers: [NaN] }, { numbers: [11] }, { numbers: [1, 2, 3] },
  ]) assert.throws(() => validateConfigValues(schema, values), { code: 'MODULE_CONFIG_INVALID' })
  assert.equal(validateConfigValues(schema, { message: '😀😀😀😀' }).message, '😀😀😀😀')
  defaults.names.push('mutate')
  assert.deepEqual(validateConfigValues(schema, {}).names, ['a'])
  assert.throws(() => validateConfigSchema({ version: 1, fields: [{ path: 'large', label: '大', type: 'text', maxChars: MAX_CONFIG_BYTES, default: '中'.repeat(30000) }] }))
})

test('modules config：setup 前加载、clone、监听隔离/注销、revision、原子保存与重启', async (t) => {
  const apis = [], changes = [], warnings = []
  const descriptor = { ...builtin('builtin-config', async () => ({ setup(api) {
    apis.push(api)
    assert.ok(api.config.get().message)
    api.config.onChange((values) => { changes.push(values); values.names.push('local') })
    api.config.onChange(() => { throw Error('/private/path secret') })
    api.config.onChange(async () => { throw Error('async secret') })
  } })), config: configSchema }
  const h = await harness([descriptor], { warn: (message) => warnings.push(message) }); t.after(() => h.kernel.dispose())
  await h.kernel.start()
  const first = await h.kernel.getModuleConfig(descriptor.manifest.id)
  assert.equal(first.source, 'builtin'); assert.equal(first.revision, 0)
  assert.equal(row(h.kernel, first.id).hasConfig, true)
  assert.match(row(h.kernel, first.id).configWarning, /默认值/)
  assert.ok(!JSON.stringify(first).includes(h.root))
  first.values.message = 'bad'; first.schema.fields[0].maxChars = 99
  assert.equal((await h.kernel.getModuleConfig(first.id)).schema.fields[0].maxChars, 4)
  await h.kernel.setEnabled(first.id, true)
  const api = apis[0]
  assert.equal(api.config.get().message, '默认')
  api.config.get().names.push('mutate')
  assert.deepEqual(api.config.get().names, ['a'])
  assert.throws(() => api.config.onChange(null))
  let disposedCalls = 0
  const off = api.config.onChange(() => disposedCalls++)
  off(); off()
  const dir = join(h.root, '.builtin', first.id), file = join(dir, 'config.json')
  await writeFile(join(dir, 'data.json'), '{"untouched":true}')
  const saved = await h.kernel.setModuleConfig(first.id, { message: '新回复' }, 0)
  assert.equal(saved.revision, 1)
  assert.equal(api.config.get().message, '新回复')
  assert.deepEqual(api.config.get().names, ['a']); assert.equal(changes.length, 1); assert.equal(disposedCalls, 0)
  assert.equal(row(h.kernel, first.id).configWarning, '')
  assert.equal(row(h.kernel, first.id).status, 'loaded')
  assert.ok(warnings.some((message) => message.includes('监听器失败')))
  assert.ok(!warnings.join().includes('secret'))
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, revision: 1, values: saved.values })
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'data.json'), 'utf8')), { untouched: true })
  assert.deepEqual((await readdir(dir)).sort(), ['config.json', 'data.json'])
  await assert.rejects(h.kernel.setModuleConfig(first.id, { message: '旧' }, 0), { code: 'MODULE_CONFIG_CONFLICT' })
  await assert.rejects(h.kernel.setModuleConfig(first.id, { unknown: true }, 1), { code: 'MODULE_CONFIG_INVALID' })
  await assert.rejects(h.kernel.setModuleConfig(first.id, {}, undefined), { code: 'MODULE_CONFIG_INVALID' })
  assert.equal((await h.kernel.getModuleConfig(first.id)).revision, 1)
  // Windows cannot replace a file that is still open for reading; capture the
  // pre-write contents instead of holding a handle across atomic replacement.
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 1)
  const raced = await Promise.allSettled([h.kernel.setModuleConfig(first.id, {}, 1), h.kernel.setModuleConfig(first.id, {}, 1)])
  assert.equal(raced.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(raced.filter((result) => result.status === 'rejected').length, 1)
  const fulfilled = raced.find((result) => result.status === 'fulfilled')
  const rejected = raced.find((result) => result.status === 'rejected')
  assert.equal(fulfilled.value.revision, 2); assert.equal(rejected.reason.code, 'MODULE_CONFIG_CONFLICT')
  assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, 2)
  await h.kernel.setEnabled(first.id, false)
  await h.kernel.setModuleConfig(first.id, { message: '关闭时' }, 2)
  assert.equal(changes.length, 2)
  assert.throws(() => api.config.onChange(() => {}), /停止/)
  await h.kernel.setEnabled(first.id, true)
  assert.equal(apis[1].config.get().message, '关闭时')
  await h.kernel.setModuleConfig(first.id, {}, 3)
  assert.equal(changes.length, 3)
  await h.kernel.dispose()
  await assert.rejects(h.kernel.setModuleConfig(first.id, {}, 4), { code: 'MODULE_CONFIG_UNAVAILABLE' })
  const restarted = createModuleKernel({ dataDir: h.root, registry: [descriptor] }); t.after(() => restarted.dispose())
  await restarted.start()
  assert.equal((await restarted.getModuleConfig(first.id)).revision, 4)
  assert.equal(apis.at(-1).config.get().message, '默认')
})

test('modules config：损坏/超限回退、符号链接 containment、写失败保持内存与文件', async (t) => {
  const descriptor = { ...builtin('builtin-config', async () => ({ setup() {} }), {}, true), config: configSchema }
  const root = await mkdtemp(join(tmpdir(), 'dsh-config-'))
  const dir = join(root, '.builtin', descriptor.manifest.id), file = join(dir, 'config.json')
  await mkdir(dir, { recursive: true })
  const warnings = []
  for (const content of ['{bad', JSON.stringify({ version: 1, revision: 8, values: { count: 10 } }), JSON.stringify({ version: 1, revision: -1, values: {} }), ' '.repeat(MAX_CONFIG_BYTES + 1)]) {
    await writeFile(file, content)
    const kernel = createModuleKernel({ dataDir: root, registry: [descriptor], logger: { warn: (message) => warnings.push(message) } })
    try {
      await kernel.start()
      assert.equal(row(kernel, descriptor.manifest.id).status, 'loaded')
      assert.match(row(kernel, descriptor.manifest.id).configWarning, /默认值/)
      assert.equal((await kernel.getModuleConfig(descriptor.manifest.id)).values.message, '默认')
      assert.equal((await kernel.getModuleConfig(descriptor.manifest.id)).revision, 0)
    } finally { await kernel.dispose() }
  }
  assert.ok(warnings.length >= 4); assert.ok(!warnings.join().includes(root))
  await rm(file)
  const outside = join(root, 'outside.json')
  await writeFile(outside, '{"private":true}')
  await symlink(outside, file)
  const kernel = createModuleKernel({ dataDir: root, registry: [descriptor] }); t.after(() => kernel.dispose())
  await kernel.start()
  assert.equal(row(kernel, descriptor.manifest.id).status, 'loaded')
  await assert.rejects(kernel.setModuleConfig(descriptor.manifest.id, {}, 0), { code: 'MODULE_CONFIG_WRITE_FAILED' })
  assert.equal(await readFile(outside, 'utf8'), '{"private":true}')
  assert.equal((await kernel.getModuleConfig(descriptor.manifest.id)).revision, 0)
  await rm(file); await mkdir(file)
  await assert.rejects(kernel.setModuleConfig(descriptor.manifest.id, {}, 0), { code: 'MODULE_CONFIG_WRITE_FAILED' })
  assert.equal((await kernel.getModuleConfig(descriptor.manifest.id)).revision, 0)
  assert.deepEqual(await readdir(dir), ['config.json'])
  await rm(file, { recursive: true })
  assert.equal((await kernel.setModuleConfig(descriptor.manifest.id, {}, 0)).revision, 1)
})

test('modules config：未声明/未知拒绝且无路径泄露', async (t) => {
  let plainApi
  const h = await harness([builtin('builtin-plain', async () => ({ setup(api) { plainApi = api } }), { config: configSchema }, true)])
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'external', {}, `export function setup(api) { if (api.config !== undefined) throw Error('undeclared config exposed') }`)
  await h.kernel.start()
  assert.equal(plainApi.config, undefined)
  assert.equal(row(h.kernel, 'external').status, 'loaded')
  for (const id of ['external', 'builtin-plain', 'absent', '/absolute/private/path', '../escape']) {
    assert.equal(row(h.kernel, id)?.hasConfig || false, false)
    await assert.rejects(h.kernel.getModuleConfig(id), { code: 'MODULE_CONFIG_UNAVAILABLE' })
    await assert.rejects(h.kernel.setModuleConfig(id, {}, 0), (error) => error.code === 'MODULE_CONFIG_UNAVAILABLE' && !error.message.includes(id))
  }
})

test('external config：own values, cloned reads/listeners, atomic revisions, reload and revoked listeners', async (t) => {
  const changes = []
  const h = await harness([], { info: message => { if (message.startsWith('external-change:')) changes.push(message) } }); t.after(() => h.kernel.dispose())
  const dir = await moduleDir(h.root, 'configured', {
    config: configSchema, permissions: ['commands'],
    source: 'builtin', builtin: true, configValues: { secret: 'untrusted' }, moduleDir: '/private/escape',
  }, `export function setup(api) {
    if (api.builtin || api.source !== 'external' || api.legacyConfig || api.personaStore || api.scheduler) throw Error('privileged API exposed')
    try { api.providers.register('reminders', {}) ; throw Error('provider exposed') } catch (error) { if (!/permission|内置/.test(error.message)) throw error }
    if ('secret' in api.config.get()) throw Error('foreign values exposed')
    api.config.get().names.push('mutated')
    let message = api.config.get().message
    api.config.onChange(values => { message = values.message; values.names.push('local'); api.log.info('external-change:' + message) })
    api.registerCommand('configured', () => message)
  }`)
  await h.kernel.start()
  assert.equal(row(h.kernel, 'configured').status, 'loaded')
  assert.equal(row(h.kernel, 'configured').hasConfig, true)
  const first = await h.kernel.getModuleConfig('configured')
  assert.equal(first.source, 'external'); assert.equal(first.revision, 0)
  assert.deepEqual(first.values.names, ['a'])
  first.values.names.push('local'); first.schema.fields[0].maxChars = 999
  const saved = await h.kernel.setModuleConfig('configured', { message: '新值' }, 0)
  assert.equal(saved.revision, 1); assert.equal(saved.schema.fields[0].maxChars, 4)
  assert.deepEqual(saved.values.names, ['a'])
  assert.equal((await h.commands.handle(h.turn('/configured'))).reply, '新值')
  await assert.rejects(h.kernel.setModuleConfig('configured', {}, 0), { code: 'MODULE_CONFIG_CONFLICT' })
  await assert.rejects(h.kernel.setModuleConfig('configured', { unknown: true }, 1), { code: 'MODULE_CONFIG_INVALID' })
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'config.json'), 'utf8')), { version: 1, revision: 1, values: saved.values })
  assert.deepEqual(await readdir(dir), ['config.json', 'index.mjs', 'module.json'])
  await h.kernel.reload('configured')
  assert.deepEqual(await h.kernel.getModuleConfig('configured'), saved)
  assert.equal((await h.commands.handle(h.turn('/configured'))).reply, '新值')
  await h.kernel.setEnabled('configured', false)
  await h.kernel.setModuleConfig('configured', { message: '停用值' }, 1)
  assert.deepEqual(changes, ['external-change:新值'])
  await h.kernel.setEnabled('configured', true)
  assert.equal((await h.commands.handle(h.turn('/configured'))).reply, '停用值')
  await h.kernel.setModuleConfig('configured', { message: '再启用' }, 2)
  assert.deepEqual(changes, ['external-change:新值', 'external-change:再启用'])
  await h.kernel.setEnabled('configured', false)
  await h.kernel.dispose()
  const restarted = createModuleKernel({ dataDir: h.root, registry: [] }); t.after(() => restarted.dispose())
  await restarted.start()
  const restored = await restarted.getModuleConfig('configured')
  assert.equal(restored.revision, 3); assert.equal(restored.values.message, '再启用')
})

test('external config：invalid/oversized schemas rejected before importing backend', async (t) => {
  const h = await harness(); t.after(() => h.kernel.dispose())
  const invalid = [null, { ...configSchema, version: 2 }, { version: 1, fields: [{ path: 'password', label: 'secret', type: 'secret' }] },
    { version: 1, fields: [{ path: 'message', label: 'x'.repeat(MAX_CONFIG_BYTES), type: 'text' }] },
    { version: 1, fields: [{ path: 'message', label: 'x', type: 'select', options: [{ value: 'x'.repeat(23000) }] }] },
    { version: 1, fields: [{ path: 'message', label: 'x', type: 'text', maxChars: MAX_CONFIG_BYTES, default: '中'.repeat(30000) }] }]
  for (const [i, config] of invalid.entries()) await moduleDir(h.root, 'invalid-' + i, { config }, `throw Error('must not import')`)
  await h.kernel.start()
  for (const item of h.kernel.list()) {
    assert.equal(item.status, 'error'); assert.equal(item.hasConfig, false)
    assert.doesNotMatch(item.error, /must not import/)
    await assert.rejects(h.kernel.getModuleConfig(item.id), { code: 'MODULE_CONFIG_UNAVAILABLE' })
  }
})

test('external config：symlink files (including internal/dangling), directory swaps and escapes denied', async (t) => {
  const h = await harness(); t.after(() => h.kernel.dispose())
  const outside = await mkdtemp(join(tmpdir(), 'dsh-config-outside-'))
  t.after(() => rm(outside, { recursive: true, force: true }))
  const content = JSON.stringify({ version: 1, revision: 7, values: { message: '外部值' } })
  await writeFile(join(outside, 'config.json'), content)
  await writeFile(join(outside, 'module.json'), JSON.stringify({ id: 'directory-escape', entry: 'index.mjs', config: configSchema }))
  await writeFile(join(outside, 'index.mjs'), `throw Error('must not import')`)
  for (const id of ['escape', 'internal', 'dangling', 'swapped']) {
    const dir = await moduleDir(h.root, id, { config: configSchema }, 'export function setup() {}')
    if (id === 'swapped') continue
    const target = id === 'escape' ? join(outside, 'config.json') : join(dir, id === 'internal' ? 'private.json' : 'missing.json')
    if (id === 'internal') await writeFile(target, content)
    await symlink(target, join(dir, 'config.json'))
  }
  await symlink(outside, join(h.root, 'directory-escape'), 'dir')
  await h.kernel.start()
  assert.equal(row(h.kernel, 'directory-escape').status, 'error')
  assert.match(row(h.kernel, 'directory-escape').error, /符号链接/)
  for (const id of ['escape', 'internal', 'dangling']) {
    assert.equal((await h.kernel.getModuleConfig(id)).revision, 0)
    assert.match(row(h.kernel, id).configWarning, /默认值/)
    await assert.rejects(h.kernel.setModuleConfig(id, {}, 0), { code: 'MODULE_CONFIG_WRITE_FAILED' })
    assert.equal((await h.kernel.getModuleConfig(id)).revision, 0)
  }
  await rm(join(h.root, 'swapped'), { recursive: true })
  // Even an alias to another module inside modules cannot become this module's config.
  await symlink(join(h.root, 'internal'), join(h.root, 'swapped'), 'dir')
  await assert.rejects(h.kernel.setModuleConfig('swapped', {}, 0), { code: 'MODULE_CONFIG_WRITE_FAILED' })
  await rm(join(h.root, 'swapped'))
  await symlink(outside, join(h.root, 'swapped'), 'dir')
  await assert.rejects(h.kernel.setModuleConfig('swapped', {}, 0), { code: 'MODULE_CONFIG_WRITE_FAILED' })
  assert.equal(await readFile(join(outside, 'config.json'), 'utf8'), content)
  assert.equal(await readFile(join(h.root, 'internal', 'private.json'), 'utf8'), content)
  await assert.rejects(readFile(join(h.root, 'dangling', 'missing.json')), { code: 'ENOENT' })
})

test('modules config：依赖 reload 会清理内置下游监听器，dispose 清理当前注册', async (t) => {
  let calls = 0, setups = 0, cleanups = 0
  const descriptor = { ...builtin('builtin-config', async () => ({ setup(api) {
    setups++
    api.config.onChange(() => calls++)
    return () => { cleanups++ }
  } }), { requires: ['base'] }, true), config: configSchema }
  const h = await harness([descriptor]); t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'base', {}, 'export function setup() {}')
  await h.kernel.start()
  await h.kernel.reload('base')
  assert.equal(setups, 2); assert.equal(cleanups, 1)
  await h.kernel.setModuleConfig(descriptor.manifest.id, {}, 0)
  assert.equal(calls, 1)
  await h.kernel.dispose()
  assert.equal(cleanups, 2)
})

test('modules config：保存限制包含文件 envelope，超限不写入或通知', async (t) => {
  let notified = 0
  const descriptor = { ...builtin('builtin-large', async () => ({ setup(api) { api.config.onChange(() => notified++) } }), {}, true), config: {
    version: 1, fields: [{ path: 'large', type: 'textarea', label: '内容', maxChars: MAX_CONFIG_BYTES }],
  } }
  const h = await harness([descriptor]); t.after(() => h.kernel.dispose())
  await h.kernel.start()
  const values = { large: 'x'.repeat(MAX_CONFIG_BYTES - 40) }
  assert.ok(Buffer.byteLength(JSON.stringify(values, null, 2)) < MAX_CONFIG_BYTES)
  await assert.rejects(h.kernel.setModuleConfig(descriptor.manifest.id, values, 0), { code: 'MODULE_CONFIG_INVALID' })
  await assert.rejects(h.kernel.setModuleConfig(descriptor.manifest.id, { large: '中'.repeat(30000) }, 0), { code: 'MODULE_CONFIG_INVALID' })
  assert.equal(notified, 0)
  assert.equal((await h.kernel.getModuleConfig(descriptor.manifest.id)).revision, 0)
  assert.deepEqual(await readdir(join(h.root, '.builtin', descriptor.manifest.id)), [])
})

test('modules v2：内置默认不导入，来源只读，启停持久化，独立存储与保留目录', async (t) => {
  let imports = 0, setups = 0
  const descriptor = builtin('builtin-test', async () => {
    imports++
    return { async setup(api) {
      setups++
      assert.equal(api.source, 'builtin'); assert.equal(api.builtin, true)
      assert.throws(() => { api.source = 'external' }, TypeError)
      assert.equal(api.dir, join(h.root, '.builtin', 'builtin-test'))
      await api.storage.set('count', (await api.storage.get('count', 0)) + 1)
    } }
  }, { permissions: ['storage'], source: 'external', builtin: false, canReload: true })
  const h = await harness([descriptor]); t.after(() => h.kernel.dispose())
  await mkdir(join(h.root, '.builtin', 'garbage'), { recursive: true })
  await h.kernel.start()
  assert.equal(h.kernel.list().length, 1)
  assert.equal(imports, 0); assert.equal(setups, 0)
  assert.deepEqual(Object.fromEntries(['source', 'builtin', 'canReload', 'canToggle', 'apiVersion', 'requires', 'status'].map((key) => [key, row(h.kernel, 'builtin-test')[key]])), {
    source: 'builtin', builtin: true, canReload: false, canToggle: true, apiVersion: 1, requires: [], status: 'disabled',
  })
  await h.kernel.setEnabled('builtin-test', true)
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'state.json'), 'utf8')), { disabled: [], enabled: ['builtin-test'] })
  await assert.rejects(h.kernel.reload('builtin-test'), { code: 'MODULE_BUILTIN_RELOAD' })
  await h.kernel.setEnabled('builtin-test', false)
  await h.kernel.setEnabled('builtin-test', true)
  assert.equal(imports, 1); assert.equal(setups, 2)
  assert.equal(JSON.parse(await readFile(join(h.root, '.builtin', 'builtin-test', 'data.json'), 'utf8')).count, 2)
  const restarted = createModuleKernel({ dataDir: h.root, registry: [descriptor] }); t.after(() => restarted.dispose())
  await h.kernel.dispose(); await restarted.start()
  assert.equal(row(restarted, 'builtin-test').status, 'loaded')
})

test('modules v2：生产示例默认关闭；开启后仅主人可使用固定回复', async (t) => {
  const { builtinRegistry } = await import('../src/modules/registry.js')
  assert.ok(Object.isFrozen(builtinRegistry)); assert.ok(Object.isFrozen(builtinRegistry[0].manifest))
  const h = await harness(builtinRegistry); t.after(() => h.kernel.dispose())
  await h.kernel.start()
  const item = row(h.kernel, 'builtin-sample')
  assert.equal(item.name, '内置示例'); assert.equal(item.version, '1.0.0')
  assert.equal(item.status, 'disabled')
  await h.kernel.setEnabled(item.id, true)
  assert.equal((await h.commands.handle(h.turn('/module-sample'))).reply, '内置示例模块已启用。')
  const before = h.commandReplies.length
  await h.commands.handle(h.turn('/module-sample', 'other'))
  assert.equal(h.commandReplies.length, before)
  await h.kernel.setEnabled(item.id, false)
  assert.match((await h.commands.handle(h.turn('/module-sample'))).reply, /未知命令/)
})

test('modules v2：保留前缀、API 版本、requires 验证，忽略伪造来源与能力', async (t) => {
  const h = await harness(); t.after(() => h.kernel.dispose())
  for (const [id, manifest] of [
    ['builtin-evil', {}], ['v2', { apiVersion: 2 }], ['vstring', { apiVersion: '1' }],
    ['dup', { requires: ['valid', 'valid'] }], ['self', { requires: ['self'] }],
    ['invalid-dep', { requires: ['../bad'] }], ['many', { requires: Array.from({ length: 17 }, (_, i) => 'd' + i) }],
    ['valid', { apiVersion: 1, source: 'builtin', builtin: true, canReload: false, canToggle: false }],
  ]) await moduleDir(h.root, id, manifest, 'export function setup(api) { if (api.source !== "external" || api.builtin !== false) throw Error("source") }')
  await h.kernel.start()
  for (const item of h.kernel.list()) assert.equal(item.status, item.id === 'valid' ? 'loaded' : 'error', item.id)
  assert.match(row(h.kernel, 'builtin-evil').error, /保留/)
  assert.equal(row(h.kernel, 'valid').canReload, true)
  assert.equal(row(h.kernel, 'valid').canToggle, true)
  const invalid = createModuleKernel({ dataDir: h.root, registry: [builtin('bad-id', () => ({}))] })
  await assert.rejects(invalid.start(), /builtin-/); await invalid.dispose()
})

test('modules v2：稳定依赖顺序跨来源，重载/启停级联逆序清理，内置只导入一次', async (t) => {
  const trace = []; let imports = 0
  const h = await harness([
    builtin('builtin-root', () => { imports++; return { setup() { trace.push('+builtin-root'); return () => trace.push('-builtin-root') } } }, {}, true),
    builtin('builtin-child', () => { imports++; return { setup() { trace.push('+builtin-child'); return () => trace.push('-builtin-child') } } }, { requires: ['a'] }, true),
  ]); t.after(() => h.kernel.dispose())
  // 外部代码通过事件发送日志，不需进程全局测试状态。
  const source = (id) => `export async function setup(api) { await api.sendText({chatType:'private',chatId:'owner',text:'+${id}'}); return () => api.sendText({chatType:'private',chatId:'owner',text:'-${id}'}) }`
  h.sent.push = (payload) => { trace.push(payload.segments[0].data.text) }
  await moduleDir(h.root, 'a', { permissions: ['send:text'], requires: ['builtin-root'] }, source('a'))
  await moduleDir(h.root, 'z', { permissions: ['send:text'] }, source('z'))
  await h.kernel.start()
  assert.deepEqual(trace, ['+builtin-root', '+a', '+builtin-child', '+z'])
  trace.length = 0
  await h.kernel.reload('a')
  assert.deepEqual(trace, ['-builtin-child', '-a', '+a', '+builtin-child'])
  assert.equal(imports, 2)
  trace.length = 0
  await h.kernel.setEnabled('builtin-root', false)
  assert.deepEqual(trace, ['-builtin-child', '-a', '-builtin-root'])
  assert.equal(row(h.kernel, 'a').status, 'blocked'); assert.equal(row(h.kernel, 'builtin-child').status, 'blocked')
  trace.length = 0
  await h.kernel.setEnabled('builtin-child', true)
  assert.deepEqual(trace, []); assert.equal(row(h.kernel, 'builtin-root').enabled, false)
  await h.kernel.setEnabled('builtin-root', true)
  assert.deepEqual(trace, ['+builtin-root', '+a', '+builtin-child'])
  assert.equal(imports, 2)
  trace.length = 0; await h.kernel.dispose()
  assert.deepEqual(trace, ['-z', '-builtin-child', '-a', '-builtin-root'])
})

test('modules v2：缺失/环/失败/禁用依赖与下游隔离，修复后恢复', async (t) => {
  const h = await harness(); t.after(() => h.kernel.dispose())
  const configs = {
    missing: { requires: ['absent'] }, downstream: { requires: ['missing'] },
    cyclea: { requires: ['cycleb'] }, cycleb: { requires: ['cyclea'] }, cyclechild: { requires: ['cycleb'] },
    failed: {}, failchild: { requires: ['failed'] }, off: { enabled: false }, offchild: { requires: ['off'] }, healthy: {},
  }
  for (const [id, manifest] of Object.entries(configs)) await moduleDir(h.root, id, manifest, `export function setup() { ${id === 'failed' ? 'throw Error("failed")' : ''} }`)
  await h.kernel.start()
  for (const id of ['missing', 'cyclea', 'cycleb', 'failed']) assert.equal(row(h.kernel, id).status, 'error', id)
  for (const id of ['downstream', 'cyclechild', 'failchild', 'offchild']) assert.equal(row(h.kernel, id).status, 'blocked', id)
  assert.equal(row(h.kernel, 'healthy').status, 'loaded')
  await moduleDir(h.root, 'absent', {}, 'export default function() {}')
  await h.kernel.reload('absent')
  assert.equal(row(h.kernel, 'downstream').status, 'loaded')
  await moduleDir(h.root, 'cycleb', {}, 'export default { setup() {} }')
  await h.kernel.reload('cycleb')
  assert.equal(row(h.kernel, 'cyclechild').status, 'loaded')
})

test('modules v2：兼容旧状态，disabled 优先，enabled 不越过外部清单上限', async (t) => {
  for (const state of [{ disabled: ['ext', 'builtin-on'] }, { disabled: ['builtin-on'], enabled: ['builtin-on', 'builtin-off', 'ceiling'] }, { enabled: ['builtin-off'] }]) {
    const h = await harness([
      builtin('builtin-on', () => ({ setup() {} }), {}, true),
      builtin('builtin-off', () => ({ setup() {} })),
    ]); t.after(() => h.kernel.dispose())
    await moduleDir(h.root, 'ext', {}, 'export function setup() {}')
    await moduleDir(h.root, 'ceiling', { enabled: false }, 'throw Error("must not import")')
    await writeFile(join(h.root, 'state.json'), JSON.stringify(state))
    await h.kernel.start()
    assert.equal(row(h.kernel, 'ext').enabled, !state.disabled?.includes('ext'))
    assert.equal(row(h.kernel, 'builtin-on').enabled, !state.disabled?.includes('builtin-on'))
    assert.equal(row(h.kernel, 'builtin-off').enabled, Boolean(state.enabled?.includes('builtin-off')))
    assert.equal(row(h.kernel, 'ceiling').status, 'disabled'); assert.equal(row(h.kernel, 'ceiling').canToggle, false)
    await assert.rejects(h.kernel.setEnabled('ceiling', true), { code: 'MODULE_MANIFEST_DISABLED' })
  }
})

test('modules v2：状态写失败保持 live 与内存状态，后续操作仍可运行', async (t) => {
  const { rm } = await import('node:fs/promises')
  let setups = 0, cleanups = 0
  const h = await harness([builtin('builtin-test', () => ({ setup() { setups++; return () => cleanups++ } }), {}, true)])
  t.after(() => h.kernel.dispose()); await h.kernel.start()
  // 将目标改为目录，rename 必须失败（不依赖 root 下的权限语义）。
  await mkdir(join(h.root, 'state.json'))
  await assert.rejects(h.kernel.setEnabled('builtin-test', false), { code: 'MODULE_STATE_WRITE_FAILED' })
  assert.equal(row(h.kernel, 'builtin-test').status, 'loaded'); assert.equal(cleanups, 0)
  await rm(join(h.root, 'state.json'), { recursive: true })
  await h.kernel.setEnabled('builtin-test', false)
  assert.equal(cleanups, 1); assert.equal(setups, 1)
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'state.json'), 'utf8')), { disabled: ['builtin-test'], enabled: [] })
})

test('modules v2：内置存储符号链接与 1 MiB 限制，不扫描 .builtin', async (t) => {
  const outside = await mkdtemp(join(tmpdir(), 'dsh-module-outside-'))
  const h = await harness([builtin('builtin-storage', () => ({ async setup(api) { await api.storage.set('big', 'x'.repeat(1024 * 1024)) } }), { permissions: ['storage'] }, true)])
  t.after(() => h.kernel.dispose()); await h.kernel.start()
  assert.match(row(h.kernel, 'builtin-storage').error, /存储超过/)
  const h2 = await harness([builtin('builtin-storage', () => ({ setup() {} }), {}, true)])
  t.after(() => h2.kernel.dispose())
  await symlink(outside, join(h2.root, '.builtin'))
  await h2.kernel.start()
  assert.equal(h2.kernel.list().length, 1)
  assert.match(row(h2.kernel, 'builtin-storage').error, /符号链接/)
})

test('modules v2：旧异步事件失败不会破坏重载后的 runtime；当前失败级联阻塞', async (t) => {
  let rejectEvent, entered
  const enteredPromise = new Promise((resolve) => { entered = resolve })
  let setups = 0, cleanups = 0
  const h = await harness([
    builtin('builtin-root', () => ({ setup(api) { api.on('message', () => { entered(); return new Promise((_resolve, reject) => { rejectEvent = reject }) }) } }), { permissions: ['events'] }, true),
    builtin('builtin-child', () => ({ setup() { setups++; return () => cleanups++ } }), { requires: ['builtin-root'] }, true),
  ]); t.after(() => h.kernel.dispose()); await h.kernel.start()
  const pending = h.kernel.dispatch({ kind: 'message' }); await enteredPromise
  await h.kernel.setEnabled('builtin-root', true)
  rejectEvent(Error('stale')); await pending
  assert.equal(row(h.kernel, 'builtin-root').status, 'loaded'); assert.equal(row(h.kernel, 'builtin-child').status, 'loaded')
  const next = h.kernel.dispatch({ kind: 'message' })
  await new Promise((resolve) => setImmediate(resolve)); rejectEvent(Error('current')); await next
  assert.equal(row(h.kernel, 'builtin-root').status, 'error'); assert.equal(row(h.kernel, 'builtin-child').status, 'blocked')
  assert.equal(setups, 2); assert.equal(cleanups, 2)
})

test('modules v2：外部 default/named/default object/CommonJS 导出仍兼容，目录符号链接拒绝', async (t) => {
  const h = await harness(); t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'default-fn', {}, 'export default function() {}')
  await moduleDir(h.root, 'default-obj', {}, 'export default { setup() {} }')
  const dir = await moduleDir(h.root, 'common', { entry: 'index.cjs.js' }, '')
  await writeFile(join(dir, 'package.json'), '{"type":"commonjs"}')
  await writeFile(join(dir, 'index.cjs.js'), 'exports.setup = function() {}')
  const outside = await mkdtemp(join(tmpdir(), 'dsh-mod-link-'))
  await moduleDir(outside, 'link-dir', {}, 'export function setup() {}')
  await symlink(join(outside, 'link-dir'), join(h.root, 'link-dir'))
  await h.kernel.start()
  for (const id of ['default-fn', 'default-obj', 'common']) assert.equal(row(h.kernel, id).status, 'loaded', id)
  assert.match(row(h.kernel, 'link-dir').error, /符号链接/)
})


test('modules v2：清理排空存储写入后重新读取磁盘，修复内置存储可重试', async (t) => {
  const seen = []; let imports = 0
  const h = await harness([builtin('builtin-storage', () => {
    imports++
    return { async setup(api) { seen.push(await api.storage.get('value')); await Promise.all([api.storage.set('a', 1), api.storage.set('b', 2)]) } }
  }, { permissions: ['storage'] }, true)])
  t.after(() => h.kernel.dispose())
  const dir = join(h.root, '.builtin', 'builtin-storage')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'data.json'), 'x'.repeat(1024 * 1024 + 1))
  await h.kernel.start()
  assert.equal(row(h.kernel, 'builtin-storage').status, 'error'); assert.equal(imports, 0)
  await writeFile(join(dir, 'data.json'), '{"value":"repaired"}')
  await h.kernel.setEnabled('builtin-storage', true)
  assert.equal(row(h.kernel, 'builtin-storage').status, 'loaded')
  await h.kernel.setEnabled('builtin-storage', false)
  await writeFile(join(dir, 'data.json'), '{"value":"edited"}')
  await Promise.all([h.kernel.setEnabled('builtin-storage', true), h.kernel.setEnabled('builtin-storage', false), h.kernel.setEnabled('builtin-storage', true)])
  assert.deepEqual(seen, ['repaired', 'edited', 'edited'])
  assert.equal(imports, 1)
  assert.equal(row(h.kernel, 'builtin-storage').status, 'loaded')
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'data.json'), 'utf8')), { value: 'edited', a: 1, b: 2 })
})

test('delivery module API: builtin permission, duplicate rejection and setup-error cleanup', async (t) => {
  let savedApi
  const planner = { id: 'test-planner', stage: 'format', order: 0, plan: () => ({}) }
  const h = await harness([
    builtin('builtin-no-permission', () => ({ setup(api) { api.delivery.registerPlanner(planner) } }), {}, true),
    builtin('builtin-first', () => ({ setup(api) { savedApi = api; api.delivery.registerPlanner(planner) } }), { permissions: ['delivery:plan'] }, true),
    builtin('builtin-second', () => ({ setup(api) { api.delivery.registerPlanner({ ...planner, id: 'another' }) } }), { permissions: ['delivery:plan'] }, true),
  ])
  t.after(() => h.kernel.dispose())
  await h.kernel.start()
  assert.match(row(h.kernel, 'builtin-no-permission').error, /permission: delivery:plan/)
  assert.equal(row(h.kernel, 'builtin-first').status, 'loaded')
  assert.match(row(h.kernel, 'builtin-second').error, /stage 已注册/)
  assert.equal(h.deliveryRegistry.list().length, 1)
  await h.kernel.setEnabled('builtin-first', false)
  assert.equal(h.deliveryRegistry.resolve(), null)
  assert.throws(() => savedApi.delivery.registerPlanner(planner), /模块已停止/)
  // The previously failed module can register once its stage becomes available.
  assert.equal((await h.kernel.setEnabled('builtin-second', true)).status, 'loaded')
  await h.kernel.dispose()
  assert.deepEqual(h.deliveryRegistry.list(), [])

  const failed = await harness([builtin('builtin-throws', () => ({ setup(api) {
    api.delivery.registerPlanner(planner)
    throw Error('setup failed')
  } }), { permissions: ['delivery:plan'] }, true)])
  t.after(() => failed.kernel.dispose())
  await failed.kernel.start()
  assert.equal(row(failed.kernel, 'builtin-throws').status, 'error')
  assert.deepEqual(failed.deliveryRegistry.list(), [])
})

test('delivery module API: external cannot register even with permission and forged source', async (t) => {
  const h = await harness()
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'external-planner', { permissions: ['delivery:plan'], source: 'builtin', builtin: true }, `
    export function setup(api) {
      api.delivery.registerPlanner({ id: 'external', stage: 'format', order: 0, plan() {} })
    }
  `)
  await h.kernel.start()
  assert.equal(row(h.kernel, 'external-planner').status, 'error')
  assert.match(row(h.kernel, 'external-planner').error, /仅允许内置模块/)
  assert.deepEqual(h.deliveryRegistry.list(), [])
  assert.equal((await h.kernel.reload('external-planner')).status, 'error')
  assert.deepEqual(h.deliveryRegistry.list(), [])
})

test('delivery module API: dependency reload/disable, builtin re-enable and dispose clean registration', async (t) => {
  let setups = 0, imports = 0
  const h = await harness([builtin('builtin-dependent-planner', () => {
    imports++
    return { setup(api) {
      setups++
      api.delivery.registerPlanner({ id: 'dependent', stage: 'format', plan() {} })
    } }
  }, { permissions: ['delivery:plan'], requires: ['dependency'] }, true)])
  t.after(() => h.kernel.dispose())
  await moduleDir(h.root, 'dependency', {}, 'export function setup() {}')
  await h.kernel.start()
  assert.equal(h.deliveryRegistry.resolve().id, 'dependent')
  await h.kernel.reload('dependency')
  assert.equal(setups, 2)
  assert.equal(imports, 1)
  assert.equal(h.deliveryRegistry.list().length, 1)
  await h.kernel.setEnabled('dependency', false)
  assert.equal(row(h.kernel, 'builtin-dependent-planner').status, 'blocked')
  assert.equal(h.deliveryRegistry.resolve(), null)
  await h.kernel.setEnabled('dependency', true)
  assert.equal(h.deliveryRegistry.resolve().id, 'dependent')
  await h.kernel.setEnabled('builtin-dependent-planner', false)
  assert.equal(h.deliveryRegistry.resolve(), null)
  await h.kernel.setEnabled('builtin-dependent-planner', true)
  assert.equal(h.deliveryRegistry.list().length, 1)
  await h.kernel.dispose()
  assert.equal(h.deliveryRegistry.resolve(), null)
})


test('modules：sendText 优先 delivery，保留结果/来源与旧 outbound harness', async (t) => {
  for (const injected of [false, true]) {
    const calls = []
    const result = { ok: false, error: 'RATE_LIMITED', parts: 1 }
    const delivery = { async deliver(intent) { calls.push(intent); return result } }
    const h = await harness([], null, injected ? delivery : null)
    t.after(() => h.kernel.dispose())
    await moduleDir(h.root, 'sender', { permissions: ['send:text', 'storage'] }, `
      export async function setup(api) {
        await api.storage.set('result', await api.sendText({ chatType: 'group', chatId: ' 20001 ', text: ' hello ' }))
      }
    `)
    await h.kernel.start()
    assert.equal(h.kernel.list()[0].status, 'loaded')
    const expected = { chatType: 'group', chatId: '20001', segments: [{ type: 'text', data: { text: 'hello' } }], source: 'module:sender' }
    assert.deepEqual(injected ? calls : h.sent, [expected])
    if (injected) {
      assert.equal(h.sent.length, 0)
      const stored = JSON.parse(await readFile(join(h.root, 'sender', 'data.json'), 'utf8'))
      assert.deepEqual(stored.result, result)
    }
  }
})
