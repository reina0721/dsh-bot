import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPipeline } from '../src/cognition/pipeline.js'
import { createTurnHooks } from '../src/cognition/turn-hooks.js'

const turn = { id: 'turn', chatType: 'private', chatId: '10001', senderId: '10001', text: '/status' }

function harness({ turnHooks = null, typingEnabled = true, failure = null } = {}) {
  const calls = []
  const pipeline = createPipeline({
    turnHooks,
    getConfig: () => ({ cognition: { enabled: true, typing: { enabled: typingEnabled } } }),
    clock: { now() { if (failure) { calls.push('process'); throw failure } return 42 } },
    gateway: { actions: { async setInputStatus(id, event) { await new Promise(setImmediate); calls.push([id, event]) } } },
    commands: { async handle() { if (failure) return null; calls.push('process'); return { handled: true, reply: 'ok' } } },
  })
  return { pipeline, calls }
}

test('pipeline: null turn hooks preserve awaited legacy typing', async () => {
  const { pipeline, calls } = harness()
  const result = await pipeline.handleTurn(turn)
  assert.equal(result.reply, 'ok')
  assert.deepEqual(calls, [['10001', 1], 'process', ['10001', 2]])
})

test('pipeline: present empty registry suppresses legacy typing', async () => {
  const { pipeline, calls } = harness({ turnHooks: createTurnHooks() })
  assert.equal((await pipeline.handleTurn(turn)).reply, 'ok')
  assert.deepEqual(calls, ['process'])
})

test('pipeline: hooks get narrow context and are awaited around processing without legacy typing', async () => {
  for (const typingEnabled of [true, false, 'true']) {
    const hooks = createTurnHooks(), h = harness({ turnHooks: hooks, typingEnabled })
    let context
    hooks.register({ id: 'observer', async onStart(value) {
      await new Promise(setImmediate)
      context = value
      assert.deepEqual(value, { turn, settings: { typingEnabled: typingEnabled === true } })
      h.calls.push('start')
    }, async onEnd(value) {
      await new Promise(setImmediate)
      assert.equal(value, context)
      h.calls.push('end')
    } })
    const result = await h.pipeline.handleTurn(turn)
    assert.deepEqual(result, await harness({ typingEnabled: false }).pipeline.handleTurn(turn))
    assert.deepEqual(h.calls, ['start', 'process', 'end'])
  }
})

test('pipeline: end awaited on processing failure; hook failures preserve original error', async () => {
  const failure = Error('clock service failed'), hooks = createTurnHooks()
  const h = harness({ turnHooks: hooks, failure })
  hooks.register({ id: 'failing', onStart() { h.calls.push('start'); throw Error('start failed') }, async onEnd() {
    await new Promise(setImmediate)
    h.calls.push('end')
    throw Error('end failed')
  } })
  await assert.rejects(h.pipeline.handleTurn(turn), error => error === failure)
  assert.deepEqual(h.calls, ['start', 'process', 'end'])
})

