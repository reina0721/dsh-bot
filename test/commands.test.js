import { biliCommand, stickerCommand } from '../src/modules/builtin/media-features/commands.js'
import { createMediaFeaturesPort } from '../src/modules/media-features-port.js'
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createIdentityService } from '../src/cognition/identities.js'
import { createPurposeService } from '../src/cognition/purpose.js'
import { createCommandService, parseCommand } from '../src/cognition/commands.js'
import { createQqActions } from '../src/cognition/qq-actions.js'
import { createApprovalService } from '../src/core/approvals.js'
import { createStore } from '../src/cognition/store.js'
import { createAccess, normalizeAccess } from '../src/core/access.js'

function harness(overrides = {}, services = {}) {
  let config = {
    botQQ: '999999',
    access: normalizeAccess({ mode: 'allowlist', ownerQQ: '10001', groups: ['20001'] }),
    cognition: {
      turn: { groupReplyMode: 'addressed' },
      proactivity: { enabled: false },
      modelRouting: { privateDefault: '', groupDefault: '', routes: [] },
    },
    media: { enabled: true, images: { enabled: true }, audio: { ttsEnabled: true }, stickers: { enabled: true }, tts: { maxChars: 300 } },
    ...overrides,
  }
  const sent = []
  const outbound = {
    async deliver(payload) {
      sent.push(payload)
      return { ok: true, messageId: 'm1' }
    },
  }
  const memory = {
    remembered: [],
    forgotten: [],
    remember(text, opts) { this.remembered.push([text, opts]); return { id: 'mem-1' } },
    forgetMatching(query, opts) { this.forgotten.push([query, opts]); return [{ id: 'mem-1' }] },
  }
  const llm = {
    async currentRoute(chat) {
      const routes = config.cognition.modelRouting.routes
      const entry = routes.find((item) => item.startsWith(`${chat.chatId}=`))
      if (entry) return { provider: entry.split('=')[1].split('/')[0], model: entry.split('=')[1].split('/')[1], source: 'chat' }
      return { provider: 'p', model: 'm', source: 'dsh' }
    },
  }
  const runtime = { summary: () => ({ active: true, sessions: 2 }) }
  const purposeItems = [{ id: 'goal_abc12345', type: 'goal', title: '学会做面包', status: 'active', progress: 0.2 }]
  const purpose = {
    list(args = {}) { return purposeItems.filter((item) => !args.status || item.status === args.status) },
    create(input) { const item = { id: 'goal_new00001', type: 'goal', status: 'active', progress: 0, ...input }; purposeItems.push(item); return item },
    update(id, patch) { const item = purposeItems.find((row) => row.id === id); Object.assign(item, patch); return item },
    complete(id) { const item = purposeItems.find((row) => row.id === id); item.status = 'done'; return item },
    abandon(id) { const item = purposeItems.find((row) => row.id === id); item.status = 'abandoned'; return item },
    pause(id) { const item = purposeItems.find((row) => row.id === id); item.status = 'paused'; return item },
    resume(id) { const item = purposeItems.find((row) => row.id === id); item.status = 'active'; return item },
  }
  const qqActions = {
    async like(args) { return { ok: true, target: args.userId, times: args.times || 1 } },
    async poke() { return { ok: true } },
    async groupInfo(args) { if (args.chatType !== 'group') return { ok: false, error: 'GROUP_ONLY' }; return { ok: true, groupId: 'g1', groupName: '测试群', memberCount: 3, maxMemberCount: 200, ownerId: '10001' } },
    async memberInfo(args) { if (args.chatType !== 'group') return { ok: false, error: 'GROUP_ONLY' }; return { ok: true, userId: args.userId || '10001', nickname: '小明', card: '小明卡', role: 'owner' } },
  }
  const access = services.access || {
    isOwner: (cfg, id) => String(id) === '10001',
    summary: () => ({ mode: 'allowlist' }),
    canSend: () => ({ allowed: services.allowSend !== false }),
  }
  const configWrites = []
  const setConfig = (next) => {
    configWrites.push(next)
    config = next
    return { config: next, issues: [] }
  }
  const service = createCommandService({
    getConfig: () => config,
    setConfig,
    access,
    outbound,
    delivery: services.delivery,
    llm: services.llm === undefined ? llm : services.llm,
    memory,
    runtime: services.runtime === undefined ? runtime : services.runtime,
    qqActions: services.qqActions || qqActions,
    purpose: services.purpose === undefined ? purpose : services.purpose,
    requests: services.requests,
    approvals: services.approvals,
    clock: services.clock,
    reminders: services.reminders,
    identities: services.identities,
    media: services.media,
    stickers: services.stickers,
    bilibili: services.bilibili,
    logger: null,
  })
  // Feature parity fixtures explicitly install module handlers; core has no fallback.
  if (services.bilibili) service.registerCommand('bili', input => biliCommand({ ...input, bilibili: services.bilibili, getConfig: () => ({ bilibili: config.content?.bilibili }) }), { allowProtected: true, audience: 'owner-or-operator' })
  if (services.stickers) {
    const authorize = () => config.media?.enabled && config.media?.images?.enabled && config.media?.stickers?.enabled
    const port = createMediaFeaturesPort({ getConfig: () => config, assertActive() {}, media: services.media, stickers: services.stickers, delivery: services.delivery || outbound, access, authorizeStickerSend: authorize })
    service.registerCommand('sticker', input => port.withCommand(input.turn, commandToken => stickerCommand({ ...input, commandToken, port: port.api, authorize })), { allowProtected: true, audience: 'owner' })
  }
  return { service, sent, memory, getConfig: () => config, setConfig, configWrites }
}

function turn(text, { chatType = 'private', chatId = '10001', senderId = '10001' } = {}) {
  return { chatType, chatId, senderId, text }
}

test('parseCommand：识别 /name 与参数，非命令返回 null', () => {
  assert.deepEqual(parseCommand('/status'), { name: 'status', args: '', raw: '/status' })
  assert.deepEqual(parseCommand('  /model  p/m  '), { name: 'model', args: 'p/m', raw: '/model  p/m' })
  assert.equal(parseCommand('你好'), null)
  assert.equal(parseCommand('/'), null)
})

test('commands：非主人静默忽略，不发送', async () => {
  const { service, sent } = harness()
  const result = await service.handle(turn('/status', { senderId: '10002' }))
  assert.deepEqual(result, { handled: true, reply: '' })
  assert.equal(sent.length, 0)
})

test('command deny list: built-ins stop before service calls and config writes, including mixed case', async () => {
  const calls = []
  const h = harness({ cognition: {
    permissions: { deniedCommands: ['kick', 'draw', 'quiet', 'model', 'remember', 'forget'] },
    qqAdmin: { enabled: true },
  }, media: { enabled: true, images: { enabled: true, generateEnabled: true } } }, {
    qqActions: { kick: (...args) => calls.push(args) },
    media: { generateImage: (...args) => calls.push(args), sendMedia: (...args) => calls.push(args) },
  })
  const before = structuredClone(h.getConfig())
  for (const text of ['/kick 10002 confirm', '/KiCk 10002 confirm', '/DRAW cat', '/quiet', '/model p/m', '/remember secret', '/forget secret']) {
    const result = await h.service.handle(turn(text, { chatType: 'group', chatId: '20001' }))
    assert.equal(result.reply, '该命令已被操作员禁用。')
    assert.equal(result.handled, true)
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(h.memory.remembered, [])
  assert.deepEqual(h.memory.forgotten, [])
  assert.deepEqual(h.configWrites, [])
  assert.deepEqual(h.getConfig(), before)
  assert.equal(h.sent.length, 7)
  assert.ok(h.sent.every((item) => item.source === 'command' && item.segments[0].data.text === '该命令已被操作员禁用。'))
})

test('command deny list: external module handlers cannot bypass normalized names', async () => {
  const h = harness({ cognition: { permissions: { deniedCommands: ['module_cmd-1', 'publiccmd'] } } })
  let calls = 0
  h.service.registerCommand('Module_Cmd-1', () => { calls++; return 'ran' })
  h.service.registerCommand('PublicCmd', () => { calls++; return 'ran' }, { ownerOnly: false })
  for (const name of ['module_cmd-1', 'MODULE_CMD-1', 'PublicCmd']) {
    assert.equal((await h.service.handle(turn(`/${name}`))).reply, '该命令已被操作员禁用。')
  }
  assert.equal(calls, 0)
  assert.deepEqual(h.configWrites, [])
})

test('command deny list: non-owner remains silent for built-ins and denied module commands', async () => {
  const h = harness({ cognition: { permissions: { deniedCommands: ['kick', 'echo', 'publiccmd'] } } })
  let calls = 0
  h.service.registerCommand('echo', () => { calls++ })
  h.service.registerCommand('publiccmd', () => { calls++ }, { ownerOnly: false })
  for (const name of ['kick', 'echo', 'publiccmd']) {
    assert.deepEqual(await h.service.handle(turn(`/${name}`, { senderId: '10002' })), { handled: true, reply: '' })
  }
  assert.equal(calls, 0)
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.configWrites, [])
})

test('command deny list: empty and unlisted policies preserve built-ins, help and public module commands', async () => {
  for (const deniedCommands of [[], ['kick']]) {
    const h = harness({ cognition: { permissions: { deniedCommands } } })
    h.service.registerCommand('echo', () => 'module reply', { ownerOnly: false })
    assert.equal((await h.service.handle(turn('/remember keep this'))).handled, true)
    assert.equal(h.memory.remembered.length, 1)
    const help = await h.service.handle(turn('/help'))
    assert.match(help.reply, /\/kick/)
    assert.match(help.reply, /\/echo/)
    assert.equal((await h.service.handle(turn('/echo', { senderId: '10002' }))).reply, 'module reply')
  }
})

test('command deny list: unknown commands retain existing owner and non-owner behavior', async () => {
  const h = harness({ cognition: { permissions: { deniedCommands: ['nope'] } } })
  assert.equal((await h.service.handle(turn('/nope'))).reply, '未知命令。发送 /help 查看可用命令。')
  assert.deepEqual(await h.service.handle(turn('/nope', { senderId: '10002' })), { handled: true, reply: '' })
  assert.equal(h.sent.length, 1)
  assert.deepEqual(h.configWrites, [])
})

