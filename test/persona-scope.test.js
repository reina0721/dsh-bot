// 人格作用域：隔离、旧数据迁移与人格间数据复制。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createStore } from '../src/cognition/store.js'
import { createPersonaService } from '../src/cognition/persona.js'
import {
  PERSONA_DATA_KINDS,
  copyPersonaData,
  createPersonaScopedStore,
  dropPersonaData,
  migrateLegacyPersonaData,
  personaDataCounts,
  scopedPersonaKind,
} from '../src/cognition/persona-scope.js'

const CONFIG = { cognition: { persona: { evolutionEnabled: false } } }
const clock = { now: () => 1000 }

function setup() {
  const base = createStore({ file: ':memory:' })
  const persona = createPersonaService({ store: base, getConfig: () => CONFIG, clock })
  persona.ensure()
  const scoped = createPersonaScopedStore({ base, getPersonaId: () => persona.activeId() })
  return { base, persona, scoped }
}

test('人格作用域：记忆/情绪按 active 隔离，全局 setting 不隔离', () => {
  const { base, persona, scoped } = setup()
  const a = persona.create({ name: 'A' }).persona
  const b = persona.create({ name: 'B' }).persona
  persona.activate(a.id)
  scoped.put('memory', 'm1', { id: 'm1', text: 'A 的记忆' })
  scoped.put('emotion', 'self', { mood: 'calm' })
  scoped.put('setting', 'shared.flag', { value: 1 })
  assert.equal(scoped.list('memory').length, 1)
  assert.equal(scoped.get('emotion', 'self').mood, 'calm')

  persona.activate(b.id)
  assert.equal(scoped.list('memory').length, 0)
  assert.equal(scoped.get('emotion', 'self'), null)
  assert.equal(scoped.get('setting', 'shared.flag').value, 1, '全局 setting 仍可见')
  scoped.put('memory', 'm2', { id: 'm2', text: 'B 的记忆' })
  assert.equal(scoped.list('memory').length, 1)

  persona.activate(a.id)
  assert.equal(scoped.get('memory', 'm1').text, 'A 的记忆')
  assert.equal(scoped.get('memory', 'm2'), null)
  assert.equal(base.get('persona_' + b.id + ':memory', 'm2').text, 'B 的记忆')
})

test('人格作用域：旧无前缀数据迁移到 self，幂等且清掉旧行', () => {
  const base = createStore({ file: ':memory:' })
  const persona = createPersonaService({ store: base, getConfig: () => CONFIG, clock })
  persona.ensure()
  base.put('memory', 'legacy_memory', { id: 'legacy_memory', text: '旧记忆', personId: 'p1' })
  base.put('relationship', 'legacy_rel', { id: 'legacy_rel', personId: 'p1', warmth: 0.7 })
  const first = migrateLegacyPersonaData({ base, targetId: 'self', clock })
  assert.equal(first.migrated, 2)
  assert.equal(base.get(scopedPersonaKind('self', 'memory'), 'legacy_memory').text, '旧记忆')
  assert.equal(base.get(scopedPersonaKind('self', 'relationship'), 'legacy_rel').warmth, 0.7)
  assert.equal(base.get('memory', 'legacy_memory'), null)
  assert.equal(base.get('relationship', 'legacy_rel'), null)
  const second = migrateLegacyPersonaData({ base, targetId: 'self', clock })
  assert.equal(second.skipped, true)
})

test('人格数据复制：按组替换目标，来源不受影响', () => {
  const { base, persona } = setup()
  const a = persona.create({ name: 'A' }).persona
  const b = persona.create({ name: 'B' }).persona
  base.put(scopedPersonaKind(a.id, 'memory'), 'm1', { id: 'm1', text: '来源记忆' })
  base.put(scopedPersonaKind(a.id, 'memory'), 'm2', { id: 'm2', text: '来源记忆2' })
  base.put(scopedPersonaKind(a.id, 'emotion'), 'self', { mood: 'happy' })
  base.put(scopedPersonaKind(b.id, 'memory'), 'old', { id: 'old', text: '目标旧记忆' })
  const result = copyPersonaData({ base, from: a.id, to: b.id, groups: ['memory'], clock })
  assert.equal(result.ok, true)
  assert.equal(result.groups.length, 1)
  const target = base.list(scopedPersonaKind(b.id, 'memory'), { limit: 100 })
  assert.deepEqual(target.map((row) => row.id).sort(), ['m1', 'm2'])
  assert.equal(base.get(scopedPersonaKind(b.id, 'emotion'), 'self'), null, '未选中的组不复制')
  assert.equal(base.list(scopedPersonaKind(a.id, 'memory'), { limit: 100 }).length, 2, '来源不变')
  const counts = personaDataCounts({ base, personaId: b.id })
  assert.equal(counts.total, 2)
  assert.equal(counts.groups.find((g) => g.id === 'memory').count, 2)
})

test('人格数据复制：同人格/未知组拒绝，drop 清空指定人格', () => {
  const { base, persona } = setup()
  const a = persona.create({ name: 'A' }).persona
  base.put(scopedPersonaKind(a.id, 'memory'), 'm1', { id: 'm1' })
  assert.equal(copyPersonaData({ base, from: a.id, to: a.id, groups: ['memory'] }).code, 'SAME_PERSONA')
  assert.equal(copyPersonaData({ base, from: a.id, to: 'missing', groups: ['memory'] }).code, 'PERSONA_NOT_FOUND')
  for (const kind of PERSONA_DATA_KINDS) assert.ok(typeof scopedPersonaKind(a.id, kind) === 'string')
  const removed = dropPersonaData({ base, personaId: a.id })
  assert.ok(removed >= 1)
  assert.equal(base.get(scopedPersonaKind(a.id, 'memory'), 'm1'), null)
})

