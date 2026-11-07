import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createOutbound } from '../src/cognition/outbound.js'
import { createAccess, normalizeAccess } from '../src/core/access.js'

function policyStub({ rateOk = true } = {}) {
  const calls = { sent: [], failed: [], rate: [] }
  return {
    calls,
    canSend(chatType, chatId) {
      calls.rate.push([chatType, chatId])
      return rateOk ? { ok: true } : { ok: false, reason: 'chat_rate_limit' }
    },
    markSent(decisionId, info) {
      calls.sent.push([decisionId, info])
    },
    markFailed(decisionId, message) {
      calls.failed.push([decisionId, message])
    },
  }
}

function gatewayStub({ fail = false } = {}) {
  const calls = []
  return {
    calls,
    actions: {
      async sendMessage(payload) {
        calls.push(payload)
        if (fail) throw new Error('mock gateway down')
        return { message_id: 424242 }
      },
    },
  }
}

test('outbound：正常发送走统一入口并记录 policy/access', async () => {
  const gw = gatewayStub()
  const policy = policyStub()
  const access = createAccess({ getConfig: () => ({ access: normalizeAccess({ mode: 'open' }) }) })
  const outbound = createOutbound({ getConfig: () => ({ cognition: { dryRun: false } }), gateway: gw, policy, access })
  const result = await outbound.deliver({
    chatType: 'group', chatId: '20001', segments: [{ type: 'text', data: { text: 'hi' } }], decisionId: 'd1',
  })
  assert.equal(result.ok, true)
  assert.equal(result.messageId, '424242')
  assert.equal(gw.calls.length, 1)
  assert.deepEqual(gw.calls[0], { chatType: 'group', chatId: '20001', message: [{ type: 'text', data: { text: 'hi' } }] })
  assert.deepEqual(policy.calls.sent, [['d1', { messageId: '424242' }]])
  assert.equal(access.counters().sent, 1)
  assert.equal(outbound.stats().sent, 1)
})

test('outbound：allowlist 外目标被访问控制拒绝，网关不调用', async () => {
  const gw = gatewayStub()
  const access = createAccess({
    getConfig: () => ({ access: normalizeAccess({ mode: 'allowlist', ownerQQ: '10001', groups: ['20001'] }) }),
  })
  const outbound = createOutbound({
    getConfig: () => ({ cognition: { dryRun: false }, access: normalizeAccess({ mode: 'allowlist', ownerQQ: '10001', groups: ['20001'] }) }),
    gateway: gw, policy: policyStub(), access,
  })
  const result = await outbound.deliver({ chatType: 'group', chatId: '20002', segments: 'hello', decisionId: 'd2' })
  assert.equal(result.ok, false)
  assert.equal(result.blocked, true)
  assert.equal(result.error, 'ACCESS_DENIED')
  assert.equal(gw.calls.length, 0)
  assert.equal(access.counters().outboundBlocked, 1)
  assert.equal(outbound.stats().blocked, 1)
})

test('outbound：dryRun 不发送、标记 dryRun、计数', async () => {
  const gw = gatewayStub()
  const policy = policyStub()
  const access = createAccess({ getConfig: () => ({ access: normalizeAccess({ mode: 'open' }) }) })
  const outbound = createOutbound({ getConfig: () => ({ cognition: { dryRun: true } }), gateway: gw, policy, access })
  const result = await outbound.deliver({ chatType: 'private', chatId: '10001', segments: 'hi', decisionId: 'd3' })
  assert.equal(result.ok, true)
  assert.equal(result.dryRun, true)
  assert.equal(gw.calls.length, 0)
  assert.deepEqual(policy.calls.sent, [['d3', { dryRun: true }]])
  assert.equal(outbound.stats().dryRuns, 1)
  assert.equal(access.counters().dryRuns, 1)
})

