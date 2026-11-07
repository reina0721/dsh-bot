// Complete host sandbox: all external I/O is loopback or a preinstalled fetch fake.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply } from '../src/host.js'
import { createFakeDsh, waitFor } from './helpers/fake-dsh.js'
import { startMockOneBot } from './helpers/mock-onebot.js'
import { startMockModelServer, json } from './helpers/mock-model-http.js'

const API = '/onebot-qq/api'
const BV = 'BV1xx411c7mD'

test('sandbox: OneBot commands, local Bilibili, proactive send, auto-enqueue/manual research and management reads', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sandbox-integration-'))
  const previous = process.env.DSH_BOT_DATA_DIR
  process.env.DSH_BOT_DATA_DIR = root
  let host, onebot, model
  const fake = createFakeDsh()
  t.after(async () => {
    await host?.modules.dispose()
    host?.dispose(); fake.dispose()
    await onebot?.close(); await model?.close()
    if (previous === undefined) delete process.env.DSH_BOT_DATA_DIR
    else process.env.DSH_BOT_DATA_DIR = previous
    await rm(root, { recursive: true, force: true })
  })
  const remote = [], blocked = []
  const realFetch = globalThis.fetch
  // Install before apply: the Bilibili transport captures fetch during setup.
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input.url || String(input))
    if (url.hostname === 'api.bilibili.com') {
      remote.push(url.href)
      assert.equal(url.pathname, '/x/web-interface/popular')
      return Response.json({ code: 0, data: { list: [{ bvid: BV, title: 'Sandbox video', owner: { name: 'Fake author' }, stat: { view: 42 }, duration: 60 }] } })
    }
    if (url.hostname !== '127.0.0.1') { blocked.push(url.href); throw Error('Sandbox forbids external network') }
    return realFetch(input, options)
  })
  onebot = await startMockOneBot()
  model = await startMockModelServer((_req, res, call) => {
    const research = call.body.messages.some(item => String(item.content).includes('知识提炼器'))
    const content = research ? JSON.stringify({ concept: 'sandbox-concept', claim: 'Supported sandbox claim', definition: 'A fake definition', confidence: 0.9, status: 'active', citations: [1, 2], limitations: [] }) : 'Sandbox greeting'
    json(res, 200, { id: 'mock-completion', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })
  })
  host = apply(fake.ctx, {
    enabled: true, botQQ: onebot.selfId,
    onebot: { wsUrl: onebot.wsUrl, httpUrl: onebot.httpUrl, wsToken: onebot.token, httpToken: onebot.token },
    access: { ownerQQ: '10001', mode: 'allowlist', groups: ['30001'], private: ['10001', '10002'] },
    media: { enabled: true, images: { enabled: true } }, content: { bilibili: { enabled: true } },
    cognition: { enabled: true, dryRun: false, llm: { mode: 'direct', fallbackToDsh: false }, proactivity: { enabled: true, quietStart: 0, quietEnd: 0 }, learning: { enabled: true, autoResearch: true, sources: { web: false, wikipedia: false, openalex: false, github: false } } },
  })
  await host.ready
  const call = async (path, body) => {
    const response = await fake.call(API + path, body, { method: body === undefined ? 'GET' : 'POST' })
    assert.equal(response.status, 200, response.text)
    assert.equal(response.json.ok, true, response.text)
    return response.json
  }
  await waitFor(async () => (await call('/status')).gateway.loginCheck === 'ok', { label: 'sandbox OneBot login' })
  await call('/models/provider', { provider: { id: 'sandbox', name: 'Sandbox', protocol: 'openai-completions', baseUrl: model.url + '/v1', requestPath: '/chat/completions', auth: { type: 'none' }, models: [{ id: 'mock-model' }] } })
  await call('/models/select', { provider: 'sandbox', model: 'mock-model' })
  const sticker = await call('/media/stickers/upload', { name: 'seed.png', mime: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3WQAAAAASUVORK5CYII=' })
  assert.ok(sticker.item.id)
  const textOf = row => row.params.message.filter(part => part.type === 'text').map(part => part.data.text).join('')
  for (const chat of ['private', 'group']) {
    const push = message => chat === 'private' ? onebot.pushPrivateMessage({ message }) : onebot.pushGroupMessage({ message })
    const action = chat === 'private' ? 'send_private_msg' : 'send_group_msg'
    let count = onebot.state.sentMessages.length
    push('/bili share ' + BV)
    await waitFor(() => onebot.state.sentMessages.length === count + 1, { label: chat + ' offline share' })
    assert.equal(onebot.state.sentMessages.at(-1).action, action)
    assert.match(textOf(onebot.state.sentMessages.at(-1)), new RegExp('https://www.bilibili.com/video/' + BV))
    assert.equal(remote.length, 0, 'share must remain offline')
    count++
    push('/sticker')
    await waitFor(() => onebot.state.sentMessages.length === count + 1, { label: chat + ' seeded sticker' })
    assert.equal(onebot.state.sentMessages.at(-1).action, action)
    assert.equal(onebot.state.sentMessages.at(-1).params.message.filter(part => part.type === 'image').length, 1)
  }
  let count = onebot.state.sentMessages.length
  onebot.pushPrivateMessage({ message: '/bili hot' })
  await waitFor(() => onebot.state.sentMessages.length === count + 1, { label: 'fake remote Bilibili command' })
  assert.match(textOf(onebot.state.sentMessages.at(-1)), /Sandbox video/)
  assert.equal(remote.length, 1)
  assert.equal(model.calls.length, 0, 'commands should not need a model')

  async function run(moduleId, actionId, requestId) {
    const catalog = await call('/modules/actions?id=' + moduleId)
    assert.equal(catalog.items.find(item => item.actionId === actionId).available, true)
    const input = { moduleId, actionId, requestId, expectedGeneration: catalog.expectedGeneration, expectedPersonaId: catalog.expectedPersonaId, expectedPersonaGeneration: catalog.expectedPersonaGeneration }
    const admitted = await call('/modules/action', input)
    const done = await waitFor(async () => {
      const { operation } = await call('/modules/operation?id=' + admitted.operation.id)
      return operation.completedAt ? operation : null
    }, { label: actionId })
    assert.equal(done.status, 'succeeded', JSON.stringify(done))
    assert.equal((await call('/modules/action', input)).operation.id, done.id, 'same request never executes twice')
    return done
  }
  const store = host.cognition.services.personaStore
  store.put('person', 'sandbox-person', { displayName: 'Sandbox friend' })
  store.put('relationship', 'sandbox-relationship', { personId: 'sandbox-person', scopeType: 'private', scopeId: '10002', familiarity: 0.9, affinity: 0.8, initiative: 0.7, trust: 0.6, intimacy: 0.5 })
  count = onebot.state.sentMessages.length
  await run('builtin-proactivity', 'proactivity.runOnce', 'sandbox-proactive')
  assert.equal(onebot.state.sentMessages.length, count + 1)
  assert.equal(onebot.state.sentMessages.at(-1).params.user_id, 10002)
  assert.equal(textOf(onebot.state.sentMessages.at(-1)), 'Sandbox greeting')
  const [decision] = store.list('decision', { where: row => row.action === 'proactive' })
  assert.equal(decision.status, 'sent')
  assert.equal(store.list('proactive_intent').length, 1)
  assert.equal(store.list('proactive_intent')[0].decisionId, decision.id)
  assert.equal(model.calls.length, 1)

  const sourceCalls = []
  const unregister = host.cognition.registerKnowledgeSource({ id: 'sandbox-source', reliability: 0.9,
    async search(query) { sourceCalls.push(['search', query]); return ['a', 'b'].map(domain => ({ url: `https://${domain}.example/fixture`, title: 'Fixture', snippet: 'A fake definition' })) },
    async fetch(url) { sourceCalls.push(['fetch', url]); return { url, text: 'A fake definition supported by sandbox evidence.' } },
  })
  t.after(unregister)
  host.cognition.services.knowledge.detectFromTurn({ turn: { id: 'sandbox-detected-turn', text: 'sandbox-concept', chatType: 'group' }, analysis: { unknownCandidates: [{ surface: 'sandbox-concept' }], confidence: 0.7 }, scope: { scopeType: 'group', scopeId: '30001' } })
  const [task] = store.list('learning_task')
  assert.equal(task.status, 'pending', 'real unknown event auto-enqueues before the manual run')
  await run('builtin-learning', 'learning.runPending', 'sandbox-learning')
  const completed = store.get('learning_task', task.id)
  assert.equal(completed.status, 'done')
  const evidence = store.list('learning_evidence', { where: row => row.taskId === task.id })
  assert.equal(evidence.length, 2)
  const claim = store.get('knowledge_claim', completed.claimId)
  assert.equal(claim.taskId, task.id)
  assert.equal(claim.claim, 'Supported sandbox claim')
  assert.deepEqual(new Set(claim.evidenceIds), new Set(evidence.map(row => row.id)))
  assert.equal(store.get('unknown', task.unknownId).status, 'resolved')
  assert.equal(sourceCalls.length, 3)
  assert.equal(model.calls.length, 2)
  const runs = await call('/system/loop/runs?limit=200')
  const research = runs.items.find(row => row.kind === 'research' && row.taskId === task.id)
  assert.ok(research)
  const detail = await call('/system/loop/detail?id=' + research.id)
  assert.equal(detail.research.tasks[0].id, task.id)
  assert.equal(detail.research.claims[0].id, claim.id)
  assert.equal(detail.research.evidence.length, 2)
  assert.equal(detail.item.firstDetectedTurnId, 'sandbox-detected-turn')
  const proactive = await call('/system/loop/detail?decisionId=' + decision.id)
  assert.equal(proactive.receipts.find(row => row.kind === 'delivery').data.parts, 1)
  // Exercise the engine's automatic mode without waiting for its real 30s timer.
  host.cognition.services.knowledge.detectFromTurn({ turn: { id: 'sandbox-auto-turn', text: 'sandbox-auto-concept', chatType: 'group' }, analysis: { unknownCandidates: [{ surface: 'sandbox-auto-concept' }], confidence: 0.7 }, scope: { scopeType: 'group', scopeId: '30001' } })
  const automatic = await host.providerRegistry.get('learning').runPending({ automatic: true })
  assert.equal(automatic.length, 1)
  assert.equal(automatic[0].ok, true)
  const autoTask = store.list('learning_task', { where: row => row.id !== task.id })[0]
  assert.equal(autoTask.status, 'done')
  const autoRuns = await call('/system/loop/runs?kind=research')
  assert.ok(autoRuns.items.some(row => row.taskId === autoTask.id && row.firstDetectedTurnId === 'sandbox-auto-turn' && row.status === 'completed'))
  assert.equal(sourceCalls.length, 6)
  assert.equal(model.calls.length, 3)
  const health = await call('/modules/health')
  assert.equal(health.items.find(row => row.moduleId === 'builtin-media-features').health, 'healthy')
  const summary = await call('/system/loop/summary')
  assert.equal(summary.readiness.cognition.ready, true)
  assert.ok(summary.retained.sentParts >= 6)
  assert.equal(onebot.state.sentMessages.length, count + 1, 'research and management reads send nothing')
  assert.deepEqual(blocked, [])
})
