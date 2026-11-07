// 认知 SQLite 存储基础契约测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createStore } from '../src/cognition/store.js'
import { createClock } from '../src/cognition/util.js'

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cog-store-'))
  const store = createStore({ file: join(dir, 'cognition.sqlite'), clock: createClock({ now: () => 1_700_000_000_000 }) })
  try { return fn(store, dir) } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

test('store：SQLite 模式、put/get/list/update 保留 createdAt', () => withStore((store) => {
  assert.equal(store.mode, 'sqlite')
  const before = store.info()
  assert.equal(before.schemaVersion, 1)
  const created = store.put('person', 'p1', { name: 'A', scopeType: 'global', scopeId: '', status: 'active' })
  assert.equal(created.name, 'A')
  assert.equal(created.createdAt, 1_700_000_000_000)
  const updated = store.put('person', 'p1', { name: 'A2', status: 'active' })
  assert.equal(updated.name, 'A2')
  assert.equal(updated.createdAt, created.createdAt, 'createdAt 不能被 upsert 覆盖')
  assert.equal(store.list('person').length, 1)
  assert.equal(store.get('person', 'missing'), null)
}))

test('store：原始事件按 dedupeKey 去重并支持 accepted 更新', () => withStore((store) => {
  const first = store.appendRaw({ externalId: 'm1', kind: 'message', text: 'hi' })
  assert.equal(first.inserted, true)
  const second = store.appendRaw({ externalId: 'm1', kind: 'message', text: 'hi again' })
  assert.equal(second.inserted, false)
  assert.equal(store.list('raw_event').length, 1)
  store.markRawAccepted(first.record.id, true)
  assert.equal(store.get('raw_event', first.record.id).accepted, true)
}))

test('store: in-memory SQLite supports retrieval with or without FTS5', () => {
  const store = createStore({ file: ':memory:' })
  try {
    assert.equal(store.mode, 'sqlite')
    assert.equal(typeof store.info().ftsEnabled, 'boolean')
    store.put('memory', 'with:colon', { text: '咖啡' })
    assert.equal(store.search('memory', '咖啡')[0]?.id, 'with:colon')
    store.put('memory', 'with:colon', { text: '下雨' })
    assert.equal(store.search('memory', '咖啡').length, 0)
    store.remove('memory', 'with:colon')
    assert.equal(store.search('memory', '下雨').length, 0)
  } finally { store.close() }
})

test('store：FTS 检索中文（单字/二元组）并支持删除', () => withStore((store) => {
  store.put('memory', 'm1', { text: '小明喜欢猫和咖啡', kind: 'episodic' })
  store.put('memory', 'm2', { text: '今天下雨了', kind: 'episodic' })
  assert.equal(store.search('memory', '猫').length, 1)
  assert.equal(store.search('memory', '咖啡').length, 1)
  store.remove('memory', 'm1')
  assert.equal(store.search('memory', '猫').length, 0)
}))

test('store：事务回滚与备份', () => withStore((store, dir) => {
  assert.throws(() => store.tx(() => {
    store.put('person', 'p2', { name: 'B' })
    throw new Error('boom')
  }), /boom/)
  assert.equal(store.get('person', 'p2'), null)
  store.put('person', 'p3', { name: 'C' })
  const backup = store.backup(join(dir, 'backup.sqlite'))
  assert.equal(existsSync(backup), true)
}))

test('JSON fallback transactions publish one complete snapshot and leave no partial writes on failure', async t => {
  const { mkdirSync, readFileSync } = await import('node:fs')
  const dir = mkdtempSync(join(tmpdir(), 'dsh-json-atomic-')), file = join(dir, 'fallback.sqlite')
  mkdirSync(file)
  const store = createStore({ file })
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  assert.equal(store.mode, 'json'); assert.equal(store.atomicTransactions, true)
  store.put('state', 'baseline', { value: 1 })
  const disk = () => readFileSync(join(dir, 'fallback.json'), 'utf8')
  const baseline = disk()
  assert.throws(() => store.tx(() => {
    store.put('outcome', 'o', { reward: 1 })
    assert.equal(disk(), baseline)
    store.tx(() => store.put('policy', 'p', { trials: 1 }))
    assert.equal(disk(), baseline)
    throw Error('rollback')
  }), /rollback/)
  assert.equal(disk(), baseline); assert.equal(store.get('outcome', 'o'), null)
  assert.equal(store.get('policy', 'p'), null)
  store.tx(() => { store.put('outcome', 'o', { reward: 1 }); store.put('policy', 'p', { trials: 1 }) })
  const persisted = JSON.parse(disk()).records
  assert.equal(persisted['outcome:o'].data.reward, 1); assert.equal(persisted['policy:p'].data.trials, 1)
})
