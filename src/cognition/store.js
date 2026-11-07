// 认知持久化：单写者、可注入目录/时钟。
//
// 设计：
// - 默认 node:sqlite（WAL + 事务 + FTS5）；无 sqlite 时退化为 JSON 文件；
// - 实体统一放 records(kind,id,...)，避免为每个概念写一套 CRUD；
//   记忆/人物/关系/策略/trace 都是 record kind，索引字段用于范围查询；
// - FTS5 只做候选召回，最终打分在 retrieval.js（词法/关联/情绪/关系）；
// - 原始事件也进 records，但服务层用 appendRaw() 去重。

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { ftsText, nowMs, safeJson, uid, hashText } from './util.js'

const SCHEMA_VERSION = 1

const SCHEMA = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS records (
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  person_id TEXT,
  scope_type TEXT,
  scope_id TEXT,
  status TEXT,
  data TEXT NOT NULL,
  PRIMARY KEY (kind, id)
);
CREATE INDEX IF NOT EXISTS records_kind_created ON records(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS records_kind_person ON records(kind, person_id, created_at DESC);
CREATE INDEX IF NOT EXISTS records_scope ON records(scope_type, scope_id, created_at DESC);
`

function safeFile(file) {
  mkdirSync(dirname(file), { recursive: true })
  return file
}

function loadJsonState(file) {
  try {
    const text = readFileSync(file, 'utf8')
    const parsed = JSON.parse(text)
    if (parsed && parsed.version === SCHEMA_VERSION && parsed.records && typeof parsed.records === 'object') return parsed
  } catch (error) {}
  return { version: SCHEMA_VERSION, records: {}, fts: {}, seq: 0 }
}

function clone(value) {
  return safeJson(value, value)
}

function rowToRecord(row) {
  if (!row) return null
  let data = {}
  try { data = JSON.parse(row.data) } catch (error) { data = {} }
  return {
    ...data,
    id: row.id,
    kind: row.kind,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  }
}

export function createStore({ file, log, clock = { now: Date.now } } = {}) {
  const now = () => Number(clock.now()) || nowMs()
  const dbFile = file || ':memory:'
  const jsonFile = file && file !== ':memory:' ? file.replace(/\.sqlite$/, '.json') : ''
  let mode = 'json'
  let db = null
  let ftsEnabled = false
  let json = null
  let closed = false
  let txDepth = 0
  let txSnapshot = null
  const stats = { puts: 0, gets: 0, fts: 0, errors: 0 }

  function saveJson() {
    if (mode !== 'json' || !jsonFile || txDepth > 0) return
    mkdirSync(dirname(jsonFile), { recursive: true })
    const tmp = `${jsonFile}.tmp-${process.pid}`
    writeFileSync(tmp, JSON.stringify(json), 'utf8')
    renameSync(tmp, jsonFile)
  }

  try {
    if (dbFile !== ':memory:') mkdirSync(dirname(dbFile), { recursive: true })
    db = new DatabaseSync(dbFile)
    db.exec(SCHEMA)
    // Some supported Node builds ship SQLite without FTS5. Keep SQLite storage
    // and transactions; only lexical retrieval falls back to token overlap.
    const hadFts = Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name = 'fts'").get())
    try {
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(kind UNINDEXED, id UNINDEXED, text, tokenize='unicode61')")
      ftsEnabled = true
    } catch (error) {
      if (!/no such module: fts5/i.test(error.message)) throw error
      log?.warn?.('SQLite FTS5 不可用，保留 SQLite 存储并使用词法检索。')
    }
    const version = Number(db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')?.value || 0)
    if (version > SCHEMA_VERSION) throw new Error(`认知数据库版本 ${version} 高于当前支持的 ${SCHEMA_VERSION}`)
    if (version < SCHEMA_VERSION) {
      db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run('schema_version', String(SCHEMA_VERSION))
      db.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)').run('created_at', String(now()))
    }
    mode = 'sqlite'
    if (ftsEnabled && !hadFts) {
      for (const row of db.prepare('SELECT kind,id,data FROM records').all()) {
        const body = JSON.parse(row.data)
        ftsUpsert(row.kind, row.id, body.ftsText || body.text || body.content || body.summary || '')
      }
    }
  } catch (error) {
    try { db?.close?.() } catch (e) {}
    db = null
    log?.warn?.(`认知 SQLite 不可用，使用 JSON fallback：${error.message}`)
    if (!jsonFile) throw error
    json = loadJsonState(jsonFile)
    mode = 'json'
  }

  function assertOpen() {
    if (closed) throw new Error('认知存储已关闭')
  }

  function put(kind, id, data, { createdAt, updatedAt } = {}) {
    assertOpen()
    const time = now()
    if (mode === 'sqlite') {
      const existing = db.prepare('SELECT created_at FROM records WHERE kind = ? AND id = ?').get(kind, id)
      const created = Number(existing?.created_at || createdAt || time)
      const body = clone(data || {})
      db.prepare(`INSERT INTO records(kind,id,created_at,updated_at,person_id,scope_type,scope_id,status,data)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(kind,id) DO UPDATE SET updated_at=excluded.updated_at, person_id=excluded.person_id,
          scope_type=excluded.scope_type, scope_id=excluded.scope_id, status=excluded.status, data=excluded.data`)
        .run(kind, id, created, updatedAt || time,
          String(body.personId || body.person_id || '') || null,
          String(body.scopeType || body.scope_type || '') || null,
          String(body.scopeId || body.scope_id || '') || null,
          String(body.status || '') || null,
          JSON.stringify(body))
      ftsUpsert(kind, id, body.ftsText || body.text || body.content || body.summary || '')
      stats.puts += 1
      return get(kind, id)
    }
    const key = `${kind}:${id}`
    const prev = json.records[key]
    const created = Number(prev?.createdAt || createdAt || time)
    const body = clone(data || {})
    json.records[key] = { kind, id, createdAt: created, updatedAt: updatedAt || time, data: body }
    json.fts[key] = ftsText(body.ftsText || body.text || body.content || body.summary || '')
    saveJson()
    stats.puts += 1
    return get(kind, id)
  }

  function get(kind, id) {
    assertOpen()
    stats.gets += 1
    if (!kind || !id) return null
    if (mode === 'sqlite') {
      const row = db.prepare('SELECT kind,id,created_at,updated_at,data FROM records WHERE kind = ? AND id = ?').get(kind, id)
      return rowToRecord(row)
    }
    const entry = json.records[`${kind}:${id}`]
    return entry ? { ...clone(entry.data), id: entry.id, kind: entry.kind, createdAt: entry.createdAt, updatedAt: entry.updatedAt } : null
  }

  function list(kind, { where, limit = 100, offset = 0, order = 'desc', since, until } = {}) {
    assertOpen()
    let rows = []
    if (mode === 'sqlite') {
      const params = [kind]
      let sql = 'SELECT kind,id,created_at,updated_at,data FROM records WHERE kind = ?'
      if (since) { sql += ' AND created_at >= ?'; params.push(Number(since)) }
      if (until) { sql += ' AND created_at <= ?'; params.push(Number(until)) }
      sql += ` ORDER BY created_at ${order === 'asc' ? 'ASC' : 'DESC'}`
      if (!where) {
        sql += ' LIMIT ? OFFSET ?'
        params.push(Math.max(1, Number(limit) || 100), Math.max(0, Number(offset) || 0))
      }
      rows = db.prepare(sql).all(...params).map(rowToRecord)
    } else {
      rows = Object.values(json.records)
        .filter((entry) => entry.kind === kind)
        .map((entry) => ({ ...clone(entry.data), id: entry.id, kind: entry.kind, createdAt: entry.createdAt, updatedAt: entry.updatedAt }))
        .sort((a, b) => (order === 'asc' ? a.createdAt - b.createdAt : b.createdAt - a.createdAt))
    }
    if (where) rows = rows.filter((row) => { try { return where(row) } catch (error) { return false } })
    return rows.slice(Math.max(0, Number(offset) || 0), Math.max(0, Number(offset) || 0) + Math.max(1, Number(limit) || 100))
  }

  function count(kind, where) {
    if (!kind) return 0
    if (mode === 'sqlite' && !where) {
      return Number(db.prepare('SELECT COUNT(*) AS n FROM records WHERE kind = ?').get(kind)?.n || 0)
    }
    return list(kind, { limit: 1000000, where }).length
  }

  function remove(kind, id) {
    assertOpen()
    if (mode === 'sqlite') {
      db.prepare('DELETE FROM records WHERE kind = ? AND id = ?').run(kind, id)
      ftsDelete(kind, id)
    } else {
      delete json.records[`${kind}:${id}`]
      delete json.fts[`${kind}:${id}`]
      saveJson()
    }
  }

  function removeWhere(kind, predicate) {
    let removed = 0
    for (const row of list(kind, { limit: 1000000 })) {
      if (predicate(row)) { remove(kind, row.id); removed += 1 }
    }
    return removed
  }

  function ftsUpsert(kind, id, text) {
    if (!text) return
    if (mode === 'sqlite') {
      if (!ftsEnabled) return
      db.prepare('DELETE FROM fts WHERE kind = ? AND id = ?').run(kind, id)
      db.prepare('INSERT INTO fts(kind,id,text) VALUES(?,?,?)').run(kind, id, ftsText(text))
    } else {
      json.fts[`${kind}:${id}`] = ftsText(text)
    }
  }

  function ftsDelete(kind, id) {
    if (mode === 'sqlite') { if (ftsEnabled) db.prepare('DELETE FROM fts WHERE kind = ? AND id = ?').run(kind, id) }
    else delete json.fts[`${kind}:${id}`]
  }

  /** 词法召回；FTS5 用 MATCH，fallback 用 token overlap。返回 [{id,score}]。 */
  function search(kind, query, limit = 20) {
    assertOpen()
    stats.fts += 1
    const q = String(query || '').trim()
    if (!q) return []
    const tokens = [...new Set(ftsText(q).split(' ').filter(Boolean))]
    if (!tokens.length) return []
    if (mode === 'sqlite' && ftsEnabled) {
      try {
        const expr = tokens.slice(0, 8).map((token) => `"${token.replace(/"/g, '""')}"`).join(' OR ')
        const rows = db.prepare('SELECT id, bm25(fts) AS score FROM fts WHERE fts MATCH ? AND kind = ? ORDER BY score LIMIT ?')
          .all(expr, kind, Math.max(1, Number(limit) || 20))
        return rows.map((row) => ({ id: row.id, score: 1 / (1 + Math.max(0, Number(row.score) || 0)) }))
      } catch (error) {
        stats.errors += 1
        return []
      }
    }
    const querySet = new Set(tokens)
    const scored = []
    const entries = mode === 'sqlite'
      ? db.prepare('SELECT id,data FROM records WHERE kind = ?').all(kind).map(row => {
        const body = JSON.parse(row.data)
        return { kind, id: row.id, text: ftsText(body.ftsText || body.text || body.content || body.summary || '') }
      })
      : Object.entries(json.fts).map(([key,text]) => {
        const split = key.indexOf(':')
        return { kind: key.slice(0,split), id: key.slice(split+1), text }
      })
    for (const { kind: entryKind, id, text } of entries) {
      if (entryKind !== kind) continue
      const textTokens = new Set(String(text || '').split(' ').filter(Boolean))
      let hits = 0
      for (const token of querySet) if (textTokens.has(token)) hits += 1
      if (hits > 0) scored.push({ id, score: hits / Math.max(1, querySet.size) })
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, Math.max(1, Number(limit) || 20))
  }

  function tx(fn) {
    assertOpen()
    if (mode === 'json') {
      const snapshot = txDepth === 0 ? clone(json) : null
      txDepth += 1
      let result
      try { result = fn() } catch (error) {
        txDepth -= 1
        if (snapshot) json = snapshot
        throw error
      }
      txDepth -= 1
      try { saveJson() } catch (error) {
        if (snapshot) json = snapshot
        throw error
      }
      return result
    }
    if (txDepth > 0) return fn()
    txDepth += 1
    try {
      db.exec('BEGIN IMMEDIATE')
      const result = fn()
      db.exec('COMMIT')
      txDepth -= 1
      return result
    } catch (error) {
      try { db.exec('ROLLBACK') } catch (e) {}
      txDepth -= 1
      stats.errors += 1
      throw error
    }
  }

  function appendRaw(event) {
    const platform = String(event.platform || 'onebot11')
    const externalId = String(event.externalId || event.messageId || event.id || '')
    const dedupe = String(event.dedupeKey || (externalId ? `${platform}:${externalId}` : `raw:${hashText(JSON.stringify(event))}`))
    const existing = list('raw_event', { where: (row) => row.dedupeKey === dedupe, limit: 1 })[0]
    if (existing) return { inserted: false, record: existing }
    const id = uid('raw')
    const data = { ...event, dedupeKey: dedupe, platform, accepted: Boolean(event.accepted) }
    const record = put('raw_event', id, data)
    return { inserted: true, record }
  }

  function markRawAccepted(id, accepted = true) {
    const record = get('raw_event', id)
    if (!record) return null
    return put('raw_event', id, { ...record, accepted })
  }

  function backup(targetFile) {
    if (mode === 'sqlite') {
      const target = targetFile || join(dirname(dbFile), 'backups', `cognition-v${SCHEMA_VERSION}-${Date.now()}.sqlite`)
      mkdirSync(dirname(target), { recursive: true })
      db.prepare('VACUUM INTO ?').run(target)
      return target
    }
    const target = targetFile || `${jsonFile}.bak`
    writeFileSync(target, JSON.stringify(json), 'utf8')
    return target
  }

  function close() {
    if (closed) return
    closed = true
    if (mode === 'sqlite') {
      try { db.close() } catch (error) {}
    } else {
      try { saveJson() } catch (error) {}
    }
  }

  function info() {
    return { mode, ftsEnabled, file: mode === 'sqlite' ? dbFile : jsonFile, schemaVersion: SCHEMA_VERSION, stats: { ...stats } }
  }

  /** 清理保留期数据；调用方传入每个 kind 的保留毫秒数。 */
  function prune(retention = {}, nowValue = now()) {
    let removed = 0
    for (const [kind, ms] of Object.entries(retention)) {
      const days = Number(ms)
      if (!Number.isFinite(days) || days <= 0) continue
      const cutoff = nowValue - days * 24 * 60 * 60 * 1000
      removed += removeWhere(kind, (row) => Number(row.createdAt || row.updatedAt || 0) < cutoff)
    }
    return removed
  }

  return {
    mode,
    atomicTransactions: true,
    info,
    put, get, list, count, remove, removeWhere, search, tx,
    appendRaw, markRawAccepted,
    backup, prune, close,
    get open() { return !closed },
  }
}

export { SCHEMA_VERSION }
