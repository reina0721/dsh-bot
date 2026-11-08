import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { setup as setupReplyDelivery } from '../src/modules/builtin/reply-delivery.js'

// Expose closure-local delivery functions only in this test module. Instrument the
// existing no-op ctxEmit so payload parity is observable without changing the API.
const pipelineUrl = new URL('../src/cognition/pipeline.js', import.meta.url)
const source = readFileSync(pipelineUrl, 'utf8')
  .replace(/from '([^']+)'/g, (_, path) => `from '${new URL(path, pipelineUrl).href}'`)
  .replace('function ctxEmit() {}', 'const deliveryEvents = []; function ctxEmit(...args) { deliveryEvents.push(args) }')
  .replace('groupMode: effectiveGroupMode,', '_sendDecision: sendDecision, _events: deliveryEvents, _groupReplyAllowed: groupReplyAllowed, groupMode: effectiveGroupMode,')
const { createPipeline } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)

const decision = { id: 'd1', action: 'reply' }
const turn = { chatType: 'group', chatId: 'g1', senderId: 123, messages: [{ messageId: 'old' }, { messageId: 'latest' }], addressed: false }
const texts = ['字'.repeat(40), '字'.repeat(40), '字'.repeat(15)]
const text = texts.map(value => `<bubble>${value}</bubble>`).join('')
const segment = (value) => ({ type: 'text', data: { text: value } })

function registeredRegistry() {
  const registry = createDeliveryRegistry()
  setupReplyDelivery({ delivery: { registerPlanner: registry.register } })
  return registry
}

function harness({ observer = null, engine, deliveryRegistry = engine === 'planner' ? registeredRegistry() : null, reply = {}, dryRun = false, responses = [], direct = false, unavailable = false } = {}) {
  const calls = [], notes = [], marks = [], warnings = []
  const config = { cognition: { delivery: { engine }, dryRun, reply: { maxChars: 40, maxParts: 3, delayMs: 0, atSender: true, ...reply }, turn: { groupCooldownMs: 500 } } }
  const pipeline = createPipeline({
    observer, getConfig: () => config, deliveryRegistry,
    clock: { now: () => 1000 }, policy: { markSent: (...args) => marks.push(['sent', ...args]), markFailed: (...args) => marks.push(['failed', ...args]) },
    logger: { warn: (...args) => warnings.push(args) },
    turnAggregator: { noteBotMessage: (id) => notes.push(id) },
    outbound: direct ? null : { deliver: async (payload) => { calls.push(payload); return responses[calls.length - 1] ?? { ok: true, messageId: `m${calls.length}`, result: { n: calls.length } } } },
    gateway: unavailable ? null : { actions: { sendMessage: async (payload) => { calls.push(payload); const response = responses[calls.length - 1]; if (response instanceof Error) throw response; return response ?? { message_id: calls.length } } } },
  })
  return { pipeline, config, calls, notes, marks, warnings, send: (value = text, target = turn, opts) => pipeline._sendDecision(decision, value, target, opts) }
}

