import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModuleKernel } from '../src/modules/kernel.js'
import { builtinRegistry } from '../src/modules/registry.js'
import { setup } from '../src/modules/builtin/media-features/index.js'
import { createMediaFeaturesPort, createBilibiliTransport, MAX_BILIBILI_RESPONSE_BYTES } from '../src/modules/media-features-port.js'
import { createOutbound } from '../src/cognition/outbound.js'
import { createCommandService } from '../src/cognition/commands.js'
import { createAccess } from '../src/core/access.js'
import { normalizeConfig, CONFIG_GROUPS } from '../src/core/config.js'
import { createProviderRegistry } from '../src/extensions/providers.js'
import { createDeliveryService } from '../src/delivery/service.js'
import { createMediaService } from '../src/media/index.js'
import { createStickerService } from '../src/media/stickers.js'
import { createRoutes } from '../src/http/routes.js'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { validateManifest } from '../src/modules/manifest.js'

const descriptor = builtinRegistry.find(row => row.manifest.id === 'builtin-media-features')
const BV = 'BV1xx411c7mD'
async function harness(t, { setupImpl = setup, deliveryOverride = null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-media-feature-'))
  const config = normalizeConfig({ access: { ownerQQ: '10001', operators: ['10002'], mode: 'allowlist', groups: ['20001'] }, media: { enabled: true, images: { enabled: true } }, content: { bilibili: { enabled: true } } }).config
  const access = createAccess({ getConfig: () => config })
  const sent = []
  let reject = false
  const delivery = deliveryOverride || createDeliveryService({ outbound: { deliver: async intent => { sent.push(intent); return reject ? { ok: false, error: 'RATE_LIMITED' } : { ok: true, messageId: 'one' } } } })
  const media = createMediaService({ dataDir: join(root, 'media'), getConfig: () => config, gateway: { actions: { sendMessage() { assert.fail('sticker must use delivery guards') } } } })
  const stickers = createStickerService({ dataDir: join(root, 'media'), getConfig: () => config })
  const commands = createCommandService({ getConfig: () => config, access, delivery })
  const providers = createProviderRegistry()
  let api
  const kernel = createModuleKernel({ dataDir: join(root, 'modules'), getConfig: () => config, media, stickers, delivery, access, commands, providerRegistry: providers,
    registry: [{ ...descriptor, load: () => ({ setup(value) { api = value; return setupImpl(value) } }) }],
  })
  const fake = createFakeDsh()
  const routes = createRoutes({ ctx: fake.ctx, getConfig: () => config, media, stickers, providerRegistry: providers })
  t.after(async () => { routes.dispose(); fake.dispose(); await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  assert.equal(kernel.list()[0].status, 'loaded')
  const command = (text, extra = {}) => commands.handle({ text, senderId: '10001', chatType: 'private', chatId: '10001', ...extra })
  const call = async (path, body, method = 'GET') => (await fake.call('/onebot-qq/api' + path, body, { method })).json
  return { root, config, kernel, providers, commands, command, call, sent, stickers, media, api: () => api, reject: () => { reject = true } }
}

test('media module: default owner, side-effect-free catalog/config projections and no credentials/files', async t => {
  const h = await harness(t)
  h.config.onebot.httpToken = 'host-secret'
  h.config.media.dir = '/host/private'
  const port = h.api().mediaFeatures
  assert.deepEqual(Object.keys(port).sort(), ['bilibili', 'config', 'status', 'stickers'])
  assert.deepEqual(Object.keys(port.bilibili).sort(), ['popular', 'replies', 'search', 'view'])
  assert.deepEqual(Object.keys(port.stickers).sort(), ['pick', 'send'])
  assert.equal('enabled' in port.config().stickers, false)
  assert.equal(port.status().stickersEnabled, true)
  assert.doesNotMatch(JSON.stringify([port.config(), port.status(), h.kernel.uiCatalog()]), /host-secret|host\/private|filePath|dataBase64/)
  const catalog = h.kernel.uiCatalog()
  assert.deepEqual(catalog, h.kernel.uiCatalog())
  assert.equal(catalog.items[0].config.binding, 'legacy-core')
  assert.deepEqual(catalog.items[0].surfaces.map(row => row.hook), ['module.detail', 'module.config', 'module.panel'])
  assert.equal(CONFIG_GROUPS.flatMap(row => row.fields).filter(row => row.module === descriptor.manifest.id).length, 6)
  const provider = h.providers.get('mediaFeatures')
  provider.start(); provider.start(); provider.stop(); provider.stop()
  assert.equal(provider.status().active, false)
  assert.throws(() => provider.bilibili.share(BV), /未启用/)
  provider.start()
  assert.equal(provider.bilibili.share(BV).bvid, BV)
})

test('media commands: owner/operator audiences and deny/access checks precede feature side effects', async t => {
  let requests = 0, picks = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return Response.json({ code: 0, data: { list: [] } }) })
  const h = await harness(t)
  t.mock.method(h.stickers, 'pick', async () => { picks++; return null })
  assert.equal((await h.command('/bili hot', { senderId: '10002', chatId: '10002' })).reply, '没有找到 B站视频。')
  for (const senderId of ['10002', '10003']) assert.equal((await h.command('/sticker', { senderId })).reply, '')
  assert.equal((await h.command('/bili hot', { senderId: '10003' })).reply, '')
  h.config.cognition.permissions.deniedCommands = ['bili', 'sticker']
  for (const text of ['/BILI hot', '/sticker']) assert.match((await h.command(text)).reply, /禁用/)
  h.config.cognition.permissions.deniedCommands = []
  for (const senderId of ['10001', '10002']) for (const text of ['/bili hot', '/sticker']) {
    const result = await h.command(text, { senderId, chatType: 'group', chatId: '20002' })
    assert.equal(result.reply, '')
  }
  assert.equal(requests, 1); assert.equal(picks, 0)
  assert.match((await h.command('/sticker')).reply, /还没有表情包/)
  assert.equal(picks, 1)
})

test('sticker port: exact one guarded delivery, no path/bytes, rejection never retries, data persists on toggle', async t => {
  const h = await harness(t)
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'cat.png', mime: 'image/png', tags: ['猫'] })
  const index = await readFile(join(h.root, 'media/stickers.json'), 'utf8')
  assert.deepEqual(await h.api().mediaFeatures.stickers.pick({ tag: '猫' }), { id: item.id, name: 'cat.png' })
  assert.equal((await h.command('/sticker 猫')).reply, '')
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].source, 'command')
  assert.deepEqual(h.sent[0].parts, undefined)
  assert.equal(h.sent[0].segments[0].type, 'image')
  assert.equal(h.sent[0].segments[0].data.file, 'base64://aW1hZ2U=')
  h.reject()
  await h.command('/sticker')
  assert.equal(h.sent.length, 2)
  const oldPort = h.api().mediaFeatures, oldProvider = h.providers.get('mediaFeatures')
  await h.kernel.setEnabled(descriptor.manifest.id, false)
  assert.equal(h.providers.get('mediaFeatures'), null)
  assert.throws(() => oldPort.status(), /停止/)
  assert.throws(() => oldProvider.bilibili.share(BV), /未启用/)
  for (const text of ['/bili hot', '/sticker']) assert.deepEqual(await h.command(text), { handled: true, reply: '' })
  assert.equal(h.sent.length, 2)
  await h.kernel.setEnabled(descriptor.manifest.id, true)
  assert.equal(await readFile(join(h.root, 'media/stickers.json'), 'utf8'), index)
  assert.equal((await h.stickers.list())[0].id, item.id)
})

