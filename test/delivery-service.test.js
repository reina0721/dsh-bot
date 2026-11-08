import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createDeliveryService } from '../src/delivery/service.js'
import { createOutbound } from '../src/cognition/outbound.js'

const target = { chatType: 'private', chatId: '10001' }

test('delivery service: one text part preserves payload, attribution and outbound result', async () => {
  const calls = []
  const raw = { message_id: 'm1' }
  const service = createDeliveryService({
    outbound: { async deliver(intent) { calls.push(intent); return { ok: true, messageId: 'm1', result: raw, source: intent.source } } },
    sleep() { assert.fail('single-part intents must not wait') },
  })
  const text = '  一条文本\n' + '长'.repeat(5000)
  assert.deepEqual(await service.deliver({ ...target, text, source: 'command', decisionId: 'd1' }), {
    ok: true, status: 'sent', messageId: 'm1', result: raw, source: 'command', parts: 1,
  })
  assert.deepEqual(calls, [{ ...target, segments: [{ type: 'text', data: { text } }], source: 'command', decisionId: 'd1', dryRun: null }])
})

test('delivery service: supplied segments take precedence without quote/@/splitting', async () => {
  const segments = [{ type: 'text', data: { text: 'hello' } }, { type: 'face', data: { id: '1' } }]
  const service = createDeliveryService({ outbound: { async deliver(intent) {
    assert.equal(intent.segments, segments)
    assert.equal(intent.source, 'pipeline')
    assert.equal(intent.decisionId, '')
    return { ok: true, messageId: '2' }
  } } })
  assert.equal((await service.deliver({ ...target, segments, text: 'ignored' })).parts, 1)
})

test('delivery service: real outbound owns dryRun and first-part decision attribution', async () => {
  const marked = []
  const outbound = createOutbound({
    getConfig: () => ({ cognition: { dryRun: true } }),
    gateway: { actions: { sendMessage() { assert.fail('dryRun must not send') } } },
    policy: { markSent(...args) { marked.push(args) } },
  })
  const result = await createDeliveryService({ outbound }).deliver({ ...target, text: 'hello', decisionId: 'd1' })
  assert.deepEqual(result, { ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 })
  assert.deepEqual(marked, [['d1', { dryRun: true }]])
})

test('delivery service: explicit dryRun true and false reach outbound unchanged', async () => {
  for (const dryRun of [true, false]) {
    const service = createDeliveryService({ outbound: { async deliver(intent) {
      assert.equal(intent.dryRun, dryRun)
      return dryRun ? { ok: true, dryRun: true, messageId: '' } : { ok: true, messageId: 'm' }
    } } })
    const result = await service.deliver({ ...target, text: 'hello', dryRun })
    assert.equal(result.parts, dryRun ? 0 : 1)
    assert.equal(result.status, dryRun ? 'dry_run' : 'sent')
  }
})

test('delivery service: empty or invalid supplied segments never recover using text', async () => {
  const service = createDeliveryService({ outbound: { deliver() { assert.fail('empty intent must not send') } } })
  for (const body of [{}, { text: ' \n' }, { segments: [], text: 'ignored' }, { segments: null }, { segments: [{ type: 'text', data: { text: '' } }] }]) {
    assert.deepEqual(await service.deliver({ ...target, ...body }), { ok: false, status: 'empty', error: 'EMPTY_MESSAGE', parts: 0 })
  }
})

test('delivery service: outbound rejection is final, preserves reason and never uses gateway', async () => {
  let calls = 0
  const rejected = { ok: false, blocked: true, error: 'ACCESS_DENIED', reason: 'not_allowed' }
  const service = createDeliveryService({
    outbound: { async deliver() { calls++; return rejected } },
    gateway: { actions: { sendMessage() { assert.fail('must not bypass outbound') } } },
  })
  assert.deepEqual(await service.deliver({ ...target, text: 'hello' }), { ...rejected, status: 'failed', parts: 0 })
  assert.equal(calls, 1)
  const unavailable = createDeliveryService({ gateway: { actions: { sendMessage() { assert.fail('must not fall back') } } } })
  assert.deepEqual(await unavailable.deliver({ ...target, text: 'hello' }), { ok: false, status: 'failed', error: 'OUTBOUND_UNAVAILABLE', parts: 0 })
})

