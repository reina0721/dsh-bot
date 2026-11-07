import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createModuleActions } from '../src/modules/actions.js'
import { createActionAudit, ACTION_AUDIT_MAX_BYTES } from '../src/modules/action-audit.js'
import { createModuleKernel } from '../src/modules/kernel.js'
import { createFakeDsh, waitFor } from './helpers/fake-dsh.js'
import { createRoutes } from '../src/http/routes.js'

const flush = () => new Promise(setImmediate)
const request = (patch = {}) => ({ moduleId: 'builtin-test', actionId: 'module.restart', expectedGeneration: 'g1', requestId: 'request1', ...patch })
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-action-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const file = join(root, 'operations.json'), audit = createActionAudit({ file })
  const create = (options = {}) => createModuleActions({ audit, getModule: () => ({ runtimeGeneration: 'g1' }), eligibility: () => null, affected: id => [id], execute: () => ({ status: 'loaded' }), ...options })
  const disk = () => JSON.parse(readFileSync(file, 'utf8')).operations
  return { root, file, audit, create, disk }
}

test('audit: actual process exit interrupts running/draining/queued operations; no executor/replay on restart or duplicate request', async t => {
  for (const phase of ['queued', 'running', 'draining']) await t.test(phase, async t => {
    const h = fixture(t)
    const source = `
      import { createModuleActions } from ${JSON.stringify(new URL('../src/modules/actions.js', import.meta.url).href)};
      import { createActionAudit } from ${JSON.stringify(new URL('../src/modules/action-audit.js', import.meta.url).href)};
      const actions = createModuleActions({ audit: createActionAudit({file: process.argv[1]}), getModule: () => ({runtimeGeneration:'g1'}), eligibility: () => null, affected: id => [id], execute: (_, context) => { if (process.argv[2] === 'draining') context.update('draining'); return new Promise(() => {}) } });
      actions.submit(${JSON.stringify(request())});
      if (process.argv[2] === 'queued') process.exit(0);
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source, h.file, phase], { encoding: 'utf8' })
    assert.equal(child.status, 0, child.stderr)
    assert.equal(h.disk()[0].phase, phase)
    const id = h.disk()[0].id
    let calls = 0
    const actions = h.create({ execute() { calls++; return { status: 'loaded' } } })
    const interrupted = actions.getOperation({ id }).operation
    assert.equal(interrupted.status, 'interrupted')
    assert.equal(interrupted.code, 'PROCESS_RESTART')
    assert.equal(interrupted.phase, 'done')
    assert.ok(interrupted.completedAt)
    assert.equal(interrupted.expectedGeneration, 'g1')
    assert.equal(h.disk()[0].status, 'interrupted')
    for (let i = 0; i < 3; i++) assert.equal(actions.submit(request()).operation.id, id)
    assert.throws(() => actions.submit(request({ actionId: 'module.disable' })), { code: 'MODULE_REQUEST_CONFLICT' })
    await flush()
    assert.equal(calls, 0)
    assert.equal(actions.isReserved('builtin-test'), false)
    assert.equal(h.create().getOperation({ id }).operation.completedAt, interrupted.completedAt, 'repeat startup does not rewrite interruption time')
  })
})

test('audit: terminal IDs/generations/results/timestamps survive restart; failure codes stay fixed and content-free', async t => {
  const h = fixture(t)
  let generation = 'g1'
  const actions = h.create({ getModule: () => ({ runtimeGeneration: generation }), execute() { generation = 'g2'; return { status: 'loaded' } } })
  const { id } = actions.submit(request()).operation
  await flush()
  const before = actions.getOperation({ id }).operation
  const after = h.create({ execute() { assert.fail('must not execute restored operation') } })
  assert.deepEqual(after.getOperation({ id }).operation, before)
  assert.equal(after.submit(request()).operation.id, id)
  assert.equal(before.resultRuntimeGeneration, 'g2')
  assert.ok(before.createdAt <= before.completedAt)
  const failed = h.create({ execute() { throw Object.assign(Error('SECRET path'), { code: 'PROVIDER_STOP_FAILED' }) } })
  failed.submit(request({ requestId: 'failure' })); await flush()
  const restored = h.create().getOperation({ requestId: 'failure' }).operation
  assert.equal(restored.status, 'failed')
  assert.equal(restored.code, 'PROVIDER_STOP_FAILED')
  assert.doesNotMatch(readFileSync(h.file, 'utf8'), /SECRET|path|signature|executor/)
})

test('audit: 128 durable entries, one hour TTL; active operations never evicted and reads never write', async t => {
  const h = fixture(t)
  let now = 1000000, sends = 0
  const actions = h.create({ now: () => now, execute() { sends++; return { status: 'loaded' } } })
  for (let i = 0; i < 128; i++) { actions.submit(request({ requestId: 'r' + i })); await flush() }
  assert.equal(h.disk().length, 128)
  assert.ok(Buffer.byteLength(readFileSync(h.file)) <= ACTION_AUDIT_MAX_BYTES)
  assert.throws(() => actions.submit(request()), { code: 'MODULE_OPERATION_LIMIT' })
  const restarted = h.create({ now: () => now })
  assert.equal(restarted.getOperation({ requestId: 'r0' }).operation.status, 'succeeded')
  const snapshot = readFileSync(h.file, 'utf8')
  restarted.catalog('builtin-test'); restarted.getOperation({ requestId: 'r1' })
  assert.equal(readFileSync(h.file, 'utf8'), snapshot)
  now += 3600000
  assert.equal(restarted.getOperation({ requestId: 'r0' }).code, 'MODULE_OPERATION_NOT_FOUND')
  restarted.submit(request()); await flush()
  assert.equal(h.disk().length, 1)
  assert.equal(sends, 128)
  let release
  const pending = h.create({ now: () => now, execute: () => new Promise(resolve => { release = resolve }) })
  pending.submit(request({ requestId: 'active', moduleId: 'builtin-active' })); await flush()
  now += 7200000
  assert.equal(pending.getOperation({ requestId: 'active' }).operation.status, 'running')
  assert.throws(() => pending.submit(request({ requestId: 'other', moduleId: 'builtin-active' })), { code: 'MODULE_ACTION_BUSY' })
  release({ status: 'loaded' }); await flush()
})

test('audit: admission/write failure executes nothing; terminal write failure leaves restart interrupted with no resend', async t => {
  const h = fixture(t)
  let writes = 0, calls = 0, failAt = 1
  const errors = []
  const audit = { load: h.audit.load, save(rows) { if (++writes >= failAt) throw Error('disk full SECRET'); h.audit.save(rows) } }
  const actions = h.create({ audit, onAuditError: code => errors.push(code), execute() { calls++; return { status: 'loaded' } } })
  assert.throws(() => actions.submit(request()), { code: 'MODULE_AUDIT_WRITE_FAILED' })
  assert.equal(actions.getOperation({ requestId: 'request1' }).ok, false)
  assert.equal(actions.isReserved('builtin-test'), false)
  await flush(); assert.equal(calls, 0)
  writes = 0; failAt = 3 // queued + running persist, then terminal disk failure
  actions.submit(request()); await flush()
  assert.equal(calls, 1)
  assert.equal(actions.getOperation({ requestId: 'request1' }).operation.status, 'succeeded')
  assert.equal(h.disk()[0].status, 'running')
  assert.deepEqual(errors, ['MODULE_AUDIT_WRITE_FAILED'])
  const restarted = h.create({ execute() { calls++; assert.fail('no replay') } })
  assert.equal(restarted.submit(request()).operation.status, 'interrupted')
  await flush(); assert.equal(calls, 1)
})

test('audit: corrupt, oversized or invalid metadata fails closed before actions can be admitted', t => {
  const h = fixture(t)
  for (const contents of ['{broken', 'x'.repeat(ACTION_AUDIT_MAX_BYTES + 1), JSON.stringify({ version: 1, operations: [{}] }), JSON.stringify({ version: 2, operations: [] })]) {
    writeFileSync(h.file, contents)
    assert.throws(() => h.create(), { code: 'MODULE_AUDIT_READ_FAILED' })
    assert.equal(readFileSync(h.file, 'utf8'), contents, 'do not silently discard audit/dedupe history')
  }
  rmSync(h.file); mkdirSync(h.file)
  assert.throws(() => h.create(), { code: 'MODULE_AUDIT_READ_FAILED' })
})

test('kernel audit is wired to HTTP operation reads across kernel restart, without restarting a second time', async t => {
  const h = fixture(t)
  let setups = 0
  const options = { dataDir: h.root, registry: [{ manifest: { id: 'builtin-test', permissions: [] }, defaultEnabled: true, load: () => ({ setup() { setups++ } }) }] }
  const first = createModuleKernel(options)
  t.after(() => first.dispose())
  await first.start()
  const input = request({ expectedGeneration: first.actions('builtin-test').expectedGeneration })
  const admitted = first.action(input).operation
  await waitFor(() => first.getOperation({ id: admitted.id }).operation.completedAt)
  await first.dispose()
  assert.equal(setups, 2)
  const next = createModuleKernel(options), fake = createFakeDsh()
  t.after(async () => { fake.dispose(); await next.dispose() })
  createRoutes({ ctx: fake.ctx, modules: next })
  await next.start()
  assert.equal(setups, 3)
  const response = await fake.call('/onebot-qq/api/modules/operation?requestId=request1', undefined, { method: 'GET' })
  assert.equal(response.json.operation.id, admitted.id)
  assert.equal(response.json.operation.status, 'succeeded')
  assert.equal(next.action(input).operation.id, admitted.id)
  await flush(); assert.equal(setups, 3)
})

test('audit: failure to persist running state prevents executor I/O', async t => {
  const h = fixture(t)
  let writes = 0, calls = 0
  const actions = h.create({ audit: { load: h.audit.load, save(rows) { if (++writes === 2) throw Error('disk full'); h.audit.save(rows) } }, execute() { calls++; return { status: 'loaded' } } })
  actions.submit(request()); await flush()
  assert.equal(calls, 0)
  assert.equal(actions.getOperation({ requestId: 'request1' }).operation.code, 'MODULE_AUDIT_WRITE_FAILED')
  assert.equal(h.create().getOperation({ requestId: 'request1' }).operation.status, 'failed')
})

test('audit: durable STOP_PENDING keeps its original owner reserved, then restart only records interruption', async t => {
  const h = fixture(t)
  let timeout, release, stops = 0
  const actions = h.create({ timers: { setTimeout(fn) { timeout = fn; return 1 }, clearTimeout() {} }, execute: async (_, context) => {
    stops++; context.update('draining')
    await new Promise(resolve => { release = resolve })
    return { status: 'loaded' }
  } })
  actions.submit(request()); await flush(); timeout()
  assert.equal(h.disk()[0].status, 'STOP_PENDING')
  assert.equal(actions.isReserved('builtin-test'), true)
  assert.throws(() => actions.submit(request({ requestId: 'force-new' })), { code: 'MODULE_ACTION_BUSY' })
  const restartFile = join(h.root, 'restart.json')
  writeFileSync(restartFile, readFileSync(h.file))
  const restarted = h.create({ audit: createActionAudit({ file: restartFile }), execute() { assert.fail('must not recover') } })
  assert.equal(restarted.getOperation({ requestId: 'request1' }).operation.status, 'interrupted')
  assert.equal(stops, 1)
  // Separate copied audit simulates process death; never share a live file owner.
  release(); await flush()
  assert.equal(actions.getOperation({ requestId: 'request1' }).operation.status, 'succeeded')
})
