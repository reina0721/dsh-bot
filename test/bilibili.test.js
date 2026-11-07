import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBilibiliService as createService } from '../src/modules/builtin/media-features/bilibili.js'
import { createBilibiliTransport } from '../src/modules/media-features-port.js'
const createBilibiliService = ({ getConfig, fetchImpl }) => createService({ getConfig, transport: createBilibiliTransport({ getConfig, fetchImpl }) })

function response(data, { ok = true, status = 200 } = {}) {
  return new Response(JSON.stringify(data), { status: ok ? 200 : status })
}

function service(payloads, config = { enabled: true, timeoutMs: 15000, maxResults: 2 }) {
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options })
    const next = payloads.shift()
    if (next instanceof Error) throw next
    return next instanceof Response ? next.clone() : next
  }
  return { calls, api: createBilibiliService({ getConfig: () => ({ content: { bilibili: config } }), fetchImpl }) }
}

test('bilibili：解析搜索、热门与视频并规范化字段', async () => {
  const { api, calls } = service([
    response({ code: 0, data: { result: [{ title: '<em class="keyword">猫</em>咪', author: 'UP1', play: 12, duration: '1:02', bvid: 'BV1xx411c7mD' }] } }),
    response({ code: 0, data: { list: [{ title: '热门', owner: { name: 'UP2' }, stat: { view: 34 }, duration: 125, bvid: 'BV1yy411c7mD' }] } }),
    response({ code: 0, data: { title: '详情', aid: '12345', owner: { name: 'UP3' }, stat: { view: 56 }, duration: 3, bvid: 'BV1zz411c7mD' } }),
  ])
  assert.deepEqual((await api.search('猫')).items[0], { title: '猫咪', author: 'UP1', play: 12, duration: '01:02', url: 'https://www.bilibili.com/video/BV1xx411c7mD', bvid: 'BV1xx411c7mD', aid: 0, shareUrl: 'https://www.bilibili.com/video/BV1xx411c7mD' })
  assert.equal((await api.hot()).items[0].duration, '02:05')
  const video = (await api.video('BV1zz411c7mD')).items[0]
  assert.equal(video.author, 'UP3')
  assert.equal(video.aid, 12345)
  assert.equal(video.shareUrl, 'https://www.bilibili.com/video/BV1zz411c7mD')
  assert.match(calls[0].url, /search\/type/)
  assert.equal(calls[0].options.headers.Referer, 'https://www.bilibili.com/')
})

test('bilibili：非零 code、HTTP、超时/网络错误给清晰错误', async () => {
  const coded = service([response({ code: -412, message: 'blocked' })]).api
  await assert.rejects(() => coded.hot(), /不使用 Cookie\/WBI/)
  const http = service([response({}, { ok: false, status: 503 })]).api
  await assert.rejects(() => http.hot(), /HTTP 503/)
  const failed = service([new Error('socket secret')]).api
  await assert.rejects(() => failed.hot(), /^Error: B站请求失败$/)
  const timedOut = service([new DOMException('timed out', 'TimeoutError')]).api
  await assert.rejects(() => timedOut.hot(), /B站请求超时/)
})

test('bilibili：默认关闭且不发起网络请求', async () => {
  let fetched = 0
  const api = createBilibiliService({ getConfig: () => ({}), fetchImpl: async () => { fetched += 1 } })
  for (const method of ['search', 'hot', 'video', 'comments']) await assert.rejects(() => api[method]('BV1xx411c7mD'), /B站内容未启用/)
  assert.throws(() => api.share('BV1xx411c7mD'), /B站内容未启用/)
  assert.equal(fetched, 0)
})

const BV = 'BV1xx411c7mD'
const view = (data = {}) => response({ code: 0, data: { bvid: BV, aid: 12345, ...data } })
const reply = (rpid, message, like = 0) => ({ rpid, member: { uname: 'UP' + rpid }, content: { message }, like, ctime: 1700000000 })

test('bilibili：公开评论置顶优先、rpid 去重、保留 API 顺序、纯文本与一层楼中楼', async () => {
  const top = reply('1', '  <b>置顶</b>\u0000\n文本  ', 2)
  top.member.uname = '<em>顶层作者</em>\u007f'
  top.replies = [reply('9', '子回复', 1), reply('9', '重复子回复'), reply('10', '😀'.repeat(501))]
  top.replies[0].replies = [reply('11', '不递归')]
  const { api, calls } = service([view(), response({ code: 0, data: {
    top_replies: [top], replies: [reply(1, '重复置顶', 100), reply(2, '先返回', 1), reply(3, '后返回', 99), null, {}],
  } })])
  const { items } = await api.comments(BV)
  assert.equal(items.length, 3)
  assert.deepEqual(items[0], {
    author: '顶层作者', content: '置顶  文本', like: 2, at: 1700000000,
    replies: [
      { author: 'UP9', content: '子回复', like: 1, at: 1700000000 },
      { author: 'UP10', content: '😀'.repeat(500), like: 0, at: 1700000000 },
    ],
  })
  assert.deepEqual(items.slice(1).map((row) => row.content), ['先返回', '后返回'])
  assert.equal(new URL(calls[0].url).pathname, '/x/web-interface/view')
  const url = new URL(calls[1].url)
  assert.equal(url.pathname, '/x/v2/reply')
  assert.deepEqual(Object.fromEntries(url.searchParams), { type: '1', oid: '12345', sort: '2', ps: '10', pn: '1' })
  for (const call of calls) {
    assert.equal(new URL(call.url).origin, 'https://api.bilibili.com')
    assert.deepEqual(Object.keys(call.options.headers).sort(), ['Referer', 'User-Agent'])
    assert.equal(new URL(call.url).searchParams.has('w_rid'), false)
  }
})

