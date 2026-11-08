import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDeliveryRegistry } from '../src/delivery/registry.js'
import { buildReplyPlan, validateDeliveryPlan } from '../src/delivery/plan.js'
import { setup } from '../src/modules/builtin/reply-delivery.js'

const descriptor = { id: 'test', stage: 'format', order: 1, plan: () => ({}) }

test('delivery registry: one format stage, unique IDs, validated descriptors and immutable records', () => {
  const registry = createDeliveryRegistry()
  assert.equal(registry.resolve(), null)
  for (const invalid of [null, {}, { ...descriptor, id: ' ' }, { ...descriptor, stage: 'send' }, { ...descriptor, plan: null }, { ...descriptor, order: Infinity }, { ...descriptor, order: '1' }]) {
    assert.throws(() => registry.register(invalid))
    assert.deepEqual(registry.list(), [])
  }
  const input = { ...descriptor }
  registry.register(input)
  assert.throws(() => registry.register(descriptor), /id 重复/)
  assert.throws(() => registry.register({ ...descriptor, id: 'other' }), /stage 已注册/)
  input.id = 'changed'
  assert.deepEqual(registry.resolve('format'), descriptor)
  assert.equal(registry.resolve('unknown'), null)
  assert.throws(() => { registry.resolve().plan = null }, TypeError)
  registry.list().pop()
  assert.equal(registry.list().length, 1)
  assert.equal(registry.remove('absent'), false)
  assert.equal(registry.remove('test'), true)
  assert.equal(registry.resolve(), null)
})

test('delivery registry: disposer is idempotent and cannot remove a replacement', () => {
  const registry = createDeliveryRegistry()
  const dispose = registry.register(descriptor)
  assert.equal(dispose(), true)
  registry.register(descriptor)
  dispose()
  assert.equal(registry.resolve().id, 'test')
  registry.remove('test')
  registry.register({ ...descriptor, order: undefined })
  assert.equal(registry.resolve().order, 0)
})

test('builtin reply delivery: registered planner preserves Phase 1 layout and compatibility facade', () => {
  const registry = createDeliveryRegistry()
  setup({ delivery: { registerPlanner: registry.register } })
  const planner = registry.resolve('format')
  assert.equal(planner.id, 'builtin-reply-delivery')
  const turn = { chatType: 'group', chatId: 'g1', senderId: 'u1', messages: [{ messageId: 'last' }] }
  for (const replyCfg of [{}, { split: false }, { quote: false }, { atSender: true, maxChars: 40, maxParts: 2, delayMs: 25 }]) {
    const ctx = { text: '<bubble>' + '字'.repeat(40) + '</bubble><bubble>' + '字'.repeat(90) + '</bubble>', turn, replyCfg, replyTo: 'explicit', source: 'pipeline', decisionId: 'd1' }
    const before = structuredClone(ctx)
    const plan = planner.plan(ctx)
    assert.equal(validateDeliveryPlan(plan), true)
    assert.deepEqual(plan, buildReplyPlan(ctx))
    assert.deepEqual(ctx, before)
    assert.equal(plan.parts.map(part => part.segments.at(-1).data.text).join('').replace(/\s/g, ''), '字'.repeat(130))
    assert.equal(plan.parts[0].segments.some(s => s.type === 'reply'), replyCfg.quote !== false)
    if (replyCfg.atSender) {
      assert.deepEqual(plan.parts.map(part => part.delayAfterMs), [25, 0])
      assert.deepEqual(plan.parts.map(part => part.segments.at(-1).data.text.length), [40, 90])
      assert.deepEqual(plan.parts[0].segments.slice(0, 2), [{ type: 'reply', data: { id: 'explicit' } }, { type: 'at', data: { qq: 'u1' } }])
      assert.equal(plan.parts[1].segments.length, 1)
    }
    if (replyCfg.split === false) assert.equal(plan.parts.length, 1)
  }
})
