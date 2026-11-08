import { test } from 'node:test'
import assert from 'node:assert/strict'
import { constants } from 'node:fs'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { channel } from 'node:diagnostics_channel'
import { createLocalMacosDriver } from '../src/sandbox/drivers/local-macos.js'
import { UNPROVEN_ENFORCEMENT } from '../src/sandbox/driver-contract.js'
import { createSandboxService } from '../src/sandbox/service.js'
import { bootstrapSandbox } from '../src/sandbox/bootstrap.js'
import { createSandboxApi } from '../src/sandbox/api.js'
import { NETWORK_POLICY, normalizeSandbox, validateJob, effectivePolicy, deriveScope } from '../src/sandbox/policy.js'
import { defaultConfig, normalizeConfig } from '../src/core/config.js'
import { createSandboxChatApi } from '../src/http/sandbox-chat.js'
import { createSimulationService } from '../src/simulation/service.js'
import { REAL_MODEL_PREVIEW_STATUS } from '../src/simulation/preview-contract.js'

const context = { personaId: 'p1', principalId: '1', chatType: 'private', chatId: '1', sessionId: 'p1' }
const config = () => ({ sandbox: normalizeSandbox({ enabled: true }), access: { ownerQQ: '1', operators: ['2'] } })
const stat = overrides => ({ isFile: () => true, uid: 0, mode: 0o100755, ...overrides })
const missing = () => { throw Object.assign(Error('private host path'), { code: 'ENOENT' }) }
async function rootFor(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-p1-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

// Fake filesystem observations test discovery/fail-closed semantics only.
// They do not run Seatbelt and are never evidence of OS containment.
test('C08 macOS fake probe: fixed trusted binary, no claimed enforcement, execute always refuses', async () => {
  const calls = []
  const driver = createLocalMacosDriver({ platform: 'darwin', filesystem: {
    lstat: async path => { calls.push(['lstat', path]); return stat() },
    access: async (path, mode) => { calls.push(['access', path, mode]) },
  } })
  await assert.rejects(driver.execute({ code: 'echo must-not-run' }), /DRIVER_UNAVAILABLE/)
  assert.deepEqual(calls, [])
  assert.deepEqual(await driver.probe(), { ready: false, reason: 'RESOURCE_LIMITS_UNPROVEN', seatbeltAvailable: true, enforcement: UNPROVEN_ENFORCEMENT })
  assert.deepEqual(calls, [['lstat', '/usr/bin/sandbox-exec'], ['access', '/usr/bin/sandbox-exec', constants.X_OK]])
  await assert.rejects(driver.execute({ code: 'echo must-not-run' }), /DRIVER_UNAVAILABLE/)
  assert.equal(calls.length, 2)
  await driver.dispose()
  assert.equal((await driver.probe()).reason, 'DRIVER_UNAVAILABLE')
})

test('C08 macOS fake probe: missing, unsafe, denied and unsupported paths stay unavailable', async () => {
  const cases = [
    { lstat: missing, reason: 'SEATBELT_MISSING' },
    ...[{ uid: 501 }, { mode: 0o100777 }, { mode: 0o104755 }, { mode: 0o102755 }, { isFile: () => false }]
      .map(value => ({ lstat: async () => stat(value), reason: 'SEATBELT_UNSAFE' })),
    { lstat: async () => stat(), access: () => { throw Object.assign(Error('secret'), { code: 'EACCES' }) }, reason: 'SEATBELT_UNSAFE' },
    { lstat: () => { throw Error('secret') }, reason: 'SEATBELT_UNSAFE' },
  ]
  for (const item of cases) {
    const driver = createLocalMacosDriver({ platform: 'darwin', filesystem: { access: async () => assert.fail('unsafe binary must not be used'), ...item } })
    const probe = await driver.probe()
    assert.equal(probe.reason, item.reason)
    assert.equal(probe.ready, false); assert.equal(probe.seatbeltAvailable, false)
    assert.deepEqual(probe.enforcement, UNPROVEN_ENFORCEMENT)
    assert.doesNotMatch(JSON.stringify(probe), /secret|private host path/)
    await assert.rejects(driver.execute({}), /DRIVER_UNAVAILABLE/)
  }
  const driver = createLocalMacosDriver({ platform: 'win32', filesystem: { lstat: () => assert.fail('wrong platform must not inspect host') } })
  assert.equal((await driver.probe()).reason, 'UNSUPPORTED_PLATFORM')
})

test('C08 macOS discovery reaches broker status; execution refused, workspace independent, matrix unchanged', async t => {
  const root = await rootFor(t), cfg = config()
  const driver = createLocalMacosDriver({ platform: 'darwin', filesystem: { lstat: async () => stat(), access: async () => {} } })
  const service = createSandboxService({ root, driver, getConfig: () => cfg })
  t.after(() => service.dispose())
  assert.deepEqual(await service.probe(), { state: 'unavailable', reason: 'RESOURCE_LIMITS_UNPROVEN' })
  const status = await service.status(context)
  assert.equal(status.driver, 'local-macos')
  assert.deepEqual(status.driverCapabilities, { seatbeltAvailable: true, enforcement: UNPROVEN_ENFORCEMENT })
  assert.deepEqual(status.networkPolicy, NETWORK_POLICY)
  await assert.rejects(service.create(context, { kind: 'execute', code: 'echo forbidden', requestId: 'deny', policyGeneration: status.policyGeneration }), /SANDBOX_UNAVAILABLE/)
  assert.deepEqual((await service.list(context)).items, [])
  assert.equal(status.workspaceAvailable, true)
  assert.deepEqual(status.capabilities, ['workspace', 'execute'])
  for (const patch of [{ principalId: '2' }, { principalId: '3' }, { chatType: 'group' }]) {
    const denied = await service.status({ ...context, ...patch })
    assert.deepEqual(denied.capabilities, [])
    await assert.rejects(service.create({ ...context, ...patch }, { kind: 'file.list', requestId: 'denied', policyGeneration: status.policyGeneration }), /POLICY_DENIED/)
  }
  const scoped = effectivePolicy(cfg, deriveScope(cfg, context))
  assert.deepEqual(scoped.networkPolicy, NETWORK_POLICY)
  status.driverCapabilities.enforcement.memory = true
  assert.equal((await service.status(context)).driverCapabilities.enforcement.memory, false)
  cfg.sandbox.driver = 'unavailable'
  assert.equal((await service.status(context)).driverCapabilities, null)
})

test('C08 network requests rejected before admission; no host-network fallback or network I/O', async t => {
  const root = await rootFor(t), cfg = config(), calls = []
  // Fake ready is used only to ensure rejection is independent of readiness.
  const driver = { name: 'fake-admission-only', probe: async () => ({ ready: true }), execute: async input => { calls.push(input); assert.fail('network job reached driver') } }
  const service = createSandboxService({ root, driver, getConfig: () => cfg })
  t.after(() => service.dispose())
  await service.probe()
  const api = createSandboxApi({ service, currentPersonaId: () => 'p1' })
  const status = await api.handle('status', {})
  assert.equal(status.body.network, false); assert.deepEqual(status.body.networkPolicy, NETWORK_POLICY)
  const input = { kind: 'execute', code: 'curl https://example.invalid', requestId: 'network', policyGeneration: status.body.policyGeneration }
  let network = 0
  const listener = () => network++
  for (const name of ['undici:request:create', 'http.client.request.start', 'net.client.socket']) {
    channel(name).subscribe(listener); t.after(() => channel(name).unsubscribe(listener))
  }
  for (const requested of [true, false, 'host', { mode: 'controlled', allow: ['example.invalid'] }, null]) {
    const rejected = await api.handle('create', { ...input, network: requested })
    assert.equal(rejected.status, 400); assert.equal(rejected.body.code, 'NETWORK_POLICY_UNSUPPORTED')
    assert.throws(() => validateJob({ ...input, network: requested }), /NETWORK_POLICY_UNSUPPORTED/)
  }
  for (const requested of [true, 'host', { mode: 'controlled' }, null]) {
    assert.throws(() => normalizeSandbox({ network: requested }), /NETWORK_POLICY_UNSUPPORTED/)
    assert.throws(() => normalizeConfig({ sandbox: { network: requested } }), /NETWORK_POLICY_UNSUPPORTED/)
  }
  assert.equal(defaultConfig().sandbox.network, false)
  assert.deepEqual((await service.list(context)).items, [])
  assert.deepEqual(calls, []); assert.equal(network, 0)
})

test('C08 real macOS probe is capability-aware; no execution or containment claim', async t => {
  const root = await rootFor(t), marker = join(root, 'must-not-exist')
  const driver = createLocalMacosDriver()
  t.after(() => driver.dispose())
  const probe = await driver.probe()
  t.diagnostic(`real macOS discovery: ${process.platform}/${probe.reason}; Seatbelt containment/resource enforcement NOT demonstrated`)
  assert.equal(probe.ready, false)
  assert.deepEqual(probe.enforcement, UNPROVEN_ENFORCEMENT)
  if (process.platform !== 'darwin') assert.equal(probe.reason, 'UNSUPPORTED_PLATFORM')
  else assert.ok(['SEATBELT_MISSING', 'SEATBELT_UNSAFE', 'RESOURCE_LIMITS_UNPROVEN'].includes(probe.reason))
  await assert.rejects(driver.execute({ code: `touch '${marker}'` }), /DRIVER_UNAVAILABLE/)
  await assert.rejects(access(marker), { code: 'ENOENT' })
  await t.test('real Seatbelt containment/resource enforcement', st => st.skip(`${probe.reason}; discovery only, execution intentionally unavailable`))
})

test('C08 bootstrap honors explicit macOS and unavailable selection, never substitutes Linux/host execution', async t => {
  const root = await rootFor(t), cfg = config()
  cfg.sandbox.driver = 'local-macos'
  const service = bootstrapSandbox({ root, getConfig: () => cfg })
  t.after(() => service.dispose())
  await service.probe()
  const status = await service.status(context)
  assert.equal(status.driver, 'local-macos'); assert.equal(status.state, 'unavailable')
  await assert.rejects(service.create(context, { kind: 'execute', code: 'echo forbidden', requestId: 'deny', policyGeneration: status.policyGeneration }), /SANDBOX_UNAVAILABLE/)
  cfg.sandbox.driver = 'unavailable'
  await service.probe()
  assert.equal((await service.status(context)).driver, 'unavailable')
  assert.equal((await service.status(context)).reason, 'DRIVER_UNAVAILABLE')
})

test('C08 real-model preview is typed contract/status only; Chat rejects attempted opt-in and retains zero network', async t => {
  const root = await rootFor(t)
  const simulations = createSimulationService({ dataRoot: root })
  t.after(() => simulations.dispose())
  const api = createSandboxChatApi({ simulations, currentPersonaId: () => 'p1' })
  let network = 0
  const listener = () => network++
  for (const name of ['undici:request:create', 'http.client.request.start', 'net.client.socket']) {
    channel(name).subscribe(listener); t.after(() => channel(name).unsubscribe(listener))
  }
  for (const patch of [{ model: 'live' }, { preview: true }, { approved: true }, { realModelPreview: true }, { network: true }]) {
    const denied = await api.handle('create', { requestId: 'forbidden', ...patch })
    assert.equal(denied.status, 400)
    assert.deepEqual(denied.body.realModelPreview, REAL_MODEL_PREVIEW_STATUS)
  }
  const created = await api.handle('create', { requestId: 'offline' })
  assert.equal(created.status, 200)
  assert.equal(created.body.configSnapshot.model, 'fixture/offline')
  assert.deepEqual(created.body.realModelPreview, { available: false, reason: 'REAL_MODEL_PREVIEW_UNAVAILABLE', implementation: 'contract-only' })
  assert.equal(created.body.realSends, 0)
  const event = await api.handle('event', { requestId: 'live-event', id: created.body.id, event: { kind: 'message', chatType: 'private', text: 'hello', preview: true } })
  assert.equal(event.status, 400)
  const unavailable = await api.handle('preview', { requestId: 'preview', id: created.body.id, approved: true })
  assert.equal(unavailable.status, 400)
  assert.equal((await api.handle('advance', { requestId: 'advance', id: created.body.id, ms: 120000 })).body.realSends, 0)
  assert.equal(network, 0)
})
