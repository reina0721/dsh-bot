function stripTitle(value) {
  return String(value ?? '').replace(/<em\b[^>]*>/gi, '').replace(/<\/em>/gi, '').replace(/<[^>]+>/g, '').trim()
}

function playCount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  const text = String(value ?? '').trim()
  const number = Number.parseFloat(text.replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(number)) return 0
  if (text.includes('亿')) return Math.floor(number * 100000000)
  if (text.includes('万')) return Math.floor(number * 10000)
  return Math.max(0, Math.floor(number))
}

function duration(value) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0))
  const minutes = Math.floor(seconds / 60)
  return String(minutes).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
}

function validBvid(value) {
  return /^BV[0-9A-Za-z]{10}$/.test(value)
}

function parseBvid(bvid) {
  const value = String(bvid || '').trim().replace(/^bv/i, 'BV')
  if (!validBvid(value)) throw new Error('无效的 BV 号')
  return value
}

function shareUrl(bvid) {
  return `https://www.bilibili.com/video/${bvid}`
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function commentText(value, limit) {
  return Array.from(String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim()).slice(0, limit).join('')
}

function commentLimit(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(1, Math.min(20, Math.floor(number))) : 10
}

function normalizeComments(rows, limit, includeReplies = true) {
  const seen = new Set()
  const items = []
  for (const raw of rows) {
    if (!raw || typeof raw.content?.message !== 'string') continue
    const id = String(raw.rpid_str || raw.rpid || '')
    if (id && seen.has(id)) continue
    if (id) seen.add(id)
    const item = {
      author: commentText(raw.member?.uname, 100),
      content: commentText(raw.content?.message, 500),
      like: positiveInteger(raw.like),
      at: positiveInteger(raw.ctime),
    }
    if (includeReplies && Array.isArray(raw.replies)) item.replies = normalizeComments(raw.replies, limit, false)
    items.push(item)
    if (items.length >= limit) break
  }
  return items
}

function normalizeVideo(raw = {}) {
  const bvid = String(raw.bvid || '').trim()
  const seconds = typeof raw.duration === 'string' && raw.duration.includes(':')
    ? raw.duration.split(':').reduce((total, part) => total * 60 + (Number(part) || 0), 0)
    : Number(raw.duration) || 0
  return {
    title: stripTitle(raw.title),
    author: String(raw.author || raw.owner?.name || '').trim(),
    play: playCount(raw.play ?? raw.stat?.view),
    duration: duration(seconds),
    url: shareUrl(bvid),
    bvid,
    aid: positiveInteger(raw.aid),
    shareUrl: shareUrl(bvid),
  }
}

export function createBilibiliService({ getConfig, transport } = {}) {
  const cfg = () => {
    try { return getConfig?.()?.content?.bilibili || {} } catch (error) { return {} }
  }
  const settings = () => ({
    enabled: cfg().enabled === true,
    maxResults: Math.max(1, Math.min(20, Number(cfg().maxResults) || 5)),
  })

  function requireEnabled() {
    if (!settings().enabled) throw new Error('B站内容未启用')
  }

  async function request(path, params = {}) {
    requireEnabled()
    const payload = await transport[path](params)
    if (Number(payload?.code) !== 0) {
      const message = String(payload?.message || payload?.msg || '').trim()
      if ([-101, -352, -412].includes(Number(payload?.code))) throw new Error('B站公开接口要求登录或当前访问被限制；本服务不使用 Cookie/WBI')
      throw new Error(`B站接口错误 ${payload?.code}${message ? `：${message}` : ''}`)
    }
    return payload.data
  }

  async function search(keyword) {
    const value = String(keyword || '').trim()
    if (!value) throw new Error('请输入搜索关键词')
    const options = settings()
    const data = await request('search', { keyword: value, page_size: options.maxResults })
    const rows = Array.isArray(data?.result) ? data.result : []
    return { ok: true, items: rows.filter((row) => validBvid(String(row?.bvid || ''))).slice(0, options.maxResults).map(normalizeVideo) }
  }

  async function hot() {
    const options = settings()
    const data = await request('popular', { ps: options.maxResults })
    const rows = Array.isArray(data?.list) ? data.list : []
    return { ok: true, items: rows.filter((row) => validBvid(String(row?.bvid || ''))).slice(0, options.maxResults).map(normalizeVideo) }
  }

  async function video(bvid) {
    requireEnabled()
    const value = parseBvid(bvid)
    const data = await request('view', { bvid: value })
    if (data?.bvid !== value) throw new Error('B站接口返回无效视频数据')
    return { ok: true, items: [normalizeVideo(data)] }
  }

  async function comments(bvid, { limit = 10 } = {}) {
    requireEnabled()
    const value = parseBvid(bvid)
    const count = commentLimit(limit)
    const detail = (await video(value)).items[0]
    if (!detail.aid) throw new Error('B站视频缺少有效 aid，无法读取公开评论')
    const data = await request('replies', { oid: detail.aid, ps: count })
    if (!data || typeof data !== 'object') throw new Error('B站接口返回无效评论数据')
    const top = Array.isArray(data.top_replies) ? data.top_replies : []
    const rows = Array.isArray(data.replies) ? data.replies : []
    return { ok: true, items: normalizeComments([...top, ...rows], count) }
  }

  function share(bvid) {
    requireEnabled()
    const value = parseBvid(bvid)
    return { url: shareUrl(value), bvid: value }
  }

  return { search, hot, video, comments, share }
}
