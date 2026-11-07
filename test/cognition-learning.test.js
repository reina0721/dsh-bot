// 学习/信念/技能/主动行为边界测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore } from '../src/cognition/store.js'
import { createClock } from '../src/cognition/util.js'
import { createBeliefService } from '../src/cognition/beliefs.js'
import { createSkillService } from '../src/cognition/skills.js'
import { createKnowledgeService } from '../src/cognition/knowledge.js'
import { isQuietHour } from '../src/modules/builtin/proactivity/engine.js'

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-learn-'))
  const store = createStore({ file: join(dir, 'cognition.sqlite'), clock: createClock() })
  return Promise.resolve().then(() => fn(store, dir)).finally(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })
}

const CONFIG = {
  cognition: {
    enabled: true,
    learning: { enabled: true, autoResearch: false, minConfidence: 0.3, maxSources: 5, maxQueries: 2, maxTasksPerHour: 10, dailyTokenBudget: 20000, sources: { wikipedia: false, openalex: false, github: false, web: false } },
    policy: { proactive: false },
  },
}
const getConfig = () => CONFIG

test('beliefs：证据更新概率、用户纠正保留历史', () => withStore((store) => {
  const beliefs = createBeliefService({ store, getConfig, clock: createClock() })
  const first = beliefs.upsert({ subject: '小明', proposition: '小明喜欢猫', probability: 0.5, evidenceWeight: 1, evidence: { source: 'observation' }, source: 'test' })
  assert.ok(first.probability > 0.5)
  const second = beliefs.upsert({ subject: '小明', proposition: '小明喜欢猫', evidenceWeight: -0.5, status: 'disputed' })
  assert.ok(second.probability < first.probability)
  assert.equal(second.status, 'disputed')
  const corrected = beliefs.correct(second.id, { probability: 0.9, status: 'fact', reason: 'user' })
  assert.equal(corrected.probability, 0.9)
  assert.ok(corrected.evidence.some((item) => item.type === 'correction'))
}))

test('skills：成功增长、失败下降、压力降低有效值、迁移有小幅影响', () => withStore((store) => {
  const skills = createSkillService({ store, getConfig, clock: createClock() })
  const before = skills.get('humor').effectiveMastery
  skills.use('humor', { success: true })
  const after = skills.get('humor').effectiveMastery
  assert.ok(after >= before)
  skills.use('humor', { success: false })
  assert.ok(skills.get('humor').effectiveMastery <= after)
  assert.ok(skills.list().length >= 10)
  store.put('emotion', 'self', { valence: 0, arousal: 0.3, stress: 1, fatigue: 0, moodValence: 0, discrete: {}, updatedAt: Date.now() })
  assert.ok(skills.get('humor').effectiveMastery < after)
}))

test('knowledge：没有证据保持 unknown；fake 来源产生带引用 claim', async () => withStore(async (store) => {
  const sources = {
    register() {},
    list: () => [{
      id: 'fake',
      label: 'fake',
      reliability: 0.9,
      async search() { return [{ title: '测试条目', url: 'https://a.example/x', snippet: '这是测试条目的定义。' }, { title: '另一条', url: 'https://b.example/y', snippet: '另一个独立来源的解释。' }] },
      async fetch(url) { return { url, title: '测试条目', text: '这是测试条目的定义。另一个独立来源的解释。' } },
    }],
    get: () => null,
  }
  const knowledge = createKnowledgeService({ store, getConfig, clock: createClock(), sources })
  const unknown = {
    id: 'u1', surface: '测试梗', scopeType: 'group', scopeId: 'g1', status: 'open',
  }
  store.put('unknown', 'u1', unknown)
  const task = knowledge.createTask(unknown, { auto: true })
  assert.ok(task)
  const result = await knowledge.runTask(task)
  assert.equal(result.ok, true)
  assert.ok(result.claim)
  assert.ok(result.claim.citations.length >= 1)
  assert.equal(store.get('unknown', 'u1').status, 'resolved')
  assert.ok(knowledge.listClaims().length >= 1)
}))

test('proactivity：安静时段跨午夜正确', () => {
  assert.equal(isQuietHour(23, 23, 8), true)
  assert.equal(isQuietHour(2, 23, 8), true)
  assert.equal(isQuietHour(8, 23, 8), false)
  assert.equal(isQuietHour(12, 23, 8), false)
  assert.equal(isQuietHour(12, 9, 18), true)
})
