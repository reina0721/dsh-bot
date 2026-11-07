import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness, deferred } from './helpers/learning.js'

test('port exposes only bounded methods; new-event auto enqueue only; private policy and disabled states', t => {
  const h = harness(t, { autoResearch: true })
  assert.deepEqual(Object.keys(h.port), ['onUnknownDetected', 'enqueueAuto', 'pending', 'claim', 'sources', 'collectFromSource', 'extractClaim', 'complete', 'fail', 'release', 'retry'])
  h.detect('old'); h.engine.start(); assert.equal(h.store.count('learning_task'), 0)
  h.detect('new'); assert.equal(h.store.count('learning_task'), 1)
  assert.equal(h.store.list('learning_task')[0].plan.length, 3)
  h.config.cognition.privacy.learnFromPrivate = false
  h.detect('private', 'private'); assert.equal(h.store.count('unknown'), 3); assert.equal(h.store.count('learning_task'), 1)
  h.engine.stop(); h.detect('disabled'); assert.equal(h.store.count('learning_task'), 1)
  assert.throws(() => h.port.enqueueAuto({ unknownRef: {}, plan: ['forged'] }), /INVALID_UNKNOWN_REF/)
  h.config.cognition.learning.autoResearch = false
  assert.throws(() => h.port.enqueueAuto({ unknownRef: {}, plan: ['x'] }), /LEARNING_DISABLED/)
})

test('opaque lease is single-flight, version/due/status bound; one attempt; references cannot cross tasks', async t => {
  const h = harness(t); h.source.fetch = async url => ({ url, text: 'same definition on distinct domains' }); h.seed(); h.seed('future', { nextRunAt: h.clock.now() + 10 }); h.seed('suggested', { status: 'suggested' })
  assert.deepEqual(h.port.pending({ limit: 999 }), [{ taskId: 't', expectedVersion: 1 }])
  assert.equal(h.port.claim({ taskId: 't', expectedVersion: 0 }), null)
  assert.equal(h.port.claim({ taskId: 'future', expectedVersion: 1 }), null)
  h.config.cognition.learning.autoResearch = true
  assert.equal(h.port.claim({ taskId: 'suggested', expectedVersion: 1, mode: 'auto' }), null)
  const { lease, query } = h.port.claim({ taskId: 't', expectedVersion: 1 })
  assert.deepEqual(lease, {}); assert.equal(h.store.get('learning_task', 't').attempts, 1)
  assert.throws(() => h.port.claim({ taskId: 'future', expectedVersion: 1 }), /LEASE_BUSY/)
  assert.throws(() => h.port.sources({ lease: {} }), /LEASE_CANCELLED/)
  const [{ sourceRef }] = h.port.sources({ lease })
  assert.deepEqual(sourceRef, {})
  await assert.rejects(h.port.collectFromSource({ lease, sourceRef: {}, query }), /INVALID_SOURCE/)
  await assert.rejects(h.port.collectFromSource({ lease, sourceRef, query: 'arbitrary URL' }), /INVALID_SOURCE/)
  const refs = await h.port.collectFromSource({ lease, sourceRef, query, maxResults: 999 })
  assert.equal(refs.length, 2); assert.deepEqual(refs, [{}, {}])
  await assert.rejects(h.port.collectFromSource({ lease, sourceRef, query }), /INVALID_SOURCE/)
  await assert.rejects(h.port.extractClaim({ lease, evidenceRefs: [{}] }), /INVALID_EVIDENCE/)
  assert.throws(() => h.port.complete({ lease, claimRef: null }), /INVALID_CLAIM/)
  const claim = await h.port.extractClaim({ lease, evidenceRefs: refs })
  await assert.rejects(h.port.extractClaim({ lease, evidenceRefs: refs }), /INVALID_EVIDENCE/)
  const first = h.port.complete({ lease, ...claim }), second = h.port.complete({ lease, ...claim })
  assert.deepEqual(first, second); assert.equal(h.store.count('knowledge_claim'), 1); assert.equal(h.store.count('learning_evidence'), 2)
  assert.equal(h.store.get('unknown', 'ut').status, 'resolved')
  h.port.release({ lease }); h.port.release({ lease })
  assert.throws(() => h.port.complete({ lease, ...claim }), /LEASE_CANCELLED/)
  const next = h.port.claim({ taskId: 'suggested', expectedVersion: 1 })
  await assert.rejects(h.port.extractClaim({ lease: next.lease, evidenceRefs: refs }), /INVALID_EVIDENCE/)
  h.port.release(next)
})

