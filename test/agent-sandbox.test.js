import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, symlink, link, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSandboxService } from '../src/sandbox/service.js'
import { createWorkspace, relativePath, WORKSPACE_LIMITS } from '../src/sandbox/workspace.js'
import { createAudit } from '../src/sandbox/audit.js'
import { createUnavailableDriver } from '../src/sandbox/drivers/unavailable.js'
import { normalizeSandbox, deriveScope, effectivePolicy, digest } from '../src/sandbox/policy.js'
import { defaultConfig, normalizeConfig } from '../src/core/config.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh, waitFor } from './helpers/fake-dsh.js'

const context = { personaId: 'persona-a', principalId: '1', chatType: 'private', chatId: '1', sessionId: 'session-a' }
function fakeDriver() {
  const calls = []
  return {
    name: 'fake-test-only', calls, active: 0, maxActive: 0,
    probe: async () => ({ ready: true, reason: 'READY' }),
    async execute({ code, signal, snapshot, limits }) {
      calls.push({ code, snapshot, limits }); this.active++; this.maxActive = Math.max(this.active, this.maxActive)
      try {
        if (code.startsWith('hold')) await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
        if (code === 'throw') throw Error('/private/SECRET credential=CANARY')
        return { reason: signal.aborted ? 'CANCELLED' : 'EXITED', exitCode: signal.aborted ? null : 0, output: code === 'large' ? 'x'.repeat(100000) : 'fake-output' }
      } finally { this.active-- }
    },
  }
}
async function harness(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-exec-'))
  const config = { sandbox: normalizeSandbox({ enabled: true, ...options.sandbox }), access: { ownerQQ: '1', operators: ['2'] } }
  const driver = options.driver || fakeDriver()
  const service = createSandboxService({ root, getConfig: () => config, driver, ...options.service })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  await service.probe()
  let counter = 0
  const input = async (patch = {}) => ({ kind: 'execute', requestId: 'test-' + ++counter, policyGeneration: (await service.status(context)).policyGeneration, code: 'echo test', ...patch })
  const create = async patch => service.create(context, await input(patch))
  const terminal = id => waitFor(async () => { const { job } = await service.detail(context, id); return ['succeeded', 'failed', 'cancelled'].includes(job.state) && job }, { label: 'sandbox terminal' })
  return { root, config, driver, service, input, create, terminal }
}

test('C06 schema: opt-in, fixed network off, capped limits and server-derived owner/private policy', () => {
  assert.equal(defaultConfig().sandbox.enabled, false)
  assert.throws(() => normalizeConfig({ sandbox: { network: true } }), /NETWORK_POLICY_UNSUPPORTED/)
  const { config } = normalizeConfig({ sandbox: { enabled: true, limits: { concurrency: 999, jobs: 999, memoryMiB: 999 } } })
  assert.equal(config.sandbox.network, false); assert.equal(config.sandbox.limits.concurrency, 4); assert.equal(config.sandbox.limits.jobs, 128); assert.equal(config.sandbox.limits.memoryMiB, 256)
  const cfg = { ...config, access: { ownerQQ: '1', operators: ['2'] } }
  assert.deepEqual(effectivePolicy(cfg, deriveScope(cfg, context)).capabilities, ['workspace', 'execute'])
  for (const other of [{ principalId: '2' }, { principalId: '3' }, { chatType: 'group' }]) assert.deepEqual(effectivePolicy(cfg, deriveScope(cfg, { ...context, ...other })).capabilities, [])
  assert.throws(() => deriveScope(cfg, {}), /SCOPE_UNAVAILABLE/)
})

test('C06 fake driver: durable admission, idempotency/conflicts, unknown/foreign jobs and bounded artifacts', async t => {
  const h = await harness(t), input = await h.input({ code: 'large' })
  const results = await Promise.all(Array.from({ length: 8 }, () => h.service.create(context, input)))
  assert.equal(new Set(results.map(r => r.job.id)).size, 1)
  assert.equal((await h.service.create(context, Object.fromEntries(Object.entries(input).reverse()))).reused, true)
  const id = results[0].job.id
  const job = await h.terminal(id)
  assert.equal(job.state, 'succeeded'); assert.equal(job.outputBytes, 65536); assert.equal(h.driver.calls.length, 1)
  const artifact = await h.service.artifact(context, id)
  assert.equal(Buffer.from(artifact.content, 'base64').length, 65536)
  await assert.rejects(h.service.create(context, { ...input, code: 'other' }), /IDEMPOTENCY_CONFLICT/)
  for (const operation of ['detail', 'cancel', 'artifact']) {
    await assert.rejects(h.service[operation](context, 'job_unknown'), /JOB_NOT_FOUND/)
    await assert.rejects(h.service[operation]({ ...context, sessionId: 'foreign' }, id), /JOB_NOT_FOUND/)
  }
  assert.deepEqual((await h.service.list({ ...context, personaId: 'other' })).items, [])
  const audit = await readFile(join(h.root, 'audit', 'audit.json'), 'utf8')
  assert.doesNotMatch(audit, /large|fake-output|session-a|persona-a|"code"|"content"/)
  assert.equal(JSON.parse(audit).filter(row => row.state === 'queued').length, 1)
})

