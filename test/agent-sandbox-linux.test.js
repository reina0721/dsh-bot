import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile, mkdir, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createLocalLinuxDriver } from '../src/sandbox/drivers/local-linux.js'
import { createSandboxService } from '../src/sandbox/service.js'
import { normalizeSandbox } from '../src/sandbox/policy.js'

// These tests NEVER substitute a fake driver. Absence of real capabilities is
// reported as a skip, with a real service assertion that execution is refused.
test('C06 real Linux containment (capability-aware; no mock evidence)', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-real-sandbox-'))
  const driver = createLocalLinuxDriver({ root: join(root, 'driver') })
  const config = { sandbox: normalizeSandbox({ enabled: true }), access: { ownerQQ: '1' } }
  const context = { personaId: 'real', principalId: '1', chatType: 'private', chatId: '1', sessionId: 'real' }
  const service = createSandboxService({ root, driver, getConfig: () => config })
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }) })
  const prior = process.env.DSH_SANDBOX_CANARY
  process.env.DSH_SANDBOX_CANARY = 'SECRET_HOST_ENV_CANARY'
  t.after(() => { if (prior === undefined) delete process.env.DSH_SANDBOX_CANARY; else process.env.DSH_SANDBOX_CANARY = prior })
  const probe = await service.probe(), status = await service.status(context)
  let cgroupEvidence = 'not-linux'
  if (process.platform === 'linux') {
    const membership = (await readFile('/proc/self/cgroup', 'utf8')).trim().match(/^0::(.*)$/)?.[1]
    const path = join('/sys/fs/cgroup', membership || '/', 'dsh-test-' + randomUUID())
    try { await mkdir(path); await rmdir(path); cgroupEvidence = 'delegation-writable (driver probe also verifies controllers/kill)' }
    catch (e) { cgroupEvidence = 'delegation-unavailable:' + e.code }
  }
  t.diagnostic(`real driver: ${probe.state}/${probe.reason}; cgroup: ${cgroupEvidence}`)
  if (probe.state !== 'ready') {
    assert.equal(status.state, 'unavailable')
    await assert.rejects(service.create(context, { kind: 'execute', requestId: 'refused', policyGeneration: status.policyGeneration, code: 'echo forbidden' }), /SANDBOX_UNAVAILABLE/)
    for (const name of ['namespace/rootfs/network/env canary', 'output cap', 'memory cap', 'process cap/tree cleanup', 'timeout', 'cancel', 'workspace snapshot readonly/tmpfs quota']) {
      await t.test(name, st => st.skip(`${probe.reason}; ${cgroupEvidence}; execution refused, containment NOT demonstrated`))
    }
    return
  }
  const run = (code, limits = {}, signal) => driver.execute({ code, limits: { timeoutMs: 5000, outputBytes: 4096, memoryMiB: 32, processes: 8, ...limits }, signal })
  await t.test('namespace/rootfs/network/env canary', async () => {
    const result = await run('test ! -e /etc/passwd && test ! -e /home && test ! -e /sys && test ! -e /root && test ! -e /workspace/dsh-bot && test ! -e /var/run/docker.sock && test ! -e /run && test ! -e /proc/self/mountinfo && test "$$" -eq 2 && /bin/env')
    assert.equal(result.exitCode, 0); assert.equal(result.isolated, true)
    assert.doesNotMatch(result.output, /SECRET_HOST_ENV_CANARY|DSH_SANDBOX_CANARY|DSH_HOME|API_KEY/)
    assert.match(result.output, /HOME=\/work/)
    assert.doesNotMatch(result.output, /eth0/)
  })
  await t.test('output cap', async () => { const r = await run('/bin/yes output'); assert.equal(r.reason, 'OUTPUT_LIMIT'); assert.ok(Buffer.byteLength(r.output) <= 4096) })
  await t.test('memory cap', async () => { const r = await run('x=xxxxxxxxxxxxxxxx; while :; do x=$x$x; done'); assert.equal(r.reason, 'MEMORY_LIMIT') })
  await t.test('process cap/tree cleanup', async () => {
    const r = await run('exec 2>/dev/null; i=0; while [ "$i" -lt 64 ]; do /bin/sleep 10 & i=$((i+1)); done; wait')
    assert.equal(r.reason, 'PROCESS_LIMIT')
    const orphan = await run('/bin/sleep 30 >/dev/null 2>&1 & printf tree-cleaned')
    assert.equal(orphan.reason, 'EXITED'); assert.equal(orphan.output, 'tree-cleaned')
    // execute() verifies populated=0 and removes its cgroup before returning.
  })
  await t.test('timeout', async () => { const r = await run('/bin/sleep 30', { timeoutMs: 100 }); assert.equal(r.reason, 'TIMEOUT') })
  await t.test('cancel', async () => {
    const ctl = new AbortController(), result = run('/bin/sleep 30', {}, ctl.signal)
    setTimeout(() => ctl.abort(), 100)
    assert.equal((await result).reason, 'CANCELLED')
  })
  await t.test('workspace snapshot readonly/tmpfs quota', async () => {
    const snapshot = join(root, 'snapshot'); await mkdir(snapshot)
    const r = await driver.execute({ code: 'test ! -w /workspace && /bin/head -c 70000000 /dev/zero > /work/large; /bin/wc -c /work/large', snapshot, limits: { timeoutMs: 5000, outputBytes: 4096, memoryMiB: 128, processes: 8 } })
    assert.match(r.output, /No space left on device/)
    assert.match(r.output, /67108864/)
  })
})