test('command deny list: policy updates take effect without rebuilding the service', async () => {
  const h = harness({ cognition: { permissions: { deniedCommands: [] } } })
  let calls = 0
  h.service.registerCommand('echo', () => { calls++; return 'ok' })
  assert.equal((await h.service.handle(turn('/echo'))).reply, 'ok')
  h.setConfig({ ...h.getConfig(), cognition: { permissions: { deniedCommands: ['echo'] } } })
  assert.equal((await h.service.handle(turn('/echo'))).reply, '该命令已被操作员禁用。')
  h.setConfig({ ...h.getConfig(), cognition: { permissions: { deniedCommands: [] } } })
  assert.equal((await h.service.handle(turn('/echo'))).reply, 'ok')
  assert.equal(calls, 2)
})

test('commands：/help 与 /status 回复', async () => {
  const { service, sent } = harness()
  const help = await service.handle(turn('/help'))
  assert.equal(help.handled, true)
  assert.match(help.reply, /\/status/)
  assert.equal(sent.length, 1)

  const status = await service.handle(turn('/status'))
  assert.match(status.reply, /运行时：agent/)
  assert.match(status.reply, /会话：2/)
  assert.match(status.reply, /当前模型：p\/m/)
  assert.equal(sent.length, 2)
})

test('commands：外部命令分发、帮助、重复检查与 dispose', async () => {
  const { service } = harness()
  let received = null
  const dispose = service.registerCommand('echo', ({ turn: value, parsed, args }) => {
    received = { value, parsed, args }
    return { reply: 'echo:' + args }
  })
  assert.throws(() => service.registerCommand('echo', () => ''), /已注册/)
  assert.throws(() => service.registerCommand('status', () => ''), /已注册/)
  assert.throws(() => service.registerCommand('Bad.Name', () => ''), /命令名/)
  const result = await service.handle(turn('/echo hello'))
  assert.equal(result.reply, 'echo:hello')
  assert.equal(received.args, 'hello')
  assert.equal(received.parsed.name, 'echo')
  assert.match((await service.handle(turn('/help'))).reply, /模块命令：\/echo/)
  dispose()
  assert.doesNotThrow(() => service.registerCommand('echo', () => 'again'))
})

test('commands：外部命令 ownerOnly 默认开启，可显式开放，异常变短回复', async () => {
  const { service, sent } = harness()
  service.registerCommand('privatecmd', () => 'secret')
  service.registerCommand('publiccmd', ({ args }) => args || 'public', { ownerOnly: false })
  service.registerCommand('broken', () => { throw new Error('sensitive detail') }, { ownerOnly: false })
  assert.deepEqual(await service.handle(turn('/privatecmd', { senderId: '10002' })), { handled: true, reply: '' })
  assert.equal((await service.handle(turn('/publiccmd hi', { senderId: '10002' }))).reply, 'hi')
  assert.match((await service.handle(turn('/broken', { senderId: '10002' }))).reply, /执行失败/)
  assert.doesNotMatch(sent.at(-1).segments[0].data.text, /sensitive/)
})

test('commands：/quiet 与 /active 持久化群聊模式与主动开关', async () => {
  const { service, getConfig } = harness()
  const quiet = await service.handle(turn('/quiet'))
  assert.match(quiet.reply, /安静模式/)
  assert.equal(getConfig().cognition.turn.groupReplyMode, 'addressed')
  assert.equal(getConfig().cognition.proactivity.enabled, false)

  const active = await service.handle(turn('/active'))
  assert.match(active.reply, /活跃模式/)
  assert.equal(getConfig().cognition.turn.groupReplyMode, 'probability')
  assert.equal(getConfig().cognition.proactivity.enabled, true)
})

test('commands：/model 查看、设置、清除当前会话覆盖', async () => {
  const { service, getConfig, sent } = harness()
  const shown = await service.handle(turn('/model'))
  assert.match(shown.reply, /当前会话模型：p\/m/)

  const set = await service.handle(turn('/model opencode-go/deepseek-v4.1-flash'))
  assert.match(set.reply, /已设为 opencode-go\/deepseek-v4.1-flash/)
  assert.deepEqual(getConfig().cognition.modelRouting.routes, ['10001=opencode-go/deepseek-v4.1-flash'])

  const shownAgain = await service.handle(turn('/model'))
  assert.match(shownAgain.reply, /opencode-go\/deepseek-v4.1-flash/)

  const bad = await service.handle(turn('/model nope'))
  assert.match(bad.reply, /格式应为 provider\/model/)

  const cleared = await service.handle(turn('/model clear'))
  assert.match(cleared.reply, /已清除/)
  assert.deepEqual(getConfig().cognition.modelRouting.routes, [])
  assert.equal(sent.length, 5)
})

test('commands：/remember 与 /forget 走记忆服务并带作用域', async () => {
  const { service, memory, sent } = harness()
  const remembered = await service.handle(turn('/remember 主人喜欢面食'))
  assert.match(remembered.reply, /已记住/)
  assert.deepEqual(memory.remembered[0][0], '主人喜欢面食')
  assert.deepEqual(memory.remembered[0][1].scope, { scopeType: 'private', scopeId: '10001' })

  const forgotten = await service.handle(turn('/forget 面食'))
  assert.match(forgotten.reply, /已遗忘 1 条/)
  assert.deepEqual(memory.forgotten[0][1].scope, { scopeType: 'private', scopeId: '10001' })
  assert.equal(sent.length, 2)
})

test('commands：群聊命令回复受 access/outbound 拒绝时返回空回复', async () => {
  let config = { cognition: { turn: { groupReplyMode: 'addressed' }, proactivity: { enabled: false }, modelRouting: { routes: [] } } }
  const sent = []
  const service = createCommandService({
    getConfig: () => config,
    setConfig: (next) => { config = next; return { config: next } },
    access: { isOwner: () => true, summary: () => ({ mode: 'allowlist' }) },
    outbound: { async deliver(payload) { sent.push(payload); return { ok: false, blocked: true, error: 'ACCESS_DENIED' } } },
    llm: { currentRoute: async () => null },
    memory: null,
    runtime: { summary: () => ({ active: false, sessions: 0 }) },
  })
  const result = await service.handle(turn('/status', { chatType: 'group', chatId: '20002', senderId: '10001' }))
  assert.equal(result.handled, true)
  assert.equal(result.reply, '')
  assert.equal(sent.length, 1)
})

test('commands：未知命令给提示，非命令交给认知管线', async () => {
  const { service, sent } = harness()
  const unknown = await service.handle(turn('/nope'))
  assert.match(unknown.reply, /未知命令/)
  assert.equal(sent.length, 1)
  const normal = await service.handle(turn('你好'))
  assert.deepEqual(normal, { handled: false })
})

test('commands：/bili 支持关闭、热门、搜索、BV 与短错误', async () => {
  const disabled = harness({ content: { bilibili: { enabled: false } } }, { bilibili: { hot: async () => { throw new Error('不应调用') } } })
  assert.equal((await disabled.service.handle(turn('/bili hot'))).reply, 'B站内容未启用')

  const calls = []
  const bilibili = {
    async hot() { calls.push(['hot']); return { ok: true, items: [{ title: '热门', author: 'UP', play: 12, duration: '01:02', url: 'https://www.bilibili.com/video/BVhot' }] } },
    async search(value) { calls.push(['search', value]); return { ok: true, items: [] } },
    async video(value) { calls.push(['video', value]); return { ok: true, items: [{ title: '视频', author: 'UP', play: 1, duration: '00:03', url: 'https://www.bilibili.com/video/' + value }] } },
  }
  const enabled = harness({ content: { bilibili: { enabled: true } } }, { bilibili })
  assert.match((await enabled.service.handle(turn('/bili hot'))).reply, /热门/)
  assert.match((await enabled.service.handle(turn('/bili 猫猫'))).reply, /没有找到/)
  assert.match((await enabled.service.handle(turn('/bili BV1abcdef'))).reply, /视频/)
  assert.deepEqual(calls, [['hot'], ['search', '猫猫'], ['video', 'BV1abcdef']])
  bilibili.hot = async () => { throw new Error('upstream detail') }
  assert.match((await enabled.service.handle(turn('/bili hot'))).reply, /B站请求失败：upstream detail/)
})

test('commands：/bili comments|share 支持结果、空评论、用法、帮助与短错误', async () => {
  const calls = []
  const bilibili = {
    async comments(bvid) { calls.push(['comments', bvid]); return { ok: true, items: [{ author: '评论者', content: '公开正文', like: 7 }] } },
    share(bvid) { calls.push(['share', bvid]); return { url: 'https://www.bilibili.com/video/' + bvid, bvid } },
  }
  const { service } = harness({ content: { bilibili: { enabled: true } } }, { bilibili })
  const bvid = 'BV1xx411c7mD'
  assert.equal((await service.handle(turn('/bili comments ' + bvid))).reply, '1. 评论者 · 赞 7\n公开正文')
  assert.equal((await service.handle(turn('/bili share ' + bvid))).reply, 'https://www.bilibili.com/video/' + bvid)
  assert.deepEqual(calls, [['comments', bvid], ['share', bvid]])
  for (const kind of ['comments', 'share']) assert.match((await service.handle(turn('/bili ' + kind))).reply, /用法/)
  assert.equal(calls.length, 2)
  assert.match((await service.handle(turn('/help'))).reply, /bili comments BV号.*bili share BV号/)
  assert.match((await service.handle(turn('/bili'))).reply, /bili comments BV号.*bili share BV号/)
  bilibili.comments = async () => ({ ok: true, items: [] })
  assert.equal((await service.handle(turn('/bili comments ' + bvid))).reply, '没有可显示的 B站公开评论。')
  bilibili.comments = async () => { throw new Error('B站公开接口要求登录；不使用 Cookie/WBI') }
  assert.match((await service.handle(turn('/bili comments ' + bvid))).reply, /B站请求失败：.*不使用 Cookie\/WBI/)
  bilibili.share = () => { throw new Error('无效的 BV 号') }
  assert.match((await service.handle(turn('/bili share bad'))).reply, /B站请求失败：无效的 BV 号/)
})

test('commands：/bili comments|share 关闭与非主人不调用服务', async () => {
  let calls = 0
  const bilibili = { comments() { calls++; throw new Error('不应调用') }, share() { calls++; throw new Error('不应调用') } }
  for (const enabled of [false, true]) {
    const { service } = harness({ content: { bilibili: { enabled } } }, { bilibili })
    for (const kind of ['comments', 'share']) {
      if (!enabled) assert.equal((await service.handle(turn('/bili ' + kind + ' BV1xx411c7mD'))).reply, 'B站内容未启用')
      await service.handle(turn('/bili ' + kind + ' BV1xx411c7mD', { senderId: '99999' }))
    }
  }
  assert.equal(calls, 0)
})