test('C06 disabled/unavailable execution refuses; independent workspace files remain safe when enabled', async t => {
  const h = await harness(t, { driver: createUnavailableDriver('BWRAP_MISSING') })
  assert.equal((await h.service.status(context)).state, 'unavailable')
  await assert.rejects(h.create(), /SANDBOX_UNAVAILABLE/)
  const written = await h.create({ kind: 'file.write', code: undefined, path: 'a.txt', content: 'hello' }).catch(e => e)
  // Strict validation rejects even an undefined extra key at the JS boundary.
  assert.equal(written.code, 'INVALID_SANDBOX_INPUT')
  const file = async (kind, fields = {}) => {
    const { code, ...base } = await h.input()
    return h.service.create(context, { ...base, kind, ...fields })
  }
  const write = await file('file.write', { path: 'a.txt', content: 'hello' }); await h.terminal(write.job.id)
  const read = await file('file.read', { path: 'a.txt' }); await h.terminal(read.job.id)
  assert.equal(Buffer.from((await h.service.artifact(context, read.job.id)).content, 'base64').toString(), 'hello')
  const list = await file('file.list'); await h.terminal(list.job.id)
  assert.deepEqual(JSON.parse(Buffer.from((await h.service.artifact(context, list.job.id)).content, 'base64')).entries, [{ path: 'a.txt', directory: false, bytes: 5 }])
  const del = await file('file.delete', { path: 'a.txt' }); assert.equal((await h.terminal(del.job.id)).state, 'succeeded')
  const missing = await file('file.read', { path: 'a.txt' }); assert.equal((await h.terminal(missing.job.id)).state, 'failed')
  h.config.sandbox.enabled = false
  assert.equal((await h.service.status(context)).state, 'disabled')
  await assert.rejects(file('file.write', { path: 'b', content: '' }), /SANDBOX_DISABLED/)
})

test('C06 fake driver: concurrency, queued/running cancellation, policy revocation and drain', async t => {
  const h = await harness(t, { sandbox: { limits: { concurrency: 1, jobs: 4 } } })
  const first = await h.create({ code: 'hold-1' })
  await waitFor(() => h.driver.active === 1)
  const second = await h.create({ code: 'hold-2' })
  assert.equal((await h.service.status(context)).queued, 1)
  await h.service.cancel(context, second.job.id)
  assert.equal((await h.terminal(second.job.id)).state, 'cancelled')
  await assert.rejects(h.service.artifact(context, second.job.id), /ARTIFACT_NOT_FOUND/)
  await h.service.cancel(context, first.job.id)
  assert.equal((await h.terminal(first.job.id)).state, 'cancelled'); assert.equal(h.driver.maxActive, 1)
  const third = await h.create({ code: 'hold-3' }); await waitFor(() => h.driver.active === 1)
  const old = await h.input()
  h.config.sandbox.policy.ownerPrivate = []
  await h.service.status(context)
  assert.equal((await h.terminal(third.job.id)).state, 'cancelled')
  await assert.rejects(h.service.create(context, old), /POLICY_CHANGED/)
  const fresh = await h.input()
  await assert.rejects(h.service.create(context, fresh), /POLICY_DENIED/)
  await h.service.dispose()
  assert.equal((await h.service.status(context)).state, 'draining')
  await assert.rejects(h.service.create(context, fresh), /SANDBOX_DRAINING/)
})

test('C06 audit failure blocks admission and execution, output and errors never enter metadata', async t => {
  const denied = await harness(t, { service: { audit: { load: async () => [], append: async () => { throw Error('/secret') } } } })
  await assert.rejects(denied.create(), /AUDIT_UNAVAILABLE/)
  assert.equal(denied.driver.calls.length, 0); assert.equal((await denied.service.status(context)).state, 'failed')
  const h = await harness(t)
  const job = await h.create({ code: 'throw' })
  const result = await h.terminal(job.job.id)
  assert.equal(result.state, 'failed')
  assert.doesNotMatch(JSON.stringify(result), /SECRET|private|CANARY/)
  const audit = createAudit({ root: join(h.root, 'bounded-audit'), capacity: 4 })
  for (let n = 0; n < 10; n++) await audit.append({ id: String(n), state: 'succeeded', code: 'NO', output: 'NO' })
  const rows = await audit.load()
  assert.equal(rows.length, 4); assert.deepEqual(Object.keys(rows[0]), ['id', 'state'])
})