test('sticker tokens: bound to authorized command, one use, stale after handler and module generation', async t => {
  let saved, result
  const h = await harness(t, { setupImpl(api) {
    return setup({ mediaFeatures: api.mediaFeatures, providers: api.providers, registerCommand(name, handler, options) {
      return api.registerCommand(name, async input => {
        if (name !== 'sticker') return handler(input)
        saved = input.commandToken
        if (input.parsed.args === 'hold') return ''
        const item = await api.mediaFeatures.stickers.pick({ tag: '' })
        result = await Promise.allSettled([
          api.mediaFeatures.stickers.send({ commandToken: saved, stickerId: item.id, chatId: '99999' }),
          api.mediaFeatures.stickers.send({ commandToken: saved, stickerId: item.id }),
        ])
        return ''
      }, options)
    } })
  } })
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'cat.png', mime: 'image/png' })
  const oldPort = h.api().mediaFeatures
  await assert.rejects(oldPort.stickers.send({ commandToken: {}, stickerId: item.id }), /令牌/)
  await h.command('/sticker')
  assert.equal(result.filter(row => row.status === 'fulfilled').length, 1)
  assert.equal(h.sent.length, 1); assert.equal(h.sent[0].chatId, '10001')
  await assert.rejects(oldPort.stickers.send({ commandToken: saved, stickerId: item.id }), /令牌/)
  await h.command('/sticker hold')
  await assert.rejects(oldPort.stickers.send({ commandToken: saved, stickerId: item.id }), /令牌/)
  await h.kernel.setEnabled(descriptor.manifest.id, false)
  await h.kernel.setEnabled(descriptor.manifest.id, true)
  await assert.rejects(oldPort.stickers.send({ commandToken: saved, stickerId: item.id }), /停止/)
  await assert.rejects(h.api().mediaFeatures.stickers.send({ commandToken: saved, stickerId: item.id }), /令牌/)
})