test('commands：/tts 合成并向当前聊天发送语音，失败时短回复', async () => {
  const calls = []
  const media = {
    async synthesize(text) { calls.push(['synthesize', text]); return '/media/out.mp3' },
    async sendMedia(payload) { calls.push(['send', payload]) },
  }
  const { service, sent } = harness({}, { media })
  const result = await service.handle(turn('/tts 你好', { chatType: 'group', chatId: '20001' }))
  assert.deepEqual(result, { handled: true, reply: '' })
  assert.equal(sent.length, 0)
  assert.equal(calls[1][1].kind, 'record')
  assert.equal(calls[1][1].chatId, '20001')

  media.synthesize = async () => { throw new Error('provider down') }
  const failed = await service.handle(turn('/tts 失败'))
  assert.match(failed.reply, /TTS 失败：provider down/)
})

test('commands：/say 只通过 outbound 发送一次且不返回重复文本', async () => {
  const { service, sent } = harness()
  const result = await service.handle(turn('/say 只发一次'))
  assert.equal(result.reply, '')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].source, 'command')
  assert.equal(sent[0].segments[0].data.text, '只发一次')
})

test('commands：/sticker 发送图片；空库提示上传', async () => {
  const mediaCalls = []
  const media = { async sendMedia(payload) { mediaCalls.push(payload) } }
  const stickers = {
    async list() {}, async importBuffer() {}, async updateTags() {}, async remove() {}, async status() {},
    async pick({ tag }) { return tag === '空' ? null : { id: 's1', name: 'cat.png' } },
    async fileFor() { return { path: '/media/stickers/s1.png', mime: 'image/png', size: 3 } },
  }
  const { service, sent } = harness({}, { media, stickers })
  const success = await service.handle(turn('/sticker 猫'))
  assert.equal(success.reply, '')
  assert.equal(mediaCalls[0].kind, 'image')
  const empty = await service.handle(turn('/sticker 空'))
  assert.match(empty.reply, /还没有表情包/)
  assert.equal(sent.length, 1)
})

test('commands：媒体命令发送前检查 access.canSend', async () => {
  let calls = 0
  const media = { async synthesize() { calls += 1 }, async sendMedia() { calls += 1 } }
  const stickers = { async pick() { calls += 1 } }
  const { service, sent } = harness({}, { media, stickers, allowSend: false })
  assert.equal((await service.handle(turn('/tts 不应发送'))).error, 'ACCESS_DENIED')
  assert.equal((await service.handle(turn('/sticker'))).error, 'ACCESS_DENIED')
  assert.equal((await service.handle(turn('/say 不应发送'))).error, 'ACCESS_DENIED')
  assert.equal(calls, 0)
  assert.equal(sent.length, 0)
})


test('commands：/like /poke /groupinfo /memberinfo 走 QQ 动作服务', async () => {
  const { service, sent } = harness()
  const like = await service.handle(turn('/like 3'))
  assert.match(like.reply, /已点赞 3 次/)

  const poke = await service.handle(turn('/poke', { chatType: 'group', chatId: '20001', senderId: '10001' }))
  assert.match(poke.reply, /已拍回去/)

  const info = await service.handle(turn('/groupinfo', { chatType: 'group', chatId: '20001', senderId: '10001' }))
  assert.match(info.reply, /测试群/)
  assert.match(info.reply, /3\/200 人/)

  const member = await service.handle(turn('/memberinfo 20002', { chatType: 'group', chatId: '20001', senderId: '10001' }))
  assert.match(member.reply, /成员：小明卡（20002）/)
  assert.equal(sent.length, 4)

  const privateInfo = await service.handle(turn('/groupinfo'))
  assert.match(privateInfo.reply, /只能在群里用/)
})


test('commands：/purpose 列表/新建/完成/进度', async () => {
  const { service, sent } = harness()
  const list = await service.handle(turn('/purpose'))
  assert.match(list.reply, /活跃目的/)
  assert.match(list.reply, /abc12345/)
  assert.match(list.reply, /学会做面包/)

  const add = await service.handle(turn('/purpose add 学会做蛋糕'))
  assert.match(add.reply, /已新建目的 new00001/)
  assert.match(add.reply, /学会做蛋糕/)

  const progress = await service.handle(turn('/purpose progress abc12345 50'))
  assert.match(progress.reply, /50%/)

  const done = await service.handle(turn('/purpose done abc12345'))
  assert.match(done.reply, /已完成/)
  assert.equal(sent.length, 4)
})

const adminEnabled = { cognition: { qqAdmin: { enabled: true, requireConfirm: true, maxText: 100 } } }
function adminCommands(overrides = {}, services = {}) {
  const calls = []
  const qqActions = Object.fromEntries(['setProfile', 'setGroupCard', 'setGroupName', 'setGroupAdmin', 'setGroupBan', 'setGroupWholeBan', 'setGroupKick', 'setEssence', 'deleteMsg'].map((method) => [method, async (args) => { calls.push([method, args]); return { ok: true } }]))
  return { ...harness({ ...adminEnabled, ...overrides }, { qqActions, ...services }), calls }
}

test('commands admin: every fixed command dispatches validated args in current conversation', async () => {
  const { service, calls } = adminCommands()
  const group = { chatType: 'group', chatId: '20001' }
  const cases = [
    ['/card 10002 名片 含空格', 'setGroupCard', { userId: '10002', card: '名片 含空格' }],
    ['/groupname 新群名', 'setGroupName', { name: '新群名' }],
    ['/admin 10002 off', 'setGroupAdmin', { userId: '10002', enable: false }],
    ['/mute 10002 2', 'setGroupBan', { userId: '10002', durationSeconds: 120 }],
    ['/mute 10002 0', 'setGroupBan', { userId: '10002', durationSeconds: 0 }],
    ['/wholemute on', 'setGroupWholeBan', { enable: true }],
    ['/kick 10002 confirm', 'setGroupKick', { userId: '10002', confirmed: 'confirm' }],
    ['/essence -12', 'setEssence', { messageId: '-12', confirmed: undefined }],
    ['/recall 12 confirm', 'deleteMsg', { messageId: '12', confirmed: 'confirm' }],
  ]
  for (const [command, method, expected] of cases) {
    await service.handle(turn(command, group))
    assert.deepEqual(calls.at(-1), [method, { operatorId: '10001', ...group, ...expected }])
  }
  await service.handle(turn('/profile 新昵称'))
  assert.deepEqual(calls.at(-1), ['setProfile', { operatorId: '10001', chatType: 'private', chatId: '10001', nickname: '新昵称' }])
  await service.handle(turn('/recall 12 confirm'))
  assert.equal(calls.at(-1)[1].chatType, 'private')
  assert.match((await service.handle(turn('/help'))).reply, /\/file 相对路径/)
})

test('commands admin: owner, opt-in, chat and access guards prevent replies and actions as appropriate', async () => {
  const names = ['profile 名', 'card 10002 卡', 'groupname 群', 'admin 10002 on', 'mute 10002 0', 'wholemute off', 'kick 10002 confirm', 'essence 12', 'recall 12 confirm', 'file a.txt']
  let mediaCalls = 0
  const denied = adminCommands({}, { allowSend: false, media: { async sendMedia() { mediaCalls++ } } })
  const disabled = adminCommands({ cognition: {} })
  const nonOwner = adminCommands()
  for (const name of names) {
    assert.equal((await denied.service.handle(turn('/' + name))).reply, '')
    assert.match((await disabled.service.handle(turn('/' + name))).reply, /未启用/)
    assert.equal((await nonOwner.service.handle(turn('/' + name, { senderId: '10002' }))).reply, '')
  }
  for (const h of [denied, disabled, nonOwner]) assert.equal(h.calls.length, 0)
  assert.equal(mediaCalls, 0)
  assert.equal(denied.sent.length, 0)
  const h = adminCommands()
  assert.match((await h.service.handle(turn('/profile 名', { chatType: 'group', chatId: '20001' }))).reply, /主人私聊/)
  for (const name of names.slice(1, 8)) assert.match((await h.service.handle(turn('/' + name))).reply, /当前群/)
  assert.equal(h.calls.length, 0)
})

test('commands admin: malformed args, extra tokens, invalid IDs, limits and confirmation never dispatch', async () => {
  const { service, calls } = adminCommands()
  const group = { chatType: 'group', chatId: '20001' }
  const invalid = ['/profile', '/card abc 卡', '/card 10002', '/groupname', '/groupname ' + '长'.repeat(101), '/admin 10002 yes', '/admin 10002 on extra', '/mute 10002 -1', '/mute 10002 1.5', '/mute 10002 43201', '/mute 10002 0 extra', '/wholemute on extra', '/kick 10002', '/kick 10002 CONFIRM', '/kick 10002 confirm extra', '/essence abc', '/essence 12 extra', '/recall 12', '/recall 12 yes', '/recall 12 confirm extra', '/recall 2147483648 confirm']
  for (const command of invalid) {
    const result = await service.handle(turn(command, command.startsWith('/profile') ? {} : group))
    assert.match(result.reply, /用法|确认/, command)
  }
  assert.equal(calls.length, 0)
  const optional = adminCommands({ cognition: { qqAdmin: { enabled: true, requireConfirm: false } } })
  await optional.service.handle(turn('/recall 12', group))
  assert.equal(optional.calls.at(-1)[0], 'deleteMsg')
  await optional.service.handle(turn('/kick 10002', group))
  assert.equal(optional.calls.length, 1)
})

test('commands admin: /file only passes relative media paths; rejects absolute and traversal', async () => {
  const mediaCalls = []
  const { service } = adminCommands({}, { media: { async sendMedia(payload) { mediaCalls.push(payload) } } })
  await service.handle(turn('/file inbound/report notes.pdf'))
  assert.deepEqual(mediaCalls, [{ chatType: 'private', chatId: '10001', kind: 'file', relativePath: 'inbound/report notes.pdf' }])
  for (const path of ['', '/etc/passwd', '../out.txt', 'inbound/../../out.txt', 'C:/out.txt', 'C:\\out.txt', '\\\\server\\file']) assert.match((await service.handle(turn('/file ' + path))).reply, /用法/)
  assert.equal(mediaCalls.length, 1)
  const failing = adminCommands({}, { media: { async sendMedia() { throw new Error('secret') } } })
  assert.doesNotMatch((await failing.service.handle(turn('/file a.txt'))).reply, /secret/)
})

