import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createModuleActions, MODULE_ACTIONS, normalizeActionResult } from '../src/modules/actions.js'

const flush = () => new Promise(setImmediate)
const request = (patch = {}) => ({ moduleId: 'builtin-test', actionId: 'module.restart', expectedGeneration: 'g1', requestId: 'request1', ...patch })
function fixture(execute = async () => ({ status: 'loaded' })) {
  let clock = 0, timeout
  const module = { generation: 'ui1', runtimeGeneration: 'g1', builtin: true }
  const persona = { id: 'self', generation: 1 }
  const timers = { setTimeout(fn, delay) { assert.equal(delay, 10000); timeout = fn; return 1 }, clearTimeout() { timeout = null } }
  const actions = createModuleActions({ getModule: id => ['builtin-test', 'builtin-child'].includes(id) ? module : null,
    getPersona: () => persona, eligibility: () => null, affected: id => id === 'builtin-test' ? [id, 'builtin-child'] : [id],
    execute: async (input, context) => { context.check(); return execute(input, context) }, now: () => clock, timers })
  return { actions, module, persona, advance(ms) { clock += ms }, timeout: () => timeout?.() }
}

test('actions: fixed allowlist, exact data-only input; rejects arbitrary payloads before execution', async () => {
  let calls = 0
  const { actions } = fixture(() => { calls++; return { status: 'loaded' } })
  assert.deepEqual(MODULE_ACTIONS, ['module.enable', 'module.disable', 'module.restart', 'module.reload', 'proactivity.runOnce', 'learning.runPending'])
  const getter = { ...request() }; Object.defineProperty(getter, 'moduleId', { get() { throw new Error('getter executed') } })
  for (const input of [null, [], getter, request({ payload: {} }), request({ url: 'https://example.org' }), request({ actionId: 'start' }), request({ actionId: 'constructor' }), request({ moduleId: '../x' }), request({ requestId: '' }), request({ requestId: 'a'.repeat(129) }), request({ expectedGeneration: undefined }), request({ expectedPersonaGeneration: -1 })]) {
    assert.throws(() => actions.submit(input), { code: 'MODULE_ACTION_INVALID' })
  }
  assert.equal(calls, 0)
  assert.equal(actions.catalog('unknown').code, 'MODULE_NOT_FOUND')
})

test('actions: idempotency precedes generation checks, conflicts and reservations never duplicate execution', async () => {
  let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const h = fixture(async () => { calls++; await gate; h.module.runtimeGeneration = 'g2'; return { status: 'loaded' } })
  const first = h.actions.submit(request()).operation
  assert.equal(first.status, 'queued')
  assert.equal(h.actions.submit(request()).operation.id, first.id)
  assert.throws(() => h.actions.submit(request({ actionId: 'module.disable' })), { code: 'MODULE_REQUEST_CONFLICT' })
  assert.throws(() => h.actions.submit(request({ requestId: 'another' })), { code: 'MODULE_ACTION_BUSY' })
  assert.throws(() => h.actions.submit(request({ moduleId: 'builtin-child', requestId: 'child' })), { code: 'MODULE_ACTION_BUSY' })
  await flush(); assert.equal(calls, 1)
  release(); await flush()
  assert.equal(h.actions.getOperation({ id: first.id }).operation.status, 'succeeded')
  assert.equal(h.actions.submit(request()).operation.id, first.id)
  assert.equal(h.actions.getOperation({ requestId: 'request1' }).operation.resultRuntimeGeneration, 'g2')
  assert.throws(() => h.actions.submit(request({ requestId: 'stale' })), { code: 'MODULE_RUNTIME_CONFLICT' })
  assert.equal(calls, 1)
})

test('actions: persona rejection at admission and cancellation after queuing; no automatic retries', async () => {
  const h = fixture()
  assert.throws(() => h.actions.submit(request({ expectedPersonaId: 'other' })), { code: 'MODULE_PERSONA_CONFLICT' })
  assert.throws(() => h.actions.submit(request({ expectedPersonaGeneration: 0 })), { code: 'MODULE_PERSONA_CONFLICT' })
  h.actions.submit(request({ expectedPersonaId: 'self', expectedPersonaGeneration: 1 }))
  h.persona.generation++
  await flush()
  assert.equal(h.actions.getOperation({ requestId: 'request1' }).operation.status, 'cancelled')
  assert.equal(h.actions.submit(request({ expectedPersonaId: 'self', expectedPersonaGeneration: 1 })).operation.status, 'cancelled')
})

test('actions: 128 entries, terminal TTL one hour; never evicts active or re-executes reads', async () => {
  let calls = 0
  const h = fixture(() => { calls++; return { status: 'loaded' } })
  for (let i = 0; i < 128; i++) { h.actions.submit(request({ requestId: `r${i}` })); await flush() }
  assert.throws(() => h.actions.submit(request()), { code: 'MODULE_OPERATION_LIMIT' })
  h.advance(3599999)
  assert.equal(h.actions.getOperation({ requestId: 'r0' }).ok, true)
  assert.equal(calls, 128)
  h.advance(1)
  assert.equal(h.actions.getOperation({ requestId: 'r0' }).code, 'MODULE_OPERATION_NOT_FOUND')
  let release
  const pending = fixture(() => new Promise(resolve => { release = resolve }))
  pending.actions.submit(request()); await flush(); pending.advance(7200000)
  assert.equal(pending.actions.getOperation({ requestId: 'request1' }).operation.status, 'running')
  assert.throws(() => pending.actions.submit(request({ requestId: 'new' })), { code: 'MODULE_ACTION_BUSY' })
  release({ status: 'loaded' }); await flush()
  assert.equal(h.actions.submit(request()).ok, true); await flush()
})