// Core and registered planners share the model bubble protocol and delivery guards.
for (const engine of [undefined, 'auto', 'core', 'planner']) {
  test(`delivery ${engine || 'default'}: exact split, quote/@, attribution and side effects`, async () => {
    const h = harness({ engine })
    assert.deepEqual(await h.send(), { ok: true, status: 'sent', messageId: 'm1', result: { n: 3 }, parts: 3 })
    assert.deepEqual(h.calls, texts.map((value, index) => ({ chatType: 'group', chatId: 'g1', segments: [...(index ? [] : [{ type: 'reply', data: { id: 'latest' } }, { type: 'at', data: { qq: '123' } }]), segment(value)], decisionId: index ? '' : 'd1', source: 'pipeline', dryRun: null })))
    assert.deepEqual(h.notes, ['m1', 'm2', 'm3'])
    assert.deepEqual(h.pipeline._events, texts.map((_, index) => ['onebot-qq/cognition-sent', { decisionId: 'd1', messageId: `m${index + 1}`, chatType: 'group', chatId: 'g1', action: 'reply', part: index, parts: 3 }]))
    assert.equal(h.pipeline.stats().sent, 3)
    assert.deepEqual([...h.pipeline._pending], [['group:g1', { decisionId: 'd1', messageId: 'm1', sentAt: 1000, action: 'reply', text }]])
    assert.deepEqual(h.pipeline._groupReplyAllowed(turn), { ok: false, reason: 'cooldown' })
  })

  test(`delivery ${engine || 'default'}: split false trims protocol text; quote and at conditions`, async () => {
    for (const [reply, target, opts, prefix] of [
      [{ split: false }, turn, {}, [{ type: 'reply', data: { id: 'latest' } }, { type: 'at', data: { qq: '123' } }]],
      [{ quote: false, atSender: false }, turn, {}, []],
      [{}, { ...turn, chatType: 'private' }, {}, [{ type: 'reply', data: { id: 'latest' } }]],
      [{}, { ...turn, messages: [], senderId: '' }, {}, []],
      [{}, turn, { noReplySegment: true }, [{ type: 'at', data: { qq: '123' } }]],
    ]) {
      const h = harness({ engine, reply })
      await h.send(' hi ', target, opts)
      assert.deepEqual(h.calls[0].segments, [...prefix, segment('hi')])
    }
  })

  test(`delivery ${engine || 'default'}: exact delay between parts only`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = harness({ engine, reply: { delayMs: 17 } })
    const done = h.send()
    await Promise.resolve()
    assert.equal(h.calls.length, 1)
    t.mock.timers.tick(16); await Promise.resolve()
    assert.equal(h.calls.length, 1)
    t.mock.timers.tick(1); await new Promise((resolve) => setImmediate(resolve))
    assert.equal(h.calls.length, 2)
    t.mock.timers.tick(17)
    assert.deepEqual(await done, { ok: true, status: 'sent', messageId: 'm1', result: { n: 3 }, parts: 3 })
  })

  test(`delivery ${engine || 'default'}: first/later failure and first/later dryRun`, async () => {
    const success = { ok: true, messageId: 'first', result: { first: true } }
    const failure = { ok: false, error: 'ACCESS_DENIED', blocked: true, reason: 'deny' }
    for (const [responses, expected, sent, dry] of [
      [[failure], { ok: false, status: 'failed', error: 'ACCESS_DENIED', blocked: true, reason: 'deny', parts: 0 }, 0, 0],
      [[{}], { ok: false, status: 'failed', error: 'SEND_FAILED', blocked: false, reason: '', parts: 0 }, 0, 0],
      [[success, failure], { ok: true, status: 'partial', partial: true, sentParts: 1, failedPart: 1, error: 'PARTIAL_SEND', messageId: 'first', result: { first: true }, parts: 1 }, 1, 0],
      [[{ ok: true, dryRun: true }], { ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 }, 0, 1],
      [[success, { ok: true, dryRun: true }], { ok: true, status: 'dry_run', messageId: 'first', result: { first: true }, parts: 1 }, 1, 0],
    ]) {
      const h = harness({ engine, responses })
      assert.deepEqual(await h.send(), expected)
      assert.equal(h.calls.length, sent ? 2 : 1)
      assert.equal(h.pipeline.stats().sent, sent)
      assert.equal(h.pipeline.stats().dryRun, dry)
      assert.equal(h.pipeline._pending.size, sent)
      assert.equal(h.notes.length, sent)
      assert.equal(h.pipeline._events.length, sent)
      assert.deepEqual(h.pipeline._groupReplyAllowed(turn), sent ? { ok: false, reason: 'cooldown' } : { ok: true })
    }
  })

  test(`delivery ${engine || 'default'}: empty text, whitespace, dryRun override and first nonempty message ID`, async () => {
    for (const dryRun of [false, true]) {
      const h = harness({ engine, dryRun })
      assert.deepEqual(await h.send(''), { ok: true, dryRun, messageId: '' })
      assert.deepEqual(h.marks, [['sent', 'd1', { dryRun }]])
      assert.equal(h.calls.length, 0)
      assert.equal(h.pipeline.stats().dryRun, Number(dryRun))
      assert.equal(h.pipeline._pending.size, 0)
    }
    const whitespace = harness({ engine })
    assert.deepEqual(await whitespace.send('   '), { ok: false, error: 'SEND_FAILED' })
    const dry = harness({ engine, dryRun: true, responses: [{ ok: true, dryRun: true }] })
    await dry.send()
    assert.equal(dry.calls[0].dryRun, true)
    const missingId = harness({ engine, responses: [{ ok: true, messageId: '' }] })
    assert.equal((await missingId.send()).messageId, 'm2')
  })

  test(`delivery ${engine || 'default'}: legacy direct fallback marks only the first part`, async () => {
    const h = harness({ engine, direct: true })
    assert.deepEqual(await h.send(), { ok: true, status: 'sent', messageId: '1', result: { message_id: 3 }, parts: 3 })
    assert.deepEqual(h.marks, [['sent', 'd1', { messageId: '1' }]])
    assert.deepEqual(h.calls.map((call) => call.message), texts.map((value, index) => [...(index ? [] : [{ type: 'reply', data: { id: 'latest' } }, { type: 'at', data: { qq: '123' } }]), segment(value)]))
    const dry = harness({ engine, direct: true, dryRun: true })
    assert.deepEqual(await dry.send(), { ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 })
    assert.deepEqual(dry.marks, [['sent', 'd1', { dryRun: true }]])
    assert.equal(dry.calls.length, 0)
    const failure = harness({ engine, direct: true, responses: [new Error('failed')] })
    assert.deepEqual(await failure.send(), { ok: false, status: 'failed', error: 'failed', blocked: false, reason: '', parts: 0 })
    assert.deepEqual(failure.marks, [['failed', 'd1', 'failed']])
    const partial = harness({ engine, direct: true, responses: [{ message_id: 1 }, new Error('later failed')] })
    assert.deepEqual(await partial.send(), { ok: true, status: 'partial', partial: true, sentParts: 1, failedPart: 1, error: 'PARTIAL_SEND', messageId: '1', result: { message_id: 1 }, parts: 1 })
    assert.deepEqual(partial.marks, [['sent', 'd1', { messageId: '1' }]])
    const unavailable = harness({ engine, direct: true, unavailable: true, dryRun: true })
    assert.deepEqual(await unavailable.send(), { ok: false, status: 'failed', error: 'GATEWAY_UNAVAILABLE', blocked: false, reason: '', parts: 0 })
  })

  test(`delivery ${engine || 'default'}: re-reads dryRun for later parts`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const h = harness({ engine, reply: { delayMs: 10 }, responses: [{ ok: true, messageId: 'first' }, { ok: true, dryRun: true }] })
    const done = h.send()
    await new Promise((resolve) => setImmediate(resolve))
    h.config.cognition.dryRun = true
    t.mock.timers.tick(10)
    assert.deepEqual(await done, { ok: true, status: 'dry_run', messageId: 'first', result: undefined, parts: 1 })
    assert.deepEqual(h.calls.map((call) => call.dryRun), [null, true])
    assert.equal(h.pipeline.stats().sent, 1)
    assert.equal(h.pipeline.stats().dryRun, 0)
  })
}