test('image commands: draw/redraw/image send once to current chat without confirmation text', async () => {
  const calls = []
  const media = {
    async generateImage(prompt) { calls.push(['generate', prompt]); return { ok: true, path: 'generated/cat.png' } },
    async editImage(prompt, path) { calls.push(['edit', prompt, path]); return { ok: true, path: 'generated/edited.png' } },
    async sendMedia(payload) { calls.push(['send', payload]) },
  }
  const h = harness({ media: { enabled: true, images: { enabled: true, generateEnabled: true, editEnabled: true } } }, { media })
  for (const command of ['/draw 一只猫', '/redraw inbound/cat.png 蓝色背景', '/image inbound/ordinary.png']) {
    assert.deepEqual(await h.service.handle(turn(command, { chatType: 'group', chatId: '20001' })), { handled: true, reply: '' })
  }
  assert.deepEqual(calls, [
    ['generate', '一只猫'], ['send', { chatType: 'group', chatId: '20001', kind: 'image', relativePath: 'generated/cat.png' }],
    ['edit', '蓝色背景', 'inbound/cat.png'], ['send', { chatType: 'group', chatId: '20001', kind: 'image', relativePath: 'generated/edited.png' }],
    ['send', { chatType: 'group', chatId: '20001', kind: 'image', relativePath: 'inbound/ordinary.png' }],
  ])
  assert.equal(h.sent.length, 0)
  const help = await h.service.handle(turn('/help'))
  for (const name of ['/draw', '/redraw', '/image']) assert.ok(help.reply.includes(name))
})

test('image commands: disabled, owner/access denied and invalid inputs produce no media side effects', async () => {
  const calls = []
  const media = Object.fromEntries(['generateImage', 'editImage', 'sendMedia'].map((name) => [name, async (...args) => { calls.push([name, args]) }]))
  const enabled = { enabled: true, images: { enabled: true, generateEnabled: true, editEnabled: true } }
  const disabled = harness({}, { media })
  assert.ok((await disabled.service.handle(turn('/draw cat'))).reply.includes('未启用'))
  assert.ok((await disabled.service.handle(turn('/redraw source.png cat'))).reply.includes('未启用'))
  assert.ok((await harness({ media: { enabled: true } }, { media }).service.handle(turn('/image source.png'))).reply.includes('未启用'))
  const blocked = harness({ media: enabled }, { media, allowSend: false })
  const h = harness({ media: enabled }, { media })
  for (const cmd of ['/draw cat', '/redraw source.png cat', '/image source.png']) {
    assert.equal((await blocked.service.handle(turn(cmd))).error, 'ACCESS_DENIED')
    assert.deepEqual(await h.service.handle(turn(cmd, { senderId: '20002' })), { handled: true, reply: '' })
  }
  assert.equal(blocked.sent.length, 0)
  for (const path of ['../cat.png', '/etc/cat.png', 'C:/cat.png', 'C:cat.png', 'a' + String.fromCharCode(92) + 'cat.png', 'x' + String.fromCharCode(0) + '.png']) {
    assert.ok((await h.service.handle(turn('/redraw ' + path + ' cat'))).reply.includes('相对路径'))
    assert.ok((await h.service.handle(turn('/image ' + path))).reply.includes('相对路径'))
  }
  for (const cmd of ['/draw', '/draw ' + 'x'.repeat(1001), '/redraw source.png', '/redraw source.png ' + 'x'.repeat(1001), '/image']) assert.ok((await h.service.handle(turn(cmd))).reply)
  assert.deepEqual(calls, [])
})

test('image commands: provider/send failures return a short safe error', async () => {
  const media = { async generateImage() { throw new Error('provider-secret') }, async editImage() { throw new Error('provider-secret') }, async sendMedia() { throw new Error('raw gateway error') } }
  const h = harness({ media: { enabled: true, images: { enabled: true, generateEnabled: true, editEnabled: true } } }, { media })
  for (const cmd of ['/draw cat', '/redraw source.png cat', '/image source.png']) {
    const result = await h.service.handle(turn(cmd))
    assert.ok(result.reply.includes('图片操作失败'))
    assert.ok(!result.reply.includes('secret') && !result.reply.includes('raw gateway'))
  }
})

test('request commands: owner lists at most ten pending public summaries and confirms approve/reject', async () => {
  const calls = []
  const id = 'req_' + 'a'.repeat(32)
  const requests = {
    list(options) {
      calls.push(['list', options])
      return Array.from({ length: 12 }, (_, i) => ({ id, type: 'group', subType: 'invite', userId: '10002', groupId: '20001', comment: `comment-${i}\nline ` + 'sk-' + 's'.repeat(30), flag: 'private-flag' }))
    },
    async resolve(requestId, options) { calls.push(['resolve', requestId, options]); return { status: options.approve ? 'approved' : 'rejected', flag: 'private-flag', comment: 'raw-comment' } },
  }
  const { service } = harness({}, { requests })
  const result = await service.handle(turn('/requests'))
  assert.deepEqual(calls[0], ['list', { status: 'pending', limit: 10 }])
  assert.match(result.reply, /group\/invite.*QQ 10002.*群 20001.*comment-0 line/)
  assert.doesNotMatch(result.reply, /comment-10|comment-11|sk-ssss|private-flag/)
  assert.equal(result.reply.split('\n').length, 11)
  assert.match((await service.handle(turn(`/approve ${id} confirm`))).reply, /已批准/)
  assert.deepEqual(calls.at(-1), ['resolve', id, { approve: true, operatorId: '10001' }])
  assert.match((await service.handle(turn(`/reject ${id} confirm`))).reply, /已拒绝/)
  assert.deepEqual(calls.at(-1), ['resolve', id, { approve: false, operatorId: '10001' }])
  const help = (await service.handle(turn('/help'))).reply
  for (const name of ['/requests', '/approve', '/reject']) assert.ok(help.includes(name))
})

test('request commands: owner/access/enabled checks and exact confirm guard every side effect', async () => {
  const calls = []
  const requests = { list: (...args) => { calls.push(args); return [] }, resolve: async (...args) => { calls.push(args) } }
  const id = 'req_' + 'b'.repeat(32)
  const commands = ['/requests', `/approve ${id} confirm`, `/reject ${id} confirm`]
  for (const command of commands) {
    const nonOwner = harness({}, { requests })
    assert.deepEqual(await nonOwner.service.handle(turn(command, { senderId: '10002' })), { handled: true, reply: '' })
    assert.equal(nonOwner.sent.length, 0)
    const denied = harness({}, { requests, allowSend: false })
    assert.equal((await denied.service.handle(turn(command))).error, 'ACCESS_DENIED')
    assert.equal(denied.sent.length, 0)
    assert.match((await harness({ cognition: { requests: { enabled: false } } }, { requests }).service.handle(turn(command))).reply, /未启用/)
  }
  const { service } = harness({}, { requests })
  for (const name of ['approve', 'reject']) {
    for (const args of ['', id, `${id} CONFIRM`, `${id} yes`, `${id} confirm extra`, 'bad-id confirm', 'x'.repeat(101) + ' confirm']) assert.match((await service.handle(turn(`/${name} ${args}`))).reply, /用法|确认/)
  }
  assert.match((await service.handle(turn('/requests extra'))).reply, /用法/)
  assert.equal(calls.length, 0)
})

test('request commands: empty/missing services and failures return safe replies without raw comments or flags', async () => {
  assert.match((await harness({}, { requests: { list: () => [] } }).service.handle(turn('/requests'))).reply, /暂无/)
  assert.match((await harness().service.handle(turn('/requests'))).reply, /不可用/)
  const fail = () => { throw new Error('private-flag raw-comment secret') }
  const { service } = harness({}, { requests: { list: fail, resolve: fail } })
  for (const command of ['/requests', '/approve req_' + 'a'.repeat(32) + ' confirm', '/reject req_' + 'a'.repeat(32) + ' confirm']) {
    const { reply } = await service.handle(turn(command))
    assert.match(reply, /失败/)
    assert.doesNotMatch(reply, /private-flag|raw-comment|secret/)
  }
})

test('reminder commands owner, enable, usage and access gates precede service calls', async () => {
  let calls = 0
  const reminders = { add() { calls++; throw new Error('raw secret') }, list() { calls++; return [] }, cancel() { calls++ } }
  for (const command of ['/remind 60 hello', '/reminders', '/forgetreminder rem_abc']) {
    const h = harness({}, { reminders })
    assert.equal((await h.service.handle(turn(command, { senderId: '20002' }))).reply, '')
    assert.match((await h.service.handle(turn(command))).reply, /未启用/)
    const denied = harness({ cognition: { reminders: { enabled: true } } }, { reminders, allowSend: false })
    assert.equal((await denied.service.handle(turn(command))).error, 'ACCESS_DENIED')
  }
  const h = harness({ cognition: { reminders: { enabled: true } } }, { reminders })
  for (const command of ['/remind', '/remind 60', '/remind tomorrow hello', '/remind 1.5 hello', '/reminders extra', '/forgetreminder', '/forgetreminder rem_abc extra']) {
    assert.match((await h.service.handle(turn(command))).reply, /用法/)
  }
  assert.equal(calls, 0)
  assert.match((await h.service.handle(turn('/remind 60 hello'))).reply, /提醒操作失败/)
  assert.match(h.service.help, /\/remind/)
})

test('reminder commands add repeat/ISO, list at most ten and cancel with current owner scope', async () => {
  const calls = []
  const nextAt = Date.parse('2099-01-01T00:00:00Z')
  const reminders = {
    add(input) { calls.push(['add', input]); return { id: 'rem_abc', nextAt } },
    list(input) { calls.push(['list', input]); return [{ id: 'rem_abc', nextAt, text: 'hello' }] },
    cancel(id, input) { calls.push(['cancel', id, input]) },
  }
  const h = harness({ cognition: { reminders: { enabled: true } } }, { reminders })
  const context = { chatType: 'group', chatId: '20001' }
  assert.match((await h.service.handle(turn('/remind 60 hello', context))).reply, /rem_abc.*2099/)
  assert.deepEqual(calls[0], ['add', { ...context, text: 'hello', everySeconds: 60, createdBy: '10001' }])
  await h.service.handle(turn('/remind 2099-01-01T00:00:00Z once', context))
  assert.equal(calls[1][1].at, '2099-01-01T00:00:00Z')
  assert.match((await h.service.handle(turn('/reminders', context))).reply, /rem_abc.*hello/)
  assert.deepEqual(calls[2], ['list', { ...context, status: 'active', limit: 10 }])
  assert.match((await h.service.handle(turn('/forgetreminder rem_abc', context))).reply, /已取消/)
  assert.deepEqual(calls[3], ['cancel', 'rem_abc', { ...context, operatorId: '10001' }])
  assert.ok(h.sent.every((p) => p.source === 'command'))
})