test('C06 workspace: traversal, symlinks/hardlinks, quota, scope partition, locking and snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workspace-')); t.after(() => rm(root, { recursive: true, force: true }))
  assert.deepEqual(WORKSPACE_LIMITS, { bytes: 67108864, entries: 1024 })
  for (const path of ['../a', '/a', 'a/../b', 'a//b', './a', 'a\\b', 'a\0b', 'a/']) assert.throws(() => relativePath(path), /WORKSPACE_PATH_INVALID/)
  const ws = createWorkspace({ root, limits: { bytes: 10, entries: 3 } }), key = digest('scope')
  await ws.locked(key, async base => {
    await ws.write(base, 'd/a', '12345')
    await ws.write(base, 'b', '67890')
    await assert.rejects(ws.write(base, 'c', ''), /WORKSPACE_QUOTA/)
    await assert.rejects(ws.write(base, 'b', '123456'), /WORKSPACE_QUOTA/)
    const snap = await ws.snapshot(base)
    assert.equal(await readFile(join(snap.path, 'd/a'), 'utf8'), '12345')
    await ws.write(base, 'd/a', 'new')
    assert.equal(await readFile(join(snap.path, 'd/a'), 'utf8'), '12345'); await snap.dispose()
  })
  assert.equal((await ws.locked(digest('other'), ws.scan)).entries.length, 0)
  let active = 0, max = 0
  await Promise.all(Array.from({ length: 10 }, () => ws.locked(key, async () => { max = Math.max(max, ++active); await new Promise(r => setImmediate(r)); active-- })))
  assert.equal(max, 1)
  const base = join(root, 'scopes', key)
  if (process.platform !== 'win32') {
    await symlink('/etc/passwd', join(base, 'sym'))
    await assert.rejects(ws.locked(key, ws.scan), /WORKSPACE_UNSAFE/)
    await rm(join(base, 'sym'))
    await link(join(base, 'b'), join(base, 'hard'))
    await assert.rejects(ws.locked(key, ws.scan), /WORKSPACE_UNSAFE/)
    await rm(join(base, 'hard'))
    const outside = await mkdtemp(join(tmpdir(), 'dsh-outside-')); t.after(() => rm(outside, { recursive: true, force: true }))
    await symlink(outside, join(root, 'redirect'))
    await assert.rejects(createWorkspace({ root: join(root, 'redirect') }).locked(key, ws.scan), /WORKSPACE_UNSAFE/)
  }
})

test('C06 API: fixed server scope, strict validation/methods/opaque rejection, policy generation and artifact', async t => {
  const h = await harness(t), fake = createFakeDsh(); let persona = 'persona-a'
  createRoutes({ ctx: fake.ctx, executionSandbox: h.service, cognition: { activePersonaId: () => persona } })
  t.after(() => fake.dispose())
  const call = (action, body, init) => fake.call('/onebot-qq/api/sandbox/' + action, body, { method: body === undefined ? 'GET' : 'POST', ...init })
  const status = await call('status'); assert.equal(status.json.state, 'ready')
  const input = { kind: 'execute', requestId: 'api-1', policyGeneration: status.json.policyGeneration, code: 'echo api' }
  const created = await call('jobs/create', input), id = created.json.job.id
  await waitFor(async () => (await call('jobs/detail?id=' + id)).json.job.state === 'succeeded')
  assert.equal((await call('artifact?id=' + id)).json.encoding, 'base64')
  assert.equal((await call('jobs/create', input)).json.reused, true)
  const audit = await call('audit')
  assert.equal(audit.status, 200); assert.ok(audit.json.items.some(row => row.id === id && row.state === 'succeeded'))
  assert.doesNotMatch(JSON.stringify(audit.json), /echo api|fake-output|principalId|scope/)
  for (const extra of [{ role: 'owner' }, { principalId: '1' }, { personaId: 'other' }, { env: {} }, { workspace: '/tmp' }, { chatType: 'group' }, { sessionId: 'a' }]) assert.equal((await call('jobs/create', { ...input, ...extra })).status, 400)
  for (const action of ['status', 'probe', 'audit', 'jobs', 'jobs/create', 'jobs/detail', 'jobs/cancel', 'artifact']) {
    for (const headers of [{ origin: 'null' }, { 'sec-fetch-dest': 'iframe' }]) assert.equal((await call(action, {}, { headers })).status, 403)
  }
  for (const query of ['status?x=y', 'jobs/detail?id=' + id + '&id=' + id, 'jobs?role=owner']) assert.equal((await call(query)).status, 400)
  for (const input of [[], 'malformed', { kind: 'other' }, { text: 'x'.repeat(100000) }]) assert.equal((await call('jobs/create', input)).status, 400)
  for (const requestId of [123, null, [], {}]) assert.equal((await call('jobs/create', { ...input, requestId })).status, 400)
  assert.equal((await call('jobs/create', { ...input, kind: ['execute'] })).status, 400)
  assert.equal((await call('jobs/create')).status, 405)
  assert.equal((await call('jobs/cancel', { id: 'unknown' })).status, 404)
  assert.equal((await call('probe', {})).status, 429)
  persona = 'other'
  assert.equal((await call('jobs/detail?id=' + id)).status, 404)
  assert.deepEqual((await call('jobs')).json.items, [])
  assert.doesNotMatch(JSON.stringify(status.json), /workspace\/|\/tmp|ownerQQ|principalId/)
})

