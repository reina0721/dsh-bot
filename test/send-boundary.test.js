import { test } from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './helpers/proactivity.js'

test('proactive send intent is consumed before I/O: lost acknowledgement cannot retry the same run', async t => {
  let platformAccepted = 0
  const h = harness(t, { observe: true, sendMessage: async () => {
    platformAccepted++ // The platform has accepted it, but the response was lost.
    throw Error('lost acknowledgement')
  } })
  t.after(() => h.engine.stop())
  const run = h.port.begin()
  const [candidate] = h.port.candidates(run)
  await h.port.context(run, candidate.id)
  assert.equal((await h.port.complete(run, { system: 'system', user: 'user' })).ok, true)
  assert.equal((await h.port.send(run)).ok, false)
  assert.equal((await h.port.send(run)).reason, 'INVALID_RUN')
  assert.equal(platformAccepted, 1)
  assert.equal(h.calls.length, 1)
  assert.equal(h.store.list('decision').length, 1)
  assert.equal(h.store.list('decision')[0].status, 'failed')
  assert.equal(h.store.list('proactive_intent').length, 0, 'no success can be inferred from a lost acknowledgement')
  h.port.release(run)
})

// Test the real transport too: a single outbound invocation must not become an
// HTTP -> WS resend or a configured network retry after platform acceptance.
test('OneBot send lost acknowledgement never falls back to WS or retries, even when requested', async t => {
  const { startMockOneBot } = await import('./helpers/mock-onebot.js')
  const { createOneBotClient } = await import('../src/onebot/client.js')
  const { waitFor } = await import('./helpers/fake-dsh.js')
  const mock = await startMockOneBot()
  const client = createOneBotClient({ endpoint: () => ({ httpUrl: mock.httpUrl, wsUrl: mock.wsUrl, httpToken: mock.token, wsToken: mock.token }), options: () => ({ reconnect: { enabled: false }, timeouts: { maxRetries: 3, retryDelaysMs: [1, 1, 1] } }) })
  t.after(async () => { client.stop(); await mock.close() })
  client.start()
  await waitFor(() => client.wsState === 1, { label: 'send-boundary WS' })
  const realFetch = globalThis.fetch
  t.mock.method(globalThis, 'fetch', async (...args) => {
    assert.equal(new URL(args[0]).hostname, '127.0.0.1')
    await realFetch(...args) // The fake platform has actually accepted the message.
    throw Error('lost HTTP acknowledgement')
  })
  for (const action of ['send_private_msg', 'send_group_msg']) {
    await assert.rejects(client.call(action, { user_id: 10001, group_id: 30001, message: 'boundary fixture' }, { retries: 3 }))
    assert.equal(mock.calls.filter(row => row.action === action).length, 1)
    assert.equal(mock.calls.find(row => row.action === action).transport, 'http')
  }
  // Safe reads retain the existing transport fallback.
  assert.ok(await client.call('get_login_info'))
  assert.equal(mock.calls.filter(row => row.action === 'get_login_info').length, 2)
  assert.equal(mock.state.sentMessages.length, 2)
})
