// 认知内核入口：组装存储、服务、轮次聚合、管线与后台任务。
//
// 平台层只通过 ingestRaw()/observe() 输入；内部服务不 import gateway/http。
// 所有状态由本服务单写；查询/命令通过 snapshot()/api 暴露。

import { join } from 'node:path'
import { appendJsonl, dataDir as pluginDataDir } from '../core/store.js'
import { createStore } from './store.js'
import { createApprovalService } from '../core/approvals.js'
import { createTurnAggregator } from './turn.js'
import { createPersonService } from './person.js'
import { createIdentityService } from './identities.js'
import { createRelationshipService } from './relationships.js'
import { createEmotionService } from './emotion.js'
import { createPersonaService } from './persona.js'
import { createMemoryService } from './memory.js'
import { createEmbeddingService } from './embeddings.js'
import { createArchiveImportService } from './archive-import.js'
import {
  createPersonaScopedStore,
  migrateLegacyPersonaData,
  personaDataCounts,
  copyPersonaData as copyPersonaDataService,
  dropPersonaData,
} from './persona-scope.js'
import { createPolicyService } from './policy.js'
import { createLlmClient } from './llm.js'
import { createSkillService } from './skills.js'
import { createMetaService } from './meta.js'
import { createBeliefService } from './beliefs.js'
import { createKnowledgeService, defaultSourceRegistry } from './knowledge.js'
import { createPipeline } from './pipeline.js'
import { createOutbound } from './outbound.js'
import { createDeliveryService } from '../delivery/service.js'
import { createAgentRuntime } from '../runtime/agent.js'
import { createReminderService } from './reminders.js'
import { createCommandService } from './commands.js'
import { createNoticeService } from './notices.js'
import { createQqActions } from './qq-actions.js'
import { createPurposeService } from './purpose.js'
import { createConsolidationService } from './consolidation.js'
import { createTimelineService } from './timeline.js'
import { createClock, createRng, createScheduler, nowMs, safeJson, uid, truncate } from './util.js'

