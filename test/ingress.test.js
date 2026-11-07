import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createIngressCoordinator } from '../src/ingress/coordinator.js'
import { normalizeEvent } from '../src/gateway/normalize.js'

const acceptedOrder = ['access', 'ingestRaw', 'getConfig', 'normalize', 'push', 'observe', 'dispatch', 'emit']

function fixture(options = {}) {
  const calls = [], inputs = {}, logs = []
  const raw = { message_id: 42, token: 'raw-secret-marker', payload: { private: 'raw-only-marker' } }
  const config = { token: 'config-secret-marker' }
  const normalized = options.normalized === undefined
    ? Object.freeze({ kind: 'message', message: Object.freeze({ id: 42, text: 'hello' }) })
    : options.normalized
  const record = Object.freeze({ ...normalized, seq: 9, receivedAt: 123 })
  const pushed = options.pushed || { accepted: true, record }
  function call(name, ...args) {
    calls.push(name)
    inputs[name] = args
    if (options.fail === name) throw new Error(`${name} failed`)
  }
  const deps = {
    access: { decideRaw(value) { call('access', value); return options.gate || { allowed: true } } },
    cognition: {
      ingestRaw(value) { call('ingestRaw', value) },
      observe(value, meta) { call('observe', value, meta) },
    },
    events: { push(value) { call('push', value); return pushed } },
    modules: { dispatch(value) { call('dispatch', value); return options.dispatchPromise || Promise.resolve() } },
    ctx: { emit(...args) { call('emit', ...args) } },
    normalizeEvent(value, cfg) { call('normalize', value, cfg); return normalized },
    getConfig() { call('getConfig'); return config },
    logger: {
      debug(...args) { logs.push(['debug', ...args]) },
      warn(...args) { logs.push(['warn', ...args]) },
    },
  }
  return { ...createIngressCoordinator(deps), deps, calls, inputs, logs, raw, config, normalized, record }
}

test('ingress: denied access stops before raw archival, config and normalization', () => {
  const h = fixture({ gate: { allowed: false, chatType: 'group', chatId: '123', senderId: '456', reason: 'allowlist' } })
  assert.deepEqual(h.handleRaw(h.raw), { accepted: false, reason: 'allowlist', correlationId: '' })
  assert.deepEqual(h.calls, ['access'])
  assert.strictEqual(h.inputs.access[0], h.raw)
  assert.deepEqual(h.logs, [['debug', '访问拒绝：group:123/456（allowlist）']])
  const missing = fixture({ gate: { allowed: false, reason: 'denied' } })
  missing.handleRaw(missing.raw)
  assert.deepEqual(missing.logs, [['debug', '访问拒绝：?:?/?（denied）']])
})

test('ingress: unrecognized event is archived before normalization, without buffering or broadcast', () => {
  const h = fixture({ normalized: null })
  assert.deepEqual(h.handleRaw(h.raw), { accepted: false, reason: 'unrecognized', correlationId: '' })
  assert.deepEqual(h.calls, ['access', 'ingestRaw', 'getConfig', 'normalize'])
  assert.strictEqual(h.inputs.ingestRaw[0], h.raw)
  assert.strictEqual(h.inputs.normalize[0], h.raw)
  assert.strictEqual(h.inputs.normalize[1], h.config)
  assert.deepEqual(h.logs, [])
})

test('ingress: filtered events retain raw, push bookkeeping and observation without dispatch/broadcast', () => {
  const h = fixture({ pushed: { accepted: false, reason: 'ignoreUser' } })
  assert.deepEqual(h.handleRaw(h.raw), { accepted: false, reason: 'ignoreUser', correlationId: 42 })
  assert.deepEqual(h.calls, acceptedOrder.slice(0, 6))
  assert.strictEqual(h.inputs.push[0], h.normalized)
  assert.strictEqual(h.inputs.observe[0], h.normalized)
  assert.deepEqual(h.inputs.observe[1], { accepted: false, reason: 'ignoreUser' })
  assert.deepEqual(h.logs, [['debug', '事件被过滤：ignoreUser']])

  const record = { kind: 'notice', seq: 10 }
  const withRecord = fixture({ pushed: { accepted: false, record } })
  withRecord.handleRaw(withRecord.raw)
  assert.strictEqual(withRecord.inputs.observe[0], record)
  assert.deepEqual(withRecord.inputs.observe[1], { accepted: false, reason: '' })
  assert.deepEqual(withRecord.logs, [['debug', '事件被过滤：undefined']])
})