test('steer command: owner private/group payload, Unicode text and no config writes', async () => {
  const calls = []
  const runtime = { active: () => true, async steer(...args) { calls.push(args); return { ok: true, sessionId: 's1' } } }
  const h = harness({}, { runtime })
  for (const input of [turn('/steer 先说结论'), turn('/steer ' + '😀'.repeat(1000), { chatType: 'group', chatId: '20001' })]) {
    assert.match((await h.service.handle(input)).reply, /已向当前会话插话/)
    assert.deepEqual(calls.at(-1), [input, input.text.slice(7)])
  }
  assert.equal(h.configWrites.length, 0)
  assert.equal(h.sent.length, 2)
  assert.match(h.service.help, /\/steer 文本/)
  assert.throws(() => h.service.registerCommand('steer', () => {}), /已注册/)
})

test('steer command: no args, inactive/oneshot or missing steer never dispatch', async () => {
  let calls = 0
  const steer = async () => { calls++; return { ok: true } }
  const h = harness({}, { runtime: { active: () => true, steer } })
  for (const command of ['/steer', '/steer   ', '/steer ' + '😀'.repeat(1001)]) {
    assert.match((await h.service.handle(turn(command))).reply, /用法：\/steer/)
  }
  for (const runtime of [null, {}, { active: () => true }, { active: () => false, steer }]) {
    const inactive = harness({}, { runtime })
    assert.equal((await inactive.service.handle(turn('/steer hello'))).reply, '当前不是 agent 运行时，无法插话')
    assert.equal(inactive.configWrites.length, 0)
  }
  assert.equal(calls, 0)
})

test('steer command: non-owner silent in private/group; access and deny list stop steer', async () => {
  let calls = 0
  const runtime = { active: () => { calls++; return true }, steer: async () => { calls++; return { ok: true } } }
  const h = harness({}, { runtime })
  for (const chat of [{}, { chatType: 'group', chatId: '20001' }]) {
    assert.deepEqual(await h.service.handle(turn('/steer injected text', { ...chat, senderId: '10002' })), { handled: true, reply: '' })
  }
  assert.equal(h.sent.length, 0)
  const blocked = harness({}, { runtime, allowSend: false })
  assert.equal((await blocked.service.handle(turn('/steer hello'))).error, 'ACCESS_DENIED')
  assert.equal(blocked.sent.length, 0)
  const denied = harness({ cognition: { permissions: { deniedCommands: ['steer'] } } }, { runtime })
  assert.match((await denied.service.handle(turn('/StEeR hello'))).reply, /已被操作员禁用/)
  assert.equal(calls, 0)
  for (const entry of [h, blocked, denied]) assert.equal(entry.configWrites.length, 0)
})

test('steer command: unavailable, inactive race and runtime failures produce safe replies', async () => {
  for (const [error, expected] of [['STEER_UNAVAILABLE', /不支持插话/], ['RUNTIME_INACTIVE', /当前不是 agent 运行时/], ['STEER_FAILED', /插话失败/], ['secret-provider-error', /插话失败/]]) {
    const h = harness({}, { runtime: { active: () => true, steer: async () => ({ ok: false, error, message: 'raw-secret' }) } })
    const { reply } = await h.service.handle(turn('/steer hello'))
    assert.match(reply, expected)
    assert.doesNotMatch(reply, /raw-secret|secret-provider-error/)
  }
  const h = harness({}, { runtime: { active: () => true, steer: async () => { throw new Error('raw-secret') } } })
  const { reply } = await h.service.handle(turn('/steer hello'))
  assert.match(reply, /插话失败/)
  assert.doesNotMatch(reply, /raw-secret/)
})

function operatorHarness(services = {}) {
  let h
  const queries = []
  const access = createAccess({ getConfig: () => h.getConfig() })
  const qqActions = createQqActions({ getConfig: () => h.getConfig(), gateway: { actions: {
    async getGroupInfo(id) { queries.push(['group', id]); return { group_name: '操作员测试群', member_count: 3 } },
    async getGroupMemberInfo(id, user) { queries.push(['member', id, user]); return { user_id: user, nickname: '操作员测试成员' } },
  } } })
  h = harness({ access: normalizeAccess({ mode: 'allowlist', ownerQQ: '10001', operators: ['10001', '10002'], groups: ['20001'] }),
    content: { bilibili: { enabled: true } } }, { access, qqActions,
    bilibili: { async hot() { return { items: [{ title: '离线视频', url: 'offline' }] } } }, ...services })
  return { ...h, queries, access }
}

test('operators: fixed safe commands work for owner/operator, strangers remain silent in private/group', async () => {
  for (const chatType of ['private', 'group']) {
    const h = operatorHarness()
    for (const senderId of ['10001', '10002', '10003']) {
      const context = { chatType, chatId: chatType === 'group' ? '20001' : senderId, senderId }
      for (const command of ['help', 'status', 'model', 'bili hot', 'groupinfo', 'memberinfo 10004']) {
        const before = h.sent.length
        const result = await h.service.handle(turn('/' + command, context))
        assert.equal(result.handled, true)
        assert.equal(Boolean(result.reply), senderId !== '10003', `${senderId} ${chatType} ${command}`)
        assert.equal(h.sent.length - before, senderId === '10003' ? 0 : 1)
      }
    }
    assert.deepEqual(h.configWrites, [])
    if (chatType === 'group') assert.deepEqual(h.queries, [
      ['group', '20001'], ['member', '20001', '10004'], ['group', '20001'], ['member', '20001', '10004'],
    ])
    else assert.deepEqual(h.queries, [])
  }
})

test('operators: unsafe/unknown commands and all model arguments are silent without side effects', async () => {
  const calls = []
  const tracked = new Proxy({}, { get: (_target, key) => (...args) => { calls.push([key, ...args]); return { ok: true } } })
  const h = operatorHarness({ runtime: tracked, requests: tracked, approvals: tracked, reminders: tracked, media: tracked, stickers: tracked, qqActions: tracked })
  const original = structuredClone(h.getConfig())
  const commands = ['profile name', 'card 10003 name', 'groupname name', 'admin 10003 on', 'mute 10003 1',
    'wholemute on', 'kick 10003 confirm', 'essence 1', 'recall 1 confirm', 'file files/a.txt',
    'approvals', 'approve apr_' + 'a'.repeat(32) + ' confirm', 'reject apr_' + 'a'.repeat(32) + ' confirm',
    'requests', 'approve req_fake confirm', 'reject req_fake confirm', 'remind 60 text', 'reminders', 'forgetreminder rem_fake',
    'steer text', 'quiet', 'active', 'remember text', 'forget text', 'like', 'poke', 'purpose', 'purpose add text', 'purpose plan abc12345', 'purpose step abc12345 1', 'purpose steps abc12345',
    'tts text', 'say text', 'draw cat', 'redraw a.png cat', 'image a.png', 'sticker', 'unknown',
    'model clear', 'MODEL p/m', 'model invalid']
  for (const chatType of ['private', 'group']) {
    for (const command of commands) {
      assert.deepEqual(await h.service.handle(turn('/' + command, { chatType, chatId: chatType === 'group' ? '20001' : '10002', senderId: '10002' })),
        { handled: true, reply: '' }, command)
    }
  }
  assert.deepEqual(calls, [])
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.configWrites, [])
  assert.deepEqual(h.memory.remembered, [])
  assert.deepEqual(h.memory.forgotten, [])
  assert.deepEqual(h.getConfig(), original)
})

test('operators: owner precedence retains writes, model settings and unknown-command reply', async () => {
  const h = operatorHarness()
  assert.match((await h.service.handle(turn('/model p/m'))).reply, /已设为/)
  assert.match((await h.service.handle(turn('/model clear'))).reply, /已清除/)
  assert.match((await h.service.handle(turn('/quiet'))).reply, /安静模式/)
  assert.match((await h.service.handle(turn('/unknown'))).reply, /未知命令/)
  assert.equal(h.configWrites.length, 3)
})

test('operators: external ownerOnly defaults remain, public commands preserve stranger access', async () => {
  const h = operatorHarness()
  const calls = []
  h.service.registerCommand('secret', () => { calls.push('secret'); return 'private module' })
  h.service.registerCommand('publiccmd', () => { calls.push('public'); return 'public module' }, { ownerOnly: false })
  for (const senderId of ['10001', '10002', '10003']) {
    const context = { senderId, chatId: senderId }
    assert.equal((await h.service.handle(turn('/secret', context))).reply, senderId === '10001' ? 'private module' : '')
    assert.equal((await h.service.handle(turn('/publiccmd', context))).reply, 'public module')
  }
  assert.deepEqual(calls, ['secret', 'public', 'public', 'public'])
  const help = (await h.service.handle(turn('/help', { senderId: '10002', chatId: '10002' }))).reply
  for (const name of ['help', 'status', 'model', 'bili', 'groupinfo', 'memberinfo', 'publiccmd']) assert.ok(help.includes('/' + name))
  assert.doesNotMatch(help, /secret|quiet|steer|remember|provider\/model|model clear/)
})

test('operators: deny list blocks safe and public module commands silently, empty policy restores reads', async () => {
  const h = operatorHarness()
  let calls = 0
  h.service.registerCommand('publiccmd', () => { calls++; return 'public reply' }, { ownerOnly: false })
  h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition,
    permissions: { deniedCommands: ['help', 'status', 'model', 'bili', 'groupinfo', 'memberinfo', 'publiccmd'] } } })
  for (const name of ['HELP', 'status', 'model', 'bili hot', 'groupinfo', 'memberinfo', 'PublicCmd']) {
    assert.deepEqual(await h.service.handle(turn('/' + name, { senderId: '10002', chatId: '10002' })), { handled: true, reply: '' })
  }
  assert.equal(calls, 0)
  assert.deepEqual(h.sent, [])
  assert.deepEqual(h.queries, [])
  assert.equal((await h.service.handle(turn('/status'))).reply, '该命令已被操作员禁用。')
  h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition, permissions: { deniedCommands: [] } } })
  assert.match((await h.service.handle(turn('/status', { senderId: '10002', chatId: '10002' }))).reply, /dsh-bot 状态/)
  assert.equal((await h.service.handle(turn('/publiccmd', { senderId: '10002', chatId: '10002' }))).reply, 'public reply')
  assert.equal(calls, 1)
  h.setConfig({ ...h.getConfig(), access: { ...h.getConfig().access, operators: [] } })
  assert.deepEqual(await h.service.handle(turn('/status', { senderId: '10002', chatId: '10002' })), { handled: true, reply: '' })
})