test('bilibili：评论 limit 默认 10、夹在 1–20、取整，top_replies 也计入上限', async () => {
  for (const [limit, expected] of [[undefined, 10], [0, 1], [-4, 1], [1, 1], [3.9, 3], ['2', 2], [20, 20], [200, 20], ['bad', 10], [Infinity, 10]]) {
    const { api, calls } = service([view(), response({ code: 0, data: {
      top_replies: [reply(100, '置顶')], replies: Array.from({ length: 30 }, (_, i) => reply(i + 1, String(i))),
    } })])
    const result = await api.comments(BV, { limit })
    assert.equal(result.items.length, expected)
    assert.equal(new URL(calls[1].url).searchParams.get('ps'), String(expected))
    assert.equal(result.items[0].content, '置顶')
  }
})

test('bilibili：分享仅生成规范链接，离线不取详情也不声称视频存在', async () => {
  const { api, calls } = service([])
  assert.deepEqual(api.share('  bv1xx411c7mD  '), { url: 'https://www.bilibili.com/video/' + BV, bvid: BV })
  assert.equal(calls.length, 0)
})

test('bilibili：无效 BV 拒绝且零请求，不接受 URL、路径、查询或短 BV', async () => {
  const { api, calls } = service([])
  for (const invalid of ['', null, 'av123', 'BVabc', 'BV1xx411c7mDextra', BV + '?x=1', BV + '/x', 'https://www.bilibili.com/video/' + BV, 'BV1xx411c7m!']) {
    await assert.rejects(() => api.video(invalid), /无效的 BV/)
    await assert.rejects(() => api.comments(invalid), /无效的 BV/)
    assert.throws(() => api.share(invalid), /无效的 BV/)
  }
  assert.equal(calls.length, 0)
})

test('bilibili：不从无效详情伪造 BV/aid/链接；缺 aid 不读取评论', async () => {
  for (const data of [null, {}, { aid: 12345 }, { bvid: 'BV2xx411c7mD', aid: 12345 }]) {
    const { api, calls } = service([response({ code: 0, data })])
    await assert.rejects(() => api.comments(BV), /无效视频数据/)
    assert.equal(calls.length, 1)
  }
  for (const aid of [undefined, 0, -1, 'bad', 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const { api, calls } = service([view({ aid })])
    await assert.rejects(() => api.comments(BV), /缺少有效 aid/)
    assert.equal(calls.length, 1)
  }
  const { api } = service([response({ code: 0, data: { result: [{ title: '缺 BV', url: 'https://example.com/fake' }, { title: '坏 BV', bvid: 'BVbad' }] } })])
  assert.deepEqual((await api.search('test')).items, [])
})

test('bilibili：空评论不造数据，无效响应报错，每次重新查询而不缓存', async () => {
  const { api, calls } = service([
    view(), response({ code: 0, data: { replies: null, top_replies: null } }),
    view(), response({ code: 0, data: { replies: [null, {}, { content: { message: 123 } }] } }),
    view(), response({ code: 0, data: null }),
  ])
  assert.deepEqual(await api.comments(BV), { ok: true, items: [] })
  assert.deepEqual(await api.comments(BV), { ok: true, items: [] })
  await assert.rejects(() => api.comments(BV), /无效评论数据/)
  assert.equal(calls.length, 6)
})

test('bilibili：详情和评论端点的非零 code、HTTP、网络及正文超时均给明确错误', async () => {
  const cases = [
    ...[-101, -352, -412].map((code) => [response({ code, message: 'upstream secret' }), /公开接口要求登录.*不使用 Cookie\/WBI/]),
    [response({ code: -404, message: '不存在' }), /接口错误 -404：不存在/],
    [response({}, { ok: false, status: 503 }), /HTTP 503/],
    [new Error('socket secret'), /^Error: B站请求失败$/],
    [new DOMException('timeout', 'TimeoutError'), /请求超时/],
    [new DOMException('abort', 'AbortError'), /请求超时/],
    [new Response('not json'), /返回无效数据/],
    [new Response(new ReadableStream({ start(controller) { controller.error(new DOMException('body timeout', 'TimeoutError')) } })), /请求超时/],
  ]
  for (const [failure, pattern] of cases) {
    for (const stage of ['view', 'reply']) {
      const { api, calls } = service(stage === 'view' ? [failure] : [view(), failure])
      await assert.rejects(() => api.comments(BV), pattern)
      assert.equal(calls.length, stage === 'view' ? 1 : 2)
    }
  }
})

test('bilibili：真实超时信号中止请求，且配置低值仍有 1000ms 下限', async () => {
  let calls = 0
  const keepAlive = setTimeout(() => {}, 3000)
  try {
    const api = createBilibiliService({
      getConfig: () => ({ content: { bilibili: { enabled: true, timeoutMs: 1 } } }),
      fetchImpl: async (url, { signal }) => {
        calls++
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
      },
    })
    await assert.rejects(() => api.comments(BV), /请求超时/)
    assert.equal(calls, 1)
  } finally { clearTimeout(keepAlive) }
})
