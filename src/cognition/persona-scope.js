// 人格作用域：把认知数据透明地存到 persona 命名空间。
//
// 设计原则：
// - 人格记录、activeId、全局状态、原始事件、turn、审计日志、LLM 总用量保持全局；
// - 记忆/人物/关系/情绪/策略/学习/技能/诊断/LLM 人格用量等按 persona 前缀隔离；
// - 旧 v0.7 及以前的无前缀数据在启动时迁移到默认 self 人格；
// - 服务层不需要知道 persona，所有 get/put/list/search 都由 wrapper 自动加前缀。
import { deepClone } from './util.js'

// 固定内部集合，记录 ID 再按模块隔离；不加入 UI 数据复制/统计组。
export const MODULE_STORE_KIND = 'module_store'

export const PERSONA_GLOBAL_KINDS = new Set([
  'setting',
  'persona',
  'state',
  'raw_event',
  'turn',
  'audit_log',
  'llm_usage',
])

export const PERSONA_DATA_GROUPS = [
  { id: 'memory', label: '记忆', kinds: ['memory', 'memory_link'] },
  { id: 'timeline', label: '时间轴事件', kinds: ['timeline_event'] },
  { id: 'requests', label: '请求', kinds: ['qq_request'] },
  { id: 'reminders', label: '提醒', kinds: ['reminder'] },
  { id: 'people', label: '人物画像', kinds: ['person', 'identity', 'person_facet'] },
  { id: 'relationships', label: '关系', kinds: ['relationship', 'relationship_event'] },
  { id: 'emotion', label: '情绪', kinds: ['emotion', 'emotion_event'] },
  { id: 'policy', label: '策略与决策', kinds: ['decision', 'outcome', 'policy', 'proactive_intent'] },
  { id: 'learning', label: '信念与学习', kinds: ['belief', 'unknown', 'learning_task', 'learning_evidence', 'knowledge_claim'] },
  { id: 'skills', label: '技能', kinds: ['skill', 'skill_event'] },
  { id: 'diagnostics', label: '诊断与元认知', kinds: ['meta_insight', 'trace', 'metric'] },
]

export const PERSONA_DATA_KINDS = PERSONA_DATA_GROUPS.flatMap((group) => group.kinds)
export const PERSONA_DATA_GROUP_IDS = PERSONA_DATA_GROUPS.map((group) => group.id)

export function scopedPersonaKind(personaId, kind) {
  if (PERSONA_GLOBAL_KINDS.has(kind)) return kind
  return `persona_${personaId || 'self'}:${kind}`
}

export function personaFromScopedKind(kind) {
  const match = /^persona_([a-z0-9][a-z0-9._-]{0,63}):(.+)$/.exec(String(kind || ''))
  return match ? { personaId: match[1], kind: match[2] } : null
}

/**
 * 只做 kind 映射的 store facade；tx 透传，保证服务层事务仍然生效。
 */
export function createPersonaScopedStore({ base, getPersonaId }) {
  const current = () => String(getPersonaId?.() || 'self')
  const kindOf = (kind) => scopedPersonaKind(current(), kind)
  return {
    get(kind, id) { return base.get(kindOf(kind), id) },
    put(kind, id, value, options) { return base.put(kindOf(kind), id, value, options) },
    remove(kind, id) { return base.remove(kindOf(kind), id) },
    list(kind, options) { return base.list(kindOf(kind), options) },
    count(kind, where) { return base.count(kindOf(kind), where) },
    removeWhere(kind, predicate) { return base.removeWhere(kindOf(kind), predicate) },
    search(kind, query, limit) { return base.search(kindOf(kind), query, limit) },
    tx(fn) { return base.tx(fn) },
    base,
    get atomicTransactions() { return base.atomicTransactions === true },
    scopedKind: kindOf,
    currentPersonaId: current,
  }
}