test('delivery service: failed send counts zero and retains outbound result fields', async () => {
  const rejected = { ok: false, error: 'SEND_FAILED', blocked: false, reason: 'transport', messageId: '', result: { retcode: 100 }, dryRun: false }
  for (const response of [rejected, { ok: false }, null]) {
    let calls = 0
    const service = createDeliveryService({ outbound: { async deliver() { calls++; return response } } })
    assert.deepEqual(await service.deliver({ ...target, text: 'hello' }), {
      ...response, ok: false, status: 'failed', error: response?.error || 'SEND_FAILED',
      blocked: Boolean(response?.blocked), reason: response?.reason || '', parts: 0,
    })
    assert.equal(calls, 1)
  }
})

test('delivery service: invalid target reports failed with zero parts before outbound', async () => {
  const service = createDeliveryService({ outbound: { deliver() { assert.fail('invalid target must not send') } } })
  for (const invalid of [{}, { chatType: 'other', chatId: '1' }, { ...target, chatId: ' ' }]) {
    assert.deepEqual(await service.deliver({ ...invalid, text: 'hello' }), { ok: false, status: 'failed', error: 'INVALID_TARGET', parts: 0 })
  }
})

test('delivery service: production wiring injects the shared service into every Phase 5 producer', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
  const cognition = read('../src/cognition/index.js')
  assert.match(cognition, /state\.services\.delivery = createDeliveryService\(\{ outbound: state\.services\.outbound \}\)/)
  for (const factory of ['createAgentRuntime', 'createCommandService']) {
    assert.match(cognition, new RegExp(`${factory}\\(\\{\\s*delivery: state\\.services\\.delivery,`))
  }
  assert.doesNotMatch(cognition, /createProactivityService|services\.proactivity\.start/)
  assert.match(read('../src/modules/kernel.js'), /createProactivityPort\(\{[\s\S]*?delivery, outbound/)
  assert.match(read('../src/host.js'), /assembleServices\(/)
  assert.match(read('../src/services/assembly.js'), /delivery: cognition\.services\.delivery/)
  assert.match(read('../src/runtime/agent.js'), /createQqTools\(\{[^\n]*\bdelivery\b/)
  const service = read('../src/delivery/service.js')
  assert.match(service, /executeDeliveryPlan\(/)
  assert.doesNotMatch(service, /gateway|fallbackDeliver|sendMessage/)
})

test('DeliveryService: every preflight rejection uses executor-owned receipt without touching outbound', async t => {
  const { loopHarness } = await import('./helpers/loop.js')
  const h = loopHarness(t)
  const service = createDeliveryService({ observer: h.observer, outbound: { deliver() { assert.fail('preflight must not send') } } })
  for (const [input, status, code] of [
    [{ text: 'hello' }, 'failed', 'INVALID_TARGET'],
    [{ ...target }, 'empty', 'EMPTY_MESSAGE'],
    [{ ...target, segments: null }, 'empty', 'EMPTY_MESSAGE'],
  ]) {
    h.advance(1)
    const result = await service.deliver(input)
    const row = h.receipts().find(row => row.recordedAt === h.clock.now())
    assert.equal(row.data.status, status)
    assert.equal(row.data.errorCode, code)
    assert.equal(result.parts, 0)
  }
  h.advance(1)
  await createDeliveryService({ observer: h.observer }).deliver({ ...target, text: 'hello' })
  assert.equal(h.receipts().length, 4)
  assert.ok(h.receipts().some(row => row.data.errorCode === 'OUTBOUND_UNAVAILABLE'))
})