test('operators: safe commands cannot query or reply in groups outside allowlist', async () => {
  const h = operatorHarness()
  for (const name of ['help', 'status', 'model', 'bili hot', 'groupinfo', 'memberinfo']) {
    assert.deepEqual(await h.service.handle(turn('/' + name, { chatType: 'group', chatId: '20002', senderId: '10002' })),
      { handled: true, reply: '', error: 'ACCESS_DENIED' })
  }
  assert.deepEqual(h.queries, [])
  assert.deepEqual(h.sent, [])
})


function approvalCommands(t, services = {}) {
  let now = 1000000
  const clock = { now: () => now }
  const store = createStore({ clock })
  t.after(() => store.close())
  const approvals = createApprovalService({ store, clock })
  return { ...adminCommands({ cognition: { qqAdmin: { enabled: true, requireApproval: true, requireConfirm: true } } }, { approvals, clock, ...services }), approvals, store, advance: (ms) => { now += ms } }
}
const approvalGroup = { chatType: 'group', chatId: '20001' }

test('admin approvals: disabled retains direct execution; enabled queues all ten fixed actions after validation', async (t) => {
  const disabled = adminCommands({}, { approvals: { create() { throw new Error('must not queue') } } })
  await disabled.service.handle(turn('/kick 10002 confirm', approvalGroup))
  assert.equal(disabled.calls.length, 1)
  const mediaCalls = []
  const h = approvalCommands(t, { media: { async sendMedia(payload) { mediaCalls.push(payload) } } })
  for (const command of ['/profile 昵称', '/card 10002 卡', '/groupname 群', '/admin 10002 on', '/mute 10002 1', '/wholemute on', '/kick 10002 confirm', '/essence 12', '/recall 12 confirm', '/file files/a.txt']) {
    const reply = await h.service.handle(turn(command, command.startsWith('/profile') || command.startsWith('/file') ? {} : approvalGroup))
    assert.match(reply.reply, /apr_[a-f0-9]{32}.*\/approve apr_[a-f0-9]{32} confirm/)
  }
  assert.equal(h.approvals.list().length, 10)
  assert.deepEqual(h.calls, [])
  assert.deepEqual(mediaCalls, [])
  for (const command of ['/kick 10002', '/recall 12', '/admin 10002 yes', '/file ../x']) assert.match((await h.service.handle(turn(command, approvalGroup))).reply, /用法|确认/)
  assert.equal(h.approvals.list().length, 10)
  await h.service.handle(turn('/like'))
  assert.equal(h.approvals.list().length, 10)
})

test('admin approvals: approve replays once into original chat, result delivered, even with concurrent approvals', async (t) => {
  const h = approvalCommands(t)
  await h.service.handle(turn('/kick 10002 confirm', approvalGroup))
  const row = h.approvals.list()[0]
  const results = await Promise.all([h.service.handle(turn(`/approve ${row.id} confirm`)), h.service.handle(turn(`/approve ${row.id} confirm`))])
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.calls[0], ['setGroupKick', { operatorId: '10001', chatType: 'group', chatId: '20001', userId: '10002', confirmed: 'confirm' }])
  assert.equal(h.approvals.get(row.id).status, 'executed')
  assert.ok(results.some((result) => /已批准并执行/.test(result.reply)))
  assert.ok(results.some((result) => /处理失败/.test(result.reply)))
  assert.ok(h.sent.some((payload) => payload.chatId === '20001' && payload.segments[0].data.text === 'QQ 动作已完成。'))
  assert.match((await h.service.handle(turn(`/approve ${row.id} confirm`))).reply, /处理失败/)
  assert.equal(h.calls.length, 1)
})

test('admin approvals: reject, unknown/expired IDs, exact confirm and non-owner are safe without actions', async (t) => {
  const h = approvalCommands(t)
  await h.service.handle(turn('/mute 10002 1', approvalGroup))
  const row = h.approvals.list()[0]
  for (const command of ['/approvals', `/approve ${row.id} confirm`, `/reject ${row.id} confirm`]) {
    assert.deepEqual(await h.service.handle(turn(command, { senderId: '10002' })), { handled: true, reply: '' })
  }
  for (const verb of ['approve', 'reject']) {
    for (const args of [row.id, row.id + ' CONFIRM', row.id + ' confirm extra']) assert.match((await h.service.handle(turn(`/${verb} ${args}`))).reply, /用法/)
  }
  assert.equal(h.approvals.get(row.id).status, 'pending')
  assert.match((await h.service.handle(turn(`/reject ${row.id} confirm`))).reply, /已拒绝/)
  assert.match((await h.service.handle(turn(`/approve ${row.id} confirm`))).reply, /处理失败/)
  assert.match((await h.service.handle(turn('/approve apr_' + '0'.repeat(32) + ' confirm'))).reply, /处理失败/)
  await h.service.handle(turn('/mute 10002 0', approvalGroup))
  const expired = h.approvals.list()[0]
  h.advance(600000)
  assert.match((await h.service.handle(turn(`/approve ${expired.id} confirm`))).reply, /处理失败/)
  assert.equal(h.approvals.get(expired.id).status, 'expired')
  assert.equal(h.calls.length, 0)
})

test('admin approvals: full queue, secrets and caller-supplied bypass cannot dispatch; non-admin unaffected', async (t) => {
  const h = approvalCommands(t)
  for (let i = 0; i < 50; i++) await h.service.handle({ ...turn('/wholemute on', approvalGroup), approvalBypass: true })
  assert.equal(h.approvals.list({ limit: 50 }).length, 50)
  assert.match((await h.service.handle(turn('/wholemute off', approvalGroup))).reply, /队列已满/)
  assert.deepEqual(h.calls, [])
  h.advance(600000)
  assert.match((await h.service.handle(turn('/profile sk-' + 's'.repeat(30)))).reply, /疑似密钥/)
  assert.equal(h.approvals.list().length, 0)
  assert.match((await h.service.handle(turn('/groupinfo', approvalGroup))).reply, /QQ 动作服务不可用/)
})

test('admin approvals: pending list is bounded, redacted one-line, age shown; requests switch is independent', async (t) => {
  const h = approvalCommands(t)
  h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition, requests: { enabled: false } } })
  for (let i = 0; i < 12; i++) { h.approvals.create({ action: 'groupname', args: `name-${i}`, ...approvalGroup, senderId: '10001' }); h.advance(1000) }
  const row = h.approvals.list()[0]
  // The presentation boundary also redacts legacy records independently of creation validation.
  h.store.put('qq_admin_approval', row.id, { ...row, args: 'line\n' + 'sk-' + 's'.repeat(30) })
  const reply = (await h.service.handle(turn('/approvals'))).reply
  assert.equal(reply.split('\n').length, 11)
  assert.match(reply, /groupname.*line \[REDACTED\].*group:20001.*秒前/)
  assert.doesNotMatch(reply, /sk-ssss|name-0 ·|name-1 ·/)
  assert.match((await h.service.handle(turn('/approvals extra'))).reply, /用法/)
  assert.match(h.service.help, /\/approvals/)
  assert.throws(() => h.service.registerCommand('approvals', () => ''), /已注册/)
  // Reject remains usable while QQ request intake is disabled.
  assert.match((await h.service.handle(turn(`/reject ${row.id} confirm`))).reply, /已拒绝/)
})

test('admin approvals: replay failures are terminal; access, deny-list, enable and changed validation are rechecked', async (t) => {
  for (const mode of ['failure', 'throw', 'disabled', 'denied', 'access', 'validation', 'arbitrary']) {
    let originAllowed = true
    const h = approvalCommands(t, mode === 'access' ? { access: { isOwner: (cfg, id) => id === '10001', canSend: (chat) => ({ allowed: chat.chatType === 'private' || originAllowed }) } } : mode === 'failure' || mode === 'throw' ? { qqActions: { async setGroupName() { if (mode === 'throw') throw new Error('raw-secret'); return { ok: false, error: 'DENIED' } } } } : {})
    await h.service.handle(turn('/groupname original', approvalGroup))
    const row = h.approvals.list()[0]
    if (mode === 'disabled') h.setConfig({ ...h.getConfig(), cognition: { qqAdmin: { enabled: false } } })
    if (mode === 'denied') h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition, permissions: { deniedCommands: ['groupname'] } } })
    if (mode === 'validation') h.setConfig({ ...h.getConfig(), cognition: { qqAdmin: { enabled: true, maxText: 1 } } })
    if (mode === 'arbitrary') h.store.put('qq_admin_approval', row.id, { ...row, action: 'say' })
    if (mode === 'access') originAllowed = false
    const result = await h.service.handle(turn(`/approve ${row.id} confirm`))
    assert.match(result.reply, /执行失败/)
    assert.doesNotMatch(result.reply, /raw-secret/)
    assert.equal(h.approvals.get(row.id).status, 'failed', mode)
    assert.equal(h.calls.length, 0, mode)
    await h.service.handle(turn(`/approve ${row.id} confirm`))
    assert.equal(h.calls.length, 0)
  }
})

test('admin approvals: file is replayed through media once; send exceptions mark failed', async (t) => {
  for (const fail of [false, 'throw', 'retcode', 'status']) {
    const calls = []
    const h = approvalCommands(t, { media: { async sendMedia(payload) { calls.push(payload); if (fail === 'throw') throw new Error('raw-file-secret'); return fail === 'retcode' ? { retcode: 100 } : fail === 'status' ? { status: 'failed' } : {} } } })
    await h.service.handle(turn('/file files/a.txt'))
    const row = h.approvals.list()[0]
    assert.equal(calls.length, 0)
    const result = await h.service.handle(turn(`/approve ${row.id} confirm`))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].relativePath, 'files/a.txt')
    assert.equal(h.approvals.get(row.id).status, fail ? 'failed' : 'executed')
    assert.doesNotMatch(result.reply, /raw-file-secret/)
  }
})

test('admin approvals: request/origin access checks and missing approval service fail closed', async (t) => {
  const blocked = approvalCommands(t, { allowSend: false })
  for (const command of ['/approvals', '/approve apr_' + 'a'.repeat(32) + ' confirm', '/kick 10002 confirm']) assert.equal((await blocked.service.handle(turn(command, approvalGroup))).error, 'ACCESS_DENIED')
  assert.equal(blocked.approvals.list().length, 0)
  assert.deepEqual(blocked.calls, [])
  const missing = adminCommands({ cognition: { qqAdmin: { enabled: true, requireApproval: true } } })
  assert.match((await missing.service.handle(turn('/groupname 群', approvalGroup))).reply, /审批服务不可用/)
  assert.equal(missing.calls.length, 0)
})


