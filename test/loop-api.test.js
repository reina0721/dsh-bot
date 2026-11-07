import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loopHarness } from './helpers/loop.js'
import { createPersonaScopedStore } from '../src/cognition/persona-scope.js'
import { createLoopQuery } from '../src/observability/loop-query.js'
import { createPolicyService } from '../src/cognition/policy.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { LOOP_LIMITS } from '../src/observability/loop.js'

function queryHarness(t) {
  const h = loopHarness(t)
  let personaId = 'self', generation = 0
  const store = createPersonaScopedStore({ base: h.base, getPersonaId: () => personaId })
  const query = createLoopQuery({ observer: h.observer, store, clock: h.clock, getGeneration: () => generation })
  const policy = createPolicyService({ store, observer: h.observer, clock: h.clock, getConfig: () => ({}) })
  const fake = createFakeDsh()
  const cognition = { loopRuns: query.runs, loopDetail: query.detail, loopSummary: query.summary, loopReadiness: () => ({ ready: true, paused: false, dryRun: false }) }
  createRoutes({ ctx: fake.ctx, cognition, gateway: { snapshot: () => ({ state: 'connected', loginCheck: 'ok', token: 'PRIVATE_SECRET' }) } })
  t.after(() => fake.dispose())
  const get = async (path, headers) => (await fake.call('/onebot-qq/api/system/loop/' + path, undefined, { method: 'GET', headers })).json
  function sent(decisionId = 'd1', status = 'sent', parts = 1) {
    store.put('decision', decisionId, { action: 'reply', contextKey: 'private:addr', status: 'sent', text: 'PRIVATE_SECRET' })
    const loop = h.observer.begin({ kind: 'social', turnId: 'turn_1' })
    h.observer.recordStage(loop, 'decided', { decisionId })
    const attempt = h.observer.beginDelivery(loop)
    h.observer.finishDelivery(attempt, { status, parts, failedPart: status === 'partial' ? parts : null, errorCode: null }, { attemptedParts: parts + (status === 'partial' ? 1 : 0) })
    h.observer.finishLoop(loop)
    return h.observer.retained().loops.find(row => row.decisionId === decisionId).id
  }
  return { ...h, store, query, policy, fake, get, sent,
    switchPersona(id) { h.switchPersona(id); personaId = id; generation++ } }
}

test('loop API defaults/max, stable equal-time cursor, filters, validation and persona binding', async t => {
  const h = queryHarness(t)
  for (let n = 0; n < 205; n++) h.observer.begin({ kind: n % 2 ? 'research' : 'social' })
  const first = await h.get('runs')
  assert.equal(first.items.length, 50)
  assert.equal((await h.get('runs?limit=999')).items.length, 200)
  let before = null; const ids = []
  do {
    const page = await h.get('runs?limit=17' + (before ? '&before=' + encodeURIComponent(before) : ''))
    ids.push(...page.items.map(row => row.id)); before = page.nextBefore
  } while (before)
  assert.equal(ids.length, 205); assert.equal(new Set(ids).size, 205)
  assert.deepEqual(ids, [...ids].sort().reverse())
  const filtered = await h.get('runs?kind=research&state=running')
  assert.ok(filtered.items.every(row => row.kind === 'research' && row.status === 'running'))
  for (const query of ['limit=0', 'limit=-1', 'limit=1.5', 'kind=PRIVATE_SECRET', 'state=sent', 'personaId=other', 'before=bad', 'before=' + encodeURIComponent(first.nextBefore) + '&kind=research']) {
    assert.equal((await h.get('runs?' + query)).code, 'LOOP_QUERY_INVALID')
  }
  h.switchPersona('other')
  assert.equal((await h.get('runs')).items.length, 0)
  assert.equal((await h.get('runs?before=' + encodeURIComponent(first.nextBefore))).code, 'LOOP_QUERY_INVALID')
  h.switchPersona('self')
  assert.equal((await h.get('runs?before=' + encodeURIComponent(first.nextBefore))).code, 'LOOP_QUERY_INVALID')
})

test('detail joins current-persona receipts/outcomes/research by existing IDs, legacy provenance stays unknown', async t => {
  const h = queryHarness(t), id = h.sent()
  const loop = h.base.get(h.store.scopedKind('loop_run'), id)
  h.base.put(h.store.scopedKind('loop_run'), id, { ...loop, unknownRefs: ['u1'], unknownId: 'u1' })
  h.store.put('unknown', 'u1', { surface: 'PRIVATE_SECRET', status: 'open' })
  h.store.put('learning_task', 't1', { unknownId: 'u1', status: 'done', claimId: 'c1', plan: ['PRIVATE_SECRET'] })
  h.store.put('learning_evidence', 'e1', { taskId: 't1', url: 'https://PRIVATE_SECRET', excerpt: 'PRIVATE_SECRET' })
  h.store.put('knowledge_claim', 'c1', { taskId: 't1', evidenceIds: ['e1'], status: 'disputed', claim: 'PRIVATE_SECRET' })
  h.store.put('outcome', 'legacy', { decisionId: 'd1', observed: { text: 'PRIVATE_SECRET' }, reward: 0.2 })
  const detail = await h.get('detail?id=' + id)
  assert.deepEqual(detail, await h.get('detail?decisionId=d1'))
  assert.equal(detail.receipts[0].data.parts, 1)
  assert.equal(detail.feedback[0].source, 'unknown'); assert.equal(detail.feedback[0].policyUpdated, null)
  assert.equal(detail.research.unknowns[0].firstDetectedTurnId, null)
  assert.deepEqual(detail.research.evidence, [{ id: 'e1', taskId: 't1' }])
  assert.equal(detail.research.claims[0].status, 'disputed')
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_SECRET|surface|excerpt|"observed":|dedupeKey|contextKey|chatId|prompt|https:/)
  h.switchPersona('other')
  const absent = await h.get('detail?id=absent')
  assert.deepEqual(await h.get('detail?id=' + id), absent)
  assert.deepEqual(await h.get('detail?decisionId=d1'), absent)
  assert.equal(absent.code, 'LOOP_NOT_FOUND')
})

