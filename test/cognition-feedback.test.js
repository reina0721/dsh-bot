import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loopHarness } from './helpers/loop.js'
import { createPolicyService, inferReward } from '../src/cognition/policy.js'
import { createPersonaScopedStore } from '../src/cognition/persona-scope.js'
import { LOOP_LIMITS } from '../src/observability/loop.js'

function feedbackHarness(t) {
  const h = loopHarness(t)
  let personaId = 'self'
  const store = createPersonaScopedStore({ base: h.base, getPersonaId: () => personaId })
  const policy = createPolicyService({ store, observer: h.observer, clock: h.clock, getConfig: () => ({}) })
  function seed(status = 'sent', parts = 1) {
    store.put('decision', 'd', { action: 'reply', contextKey: 'bucket', status: 'sent' })
    const loop = h.observer.begin({ turnId: 'turn_1' })
    h.observer.recordStage(loop, 'decided', { decisionId: 'd' })
    const attempt = h.observer.beginDelivery(loop)
    if (status !== 'unknown') h.observer.finishDelivery(attempt, { status, parts, failedPart: null, errorCode: null })
    h.observer.finishLoop(loop)
  }
  return { ...h, store, policy, seed, switchPersona(id) { h.switchPersona(id); personaId = id } }
}
const incoming = { source: 'incoming', dedupeKey: 'turn_2' }

test('feedback provenance, bounded observations and durable event dedupe; policy algorithm unchanged', t => {
  const h = feedbackHarness(t); h.seed('partial', 1)
  const first = h.policy.recordOutcome('d', { userContinued: true, sentiment: 99, attribution: 'direct', attributionConfidence: 2 }, incoming)
  assert.equal(first.source, 'incoming'); assert.equal(first.attribution, 'heuristic')
  assert.equal(first.attributionConfidence, 1); assert.equal(first.observed.sentiment, 1)
  assert.equal(first.reward, inferReward(first.observed))
  assert.deepEqual(first.policyBefore, { alpha: 1, beta: 1, trials: 0, rewardSum: 0 })
  assert.deepEqual(first.policyAfter, { alpha: 2, beta: 1, trials: 1, rewardSum: 0.5 })
  assert.deepEqual(h.policy.recordOutcome('d', { explicitCorrection: true }, incoming), h.store.get('outcome', first.id))
  assert.equal(h.store.count('outcome'), 1); assert.equal(h.store.list('policy')[0].trials, 1)
  assert.equal(h.receipts().filter(row => row.receiptKind === 'feedback').length, 1)
  h.advance(LOOP_LIMITS.retentionMs + 1); h.observer.begin()
  assert.deepEqual(h.policy.recordOutcome('d', {}, incoming), h.store.get('outcome', first.id))
  assert.throws(() => h.policy.recordOutcome('d', {}, { ...incoming, dedupeKey: 'turn_3' }), /DELIVERY_UNOBSERVED/)
  assert.equal(h.store.list('policy')[0].trials, 1)
})

test('manual corrections use requestId identity, unknown source stays explicit, cross-persona never learns', t => {
  const h = feedbackHarness(t); h.seed()
  assert.throws(() => h.policy.recordOutcome('d', {}, { source: 'manual' }), /QUERY_INVALID/)
  const first = h.policy.recordOutcome('d', { explicitCorrection: true, attribution: 'direct' }, { source: 'manual', dedupeKey: 'request_1' })
  const second = h.policy.recordOutcome('d', { positiveReaction: true }, { source: 'manual', dedupeKey: 'request_2' })
  assert.equal(first.policyAfter.trials, 1); assert.equal(second.policyBefore.trials, 1)
  assert.equal(second.policyAfter.trials, 2)
  const unknown = h.policy.recordOutcome('d', {}, { dedupeKey: 'legacy_import' })
  assert.equal(unknown.source, 'unknown')
  h.switchPersona('other')
  h.store.put('decision', 'd', { action: 'reply', contextKey: 'bucket', status: 'sent' })
  assert.throws(() => h.policy.recordOutcome('d', {}, incoming), /DELIVERY_UNOBSERVED/)
  assert.equal(h.store.count('outcome'), 0); assert.equal(h.store.count('policy'), 0)
})

test('outcome/decision/policy/feedback receipt rollback together for every write failure', t => {
  for (const failKind of ['outcome', 'decision', 'policy', 'delivery_receipt', 'loop_run']) {
    const h = feedbackHarness(t); h.seed()
    const put = h.base.put
    h.base.put = (kind, ...args) => { if (kind.endsWith(':' + failKind)) throw Error('DISK_PRIVATE_SECRET'); return put(kind, ...args) }
    assert.throws(() => h.policy.recordOutcome('d', { positiveReaction: true }, incoming), /FEEDBACK_COMMIT_FAILED/)
    h.base.put = put
    assert.equal(h.store.count('outcome'), 0); assert.equal(h.store.count('policy'), 0)
    assert.equal(h.store.get('decision', 'd').status, 'sent')
    assert.equal(h.receipts().length, 1)
    assert.equal(h.loops()[0].receiptRefs.length, 1)
    assert.equal(h.observer.failures().feedback, 1)
    const outcome = h.policy.recordOutcome('d', { positiveReaction: true }, incoming)
    assert.equal(outcome.policyAfter.trials, 1)
  }
})