function purposeCommands({ result = { ok: true, json: { steps: ['列出材料', '练习揉面'] } }, goal = {}, llm: llmOverride, ...options } = {}) {
  const store = createStore()
  const purpose = createPurposeService({ store, getConfig: () => ({}), clock: { now: () => 1700000000000 } })
  const item = purpose.create({ title: '学会做面包', description: '练习一次基础面包制作', steps: [{ id: 'first', text: '旧步骤', done: true }], ...goal })
  const calls = [], modelCalls = [], actions = []
  const tracked = { ...purpose,
    list(args) { calls.push(['list', args]); return purpose.list(args) },
    update(id, patch) { calls.push(['update', id, structuredClone(patch)]); return purpose.update(id, patch) },
  }
  const llm = llmOverride === undefined ? { async completeJson(...args) { modelCalls.push(args); return typeof result === 'function' ? result(purpose, item) : result } } : llmOverride
  const actionSpy = new Proxy({}, { get: (_target, key) => () => { actions.push(key); throw new Error('action must never execute') } })
  const h = harness({}, { purpose: tracked, llm, qqActions: actionSpy, media: actionSpy, runtime: actionSpy, approvals: actionSpy, ...options })
  return { ...h, purpose, item, calls, modelCalls, actions, close: () => store.close() }
}

test('purpose planning: explicit invocation saves sanitized steps only and replies in current chat', async () => {
  const h = purposeCommands({ result: { ok: true, json: { steps: ['  列出\u0000材料  ', '练习\u0085揉面'], progress: 1, status: 'done', action: 'send' } } })
  try {
    const before = structuredClone(h.purpose.get(h.item.id))
    assert.deepEqual(h.modelCalls, [])
    const reply = await h.service.handle(turn(`/purpose plan ${h.item.id}`))
    assert.match(reply.reply, /已保存计划.*2 步/)
    assert.match(reply.reply, /仅保存，不执行/)
    const after = h.purpose.get(h.item.id)
    assert.deepEqual(after.steps, [{ id: 's1', text: '列出材料', done: false }, { id: 's2', text: '练习揉面', done: false }])
    assert.equal(after.progress, 0)
    assert.equal(after.title, before.title)
    assert.equal(after.status, 'active')
    assert.equal(h.modelCalls.length, 1)
    const [spec, prompt] = h.modelCalls[0]
    assert.equal(spec.purpose, 'planning')
    assert.deepEqual(JSON.parse(prompt.user), { title: before.title, description: before.description })
    assert.match(prompt.system, /不要编造事实/)
    assert.match(prompt.system, /不要对外发送消息/)
    assert.match(prompt.system, /1–8.*200/)
    assert.deepEqual(h.calls.filter(([method]) => method === 'update'), [['update', h.item.id, { steps: ['列出材料', '练习揉面'] }]])
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0].chatId, '10001')
    assert.equal(h.sent[0].source, 'command')
    assert.deepEqual(h.actions, [])
    assert.deepEqual(h.configWrites, [])
  } finally { h.close() }
})

test('purpose planning: invalid JSON, schema, lengths and duplicate steps never update', async () => {
  const invalid = [null, { ok: false, error: 'LLM_BAD_JSON', text: 'private diagnostic' },
    { ok: true, json: 'not JSON' }, { ok: true, json: {} },
    ...[[], [''], [' \u0000 '], ['a', ' a\u0001'], [null], [123], [{ text: 'a' }], ['a'.repeat(201)], Array.from({ length: 9 }, (_, i) => String(i))].map(steps => ({ ok: true, json: { steps } }))]
  for (const result of invalid) {
    const h = purposeCommands({ result })
    try {
      const before = h.purpose.get(h.item.id)
      const reply = await h.service.handle(turn(`/purpose plan ${h.item.id}`))
      assert.match(reply.reply, /模型结果无效/)
      assert.doesNotMatch(reply.reply, /private diagnostic/)
      assert.deepEqual(h.purpose.get(h.item.id), before)
      assert.equal(h.calls.some(([method]) => method === 'update'), false)
      assert.deepEqual(h.actions, [])
    } finally { h.close() }
  }
})

test('purpose planning: one/eight steps and 200-character boundary are accepted', async () => {
  for (const steps of [['a'.repeat(200)], Array.from({ length: 8 }, (_, i) => `步骤${i}`)]) {
    const h = purposeCommands({ result: { ok: true, json: { steps } } })
    try {
      assert.match((await h.service.handle(turn(`/purpose plan ${h.item.id}`))).reply, /已保存计划/)
      assert.deepEqual(h.purpose.get(h.item.id).steps.map(step => step.text), steps)
    } finally { h.close() }
  }
})

test('purpose planning: requires a unique active goal with title and description before LLM', async () => {
  for (const goal of [{ status: 'paused' }, { status: 'done' }, { status: 'abandoned' }, { type: 'plan' }, { type: 'intent' }, { title: '\u0000' }, { description: ' ' }]) {
    const h = purposeCommands()
    try {
      h.purpose.update(h.item.id, goal)
      assert.match((await h.service.handle(turn(`/purpose plan ${h.item.id}`))).reply, /活跃目标|标题和描述/)
      assert.deepEqual(h.modelCalls, [])
      assert.deepEqual(h.calls.filter(([method]) => method === 'update'), [])
    } finally { h.close() }
  }
  for (const command of ['/purpose plan missing', '/purpose step missing 1', '/purpose steps missing']) {
    const h = purposeCommands()
    try {
      assert.match((await h.service.handle(turn(command))).reply, /没有找到唯一/)
      assert.deepEqual(h.modelCalls, [])
      assert.equal(h.calls.some(([method]) => method === 'update'), false)
    } finally { h.close() }
  }
  const h = harness({}, { purpose: { list: () => [{ id: 'goal_abc1' }, { id: 'goal_abc2' }], update: () => assert.fail('ambiguous goal update') }, llm: { completeJson: () => assert.fail('ambiguous goal LLM') } })
  assert.match((await h.service.handle(turn('/purpose plan abc'))).reply, /没有找到唯一/)
})

test('purpose planning: missing services and thrown failures return static safe errors', async () => {
  for (const llm of [null, {}]) {
    const h = purposeCommands({ llm })
    try {
      assert.match((await h.service.handle(turn(`/purpose plan ${h.item.id}`))).reply, /缺少 JSON 模型服务/)
      assert.deepEqual(h.calls, [])
    } finally { h.close() }
  }
  assert.match((await harness({}, { purpose: null }).service.handle(turn('/purpose plan abc'))).reply, /目的服务不可用/)
  for (const services of [
    { purpose: { list() { throw new Error('secret list') } }, llm: { completeJson() {} } },
    { purpose: { list: () => [{ id: 'goal_abc', title: 't', description: 'd', type: 'goal', status: 'active' }] }, llm: { completeJson() { throw new Error('secret model') } } },
    { purpose: { list: () => [{ id: 'goal_abc', title: 't', description: 'd', type: 'goal', status: 'active' }], update() { throw new Error('secret update') } }, llm: { completeJson: async () => ({ ok: true, json: { steps: ['a'] } }) } },
  ]) {
    const reply = await harness({}, services).service.handle(turn('/purpose plan abc'))
    assert.equal(reply.reply, '目的操作失败，请稍后重试。')
  }
})

test('purpose planning: changed/deleted goals during model wait cannot be overwritten', async () => {
  for (const change of [(p, item) => p.pause(item.id), (p, item) => p.remove(item.id), (p, item) => p.update(item.id, { steps: ['主人新步骤'] }), (p, item) => p.update(item.id, { description: '新描述' })]) {
    const h = purposeCommands({ result(p, item) { change(p, item); return { ok: true, json: { steps: ['模型步骤'] } } } })
    try {
      assert.match((await h.service.handle(turn(`/purpose plan ${h.item.id}`))).reply, /目的已变化/)
      assert.equal(h.calls.some(([method]) => method === 'update'), false)
    } finally { h.close() }
  }
})

test('purpose steps: done/undo changes only selected flag, reports progress and never executes actions', async () => {
  const h = purposeCommands({ goal: { steps: [{ id: 'a', text: '/say hi', done: false }, { id: 'b', text: '第二步', done: false }] } })
  try {
    const original = structuredClone(h.purpose.get(h.item.id).steps)
    assert.match((await h.service.handle(turn(`/purpose step ${h.item.id} 1`))).reply, /进度 50%/)
    assert.deepEqual(h.purpose.get(h.item.id).steps, [{ ...original[0], done: true }, original[1]])
    assert.deepEqual(original[0].done, false)
    assert.match((await h.service.handle(turn(`/purpose steps ${h.item.id}`))).reply, /1\. \[x\] \/say hi/)
    assert.match((await h.service.handle(turn(`/purpose step ${h.item.id} 2 done`))).reply, /100%/)
    assert.equal(h.purpose.get(h.item.id).status, 'done')
    assert.match((await h.service.handle(turn(`/purpose step ${h.item.id} 1 undo`))).reply, /取消完成；进度 50%/)
    assert.equal(h.purpose.get(h.item.id).status, 'done') // Existing service behavior; resume remains explicit.
    assert.deepEqual(h.purpose.get(h.item.id).steps, [original[0], { ...original[1], done: true }])
    assert.deepEqual(h.modelCalls, [])
    assert.deepEqual(h.actions, [])
    assert.equal(h.sent.length, 4)
    assert.ok(h.sent.every(payload => payload.chatId === '10001' && payload.source === 'command'))
    for (const [, , patch] of h.calls.filter(([method]) => method === 'update')) assert.deepEqual(Object.keys(patch), ['steps'])
  } finally { h.close() }
})

test('purpose steps: empty steps, missing step and 20-step boundary', async () => {
  const h = purposeCommands({ goal: { steps: [] } })
  try {
    for (const sub of ['step', 'steps']) assert.match((await h.service.handle(turn(`/purpose ${sub} ${h.item.id}${sub === 'step' ? ' 1' : ''}`))).reply, /还没有步骤/)
    h.purpose.update(h.item.id, { steps: ['one'] })
    assert.match((await h.service.handle(turn(`/purpose step ${h.item.id} 2`))).reply, /超出范围/)
    assert.equal(h.calls.some(([method]) => method === 'update'), false)
    h.purpose.update(h.item.id, { steps: Array.from({ length: 20 }, (_, i) => `step ${i + 1}`) })
    assert.match((await h.service.handle(turn(`/purpose step ${h.item.id} 20`))).reply, /进度 5%/)
    assert.equal(h.purpose.get(h.item.id).steps[19].done, true)
    assert.deepEqual(h.modelCalls, [])
  } finally { h.close() }
})

