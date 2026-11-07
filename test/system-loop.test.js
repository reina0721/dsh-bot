import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../src/cognition/store.js'
import { scopedPersonaKind, dropPersonaData } from '../src/cognition/persona-scope.js'
import { createLoopObserver, deliveryObservation, LOOP_LIMITS } from '../src/observability/loop.js'
import { executeDeliveryPlan } from '../src/delivery/executor.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createOutbound } from '../src/cognition/outbound.js'
import { loopHarness } from './helpers/loop.js'

const target = { chatType: 'private', chatId: '123456' }
const plan = { target, source: 'pipeline', decisionId: 'decision_1', parts: [1, 2, 3].map(() => ({ segments: [{ type: 'text', data: { text: 'PRIVATE_BODY' } }], delayAfterMs: 0 })) }
const sent = { ok: true, messageId: 'PLATFORM_MESSAGE', result: { raw: 'RAW_SECRET' } }

test('loop schema bounds and content-free whitelist; handles are opaque and persona bound', t => {
  const h = loopHarness(t)
  assert.equal(h.observer.begin({ turnId: 'turn_1', text: 'PRIVATE_BODY' }), null)
  const loop = h.observer.begin({ turnId: 'turn_1' })
  assert.deepEqual(loop, {})
  for (let i = 0; i < 30; i++) h.observer.recordStage(loop, 'decided', { decisionId: 'decision_1', unknownRefs: Array.from({ length: 30 }, (_, n) => `unknown_${n}`) })
  h.observer.recordStage(loop, 'PRIVATE_BODY')
  for (let i = 0; i < 30; i++) {
    const attempt = h.observer.beginDelivery(loop)
    assert.equal(h.observer.finishDelivery(attempt, { ...deliveryObservation({ status: 'sent', parts: 1 }), raw: 'RAW_SECRET' }), null)
    h.observer.finishDelivery(attempt, deliveryObservation({ status: 'sent', parts: 1 }))
    h.observer.finishDelivery(attempt, deliveryObservation({ status: 'failed', parts: 0 }))
  }
  h.observer.finishLoop(loop, { reasonCode: 'PRIVATE_REASON' })
  const [row] = h.loops()
  assert.equal(row.stages.length, 16)
  assert.equal(row.receiptRefs.length, 16)
  assert.equal(row.unknownRefs.length, 4)
  assert.equal(row.reasonCode, null)
  assert.equal(row.firstDetectedTurnId, null)
  assert.equal(row.taskId, null)
  assert.equal(h.receipts().length, 16)
  for (const record of [row, ...h.receipts()]) {
    assert.ok(Buffer.byteLength(JSON.stringify(record)) <= 8192)
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE_|PLATFORM_MESSAGE|RAW_SECRET|chatId|senderId|messageId|summary/)
  }
  const before = h.loops()
  h.observer.recordStage({}, 'generating')
  h.observer.beginDelivery(loop)
  assert.deepEqual(h.loops(), before)
})

for (const [name, responses, expected] of [
  ['success', [sent, sent, sent], { status: 'sent', parts: 3, failedPart: null, errorCode: null }],
  ['partial', [sent, { ok: false, error: 'ACCESS_DENIED', reason: 'PRIVATE_REASON' }], { status: 'partial', parts: 1, failedPart: 1, errorCode: 'PARTIAL_SEND' }],
  ['third-part failure', [sent, sent, { ok: false }], { status: 'partial', parts: 2, failedPart: 2, errorCode: 'PARTIAL_SEND' }],
  ['failure', [{ ok: false, error: 'PRIVATE_ERROR' }], { status: 'failed', parts: 0, failedPart: null, errorCode: 'SEND_FAILED' }],
  ['dry run', [{ ok: true, dryRun: true }], { status: 'dry_run', parts: 0, failedPart: null, errorCode: null }],
  ['later dry run', [sent, { ok: true, dryRun: true }], { status: 'dry_run', parts: 1, failedPart: null, errorCode: null }],
]) test(`loop receipt: ${name} preserves ADR-006 and one final record`, async t => {
  const h = loopHarness(t), loop = h.observer.begin({ turnId: 'turn_1' })
  h.observer.recordStage(loop, 'decided', { decisionId: 'decision_1' })
  let calls = 0
  const result = await executeDeliveryPlan({ observer: h.observer, loop, plan, deliver: async () => responses[calls++] })
  assert.equal(calls, responses.length)
  assert.equal(result.ok, !['failed', 'empty'].includes(expected.status))
  assert.deepEqual(h.receipts()[0].data, expected)
  assert.equal(h.receipts().length, 1)
  assert.equal(h.receipts()[0].decisionId, 'decision_1')
  assert.equal(h.receipts()[0].turnId, 'turn_1')
  assert.doesNotMatch(JSON.stringify(h.receipts()), /PRIVATE_|PLATFORM_MESSAGE|RAW_SECRET/)
})