test('ingress: accepted event preserves exact order and record identity; dispatch never delays broadcast', async () => {
  let finish
  const pending = new Promise((resolve) => { finish = resolve })
  const h = fixture({ dispatchPromise: pending.then(() => h.calls.push('dispatch:done')) })
  const result = h.handleRaw(h.raw)
  assert.deepEqual(result, { accepted: true, reason: '', correlationId: 42 })
  assert.deepEqual(h.calls, acceptedOrder)
  assert.strictEqual(h.inputs.push[0], h.normalized)
  assert.strictEqual(h.inputs.observe[0], h.record)
  assert.deepEqual(h.inputs.observe[1], { accepted: true, reason: '' })
  assert.strictEqual(h.inputs.dispatch[0], h.record)
  assert.deepEqual(h.inputs.emit, ['onebot-qq/event', h.record])
  assert.strictEqual(h.inputs.emit[1], h.record)
  finish()
  await pending
  assert.deepEqual(h.calls, [...acceptedOrder, 'dispatch:done'])
  assert.deepEqual(h.logs, [])
})

for (const [fail, message] of [
  ['ingestRaw', '认知 raw 事件失败：'],
  ['observe', '认知 observe 失败：'],
  ['emit', '广播 onebot-qq/event 失败：'],
]) {
  test(`ingress: ${fail} exception is logged and remaining steps still run`, () => {
    const h = fixture({ fail })
    assert.equal(h.handleRaw(h.raw).accepted, true)
    assert.deepEqual(h.calls, acceptedOrder)
    assert.deepEqual(h.logs, [['warn', message, `${fail} failed`]])
  })
}

test('ingress: observe exception on a filtered event still logs filtering and returns', () => {
  const h = fixture({ fail: 'observe', pushed: { accepted: false, reason: 'kind' } })
  assert.equal(h.handleRaw(h.raw).accepted, false)
  assert.deepEqual(h.calls, acceptedOrder.slice(0, 6))
  assert.deepEqual(h.logs, [
    ['warn', '认知 observe 失败：', 'observe failed'],
    ['debug', '事件被过滤：kind'],
  ])
})

test('ingress: dispatch rejection is caught after synchronous broadcast, without retry', async () => {
  let reject
  const pending = new Promise((resolve, rejectPromise) => { reject = rejectPromise })
  const h = fixture({ dispatchPromise: pending })
  assert.equal(h.handleRaw(h.raw).accepted, true)
  assert.deepEqual(h.calls, acceptedOrder)
  assert.deepEqual(h.logs, [])
  reject(new Error('module failed'))
  await new Promise(setImmediate)
  assert.deepEqual(h.logs, [['warn', '模块事件分发失败：', 'module failed']])
  assert.deepEqual(h.calls, acceptedOrder)
})

for (const fail of ['access', 'getConfig', 'normalize', 'push', 'dispatch']) {
  test(`ingress: outer ${fail} error is logged and stops the remaining steps`, () => {
    const h = fixture({ fail })
    let result
    assert.doesNotThrow(() => { result = h.handleRaw(h.raw) })
    assert.deepEqual(h.calls, acceptedOrder.slice(0, acceptedOrder.indexOf(fail) + 1))
    assert.deepEqual(h.logs, [['warn', '处理 OneBot 事件失败：', `${fail} failed`]])
    // dispatch 同步抛错沿用旧宿主行为：已入缓冲，跳过 emit，由外层捕获。
    assert.equal(result.accepted, fail === 'dispatch')
  })
}

test('ingress: optional ctx.emit and per-event config reads retain host behavior', () => {
  const h = fixture()
  delete h.deps.ctx.emit
  h.handleRaw(h.raw)
  h.handleRaw(h.raw)
  assert.deepEqual(h.calls, [...acceptedOrder.slice(0, -1), ...acceptedOrder.slice(0, -1)])
  assert.deepEqual(h.logs, [])
})