test('delivery planner: invalid plan uses guarded single text fallback; runtime rollback restores core', async () => {
  // Raw invalid delay cannot arise from normalizeConfig. It exercises routing and
  // recovery without a production test hook or replacing the actual builder.
  const h = harness({ engine: 'planner', reply: { delayMs: Infinity } })
  assert.deepEqual(await h.send(), { ok: true, status: 'sent', messageId: 'm1', result: { n: 1 }, parts: 1 })
  assert.deepEqual(h.calls[0].segments, [segment(texts.join('\n'))])
  assert.deepEqual(h.pipeline._events[0][1], { decisionId: 'd1', messageId: 'm1', chatType: 'group', chatId: 'g1', action: 'reply', part: 0, parts: 1 })
  h.config.cognition.delivery.engine = 'core'
  h.config.cognition.reply.delayMs = 0
  assert.equal((await h.send()).parts, 3)
  assert.deepEqual(h.calls[1].segments.map((part) => part.type), ['reply', 'at', 'text'])
  assert.equal(h.pipeline.stats().sent, 4)
})

test('delivery engines: registry absent/present matrix and core bypass', async () => {
  for (const engine of [undefined, 'auto', 'core', 'planner']) {
    for (const present of [false, true]) {
      let planned = 0
      const registry = registeredRegistry()
      const original = registry.resolve().plan
      registry.remove('builtin-reply-delivery')
      registry.register({ id: 'observed', stage: 'format', plan: (ctx) => {
        planned++
        assert.deepEqual(Object.keys(ctx).sort(), ['text', 'turn', 'replyCfg', 'replyTo', 'source', 'decisionId'].sort())
        assert.equal(ctx.decisionId, decision.id)
        assert.equal(ctx.replyTo, 'latest')
        return original(ctx)
      } })
      const h = harness({ engine, deliveryRegistry: present ? registry : null })
      const sent = await h.send()
      const fallback = engine === 'planner' && !present
      assert.equal(sent.parts, fallback ? 1 : 3, `${engine}/${present}`)
      assert.equal(planned, Number(present && engine !== 'core'))
      assert.deepEqual(h.calls[0].segments.map(s => s.type), fallback ? ['text'] : ['reply', 'at', 'text'])
      assert.equal(h.warnings.length, Number(fallback))
    }
  }
})