test('GET is read-only, hides expiry without pruning, bounds links and rejects sandbox/methods', async t => {
  const h = queryHarness(t), id = h.sent()
  const before = h.base.info().stats.puts
  for (const path of ['runs', 'detail?id=' + id, 'summary']) {
    assert.equal((await h.get(path)).ok, true)
    const rejected = await h.fake.call('/onebot-qq/api/system/loop/' + path, undefined, { method: 'GET', headers: { origin: 'null' } })
    assert.equal(rejected.status, 403); assert.equal(rejected.headers['access-control-allow-origin'], undefined)
  }
  assert.equal(h.base.info().stats.puts, before)
  h.advance(LOOP_LIMITS.retentionMs + 1)
  assert.equal((await h.get('runs')).items.length, 0)
  assert.equal((await h.get('detail?id=' + id)).code, 'LOOP_NOT_FOUND')
  const summary = await h.get('summary')
  assert.equal(summary.retained.receipts, 0); assert.equal(summary.businessRecords.outcomeCount, 0)
  assert.equal(h.loops().length, 1, 'reads do not prune')
  assert.equal(h.base.info().stats.puts, before)
  assert.equal((await h.fake.call('/onebot-qq/api/system/loop/runs', {}, { method: 'POST' })).status, 405)
})

test('summary distinguishes retained delivery coverage/parts, feedback commit and unknown observations', async t => {
  const h = queryHarness(t)
  h.sent('d1', 'partial', 2)
  const outcome = h.policy.recordOutcome('d1', { userContinued: true, attributionConfidence: 0.5 }, { source: 'incoming', dedupeKey: 'turn_2' })
  const loop = h.observer.begin(); h.observer.beginDelivery(loop)
  h.observer.begin()
  const put = h.base.put
  h.base.put = () => { throw Error('PRIVATE_OBSERVATION_FAILURE') }
  assert.equal(h.observer.begin(), null)
  h.base.put = put
  const summary = await h.get('summary')
  assert.equal(summary.processLifetime.observationFailures.begin, 1)
  assert.equal(summary.retained.sentParts, 2)
  assert.equal(summary.retained.attemptedParts, null)
  assert.equal(summary.retained.attemptedPartsKnown, 3)
  assert.equal(summary.retained.coverage.deliveryResultUnknown, 1)
  assert.equal(summary.retained.feedback.policyCommitted, 1)
  assert.equal(summary.retained.feedback.sources.incoming, 1)
  const detail = await h.get('detail?decisionId=d1')
  assert.equal(detail.feedback[0].id, outcome.id)
  assert.equal(detail.feedback[0].policyBefore.trials, 0)
  assert.equal(detail.feedback[0].policyAfter.trials, 1)
  assert.equal(detail.receipts.find(row => row.kind === 'feedback').data.policyUpdated, true)
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE_SECRET|token|chatId|contextKey/)
})

test('detail link collections and feedback are capped at 200 with exact stored counts', async t => {
  const h = queryHarness(t), id = h.sent()
  const loop = h.base.get(h.store.scopedKind('loop_run'), id)
  h.base.put(h.store.scopedKind('loop_run'), id, { ...loop, unknownRefs: ['u1'] })
  h.store.put('unknown', 'u1', { status: 'open' })
  h.store.put('learning_task', 't', { unknownId: 'u1', status: 'running' })
  for (let i = 0; i < 205; i++) {
    h.store.put('learning_evidence', 'e' + i, { taskId: 't', excerpt: 'PRIVATE_SECRET' })
    h.store.put('outcome', 'o' + i, { decisionId: 'd1', observed: { text: 'PRIVATE_SECRET' } })
  }
  const detail = await h.get('detail?id=' + id)
  assert.equal(detail.research.evidence.length, 200); assert.equal(detail.research.evidenceCount, 205)
  assert.equal(detail.research.linksLimited, true)
  assert.equal(detail.feedback.length, 200); assert.equal(detail.feedbackCount, 205)
  for (const query of ['runs?limit=1&limit=2', 'detail?id=a&id=b']) assert.equal((await h.get(query)).code, 'LOOP_QUERY_INVALID')
  assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_SECRET/)
})
