import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCognition } from '../src/cognition/index.js'
import { createStore } from '../src/cognition/store.js'
import { normalizeConfig } from '../src/core/config.js'
import { createFakeScheduler } from '../src/cognition/util.js'
import { scopedPersonaKind } from '../src/cognition/persona-scope.js'

const turn = (id, extra = {}) => ({ id, chatType: 'private', chatId: '10001', senderId: '10001', text: '你好', addressed: true, messages: [], messageIds: [], ...extra })
const patch = (settings, changes, id = 'self') => settings.patch({ scope: 'profile', id, revision: settings.view({ scope: 'profile', id }).revision, patch: changes })

test('profile runtime: real pipeline pins model route/persona during async calls and keeps writes in the captured persona', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-runtime-'))
  let config = normalizeConfig({ access: { ownerQQ: '10001' }, cognition: { enabled: true, dryRun: true, llm: { dailyTokenBudget: 1000000 } } }).config
  const store = createStore({ file: ':memory:' })
  let enter, release, first = true
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const calls = []
  const llm = { async *stream(options) {
    calls.push(options)
    const analysis = options.system.includes('认知分析器')
    if (analysis && first) { first = false; enter(); await gate }
    yield { type: 'text-delta', text: analysis ? JSON.stringify({ intent: 'chat', confidence: 1, novelty: 0, risk: 0, serious: false, appraisal: { desirability: 0.2, relevance: 1, intensity: 0.2 }, unknownCandidates: [], replyGoal: '自然回应' }) : '你好，今天过得怎样？' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } }
  const cog = createCognition({ dataRoot: dir, store, getConfig: () => config, setConfig: next => { config = normalizeConfig(next).config },
    ctx: { get: key => key === 'llm' ? llm : key === 'agentDefaultModel' ? { currentSelection: () => ({ provider: 'default', model: 'default' }) } : null },
    scheduler: createFakeScheduler(),
  })
  t.after(async () => { await cog.dispose(); rmSync(dir, { recursive: true, force: true }) })
  assert.equal(cog.state.ready, true)
  const { settings, pipeline } = cog.services
  patch(settings, { 'cognition.modelRouting.privateDefault': 'first/model-a', 'cognition.persona.profile.identity': 'captured identity' })
  const other = cog.createPersona({ name: 'other', activate: false }).persona
  patch(settings, { 'cognition.modelRouting.privateDefault': 'second/model-b', 'cognition.persona.profile.identity': 'second identity' }, other.id)
  const original = turn('pinned')
  const work = pipeline.handleTurn(original)
  await entered
  patch(settings, { 'cognition.modelRouting.privateDefault': 'edited/model-c', 'cognition.persona.profile.identity': 'edited identity' })
  cog.switchPersona(other.id)
  release()
  const result = await work
  assert.equal(result.ok, true)
  assert.equal(calls.length, 2, 'analysis and composition each run once')
  for (const call of calls) { assert.equal(call.provider, 'first'); assert.equal(call.model, 'model-a') }
  assert.match(calls[1].system, /captured identity/)
  assert.doesNotMatch(calls[1].system, /second identity|edited identity/)
  assert.equal(store.count(scopedPersonaKind('self', 'decision')), 1)
  assert.equal(store.count(scopedPersonaKind(other.id, 'decision')), 0)
  const next = turn('next')
  assert.equal((await pipeline.handleTurn(next)).ok, true)
  assert.equal(pipeline.settingsContext(next).personaId, other.id)
  for (const call of calls.slice(2)) { assert.equal(call.provider, 'second'); assert.equal(call.model, 'model-b') }
  assert.match(calls[3].system, /second identity/)
  assert.equal(store.count(scopedPersonaKind(other.id, 'decision')), 1)
  cog.switchPersona('self')
  assert.equal((await cog.services.llm.currentRoute({ chatType: 'private', chatId: '10001' })).provider, 'edited')
  const raw = structuredClone(config)
  const command = await pipeline.handleTurn(turn('command', { text: '/model command/model-d' }))
  assert.equal(command.command, true)
  assert.equal((await cog.services.llm.currentRoute({ chatType: 'private', chatId: '10001' })).provider, 'command')
  assert.deepEqual(config, raw, 'model command writes profile, preserving system/module legacy file')
  patch(settings, { 'cognition.enabled': false })
  assert.equal((await pipeline.handleTurn(turn('disabled'))).error, 'cognition_disabled')
  cog.switchPersona(other.id)
  assert.equal(cog.snapshot().config.enabled, true)
})
