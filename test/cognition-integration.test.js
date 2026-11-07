// 认知端到端集成测试：轮次聚合→人物/情绪/关系/记忆→策略→发送；撤回与隐私。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAccess } from '../src/core/access.js'
import { normalizeConfig } from '../src/core/config.js'
import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { setup as setupReplyDelivery } from '../src/modules/builtin/reply-delivery.js'
import { createCognition } from '../src/cognition/index.js'
import { createFakeScheduler, createClock, createRng } from '../src/cognition/util.js'

function fakeLlm(capture = null, composeText = '测试回复：我在听。') {
  return {
    async *stream(options) {
      const system = options.system || options.messages?.find((message) => message.role === 'system')?.content?.[0]?.text || ''
      if (Array.isArray(capture)) capture.push(`${system}\n${JSON.stringify(options.messages || [])}`)
      const text = system.includes('认知分析器')
        ? JSON.stringify({ intent: 'chat', confidence: 0.8, novelty: 0.2, risk: 0, serious: false, appraisal: { desirability: 0.3, relevance: 0.7, intensity: 0.5, novelty: 0.2, control: 0.5, agency: 'other', norm: 0 }, unknownCandidates: [], replyGoal: '自然回应', rationale: 'test' })
        : composeText
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
    async listProviders() { return [{ id: 'fake' }] },
    async listModels() { return [{ id: 'fake' }] },
  }
}

function makeCog({ dir, gateway, scheduler, configOverride = {}, llm = fakeLlm(), media = null, logger = null, access = undefined }) {
  const cfg = normalizeConfig({
    access,
    cognition: {
      enabled: true,
      dryRun: false,
      turn: { privateBaseMs: 300, privateMaxMs: 1200, groupMaxMs: 1200, fastPathMs: 80, shortMsgMs: 0, incompleteFactorMs: 200, habitAdjMaxMs: 0 },
      llm: { mode: 'auto', dailyTokenBudget: 100000 },
      ...configOverride,
    },
  }).config
  const ctx = {
    get(key) {
      if (key === 'llm') return llm
      if (key === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'fake', model: 'fake' }) }
      return undefined
    },
    emit() {},
  }
  const deliveryRegistry = createDeliveryRegistry()
  if (configOverride.delivery?.engine === 'planner') setupReplyDelivery({ delivery: { registerPlanner: deliveryRegistry.register } })
  return createCognition({ deliveryRegistry, ctx, getConfig: () => cfg, gateway, scheduler, clock: createClock(), rng: createRng(1), dataRoot: dir, media, logger })
}

function privateEvent(id, text, userId = '10001') {
  return {
    seq: id, kind: 'message', selfId: '999', time: Math.floor(Date.now() / 1000),
    message: { id, chatType: 'private', chatId: userId, sender: { userId, nickname: '小明' }, text, segments: [{ type: 'text', data: { text } }], mentions: [], images: [], replyId: '' },
  }
}

function groupEvent(id, text, { chatId = 'g1', mentions = [], senderId = '10001' } = {}) {
  return {
    seq: id, kind: 'message', selfId: '999', time: Math.floor(Date.now() / 1000),
    message: { id, chatType: 'group', chatId, sender: { userId: senderId, nickname: 'A' }, text, segments: [{ type: 'text', data: { text } }], mentions, images: [], replyId: '' },
  }
}

function groupTurnConfig(extra = {}) {
  return {
    privateBaseMs: 300,
    privateMaxMs: 1200,
    groupMaxMs: 1200,
    fastPathMs: 80,
    shortMsgMs: 0,
    incompleteFactorMs: 200,
    habitAdjMaxMs: 0,
    groupReplyMode: 'addressed',
    groupCooldownMs: 0,
    groupMaxRepliesPerMinute: 60,
    ...extra,
  }
}

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

