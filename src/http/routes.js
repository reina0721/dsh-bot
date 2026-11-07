// 宿主半边 REST 接口：/onebot-qq/api/*，面板只通过这些接口读写状态与配置。
// 路由全部注册在 apply 内，随插件卸载一起清理（ctx.effect）。

import { createModuleUiHandler, MODULE_UI_PREFIX } from '../modules/sandbox.js'
import { redact } from '../core/redact.js'
import { publicConfig, defaultConfig, CONFIG_GROUPS } from '../core/config.js'
import { readFile } from 'node:fs/promises'

export const API_PREFIX = '/onebot-qq/api'
export const API_VERSION = 1

const MAX_BODY_BYTES = 1024 * 1024

/** 统一 JSON 响应。 */
export function send(res, status, body) {
  const text = JSON.stringify(body)
  try {
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  } catch (error) {}
}

async function readBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > maxBytes) throw new Error('请求体过大')
      chunks.push(buffer)
    }
  } catch (error) {
    throw new Error(`读取请求体失败：${error.message}`)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error('请求体不是合法 JSON')
  }
}

// Opaque UI frames must never use the host REST API, including after self-navigation.
function rejectSandboxApi(req, res) {
  const origin = req.headers?.origin
  const destination = req.headers?.['sec-fetch-dest']
  const coreImage = destination === 'image' && req.headers?.['sec-fetch-site'] === 'same-origin'
  if (origin !== 'null' && (!destination || ['empty', 'document'].includes(destination) || coreImage)) return false
  send(res, 403, { ok: false, message: '不允许隔离页面访问宿主 API' })
  return true
}

function queryOf(req) {
  try {
    return Object.fromEntries(new URL(req.url, 'http://dsh.local').searchParams)
  } catch (error) {
    return {}
  }
}

function toInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

/**
 * @param {object} o
 * @param {import('@deepseek-ai/cordis').Context} o.ctx
 * @param {() => object} o.getConfig
 * @param {(next: object) => { config: object, issues: string[] }} o.setConfig
 * @param {() => { config: object, issues: string[] }} o.resetConfig
 * @param {object} o.gateway gateway manager（见 src/gateway/manager.js）
 * @param {object} o.events 事件缓冲
 * @param {object} o.logger 日志器
 * @param {() => string} [o.brandName] 当前面板名称
 * @param {string} o.version
 * @param {string} o.dataDir
 */
