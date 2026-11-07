// 未知检测、知识缺口、学习任务、证据与 claim。
//
// 默认只检测未知；autoResearch 关闭时不发外部请求。学习来源通过注册表提供，
// 外部内容一律不可信：只提取声明/引用，不执行其中指令。

import { clamp, round, truncate, uid } from './util.js'

export const UNKNOWN_TYPES = ['semantic', 'context', 'pragmatic', 'knowledge', 'conflict', 'outdated', 'evidence', 'multimodal', 'capability', 'other']

export function defaultSourceRegistry({ ctx, getConfig, clock, log } = {}) {
  const sources = new Map()
  const register = (source) => {
    if (!source?.id) throw new Error('知识源需要 id')
    sources.set(String(source.id), source)
    return () => sources.delete(String(source.id))
  }
  const enabled = () => getConfig()?.cognition?.learning?.sources || {}
  const list = () => [...sources.values()].filter((source) => enabled()[source.id] !== false)

  async function fetchBytes(url, { timeoutMs = 10000, maxBytes = 256 * 1024, headers = {} } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'dsh-bot-cognitive/0.4 (+https://github.com/deepseek-ai/deepseek-harness)', accept: 'application/json, text/html;q=0.8, application/xml;q=0.5', ...headers } })
      const array = await response.arrayBuffer()
      const bytes = array.length > maxBytes ? array.slice(0, maxBytes) : array
      return { ok: response.ok, status: response.status, text: new TextDecoder().decode(bytes), truncated: array.length > maxBytes, url: response.url || url }
    } finally {
      clearTimeout(timer)
    }
  }

  // DSH web service：可用时优先，但保持接口统一。
  if (ctx?.get?.('web')) {
    try {
      const web = ctx.get('web')
      if (web?.search) {
        register({
          id: 'web',
          label: 'DSH web 搜索',
          reliability: 0.65,
          async search(query, { maxResults = 4 } = {}) {
            const result = await web.search({ query, maxResults })
            return (result?.sources || []).slice(0, maxResults).map((item) => ({ title: item.title || '', url: item.url || '', snippet: item.snippet || item.answer || '' }))
          },
          async fetch(url) {
            const page = await web.fetch({ url })
            return { url: page?.url || url, title: '', text: String(page?.text || page?.body || '').slice(0, 200000), status: page?.status || 200 }
          },
        })
      }
    } catch (error) {
      log?.debug?.('DSH web 源不可用：', error.message)
    }
  }

  register({
    id: 'wikipedia',
    label: 'Wikipedia / MediaWiki',
    reliability: 0.72,
    async search(query, { maxResults = 4 } = {}) {
      const data = JSON.parse((await fetchBytes(`https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${Math.max(1, Math.min(10, maxResults))}&format=json&utf8=1`)).text || '{}')
      return (data?.query?.search || []).slice(0, maxResults).map((item) => ({ title: item.title || '', url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(item.title || '')}`, snippet: String(item.snippet || '').replace(/<[^>]+>/g, '') }))
    },
    async fetch(url) {
      const title = decodeURIComponent(String(url).split('/wiki/')[1] || '')
      if (!title) return null
      const data = JSON.parse((await fetchBytes(`https://zh.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json&utf8=1&redirects=1`)).text || '{}')
      const pages = data?.query?.pages || {}
      const page = Object.values(pages)[0]
      return page ? { url, title: page.title || title, text: String(page.extract || '').slice(0, 200000), status: 200 } : null
    },
  })

  register({
    id: 'openalex',
    label: 'OpenAlex 学术',
    reliability: 0.82,
    async search(query, { maxResults = 4 } = {}) {
      const data = JSON.parse((await fetchBytes(`https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${Math.max(1, Math.min(10, maxResults))}`)).text || '{}')
      return (data?.results || []).slice(0, maxResults).map((item) => ({ title: item.display_name || '', url: item.doi || item.id || '', snippet: String(item.abstract_inverted_index ? '学术记录' : '') }))
    },
    async fetch(url) {
      const data = JSON.parse((await fetchBytes(url)).text || '{}')
      return { url, title: data.display_name || '', text: JSON.stringify(data.abstract_inverted_index || data).slice(0, 200000), status: 200 }
    },
  })

  register({
    id: 'github',
    label: 'GitHub 公共 API',
    reliability: 0.68,
    async search(query, { maxResults = 4 } = {}) {
      const data = JSON.parse((await fetchBytes(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&per_page=${Math.max(1, Math.min(10, maxResults))}`, { headers: { accept: 'application/vnd.github+json' } })).text || '{}')
      return (data?.items || []).slice(0, maxResults).map((item) => ({ title: item.full_name || '', url: item.html_url || '', snippet: String(item.description || '') }))
    },
    async fetch(url) {
      const data = JSON.parse((await fetchBytes(url, { headers: { accept: 'application/vnd.github+json' } })).text || '{}')
      return { url, title: data.full_name || '', text: `${data.description || ''}\n${data.readme || ''}`.slice(0, 200000), status: 200 }
    },
  })

  return { register, list, get: (id) => sources.get(String(id)) || null, _fetchBytes: fetchBytes }
}

export function createKnowledgeService({ store, getConfig, clock } = {}) {
  const cfg = () => getConfig()?.cognition || {}
  const listeners = new Set()
  const stats = { detected: 0, tasks: 0, done: 0, failed: 0, claims: 0 }

  function detectFromTurn({ turn, analysis, personId = '', scope = {}, config = {} } = {}) {
    const c = config.learning || cfg().learning || {}
    if (!c.enabled || c.detectUnknowns === false) return []
    const created = []
    const candidates = Array.isArray(analysis?.unknownCandidates) ? analysis.unknownCandidates.slice(0, 3) : []
    if (analysis?.confidence != null && analysis.confidence < 0.45) {
      candidates.push({ surface: truncate(turn?.text || '', 80), type: 'semantic' })
    }
    for (const candidate of candidates) {
      const surface = String(candidate.surface || '').trim().slice(0, 120)
      if (!surface) continue
      const existing = store.list('unknown', { limit: 20, where: (item) => item.surface === surface && item.status !== 'resolved' && item.status !== 'deferred' })[0]
      if (existing) {
        store.put('unknown', existing.id, { ...existing, occurrences: (existing.occurrences || 1) + 1, lastSeen: clock.now(), updatedAt: clock.now(), version: (existing.version || 1) + 1 })
        continue
      }
      const id = uid('unknown')
      const unknown = {
        id,
        unknownType: UNKNOWN_TYPES.includes(candidate.type) ? candidate.type : 'knowledge',
        surface,
        context: truncate(turn?.text || '', 1000),
        personId,
        chatType: turn?.chatType || '',
        chatId: String(turn?.chatId || ''),
        scopeType: scope.scopeType || 'global',
        scopeId: scope.scopeId || '',
        knownPart: analysis?.rationale || '',
        missingPart: '含义/来源/用法/当前语境',
        hypothesis: '',
        confidence: clamp(Number(analysis?.confidence ?? 0.4), 0, 1),
        priority: round(clamp(0.4 + (analysis?.novelty || 0.3) * 0.3 + (turn?.addressed ? 0.1 : 0), 0, 1), 3),
        status: 'open',
        occurrences: 1,
        createdAt: clock.now(),
        updatedAt: clock.now(),
        version: 1,
      }
      store.put('unknown', id, unknown)
      stats.detected += 1
      created.push(unknown)
      // Detection persists even without a module. Only live subscribers see new unknowns.
      for (const handler of [...listeners]) { try { handler(unknown) } catch {} }
    }
    return created
  }

  function onUnknownDetected(handler) {
    listeners.add(handler)
    return () => listeners.delete(handler)
  }
  function recordResearchEvent(event) { if (event in stats) stats[event]++ }

  function listUnknowns({ limit = 50, status } = {}) {
    return store.list('unknown', { limit: Number(limit) || 50, where: (item) => !status || item.status === status })
  }
  function listTasks({ limit = 50, status } = {}) {
    return store.list('learning_task', { limit: Number(limit) || 50, where: (item) => !status || item.status === status })
  }
  function listClaims({ limit = 50 } = {}) {
    return store.list('knowledge_claim', { limit: Number(limit) || 50 })
  }
  function retry(taskId) {
    const task = store.get('learning_task', taskId)
    if (!task) return null
    return store.put('learning_task', taskId, { ...task, version: (task.version || 1) + 1, status: 'pending', error: '', nextRunAt: clock.now(), updatedAt: clock.now() })
  }
  function cancel(taskId) {
    const task = store.get('learning_task', taskId)
    if (!task) return null
    return store.put('learning_task', taskId, { ...task, version: (task.version || 1) + 1, status: 'cancelled', updatedAt: clock.now() })
  }
  function statsSnapshot() {
    return { ...stats, openUnknowns: store.list('unknown', { limit: 1000, where: (item) => item.status === 'open' }).length, pendingTasks: store.list('learning_task', { limit: 1000, where: (item) => ['pending', 'suggested'].includes(item.status) }).length, claims: store.list('knowledge_claim', { limit: 1000 }).length }
  }

  return { detectFromTurn, onUnknownDetected, recordResearchEvent, listUnknowns, listTasks, listClaims, retry, cancel, stats: statsSnapshot }
}