test('delivery planner: thrown/invalid plans fall back safely in auto and planner; outbound rejects without retry', async () => {
  for (const engine of ['auto', 'planner']) for (const plan of [() => { throw Error('secret-marker') }, () => null, () => ({ parts: [] })]) {
    const registry = createDeliveryRegistry()
    registry.register({ id: 'bad', stage: 'format', plan })
    const h = harness({ engine, deliveryRegistry: registry })
    assert.equal((await h.send()).parts, 1)
    assert.deepEqual(h.calls[0].segments, [segment(texts.join('\n'))])
    assert.equal(h.notes.length, 1)
    assert.equal(h.pipeline.stats().sent, 1)
    assert.equal(h.pipeline._pending.size, 1)
    assert.equal(h.warnings.length, 1)
    assert.doesNotMatch(JSON.stringify(h.warnings), /secret-marker/)
    const blocked = harness({ engine, deliveryRegistry: registry, responses: [{ ok: false, error: 'ACCESS_DENIED', blocked: true }] })
    assert.equal((await blocked.send()).error, 'ACCESS_DENIED')
    assert.equal(blocked.calls.length, 1)
    assert.equal(blocked.pipeline.stats().sent, 0)
    const dry = harness({ engine, deliveryRegistry: registry, responses: [{ ok: true, dryRun: true }] })
    assert.deepEqual(await dry.send(), { ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 })
    assert.equal(dry.pipeline.stats().dryRun, 1)
    assert.equal(dry.pipeline._pending.size, 0)
  }
})

test('delivery planner: resolves registration on each send after disable and re-enable', async () => {
  const registry = registeredRegistry()
  const h = harness({ engine: 'auto', deliveryRegistry: registry })
  assert.equal((await h.send()).parts, 3)
  registry.remove('builtin-reply-delivery')
  assert.equal((await h.send()).parts, 3)
  h.config.cognition.delivery.engine = 'planner'
  assert.equal((await h.send()).parts, 1)
  setupReplyDelivery({ delivery: { registerPlanner: registry.register } })
  assert.equal((await h.send()).parts, 3)
  assert.equal(h.pipeline.stats().sent, 10)
})

test('pipeline delivery engines: one receipt for all parts; historical empty paths have none', async t => {
  const { loopHarness } = await import('./helpers/loop.js')
  const observation = loopHarness(t)
  for (const engine of ['auto', 'core', 'planner']) {
    observation.advance(1)
    const h = harness({ observer: observation.observer, engine })
    assert.equal((await h.send()).parts, 3)
    const receipt = observation.receipts().find(row => row.recordedAt === observation.clock.now())
    assert.equal(receipt.data.parts, 3)
    assert.equal(receipt.decisionId, 'd1')
    const count = observation.receipts().length
    await h.send('')
    await h.send('   ')
    assert.equal(observation.receipts().length, count)
  }
})


test('delivery engines: untagged one-shot stays one even with a small legacy target', async () => {
  for (const engine of [undefined, 'auto', 'core', 'planner']) {
    const h = harness({ engine })
    const value = '解释信息。'.repeat(100)
    assert.equal((await h.send(value)).parts, 1)
    assert.equal(h.calls[0].segments.at(-1).data.text, value)
    assert.equal(h.pipeline.stats().sent, 1)
  }
})