test('executor -> outbound and DeliveryService share one owner; direct outbound has only an attempt', async t => {
  const h = loopHarness(t)
  let sends = 0
  const outbound = createOutbound({ observer: h.observer, gateway: { actions: { sendMessage: async () => { sends++; return { message_id: 'PLATFORM_MESSAGE' } } } } })
  const result = await executeDeliveryPlan({ observer: h.observer, plan, deliver: outbound.deliver })
  assert.equal(result.parts, 3)
  assert.equal(h.receipts().length, 1)
  assert.equal(h.receipts()[0].data.parts, 3)
  await createDeliveryService({ outbound }).deliver({ ...target, text: 'PRIVATE_BODY', moduleId: 'builtin-reminders', runtimeGeneration: 'generation_1' })
  assert.equal(h.receipts().length, 2)
  assert.equal(h.receipts().find(row => row.moduleId === 'builtin-reminders').runtimeGeneration, 'generation_1')
  await outbound.deliver({ ...target, segments: 'PRIVATE_BODY' })
  assert.equal(h.receipts().length, 3)
  assert.equal(h.loops().length, 0)
  assert.ok(h.receipts().every(row => row.loopId === null && row.turnId === null))
  assert.equal(sends, 5)
})

test('transport and callback throws finalize unknown receipt, preserve original exception, and never retry', async t => {
  const h = loopHarness(t)
  for (const where of ['transport', 'sent', 'failed', 'sleep', 'planner-callback']) {
    const error = Error('RAW_SECRET'), loop = h.observer.begin()
    let calls = 0
    const options = { observer: h.observer, loop, plan, deliver: async () => { calls++; if (where === 'transport') throw error; return where === 'failed' ? { ok: false } : sent } }
    if (where === 'sent') options.onPartSent = () => { throw error }
    if (where === 'failed') options.onPartFailed = () => { throw error }
    if (where === 'sleep') { options.plan = { ...plan, parts: plan.parts.map(part => ({ ...part, delayAfterMs: 1 })) }; options.sleep = () => { throw error } }
    if (where === 'planner-callback') { options.plan = null; options.onPlanFallback = () => { throw error } }
    await assert.rejects(executeDeliveryPlan(options), value => value === error)
    assert.equal(calls, where === 'planner-callback' ? 0 : 1)
    const row = h.receipts().at(-1)
    assert.equal(row.status, 'interrupted')
    assert.equal(row.reasonCode, 'EXECUTION_THROW')
    assert.equal(row.data, null, 'unknown cannot claim zero actual sends')
  }
})

test('observer failures do not alter returned delivery, exception identity or send count', async t => {
  const h = loopHarness(t)
  const broken = { beginDelivery() { throw Error('observer') }, finishDelivery() { throw Error('observer') } }
  for (const observer of [broken, h.observer]) {
    const put = h.base.put
    if (observer === h.observer) h.base.put = () => { throw Error('disk full') }
    let calls = 0
    const outbound = createOutbound({ observer, gateway: { actions: { sendMessage: async () => { calls++; return { message_id: 'm' } } } } })
    const result = await createDeliveryService({ outbound }).deliver({ ...target, text: 'PRIVATE_BODY' })
    assert.equal(result.status, 'sent')
    assert.equal(result.parts, 1)
    assert.equal(calls, 1)
    const error = Error('transport')
    await assert.rejects(executeDeliveryPlan({ observer, plan, deliver: () => { throw error } }), value => value === error)
    h.base.put = put
  }
})

