import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isQuietHour } from '../src/modules/builtin/proactivity/engine.js'
import { harness, deferred } from './helpers/proactivity.js'

test('moved engine: private flat candidates, ranking, bounded context and fixed model request', async t => {
  const h = harness(t)
  h.seed('group', { scopeType: 'group', affinity: 10 })
  h.seed('invalid', { scopeId: 'https://private.invalid', affinity: 10 })
  h.seed('second', { scopeId: '10002', affinity: 0.1 })
  h.store.put('memory', 'm', { status: 'active', scopeType: 'private', scopeId: '10001', personId: 'p1', summary: '记'.repeat(300), importance: 1 })
  h.store.put('memory', 'other', { status: 'active', scopeType: 'private', scopeId: '10002', personId: 'p1', summary: 'OTHER_CHAT', importance: 1 })
  const result = await h.engine.tick()
  assert.equal(result.ok, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].chatId, '10001')
  const request = h.modelCalls[0]
  assert.equal(request.purpose, 'proactive'); assert.equal(request.maxTokens, 220); assert.equal(request.temperature, 0.8)
  assert.deepEqual(request.chat, { chatType: 'private', chatId: '10001' })
  assert.match(request.user, /friend|熟悉 0.9/)
  assert.ok(request.user.includes('记'.repeat(160))); assert.ok(!request.user.includes('记'.repeat(161)))
  assert.doesNotMatch(request.user, /OTHER_CHAT|undefined/)
  const decisions = h.store.list('decision'), intents = h.store.list('proactive_intent')
  assert.equal(decisions.length, 1); assert.equal(decisions[0].action, 'proactive'); assert.equal(decisions[0].status, 'sent')
  assert.deepEqual(decisions[0].features, { familiarity: 0.9, affinity: 0.8, initiative: 0.7 })
  assert.equal(intents.length, 1); assert.equal(intents[0].decisionId, decisions[0].id)
  assert.equal('text' in result, false); assert.equal('result' in result, false)
  assert.equal(h.engine.stats().lastTickAt > 0, true); assert.equal(h.engine.stats().sent, 1)
  assert.equal((await h.engine.tick()).reason, 'daily_budget')
})

test('quiet local hours, enabled/paused gates, ranking backoff and rolling 24h counts including failed/dry', async t => {
  assert.equal(isQuietHour(23, 23, 8), true); assert.equal(isQuietHour(8, 23, 8), false)
  const h = harness(t)
  h.config.cognition.proactivity.quietStart = 9; h.config.cognition.proactivity.quietEnd = 18
  assert.equal((await h.engine.tick()).reason, 'quiet_hours')
  h.config.cognition.proactivity.quietEnd = 9
  h.config.cognition.paused = true; assert.equal((await h.engine.tick()).reason, 'disabled')
  h.config.cognition.paused = false; h.config.cognition.proactivity.enabled = false
  assert.equal((await h.engine.tick()).reason, 'disabled')
  h.config.cognition.proactivity.enabled = true
  h.seed('r1', { lastInteractionAt: h.port.snapshot().now - 1000 })
  assert.equal((await h.engine.tick()).reason, 'backoff')
  h.seed('r1', { familiarity: 0.1 })
  assert.equal((await h.engine.tick()).reason, 'no_candidate')
  h.seed()
  for (const status of ['dry_run', 'failed']) {
    h.store.put('decision', 'budget', { action: 'proactive', status })
    assert.equal((await h.engine.tick()).reason, 'daily_budget')
    h.store.remove('decision', 'budget')
  }
  h.store.put('decision', 'old', { action: 'proactive', status: 'sent' })
  h.advance(86400001)
  assert.equal((await h.engine.tick()).ok, true)
})

test('single recursive timer: 5m initial/10m after await, idempotence, single flight and no rearm after stop', async t => {
  const gate = deferred(), entered = deferred()
  const h = harness(t, { llm: async () => { entered.resolve(); await gate.promise; return { ok: true, text: 'hello' } } })
  h.engine.start(); h.engine.start(); assert.equal(h.timers.size, 1); assert.deepEqual(h.delays, [300000])
  const ticking = h.fire(); await entered.promise
  assert.equal(h.timers.size, 0); assert.equal((await h.engine.tick()).reason, 'busy')
  h.engine.stop(); h.engine.stop(); gate.resolve()
  assert.equal(await ticking, undefined)
  assert.equal(h.calls.length, 0); assert.equal(h.timers.size, 0)
  assert.equal((await h.engine.tick()).reason, 'MODULE_DISABLED')
  h.engine.start(); assert.equal(h.timers.size, 1)
  await h.fire(); assert.deepEqual(h.delays, [300000, 300000, 600000]); assert.equal(h.timers.size, 1)
  h.engine.stop(); assert.equal(h.timers.size, 0)
})

test('outbound guards run before dry-run; failed/dry decisions count, no retry or raw error leakage', async t => {
  for (const mode of ['access', 'rate', 'leak', 'dry', 'throw']) await t.test(mode, async t => {
    const h = harness(t, { llm: async () => ({ ok: true, text: mode === 'leak' ? 'sk-1234567890123456789012345' : 'hello' }), sendMessage: async () => { throw Error('RAW_SECRET_URL') } })
    if (mode !== 'throw') h.config.cognition.dryRun = true
    if (mode === 'access') h.access.canSend = () => ({ allowed: false, reason: 'RAW_SECRET_URL' })
    if (mode === 'rate') h.config.cognition.policy.perChatPrivate = 0
    if (mode === 'leak') h.config.security.leakGuard.action = 'block'
    const result = await h.engine.tick()
    assert.equal(result.ok, mode === 'dry')
    assert.equal(h.calls.length, mode === 'throw' ? 1 : 0)
    assert.doesNotMatch(JSON.stringify([result, h.engine.stats()]), /RAW_SECRET|sk-/)
    const records = h.store.list('decision')
    assert.equal(records.length, 1); assert.equal(records[0].status, mode === 'dry' ? 'dry_run' : 'failed')
    assert.equal(h.store.count('proactive_intent'), mode === 'dry' ? 1 : 0)
    assert.equal((await h.engine.tick()).reason, 'daily_budget')
  })
})