test('pipeline: admitted turns record stages; silence/wait/learn/group gate/empty generation have no receipt', async t => {
  const { loopHarness } = await import('./helpers/loop.js')
  const { createOutbound } = await import('../src/cognition/outbound.js')
  const observation = loopHarness(t)
  let action = 'reply', output = 'PRIVATE_OUTPUT', mode = 'private', sends = 0
  const config = { cognition: { enabled: true, reply: { split: false }, turn: { groupReplyMode: 'addressed' } } }
  const outbound = createOutbound({ observer: observation.observer, gateway: { actions: { sendMessage: async () => { sends++; return { message_id: 'PRIVATE_MESSAGE' } } } } })
  const pipeline = createPipeline({ observer: observation.observer, outbound, clock: observation.clock, store: observation.base,
    getConfig: () => config,
    person: { ensurePerson: () => ({ person: { id: 'person_1' } }), addFacet() {} },
    relationships: { getMerged: () => ({}), update() {} }, emotion: { get: () => ({}), appraise() {} }, persona: { get: () => ({}) },
    memory: { retrieveAsync: async () => [], encodeTurn() {}, workingSet() {} },
    policy: { decide: () => ({ id: 'decision_1', action }), markSent() {}, markFailed() {}, history: () => [] },
    llm: { completeJson: async () => ({ ok: true, json: {} }), complete: async () => ({ ok: true, text: output }) },
  })
  for (const value of ['silence', 'wait', 'learn', 'recall_ignore', 'empty', 'group', 'reply']) {
    observation.advance(1)
    action = ['empty', 'group'].includes(value) ? 'reply' : value
    output = value === 'empty' ? '' : 'PRIVATE_OUTPUT'
    mode = value === 'group' ? 'group' : 'private'
    const count = observation.receipts().length
    await pipeline.handleTurn({ id: `turn_${value}`, chatType: mode, chatId: 'PRIVATE_CHAT', senderId: 'PRIVATE_USER', text: 'PRIVATE_BODY', addressed: false, messages: [] })
    const row = observation.loops().find(row => row.turnId === `turn_${value}`)
    assert.equal(row.stage, 'closed')
    assert.equal(row.status, value === 'empty' ? 'failed' : 'completed')
    assert.doesNotMatch(JSON.stringify(row), /PRIVATE_/)
    if (value !== 'reply') assert.equal(observation.receipts().length, count)
    else {
      assert.deepEqual(row.stages.map(item => item.stage), ['detected', 'decided', 'generating', 'delivering', 'observing', 'closed'])
      assert.equal(observation.receipts().length, count + 1)
    }
  }
  assert.equal(sends, 1)
  config.cognition.enabled = false
  const count = observation.loops().length
  await pipeline.handleTurn(turn)
  assert.equal(observation.loops().length, count)
})

test('pipeline: observer failure preserves processing result and exception identity', async () => {
  const observer = { begin() { throw Error('observer') }, finishLoop() { throw Error('observer') } }
  const pipeline = createPipeline({ observer, getConfig: () => ({ cognition: { enabled: true } }), clock: { now: () => 42 }, commands: { handle: async () => ({ handled: true, reply: 'ok' }) } })
  assert.equal((await pipeline.handleTurn(turn)).reply, 'ok')
  const error = Error('processing')
  const failing = createPipeline({ observer, clock: { now: () => 42 }, getConfig: () => ({ cognition: { enabled: true } }), person: { ensurePerson: () => { throw error } }, relationships: {}, emotion: { get() { throw error } } })
  await assert.rejects(failing.handleTurn(turn), value => value === error)
})

test('pipeline: compose skip compatibility branch closes loop without entering delivery', async t => {
  const { readFileSync } = await import('node:fs')
  const { loopHarness } = await import('./helpers/loop.js')
  // Stub only the compose dependency to exercise this existing compatibility
  // branch; the current built-in composer normally returns empty as a failure.
  const url = new URL('../src/cognition/pipeline.js', import.meta.url)
  const source = readFileSync(url, 'utf8')
    .replace('import { analyzeTurn, composeReply }', 'import { analyzeTurn }')
    .replace('export function createPipeline', 'const composeReply = async () => ({ ok: true, skipped: true });\nexport function createPipeline')
    .replace(/from '([^']+)'/g, (_, path) => `from '${new URL(path, url).href}'`)
  const { createPipeline: createWithSkippedComposer } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
  const h = loopHarness(t)
  const pipeline = createWithSkippedComposer({ observer: h.observer, store: h.base, clock: h.clock,
    getConfig: () => ({ cognition: { enabled: true } }),
    person: { ensurePerson: () => ({ person: { id: 'p1' } }), addFacet() {} }, relationships: { getMerged: () => ({}), update() {} },
    persona: { get: () => ({}) }, emotion: { get: () => ({}), appraise() {} },
    memory: { retrieveAsync: async () => [], encodeTurn() {}, workingSet() {} },
    policy: { decide: () => ({ id: 'd1', action: 'reply' }), markSent() {}, history: () => [] }, llm: {},
    outbound: { deliver() { assert.fail('skip must never send') } },
  })
  assert.equal((await pipeline.handleTurn({ ...turn, text: 'hello' })).ok, true)
  assert.equal(h.loops()[0].reasonCode, 'COMPOSE_SKIP')
  assert.equal(h.receipts().length, 0)
})