test('in-flight delivery finishes in captured persona, even after switch; deletion prevents resurrection', async t => {
  const h = loopHarness(t)
  let release
  const outbound = createOutbound({ observer: h.observer, gateway: { actions: { sendMessage: () => new Promise(resolve => { release = resolve }) } } })
  const service = createDeliveryService({ outbound })
  const loop = h.observer.begin({ turnId: 'turn_1' })
  const flight = service.deliver({ ...target, text: 'PRIVATE_BODY', loop })
  h.switchPersona('other')
  release({ message_id: 'm' })
  assert.equal((await flight).status, 'sent')
  h.observer.finishLoop(loop)
  assert.equal(h.receipts('self')[0].data.parts, 1)
  assert.equal(h.loops('self')[0].status, 'completed')
  assert.equal(h.receipts('other').length, 0)
  const second = service.deliver({ ...target, text: 'PRIVATE_BODY' })
  dropPersonaData({ base: h.base, personaId: 'other' })
  h.base.remove('persona', 'other')
  release({ message_id: 'm2' })
  assert.equal((await second).status, 'sent')
  assert.equal(h.receipts('other').length, 0)
})

test('7-day retention uses original creation, evicts groups and never recreates a live expired parent', t => {
  const h = loopHarness(t), loop = h.observer.begin()
  const attempt = h.observer.beginDelivery(loop)
  h.base.put(scopedPersonaKind('self', 'decision'), 'historical', { status: 'sent' })
  h.advance(LOOP_LIMITS.retentionMs - 1)
  h.observer.recordStage(loop, 'generating')
  assert.equal(h.loops().length, 1)
  h.advance(2)
  h.observer.finishDelivery(attempt, deliveryObservation({ status: 'sent', parts: 1 }))
  assert.equal(h.loops().length, 0)
  assert.equal(h.receipts().length, 0)
  assert.equal(h.observer.beginDelivery(loop), null)
  assert.equal(h.base.get(scopedPersonaKind('self', 'decision'), 'historical').status, 'sent')
})

test('startup and writes enforce 5000 combined records per persona with no orphan receipts', t => {
  const h = loopHarness(t)
  for (let n = 0; n < 2501; n++) {
    h.base.put(scopedPersonaKind('self', 'loop_run'), `loop_${n}`, { version: 1, personaId: 'self', loopKind: 'social', status: 'completed', startedAt: h.clock.now() + n, stages: [], receiptRefs: [`receipt_${n}`] })
    h.base.put(scopedPersonaKind('self', 'delivery_receipt'), `receipt_${n}`, { version: 1, personaId: 'self', loopId: `loop_${n}`, receiptKind: 'delivery', status: 'completed', recordedAt: h.clock.now() + n, data: null })
  }
  const observer = createLoopObserver({ base: h.base, clock: h.clock })
  assert.equal(h.loops().length + h.receipts().length, 5000)
  const loop = observer.begin()
  observer.beginDelivery(loop)
  assert.ok(h.loops().length + h.receipts().length <= 5000)
  const parents = new Set(h.loops().map(row => row.id))
  assert.ok(h.receipts().every(row => parents.has(row.loopId)))
  h.switchPersona('other')
  h.observer.begin()
  assert.equal(h.loops().length, 1)
})

test('real restart interrupts unfinished records for all personas without sends, replay or historical backfill', t => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-loop-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const clock = { now: () => 1000000 }, file = join(root, 'store.sqlite')
  let base = createStore({ file, clock }), personaId = 'self'
  for (const key of ['self', 'other']) base.put('persona', key, {})
  const observer = createLoopObserver({ base, getPersonaId: () => personaId, clock })
  const loop = observer.begin({ turnId: 'turn_1' })
  observer.beginDelivery(loop)
  const done = observer.beginDelivery(loop)
  observer.finishDelivery(done, deliveryObservation({ status: 'sent', parts: 2 }))
  personaId = 'other'
  observer.beginDelivery()
  base.put(scopedPersonaKind('other', 'decision'), 'old_sent', { status: 'sent' })
  base.close()
  base = createStore({ file, clock })
  t.after(() => base.close())
  createLoopObserver({ base, clock })
  const rows = name => base.list(scopedPersonaKind('self', name))
  assert.equal(rows('loop_run')[0].status, 'interrupted')
  assert.equal(rows('loop_run')[0].stage, 'closed')
  assert.equal(rows('loop_run')[0].reasonCode, 'PROCESS_RESTART')
  const receipts = rows('delivery_receipt')
  assert.equal(receipts.length, 2)
  assert.equal(receipts.find(row => row.status === 'interrupted').data, null)
  assert.equal(receipts.find(row => row.status === 'completed').data.parts, 2)
  const other = base.list(scopedPersonaKind('other', 'delivery_receipt'))
  assert.equal(other.length, 1)
  assert.equal(other[0].reasonCode, 'PROCESS_RESTART')
  assert.equal(other[0].decisionId, null)
  createLoopObserver({ base, clock })
  assert.equal(rows('delivery_receipt').length, 2)
})