test('cancel/retry invalidate versions; repeated attempts deduplicate evidence and never publish stale claims', async t => {
  const h = harness(t); h.seed()
  const run = h.port.claim({ taskId: 't', expectedVersion: 1 })
  const [{ sourceRef }] = h.port.sources(run)
  const refs = await h.port.collectFromSource({ ...run, sourceRef })
  const draft = await h.port.extractClaim({ ...run, evidenceRefs: refs })
  assert.equal(h.port.claim({ taskId: 't', mode: 'cancel' }).status, 'cancelled')
  assert.throws(() => h.port.complete({ ...run, ...draft }), /LEASE_CANCELLED/)
  h.port.release(run)
  const retried = h.port.retry({ taskId: 't' }); assert.equal(retried.status, 'pending')
  const retry = h.port.claim({ taskId: 't', expectedVersion: retried.version })
  const [source] = h.port.sources(retry)
  const evidenceRefs = await h.port.collectFromSource({ ...retry, ...source })
  h.port.complete({ ...retry, ...await h.port.extractClaim({ ...retry, evidenceRefs }) })
  assert.equal(h.store.count('learning_evidence'), 2); assert.equal(h.store.count('knowledge_claim'), 1)
  assert.equal(h.store.get('learning_task', 't').attempts, 2)
  h.port.release(retry)
  h.port.retry({ taskId: 't' }); h.engine.start()
  assert.equal((await h.engine.runPending())[0].ok, true)
  assert.equal(h.store.count('knowledge_claim'), 1); assert.equal(h.store.count('learning_evidence'), 2)
  assert.equal(h.store.get('learning_task', 't').attempts, 3)
})

test('release/stop, pause, privacy change and persona switch block late external/LLM writes', async t => {
  for (const step of ['search', 'fetch', 'llm']) for (const action of ['release', 'pause', 'private', 'persona']) {
    const h = harness(t); h.seed()
    const gate = deferred(), entered = deferred()
    if (step === 'llm') h.services.llm = { async completeJson() { entered.resolve(); await gate.promise; return { ok: true, json: { claim: 'late' } } } }
    else h.source[step] = async () => { entered.resolve(); await gate.promise; return step === 'search' ? [{ url: 'https://a.example', snippet: 'late' }] : { text: 'late' } }
    const run = h.port.claim({ taskId: 't', expectedVersion: 1 }), [source] = h.port.sources(run)
    const work = step === 'llm' ? h.port.collectFromSource({ ...run, ...source }).then(evidenceRefs => h.port.extractClaim({ ...run, evidenceRefs })) : h.port.collectFromSource({ ...run, ...source })
    await entered.promise
    if (action === 'release') h.port.release(run)
    if (action === 'pause') h.config.cognition.paused = true
    if (action === 'private') { const u = h.store.get('unknown', 'ut'); h.store.put('unknown', u.id, { ...u, scopeType: 'private' }); h.config.cognition.privacy.learnFromPrivate = false }
    if (action === 'persona') { h.switchPersona('other'); h.switchPersona('self') }
    gate.resolve(); await assert.rejects(work, /LEASE_CANCELLED|LEARNING_DISABLED|PRIVATE_POLICY/)
    assert.equal(h.store.count('knowledge_claim'), 0); assert.equal(h.store.get('unknown', 'ut').status, 'open')
    if (step !== 'llm') assert.equal(h.store.count('learning_evidence'), 0)
    h.port.release(run)
  }
})

test('hour ceiling keeps existing > semantics; fail sanitizes; stopped runtime cannot use port', async t => {
  const h = harness(t); h.seed(); h.config.cognition.learning.maxTasksPerHour = 0
  assert.equal(h.port.claim({ taskId: 't', expectedVersion: 1 }), null)
  assert.equal(h.store.get('learning_task', 't').nextRunAt, h.clock.now() + 3600000)
  h.advance(3600001)
  const run = h.port.claim(h.port.pending({})[0])
  const result = h.port.fail({ ...run, error: 'https://secret.example/token' })
  assert.equal(result.error, 'RESEARCH_FAILED'); assert.doesNotMatch(JSON.stringify(h.store.get('learning_task', 't')), /secret/)
  h.port.release(run); h.revoke(); assert.throws(() => h.port.pending({}), /MODULE_DISABLED/)
})