test('model failure uses a safe code and creates no decision', async t => {
  const h = harness(t, { llm: async () => ({ ok: false, error: 'provider-secret', message: 'RAW_SECRET_URL' }) })
  assert.deepEqual(await h.engine.tick(), { ok: false, reason: 'LLM_FAILED' })
  assert.equal(h.store.count('decision'), 0); assert.equal(h.calls.length, 0)
  assert.doesNotMatch(JSON.stringify(h.engine.stats()), /RAW_SECRET|provider-secret/)
})

test('persona switch or stop during memory/LLM awaits cancels late results without records or resend', async t => {
  for (const stage of ['memory', 'llm']) for (const action of ['switch', 'switch-back', 'stop']) await t.test(`${stage}/${action}`, async t => {
    const gate = deferred(), entered = deferred()
    const wait = async () => { entered.resolve(); await gate.promise }
    const h = harness(t, stage === 'memory' ? { memoryFactory: () => ({ async retrieveAsync() { await wait(); return [] } }) } : { llm: async () => { await wait(); return { ok: true, text: 'late' } } })
    const work = h.engine.tick(); await entered.promise
    if (action === 'stop') h.stop()
    else { h.switchPersona('other'); if (action === 'switch-back') h.switchPersona('self') }
    gate.resolve(); assert.equal((await work).ok, false)
    assert.equal(h.calls.length, 0)
    assert.equal(h.base.count('persona_self:decision'), 0); assert.equal(h.base.count('persona_other:decision'), 0)
  })
})

test('admitted send finishes once in captured persona after stop/switch with canonical receipt', async t => {
  const gate = deferred(), entered = deferred()
  const h = harness(t, { sendMessage: async () => { entered.resolve(); await gate.promise; return { message_id: 'late' } } })
  const work = h.engine.tick(); await entered.promise
  h.switchPersona('other'); h.stop(); gate.resolve()
  assert.equal((await work).ok, true)
  const decision = h.base.list('persona_self:decision')[0]
  assert.equal(decision.status, 'sent'); assert.equal(decision.messageId, 'late')
  assert.equal(h.base.count('persona_self:proactive_intent'), 1)
  assert.equal(h.base.count('persona_other:decision'), 0); assert.equal(h.base.count('persona_other:proactive_intent'), 0)
  assert.equal(h.calls.length, 1); assert.equal((await h.engine.tick()).reason, 'MODULE_DISABLED')
})

test('proactivity port: accepted run owns one persona-bound loop and delivery receipt; no-send has none', async t => {
  const h = harness(t, { observe: true })
  assert.equal((await h.engine.tick()).ok, true)
  const [loop] = h.store.list('loop_run'), [receipt] = h.store.list('delivery_receipt')
  assert.equal(loop.loopKind, 'proactivity')
  assert.equal(loop.status, 'completed')
  assert.equal(receipt.loopId, loop.id)
  assert.equal(receipt.decisionId, h.store.list('decision')[0].id)
  assert.equal(receipt.moduleId, 'builtin-proactivity')
  assert.equal(receipt.runtimeGeneration, 'runtime_1')
  assert.equal(receipt.data.parts, 1)
  assert.doesNotMatch(JSON.stringify([loop, receipt]), /hello|friend|10001|summary|prompt/)
  const empty = harness(t, { observe: true, llm: async () => ({ ok: true, text: '' }) })
  assert.equal((await empty.engine.tick()).ok, false)
  assert.equal(empty.store.list('loop_run')[0].status, 'completed')
  assert.equal(empty.store.list('delivery_receipt').length, 0)
})

test('proactivity observation: stop during admitted send waits for real receipt in original persona', async t => {
  const gate = deferred(), entered = deferred()
  const h = harness(t, { observe: true, sendMessage: async () => { entered.resolve(); await gate.promise; return { message_id: 'm' } } })
  const flight = h.engine.tick()
  await entered.promise
  const stop = h.engine.stop()
  assert.equal(h.store.list('loop_run')[0].status, 'running')
  h.switchPersona('other')
  gate.resolve()
  assert.equal((await flight).ok, true)
  await stop
  const loops = h.base.list('persona_self:loop_run'), receipts = h.base.list('persona_self:delivery_receipt')
  assert.equal(loops[0].status, 'completed')
  assert.equal(loops[0].reasonCode, null)
  assert.equal(receipts[0].data.status, 'sent')
  assert.equal(h.store.list('delivery_receipt').length, 0)
})

test('proactivity observation: post-send business write failure keeps real receipt and fails loop without resend', async t => {
  const h = harness(t, { observe: true })
  const put = h.base.put
  h.base.put = (kind, ...args) => {
    if (kind.endsWith(':proactive_intent')) throw Error('business write')
    return put(kind, ...args)
  }
  assert.equal((await h.engine.tick()).ok, false)
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.list('delivery_receipt')[0].data.parts, 1)
  assert.equal(h.store.list('loop_run')[0].status, 'failed')
  assert.equal(h.store.list('loop_run')[0].reasonCode, 'EXECUTION_THROW')
})