test('receipt occurrence/write timestamps follow completion; finalization cannot renew initial retention', t => {
  const h = loopHarness(t)
  const attempt = h.observer.beginDelivery()
  const started = h.clock.now()
  h.advance(1000)
  h.observer.finishDelivery(attempt, deliveryObservation({ status: 'sent', parts: 1 }))
  const row = h.receipts()[0]
  assert.equal(row.occurredAt, h.clock.now())
  assert.equal(row.recordedAt, h.clock.now())
  assert.equal(row.createdAt, started)
  h.advance(LOOP_LIMITS.retentionMs - 999)
  h.observer.begin()
  assert.equal(h.receipts().length, 0)
})

test('receipt disk failure after I/O preserves send success, leaves unknown, and never resends', async t => {
  const h = loopHarness(t)
  const put = h.base.put
  let sends = 0
  const outbound = createOutbound({ observer: h.observer, gateway: { actions: { async sendMessage() {
    sends++
    h.base.put = () => { throw Error('disk full PRIVATE_ERROR') }
    return { message_id: 'PRIVATE_MESSAGE' }
  } } } })
  const result = await createDeliveryService({ outbound }).deliver({ ...target, text: 'PRIVATE_BODY' })
  assert.equal(result.status, 'sent')
  assert.equal(result.parts, 1)
  assert.equal(sends, 1)
  assert.equal(h.receipts()[0].status, 'running')
  assert.equal(h.receipts()[0].data, null)
  h.base.put = put
  createLoopObserver({ base: h.base, clock: h.clock })
  assert.equal(h.receipts()[0].status, 'interrupted')
  assert.equal(sends, 1)
})

test('invalid delivery data cannot become a zero-send receipt', t => {
  const h = loopHarness(t)
  const attempt = h.observer.beginDelivery()
  for (const parts of [-1, 1.2, Infinity, Number.MAX_SAFE_INTEGER + 1, {}, '1']) {
    assert.equal(deliveryObservation({ status: 'sent', parts }), null)
    assert.equal(h.observer.finishDelivery(attempt, { status: 'sent', parts, failedPart: null, errorCode: null }), null)
  }
  assert.equal(h.receipts()[0].data, null)
  h.observer.finishDelivery(attempt, deliveryObservation({ status: 'sent', parts: 1 }))
  assert.equal(h.receipts()[0].data.parts, 1)
})

test('a switch before later stages cannot attach another persona decision/unknown to the captured loop', async t => {
  const h = loopHarness(t)
  const loop = h.observer.begin({ turnId: 'turn_self' })
  h.switchPersona('other')
  h.observer.recordStage(loop, 'decided', { decisionId: 'decision_other', unknownRefs: ['unknown_other'] })
  let sends = 0
  await executeDeliveryPlan({ observer: h.observer, loop, decisionId: 'decision_other', plan,
    deliver: async () => { sends++; return sent },
  })
  h.observer.finishLoop(loop)
  assert.equal(sends, 3)
  assert.equal(h.loops('self')[0].decisionId, null)
  assert.deepEqual(h.loops('self')[0].unknownRefs, [])
  assert.equal(h.receipts('self')[0].decisionId, null)
  assert.equal(h.receipts('self')[0].turnId, 'turn_self')
  assert.equal(h.receipts('other').length, 0)
})