test('outbound：频率上限拒绝，网关不调用', async () => {
  const gw = gatewayStub()
  const outbound = createOutbound({
    getConfig: () => ({ cognition: { dryRun: false } }), gateway: gw, policy: policyStub({ rateOk: false }),
  })
  const result = await outbound.deliver({ chatType: 'group', chatId: '20001', segments: 'hi', decisionId: 'd4' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'RATE_LIMITED')
  assert.equal(gw.calls.length, 0)
  assert.equal(outbound.stats().rateLimited, 1)
})

test('outbound：网关失败标记 failed，不重试', async () => {
  const gw = gatewayStub({ fail: true })
  const policy = policyStub()
  const access = createAccess({ getConfig: () => ({ access: normalizeAccess({ mode: 'open' }) }) })
  const outbound = createOutbound({ getConfig: () => ({ cognition: { dryRun: false } }), gateway: gw, policy, access })
  const result = await outbound.deliver({ chatType: 'group', chatId: '20001', segments: 'hi', decisionId: 'd5' })
  assert.equal(result.ok, false)
  assert.equal(result.error, 'SEND_FAILED')
  assert.equal(gw.calls.length, 1, '只发一次，不自动重试')
  assert.deepEqual(policy.calls.failed, [['d5', 'send_failed']])
  assert.equal(outbound.stats().failed, 1)
  assert.equal(access.counters().outboundFailed, 1)
})

test('outbound：非法目标/空消息/网关不可用', async () => {
  const gw = gatewayStub()
  const outbound = createOutbound({ getConfig: () => ({ cognition: { dryRun: false } }), gateway: gw })
  assert.equal((await outbound.deliver({ chatType: 'group', chatId: '', segments: 'x' })).error, 'INVALID_TARGET')
  assert.equal((await outbound.deliver({ chatType: 'group', chatId: '1', segments: [] })).error, 'EMPTY_MESSAGE')
  const offline = createOutbound({ getConfig: () => ({ cognition: { dryRun: false } }), gateway: {} })
  assert.equal((await offline.deliver({ chatType: 'group', chatId: '1', segments: 'x' })).error, 'GATEWAY_UNAVAILABLE')
  assert.equal(gw.calls.length, 0)
})

const leakKey = 'sk-' + 'Ab1_'.repeat(12)

test('outbound: default redaction sends clean text after rate check and reports no categories', async () => {
  const gw = gatewayStub(), policy = policyStub(), logs = []
  const outbound = createOutbound({ gateway: gw, policy, logger: { warn: (...args) => logs.push(args) } })
  const input = [{ type: 'text', data: { text: 'key: ' + leakKey } }]
  const result = await outbound.deliver({ chatType: 'private', chatId: '1', segments: input, decisionId: 'leak1' })
  assert.equal(result.leakGuard, 'redacted')
  assert.equal(gw.calls[0].message[0].data.text, 'key: [REDACTED]')
  assert.equal(input[0].data.text, 'key: ' + leakKey)
  assert.equal(policy.calls.rate.length, 1)
  assert.equal(policy.calls.sent.length, 1)
  assert.ok(!JSON.stringify([result, logs, outbound.stats()]).includes(leakKey))
  assert.ok(!('detections' in result))
})

test('outbound: block and malformed text fail closed, count attempts, never call gateway', async () => {
  const gw = gatewayStub(), policy = policyStub()
  const outbound = createOutbound({ getConfig: () => ({ security: { leakGuard: { action: 'block' } } }), gateway: gw, policy })
  for (const segments of [leakKey, [{ type: 'text', data: { text: { secret: leakKey } } }]]) {
    assert.deepEqual(await outbound.deliver({ chatType: 'private', chatId: '1', segments }), { ok: false, error: 'LEAK_BLOCKED' })
  }
  assert.equal(outbound.stats().leakBlocked, 2)
  assert.equal(policy.calls.rate.length, 2)
  assert.equal(policy.calls.sent.length, 0)
  assert.equal(gw.calls.length, 0)
})

test('outbound: disabled guard passes text; dry-run scans/redacts or blocks without sending', async () => {
  const gw = gatewayStub()
  let config = { security: { leakGuard: { enabled: false } } }
  const outbound = createOutbound({ getConfig: () => config, gateway: gw })
  assert.equal((await outbound.deliver({ chatType: 'private', chatId: '1', segments: leakKey })).leakGuard, undefined)
  assert.equal(gw.calls[0].message[0].data.text, leakKey)
  config = { cognition: { dryRun: true } }
  const dry = await outbound.deliver({ chatType: 'private', chatId: '1', segments: leakKey })
  assert.equal(dry.dryRun, true)
  assert.equal(dry.leakGuard, 'redacted')
  config.security = { leakGuard: { action: 'block' } }
  assert.equal((await outbound.deliver({ chatType: 'private', chatId: '1', segments: leakKey })).error, 'LEAK_BLOCKED')
  assert.equal(gw.calls.length, 1)
  assert.equal(outbound.stats().dryRuns, 1)
})

test('outbound: access/rate refusal precedes leak scanning', async () => {
  const gw = gatewayStub(), logs = [], policy = policyStub({ rateOk: false })
  const options = { gateway: gw, policy, logger: { warn: (...args) => logs.push(args) } }
  const rate = createOutbound(options)
  assert.equal((await rate.deliver({ chatType: 'group', chatId: '1', segments: leakKey })).error, 'RATE_LIMITED')
  const access = createOutbound({ ...options, access: { canSend: () => ({ allowed: false, reason: 'test' }) } })
  assert.equal((await access.deliver({ chatType: 'group', chatId: '1', segments: leakKey })).error, 'ACCESS_DENIED')
  assert.equal(policy.calls.rate.length, 1)
  assert.equal(logs.length, 0)
  assert.equal(gw.calls.length, 0)
})

test('outbound: gateway errors never echo secrets into results, logs or policy', async () => {
  const logs = [], policy = policyStub()
  const gateway = { actions: { sendMessage: async () => { throw new Error('provider echoed ' + leakKey + ' ghp_' + 'x'.repeat(36)) } } }
  const outbound = createOutbound({ gateway, policy, logger: { warn: (...args) => logs.push(args) } })
  const result = await outbound.deliver({ chatType: 'private', chatId: '1', segments: 'hello', decisionId: 'err' })
  assert.equal(result.error, 'SEND_FAILED')
  assert.equal(result.message, 'send_failed')
  assert.ok(!JSON.stringify([result, logs, policy.calls, outbound.stats()]).includes(leakKey))
})

test('outbound: direct attempts record gates/dryRun/transport result without parent or private content', async t => {
  const { loopHarness } = await import('./helpers/loop.js')
  const h = loopHarness(t)
  for (const [error, options] of [
    ['ACCESS_DENIED', { access: { canSend: () => ({ allowed: false, reason: 'PRIVATE_REASON' }) } }],
    ['RATE_LIMITED', { policy: { canSend: () => ({ ok: false, reason: 'PRIVATE_REASON' }) } }],
    ['SEND_FAILED', { gateway: { actions: { sendMessage() { throw Error('PRIVATE_ERROR') } } } }],
    [null, { getConfig: () => ({ cognition: { dryRun: true } }) }],
  ]) {
    h.advance(1)
    const outbound = createOutbound({ observer: h.observer, ...options })
    await outbound.deliver({ chatType: 'private', chatId: 'PRIVATE_TARGET', segments: 'PRIVATE_BODY' })
    const row = h.receipts().find(row => row.recordedAt === h.clock.now())
    assert.equal(row.data.errorCode, error)
    assert.equal(row.data.parts, 0)
    assert.equal(row.data.status, error ? 'failed' : 'dry_run')
    assert.equal(row.loopId, null)
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_/)
  }
  assert.equal(h.loops().length, 0)
})