test('unobserved and pending expiry are not negative or neutral trials; no evidence refuses learning', t => {
  const h = feedbackHarness(t)
  h.store.put('decision', 'd', { status: 'sent' })
  const outcome = h.policy.recordOutcome('d', { observation: 'unobserved', userIgnored: true, sentiment: -1 }, incoming)
  assert.equal(outcome.reward, null); assert.equal(outcome.policyUpdated, false)
  assert.equal(h.store.count('outcome'), 0); assert.equal(h.store.count('policy'), 0)
  for (const [status, parts] of [['sent', 0], ['dry_run', 0], ['failed', 0], ['unknown', 0]]) {
    const other = feedbackHarness(t); other.seed(status, parts)
    assert.throws(() => other.policy.recordOutcome('d', { explicitCorrection: true }, incoming), /DELIVERY_UNOBSERVED/)
    assert.equal(other.store.count('policy'), 0)
  }
  // A later dry run still retains earlier actual sends under ADR-006.
  const partialDry = feedbackHarness(t); partialDry.seed('dry_run', 1)
  assert.equal(partialDry.policy.recordOutcome('d', { positiveReaction: true }, incoming).policyUpdated, true)
})

test('unsupported atomic store and invalid observation refuse without fallback or partial writes', t => {
  const h = feedbackHarness(t); h.seed()
  h.base.atomicTransactions = false
  assert.throws(() => h.policy.recordOutcome('d', {}, incoming), /ATOMICITY_UNAVAILABLE/)
  h.base.atomicTransactions = true
  for (const observation of [{ sentiment: Infinity }, { attributionConfidence: NaN }, { userContinued: 'yes' }, { prompt: 'PRIVATE_SECRET' }, { attribution: 'guess' }]) {
    assert.throws(() => h.policy.recordOutcome('d', observation, incoming), /QUERY_INVALID/)
  }
  assert.equal(h.store.count('outcome'), 0)
})

test('feedback refuses a policy store outside the receipt transaction owner', t => {
  const h = feedbackHarness(t), other = feedbackHarness(t); h.seed(); other.seed()
  const policy = createPolicyService({ store: other.store, observer: h.observer, clock: h.clock, getConfig: () => ({}) })
  assert.throws(() => policy.recordOutcome('d', { positiveReaction: true }, incoming), /ATOMICITY_UNAVAILABLE/)
  assert.equal(other.store.count('outcome'), 0); assert.equal(h.store.count('outcome'), 0)
})

test('JSON feedback transaction rolls back disk snapshot and persists event dedupe across restart', async t => {
  const { mkdtempSync, mkdirSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os'), { join } = await import('node:path')
  const { createStore } = await import('../src/cognition/store.js')
  const { createLoopObserver } = await import('../src/observability/loop.js')
  const root = mkdtempSync(join(tmpdir(), 'dsh-feedback-json-')), file = join(root, 'store.sqlite')
  mkdirSync(file)
  let reopened
  const base = createStore({ file }), store = createPersonaScopedStore({ base, getPersonaId: () => 'self' })
  const clock = { now: Date.now }, observer = createLoopObserver({ base, clock })
  const policy = createPolicyService({ store, observer, clock, getConfig: () => ({}) })
  t.after(() => { reopened?.close(); base.close(); rmSync(root, { recursive: true, force: true }) })
  store.put('decision', 'd', { status: 'sent', action: 'reply', contextKey: 'bucket' })
  const loop = observer.begin({ turnId: 'turn_1' })
  observer.recordStage(loop, 'decided', { decisionId: 'd' })
  observer.finishDelivery(observer.beginDelivery(loop), { status: 'sent', parts: 1, failedPart: null, errorCode: null })
  observer.finishLoop(loop)
  const disk = () => readFileSync(join(root, 'store.json'), 'utf8'), baseline = disk(), put = base.put
  base.put = (kind, ...args) => { if (kind.endsWith(':delivery_receipt')) throw Error('DISK_SECRET'); return put(kind, ...args) }
  assert.throws(() => policy.recordOutcome('d', { positiveReaction: true }, incoming), /FEEDBACK_COMMIT_FAILED/)
  base.put = put
  assert.equal(disk(), baseline); assert.equal(store.count('outcome'), 0); assert.equal(store.count('policy'), 0)
  const outcome = policy.recordOutcome('d', { positiveReaction: true }, incoming)
  base.close()
  reopened = createStore({ file })
  const bound = createPersonaScopedStore({ base: reopened, getPersonaId: () => 'self' })
  const resumed = createPolicyService({ store: bound, observer: createLoopObserver({ base: reopened, clock }), clock, getConfig: () => ({}) })
  assert.equal(resumed.recordOutcome('d', { positiveReaction: true }, incoming).id, outcome.id)
  assert.equal(bound.list('policy')[0].trials, 1)
})