test('actions: STOP_PENDING only observes original drain and keeps closure reserved until it finishes', async () => {
  let release, stops = 0
  const h = fixture(async (_, context) => {
    context.update('draining'); stops++
    await new Promise(resolve => { release = resolve })
    context.update('starting')
    return { status: 'loaded' }
  })
  const first = h.actions.submit(request()).operation
  await flush(); h.timeout()
  const pending = h.actions.getOperation({ id: first.id }).operation
  assert.equal(pending.status, 'STOP_PENDING'); assert.equal(pending.phase, 'draining')
  assert.equal(pending.completedAt, null); assert.equal(pending.result, null)
  for (let i = 0; i < 5; i++) { h.actions.catalog('builtin-test'); h.actions.getOperation({ id: first.id }); h.actions.submit(request()) }
  assert.equal(stops, 1)
  assert.throws(() => h.actions.submit(request({ moduleId: 'builtin-child', requestId: 'new' })), { code: 'MODULE_ACTION_BUSY' })
  release(); await flush()
  assert.equal(h.actions.getOperation({ id: first.id }).operation.status, 'succeeded')
})

test('actions: failures are normalized, terminal, and never retried; busy/skip/empty are never success', async () => {
  let calls = 0
  const h = fixture(() => { calls++; throw new Error('secret stack /path') })
  h.actions.submit(request()); await flush()
  const failed = h.actions.getOperation({ requestId: 'request1' }).operation
  assert.equal(failed.status, 'failed'); assert.deepEqual(failed.result, { ok: false, code: 'MODULE_ACTION_FAILED' })
  assert.doesNotMatch(JSON.stringify(failed), /secret|stack|path|signature/)
  for (let i = 0; i < 10; i++) { h.actions.catalog('builtin-test'); h.actions.submit(request()) }
  assert.equal(calls, 1)
  for (const result of [{ ok: false, reason: 'busy' }, { ok: false, reason: 'disabled' }, [], [null], [{ ok: true }, { ok: false }]]) {
    assert.equal(normalizeActionResult('learning.runPending', result).ok, false)
  }
  assert.equal(normalizeActionResult('learning.runPending', [{ ok: true }]).ok, true)
})

test('actions: queued stale generation cancels before execution and 128 active operations survive TTL/capacity', async () => {
  const h = fixture()
  h.actions.submit(request()); h.module.runtimeGeneration = 'g2'
  await flush()
  assert.equal(h.actions.getOperation({ requestId: 'request1' }).operation.status, 'cancelled')
  let time = 0, release
  const gate = new Promise(resolve => { release = resolve })
  const actions = createModuleActions({ getModule: () => ({ runtimeGeneration: 'g1' }), eligibility: () => null,
    affected: id => [id], execute: () => gate, now: () => time })
  for (let i = 0; i < 128; i++) actions.submit(request({ moduleId: `module${i}`, requestId: `r${i}` }))
  await flush(); time = 7200000
  assert.throws(() => actions.submit(request({ moduleId: 'extra' })), { code: 'MODULE_OPERATION_LIMIT' })
  assert.equal(actions.getOperation({ requestId: 'r0' }).operation.status, 'running')
  release({ status: 'loaded' }); await flush()
  assert.equal(normalizeActionResult('module.reload', { status: 'disabled' }).ok, true)
  assert.equal(normalizeActionResult('module.enable', { status: 'blocked' }).ok, false)
})

test('actions: persona IDs follow existing dotted ID contract; parent eligibility accounts for reserved descendants', async () => {
  const h = fixture()
  h.persona.id = 'persona.test'
  h.actions.submit(request({ moduleId: 'builtin-child', expectedPersonaId: 'persona.test' }))
  assert.equal(h.actions.catalog('builtin-test').items.find(x => x.actionId === 'module.restart').reasonCode, 'MODULE_ACTION_BUSY')
  await flush()
  assert.equal(h.actions.getOperation({ requestId: 'request1' }).operation.status, 'succeeded')
})

test('actions: aggregate admission/rejection/completion counts are content-free and duplicate admission is counted once', async () => {
  const h = fixture()
  h.actions.submit(request())
  h.actions.submit(request())
  assert.throws(() => h.actions.submit(request({ expectedPersonaId: 'PRIVATE_PERSONA', requestId: 'rejected' })))
  await flush()
  const counts = h.actions.stats()
  assert.deepEqual(counts, { admitted: 1, rejected: 1, completed: 1, failed: 0, firstAt: 0, lastAt: 0 })
  assert.doesNotMatch(JSON.stringify(counts), /PRIVATE_|requestId|moduleId/)
  counts.admitted = 100
  assert.equal(h.actions.stats().admitted, 1)
})
