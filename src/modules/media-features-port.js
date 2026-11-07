// Builtin-only host adapter. Feature code never receives URLs, credentials or files.
import { normalizeConfig } from '../core/config.js'

const ORIGIN = 'https://api.bilibili.com'
const HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (compatible; dsh-bot/1.0; +https://github.com/reina0721/dsh-bot)',
  Referer: 'https://www.bilibili.com/',
})
export const MAX_BILIBILI_RESPONSE_BYTES = 2 * 1024 * 1024

export function createBilibiliTransport({ getConfig, assertActive = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const bound = value => Math.max(1, Math.min(20, Math.floor(Number(value)) || 10))
  const positive = value => { if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) throw new Error('无效的 aid'); return Number(value) }
  async function request(path, params) {
    assertActive()
    const url = new URL(path, ORIGIN)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value))
    let response
    try {
      if (typeof fetchImpl !== 'function') throw new Error('unavailable')
      const timeoutMs = Math.max(1000, Math.min(60000, Math.floor(Number(getConfig?.()?.content?.bilibili?.timeoutMs)) || 15000))
      response = await fetchImpl(url, { headers: { ...HEADERS }, redirect: 'error', signal: AbortSignal.timeout(timeoutMs) })
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new Error('B站请求超时')
      throw new Error('B站请求失败')
    }
    if (!response?.ok) throw new Error(`B站接口 HTTP ${Number(response?.status) || '错误'}`)
    let payload
    try {
      if (Number(response.headers?.get('content-length')) > MAX_BILIBILI_RESPONSE_BYTES) {
        await response.body?.cancel().catch(() => {})
        throw new Error('bound')
      }
      // Read incrementally; never allocate an unbounded upstream body.
      const reader = response.body.getReader()
      const chunks = []
      let size = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > MAX_BILIBILI_RESPONSE_BYTES) throw new Error('bound')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel().catch(() => {}) }
      payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch (error) {
      if (['TimeoutError', 'AbortError'].includes(error?.name)) throw new Error('B站请求超时')
      throw new Error('B站接口返回无效数据')
    }
    assertActive()
    return payload
  }
  return Object.freeze({
    search({ keyword, page_size } = {}) {
      if (typeof keyword !== 'string' || !keyword.trim() || keyword.length > 1000) throw new Error('请输入搜索关键词')
      return request('/x/web-interface/search/type', { search_type: 'video', keyword, page: 1, page_size: bound(page_size) })
    },
    popular({ ps } = {}) { return request('/x/web-interface/popular', { pn: 1, ps: bound(ps) }) },
    view({ bvid } = {}) {
      if (typeof bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('无效的 BV 号')
      return request('/x/web-interface/view', { bvid })
    },
    replies({ oid, ps } = {}) { return request('/x/v2/reply', { type: 1, oid: positive(oid), sort: 2, ps: bound(ps), pn: 1 }) },
  })
}

export function createMediaFeaturesPort({ getConfig, assertActive, media, stickers, delivery, access, fetchImpl, authorizeStickerSend } = {}) {
  const tokens = new WeakMap()
  const config = () => {
    assertActive()
    const current = getConfig?.() || {}
    const projected = normalizeConfig({ content: { bilibili: current.content?.bilibili }, media: { stickers: current.media?.stickers } }).config
    return { bilibili: projected.content.bilibili, stickers: { maxCount: projected.media.stickers.maxCount, maxBytes: projected.media.stickers.maxBytes } }
  }
  const status = () => {
    assertActive()
    const current = getConfig?.()?.media || {}
    const stickerLibraryAvailable = ['list', 'importBuffer', 'updateTags', 'remove', 'fileFor', 'pick', 'status'].every(key => typeof stickers?.[key] === 'function')
    return {
      mediaEnabled: current.enabled === true,
      stickersEnabled: current.stickers?.enabled !== false,
      imagesEnabled: current.images?.enabled === true,
      stickerLibraryAvailable,
      stickerSendAvailable: stickerLibraryAvailable && typeof media?.sendMedia === 'function' && typeof delivery?.deliver === 'function',
    }
  }
  const canSend = target => {
    assertActive()
    if (access?.canSend?.(target)?.allowed !== true) throw new Error('ACCESS_DENIED')
    if (authorizeStickerSend?.() !== true) throw new Error('表情包功能未启用。')
    const parent = status()
    if (!parent.mediaEnabled || !parent.stickersEnabled || !parent.imagesEnabled || !parent.stickerSendAvailable) throw new Error('表情包功能未启用。')
  }
  const api = Object.freeze({
    config, status,
    bilibili: createBilibiliTransport({ getConfig, assertActive, fetchImpl }),
    stickers: Object.freeze({
      async pick({ tag } = {}) {
        assertActive()
        if (!stickers?.pick) throw new Error('表情包服务不可用。')
        let item
        try { item = await stickers.pick({ tag: String(tag || '').slice(0, 1000) }) } catch { throw new Error('表情包库读取失败。') }
        assertActive()
        return item ? { id: String(item.id), name: String(item.name || '').slice(0, 120) } : null
      },
      async send({ commandToken, stickerId } = {}) {
        assertActive()
        const target = commandToken && tokens.get(commandToken)
        if (!target) throw new Error('表情包命令令牌已失效')
        tokens.delete(commandToken) // Consume before any await, including failed sends.
        canSend(target)
        if (typeof stickerId !== 'string' || !stickerId || stickerId.length > 128) throw new Error('表情包 ID 无效')
        if (!stickers?.fileFor || !media?.sendMedia || !delivery?.deliver) throw new Error('表情包服务不可用。')
        let file
        try { file = await stickers.fileFor(stickerId) } catch { throw new Error('表情包文件不可用。') }
        canSend(target)
        if (!file) return { missing: true }
        let result
        try {
          result = await media.sendMedia({ ...target, kind: 'image', filePath: file.path,
            deliver: intent => { canSend(target); return delivery.deliver(intent) },
          })
        } catch { throw new Error('表情包发送失败，请检查媒体配置、文件及网关权限。') }
        return { ok: result?.ok === true }
      },
    }),
  })
  // This wrapper stays in the kernel; modules can neither mint tokens nor choose targets.
  async function withCommand(turn, handler) {
    assertActive()
    const token = Object.freeze({})
    const target = { chatType: turn.chatType, chatId: String(turn.chatId || '') }
    if (!['private', 'group'].includes(target.chatType) || !/^[1-9]\d*$/.test(target.chatId) || !Number.isSafeInteger(Number(target.chatId))) throw new Error('表情包目标无效')
    tokens.set(token, target)
    try { return await handler(token) } finally { tokens.delete(token) }
  }
  return { api, withCommand }
}