test('M7-q: typing is opt-in, private-only and best effort without ID/error logging', async (t) => {
  for (const scenario of [
    { name: 'default off' },
    { name: 'explicitly disabled', enabled: false },
    { name: 'non-boolean stays off', enabled: 'true' },
    { name: 'enabled private', enabled: true, typing: true },
    { name: 'group never types', enabled: true, chatType: 'group' },
    { name: 'missing gateway action', enabled: true, missing: true },
    { name: 'gateway rejects both status calls', enabled: true, typing: true, failure: 'async' },
    { name: 'gateway throws synchronously', enabled: true, typing: true, failure: 'sync' },
    { name: 'command early return clears typing', enabled: true, typing: true, command: true },
  ]) await t.test(scenario.name, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-typing-'))
    const chatId = 1000199876543
    const calls = [], order = [], sent = [], logs = []
    const logger = Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (...args) => logs.push(args)]))
    logger.child = () => logger
    const statusError = new Error(`status failed for ${chatId}`)
    const actions = {
      sendMessage: async (payload) => { order.push('send'); sent.push(payload); return { message_id: 71 } },
      setInputStatus(userId, eventType) {
        calls.push([userId, eventType])
        order.push(eventType)
        if (scenario.failure === 'sync') throw statusError
        if (scenario.failure === 'async') return Promise.reject(statusError)
        return Promise.resolve({})
      },
    }
    if (scenario.missing) delete actions.setInputStatus
    const cog = makeCog({ dir, scheduler: createFakeScheduler(), gateway: { actions }, logger, access: { ownerQQ: '10001' },
      configOverride: scenario.enabled === undefined ? {} : { typing: { enabled: scenario.enabled } },
    })
    try {
      assert.equal(await cog.ready, true)
      const result = await cog.services.pipeline.handleTurn({
        id: 'typing-turn', chatType: scenario.chatType || 'private', chatId, senderId: '10001', selfId: '999',
        text: scenario.command ? '/status' : '你好', addressed: true, messages: [], messageIds: [],
      })
      assert.equal(result.ok, true)
      if (scenario.command) {
        assert.equal(result.command, true)
        assert.ok(result.reply)
      } else {
        assert.equal(result.reply, '测试回复：我在听。')
        assert.equal(sent.length, 1)
      }
      assert.deepEqual(calls, scenario.typing ? [[String(chatId), 1], [String(chatId), 2]] : [])
      if (scenario.typing) {
        assert.equal(order[0], 1)
        assert.equal(order.at(-1), 2)
      }
      assert.ok(!JSON.stringify(logs).includes(String(chatId)), 'typing failures must not leak chatId into logs')
      assert.ok(!JSON.stringify(logs).includes(statusError.message), 'raw gateway error stays out of logs')
      assert.ok(!JSON.stringify(result).includes(statusError.message), 'typing failures must not change the result')
    } finally { cog.dispose(); rmSync(dir, { recursive: true, force: true }) }
  })
})

test('M7-q: finally awaits paused status on processing failure and preserves original error', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-typing-finally-'))
  const calls = []
  const cog = makeCog({ dir, scheduler: createFakeScheduler(), configOverride: { typing: { enabled: true } },
    gateway: { actions: { async setInputStatus(userId, eventType) {
      await new Promise((resolve) => setImmediate(resolve))
      calls.push([userId, eventType])
      if (eventType === 2) throw new Error('paused status failed')
    } } },
  })
  try {
    assert.equal(await cog.ready, true)
    const original = new Error('retrieval failed')
    t.mock.method(cog.services.memory, 'retrieveAsync', async () => {
      assert.deepEqual(calls, [['10001', 1]], 'typing status is awaited before processing')
      throw original
    })
    await assert.rejects(() => cog.services.pipeline.handleTurn({
      id: 'typing-failure', chatType: 'private', chatId: '10001', senderId: '10001', selfId: '999',
      text: '你好', addressed: true, messages: [], messageIds: [],
    }), (error) => error === original)
    assert.deepEqual(calls, [['10001', 1], ['10001', 2]], 'paused status is awaited even after processing fails')
  } finally { cog.dispose(); rmSync(dir, { recursive: true, force: true }) }
})

