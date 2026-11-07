import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModuleKernel } from '../src/modules/kernel.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh, waitFor } from './helpers/fake-dsh.js'

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-closed-loop-acceptance-'))
  const apis = []
  let stops = 0
  const kernel = createModuleKernel({ dataDir: root, registry: [{
    manifest: { id: 'builtin-worker', permissions: [] }, defaultEnabled: true,
    load: () => ({ setup(api) {
      apis.push(api)
      api.health.report({ state: apis.length === 1 ? 'unhealthy' : 'healthy', result: apis.length === 1 ? 'failure' : 'success', reasonCode: apis.length === 1 ? 'ENGINE_FAILED' : undefined })
      return () => { stops++ }
    } }),
  }] })
  const fake = createFakeDsh()
  createRoutes({ ctx: fake.ctx, modules: kernel })
  t.after(async () => { fake.dispose(); await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  const call = async (path, body, headers) => fake.call('/onebot-qq/api/modules/' + path, body, { method: body ? 'POST' : 'GET', headers })
  const catalog = (await call('actions?id=builtin-worker')).json
  const input = { moduleId: catalog.moduleId, actionId: 'module.restart', expectedGeneration: catalog.expectedGeneration, requestId: 'acceptance-restart' }
  return { kernel, apis, call, input, stops: () => stops }
}

test('C08: unhealthy -> read-only HTTP observation -> explicit restart -> stale telemetry rejection', async t => {
  const h = await harness(t)
  const initial = (await h.call('health?id=builtin-worker')).json
  assert.equal(initial.items[0].lifecycle, 'loaded')
  assert.equal(initial.items[0].health, 'unhealthy')
  for (let i = 0; i < 5; i++) {
    assert.equal((await h.call('health')).json.revision, initial.revision)
    await h.call('actions?id=builtin-worker')
    assert.equal((await h.call('operation?requestId=absent')).json.code, 'MODULE_OPERATION_NOT_FOUND')
    await new Promise(setImmediate)
  }
  assert.equal(h.apis.length, 1, 'health/action/operation reads must not recover an unhealthy runtime')
  assert.equal(h.stops(), 0)
  const accepted = (await h.call('action', h.input)).json
  assert.equal(accepted.ok, true)
  const operation = await waitFor(async () => {
    const value = (await h.call('operation?id=' + accepted.operation.id)).json.operation
    return value.completedAt ? value : null
  }, { label: 'C08 manual restart' })
  assert.equal(operation.status, 'succeeded')
  assert.equal(h.apis.length, 2); assert.equal(h.stops(), 1)
  const current = (await h.call('health?id=builtin-worker')).json
  assert.equal(current.items[0].health, 'healthy')
  assert.notEqual(current.items[0].runtimeGeneration, initial.items[0].runtimeGeneration)
  assert.equal(h.apis[0].health.report({ state: 'unhealthy', result: 'failure', reasonCode: 'ENGINE_FAILED' }), false)
  assert.equal((await h.call('health')).json.revision, current.revision)
  assert.equal((await h.call('action', { ...h.input, requestId: 'stale-new-request' })).json.code, 'MODULE_RUNTIME_CONFLICT')
  assert.equal((await h.call('action', h.input)).json.operation.id, accepted.operation.id)
  assert.equal(h.apis.length, 2); assert.equal(h.stops(), 1)
})

test('C08: sandbox frames cannot read health/actions/operations or admit a valid restart', async t => {
  const h = await harness(t)
  const before = h.kernel.health()
  const calls = []
  for (const method of ['health', 'actions', 'getOperation', 'action']) {
    const original = h.kernel[method]
    t.mock.method(h.kernel, method, (...args) => { calls.push(method); return original(...args) })
  }
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'script' }]) {
    for (const [path, body] of [['health?id=builtin-worker'], ['actions?id=builtin-worker'], ['operation?requestId=absent'], ['action', h.input]]) {
      const response = await h.call(path, body, headers)
      assert.equal(response.status, 403, path)
      assert.equal(response.json.ok, false)
      assert.equal(response.headers['access-control-allow-origin'], undefined)
    }
  }
  assert.deepEqual(calls, [], 'reject before entering the module management API')
  assert.equal(h.apis.length, 1); assert.equal(h.stops(), 0)
  assert.equal(h.kernel.getOperation({ requestId: h.input.requestId }).code, 'MODULE_OPERATION_NOT_FOUND')
  assert.deepEqual(h.kernel.health().items, before.items)
})
