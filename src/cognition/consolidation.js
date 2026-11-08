// 记忆整理/反思：按作用域把情景记忆巩固为语义记忆，并可选地用 LLM 生成阶段小结。
//
// 边界：
//   - 私聊作用域只在自己 scope 内总结，不跨私聊、不写 global，避免隐私泄漏；
//   - LLM 只做「压缩已有记忆」，不新增未提供的事实；失败/预算不足直接跳过；
//   - 默认每日 04:00 跑一次，也可面板手动触发；同一作用域有最低条数门槛。

const DAY_MS = 24 * 60 * 60 * 1000

function cfgOf(getConfig) {
  try { return getConfig()?.cognition?.consolidation || {} } catch (error) { return {} }
}

function scopeKey(scope) {
  return `${scope.scopeType || 'global'}:${scope.scopeId || ''}`
}

function summaryText(item) {
  return String(item?.summary || item?.content || '').trim()
}

export function createConsolidationService({ memory, llm = null, getConfig, clock, scheduler = null, logger = null, settings = null } = {}) {
  const log = logger?.child?.('consolidation') || logger || { debug() {}, warn() {} }
  const state = {
    runs: 0,
    lastRunAt: 0,
    lastConsolidated: 0,
    lastReflected: 0,
    lastError: '',
    timer: null,
    started: false,
  }
  const cfg = () => cfgOf(getConfig)

  function enabled() { return cfg().enabled !== false }
  function reflectEnabled() { return cfg().reflect !== false }

  async function reflectScope(group) {
    if (!llm || typeof llm.completeJson !== 'function') return null
    const recent = memory.list({
      type: 'episodic',
      status: 'active',
      limit: 20,
      scopeType: group.scope.scopeType,
      scopeId: group.scope.scopeId,
      personId: group.personId || '',
    }).slice(0, 12)
    if (recent.length < Math.max(3, Number(cfg().reflectMinEpisodes || 10))) return null
    const existing = memory.list({
      type: 'semantic',
      status: 'active',
      limit: 5,
      scopeType: group.scope.scopeType,
      scopeId: group.scope.scopeId,
      personId: group.personId || '',
    }).find((item) => item.source === 'reflection')
    const prompt = {
      system: [
        '你是记忆整理器。只根据给定记忆压缩出一段阶段小结，不补充未出现的事实。',
        '只输出 JSON：{"summary": "200 字以内", "themes": ["主题"]}。',
        '不要提及系统/模型/AI；不要泄露其他作用域的内容。',
      ].join('\n'),
      user: JSON.stringify({
        scope: group.scope,
        recent: recent.map((item) => summaryText(item).slice(0, 280)),
        previous: existing ? summaryText(existing).slice(0, 500) : '',
      }),
    }
    try {
      const result = await llm.completeJson({ purpose: 'reflection' }, prompt)
      if (!result?.ok || !result.json) return null
      const summary = String(result.json.summary || '').trim().slice(0, 900)
      if (!summary) return null
      if (existing && summaryText(existing) === summary) return existing
      const record = memory.remember(summary, {
        scope: group.scope,
        personId: group.personId || '',
        source: 'reflection',
        type: 'semantic',
        importance: 0.65,
      })
      return record
    } catch (error) {
      log.debug?.('反思失败：', error.message)
      return null
    }
  }

  function runOnce(options) {
    return settings ? settings.withRuntime(() => runCaptured(options), { fresh: true }) : runCaptured(options)
  }

  async function runCaptured({ force = false, reflect = null } = {}) {
    if (!enabled() && !force) return { ok: false, skipped: true, reason: 'disabled' }
    if (!memory || typeof memory.consolidateAll !== 'function') return { ok: false, error: 'MEMORY_UNAVAILABLE' }
    state.runs += 1
    state.lastRunAt = clock.now()
    try {
      const consolidated = memory.consolidateAll({ force })
      state.lastConsolidated = consolidated.length
      const shouldReflect = reflect === null ? reflectEnabled() : Boolean(reflect)
      let reflected = 0
      if (shouldReflect && llm) {
        const episodes = memory.list({ type: 'episodic', status: 'active', limit: 200 })
        const groups = new Map()
        for (const item of episodes) {
          const key = `${scopeKey({ scopeType: item.scopeType, scopeId: item.scopeId })}:${item.personId || ''}`
          const group = groups.get(key) || { scope: { scopeType: item.scopeType || 'global', scopeId: item.scopeId || '' }, personId: item.personId || '', count: 0 }
          group.count += 1
          groups.set(key, group)
        }
        const candidates = [...groups.values()]
          .filter((group) => group.count >= Math.max(3, Number(cfg().reflectMinEpisodes || 10)))
          .sort((a, b) => b.count - a.count)
          .slice(0, 2)
        for (const group of candidates) {
          const record = await reflectScope(group)
          if (record) reflected += 1
        }
      }
      state.lastReflected = reflected
      state.lastError = ''
      log.debug?.(`整理完成：巩固 ${consolidated.length}，反思 ${reflected}`)
      return { ok: true, consolidated: consolidated.length, reflected, at: state.lastRunAt }
    } catch (error) {
      state.lastError = String(error?.message || error)
      log.warn?.('记忆整理失败：', state.lastError)
      return { ok: false, error: state.lastError }
    }
  }

  function scheduleNext() {
    if (!scheduler || typeof scheduler.setTimeout !== 'function' || !enabled()) return
    if (state.timer) {
      try { scheduler.clearTimeout?.(state.timer) } catch (error) {}
      state.timer = null
    }
    const hour = Math.max(0, Math.min(23, Number(cfg().hour ?? 4)))
    const now = clock.now()
    const next = new Date(now)
    next.setHours(hour, 0, 0, 0)
    if (next.getTime() <= now) next.setDate(next.getDate() + 1)
    const delay = Math.max(1000, next.getTime() - now)
    state.timer = scheduler.setTimeout(() => {
      state.timer = null
      runOnce().catch((error) => log.warn?.('定时整理失败：', error.message)).finally(() => scheduleNext())
    }, delay)
    state.timer?.unref?.()
  }

  function start() {
    if (state.started) return
    state.started = true
    scheduleNext()
  }

  function status() {
    return {
      enabled: enabled(),
      reflect: reflectEnabled(),
      hour: Number(cfg().hour ?? 4),
      runs: state.runs,
      lastRunAt: state.lastRunAt,
      lastConsolidated: state.lastConsolidated,
      lastReflected: state.lastReflected,
      lastError: state.lastError,
      scheduled: Boolean(state.timer),
    }
  }

  function dispose() {
    if (state.timer) {
      try { scheduler?.clearTimeout?.(state.timer) } catch (error) {}
      state.timer = null
    }
    state.started = false
  }

  start()

  return { runOnce, status, dispose, scheduleNext }
}