test('集成：连发碎片聚合只形成一次决策/发送，并持久化人物/关系/记忆', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-it-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 4242 } } } }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    cog.observe(privateEvent(1, '我想问'), { accepted: true })
    cog.observe(privateEvent(2, '你一个问题。'), { accepted: true })
    scheduler.advance(1500)
    await flush(40)
    assert.equal(sent.length, 1, 'burst 只发送一次')
    assert.ok(sent[0].message.some((segment) => segment.type === 'text' && segment.data.text.length > 0))
    assert.equal(cog.services.person.listPersons({}).length, 1)
    assert.ok(cog.services.relationships.list().length >= 1, '关系至少包含全局/私聊作用域')
    assert.ok(cog.services.relationships.list().some((item) => item.scopeType === 'private'))
    assert.ok(cog.services.memory.stats().total >= 1)
    assert.equal(cog.services.policy.history({ limit: 5 })[0].status, 'sent')
    const before = sent.length
    scheduler.advance(30000)
    await flush()
    assert.equal(sent.length, before, '不会为同一 turn 重复发送')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：群聊默认只回应点名；机器人自己的消息不触发回复', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-group-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 77 } } } }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    cog.observe({
      seq: 1, kind: 'message', selfId: '999', time: 1,
      message: { id: 1, chatType: 'group', chatId: 'g1', sender: { userId: '10001', nickname: 'A' }, text: '大家好。', segments: [{ type: 'text', data: { text: '大家好。' } }], mentions: [], images: [], replyId: '' },
    }, { accepted: true })
    scheduler.advance(4000)
    await flush(40)
    assert.equal(sent.length, 0, '群聊未点名默认不回复')
    assert.equal(cog.services.policy.history({ limit: 5 }).length, 0, '不产生回复决策')

    // 机器人自己的消息（sender == selfId）必须跳过，避免回复循环。
    cog.observe({
      seq: 2, kind: 'message', selfId: '999', time: 2,
      message: { id: 2, chatType: 'private', chatId: '10001', sender: { userId: '999', nickname: '机器人' }, text: '我自己发的。', segments: [{ type: 'text', data: { text: '我自己发的。' } }], mentions: [], images: [], replyId: '' },
    }, { accepted: true })
    scheduler.advance(4000)
    await flush(40)
    assert.equal(sent.length, 0, '自己的消息不应触发认知回复')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：私聊记忆不会在群聊检索中出现；遗忘≠删除', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-privacy-'))
  const scheduler = createFakeScheduler()
  const cog = makeCog({ dir, gateway: { actions: { sendMessage: async () => ({ message_id: 1 }) } }, scheduler })
  try {
    const person = cog.services.person.ensurePerson({ platformUserId: '10001', nickname: '小明' })
    const mem = cog.services.memory.encodeTurn({ id: 't1', chatType: 'private', chatId: '10001', text: '我的秘密是喜欢猫', messages: [], messageIds: [] }, { personId: person.person.id, scope: { scopeType: 'private', scopeId: '10001' } })
    assert.ok(mem)
    const group = cog.services.memory.retrieve({ query: '秘密 猫', scope: { scopeType: 'group', scopeId: 'g1' } })
    assert.equal(group.length, 0, '群聊不能检索私聊记忆')
    const own = cog.services.memory.retrieve({ query: '秘密 猫', scope: { scopeType: 'private', scopeId: '10001' } })
    assert.ok(own.length >= 1)
    cog.services.memory.forget(mem.id)
    assert.equal(cog.services.memory.get(mem.id).memory.status, 'inactive')
    assert.ok(cog.services.memory.list({ query: '猫' }).length === 0)
    cog.services.memory.activate(mem.id)
    assert.equal(cog.services.memory.get(mem.id).memory.status, 'active')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：群聊 all 模式未点名会分析并产生决策；诊断保留 lastTurn', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-group-all-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 78 } } } }
  const cog = makeCog({ dir, gateway, scheduler, configOverride: { turn: groupTurnConfig({ groupReplyMode: 'all' }) } })
  try {
    cog.observe(groupEvent(1, '大家好。'), { accepted: true })
    scheduler.advance(4000)
    await flush(60)
    const overview = await cog.overview()
    assert.equal(overview.pipeline.groupMode, 'all')
    assert.equal(overview.pipeline.lastTurn.chatType, 'group')
    assert.equal(overview.pipeline.lastTurn.addressed, false)
    assert.ok(overview.pipeline.decisions >= 1, '未点名也应进入决策')
    assert.equal(overview.pipeline.groupSkipped, 0)
    assert.ok(sent.length >= 1, '策略选择回复时应发送')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：群聊 probability=0 跳过并记录原因；人设名可充当唤醒词', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-group-prob-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 79 } } } }
  const cog = makeCog({
    dir, gateway, scheduler,
    configOverride: { turn: groupTurnConfig({ groupReplyMode: 'probability', groupReplyProbability: 0 }) },
  })
  try {
    cog.observe(groupEvent(1, '没人叫我。'), { accepted: true })
    scheduler.advance(4000)
    await flush(50)
    const skipped = await cog.overview()
    assert.equal(skipped.pipeline.groupSkipped, 1)
    assert.equal(skipped.pipeline.groupSkippedByReason.probability_miss, 1)
    assert.equal(skipped.pipeline.lastTurn.reason, 'probability_miss')
    assert.equal(sent.length, 0)

    cog.services.persona.edit({ profile: { displayName: '小Q' } })
    cog.observe(groupEvent(2, '小Q你在吗？'), { accepted: true })
    scheduler.advance(4000)
    await flush(60)
    const after = await cog.overview()
    assert.ok(after.pipeline.decisions >= 1, '名字唤醒后应进入决策')
    assert.ok(sent.length >= 1, '名字唤醒后策略回复应发送')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：群聊冷却跳过后不产生第二个决策，仍写入记忆', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-group-cool-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 80 } } } }
  const cog = makeCog({
    dir, gateway, scheduler,
    configOverride: { turn: groupTurnConfig({ groupReplyMode: 'all', groupCooldownMs: 60000 }) },
  })
  try {
    cog.observe(groupEvent(1, '第一句。'), { accepted: true })
    scheduler.advance(4000)
    await flush(60)
    const firstSent = sent.length
    cog.observe(groupEvent(2, '第二句。'), { accepted: true })
    scheduler.advance(4000)
    await flush(40)
    const overview = await cog.overview()
    assert.ok(firstSent >= 1)
    assert.equal(sent.length, firstSent, '冷却期内不发送')
    assert.ok(overview.pipeline.groupSkipped >= 1)
    assert.equal(overview.pipeline.lastTurn.reason, 'cooldown')
    assert.ok(cog.services.memory.stats().total >= 2, '跳过时仍写入情景记忆')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
test('集成：群聊可选词法相关度门控，边界、旁路与失败放行', async (t) => {
  const hit = (relevance, summary = 'unrelated') => ({ memory: { id: 'prior', summary }, signals: { relevance }, score: 1 })
  const broken = hit(0)
  Object.defineProperty(broken.signals, 'relevance', { get() { throw new Error('scoring bug') } })
  const cases = [
    { name: 'default disabled with no memories', relevance: undefined, memories: [], allow: true },
    { name: 'disabled does not inspect relevance', relevance: { enabled: false }, memories: [broken], allow: true },
    { name: 'no memories even at zero threshold', memories: [], minScore: 0 },
    { name: 'low signal ignores high composite/embedding scores', memories: [{ ...hit(0.1, '猫咪 coffee'), signals: { relevance: 0.1, embedding: 1 } }] },
    { name: 'maximum signal exactly at threshold', memories: [hit(0), hit(0.15)], allow: true },
    { name: 'above threshold', memories: [hit(0.8)], allow: true },
    { name: 'addressed bypass without memories', memories: [], addressed: true, allow: true },
    { name: 'private bypass without memories', memories: [], chatType: 'private', allow: true },
    { name: 'summary overlap for Chinese and Latin', memories: [hit(undefined, '猫咪 COFFEE')], allow: true },
    { name: 'missing signal unrelated summary', memories: [hit(undefined)] },
    { name: 'invalid signal falls back to summary', memories: [hit(NaN, '猫咪 coffee')], allow: true },
    { name: 'bounded summary overlap', memories: [hit(undefined, 'x'.repeat(4000) + ' 猫咪 coffee')] },
    { name: 'negative relevance clamped', memories: [hit(-1)], minScore: 0, allow: true },
    { name: 'upper threshold clamped', memories: [hit(0.9)], minScore: 2 },
    { name: 'lower threshold clamped', memories: [hit(0)], minScore: -1, allow: true },
    { name: 'unexpected scoring error allows', memories: [broken], allow: true },
    { name: 'probability miss precedes relevance', memories: [], turn: { groupReplyMode: 'probability', groupReplyProbability: 0 }, reason: 'probability_miss' },
    { name: 'addressed-only precedes relevance', memories: [], turn: { groupReplyMode: 'addressed' }, reason: 'addressed_only' },
  ]
  for (const item of cases) await t.test(item.name, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-relevance-'))
    const capture = [], sent = []
    const relevance = Object.hasOwn(item, 'relevance') ? item.relevance : { enabled: true, minScore: item.minScore ?? 0.15 }
    const cog = makeCog({ dir, scheduler: createFakeScheduler(), llm: fakeLlm(capture),
      gateway: { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 100 } } } },
      configOverride: { turn: groupTurnConfig({ groupReplyMode: 'all', groupRelevance: relevance, ...item.turn }) },
    })
    try {
      cog.services.memory.retrieveAsync = async () => item.memories
      const result = await cog.services.pipeline.handleTurn({ id: 'relevance-turn', text: '猫咪 coffee', chatType: item.chatType || 'group', chatId: 'g1', senderId: '10001', selfId: '999', addressed: Boolean(item.addressed), messages: [], messageIds: [] })
      const stats = cog.services.pipeline.stats()
      if (item.allow) {
        assert.ok(result.decision, 'allowed turn reaches policy')
        assert.ok(capture.length > 0, 'allowed turn reaches analysis LLM')
        assert.equal(stats.groupSkipped, 0)
      } else {
        const reason = item.reason || 'low_relevance'
        assert.equal(result.error, `group_${reason}`)
        assert.equal(result.analysis, null)
        assert.equal(result.decision, null)
        assert.equal(capture.length, 0, 'skip never calls analysis/compose LLM')
        assert.equal(sent.length, 0)
        assert.equal(stats.lastTurn.reason, reason)
        assert.equal(stats.groupSkippedByReason[reason], 1)
      }
      assert.equal(cog.services.memory.list({ query: 'coffee' }).length, 1, 'allowed and skipped turns both encode memory')
    } finally {
      cog.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('集成：群聊相关度复用实际词法检索，既有频率/连续/冷却优先', async (t) => {
  for (const [reason, limits] of [
    ['rate_limited', { groupMaxRepliesPerMinute: 1 }],
    ['consecutive_limit', { maxConsecutiveGroupReplies: 1 }],
    ['cooldown', { groupCooldownMs: 60000 }],
  ]) await t.test(reason, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-relevance-order-'))
    const capture = []
    const cog = makeCog({ dir, scheduler: createFakeScheduler(), llm: fakeLlm(capture),
      gateway: { actions: { sendMessage: async () => ({ message_id: 101 }) } },
      configOverride: { turn: groupTurnConfig({ groupReplyMode: 'all', groupRelevance: { enabled: true }, ...limits }) },
    })
    try {
      const turn = { id: 'first', text: '咖啡 coffee', chatType: 'group', chatId: 'g1', senderId: '10001', selfId: '999', addressed: false, messages: [], messageIds: [] }
      cog.services.memory.encodeTurn({ ...turn, id: 'seed' })
      const first = await cog.services.pipeline.handleTurn(turn)
      assert.ok(first.reply, 'real retrieved lexical relevance allows reply')
      const calls = capture.length
      const second = await cog.services.pipeline.handleTurn({ ...turn, id: 'second', text: 'unrelated topic' })
      assert.equal(second.error, `group_${reason}`)
      assert.equal(capture.length, calls, 'existing limit skips before analysis')
      assert.equal(cog.services.pipeline.stats().groupSkippedByReason.low_relevance, undefined)
      assert.equal(cog.services.memory.list({ query: 'unrelated' }).length, 1)
    } finally {
      cog.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

test('集成：切换 active 人格后，下一轮 compose prompt 使用新 profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-persona-switch-'))
  const scheduler = createFakeScheduler()
  const capture = []
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 81 } } } }
  const cog = makeCog({ dir, gateway, scheduler, llm: fakeLlm(capture) })
  try {
    cog.services.persona.ensure()
    const created = cog.services.persona.create({ name: '切换后人格' })
    cog.services.persona.edit({ profile: { personality: '切换后的性格', speakingStyle: '切换后的风格' } })
    assert.equal(cog.services.persona.get().id, created.persona.id)
    cog.observe(privateEvent(1, '你好'), { accepted: true })
    scheduler.advance(1500)
    await flush(50)
    assert.ok(sent.length >= 1)
    assert.ok(capture.some((system) => system.includes('名字/自称：切换后人格')), 'compose system 应包含当前人格')
    assert.ok(capture.some((system) => system.includes('切换后的性格')))
    assert.ok(capture.some((system) => system.includes('切换后的风格')))
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('集成：撤回在无原文时不假装看见；有原文时 sawContent=true', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-recall-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 9 } } } }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    // 无原始消息：sawContent 必须 false
    cog.observe({ seq: 1, kind: 'notice', selfId: '999', time: 1, notice: { type: 'group_recall', userId: '10001', groupId: 'g1', messageId: 'm1' } }, { accepted: true })
    await flush(50)
    const decision = cog.services.policy.history({ limit: 1 })[0]
    assert.ok(decision, '应形成撤回决策')
    assert.equal(decision.features.recall.sawContent, false)
    assert.ok(['recall_concern', 'recall_probe', 'recall_silence', 'recall_ignore'].includes(decision.action))
    assert.notEqual(decision.action, 'recall_tease', '没看见内容不能调侃')

    // 有原始消息：sawContent=true
    cog.ingestRaw({ post_type: 'message', message_type: 'group', self_id: 999, group_id: 'g1', user_id: 10002, message_id: 88, message: '我刚刚说了什么', sender: { user_id: 10002, nickname: 'A' }, time: 1 })
    cog.observe({ seq: 2, kind: 'notice', selfId: '999', time: 2, notice: { type: 'group_recall', userId: '10002', groupId: 'g1', messageId: '88' } }, { accepted: true })
    await flush(50)
    const latest = cog.services.policy.history({ limit: 3 }).find((item) => item.features?.recall?.sawContent === true)
    assert.ok(latest, '有原文时应记录 sawContent=true')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})