function copyLegacyKind(base, targetId, kind) {
  let copied = 0
  const rows = base.list(kind, { limit: 1000000 })
  for (const row of rows) {
    const targetKind = scopedPersonaKind(targetId, kind)
    if (!base.get(targetKind, row.id)) {
      base.put(targetKind, row.id, row, {
        createdAt: Number(row.createdAt) || undefined,
        updatedAt: Number(row.updatedAt) || undefined,
      })
      copied += 1
    }
    base.remove(kind, row.id)
  }
  return copied
}

/**
 * v0.8 数据迁移：把旧的无前缀认知数据迁到默认人格。
 * 迁移是幂等的：完成标记写入 setting；已有同 id 的目标记录不覆盖。
 */
export function migrateLegacyPersonaData({ base, targetId = 'self', clock = { now: Date.now } } = {}) {
  const marker = base.get('setting', 'persona.dataMigration.v08')
  if (marker && Number(marker.version) >= 1) return { migrated: 0, skipped: true, targetId: marker.targetPersonaId || targetId }
  let migrated = 0
  try {
    base.tx(() => {
      for (const kind of PERSONA_DATA_KINDS) migrated += copyLegacyKind(base, targetId, kind)
      base.put('setting', 'persona.dataMigration.v08', {
        version: 1,
        targetPersonaId: targetId,
        migrated,
        at: clock.now(),
      })
    })
  } catch (error) {
    // 迁移失败不阻塞启动；下次启动会重试。已迁移的行已删除，未迁移的仍保留。
    return { migrated, failed: true, reason: String(error?.message || error), targetId }
  }
  return { migrated, skipped: false, targetId }
}

export function dropPersonaData({ base, personaId }) {
  let removed = 0
  for (const kind of [...PERSONA_DATA_KINDS, 'llm_usage_persona', MODULE_STORE_KIND, 'loop_run', 'delivery_receipt']) {
    const targetKind = scopedPersonaKind(personaId, kind)
    try {
      removed += base.removeWhere(targetKind, () => true)
    } catch (error) {}
  }
  return removed
}

export function personaDataCounts({ base, personaId }) {
  const groups = []
  let total = 0
  for (const group of PERSONA_DATA_GROUPS) {
    let count = 0
    for (const kind of group.kinds) {
      try { count += base.count(scopedPersonaKind(personaId, kind)) } catch (error) {}
    }
    total += count
    groups.push({ id: group.id, label: group.label, count })
  }
  return { personaId, total, groups }
}

function normalizeGroups(groups) {
  const wanted = Array.isArray(groups) && groups.length ? groups.map(String) : PERSONA_DATA_GROUP_IDS
  return [...new Set(wanted)].filter((id) => PERSONA_DATA_GROUP_IDS.includes(id))
}

export function copyPersonaData({ base, from, to, groups, clock = { now: Date.now } }) {
  if (!from || !to) return { ok: false, code: 'PERSONA_REQUIRED', message: '缺少来源或目标人格' }
  if (from === to) return { ok: false, code: 'SAME_PERSONA', message: '来源和目标不能是同一人格' }
  if (!base.get('persona', from) || !base.get('persona', to)) return { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' }
  const selected = normalizeGroups(groups)
  if (!selected.length) return { ok: false, code: 'NO_GROUPS', message: '至少选择一个数据组' }
  const copied = {}
  try {
    base.tx(() => {
      for (const group of PERSONA_DATA_GROUPS.filter((item) => selected.includes(item.id))) {
        let count = 0
        for (const kind of group.kinds) {
          const targetKind = scopedPersonaKind(to, kind)
          const sourceKind = scopedPersonaKind(from, kind)
          base.removeWhere(targetKind, () => true)
          for (const row of base.list(sourceKind, { limit: 1000000 })) {
            base.put(targetKind, row.id, deepClone(row), {
              createdAt: Number(row.createdAt) || clock.now(),
              updatedAt: Number(row.updatedAt) || clock.now(),
            })
            count += 1
          }
        }
        copied[group.id] = count
      }
    })
  } catch (error) {
    return { ok: false, code: 'COPY_FAILED', message: String(error?.message || error) }
  }
  return { ok: true, from, to, groups: selected, copied, summary: personaDataCounts({ base, personaId: to }) }
}
