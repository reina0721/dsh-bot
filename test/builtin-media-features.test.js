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
const imageIntents = sent => sent.filter(row => row.segments?.some(segment => segment.type === 'image'))
async function harness(t, { setupImpl = setup, deliveryOverride = null, unavailable = null } = {}) {
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
  const kernel = createModuleKernel({ dataDir: join(root, 'modules'), getConfig: () => config, media: unavailable === 'media' ? null : media, stickers: unavailable === 'library' ? null : stickers, delivery: unavailable === 'delivery' ? null : delivery, access, commands, providerRegistry: providers,
    registry: [{ ...descriptor, load: () => ({ setup(value) { api = value; return setupImpl(value) } }) }],
  })
  const fake = createFakeDsh()
  const routes = createRoutes({ ctx: fake.ctx, getConfig: () => config, media, stickers, providerRegistry: providers })
  t.after(async () => { routes.dispose(); fake.dispose(); await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  await kernel.start()
  assert.equal(kernel.list()[0].status, 'loaded')
  const command = (text, extra = {}) => commands.handle({ text, senderId: '10001', chatType: 'private', chatId: '10001', ...extra })
  const call = async (path, body, method = 'GET') => (await fake.call('/onebot-qq/api' + path, body, { method })).json
  return { root, config, kernel, providers, commands, command, call, rawCall: fake.call, sent, stickers, media, api: () => api, reject: () => { reject = true } }
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

test('media HTTP: module/media/stickers off close every library route', async t => {
  const h = await harness(t)
  const uploaded = await h.call('/media/stickers/upload', { name: 'x.png', mime: 'image/png', data: Buffer.from('image').toString('base64') }, 'POST')
  assert.equal(uploaded.ok, true)
  const id = uploaded.item.id
  const paths = [
    ['/media/stickers'], ['/media/stickers/upload', { name: 'x.png', mime: 'image/png', data: 'aW1hZ2U=' }, 'POST'],
    ['/media/stickers/tag', { id, tags: ['x'] }, 'POST'], ['/media/stickers/delete', { id }, 'POST'], ['/media/stickers/file?id=' + id],
  ]
  for (const parent of ['enabled', 'stickers']) {
    if (parent === 'enabled') h.config.media.enabled = false
    else h.config.media.stickers.enabled = false
    for (const args of paths) assert.equal((await h.call(...args)).ok, false)
    h.config.media.enabled = true; h.config.media.stickers.enabled = true
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

test('sticker authorization: all 16 module/media/stickers/images combinations', async t => {
  const h = await harness(t)
  await h.stickers.importBuffer(Buffer.from('image'), { name: 'x.png', mime: 'image/png' })
  let picks = 0, mediaCalls = 0
  const pick = h.stickers.pick, send = h.media.sendMedia
  t.mock.method(h.stickers, 'pick', async args => { picks++; return pick(args) })
  t.mock.method(h.media, 'sendMedia', async args => { mediaCalls++; return send(args) })
  for (const module of [true, false]) {
    await h.kernel.setEnabled(descriptor.manifest.id, module)
    for (const media of [true, false]) for (const stickers of [true, false]) for (const images of [true, false]) {
      await t.test(JSON.stringify({ module, media, stickers, images }), async () => {
        h.config.media.enabled = media
        h.config.media.stickers.enabled = stickers
        h.config.media.images.enabled = images
        const library = module && media && stickers, sending = library && images
        const reason = !module ? 'MODULE_DISABLED' : !media ? 'MEDIA_DISABLED' : !stickers ? 'STICKERS_DISABLED' : null
        const status = (await h.call('/media/status')).stickers
        assert.equal(status.available, library)
        assert.equal(status.libraryAvailable, library)
        assert.equal(status.sendAvailable, sending)
        assert.equal(status.libraryReason, reason)
        assert.equal(status.sendReason, reason || (!images ? 'IMAGES_DISABLED' : null))
        if (module) {
          const provider = h.providers.get('mediaFeatures')
          assert.equal(provider.authorizeStickerLibrary(), library)
          assert.equal(provider.authorizeStickerSend(), sending)
        }
        assert.equal((await h.call('/media/stickers')).ok, library)
        const before = { picks, mediaCalls, sent: imageIntents(h.sent).length }
        await h.command('/sticker')
        assert.equal(picks - before.picks, sending ? 1 : 0)
        assert.equal(mediaCalls - before.mediaCalls, sending ? 1 : 0)
        assert.equal(imageIntents(h.sent).length - before.sent, sending ? 1 : 0)
      })
    }
  }
})

test('media HTTP: images off permits upload/list/tag/file preview/delete but never sticker send', async t => {
  const h = await harness(t)
  h.config.media.images.enabled = false
  const uploaded = await h.call('/media/stickers/upload', { name: 'x.png', mime: 'image/png', data: 'aW1hZ2U=', tags: ['旧'] }, 'POST')
  assert.equal(uploaded.ok, true)
  const id = uploaded.item.id
  assert.deepEqual((await h.call('/media/stickers')).items.map(item => item.id), [id])
  const tagged = await h.call('/media/stickers/tag', { id, tags: ['新'] }, 'POST')
  assert.equal(tagged.ok, true)
  assert.deepEqual(tagged.item.tags, ['新'])
  const preview = await h.rawCall('/onebot-qq/api/media/stickers/file?id=' + id, undefined, { method: 'GET', headers: { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-origin' } })
  assert.equal(preview.status, 200)
  assert.equal(preview.headers['content-type'], 'image/png')
  assert.equal(preview.text, 'image')
  assert.match((await h.command('/sticker 新')).reply, /未启用/)
  assert.equal(imageIntents(h.sent).length, 0)
  assert.deepEqual(await h.call('/media/stickers/delete', { id }, 'POST'), { ok: true, removed: true })
  assert.deepEqual((await h.call('/media/stickers')).items, [])
})

test('sticker availability: missing library closes both; missing media or delivery only closes send', async t => {
  for (const unavailable of ['library', 'media', 'delivery']) await t.test(unavailable, async t => {
    const h = await harness(t, { unavailable })
    const provider = h.providers.get('mediaFeatures')
    const library = unavailable !== 'library'
    assert.equal(provider.authorizeStickerLibrary(), library)
    assert.equal(provider.authorizeStickerSend(), false)
    const status = (await h.call('/media/status')).stickers
    assert.equal(status.libraryAvailable, library)
    assert.equal(status.sendAvailable, false)
    assert.equal(status.libraryReason, library ? null : 'LIBRARY_UNAVAILABLE')
    assert.equal(status.sendReason, library ? 'DELIVERY_UNAVAILABLE' : 'LIBRARY_UNAVAILABLE')
    await h.command('/sticker')
    assert.equal(imageIntents(h.sent).length, 0)
  })
})

test('sticker send rechecks module/media/stickers/images after file await and before delivery', async t => {
  for (const stage of ['file', 'delivery']) for (const off of ['module', 'media', 'stickers', 'images', 'access']) {
    await t.test(`${stage}: ${off}`, async t => {
      const h = await harness(t)
      await h.stickers.importBuffer(Buffer.from('image'), { name: 'x.png', mime: 'image/png' })
      let release, entered
      const waiting = new Promise(resolve => { entered = resolve })
      const gate = new Promise(resolve => { release = resolve })
      if (stage === 'file') {
        const fileFor = h.stickers.fileFor
        t.mock.method(h.stickers, 'fileFor', async id => { entered(); await gate; return fileFor(id) })
      } else {
        const sendMedia = h.media.sendMedia
        t.mock.method(h.media, 'sendMedia', args => sendMedia({ ...args, deliver: async intent => { entered(); await gate; return args.deliver(intent) } }))
      }
      const sending = h.command('/sticker')
      await waiting
      if (off === 'module') await h.kernel.setEnabled(descriptor.manifest.id, false)
      else if (off === 'access') h.config.access.ownerQQ = '99999'
      else if (off === 'media') h.config.media.enabled = false
      else h.config.media[off].enabled = false
      release()
      await sending
      assert.equal(imageIntents(h.sent).length, 0)
    })
  }
})

test('sticker port: images-off denial consumes token even if images are reenabled', async t => {
  const h = await harness(t)
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'x.png', mime: 'image/png' })
  const port = createMediaFeaturesPort({ getConfig: () => h.config, assertActive() {}, media: h.media, stickers: h.stickers,
    access: { canSend: () => ({ allowed: true }) }, delivery: { deliver: async () => { assert.fail('images-off must not deliver') } },
    authorizeStickerSend: () => h.providers.get('mediaFeatures').authorizeStickerSend() })
  await port.withCommand({ chatType: 'private', chatId: '10001' }, async commandToken => {
    h.config.media.images.enabled = false
    await assert.rejects(port.api.stickers.send({ commandToken, stickerId: item.id }), /未启用/)
    h.config.media.images.enabled = true
    await assert.rejects(port.api.stickers.send({ commandToken, stickerId: item.id }), /令牌/)
  })
})

test('media HTTP: library authorization rechecked after service awaits, including images-off previews', async t => {
  for (const method of ['list', 'importBuffer', 'updateTags', 'remove', 'fileFor']) await t.test(method, async t => {
    const h = await harness(t)
    h.config.media.images.enabled = false
    const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'x.png', mime: 'image/png' })
    const original = h.stickers[method]
    t.mock.method(h.stickers, method, async (...args) => {
      const result = await original(...args)
      h.config.media.enabled = false
      return result
    })
    const paths = {
      list: ['/media/stickers'],
      importBuffer: ['/media/stickers/upload', { name: 'y.png', mime: 'image/png', data: 'bmV3' }, 'POST'],
      updateTags: ['/media/stickers/tag', { id: item.id, tags: ['新'] }, 'POST'],
      remove: ['/media/stickers/delete', { id: item.id }, 'POST'],
      fileFor: ['/media/stickers/file?id=' + item.id],
    }
    const response = await h.call(...paths[method])
    assert.equal(response.ok, false)
    assert.doesNotMatch(JSON.stringify(response), new RegExp(h.root))
  })
})

test('media slot and permission: identity fixed, external manifest rejected, media events isolated from reminders', async () => {
  const registry = createProviderRegistry(), events = []
  const provider = { start() {}, stop() {}, bilibili: {}, authorizeStickerLibrary: () => true, authorizeStickerSend: () => true }
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

test('sticker delivery retains actual outbound access/rate/leak/dry-run guards', async t => {
  let allowed = false, rate = false, sends = 0
  const outboundConfig = { cognition: { dryRun: false }, security: { leakGuard: { action: 'block' } } }
  const outbound = createOutbound({ getConfig: () => outboundConfig,
    access: { canSend: () => ({ allowed }) }, policy: { canSend: () => ({ ok: rate }) },
    gateway: { actions: { async sendMessage({ message }) { if (message.some(segment => segment.type === 'image')) sends++; return { message_id: 1 } } } },
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
  // A text-bearing media intent must still pass the real outbound leak guard.
  const sendMedia = h.media.sendMedia
  const mock = t.mock.method(h.media, 'sendMedia', args => sendMedia({ ...args, deliver: intent => args.deliver({
    ...intent, segments: [...intent.segments, { type: 'text', data: { text: 'sk-' + 'Ab1_'.repeat(12) } }],
  }) }))
  await h.command('/sticker')
  assert.equal(sends, 0)
  assert.equal(outbound.stats().leakBlocked, 1)
  mock.mock.restore()
  await h.command('/sticker')
  assert.equal(sends, 1)
  h.config.media.images.enabled = false
  await h.command('/sticker')
  assert.equal(sends, 1)
})

test('sticker port: missing/failed send consumes token and errors never reveal file paths', async t => {
  const h = await harness(t)
  const item = await h.stickers.importBuffer(Buffer.from('image'), { name: 'cat.png', mime: 'image/png' })
  const port = createMediaFeaturesPort({ getConfig: () => h.config, assertActive() {}, media: h.media, stickers: h.stickers,
    access: { canSend: () => ({ allowed: true }) }, delivery: { deliver: async () => ({ ok: true }) }, authorizeStickerSend: () => true })
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


test('media health: setup idle, sync share and remote failure/success have bounded telemetry', async t => {
  let fail = true
  t.mock.method(globalThis, 'fetch', async () => {
    if (fail) throw Error('PRIVATE_REMOTE_ERROR')
    return Response.json({ code: 0, data: { list: [] } })
  })
  const h = await harness(t)
  const read = () => h.kernel.health('builtin-media-features').items[0]
  const provider = h.providers.get('mediaFeatures')
  assert.equal(read().health, 'healthy')
  assert.equal(read().engine.runs, null)
  assert.equal(provider.bilibili.share(BV).bvid, BV)
  assert.equal(read().engine.succeeded, 1)
  await assert.rejects(provider.bilibili.hot())
  assert.equal(read().health, 'degraded')
  assert.equal(read().reasonCode, 'MEDIA_OPERATION_FAILED')
  assert.equal(read().engine.failed, 1)
  fail = false
  await provider.bilibili.hot()
  assert.equal(read().health, 'healthy')
  assert.equal(read().engine.inFlight, 0)
  assert.doesNotMatch(JSON.stringify(read()), /PRIVATE_REMOTE_ERROR/)
})