export function createRoutes({ ctx, getConfig, setConfig, resetConfig, gateway, events, logger, cognition, models, media = null, stickers = null, providerRegistry = null, access = null, modules = null, backup = null, upgrade = null, brandName, version, dataDir }) {
  const registered = []

  const answer = async (res, work, { allowRaw = false } = {}) => {
    try {
      const result = await work()
      if (result === undefined) return
      if (allowRaw && result && result.__raw === true) {
        res.statusCode = result.status || 200
        res.setHeader('content-type', result.type || 'application/octet-stream')
        res.setHeader('cache-control', 'no-store')
        res.end(result.body)
        return
      }
      send(res, 200, result)
    } catch (error) {
      send(res, 200, { ok: false, message: redact(String(error?.message || error)) })
    }
  }

  const route = (method, path, handler) => {
    const register = () => ctx.webServer.register({
      kind: 'exact',
      path: API_PREFIX + path,
      handler: (req, res) => {
        if (rejectSandboxApi(req, res)) return
        if (method && String(req.method || '').toUpperCase() !== method) {
          send(res, 405, { ok: false, message: `只支持 ${method}` })
          return
        }
        answer(res, () => handler(req, res))
      },
    })
    try {
      registered.push(ctx.effect(register, `onebot-qq: 路由 ${method} ${path}`))
    } catch (error) {
      // ctx.effect 不可用（测试替身）时直接注册；dispose 由调用方处理
      register()
    }
  }

  const routeRaw = (method, path, handler) => {
    const register = () => ctx.webServer.register({
      kind: 'exact', path: API_PREFIX + path,
      handler: (req, res) => {
        if (rejectSandboxApi(req, res)) return
        if (method && String(req.method || '').toUpperCase() !== method) return send(res, 405, { ok: false, message: `只支持 ${method}` })
        answer(res, () => handler(req, res), { allowRaw: true })
      },
    })
    try { registered.push(ctx.effect(register, `onebot-qq: 路由 ${method} ${path}`)) } catch (error) { register() }
  }

  const statusPayload = () => {
    const cfg = getConfig()
    return {
      ok: true,
      apiVersion: API_VERSION,
      brand: brandName?.() || 'dsh-bot',
      version,
      dataDir,
      config: publicConfig(cfg),
      gateway: gateway.snapshot(),
      events: events.stats(),
      logs: logger.stats(),
      access: access?.summary?.() || { mode: 'open', configured: false },
      upgrade: upgrade?.status() || null,
      runtime: cognition?.runtimeStats?.() || null,
      purpose: cognition?.purposeSummary?.() || null,
      consolidation: cognition?.consolidationStats?.() || null,
      recentEvents: events.recent(20),
    }
  }

  // ---- 状态与配置 ----
  route('GET', '/status', async () => statusPayload())

  const mediaFeatures = () => {
    const provider = providerRegistry?.get('mediaFeatures')
    if (!provider) throw new Error('媒体功能模块未启用')
    return provider
  }
  const authorizeStickerLibrary = () => {
    if (mediaFeatures().authorizeStickerLibrary() !== true) throw new Error('表情包功能未启用。')
  }
  {
    route('GET', '/content/bilibili', async (req) => {
      const keyword = String(queryOf(req).q || '').trim()
      if (!keyword) throw new Error('缺少 q')
      return mediaFeatures().bilibili.search(keyword)
    })
    route('GET', '/content/bilibili/hot', async () => mediaFeatures().bilibili.hot())
    route('GET', '/content/bilibili/comments', async (req) => {
      const query = queryOf(req)
      return mediaFeatures().bilibili.comments(query.bvid, { limit: query.limit ?? 10 })
    })
    route('GET', '/content/bilibili/share', async (req) => ({ ok: true, ...await mediaFeatures().bilibili.share(queryOf(req).bvid) }))
  }

  if (upgrade) {
    route('GET', '/upgrade', async () => ({ ok: true, ...upgrade.status() }))
    route('POST', '/upgrade/check', async (req) => {
      const body = await readBody(req)
      return upgrade.check({ force: body?.force ?? false })
    })
  }

  if (backup) {
    route('GET', '/backup', async () => ({ ok: true, status: await backup.status(), items: await backup.list() }))
    route('POST', '/backup/create', async (req) => {
      const body = await readBody(req)
      return { ok: true, item: await backup.create({ includeMedia: body?.includeMedia ?? false, note: body?.note ?? '' }) }
    })
    route('POST', '/backup/restore', async (req) => {
      const body = await readBody(req)
      return backup.restore(body?.id, { apply: body?.apply ?? false })
    })
    route('POST', '/backup/delete', async (req) => {
      const body = await readBody(req)
      return backup.delete(body?.id)
    })
  }

  if (modules) {
    const configAnswer = async (work) => {
      try {
        const { id, schema, values, revision } = await work()
        return { ok: true, id, schema, values, revision }
      } catch (error) {
        const known = ['MODULE_CONFIG_INVALID', 'MODULE_CONFIG_UNAVAILABLE', 'MODULE_CONFIG_CONFLICT', 'MODULE_CONFIG_WRITE_FAILED'].includes(error.code)
        return { ok: false, code: known ? error.code : 'MODULE_CONFIG_INVALID', message: known ? error.message : '模块配置请求无效' }
      }
    }
    // DSH exact 路由按 path 去重；同一路径的两种 method 必须只注册一次。
    route(null, '/modules/config', (req, res) => {
      const method = String(req.method || '').toUpperCase()
      if (method === 'GET') return configAnswer(() => modules.getModuleConfig(queryOf(req).id))
      if (method === 'POST') return configAnswer(async () => {
        const body = await readBody(req)
        return modules.setModuleConfig(body?.id, body?.values, body?.revision)
      })
      send(res, 405, { ok: false, code: 'MODULE_CONFIG_INVALID', message: '只支持 GET 或 POST' })
    })
    const registerUiAssets = () => ctx.webServer.register({ kind: 'prefix', path: MODULE_UI_PREFIX, handler: createModuleUiHandler(modules) })
    registered.push(ctx.effect(registerUiAssets, 'onebot-qq: 隔离模块 UI 资源'))
    route('GET', '/modules/ui', async () => ({ ok: true, ...await modules.refreshUiCatalog() }))
    route('POST', '/modules/ui/grant', async (req) => {
      try {
        const body = await readBody(req, 1024)
        return { ok: true, item: await modules.setUiGrant(body?.id, body?.enabled) }
      } catch (error) {
        return { ok: false, code: error.code === 'MODULE_UI_WRITE_FAILED' ? error.code : 'MODULE_UI_UNAVAILABLE', message: error.code === 'MODULE_UI_WRITE_FAILED' ? '隔离 UI 授权保存失败' : '隔离 UI 授权不可用，请检查外部模块声明与资源' }
      }
    })
    route('GET', '/modules', async () => {
      const items = modules.list()
      return { ok: true, items, summary: { builtin: items.filter((item) => item.builtin).length, external: items.filter((item) => !item.builtin).length } }
    })
    route('POST', '/modules/reload', async (req) => {
      const body = await readBody(req)
      if (!body?.id) throw new Error('缺少 id')
      try { return { ok: true, item: await modules.reload(String(body.id)) } }
      catch (error) { if (error.code?.startsWith('MODULE_')) return { ok: false, code: error.code, message: error.message }; throw error }
    })
    route('POST', '/modules/toggle', async (req) => {
      const body = await readBody(req)
      if (!body?.id || typeof body.enabled !== 'boolean') throw new Error('需要 id 与 enabled(boolean)')
      try { return { ok: true, item: await modules.setEnabled(String(body.id), body.enabled) } }
      catch (error) { if (error.code?.startsWith('MODULE_')) return { ok: false, code: error.code, message: error.message }; throw error }
    })
  }

  if (media) {
    route('GET', '/media/status', async () => {
      const stickerStatus = stickers ? await stickers.status() : null
      let featureStatus = { active: false }
      let libraryAvailable = false, sendAvailable = false
      let libraryReason = 'MODULE_DISABLED', sendReason = 'MODULE_DISABLED'
      try {
        const provider = providerRegistry?.get('mediaFeatures')
        featureStatus = provider?.status() || featureStatus
        libraryAvailable = provider?.authorizeStickerLibrary() === true
        sendAvailable = provider?.authorizeStickerSend() === true
        libraryReason = libraryAvailable ? null : featureStatus.libraryReason || (provider ? 'LIBRARY_UNAVAILABLE' : 'MODULE_DISABLED')
        sendReason = sendAvailable ? null : featureStatus.sendReason || libraryReason || 'DELIVERY_UNAVAILABLE'
      } catch {
        // Status stays readable and fails closed during provider teardown.
        featureStatus = { active: false }
        libraryAvailable = sendAvailable = false
        libraryReason = sendReason = 'MODULE_DISABLED'
      }
      return { ok: true, ...media.status(), mediaFeatures: featureStatus, stickers: { ...stickerStatus, available: libraryAvailable, libraryAvailable, sendAvailable, libraryReason, sendReason } }
    })
    route('GET', '/media/files', async () => ({ ok: true, ...await media.listFiles() }))
    route('GET', '/media/file/download', async (req) => ({ ok: true, ...await media.readFile(queryOf(req).name) }))
    route('POST', '/media/file/delete', async (req) => {
      const body = await readBody(req)
      return { ok: true, ...await media.removeFile(body?.name) }
    })
    route('POST', '/media/file/upload', async (req) => {
      const body = await readBody(req, 15 * 1024 * 1024)
      return media.saveFile({ name: body?.name, dataBase64: body?.dataBase64 })
    })
    route('POST', '/media/test', async (req) => {
      const body = await readBody(req)
      const kind = String(body?.kind || '')
      if (!['tts', 'asr', 'vision'].includes(kind)) throw new Error('kind 必须是 tts、asr 或 vision')
      return { ok: true, ...(await media.test(kind)) }
    })
    route('POST', '/media/image/generate', async (req) => {
      const body = await readBody(req)
      return media.generateImage(body?.prompt, { size: body?.size })
    })
    route('POST', '/media/image/edit', async (req) => {
      const body = await readBody(req)
      return media.editImage(body?.prompt, body?.path, { size: body?.size })
    })
    route('POST', '/media/tts', async (req) => {
      const body = await readBody(req)
      const text = String(body?.text || '').trim()
      if (!text) throw new Error('缺少 text')
      return { ok: true, file: await media.synthesize(text) }
    })
  }


  if (stickers) {
    route('GET', '/media/stickers', async (req) => {
      authorizeStickerLibrary()
      const query = queryOf(req)
      const items = await stickers.list({ query: query.query || '', tag: query.tag || '', limit: toInt(query.limit, 100, 1, 500) })
      authorizeStickerLibrary()
      return { ok: true, items }
    })
    route('POST', '/media/stickers/upload', async (req) => {
      authorizeStickerLibrary()
      const maxBytes = Math.max(1024, Number(getConfig()?.media?.stickers?.maxBytes) || 5 * 1024 * 1024)
      const body = await readBody(req, Math.ceil(maxBytes * 4 / 3) + 16384)
      const data = String(body?.data || '').trim()
      if (!body?.name || !body?.mime || !data) throw new Error('缺少 name、mime 或 data')
      if (data.length > Math.ceil(maxBytes * 4 / 3) + 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) throw new Error('data 不是合法 base64 或超过大小限制')
      authorizeStickerLibrary()
      const buffer = Buffer.from(data, 'base64')
      if (buffer.length > maxBytes) throw new Error(`图片超过大小限制 ${maxBytes} bytes`)
      const item = await stickers.importBuffer(buffer, { name: body.name, mime: body.mime, tags: body.tags })
      authorizeStickerLibrary()
      return { ok: true, item }
    })
    route('POST', '/media/stickers/tag', async (req) => {
      authorizeStickerLibrary()
      const body = await readBody(req)
      if (!body?.id) throw new Error('缺少 id')
      authorizeStickerLibrary()
      const item = await stickers.updateTags(body.id, body.tags)
      authorizeStickerLibrary()
      if (!item) throw new Error('表情包不存在')
      return { ok: true, item }
    })
    route('POST', '/media/stickers/delete', async (req) => {
      authorizeStickerLibrary()
      const body = await readBody(req)
      if (!body?.id) throw new Error('缺少 id')
      authorizeStickerLibrary()
      const removed = await stickers.remove(body.id)
      authorizeStickerLibrary()
      return { ok: true, removed }
    })
    routeRaw('GET', '/media/stickers/file', async (req) => {
      authorizeStickerLibrary()
      const id = queryOf(req).id
      if (!id) throw new Error('缺少 id')
      const file = await stickers.fileFor(id)
      if (!file) throw new Error('表情包不存在')
      authorizeStickerLibrary()
      const body = await readFile(file.path)
      authorizeStickerLibrary()
      return { __raw: true, type: file.mime, body }
    })
  }

  // ---- 访问控制：面板/诊断只读接口 ----
  if (access) {
    route('GET', '/access/stats', async () => ({ ok: true, ...(access.summary?.() || {}) }))
    route('GET', '/runtime/stats', async () => ({ ok: true, ...(cognition.runtimeStats?.() || {}) }))
    route('GET', '/runtime/sessions', async () => ({ ok: true, items: cognition.runtimeSessions?.() || [] }))
    route('POST', '/access/check', async (req) => {
      const body = await readBody(req)
      const chatType = body?.chatType === 'group' ? 'group' : body?.chatType === 'private' ? 'private' : ''
      const chatId = String(body?.chatId ?? '').trim()
      if (!chatType || !chatId) throw new Error('chatType 必须是 private 或 group，且需要 chatId')
      const senderId = String(body?.senderId ?? '').trim()
      return { ok: true, ...access.check({ chatType, chatId, senderId }) }
    })
  }

  // ---- 模型协议：provider 注册表、测试、发现、选择 ----
  if (models) {
    route('GET', '/models', async () => ({ ok: true, ...models.list(), version }))
    route('GET', '/models/status', async () => ({ ok: true, ...models.list(), version }))
    route('POST', '/models/provider', async (req) => {
      const body = await readBody(req)
      if (!body?.provider || typeof body.provider !== 'object') throw new Error('缺少 provider')
      return { ok: true, provider: models.saveProvider(body.provider) }
    })
    route('POST', '/models/provider/delete', async (req) => {
      const body = await readBody(req)
      if (!body?.providerId) throw new Error('缺少 providerId')
      return { ok: true, ...models.removeProvider(String(body.providerId)) }
    })
    route('POST', '/models/provider/test', async (req) => {
      const body = await readBody(req)
      return { ok: true, result: await models.test({ provider: body?.providerId || undefined, model: body?.model || undefined }) }
    })
    route('POST', '/models/provider/discover', async (req) => {
      const body = await readBody(req)
      if (!body?.providerId) throw new Error('缺少 providerId')
      return { ok: true, result: await models.discover(String(body.providerId)) }
    })
    route('POST', '/models/provider/models', async (req) => {
      const body = await readBody(req)
      if (!body?.providerId) throw new Error('缺少 providerId')
      return { ok: true, ...models.applyModels(String(body.providerId), body.models || []) }
    })
    route('POST', '/models/select', async (req) => {
      const body = await readBody(req)
      if (!body?.provider || !body?.model) throw new Error('缺少 provider/model')
      return { ok: true, selected: models.select(String(body.provider), String(body.model)) }
    })
    route('POST', '/models/fallback', async (req) => {
      const body = await readBody(req)
      return { ok: true, fallback: models.setFallback(body?.fallback || []) }
    })
  }

  // ---- 认知（M1：概览/暂停；后续里程碑扩展 persons/memories/policy/...）----
  if (cognition) {
    route('GET', '/cognition/overview', async () => ({ ok: true, version, ...(await cognition.overview()) }))
    route('POST', '/cognition/pause', async (req) => {
      const body = await readBody(req)
      const paused = body?.paused !== false
      if (paused) cognition.pause(String(body?.reason || ''))
      else cognition.resume()
      return { ok: true, ...cognition.snapshot() }
    })
    route('GET', '/cognition/persons', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.persons({ query: q.query || '', limit: toInt(q.limit, 50, 1, 200) }) }
    })
    route('GET', '/cognition/person', async (req) => {
      const q = queryOf(req)
      if (!q.personId) throw new Error('缺少 personId')
      return { ok: true, ...cognition.personDetail(q.personId) }
    })
    route('POST', '/cognition/person/correct-facet', async (req) => {
      const body = await readBody(req)
      if (!body?.personId || !body?.facetId) throw new Error('缺少 personId/facetId')
      return { ok: true, facet: cognition.correctFacet(body.personId, body.facetId, body.patch || {}) }
    })
    route('POST', '/cognition/person/delete-facet', async (req) => {
      const body = await readBody(req)
      if (!body?.personId || !body?.facetId) throw new Error('缺少 personId/facetId')
      return { ok: true, facet: cognition.deleteFacet(body.personId, body.facetId) }
    })
    route('GET', '/cognition/relationships', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.relationshipsList({ scopeType: q.scopeType || undefined, scopeId: q.scopeId || undefined }), history: q.personId ? cognition.relationshipHistory(q.personId, { limit: toInt(q.limit, 30, 1, 200) }) : [] }
    })
    route('POST', '/cognition/relationship/adjust', async (req) => {
      const body = await readBody(req)
      if (!body?.personId) throw new Error('缺少 personId')
      return { ok: true, relationship: cognition.adjustRelationship(body.personId, body.patch || {}) }
    })
    route('GET', '/cognition/memories', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.memories({ query: q.query || '', type: q.type || '', personId: q.personId || '', scopeType: q.scopeType || undefined, scopeId: q.scopeId || undefined, status: q.status || 'active', limit: toInt(q.limit, 50, 1, 200) }) }
    })
    route('GET', '/cognition/memory', async (req) => {
      const q = queryOf(req)
      if (!q.id) throw new Error('缺少 id')
      return { ok: true, ...cognition.memoryDetail(q.id) }
    })
    route('POST', '/cognition/import', async (req) => {
      const body = await readBody(req, 6 * 1024 * 1024)
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('导入请求体必须是对象')
      return cognition.importArchive({
        format: body.format,
        kind: body.kind,
        content: body.content,
        scope: { scopeType: body.scopeType === undefined ? 'global' : body.scopeType, scopeId: body.scopeId === undefined ? '' : body.scopeId },
      })
    })
    route('POST', '/cognition/memory/action', async (req) => {
      const body = await readBody(req)
      if (!body?.id || !body?.action) throw new Error('缺少 id/action')
      return { ok: true, result: cognition.memoryAction(body.id, body.action) }
    })
    route('GET', '/cognition/timeline', async (req) => {
      const query = queryOf(req)
      return {
        ok: true,
        items: cognition.timeline({
          limit: toInt(query.limit, 100, 1, 200),
          before: Number(query.before) || 0,
          scopeType: query.scopeType || '',
          scopeId: query.scopeId || '',
          types: query.types ? String(query.types).split(',') : [],
        }),
        stats: cognition.timelineStats(),
      }
    })
    route('GET', '/cognition/consolidation', async () => ({ ok: true, ...(cognition.consolidationStats() || {}) }))
    route('POST', '/cognition/consolidation/run', async (req) => {
      const body = await readBody(req)
      return { ok: true, ...(await cognition.runConsolidation({ force: body?.force === true, reflect: body?.reflect })) }
    })
    route('GET', '/cognition/purpose', async (req) => {
      const query = queryOf(req)
      const status = query.status === undefined ? 'active' : String(query.status || '')
      return {
        ok: true,
        items: cognition.purposeList({ status, type: query.type || '', limit: toInt(query.limit, 50, 1, 200) }),
        stats: cognition.purposeSummary(),
      }
    })
    route('POST', '/cognition/purpose/create', async (req) => {
      const body = await readBody(req)
      return { ok: true, purpose: cognition.purposeCreate(body || {}) }
    })
    route('POST', '/cognition/purpose/update', async (req) => {
      const body = await readBody(req)
      const { id, ...patch } = body || {}
      if (!id) throw new Error('缺少 id')
      return { ok: true, purpose: cognition.purposeUpdate(String(id), patch) }
    })
    route('POST', '/cognition/purpose/delete', async (req) => {
      const body = await readBody(req)
      if (!body?.id) throw new Error('缺少 id')
      return { ok: true, deleted: cognition.purposeDelete(String(body.id)) }
    })
    route('GET', '/cognition/emotion', async () => ({ ok: true, ...cognition.emotionState() }))
    route('POST', '/cognition/emotion/adjust', async (req) => {
      const body = await readBody(req)
      return { ok: true, emotion: cognition.adjustEmotion(body || {}) }
    })
    route('POST', '/cognition/emotion/reset', async () => ({ ok: true, emotion: cognition.resetEmotion() }))
    route('GET', '/cognition/persona', async () => ({
      ok: true,
      persona: cognition.personaState(),
      activeId: cognition.activePersonaId(),
      personas: cognition.personaList(),
    }))
    route('POST', '/cognition/persona/create', async (req) => {
      const body = await readBody(req)
      return cognition.createPersona(body || {})
    })
    route('POST', '/cognition/persona/import', async (req) => {
      const body = await readBody(req)
      return cognition.importPersona(body || {})
    })
    route('GET', '/cognition/llm/usage', async () => ({ ok: true, ...cognition.llmUsage() }))
    route('POST', '/cognition/llm/usage/reset', async (req) => {
      const body = await readBody(req)
      if (body?.confirm !== true) throw new Error('重置今日 LLM 用量需要 confirm: true')
      if (!['global', 'persona', 'both'].includes(body.scope)) throw new Error('LLM 用量重置 scope 必须为 global、persona 或 both')
      return { ok: true, ...cognition.resetLlmUsage(body.scope) }
    })
    route('POST', '/cognition/llm/test', async (req) => {
      const body = await readBody(req)
      return cognition.testLlm(body || {})
    })
    route('GET', '/cognition/persona/data', async (req) => {
      const q = queryOf(req)
      if (q.personaId === 'all') return { ok: true, items: cognition.personaDataAll() }
      return { ok: true, summary: cognition.personaDataSummary(q.personaId || '') }
    })
    route('POST', '/cognition/persona/data/copy', async (req) => {
      const body = await readBody(req)
      return cognition.copyPersonaData(body?.from || '', body?.to || '', body?.groups)
    })
    route('POST', '/cognition/persona/switch', async (req) => {
      const body = await readBody(req)
      return cognition.switchPersona(body?.personaId || body?.id || '')
    })
    route('POST', '/cognition/persona/delete', async (req) => {
      const body = await readBody(req)
      return cognition.deletePersona(body?.personaId || body?.id || '')
    })
    route('POST', '/cognition/persona/edit', async (req) => {
      const body = await readBody(req)
      return { ok: true, result: cognition.editPersona(body || {}, body?.personaId || '') }
    })
    route('POST', '/cognition/persona/reset', async (req) => {
      const body = await readBody(req)
      return {
        ok: true,
        persona: cognition.resetPersona(body?.personaId || ''),
        activeId: cognition.activePersonaId(),
        personas: cognition.personaList(),
      }
    })
    route('GET', '/cognition/decisions', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.decisions({ limit: toInt(q.limit, 50, 1, 200) }), stats: cognition.policyStats() }
    })
    route('POST', '/cognition/decision/correct', async (req) => {
      const body = await readBody(req)
      if (!body?.decisionId) throw new Error('缺少 decisionId')
      return { ok: true, outcome: cognition.correctDecision(body.decisionId, body.observation || {}) }
    })
    route('GET', '/cognition/policy/stats', async () => ({ ok: true, stats: cognition.policyStats() }))
    route('POST', '/cognition/policy/reset', async () => ({ ok: true, ...cognition.resetPolicy() }))
    route('GET', '/cognition/skills', async () => ({ ok: true, items: cognition.skillsList() }))
    route('GET', '/cognition/beliefs', async () => ({ ok: true, items: cognition.beliefsList() }))
    route('POST', '/cognition/belief/correct', async (req) => {
      const body = await readBody(req)
      if (!body?.id) throw new Error('缺少 id')
      return { ok: true, belief: cognition.correctBelief(String(body.id), body.patch || {}) }
    })
    route('GET', '/cognition/proactivity', async () => ({ ok: true, stats: cognition.proactivityStats() }))
    route('POST', '/cognition/proactivity/run', async () => ({ ok: true, result: await cognition.runProactivity() }))
    route('POST', '/cognition/skill/use', async (req) => {
      const body = await readBody(req)
      return { ok: true, skill: cognition.skillUse(String(body?.name || ''), body?.success === true ? true : body?.success === false ? false : null) }
    })
    route('GET', '/cognition/unknowns', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.unknowns({ limit: toInt(q.limit, 50, 1, 200), status: q.status || undefined }) }
    })
    route('GET', '/cognition/learning/tasks', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.learningTasks({ limit: toInt(q.limit, 50, 1, 200), status: q.status || undefined }) }
    })
    route('GET', '/cognition/claims', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.claims({ limit: toInt(q.limit, 50, 1, 200) }) }
    })
    route('POST', '/cognition/learning/run', async (req) => {
      const body = await readBody(req)
      return { ok: true, results: await cognition.runLearning({ max: body?.max || 1 }) }
    })
    route('POST', '/cognition/learning/task/retry', async (req) => {
      const body = await readBody(req)
      return { ok: true, task: cognition.retryTask(String(body?.taskId || '')) }
    })
    route('POST', '/cognition/learning/task/cancel', async (req) => {
      const body = await readBody(req)
      return { ok: true, task: cognition.cancelTask(String(body?.taskId || '')) }
    })
    route('GET', '/cognition/metrics', async () => ({ ok: true, metrics: cognition.metrics() }))
    route('GET', '/cognition/insights', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.insights({ limit: toInt(q.limit, 20, 1, 100) }) }
    })
    route('POST', '/cognition/insights/generate', async () => ({ ok: true, insight: cognition.generateInsight() }))
    route('GET', '/cognition/traces', async (req) => {
      const q = queryOf(req)
      return { ok: true, items: cognition.traces(q.turnId || '', { limit: toInt(q.limit, 100, 1, 500) }) }
    })
    route('GET', '/cognition/export/person', async (req) => {
      const q = queryOf(req)
      if (!q.personId) throw new Error('缺少 personId')
      return { ok: true, data: cognition.exportPerson(q.personId) }
    })
    route('POST', '/cognition/person/delete', async (req) => {
      const body = await readBody(req)
      if (!body?.personId) throw new Error('缺少 personId')
      return { ok: true, ...cognition.deletePerson(body.personId) }
    })
  }

  route('GET', '/config', async () => ({
    ok: true,
    version,
    apiVersion: API_VERSION,
    dataDir,
    config: publicConfig(getConfig()),
    defaults: defaultConfig(),
    groups: CONFIG_GROUPS,
  }))

  // 注意：DSH webserver 的 exact 路由按 path 去重（不区分 method），同 path 的 GET/POST
  // 不能分别注册，因此保存动作用独立子路径。
  route('POST', '/config/save', async (req) => {
    const body = await readBody(req)
    const next = body && body.config !== undefined ? body.config : body
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error('缺少 config 对象')
    const result = setConfig(next)
    return { ok: true, config: publicConfig(result.config), issues: result.issues || [] }
  })

  route('POST', '/config/reset', async () => {
    const result = resetConfig()
    return { ok: true, config: publicConfig(result.config), issues: result.issues || [] }
  })

  // ---- 连接控制 ----
  route('POST', '/connect', async () => {
    await gateway.start()
    return { ok: true, gateway: gateway.snapshot() }
  })

  route('POST', '/disconnect', async () => {
    gateway.stop()
    return { ok: true, gateway: gateway.snapshot() }
  })

  route('POST', '/reconnect', async () => {
    await gateway.restart()
    return { ok: true, gateway: gateway.snapshot() }
  })

  route('POST', '/probe', async (req) => {
    const body = await readBody(req)
    const result = await gateway.probe(body?.endpoint)
    return { ok: true, probe: result }
  })

  route('GET', '/gateway/detect', async () => ({ ok: true, ...(await gateway.detectGateway()) }))

  // ---- 账号与列表 ----
  route('GET', '/login-info', async () => {
    const info = await gateway.call('get_login_info', {}, { timeoutMs: 15000 })
    return { ok: true, login: { userId: String(info?.user_id ?? ''), nickname: info?.nickname || '' } }
  })

  route('GET', '/friends', async () => {
    const list = await gateway.call('get_friend_list', {}, { timeoutMs: 20000 })
    return { ok: true, friends: Array.isArray(list) ? list : [] }
  })

  route('GET', '/groups', async () => {
    const list = await gateway.call('get_group_list', {}, { timeoutMs: 20000 })
    return { ok: true, groups: Array.isArray(list) ? list : [] }
  })

  // ---- 消息发送 ----
  route('POST', '/send', async (req) => {
    const body = await readBody(req)
    const chatType = body?.chatType === 'group' ? 'group' : body?.chatType === 'private' ? 'private' : ''
    if (!chatType) throw new Error('chatType 必须是 private 或 group')
    const chatId = String(body?.chatId ?? '').trim()
    if (!chatId) throw new Error('缺少 chatId')
    const result = await gateway.actions.sendMessage({ chatType, chatId, message: body?.message })
    return { ok: true, result }
  })

  // ---- 原始 action 透传（受 security.allowRawAction 限制）----
  route('POST', '/action', async (req) => {
    if (!getConfig()?.security?.allowRawAction) throw new Error('未开启「允许面板透传任意 OneBot action」（配置 → 安全）')
    const body = await readBody(req)
    const action = String(body?.action || '').trim()
    if (!action) throw new Error('缺少 action')
    const params = body?.params && typeof body.params === 'object' ? body.params : {}
    const result = await gateway.call(action, params)
    return { ok: true, result }
  })

  // ---- 事件 / 日志 ----
  route('GET', '/events', async (req) => {
    const q = queryOf(req)
    const pageSize = Number(getConfig()?.ui?.eventPageSize) || 50
    return { ok: true, ...events.list({ since: toInt(q.since, 0, 0, Number.MAX_SAFE_INTEGER), limit: toInt(q.limit, pageSize, 1, 2000) }) }
  })

  route('POST', '/events/clear', async () => ({ ok: true, events: events.clear() }))

  route('GET', '/logs', async (req) => {
    const q = queryOf(req)
    const pageSize = Number(getConfig()?.ui?.logPageSize) || 100
    const result = logger.recent({
      since: toInt(q.since, 0, 0, Number.MAX_SAFE_INTEGER),
      limit: toInt(q.limit, pageSize, 1, 2000),
      minLevel: String(q.level || ''),
    })
    return { ok: true, ...result }
  })

  route('POST', '/logs/clear', async () => ({ ok: true, logs: logger.clear() }))

  route('GET', '/health', async () => ({
    ok: true,
    version,
    apiVersion: API_VERSION,
    state: gateway.snapshot().state,
    uptimeMs: Math.round(process.uptime() * 1000),
  }))

  return {
    prefix: API_PREFIX,
    apiVersion: API_VERSION,
    statusPayload,
    dispose() {
      for (const item of registered) {
        try {
          if (typeof item === 'function') item()
        } catch (error) {}
      }
      registered.length = 0
    },
  }
}