test('media HTTP: every feature route fails closed when disabled and parent switches gate sticker controls', async t => {
  const h = await harness(t)
  const uploaded = await h.call('/media/stickers/upload', { name: 'x.png', mime: 'image/png', data: Buffer.from('image').toString('base64') }, 'POST')
  assert.equal(uploaded.ok, true)
  const id = uploaded.item.id
  const paths = [
    ['/media/stickers'], ['/media/stickers/upload', { name: 'x.png', mime: 'image/png', data: 'aW1hZ2U=' }, 'POST'],
    ['/media/stickers/tag', { id, tags: ['x'] }, 'POST'], ['/media/stickers/delete', { id }, 'POST'], ['/media/stickers/file?id=' + id],
  ]
  for (const parent of ['enabled', 'images']) {
    if (parent === 'enabled') h.config.media.enabled = false
    else h.config.media.images.enabled = false
    for (const args of paths) assert.equal((await h.call(...args)).ok, false)
    h.config.media.enabled = true; h.config.media.images.enabled = true
  }
  await h.kernel.setEnabled(descriptor.manifest.id, false)
  for (const args of [...paths, ['/content/bilibili?q=猫'], ['/content/bilibili/hot'], ['/content/bilibili/comments?bvid=' + BV], ['/content/bilibili/share?bvid=' + BV]]) {
    const response = await h.call(...args)
    assert.equal(response.ok, false)
    assert.match(response.message, /模块未启用/)
    assert.ok(!JSON.stringify(response).includes(h.root))
  }
  const status = await h.call('/media/status')
  assert.equal(status.ok, true); assert.equal(status.mediaFeatures.active, false); assert.equal(status.stickers.available, false)
  assert.equal(status.stickers.count, 1)
})

test('media port: lifecycle rechecked after file await; no late send', async t => {
  const h = await harness(t)
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'x.png', mime: 'image/png' })
  let release, entered
  const waiting = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const fileFor = h.stickers.fileFor
  t.mock.method(h.stickers, 'fileFor', async id => { entered(); await gate; return fileFor(id) })
  const sending = h.command('/sticker')
  await waiting
  await h.kernel.setEnabled(descriptor.manifest.id, false)
  release()
  await sending
  assert.equal(h.sent.filter(row => row.segments?.some(segment => segment.type === 'image')).length, 0)
  await assert.rejects(h.api().mediaFeatures.stickers.send({ commandToken: {}, stickerId: item.id }), /停止/)
})

test('media slot and permission: identity fixed, external manifest rejected, media events isolated from reminders', async () => {
  const registry = createProviderRegistry(), events = []
  const provider = { start() {}, stop() {}, bilibili: {}, authorizeStickers: () => true }
  assert.throws(() => registry.register('mediaFeatures', provider, { moduleId: 'builtin-other' }), /builtin-media-features/)
  assert.throws(() => validateManifest({ id: 'external', permissions: ['media:features'] }), /仅允许内置/)
  registry.subscribe(event => { if (event.name === 'reminders') events.push(event) })
  const off = registry.register('mediaFeatures', provider, { moduleId: descriptor.manifest.id })
  off(); off()
  assert.deepEqual(events, [])
})