test('ingress: correlation uses existing message/notice/request identifiers or stays empty', () => {
  for (const [normalized, id] of [
    [{ message: { id: 'message-1' } }, 'message-1'],
    [{ message: { id: 0 } }, 0],
    [{ notice: { messageId: 'recalled-2', flag: 'notice-3' } }, 'recalled-2'],
    [{ notice: { flag: 'notice-3' } }, 'notice-3'],
    [{ request: { flag: 'request-4' } }, 'request-4'],
    [{ kind: 'meta_event', time: 123, selfId: 'self' }, ''],
    [{ notice: { userId: 'user', groupId: 'group' } }, ''],
    [{ message: { id: '' } }, ''],
    [{ message: { id: null } }, ''],
    [{ request: {} }, ''],
  ]) {
    const h = fixture({ normalized: Object.freeze(normalized) })
    assert.equal(h.handleRaw(h.raw).correlationId, id)
    assert.equal(h.handleRaw(h.raw).correlationId, id)
    assert.equal('correlationId' in h.record, false)
  }
  const h = fixture()
  const accepted = h.handleRaw(h.raw)
  h.deps.access.decideRaw = () => ({ allowed: false, reason: 'denied' })
  assert.deepEqual(h.handleRaw(h.raw), { accepted: false, reason: 'denied', correlationId: '' })
  assert.deepEqual(accepted, { accepted: true, reason: '', correlationId: 42 })
})

test('ingress: envelope/raw/config secrets are never appended to public records or hook arguments', () => {
  const h = fixture()
  const before = structuredClone(h.record)
  const result = h.handleRaw(h.raw)
  assert.deepEqual(h.record, before)
  assert.deepEqual(h.normalized, { kind: 'message', message: { id: 42, text: 'hello' } })
  for (const value of [h.inputs.push, h.inputs.observe, h.inputs.dispatch, h.inputs.emit, result, h.logs]) {
    assert.doesNotMatch(JSON.stringify(value), /raw-secret-marker|raw-only-marker|config-secret-marker|"platform"|"version"|"normalized"/)
  }
  assert.deepEqual(Object.keys(result).sort(), ['accepted', 'correlationId', 'reason'])
  assert.equal('raw' in h.inputs.emit[1], false)
})

test('ingress: existing normalized raw field is preserved without copying the envelope into it', () => {
  const raw = { post_type: 'message', message_id: 7, message_type: 'private', user_id: 8, message: 'hi' }
  const normalized = normalizeEvent(raw, {})
  const h = fixture({ normalized })
  const record = { seq: 1, ...normalized }
  h.deps.events.push = () => ({ accepted: true, record })
  const result = h.handleRaw(raw)
  assert.equal(result.correlationId, 7)
  assert.strictEqual(h.inputs.emit[1], record)
  assert.strictEqual(record.raw, normalized.raw)
  assert.strictEqual(record.raw, raw)
  assert.deepEqual(record, { seq: 1, ...normalizeEvent(raw, {}) })
})

test('ingress: content-free aggregates count admission/rejection/filtering and isolate clock failure', () => {
  const h = fixture()
  h.handleRaw(h.raw)
  h.deps.access.decideRaw = () => ({ allowed: false, reason: 'PRIVATE_REASON' })
  h.handleRaw(h.raw)
  const counts = h.stats()
  assert.equal(counts.received, 2)
  assert.equal(counts.admitted, 1)
  assert.equal(counts.rejected, 1)
  assert.ok(counts.firstAt <= counts.lastAt)
  assert.doesNotMatch(JSON.stringify(counts), /PRIVATE_|raw-secret|reason|chatId/)
  counts.rejected = 100
  assert.equal(h.stats().rejected, 1)
  const filtered = fixture({ pushed: { accepted: false, reason: 'filter' } })
  filtered.handleRaw(filtered.raw)
  assert.equal(filtered.stats().filtered, 1)
  const broken = createIngressCoordinator({ ...h.deps, access: { decideRaw: () => ({ allowed: true }) }, clock: { now() { throw Error('observer') } } })
  assert.equal(broken.handleRaw(h.raw).accepted, true)
})