test('source failures continue iteration; extraction keeps confidence/citations and core LLM settings; all transactions synchronous', async t => {
  const h = harness(t); h.seed(); let depth = 0
  const originalTx = h.base.tx
  h.base.tx = fn => originalTx(() => { depth++; try { const result = fn(); assert.equal(typeof result?.then, 'undefined'); return result } finally { depth-- } })
  const bad = { id: 'bad', async search() { assert.equal(depth, 0); throw Error('secret source failure') } }
  h.services.sources.list = () => [bad, h.source]
  h.services.llm = { async completeJson(options, prompt) { assert.equal(depth, 0); assert.deepEqual(options, { purpose: 'learning' }); assert.equal(prompt.maxTokens, 700); return { ok: true, json: { concept: 'concept', claim: 'claim', confidence: 0.8, citations: [2], limitations: ['limited'] } } } }
  h.engine.start(); assert.equal((await h.engine.runPending())[0].ok, true)
  const claim = h.store.list('knowledge_claim')[0]
  assert.equal(claim.confidence, 0.8); assert.equal(claim.citations.length, 1); assert.equal(claim.citations[0].url, 'https://b.example/y')
  assert.deepEqual(claim.limitations, ['limited']); assert.equal(claim.evidenceIds.length, 2)
})

test('research loop attempts join actual unknown/evidence/claim refs; cancellation/retry preserve original attempt and legacy null', async t => {
  const h = harness(t); h.seed()
  const run = h.port.claim({ taskId: 't', expectedVersion: 1 })
  const firstId = h.query.runs().items[0].id
  assert.equal(h.query.detail({ id: firstId }).item.firstDetectedTurnId, null)
  h.port.claim({ taskId: 't', mode: 'cancel' })
  assert.equal(h.query.detail({ id: firstId }).receipts.find(r => r.data.status === 'cancelled').data.status, 'cancelled')
  const retried = h.port.retry({ taskId: 't' })
  const retry = h.port.claim({ taskId: 't', expectedVersion: retried.version })
  const secondId = h.query.runs().items.find(row => row.id !== firstId).id
  const [source] = h.port.sources(retry)
  const evidenceRefs = await h.port.collectFromSource({ ...retry, ...source })
  h.port.complete({ ...retry, ...await h.port.extractClaim({ ...retry, evidenceRefs }) })
  h.port.release(retry)
  const detail = h.query.detail({ id: secondId })
  assert.equal(detail.item.unknownId, 'ut'); assert.equal(detail.item.taskId, 't')
  assert.equal(detail.research.evidenceCount, 2); assert.equal(detail.research.claimCount, 1)
  assert.equal(detail.receipts.find(r => r.data.status === 'completed').data.status, 'completed')
  assert.equal(detail.receipts.find(r => r.data.status === 'completed').data.claimId, detail.research.claims[0].id)
  assert.equal(h.query.detail({ id: firstId }).receipts.find(r => r.data.status === 'cancelled').data.status, 'cancelled')
  assert.doesNotMatch(JSON.stringify(detail), /https:|definition|surface|excerpt|query|citations/)
  h.switchPersona('other')
  assert.equal(h.query.detail({ id: secondId }).code, 'LOOP_NOT_FOUND')
})

test('research newly detected first turn propagates and release records interruption without claim', t => {
  const h = harness(t, { autoResearch: true }); h.engine.start()
  const [unknown] = h.services.knowledge.detectFromTurn({ turn: { id: 'turn_original', text: 'new' }, analysis: { confidence: 0.7, unknownCandidates: [{ surface: 'new' }] } })
  const [pending] = h.port.pending()
  assert.equal(h.store.get('learning_task', pending.taskId).unknownId, unknown.id)
  const run = h.port.claim(pending)
  const id = h.query.runs().items[0].id
  assert.equal(h.query.detail({ id }).item.firstDetectedTurnId, 'turn_original')
  h.switchPersona('other'); h.port.release(run)
  assert.equal(h.query.runs().items.length, 0)
  h.switchPersona('self')
  const detail = h.query.detail({ id })
  assert.equal(detail.item.status, 'interrupted'); assert.equal(detail.receipts.find(r => r.data.status === 'interrupted').data.status, 'interrupted')
  assert.equal(h.store.count('knowledge_claim'), 0)
  assert.equal(h.store.get('learning_task', pending.taskId).status, 'pending')
})