test('Bilibili transport: fixed requests ignore arbitrary URL/header/cookie fields and bound response stream', async () => {
  const calls = []
  let oversized = false
  const transport = createBilibiliTransport({ getConfig: () => ({}), fetchImpl: async (url, options) => {
    calls.push({ url, options })
    return oversized ? new Response('x'.repeat(MAX_BILIBILI_RESPONSE_BYTES + 1)) : Response.json({ code: 0, data: {} })
  } })
  await transport.search({ keyword: '猫', url: 'https://evil.test', headers: { Cookie: 'secret' }, page_size: 999 })
  assert.equal(calls[0].url.origin, 'https://api.bilibili.com')
  assert.equal(calls[0].url.pathname, '/x/web-interface/search/type')
  assert.equal(calls[0].url.searchParams.get('page_size'), '20')
  assert.deepEqual(Object.keys(calls[0].options.headers).sort(), ['Referer', 'User-Agent'])
  assert.equal(calls[0].options.redirect, 'error')
  oversized = true
  await assert.rejects(transport.popular(), /无效数据/)
  assert.throws(() => transport.view({ bvid: 'https://evil.test' }), /无效的 BV/)
  assert.throws(() => transport.replies({ oid: '../etc' }), /无效的 aid/)
})

test('sticker delivery retains actual outbound access/rate/dry-run guards', async t => {
  let allowed = false, rate = false, sends = 0
  const outboundConfig = { cognition: { dryRun: false } }
  const outbound = createOutbound({ getConfig: () => outboundConfig,
    access: { canSend: () => ({ allowed }) }, policy: { canSend: () => ({ ok: rate }) },
    gateway: { actions: { async sendMessage() { sends++; return { message_id: 1 } } } },
  })
  const h = await harness(t, { deliveryOverride: createDeliveryService({ outbound }) })
  await h.stickers.importBuffer(Buffer.from('image'), { name: 'cat.png', mime: 'image/png' })
  await h.command('/sticker')
  assert.equal(sends, 0)
  allowed = true
  await h.command('/sticker')
  assert.equal(sends, 0)
  rate = true; outboundConfig.cognition.dryRun = true
  await h.command('/sticker')
  assert.equal(sends, 0)
  outboundConfig.cognition.dryRun = false
  await h.command('/sticker')
  assert.equal(sends, 1)
})

test('sticker port: missing/failed send consumes token and errors never reveal file paths', async t => {
  const h = await harness(t)
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'cat.png', mime: 'image/png' })
  const port = createMediaFeaturesPort({ getConfig: () => h.config, assertActive() {}, media: h.media, stickers: h.stickers,
    access: { canSend: () => ({ allowed: true }) }, delivery: { deliver: async () => ({ ok: true }) }, authorizeStickers: () => true })
  await port.withCommand({ chatType: 'private', chatId: '10001' }, async commandToken => {
    assert.deepEqual(await port.api.stickers.send({ commandToken, stickerId: 'missing' }), { missing: true })
    await assert.rejects(port.api.stickers.send({ commandToken, stickerId: item.id }), /令牌/)
  })
  t.mock.method(h.stickers, 'pick', async () => { throw new Error(h.root + '/private.json') })
  await assert.rejects(port.api.stickers.pick({ tag: '' }), error => !error.message.includes(h.root))
  t.mock.method(h.media, 'sendMedia', async () => { throw new Error(h.root + '/private.png') })
  await port.withCommand({ chatType: 'private', chatId: '10001' }, async commandToken => {
    await assert.rejects(port.api.stickers.send({ commandToken, stickerId: item.id }), error => !error.message.includes(h.root))
    await assert.rejects(port.api.stickers.send({ commandToken, stickerId: item.id }), /令牌/)
  })
})

test('Bilibili transport revokes late network results and rejects declared oversized bodies', async () => {
  let active = true, release
  const transport = createBilibiliTransport({ getConfig: () => ({}), assertActive() { if (!active) throw new Error('stopped') },
    fetchImpl: () => new Promise(resolve => { release = resolve }) })
  const request = transport.popular()
  active = false
  release(Response.json({ code: 0, data: {} }))
  await assert.rejects(request, /stopped/)
  const oversized = createBilibiliTransport({ fetchImpl: async () => new Response('{}', { headers: { 'content-length': String(MAX_BILIBILI_RESPONSE_BYTES + 1) } }) })
  await assert.rejects(oversized.popular(), /无效数据/)
})