export function createCognition({
  ctx,
  getConfig,
  gateway,
  logger,
  clock = createClock(),
  scheduler = createScheduler(),
  rng = createRng(1),
  dataRoot,
  dryRun = null,
  models = null,
  access = null,
  setConfig = null,
  media = null,
  providerRegistry = null,
  deliveryRegistry = null,
  turnHooks = null,
} = {}) {
  const log = logger?.child?.('cognition') || logger || { info() {}, warn() {}, debug() {}, error() {} }
  const baseDir = dataRoot || pluginDataDir('cognition')
  const rawFile = join(baseDir, 'raw-events.jsonl')
  const dbFile = join(baseDir, 'cognition.sqlite')
  const state = {
    ready: false,
    error: '',
    paused: false,
    store: null,
    startedAt: clock.now(),
    stats: { raw: 0, observed: 0, accepted: 0, dropped: 0, turns: 0 },
    services: {},
  }
  const knowledgeSources = new Map()
  const capabilities = new Map()
  let remindersStarted = false
  const cfg = () => {
    try { return getConfig()?.cognition || {} } catch (error) { return {} }
  }

  function publicState() {
    const c = cfg()
    return {
      enabled: Boolean(c.enabled),
      paused: Boolean(c.paused || state.paused),
      dryRun: Boolean(c.dryRun),
      turn: { addressedOnlyGroups: c.turn?.addressedOnlyGroups !== false },
      policy: { proactive: Boolean(c.policy?.proactive), groupAmbient: Boolean(c.policy?.groupAmbient) },
      learning: { enabled: Boolean(c.learning?.enabled), autoResearch: Boolean(c.learning?.autoResearch) },
      privacy: { privateIsolation: c.privacy?.privateIsolation !== false },
    }
  }

  function init() {
    try {
      state.store = createStore({ file: dbFile, log, clock })
      const pausedRecord = state.store.get('setting', 'cognition.paused')
      if (pausedRecord) state.paused = Boolean(pausedRecord.value)
      state.services.identities = createIdentityService({ store: state.store, clock, logger: log })
      state.services.persona = createPersonaService({ store: state.store, getConfig, clock })
      const activePersona = state.services.persona.ensure()
      const migrationTarget = state.services.persona.getById('self') ? 'self' : activePersona.id
      const migration = migrateLegacyPersonaData({ base: state.store, targetId: migrationTarget, clock })
      if (migration.migrated) log.info?.(`认知数据已迁移到人格 ${migrationTarget}：${migration.migrated} 条`)
      state.scopedStore = createPersonaScopedStore({
        base: state.store,
        getPersonaId: () => state.services.persona?.activeId?.() || migrationTarget,
      })
      const personaStore = state.scopedStore
      state.services.personaStore = personaStore
      state.services.emotion = createEmotionService({ store: personaStore, getConfig, clock })
      state.services.person = createPersonService({ store: personaStore, getConfig, clock })
      state.services.relationships = createRelationshipService({ store: personaStore, getConfig, clock })
      const embedder = createEmbeddingService({ getConfig, logger: log })
      state.services.memory = createMemoryService({ store: personaStore, getConfig, clock, log, embedder })
      state.services.archiveImport = createArchiveImportService({ store: state.scopedStore, getConfig, clock, logger: log })
      state.services.purpose = createPurposeService({ store: personaStore, getConfig, clock, log })
      state.services.timeline = createTimelineService({ store: state.store, scopedStore: personaStore, clock })
      state.services.consolidation = createConsolidationService({
        memory: state.services.memory,
        llm: state.services.llm,
        getConfig,
        clock,
        scheduler,
        logger: log,
      })
      state.services.policy = createPolicyService({ store: personaStore, getConfig, clock, rng })
      state.services.llm = createLlmClient({ ctx, models, getConfig, store: personaStore, clock, log })
      state.services.outbound = createOutbound({
        getConfig,
        gateway: {
          get actions() {
            return gateway?.actions
          },
        },
        policy: state.services.policy,
        access,
        logger: log,
        clock,
      })
      state.services.delivery = createDeliveryService({ outbound: state.services.outbound })
      state.services.runtime = createAgentRuntime({
        delivery: state.services.delivery,
        ctx,
        getConfig,
        access,
        gateway,
        outbound: state.services.outbound,
        logger: log,
        dataRoot: pluginDataDir('runtime'),
      })
      state.services.approvals = createApprovalService({ store: state.store, clock, logger: log })
      state.services.qqActions = createQqActions({ gateway, getConfig, logger: log })
      state.services.notices = createNoticeService({ store: state.scopedStore, getConfig, clock, logger: log, gateway })
      state.services.reminders = createReminderService({
        store: personaStore, getConfig, clock, scheduler, access,
        outbound: state.services.outbound, logger: log,
      })
      state.services.commands = createCommandService({
        delivery: state.services.delivery,
        getConfig,
        setConfig,
        access,
        outbound: state.services.outbound,
        llm: state.services.llm,
        memory: state.services.memory,
        runtime: state.services.runtime,
        qqActions: state.services.qqActions,
        requests: state.services.notices,
        approvals: state.services.approvals,
        clock,
        reminders: state.services.reminders,
        purpose: state.services.purpose,
        identities: state.services.identities,
        media,
        logger: log,
      })
      state.services.skills = createSkillService({ store: personaStore, getConfig, clock, log })
      state.services.beliefs = createBeliefService({ store: personaStore, getConfig, clock })
      state.services.sources = defaultSourceRegistry({ ctx, getConfig, clock, log })
      state.services.knowledge = createKnowledgeService({ store: personaStore, getConfig, clock, llm: state.services.llm, sources: state.services.sources, log })
      state.services.meta = createMetaService({ store: personaStore, getConfig, clock, log, skills: state.services.skills, knowledge: state.services.knowledge })
      state.services.pipeline = createPipeline({
        turnHooks,
        deliveryRegistry,
        store: personaStore,
        getConfig,
        clock,
        logger: log,
        person: state.services.person,
        relationships: state.services.relationships,
        emotion: state.services.emotion,
        persona: state.services.persona,
        memory: state.services.memory,
        policy: state.services.policy,
        llm: state.services.llm,
        knowledge: state.services.knowledge,
        skills: state.services.skills,
        beliefs: state.services.beliefs,
        gateway,
        dryRun,
        outbound: state.services.outbound,
        runtime: state.services.runtime,
        commands: state.services.commands,
        purpose: state.services.purpose,
        media,
        turnAggregator: null,
      })
      state.services.aggregator = createTurnAggregator({
        getConfig,
        clock,
        scheduler,
        store: personaStore,
        log,
        getWakeWords: () => {
          const name = state.services.persona?.get?.()?.profile?.displayName
          return name ? [String(name)] : []
        },
        onTurn: (turn) => {
          state.stats.turns += 1
          try { state.services.pipeline.observeIncoming(turn) } catch (error) { log.debug?.('outcome 观察失败：', error.message) }
          return state.services.pipeline.handleTurn(turn)
        },
      })
      // 让 pipeline 能在发送后通知 aggregator 记录 bot message id（避免回复自己/识别回复）。
      state.services.pipeline.setTurnAggregator(state.services.aggregator)
      state.services.proactivityState = () => ({ ...publicState(), ready: state.ready, now: clock.now() })
      state.ready = true
      state.services.aggregator.restore()
      log.info?.(`认知存储就绪：${state.store.info().mode} ${dbFile}`)
      startBackgroundJobs()
    } catch (error) {
      state.error = String(error?.message || error)
      state.ready = false
      log.warn?.(`认知初始化失败：${state.error}`)
    }
    return state.ready
  }

  // The host selects the reminder owner after modules have finished setup.
  function startReminders() {
    if (!state.ready || remindersStarted) return
    state.services.reminders.start()
    remindersStarted = true
  }

  function stopReminders() {
    remindersStarted = false
    return state.services.reminders?.stop()
  }

  function startBackgroundJobs() {
    let stopped = false
    const tick = async () => {
      if (stopped) return
      try {
        const c = cfg()
        if (c.enabled && !state.paused && c.learning?.autoResearch) {
          await state.services.knowledge?.runPending?.({ max: 1 })
        }
      } catch (error) {
        log.debug?.('后台学习任务失败：', error.message)
      }
      if (!stopped) scheduler.setTimeout(tick, 60 * 1000)
    }
    scheduler.setTimeout(tick, 30 * 1000)
  }

  function rawPayload(raw, maxBytes = 16384) {
    try {
      const text = JSON.stringify(raw ?? null)
      if (Buffer.byteLength(text) <= maxBytes) return safeJson(raw, null)
      return { __truncated: true, bytes: Buffer.byteLength(text), preview: text.slice(0, Math.max(128, Math.floor(maxBytes / 2))) }
    } catch (error) {
      return { __truncated: true, bytes: 0 }
    }
  }

  function extractRawMeta(raw) {
    const message = raw?.message && typeof raw.message === 'object' ? raw.message : null
    const sender = message?.sender && typeof message.sender === 'object' ? message.sender : {}
    return {
      platform: 'onebot11',
      externalId: String(raw?.message_id ?? raw?.notice?.message_id ?? raw?.message_id ?? ''),
      kind: String(raw?.post_type || 'unknown'),
      chatType: String(message?.message_type || (raw?.group_id ? 'group' : 'private') || 'other'),
      chatId: String(raw?.group_id ?? raw?.user_id ?? ''),
      senderId: String(sender.user_id ?? raw?.user_id ?? ''),
      receivedAt: clock.now(),
    }
  }

  /** 过滤前原始事件：先 JSONL + DB，永不因后续过滤丢失。 */
  function ingestRaw(raw, meta = {}) {
    if (!cfg().enabled || !state.ready || !state.store) return { stored: false, reason: 'disabled' }
    try {
      const base = extractRawMeta(raw)
      const payload = rawPayload(raw, Number(meta.maxBytes) || 16384)
      const record = {
        ...base,
        ...meta,
        accepted: false,
        payload,
        dedupeKey: base.externalId ? `onebot11:${base.externalId}` : `raw:${uid('dedupe')}`,
        receivedAt: clock.now(),
      }
      appendJsonl(rawFile, { at: record.receivedAt, ...record }, { maxBytes: 128 * 1024 * 1024 })
      const result = state.store.appendRaw(record)
      if (result.inserted) {
        state.stats.raw += 1
        try { ctx?.emit?.('onebot-qq/raw', { ...record, id: result.record.id }) } catch (error) {}
      }
      return { stored: result.inserted, record: result.record || null }
    } catch (error) {
      log.warn?.('原始事件写入失败：', error.message)
      return { stored: false, reason: error.message }
    }
  }

  function isRecall(notice) {
    return Boolean(notice && (String(notice.type || '').includes('recall') || notice.subType === 'recall'))
  }

  function isPoke(notice) {
    return Boolean(notice && String(notice.type || '') === 'notify' && ['poke', 'pat'].includes(String(notice.subType || '')))
  }

  function isReaction(notice) {
    const type = String(notice?.type || '')
    const subType = String(notice?.subType || '')
    return type === 'group_msg_emoji_like' || type === 'message_reaction' || type === 'reaction'
      || subType === 'emoji_like' || subType === 'reaction'
  }

  function sawContentFor(messageId) {
    if (!messageId || !state.store) return false
    const row = state.store.list('raw_event', {
      limit: 5,
      where: (item) => String(item.externalId || '') === String(messageId) || String(item.payload?.message_id || '') === String(messageId),
    })[0]
    if (!row) return false
    const message = row.payload?.message ?? row.payload?.raw?.message
    if (Array.isArray(message)) return message.some((segment) => segment && (segment.type === 'text' ? String(segment.data?.text || '').trim() : true))
    return Boolean(String(message || '').trim())
  }

  function observe(normalized, info = {}) {
    if (!cfg().enabled || !state.ready || !state.services.aggregator) return
    state.stats.observed += 1
    try {
      const accepted = info.accepted !== false
      if (accepted) state.stats.accepted += 1
      else state.stats.dropped += 1
      const externalId = normalized?.kind === 'message' ? String(normalized.message?.id || '') : ''
      if (externalId) {
        const row = state.store.list('raw_event', { limit: 5, where: (item) => String(item.externalId || '') === externalId })[0]
        if (row) state.store.markRawAccepted(row.id, accepted)
      }
      if (state.paused || cfg().paused) return
      if (!accepted) return
      if (normalized?.kind === 'notice' && isRecall(normalized.notice)) {
        const messageId = String(normalized.notice.messageId || '')
        const sawContent = sawContentFor(messageId)
        state.services.aggregator.handleRecall(normalized.notice)
        state.services.pipeline.handleRecall({ notice: normalized.notice, messageId, sawContent }).catch((error) => log.warn?.('撤回处理失败：', error.message))
        return
      }
      if (normalized?.kind === 'notice' && isPoke(normalized.notice)) {
        state.services.pipeline.handlePoke?.({ notice: normalized.notice }).catch((error) => log.debug?.('拍一拍处理失败：', error.message))
        return
      }
      if (normalized?.kind === 'notice' && isReaction(normalized.notice)) {
        state.services.pipeline.handleReaction?.({ notice: normalized.notice })
        return
      }
      if (normalized?.kind === 'notice') state.services.notices.handle({ ...normalized.notice, time: normalized.time, selfId: normalized.selfId })
      if (normalized?.kind === 'request') state.services.notices.handleRequest(normalized.request)
      if (normalized?.kind === 'message') state.services.aggregator.ingest(normalized)
    } catch (error) {
      log.warn?.('认知事件处理失败：', error.message)
    }
  }

  function pause(reason = '') {
    state.paused = true
    state.store?.put('setting', 'cognition.paused', { value: true, reason: String(reason || ''), at: clock.now() })
    return publicSnapshot()
  }

  function resume() {
    state.paused = false
    state.store?.put('setting', 'cognition.paused', { value: false, reason: '', at: clock.now() })
    return publicSnapshot()
  }

  function counts() {
    const out = {}
    if (!state.store) return out
    for (const kind of ['person', 'identity', 'relationship', 'memory', 'purpose', 'unknown', 'learning_task', 'knowledge_claim', 'decision', 'outcome', 'skill', 'belief', 'trace', 'raw_event']) {
      try { out[kind] = state.scopedStore.count(kind) } catch (error) { out[kind] = 0 }
    }
    return out
  }

  function publicSnapshot() {
    return {
      ok: Boolean(state.ready) && !state.error,
      ready: state.ready,
      error: state.error,
      paused: Boolean(state.paused || cfg().paused),
      dryRun: Boolean(cfg().dryRun),
      mode: state.store?.info().mode || 'unavailable',
      dbFile,
      rawFile,
      startedAt: state.startedAt,
      counts: counts(),
      stats: { ...state.stats },
      turn: state.services.aggregator?.stats || null,
      pipeline: state.services.pipeline ? {
        ...(state.services.pipeline.stats?.() || {}),
        groupMode: state.services.pipeline.groupMode?.() || 'addressed',
      } : null,
      capabilities: [...capabilities.keys()],
      knowledgeSources: [...knowledgeSources.keys(), ...(state.services.sources?.list?.().map((item) => item.id) || [])].filter((value, index, all) => all.indexOf(value) === index),
      config: publicState(),
    }
  }

  async function overview() {
    const snap = publicSnapshot()
    let llm = null
    try { llm = await state.services.llm?.status?.() } catch (error) { llm = { available: false, error: error.message } }
    return {
      ...snap,
      llm,
      persona: state.services.persona?.summary?.() || null,
      emotion: state.services.emotion?.prompt?.() || null,
      skills: state.services.skills?.summary?.() || null,
      metrics: state.services.meta?.metrics?.() || null,
      recentDecisions: state.services.policy?.history?.({ limit: 10 }) || [],
      recentUnknowns: state.services.knowledge?.listUnknowns?.({ limit: 5 }) || [],
    }
  }

  function registerKnowledgeSource(source) {
    if (!source?.id) throw new Error('knowledge source 需要 id')
    knowledgeSources.set(String(source.id), source)
    const dispose = state.services.sources?.register?.(source)
    return () => { knowledgeSources.delete(String(source.id)); try { dispose?.() } catch (error) {} }
  }

  function registerCapability(name, impl) {
    if (!name) throw new Error('capability 需要 name')
    capabilities.set(String(name), impl)
    return () => capabilities.delete(String(name))
  }

  function getKnowledgeSources() {
    return [...knowledgeSources.values(), ...(state.services.sources?.list?.() || [])]
  }

  // ---- UI/API 查询与命令（全部经过服务层，不直接暴露 SQL）----
  function persons(query) {
    return state.services.person?.listPersons?.(query) || []
  }
  function personDetail(personId) {
    return state.services.person?.detail?.(personId) || null
  }
  function correctFacet(personId, facetId, patch) {
    return state.services.person?.correctFacet?.(facetId, patch) || null
  }
  function deleteFacet(personId, facetId) {
    return state.services.person?.deleteFacet?.(facetId) || null
  }
  function relationshipsList(query = {}) {
    return state.services.relationships?.list?.(query) || []
  }
  function relationshipHistory(personId, query = {}) {
    return state.services.relationships?.history?.(personId, query) || []
  }
  function adjustRelationship(personId, patch) {
    return state.services.relationships?.adjust?.(personId, patch) || null
  }
  function memories(query) {
    return state.services.memory?.list?.(query) || []
  }
  function memoryDetail(id) {
    return state.services.memory?.get?.(id) || null
  }
  function importArchive(input) {
    if (cfg().import?.enabled === false) throw new Error('导入旧档案已禁用')
    if (!state.ready || !state.services.archiveImport) throw new Error('认知存储尚未就绪，无法导入旧档案')
    return state.services.archiveImport.importArchive(input)
  }
  function memoryAction(id, action) {
    if (action === 'activate') return state.services.memory?.activate?.(id) || null
    if (action === 'forget') return state.services.memory?.forget?.(id) || null
    if (action === 'delete') { state.services.memory?.remove?.(id); return { deleted: true, id } }
    return null
  }
  function emotionState() {
    const emotion = state.services.emotion?.get?.()
    return { emotion, visible: state.services.emotion?.visible?.() || null, persona: state.services.persona?.summary?.() || null }
  }
  function adjustEmotion(patch) { return state.services.emotion?.adjust?.(patch, 'ui') || null }
  function resetEmotion() { return state.services.emotion?.reset?.() || null }
  function personaState() { return state.services.persona?.get?.() || null }
  function personaList() { return state.services.persona?.list?.() || [] }
  function activePersonaId() { return state.services.persona?.activeId?.() || '' }
  function createPersona(patch) { return state.services.persona?.create?.(patch || {}) || null }
  function importPersona(patch) { return state.services.persona?.importPersona?.(patch || {}) || null }
  function duplicatePersona(personaId) { return state.services.persona?.duplicate?.(personaId) || null }
  function switchPersona(personaId) { return state.services.persona?.activate?.(personaId) || { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' } }
  function deletePersona(personaId) {
    const result = state.services.persona?.remove?.(personaId) || { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' }
    if (result.ok) {
      try { dropPersonaData({ base: state.store, personaId }) } catch (error) { log.warn?.('删除人格数据失败：', error.message) }
    }
    return result
  }
  function personaDataSummary(personaId = '') {
    const id = personaId || activePersonaId()
    const persona = state.services.persona?.getById?.(id) || (id === activePersonaId() ? personaState() : null)
    if (!persona) return null
    return { ...personaDataCounts({ base: state.store, personaId: id }), persona }
  }
  function llmUsage() {
    const usage = state.services.llm?.usage?.()
    return usage ? { ...usage, personaId: activePersonaId() } : null
  }
  function resetLlmUsage(scope) {
    if (!['global', 'persona', 'both'].includes(scope)) throw new Error('LLM 用量重置 scope 必须为 global、persona 或 both')
    if (typeof state.services.llm?.resetUsage !== 'function') throw new Error('LLM 用量服务不可用')
    return { ...state.services.llm.resetUsage({ scope }), personaId: activePersonaId() }
  }
  function testLlm(payload = {}) { return state.services.llm?.test?.(payload) || { ok: false, error: 'LLM_UNAVAILABLE', message: 'LLM 服务不可用' } }
  function personaDataAll() {
    return personaList().map((item) => ({
      id: item.id,
      displayName: item.displayName,
      active: item.active,
      ...personaDataCounts({ base: state.store, personaId: item.id }),
    }))
  }
  function copyPersonaData(from, to, groups) {    const source = state.services.persona?.getById?.(from)
    const target = state.services.persona?.getById?.(to)
    if (!source || !target) return { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' }
    return copyPersonaDataService({ base: state.store, from: source.id, to: target.id, groups, clock })
  }
  function editPersona(patch, personaId = '') { return state.services.persona?.edit?.(patch, personaId) || null }
  function resetPersona(personaId = '') { return state.services.persona?.reset?.(personaId) || null }
  function decisions(query = {}) { return state.services.policy?.history?.(query) || [] }
  function correctDecision(decisionId, observation) { return state.services.policy?.recordOutcome?.(decisionId, observation) || null }
  function policyStats() { return state.services.policy?.stats?.() || null }
  function resetPolicy() { return state.services.policy?.resetLearning?.() || null }
  function skillsList() { return state.services.skills?.list?.() || [] }
  function skillUse(name, success) { return state.services.skills?.use?.(name, { success, reason: 'ui' }) || null }
  function beliefsList(query = {}) { return state.services.beliefs?.list?.(query) || [] }
  function correctBelief(id, patch) { return state.services.beliefs?.correct?.(id, patch || {}) || null }
  function unknowns(query = {}) { return state.services.knowledge?.listUnknowns?.(query) || [] }
  function learningTasks(query = {}) { return state.services.knowledge?.listTasks?.(query) || [] }
  function claims(query = {}) { return state.services.knowledge?.listClaims?.(query) || [] }
  async function runLearning(query = {}) { return state.services.knowledge?.runPending?.({ max: Number(query.max) || 1 }) || [] }
  function retryTask(taskId) { return state.services.knowledge?.retry?.(taskId) || null }
  function cancelTask(taskId) { return state.services.knowledge?.cancel?.(taskId) || null }
  function metrics() { return state.services.meta?.metrics?.() || null }
  function proactivityStats() {
    return providerRegistry?.get('proactivity')?.stats() || { active: false, running: false, lastTickAt: 0, lastError: '', sent: 0, skipped: 0, dailyCount: 0, reason: 'MODULE_DISABLED' }
  }
  async function runProactivity() {
    return providerRegistry?.get('proactivity')?.tick() || { ok: false, reason: 'MODULE_DISABLED' }
  }
  function insights(query = {}) { return state.services.meta?.listInsights?.(query) || [] }
  function generateInsight() { return state.services.meta?.generateInsight?.() || null }
  function traces(turnId, { limit = 100 } = {}) {
    return state.scopedStore.list('trace', { limit: Number(limit) || 100, where: (item) => !turnId || item.turnId === turnId })
  }
  function exportPerson(personId) {
    const person = state.services.person?.detail?.(personId)
    if (!person) return null
    const relationshipRows = state.scopedStore.list('relationship', { limit: 100, where: (item) => item.personId === personId })
    const memoryRows = state.scopedStore.list('memory', { limit: 10000, where: (item) => item.personId === personId })
    const relationshipEvents = state.scopedStore.list('relationship_event', { limit: 2000, where: (item) => item.personId === personId })
    return { person, relationships: relationshipRows, relationshipEvents, memories: memoryRows, exportedAt: clock.now() }
  }
  function deletePerson(personId) {
    const person = state.store?.get('person', personId)
    if (!person) return { deleted: false }
    const removed = {}
    storeTxSafe(() => {
      for (const kind of ['identity', 'person_facet', 'relationship', 'relationship_event', 'memory', 'learning_task']) {
        removed[kind] = state.scopedStore.removeWhere(kind, (item) => item.personId === personId || item.person_id === personId)
      }
      for (const memory of state.scopedStore.list('memory', { limit: 100000, where: (item) => item.personId === personId })) {
        state.services.memory?.remove?.(memory.id)
      }
      state.scopedStore.put('person', personId, { ...person, status: 'deleted', deletedAt: clock.now(), displayName: '已删除人物' })
      state.scopedStore.put('audit_log', uid('audit'), { actor: 'ui', action: 'delete_person', entity: personId, at: clock.now(), removed })
    })
    return { deleted: true, personId, removed }
  }
  function storeTxSafe(fn) {
    try { return state.scopedStore.tx(fn) } catch (error) { log.warn?.('认知事务失败：', error.message); return null }
  }

  function timeline(options = {}) {
    return state.services.timeline?.timeline?.(options) || []
  }

  function timelineStats() {
    return state.services.timeline?.stats?.() || null
  }

  function consolidationStats() {
    return state.services.consolidation?.status?.() || null
  }

  async function runConsolidation(options = {}) {
    return state.services.consolidation?.runOnce?.(options) || { ok: false, error: 'CONSOLIDATION_UNAVAILABLE' }
  }

  function purposeSummary() {
    return state.services.purpose?.stats?.() || null
  }

  function purposeList(options = {}) {
    return state.services.purpose?.list?.(options) || []
  }

  function purposeCreate(input = {}) {
    const result = state.services.purpose?.create?.(input)
    if (!result) throw new Error('标题不能为空')
    return result
  }

  function purposeUpdate(id, patch = {}) {
    const result = state.services.purpose?.update?.(id, patch)
    if (!result) throw new Error('目的不存在')
    return result
  }

  function purposeDelete(id) {
    return Boolean(state.services.purpose?.remove?.(id))
  }

  function dispose() {
    try { state.services.reminders?.dispose?.() } catch (error) {}
    try { state.services.consolidation?.dispose?.() } catch (error) {}
    try { state.services.runtime?.dispose?.() } catch (error) {}
    try { scheduler.dispose?.() } catch (error) {}
    try { state.services.aggregator?.dispose?.() } catch (error) {}
    try { state.store?.close() } catch (error) {}
    state.ready = false
  }

  init()

  return {
    get ready() { return Promise.resolve(state.ready) },
    startReminders,
    stopReminders,
    get state() { return state },
    get store() { return state.store },
    get services() { return state.services },
    ingestRaw,
    observe,
    pause,
    resume,
    snapshot: publicSnapshot,
    overview,
    persons,
    personDetail,
    correctFacet,
    deleteFacet,
    relationshipsList,
    relationshipHistory,
    adjustRelationship,
    memories,
    memoryDetail,
    importArchive,
    memoryAction,
    emotionState,
    adjustEmotion,
    resetEmotion,
    personaState,
    personaList,
    activePersonaId,
    createPersona,
    importPersona,
    duplicatePersona,
    switchPersona,
    deletePersona,
    personaDataSummary,
    personaDataAll,
    copyPersonaData,
    testLlm,
    llmUsage,
    resetLlmUsage,
    editPersona,
    resetPersona,
    decisions,
    correctDecision,
    policyStats,
    resetPolicy,
    skillsList,
    skillUse,
    beliefsList,
    correctBelief,
    unknowns,
    learningTasks,
    claims,
    runLearning,
    retryTask,
    cancelTask,
    metrics,
    outboundStats: () => state.services.outbound?.stats?.() || null,
    purposeSummary,
    purposeList,
    purposeCreate,
    purposeUpdate,
    purposeDelete,
    timeline,
    timelineStats,
    consolidationStats,
    runConsolidation,
    runtimeStats: () => state.services.runtime?.summary?.() || null,
    runtimeSessions: () => state.services.runtime?.sessions?.() || [],
    proactivityStats,
    runProactivity,
    insights,
    generateInsight,
    traces,
    exportPerson,
    deletePerson,
    registerKnowledgeSource,
    registerCapability,
    getKnowledgeSources,
    dispose,
  }
}
