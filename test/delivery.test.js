import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildReplyPlan, buildFallbackPlan, validateDeliveryPlan } from '../src/delivery/plan.js'
import { executeDeliveryPlan } from '../src/delivery/executor.js'

const turn = { chatType: 'group', chatId: 'g1', senderId: 123, messages: [{ messageId: 'last' }] }
const context = { text: '字'.repeat(115), turn, decision: { id: 'd1' }, replyCfg: { maxChars: 40, maxParts: 3, delayMs: 19, atSender: true } }
const textSegment = (text) => ({ type: 'text', data: { text } })
const plan = () => buildReplyPlan(context)

test('delivery architecture: core planner files do not depend on modules', () => {
  for (const file of ['plan.js', 'reply-plan.js', 'text-split.js']) {
    const source = readFileSync(new URL(`../src/delivery/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /['"][^'"\r\n]*modules\//, `${file} must not import or re-export modules`)
  }
})

test('reply plan: exact shape, limits, first-part quote/@ and purity', () => {
  const input = structuredClone(context)
  const built = buildReplyPlan(input)
  assert.deepEqual(built, {
    source: 'pipeline', decisionId: 'd1', target: { chatType: 'group', chatId: 'g1' },
    parts: [
      { segments: [{ type: 'reply', data: { id: 'last' } }, { type: 'at', data: { qq: '123' } }, textSegment('字'.repeat(40))], delayAfterMs: 19 },
      { segments: [textSegment('字'.repeat(40))], delayAfterMs: 19 },
      { segments: [textSegment('字'.repeat(35))], delayAfterMs: 0 },
    ], meta: { planner: 'core', fallback: false },
  })
  assert.deepEqual(input, context)
  built.parts[0].segments[0].data.id = 'changed'
  assert.equal(turn.messages[0].messageId, 'last')
  const capped = buildReplyPlan({ ...context, replyCfg: { maxChars: 40, maxParts: 2, delayMs: -5 } })
  assert.deepEqual(capped.parts.map((part) => part.segments.at(-1).data.text.length), [40, 75])
  assert.deepEqual(capped.parts.map((part) => part.delayAfterMs), [0, 0])
  assert.equal(buildReplyPlan({ ...context, replyCfg: { maxChars: 40, maxParts: 1 } }).parts[0].segments.at(-1).data.text, context.text)
})

test('reply plan: split false, empty, quote override, private and missing sender/message', () => {
  const single = buildReplyPlan({ ...context, text: '  hi  ', replyCfg: { split: false, quote: false, atSender: false }, source: 'custom', decisionId: 'override' })
  assert.deepEqual(single.parts, [{ segments: [textSegment('  hi  ')], delayAfterMs: 0 }])
  assert.equal(single.source, 'custom')
  assert.equal(single.decisionId, 'override')
  const privatePlan = buildReplyPlan({ ...context, turn: { ...turn, chatType: 'private' }, replyTo: 'explicit' })
  assert.deepEqual(privatePlan.parts[0].segments.slice(0, -1), [{ type: 'reply', data: { id: 'explicit' } }])
  const missing = buildReplyPlan({ ...context, turn: { ...turn, senderId: '', messages: [] } })
  assert.deepEqual(missing.parts[0].segments, [textSegment('字'.repeat(40))])
  for (const text of ['', undefined, '  ']) assert.deepEqual(buildReplyPlan({ ...context, text }).parts, [])
  const defaults = buildReplyPlan({ text: ' hi ', turn })
  assert.equal(defaults.decisionId, '')
  assert.deepEqual(defaults.parts, [{ segments: [{ type: 'reply', data: { id: 'last' } }, textSegment('hi')], delayAfterMs: 0 }])
})

test('plan validation: rejects malformed targets, empty parts/segments, overflow and invalid delays', () => {
  assert.equal(validateDeliveryPlan(plan()), true)
  assert.equal(validateDeliveryPlan({ ...plan(), target: { chatType: 'private', chatId: 123 } }), true)
  const cases = [null, {}, { ...plan(), parts: [] }, { ...plan(), parts: {} }, { ...plan(), parts: Array(11).fill(plan().parts[0]) }]
  for (const target of [null, {}, { chatType: 'other', chatId: 'x' }, { chatType: 'group', chatId: '' }, { chatType: 'group', chatId: ' ' }, { chatType: 'group', chatId: {} }, { chatType: 'group', chatId: Infinity }]) cases.push({ ...plan(), target })
  for (const part of [null, {}, { segments: 'text', delayAfterMs: 0 }, { segments: [], delayAfterMs: 0 }, { segments: [null], delayAfterMs: 0 }, { segments: [textSegment('')], delayAfterMs: 0 }]) cases.push({ ...plan(), parts: [part] })
  for (const delayAfterMs of [-1, NaN, Infinity, '1', undefined, null]) cases.push({ ...plan(), parts: [{ ...plan().parts[0], delayAfterMs }] })
  for (const invalid of cases) assert.equal(validateDeliveryPlan(invalid), false)
  assert.equal(validateDeliveryPlan({ ...plan(), parts: Array(10).fill(plan().parts[0]) }), true)
})

test('fallback plan: single pure text, same attribution, no quote/@ or delay', () => {
  const input = structuredClone(context)
  assert.deepEqual(buildFallbackPlan(input), {
    source: 'pipeline', decisionId: 'd1', target: { chatType: 'group', chatId: 'g1' },
    parts: [{ segments: [textSegment(context.text)], delayAfterMs: 0 }], meta: { planner: 'core', fallback: true },
  })
  assert.deepEqual(input, context)
  const custom = buildFallbackPlan({ ...context, text: ' hi ', source: 'custom', decisionId: 'd2' })
  assert.equal(custom.source, 'custom')
  assert.equal(custom.decisionId, 'd2')
  assert.equal(custom.parts[0].segments[0].data.text, ' hi ')
  for (const text of ['', undefined, ' ']) assert.equal(validateDeliveryPlan(buildFallbackPlan({ ...context, text })), false)
})

function recorder(responses = []) {
  const calls = [], events = []
  return {
    calls, events,
    options: {
      plan: plan(),
      deliver: async (payload) => { calls.push(payload); events.push(['deliver', calls.length - 1]); return responses[calls.length - 1] ?? { ok: true, messageId: calls.length, result: { n: calls.length } } },
      sleep: async (ms) => events.push(['sleep', ms]),
      onPartSent: (part) => events.push(['sent', part]),
      onPartFailed: (part) => events.push(['failed', part]),
    },
  }
}

test('executor: exact calls, synchronous callbacks, between-part delays and final result', async () => {
  const h = recorder()
  assert.deepEqual(await executeDeliveryPlan(h.options), { ok: true, status: 'sent', messageId: '1', result: { n: 3 }, parts: 3 })
  assert.deepEqual(h.calls, plan().parts.map((part, index) => ({ chatType: 'group', chatId: 'g1', segments: part.segments, decisionId: index ? '' : 'd1', source: 'pipeline', dryRun: null })))
  assert.deepEqual(h.events, [
    ['deliver', 0], ['sent', { messageId: '1', index: 0, parts: 3 }], ['sleep', 19],
    ['deliver', 1], ['sent', { messageId: '2', index: 1, parts: 3 }], ['sleep', 19],
    ['deliver', 2], ['sent', { messageId: '3', index: 2, parts: 3 }],
  ])
})

test('executor: first failure has exact error/blocked/reason and never retries a rejection', async () => {
  for (const failure of [{ ok: false, error: 'ACCESS_DENIED', blocked: true, reason: 'denied' }, { ok: false }, {}]) {
    const h = recorder([failure])
    let fallbackCalls = 0
    assert.deepEqual(await executeDeliveryPlan({ ...h.options, fallbackDeliver: () => { fallbackCalls++ } }), { ok: false, status: 'failed', error: failure.error || 'SEND_FAILED', blocked: Boolean(failure.blocked), reason: failure.reason || '', parts: 0 })
    assert.equal(fallbackCalls, 0)
    assert.equal(h.calls.length, 1)
    assert.deepEqual(h.events, [['deliver', 0], ['failed', { delivered: failure, index: 0, parts: 3 }]])
  }
})

test('executor: partial failure stops with prior sends and last successful result', async () => {
  const failure = { ok: false, error: 'RATE_LIMITED' }
  const successes = [{ ok: true, messageId: 'first', result: 'first-result' }, { ok: true, messageId: 'second', result: 'second-result' }]
  for (const sentParts of [1, 2]) {
    const h = recorder([...successes.slice(0, sentParts), failure])
    assert.deepEqual(await executeDeliveryPlan(h.options), {
      ok: true, status: 'partial', partial: true, sentParts, failedPart: sentParts, error: 'PARTIAL_SEND',
      messageId: 'first', result: successes[sentParts - 1].result, parts: sentParts,
    })
    assert.equal(h.calls.length, sentParts + 1)
    assert.deepEqual(h.events.at(-1), ['failed', { delivered: failure, index: sentParts, parts: 3 }])
    assert.equal(h.events.filter(([kind]) => kind === 'sent').length, sentParts)
    assert.equal(h.events.filter(([kind]) => kind === 'sleep').length, sentParts)
  }
})

test('executor: first/later dryRun stops without sent/failed callback for simulated part', async () => {
  const dry = { ok: true, dryRun: true, messageId: '' }
  const first = recorder([dry])
  assert.deepEqual(await executeDeliveryPlan({ ...first.options, dryRun: true }), { ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 })
  assert.deepEqual(first.events, [['deliver', 0]])
  assert.equal(first.calls[0].dryRun, true)
  const later = recorder([{ ok: true, messageId: 'm1', result: 1 }, dry])
  assert.deepEqual(await executeDeliveryPlan({ ...later.options, dryRun: () => later.calls.length ? true : null }), { ok: true, status: 'dry_run', messageId: 'm1', result: 1, parts: 1 })
  assert.deepEqual(later.calls.map((call) => call.dryRun), [null, true])
  assert.deepEqual(later.events, [['deliver', 0], ['sent', { messageId: 'm1', index: 0, parts: 3 }], ['sleep', 19], ['deliver', 1]])
})

test('executor: invalid/throwing planner falls back once through the same delivery function', async () => {
  for (const invalid of [null, {}, { ...plan(), parts: [] }, () => { throw new Error('secret must not escape') }]) {
    const h = recorder()
    assert.deepEqual(await executeDeliveryPlan({ ...h.options, plan: invalid, text: context.text, turn, decisionId: 'fallback-id', source: 'fallback-source' }), { ok: true, status: 'sent', messageId: '1', result: { n: 1 }, parts: 1 })
    assert.deepEqual(h.calls, [{ chatType: 'group', chatId: 'g1', segments: [textSegment(context.text)], decisionId: 'fallback-id', source: 'fallback-source', dryRun: null }])
    assert.deepEqual(h.events, [['deliver', 0], ['sent', { messageId: '1', index: 0, parts: 1 }]])
    for (const text of ['', ' ']) {
      const empty = recorder()
      assert.deepEqual(await executeDeliveryPlan({ ...empty.options, plan: invalid, text, turn }), { ok: false, status: 'empty', error: 'EMPTY_MESSAGE', parts: 0 })
      assert.deepEqual(empty.calls, [])
    }
  }
  const invalidTarget = recorder()
  assert.deepEqual(await executeDeliveryPlan({ ...invalidTarget.options, plan: null, text: 'hi', turn: {} }), { ok: false, status: 'empty', error: 'EMPTY_MESSAGE', parts: 0 })
  assert.deepEqual(invalidTarget.calls, [])
})

test('executor: missing primary uses legacy transport; missing both fails; transport exceptions propagate', async () => {
  const h = recorder()
  assert.equal((await executeDeliveryPlan({ ...h.options, deliver: null, fallbackDeliver: h.options.deliver })).parts, 3)
  assert.equal(h.calls.length, 3)
  assert.deepEqual(await executeDeliveryPlan({ plan: plan() }), { ok: false, status: 'failed', error: 'GATEWAY_UNAVAILABLE', blocked: false, reason: '', parts: 0 })
  await assert.rejects(executeDeliveryPlan({ plan: plan(), deliver: () => { throw new Error('transport') } }), /transport/)
})

test('executor: zero delays never sleep; empty first ID uses next nonempty ID', async () => {
  const h = recorder([{ ok: true, messageId: '' }, { ok: true, messageId: 'next' }])
  const zeroDelay = buildReplyPlan({ ...context, replyCfg: { ...context.replyCfg, delayMs: 0 } })
  assert.equal((await executeDeliveryPlan({ ...h.options, plan: () => zeroDelay })).messageId, 'next')
  assert.equal(h.events.some(([kind]) => kind === 'sleep'), false)
})

test('executor: content-free observer boundary never receives raw result, text, targets or error reason', async () => {
  const calls = []
  const observer = { beginDelivery(...args) { calls.push(args); return {} }, finishDelivery(...args) { calls.push(args) } }
  await executeDeliveryPlan({ observer, text: 'PRIVATE_BODY', turn: { chatType: 'private', chatId: 'PRIVATE_TARGET' },
    plan: { target: { chatType: 'private', chatId: 'PRIVATE_TARGET' }, parts: [{ segments: [{ type: 'text', data: { text: 'PRIVATE_BODY' } }], delayAfterMs: 0 }] },
    deliver: async () => ({ ok: false, error: 'PRIVATE_ERROR', reason: 'PRIVATE_REASON', result: { raw: 'PRIVATE_RAW' } }),
  })
  assert.doesNotMatch(JSON.stringify(calls), /PRIVATE_/)
  assert.equal(calls[1][1].errorCode, 'SEND_FAILED')
})