for (const engine of ['core', 'planner']) test(`M2-a ${engine}：长回复按配置分条，首条引用原消息，内容不丢`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-split-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 500 + sent.length } } } }
  const longReply = '这是一段比较长的回复。'.repeat(30)
  const cog = makeCog({ dir, gateway, scheduler, llm: fakeLlm(null, longReply), configOverride: { delivery: { engine }, reply: { split: true, maxChars: 100, maxParts: 3, delayMs: 0, quote: true } } })
  try {
    cog.observe(privateEvent(1, '请详细说说'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.ok(sent.length >= 2 && sent.length <= 3, `应分 2-3 条，实际 ${sent.length}`)
    assert.equal(sent[0].message[0].type, 'reply')
    const text = sent.map((item) => item.message.filter((segment) => segment.type === 'text').map((segment) => segment.data.text).join('')).join('')
    assert.equal(text.replace(/\s+/g, ''), longReply.replace(/\s+/g, ''))
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

for (const engine of ['core', 'planner']) test(`M2-a ${engine}：群聊回复可引用 + @ 发送者`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-at-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 601 } } } }
  const cog = makeCog({
    dir, gateway, scheduler,
    configOverride: { delivery: { engine }, turn: groupTurnConfig(), reply: { split: false, quote: true, atSender: true } },
  })
  try {
    cog.observe(groupEvent(1, '你好', { chatId: 'g1', senderId: '10001', mentions: [{ userId: '999', name: '机器人' }] }), { accepted: true })
    scheduler.advance(4000)
    await flush(60)
    assert.equal(sent.length, 1)
    const types = sent[0].message.map((segment) => segment.type)
    assert.deepEqual(types, ['reply', 'at', 'text'])
    assert.equal(sent[0].message[1].data.qq, '10001')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M2-a：连续未点名接话达到上限后暂停主动接话，点名仍回', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-flood-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 700 + sent.length } } } }
  const cog = makeCog({
    dir, gateway, scheduler,
    configOverride: {
      turn: groupTurnConfig({ groupReplyMode: 'all', groupCooldownMs: 0, groupMaxRepliesPerMinute: 60, maxConsecutiveGroupReplies: 2 }),
      reply: { split: false },
    },
  })
  try {
    for (let index = 1; index <= 4; index += 1) {
      cog.observe(groupEvent(index, `群友 ${index} 在聊天`), { accepted: true })
      scheduler.advance(4000)
      await flush(40)
    }
    assert.equal(sent.length, 2, '未点名接话达到上限后不再接')
    const stats = cog.snapshot().pipeline
    assert.ok(stats.groupSkippedByReason.consecutive_limit >= 1)

    cog.observe(groupEvent(5, '机器人你出来', { mentions: [{ userId: '999', name: '机器人' }] }), { accepted: true })
    scheduler.advance(4000)
    await flush(40)
    assert.equal(sent.length, 3, '点名仍要回复')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M2-b：合并转发展开进入轮次文本与记忆', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-forward-'))
  const scheduler = createFakeScheduler()
  const sent = []
  let forwardCalls = 0
  const gateway = {
    actions: {
      sendMessage: async (payload) => { sent.push(payload); return { message_id: 811 } },
      getForwardMsg: async (id) => {
        forwardCalls += 1
        assert.equal(id, 'f1')
        return { messages: [{ sender: { nickname: '转发者' }, content: [{ type: 'text', data: { text: '转发正文：今天下午三点开会' } }] }] }
      },
    },
  }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    cog.observe({
      seq: 1, kind: 'message', selfId: '999', time: Math.floor(Date.now() / 1000),
      message: {
        id: 1, chatType: 'private', chatId: '10001', sender: { userId: '10001', nickname: '小明' },
        text: '看看这个', segments: [{ type: 'text', data: { text: '看看这个' } }, { type: 'forward', data: { id: 'f1' } }],
        mentions: [], images: [], forwards: [{ id: 'f1' }], replyId: '',
      },
    }, { accepted: true })
    scheduler.advance(4000)
    await flush(80)
    assert.equal(forwardCalls, 1, '应展开一次合并转发')
    assert.equal(sent.length, 1)
    const rows = cog.services.memory.list({ limit: 20 })
    assert.ok(rows.some((item) => String(item.content || item.memory?.content || '').includes('转发正文')), '展开文本应进入记忆/轮次')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M2-b：拍一拍回应、冷却与只回应拍机器人', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-poke-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 901 } } } }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    const base = { seq: 2, kind: 'notice', time: Math.floor(Date.now() / 1000) }
    cog.observe({ ...base, notice: { type: 'notify', subType: 'poke', userId: '10001', targetId: '999', groupId: 'g1' } }, { accepted: true })
    await flush(40)
    assert.equal(sent.length, 1)
    assert.ok(sent[0].message.some((segment) => segment.type === 'text' && segment.data.text.length > 0))
    assert.equal(cog.snapshot().pipeline.pokes, 1)
    assert.equal(cog.snapshot().pipeline.pokeReplies, 1)

    cog.observe({ ...base, notice: { type: 'notify', subType: 'poke', userId: '10001', targetId: '999', groupId: 'g1' } }, { accepted: true })
    await flush(40)
    assert.equal(sent.length, 1, '冷却内不重复回应')

    cog.observe({ ...base, notice: { type: 'notify', subType: 'poke', userId: '10001', targetId: '888', groupId: 'g1' } }, { accepted: true })
    await flush(40)
    assert.equal(sent.length, 1, '不是拍机器人不回应')
    assert.equal(cog.snapshot().pipeline.pokes, 3)
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M2-b：表情回应把机器人消息标记为正向 outcome', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-reaction-'))
  const scheduler = createFakeScheduler()
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 777 } } } }
  const cog = makeCog({ dir, gateway, scheduler })
  try {
    cog.observe(privateEvent(1, '你好'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.equal(sent.length, 1)
    cog.observe({
      seq: 2, kind: 'notice', time: Math.floor(Date.now() / 1000),
      notice: { type: 'group_msg_emoji_like', subType: 'emoji_like', userId: '10001', messageId: '777' },
    }, { accepted: true })
    await flush(20)
    assert.equal(cog.snapshot().pipeline.reactions, 1)
    const latest = cog.services.policy.history({ limit: 1 })[0]
    assert.equal(latest.status, 'observed')
    assert.ok(latest.reward > 0)
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M3-a：活跃目的注入回复上下文，完成/删除后不再注入', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-purpose-'))
  const scheduler = createFakeScheduler()
  const capture = []
  const sent = []
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 812 } } } }
  const cog = makeCog({ dir, gateway, scheduler, llm: fakeLlm(capture) })
  try {
    const goal = cog.services.purpose.create({ title: '学会做面包', priority: 0.8, scope: { scopeType: 'private', scopeId: '10001' } })
    cog.observe(privateEvent(1, '在吗'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.equal(sent.length, 1)
    assert.ok(capture.some((system) => system.includes('学会做面包')), '目的应注入 compose system')

    cog.services.purpose.complete(goal.id)
    capture.length = 0
    cog.observe(privateEvent(2, '再问一句'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.equal(sent.length, 2)
    assert.ok(!capture.some((system) => system.includes('学会做面包')), '完成后的目的不应再注入')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('M4-a：媒体识别文本进入 LLM prompt 与记忆，媒体失败不打断轮次', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-media-'))
  const scheduler = createFakeScheduler()
  const capture = []
  const sent = []
  let fail = false
  const media = {
    async ingestTurn() {
      if (fail) throw new Error('fake media failure')
      return { text: '[图片：一只白猫]', attachments: [{ kind: 'image', file: '/safe/inbound/cat.png' }] }
    },
  }
  const gateway = { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 900 } } } }
  const cog = makeCog({ dir, gateway, scheduler, llm: fakeLlm(capture), media })
  try {
    cog.observe(privateEvent(1, '看看这个'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.equal(sent.length, 1)
    assert.ok(capture.some((prompt) => prompt.includes('一只白猫')), '媒体文本应进入分析/compose prompt')
    assert.ok(cog.services.memory.list({ query: '白猫' }).some((item) => String(item.content || item.summary || '').includes('白猫')), '媒体文本应写入记忆')

    fail = true
    cog.observe(privateEvent(2, '失败也继续'), { accepted: true })
    scheduler.advance(1500)
    await flush(60)
    assert.equal(sent.length, 2, '媒体异常不应中断认知回复')
  } finally {
    cog.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('integration: pipeline awaits configured embeddings rerank; default stays offline', async (t) => {
  const envName = 'DSH_BOT_TEST_COG_EMBEDDINGS'
  const previous = process.env[envName]
  process.env[envName] = 'test-only-key'
  t.after(() => { if (previous === undefined) delete process.env[envName]; else process.env[envName] = previous })
  let fetches = 0
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, request) => {
    fetches += 1
    const { input } = JSON.parse(request.body)
    await new Promise((resolve) => setImmediate(resolve))
    return { ok: true, json: async () => ({ data: input.map((text, index) => ({ index, embedding: [text === 'coffee' ? -1 : 1, 0, 0, 0, 0, 0, 0, 0] })) }) }
  })
  for (const enabled of [false, true]) {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-embedding-'))
    const scheduler = createFakeScheduler()
    const capture = [], sent = []
    const cog = makeCog({ dir, scheduler, gateway: { actions: { sendMessage: async (payload) => { sent.push(payload); return { message_id: 1 } } } }, llm: fakeLlm(capture),
      configOverride: { memory: { retrievalTopK: 1, embedding: { enabled, baseUrl: 'https://embedding.invalid/v1', model: 'fake', apiKeyEnv: envName, weight: 1 } } } })
    try {
      cog.services.memory.remember('coffee')
      cog.services.memory.remember('tea')
      const before = fetches
      cog.observe(privateEvent(700 + Number(enabled), 'coffee please'), { accepted: true })
      scheduler.advance(1500)
      await flush(50)
      assert.equal(sent.length, 1)
      assert.equal(fetches - before, enabled ? 1 : 0)
      assert.ok(capture.some((prompt) => prompt.includes(enabled ? 'tea' : 'coffee')))
    } finally {
      cog.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  }
  fetchMock.mock.restore()
})

test('集成：accepted notice/request 分流、去重、暂停与拒收门控；默认不触发网关动作', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-notices-it-'))
  const scheduler = createFakeScheduler()
  const calls = []
  const cog = makeCog({ dir, scheduler, gateway: { actions: {
    sendMessage: async (...args) => calls.push(args),
    setFriendAddRequest: async (...args) => calls.push(args),
    setGroupAddRequest: async (...args) => calls.push(args),
  } } })
  try {
    assert.equal(await cog.ready, true)
    const notice = { kind: 'notice', time: 123, selfId: '999', notice: { type: 'group_title', groupId: '20001', userId: '10002', title: '新头衔' } }
    const request = { kind: 'request', request: { type: 'friend', userId: '10002', flag: 'opaque', comment: '你好' } }
    cog.observe(notice, { accepted: false })
    cog.observe(request, { accepted: false })
    assert.equal(cog.timeline({ types: ['event'] }).length, 0)
    assert.equal(cog.store.count('persona_self:qq_request'), 0)
    cog.pause()
    cog.observe(notice)
    cog.observe(request)
    assert.equal(cog.timeline({ types: ['event'] }).length, 0)
    assert.equal(cog.store.count('persona_self:qq_request'), 0)
    cog.resume()
    for (let i = 0; i < 2; i++) { cog.observe(notice); cog.observe(request) }
    assert.equal(cog.timeline({ types: ['event'] }).length, 1)
    assert.match(cog.timeline({ types: ['event'] })[0].detail, /新头衔/)
    assert.equal(cog.store.count('persona_self:qq_request'), 1)
    assert.equal(cog.store.list('persona_self:qq_request')[0].status, 'pending')
    cog.observe({ kind: 'notice', notice: { type: 'unknown' } })
    await flush()
    assert.deepEqual(calls, [])
    assert.equal(cog.store.count('turn'), 0)
  } finally { cog.dispose(); rmSync(dir, { recursive: true, force: true }) }
})


test('M7-s integration: persisted owner approvals survive restart/persona change and use fixed QQ action/original chat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-admin-approval-it-'))
  const sent = [], actions = []
  const config = normalizeConfig({
    access: { ownerQQ: '10001', mode: 'allowlist', groups: ['20001'] },
    cognition: { enabled: true, dryRun: false, qqAdmin: { enabled: true, requireApproval: true } },
  }).config
  const clock = { now: () => 1000000 }
  const gateway = { actions: {
    async sendMessage(payload) { sent.push(payload); return { message_id: 71 } },
    async setGroupKick(...args) { actions.push(args); return {} },
  } }
  const start = () => createCognition({ getConfig: () => config, gateway, clock,
    scheduler: createFakeScheduler(), dataRoot: dir, access: createAccess({ getConfig: () => config }) })
  let cog = start()
  try {
    assert.equal(await cog.ready, true)
    const origin = { chatType: 'group', chatId: '20001', senderId: '10001', text: '/kick 10002 confirm' }
    assert.equal((await cog.services.pipeline.handleTurn(origin)).command, true)
    const row = cog.services.approvals.list()[0]
    assert.equal(cog.store.get('qq_admin_approval', row.id).status, 'pending')
    assert.equal(actions.length, 0)
    cog.dispose()
    cog = start()
    assert.equal(await cog.ready, true)
    assert.equal(cog.services.approvals.get(row.id).status, 'pending')
    cog.services.persona.create({ name: '另一人格' })
    const approval = { chatType: 'private', chatId: '10001', senderId: '10001', text: `/approve ${row.id} confirm` }
    assert.match((await cog.services.pipeline.handleTurn(approval)).reply, /已批准并执行/)
    assert.deepEqual(actions, [['20001', '10002']])
    assert.equal(cog.services.approvals.get(row.id).status, 'executed')
    assert.ok(sent.some((item) => item.chatId === '20001' && item.message.some((segment) => segment.data?.text === 'QQ 动作已完成。')))
    assert.match((await cog.services.commands.handle(approval)).reply, /处理失败/)
    assert.equal(actions.length, 1)
  } finally { cog.dispose(); rmSync(dir, { recursive: true, force: true }) }
})

test('M7-v: cognition wires an empty manual registry into owner commands; links survive restart/persona switch', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-identity-wiring-'))
  let cognition
  t.after(() => { try { cognition?.dispose() } catch {} rmSync(dir, { recursive: true, force: true }) })
  const config = normalizeConfig({ access: { mode: 'allowlist', ownerQQ: '10001' } }).config
  const sent = []
  const create = () => createCognition({
    getConfig: () => config, dataRoot: dir, clock: createClock(), scheduler: createFakeScheduler(),
    access: createAccess({ getConfig: () => config }),
    gateway: { actions: { sendMessage: async (...args) => { sent.push(args); return { ok: true, message_id: 'm1' } } } },
  })
  cognition = create()
  assert.equal(cognition.services.identities.counts().total, 0)
  const personBefore = cognition.services.person.listPersons()
  const ownerTurn = { chatType: 'private', chatId: '10001', senderId: '10001', text: '/identity link telegram alice p_manual label' }
  assert.match((await cognition.services.commands.handle(ownerTurn)).reply, /已保存/)
  assert.deepEqual(cognition.services.person.listPersons(), personBefore)
  const row = cognition.services.identities.resolve({ platform: 'telegram', externalId: 'alice' })
  const other = cognition.services.persona.create({ name: 'Other' })
  assert.equal(cognition.services.persona.activate(other.persona.id).ok, true)
  assert.equal(cognition.services.identities.resolve({ platform: 'telegram', externalId: 'alice' }).id, row.id)
  assert.deepEqual(cognition.services.person.listPersons(), [])
  cognition.dispose()
  cognition = create()
  assert.equal(cognition.services.identities.counts().total, 1)
  assert.match((await cognition.services.commands.handle({ ...ownerTurn, text: '/identity' })).reply, /telegram:alice → p_manual · label/)
})