test('purpose commands: malformed arguments make no purpose/model/action calls', async () => {
  const h = purposeCommands()
  try {
    for (const args of ['plan', 'plan abc extra', 'plan ../abc', 'plan abc\u0000', 'steps', 'steps abc extra', 'step', 'step abc', 'step abc 0', 'step abc 21', 'step abc -1', 'step abc 1.5', 'step abc 01', 'step abc 1e0', 'step abc 1 DONE', 'step abc 1 nope', 'step abc 1 done extra']) {
      assert.match((await h.service.handle(turn('/purpose ' + args))).reply, /用法/)
    }
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.modelCalls, [])
    assert.deepEqual(h.actions, [])
  } finally { h.close() }
})

test('purpose commands: owner, access and deny-list gates prevent calls; no implicit LLM', async () => {
  for (const options of [{}, { allowSend: false }]) {
    const h = purposeCommands(options)
    try {
      for (const command of [`/purpose plan ${h.item.id}`, `/purpose step ${h.item.id} 1`, `/purpose steps ${h.item.id}`]) {
        const reply = await h.service.handle(turn(command, options.allowSend === false ? {} : { senderId: '10002' }))
        assert.equal(reply.reply, '')
      }
      assert.deepEqual(h.calls, [])
      assert.deepEqual(h.modelCalls, [])
      assert.deepEqual(h.sent, [])
      assert.deepEqual(h.actions, [])
    } finally { h.close() }
  }
  const h = purposeCommands()
  try {
    await h.service.handle(turn('/purpose'))
    await h.service.handle(turn('/purpose add 新目标'))
    assert.deepEqual(h.modelCalls, [])
    h.setConfig({ ...h.getConfig(), cognition: { permissions: { deniedCommands: ['purpose'] } } })
    h.calls.length = 0
    for (const sub of ['plan', 'step', 'steps']) assert.match((await h.service.handle(turn(`/purpose ${sub} ${h.item.id}${sub === 'step' ? ' 1' : ''}`))).reply, /禁用/)
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.modelCalls, [])
  } finally { h.close() }
})


test('purpose commands: owner group reply stays in current chat; no outbound dependency is required', async () => {
  const h = purposeCommands()
  try {
    await h.service.handle(turn(`/purpose plan ${h.item.id}`, { chatType: 'group', chatId: '20001' }))
    assert.equal(h.sent.length, 1)
    assert.equal(h.sent[0].chatType, 'group')
    assert.equal(h.sent[0].chatId, '20001')
    assert.deepEqual(h.actions, [])
    const offline = createCommandService({ getConfig: h.getConfig, purpose: h.purpose, access: { canSend: () => ({ allowed: true }) } })
    assert.match((await offline.handle(turn(`/purpose step ${h.item.id} 1`))).reply, /进度 50%/)
    assert.match((await offline.handle(turn(`/purpose steps ${h.item.id}`))).reply, /进度 50%/)
    assert.equal(h.sent.length, 1)
  } finally { h.close() }
})

test('identity commands: owner lists, links, relinks and unlinks without person/config mutation', async (t) => {
  let now = 1700000000000
  const store = createStore({ clock: { now: () => now } })
  t.after(() => store.close())
  store.put('person', 'person_existing', { displayName: 'Alice', status: 'active' })
  const before = store.list('person')
  const identities = createIdentityService({ store, clock: { now: () => now } })
  const h = harness({}, { identities })
  assert.match((await h.service.handle(turn('/identity'))).reply, /暂无/)
  assert.match((await h.service.handle(turn('/identity link qq 123 person_existing Alice QQ'))).reply, /已保存/)
  const first = identities.resolve({ platform: 'qq', externalId: '123' })
  assert.equal(first.label, 'Alice QQ')
  assert.match((await h.service.handle(turn('/identity'))).reply, /qq:123 → person_existing · Alice QQ/)
  now += 1000
  assert.match((await h.service.handle(turn('/identity link qq 123 person_other New label', { chatType: 'group', chatId: '20001' }))).reply, /已保存/)
  assert.equal(identities.resolve({ platform: 'qq', externalId: '123' }).id, first.id)
  assert.equal(identities.resolve({ platform: 'qq', externalId: '123' }).personId, 'person_other')
  assert.match((await h.service.handle(turn('/identity unlink qq 123'))).reply, /已移除/)
  assert.match((await h.service.handle(turn('/identity unlink qq 123'))).reply, /没有找到/)
  assert.equal(identities.counts().total, 0)
  assert.deepEqual(store.list('person'), before)
  assert.equal(store.count('identity'), 0)
  assert.equal(h.configWrites.length, 0)
  assert.equal(h.memory.remembered.length, 0)
})

test('identity commands: operator and stranger stay silent in private/group before any service call', async () => {
  const identities = new Proxy({}, { get() { assert.fail('Unauthorized service access') } })
  const access = normalizeAccess({ ownerQQ: '10001', operators: ['10002'], mode: 'allowlist', groups: ['20001'] })
  const h = harness({ access }, { identities })
  for (const senderId of ['10002', '10003']) {
    for (const chatType of ['private', 'group']) {
      for (const text of ['/identity', '/identity link qq 123 person_a label', '/identity unlink qq 123', '/identity invalid']) {
        assert.deepEqual(await h.service.handle(turn(text, { chatType, chatId: chatType === 'group' ? '20001' : senderId, senderId })), { handled: true, reply: '' })
      }
    }
  }
  assert.equal(h.sent.length, 0)
  assert.equal(h.configWrites.length, 0)
  assert.match((await h.service.handle(turn('/help'))).reply, /\/identity link/)
  assert.doesNotMatch((await h.service.handle(turn('/help', { senderId: '10002' }))).reply, /\/identity/)
  assert.throws(() => h.service.registerCommand('identity', () => 'override', { ownerOnly: false }), /已注册/)
})

test('identity commands: command deny-list and outbound access gate precede service operations', async () => {
  const identities = new Proxy({}, { get() { assert.fail('Blocked service access') } })
  const denied = harness({ cognition: { permissions: { deniedCommands: ['identity'] } } }, { identities })
  const inaccessible = harness({}, { identities, allowSend: false })
  for (const text of ['/IDENTITY', '/identity link qq 123 p', '/identity unlink qq 123']) {
    assert.match((await denied.service.handle(turn(text))).reply, /已被操作员禁用/)
    assert.deepEqual(await inaccessible.service.handle(turn(text)), { handled: true, reply: '', error: 'ACCESS_DENIED' })
  }
  assert.equal(inaccessible.sent.length, 0)
})

test('identity commands: list is newest first and limited to 20', async (t) => {
  let now = 1700000000000
  const store = createStore({ clock: { now: () => now } })
  t.after(() => store.close())
  const identities = createIdentityService({ store, clock: { now: () => now } })
  for (let i = 0; i < 25; i += 1) {
    now += 1000
    identities.link({ platform: 'discord', externalId: String(i), personId: 'p', label: 'label' })
  }
  const h = harness({}, { identities })
  const reply = (await h.service.handle(turn('/identity'))).reply
  assert.equal(reply.split('\n').length, 21)
  assert.equal(reply.split('\n')[1], 'discord:24 → p · label')
  assert.equal(reply.split('\n').at(-1), 'discord:5 → p · label')
})

test('identity commands: malformed syntax, invalid fields and secrets are rejected without writes', async (t) => {
  const store = createStore()
  t.after(() => store.close())
  const identities = createIdentityService({ store })
  const h = harness({}, { identities })
  for (const args of ['extra', 'link', 'link qq a', 'link qq a p label\nsecond', 'unlink qq', 'unlink qq a extra']) {
    assert.match((await h.service.handle(turn('/identity ' + args))).reply, /用法/)
  }
  const secret = 'sk-' + 'a'.repeat(24)
  for (const args of ['link unknown a p', 'link qq a/b p', 'link qq a p.p', 'link qq a p ' + '星'.repeat(81), 'link qq a p bad\u202elabel', 'link qq ' + secret + ' p', 'link qq a ' + secret, 'link qq a p ' + secret, 'unlink unknown a']) {
    const reply = (await h.service.handle(turn('/identity ' + args))).reply
    assert.match(reply, /参数无效|用法/)
    assert.ok(!reply.includes(secret))
  }
  assert.equal(identities.counts().total, 0)
  assert.equal(store.info().stats.puts, 0)
  assert.equal(h.configWrites.length, 0)
})

test('identity commands: missing service, full registry and storage errors give fixed safe replies', async () => {
  assert.match((await harness().service.handle(turn('/identity'))).reply, /服务不可用/)
  const secret = 'STORE_FAILED private-content sk-' + 'a'.repeat(24)
  for (const text of ['/identity', '/identity link qq 123 p label', '/identity unlink qq 123']) {
    const identities = Object.fromEntries(['list', 'link', 'unlink'].map((method) => [method, () => { throw new Error(secret) }]))
    const h = harness({}, { identities })
    const reply = (await h.service.handle(turn(text))).reply
    assert.equal(reply, '身份链接操作失败，请稍后重试。')
    assert.ok(!JSON.stringify(h.sent).includes(secret))
  }
  const full = harness({}, { identities: { link() { throw new Error('IDENTITY_FULL') } } })
  assert.match((await full.service.handle(turn('/identity link qq 123 p'))).reply, /最多 5000/)
})


test('commands：注入 delivery 后普通回复与 /say 均只交付一次，拒绝不回退', async () => {
  const calls = []
  let reject = false
  const delivery = { async deliver(intent) { calls.push(intent); return reject ? { ok: false, error: 'RATE_LIMITED' } : { ok: true, messageId: 'd1' } } }
  const h = harness({}, { delivery })
  const help = await h.service.handle(turn('/help'))
  assert.match(help.reply, /\/status/)
  assert.deepEqual(await h.service.handle(turn('/say hello')), { handled: true, reply: '', error: '' })
  assert.equal(calls.length, 2)
  assert.equal(calls[0].source, 'command')
  assert.equal(calls[1].segments[0].data.text, 'hello')
  reject = true
  for (const command of ['/help', '/say blocked']) {
    assert.deepEqual(await h.service.handle(turn(command)), { handled: true, reply: '', error: 'RATE_LIMITED' })
  }
  assert.equal(h.sent.length, 0)
  const denied = harness({}, { delivery, allowSend: false })
  assert.equal((await denied.service.handle(turn('/say no'))).error, 'ACCESS_DENIED')
  assert.equal(calls.length, 4)
})