test('LLM dual usage: global stays global, persona is isolated and dropped, neither is copied', () => {
  const { base, persona, scoped } = setup()
  const active = persona.create({ name: 'Active' }).persona
  base.put('llm_usage', '2026-11-06', { tokens: 450 })
  base.put('llm_usage', '2026-11-05', { tokens: 150 })
  scoped.put('llm_usage_persona', '2026-11-06', { tokens: 50 })
  assert.equal(scoped.scopedKind('llm_usage'), 'llm_usage')
  assert.equal(scoped.scopedKind('llm_usage_persona'), 'persona_' + active.id + ':llm_usage_persona')
  assert.equal(PERSONA_DATA_KINDS.includes('llm_usage'), false)
  assert.equal(PERSONA_DATA_KINDS.includes('llm_usage_persona'), false)
  migrateLegacyPersonaData({ base, targetId: 'self', clock })
  assert.equal(base.get('llm_usage', '2026-11-06').tokens, 450)
  assert.equal(copyPersonaData({ base, from: active.id, to: 'self', clock }).ok, true)
  persona.activate('self')
  assert.equal(scoped.get('llm_usage', '2026-11-06').tokens, 450)
  assert.equal(scoped.get('llm_usage_persona', '2026-11-06'), null)
  scoped.put('llm_usage_persona', '2026-11-06', { tokens: 10 })
  dropPersonaData({ base, personaId: active.id })
  assert.equal(scoped.get('llm_usage_persona', '2026-11-06').tokens, 10)
  persona.activate(active.id)
  assert.equal(scoped.get('llm_usage_persona', '2026-11-06'), null)
  assert.equal(scoped.get('llm_usage', '2026-11-06').tokens, 450)
  assert.equal(scoped.get('llm_usage', '2026-11-05').tokens, 150)
})

test('persona observation kinds: scoped, excluded from copy, removed by persona deletion', async t => {
  const { createLoopObserver } = await import('../src/observability/loop.js')
  const { base, persona, scoped } = setup()
  t.after(() => base.close())
  const source = persona.activeId()
  const other = persona.create({ name: 'Other' }).persona
  persona.activate(source)
  const observer = createLoopObserver({ base, getPersonaId: scoped.currentPersonaId, clock })
  const loop = observer.begin({ turnId: 'turn_1' })
  observer.beginDelivery(loop)
  assert.equal(copyPersonaData({ base, from: source, to: other.id }).ok, true)
  for (const kind of ['loop_run', 'delivery_receipt']) {
    assert.equal(PERSONA_DATA_KINDS.includes(kind), false)
    assert.equal(base.count(scopedPersonaKind(source, kind)), 1)
    assert.equal(base.count(scopedPersonaKind(other.id, kind)), 0)
  }
  dropPersonaData({ base, personaId: source })
  for (const kind of ['loop_run', 'delivery_receipt']) assert.equal(base.count(scopedPersonaKind(source, kind)), 0)
})

test('feedback receipts stay with original persona, never copy observation history or fabricate joins', async t => {
  const { createLoopObserver } = await import('../src/observability/loop.js')
  const { createLoopQuery } = await import('../src/observability/loop-query.js')
  const { createPolicyService } = await import('../src/cognition/policy.js')
  const { base, persona, scoped } = setup(); t.after(() => base.close())
  const source = persona.activeId(), other = persona.create({ name: 'Other' }).persona
  persona.activate(source)
  const observer = createLoopObserver({ base, getPersonaId: scoped.currentPersonaId, clock })
  const query = createLoopQuery({ observer, store: scoped, clock })
  const policy = createPolicyService({ store: scoped, observer, clock, getConfig: () => ({}) })
  scoped.put('decision', 'd', { action: 'reply', contextKey: 'bucket', status: 'sent' })
  const loop = observer.begin({ turnId: 'turn_1' })
  observer.recordStage(loop, 'decided', { decisionId: 'd' })
  observer.finishDelivery(observer.beginDelivery(loop), { status: 'sent', parts: 1, failedPart: null, errorCode: null })
  observer.finishLoop(loop)
  policy.recordOutcome('d', { positiveReaction: true }, { source: 'reaction', dedupeKey: 'reaction_1' })
  const id = query.runs().items[0].id
  assert.equal(query.detail({ id }).receipts.length, 2)
  copyPersonaData({ base, from: source, to: other.id })
  persona.activate(other.id)
  assert.equal(query.detail({ id }).code, 'LOOP_NOT_FOUND')
  assert.equal(query.detail({ decisionId: 'd' }).code, 'LOOP_NOT_FOUND')
  assert.equal(scoped.count('policy'), 1, 'business copy remains independent')
  persona.activate(source); dropPersonaData({ base, personaId: source })
  assert.equal(query.detail({ id }).code, 'LOOP_NOT_FOUND')
  assert.equal(base.count(scopedPersonaKind(source, 'delivery_receipt')), 0)
})