test('C06: expired pending and persona switches never create negative or cross-persona feedback', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-c06-pending-'))
  const cog = makeCog({ dir, scheduler: createFakeScheduler(), gateway: { actions: { sendMessage: async () => ({ message_id: 'm_c06' }) } } })
  t.after(() => { cog.dispose(); rmSync(dir, { recursive: true, force: true }) })
  const pipeline = cog.services.pipeline
  const turn = id => ({ id, chatType: 'private', chatId: '10001', senderId: '10001', text: '你好', addressed: true, messages: [], messageIds: [] })
  await pipeline.handleTurn(turn('turn_first'))
  pipeline._pending.get('private:10001').sentAt = Date.now() - 11 * 60 * 1000
  assert.equal(pipeline.observeIncoming(turn('turn_expired')), null)
  assert.equal(cog.services.personaStore.count('outcome'), 0)
  assert.equal(cog.services.personaStore.count('policy'), 0)
  await pipeline.handleTurn(turn('turn_second'))
  const source = cog.activePersonaId(), other = cog.createPersona({ name: 'Other' }).persona.id
  cog.switchPersona(other); cog.switchPersona(source)
  assert.equal(pipeline.handleReaction({ notice: { userId: '10001', messageId: 'm_c06' } }).ok, false)
  assert.equal(pipeline.observeIncoming(turn('turn_returned')), null)
  assert.equal(cog.services.personaStore.count('outcome'), 0)
  assert.equal(cog.services.personaStore.count('policy'), 0)
})