test('C06 audit restart interrupts unfinished jobs and preserves completed idempotency', async t => {
  const h = await harness(t), input = await h.input(), created = await h.service.create(context, input)
  await h.terminal(created.job.id); await h.service.dispose()
  const recovered = createSandboxService({ root: h.root, getConfig: () => h.config, driver: fakeDriver() })
  t.after(() => recovered.dispose())
  await recovered.probe()
  assert.equal((await recovered.create(context, input)).job.id, created.job.id)
  const rows = JSON.parse(await readFile(join(h.root, 'audit', 'audit.json'), 'utf8'))
  const interrupted = { ...rows[0], id: 'job_00000000-0000-4000-8000-000000000000', state: 'running' }
  await createAudit({ root: join(h.root, 'audit') }).append(interrupted)
  const restarted = createSandboxService({ root: h.root, getConfig: () => h.config, driver: fakeDriver() })
  t.after(() => restarted.dispose())
  assert.equal((await restarted.detail(context, interrupted.id)).job.state, 'interrupted')
})


test('C06 re-enable requires new probe; driver failure still permits independently safe file jobs', async t => {
  const h = await harness(t)
  h.config.sandbox.enabled = false
  assert.equal((await h.service.status(context)).state, 'disabled')
  h.config.sandbox.enabled = true
  assert.equal((await h.service.status(context)).state, 'checking')
  await assert.rejects(h.create(), /SANDBOX_UNAVAILABLE/)
  await h.service.probe()
  assert.equal((await h.service.status(context)).state, 'ready')
  const failed = await h.create({ code: 'throw' }); await h.terminal(failed.job.id)
  assert.equal((await h.service.status(context)).state, 'failed')
  await assert.rejects(h.create(), /SANDBOX_UNAVAILABLE/)
  const { code, ...input } = await h.input({ kind: 'file.list' })
  const file = await h.service.create(context, input)
  assert.equal((await h.terminal(file.job.id)).state, 'succeeded')
})

test('C06 admission cap, retained-window eviction/tombstones and pre-execution audit failure', async t => {
  const h = await harness(t, { sandbox: { limits: { jobs: 2, concurrency: 1 } } })
  const first = await h.create({ code: 'hold-1' }); await waitFor(() => h.driver.active === 1)
  const second = await h.create({ code: 'hold-2' })
  await assert.rejects(h.create(), /SANDBOX_BUSY/)
  await h.service.cancel(context, second.job.id); await h.service.cancel(context, first.job.id)
  await h.terminal(first.job.id)
  const third = await h.create(); await h.terminal(third.job.id)
  assert.equal((await h.service.list(context)).items.length, 2)
  await assert.rejects(h.service.detail(context, first.job.id), /JOB_NOT_FOUND/)
  await h.service.dispose()
  const restored = createSandboxService({ root: h.root, getConfig: () => h.config, driver: fakeDriver() })
  t.after(() => restored.dispose())
  assert.equal((await restored.list(context)).items.length, 2)
  await assert.rejects(restored.detail(context, first.job.id), /JOB_NOT_FOUND/)
  let writes = 0
  const denied = await harness(t, { service: { audit: { load: async () => [], append: async () => { if (++writes > 1) throw Error('disk down') } } } })
  const job = await denied.create()
  assert.equal((await denied.terminal(job.job.id)).reason, 'AUDIT_UNAVAILABLE')
  assert.equal(denied.driver.calls.length, 0)
  assert.equal((await denied.service.status(context)).workspaceAvailable, false)
})
