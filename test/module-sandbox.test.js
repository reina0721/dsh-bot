import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createModuleKernel } from '../src/modules/kernel.js'
import { validateManifest } from '../src/modules/manifest.js'
import { validateWebuiDescriptor } from '../src/modules/webui.js'
import { createRoutes } from '../src/http/routes.js'
import { MODULE_UI_PREFIX, SANDBOX_CSP, UI_MIME } from '../src/modules/sandbox.js'
import { createFakeDsh } from './helpers/fake-dsh.js'

const descriptor = (entry = 'webui/index.html', hook = 'module.panel') => ({ version: 1, sandbox: { entry }, requestedCapabilities: ['ui.sandbox'], surfaces: [{ id: 'panel', hook, renderer: 'sandbox' }] })
const manifest = (webui = descriptor(), permissions = ['ui:sandbox']) => ({ id: 'external', entry: 'index.mjs', permissions, webui, config: { version: 1, fields: [{ path: 'label', label: '标题', type: 'text', default: 'retained' }] } })
async function harness(t, { permissions = ['ui:sandbox'], webui = descriptor() } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-sandbox-')), dir = join(root, 'external')
  await mkdir(join(dir, 'webui'), { recursive: true })
  await writeFile(join(dir, 'module.json'), JSON.stringify(manifest(webui, permissions)))
  await writeFile(join(dir, 'index.mjs'), 'export function setup() {}')
  await writeFile(join(dir, 'webui', 'index.html'), '<!doctype html><title>隔离</title><script>window.example = true</script>')
  const kernel = createModuleKernel({ dataDir: root, registry: [], getConfig: () => ({}) })
  await kernel.start()
  const fake = createFakeDsh()
  createRoutes({ ctx: fake.ctx, modules: kernel })
  t.after(async () => { await fake.dispose(); await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  const item = () => kernel.uiCatalog().items[0]
  const url = (path = 'index.html', generation = item().generation) => MODULE_UI_PREFIX + 'external/' + generation + '/' + path
  const grant = (enabled = true) => fake.call('/onebot-qq/api/modules/ui/grant', { id: 'external', enabled })
  return { root, dir, kernel, fake, item, url, grant }
}

test('sandbox descriptor: external-only, bounded entry, exactly one safe hook, explicit capability', () => {
  for (const hook of ['module.detail', 'module.panel']) assert.equal(validateWebuiDescriptor(descriptor(undefined, hook), { source: 'external' }).surfaces[0].renderer, 'sandbox')
  assert.throws(() => validateWebuiDescriptor(descriptor(), { source: 'builtin' }))
  for (const entry of ['', '/webui/index.html', '../webui/a.html', 'webui/../a.html', 'webui/.secret.html', 'webui//a.html', 'webui/a\\b.html', 'webui/a\0.html', 'webui/a.js', 'webui/a.HTML', 'webui/%2e%2e/a.html', 'webui/' + 'a'.repeat(250) + '.html', 'webui/' + 'a/'.repeat(9) + 'a.html']) assert.throws(() => validateWebuiDescriptor(descriptor(entry), { source: 'external' }), entry)
  const base = descriptor()
  for (const invalid of [
    { ...base, requestedCapabilities: [] }, { ...base, requestedCapabilities: ['ui.sandbox', 'ui.sandbox'] },
    { ...base, requestedCapabilities: ['host.fetch'] }, { ...base, sandbox: { entry: 'webui/index.html', url: '/host' } },
    { ...base, surfaces: [] }, { ...base, surfaces: [{ ...base.surfaces[0], hook: 'module.card' }] },
    { ...base, surfaces: [{ ...base.surfaces[0], componentKey: 'sample.preview' }] },
    { ...base, surfaces: [...base.surfaces, { id: 'detail', hook: 'module.detail', renderer: 'sandbox' }] },
  ]) assert.throws(() => validateWebuiDescriptor(invalid, { source: 'external' }))
  assert.ok(validateManifest(manifest()).permissions.includes('ui:sandbox'))
  assert.throws(() => validateManifest({ id: 'builtin-test', permissions: ['ui:sandbox'] }, { builtin: true }))
})

test('sandbox grant API: opt-in checks, persistence, restart, disable/revoke, config retained', async (t) => {
  const h = await harness(t)
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
  assert.match(h.item().sandbox.reason, /未授权/)
  assert.equal((await h.grant()).json.ok, true)
  const state = JSON.parse(await readFile(join(h.root, 'state.json'), 'utf8'))
  assert.deepEqual(state.disabled, []); assert.deepEqual(state.enabled, [])
  assert.equal(state.uiGrants.external.id, 'external')
  assert.equal(state.uiGrants.external.uiRevision, h.item().uiRevision)
  assert.equal(state.uiGrants.external.entry, 'webui/index.html')
  assert.match(state.uiGrants.external.artifactHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(h.item().grantedCapabilities, ['ui.sandbox'])
  const second = createModuleKernel({ dataDir: h.root, registry: [], getConfig: () => ({}) })
  await second.start(); assert.deepEqual(second.uiCatalog().items[0].grantedCapabilities, ['ui.sandbox']); await second.dispose()
  const old = h.url()
  await h.kernel.setEnabled('external', false)
  assert.deepEqual(h.item().grantedCapabilities, ['ui.sandbox'])
  assert.equal((await h.fake.call(old, undefined, { method: 'GET' })).status, 404)
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'state.json'), 'utf8')).uiGrants, state.uiGrants)
  await h.kernel.setEnabled('external', true)
  assert.equal((await h.fake.call(old, undefined, { method: 'GET' })).status, 404)
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 200)
  await h.kernel.setModuleConfig('external', { label: 'saved' }, 0)
  assert.equal((await h.grant(false)).json.ok, true)
  assert.deepEqual(h.item().grantedCapabilities, [])
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
  assert.equal((await h.kernel.getModuleConfig('external')).values.label, 'saved')
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'state.json'), 'utf8')).uiGrants, {})
  for (const body of [{ id: 123, enabled: true }, { id: true, enabled: true }, { id: 'external', enabled: 1 }, { id: 'missing', enabled: true }, { id: 'builtin-sample', enabled: true }, { id: '../external', enabled: true }]) {
    const res = await h.fake.call('/onebot-qq/api/modules/ui/grant', body)
    assert.equal(res.json.ok, false); assert.doesNotMatch(res.text, new RegExp(h.root))
  }
  for (const opts of [{ permissions: [] }, { webui: { version: 1 } }]) {
    const other = await harness(t, opts)
    assert.equal((await other.grant()).json.ok, false)
    assert.equal((await other.fake.call(other.url(), undefined, { method: 'GET' })).status, 404)
  }
})

test('sandbox artifacts: grant binds bytes/revision/entry; mutation closes until reload and regrant', async (t) => {
  const h = await harness(t)
  await h.grant()
  const old = h.url()
  await writeFile(join(h.dir, 'webui', 'index.html'), '<p>changed</p>')
  assert.equal((await h.fake.call(old, undefined, { method: 'GET' })).status, 404)
  assert.deepEqual(h.item().grantedCapabilities, [])
  assert.equal((await h.grant()).json.ok, false)
  await h.kernel.reload('external')
  assert.deepEqual(h.item().grantedCapabilities, [])
  assert.equal((await h.grant()).json.ok, true)
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 200)
  const ui = descriptor(); ui.surfaces[0].order = 1
  await writeFile(join(h.dir, 'module.json'), JSON.stringify(manifest(ui)))
  await h.kernel.reload('external')
  assert.deepEqual(h.item().grantedCapabilities, [])
  await h.grant()
  await writeFile(join(h.dir, 'webui', 'other.html'), '<p>other</p>')
  await writeFile(join(h.dir, 'module.json'), JSON.stringify(manifest(descriptor('webui/other.html'))))
  await h.kernel.reload('external')
  assert.deepEqual(h.item().grantedCapabilities, [])
  await h.grant()
  await writeFile(join(h.dir, 'webui', 'extra.js'), 'changed public artifact')
  const catalog = await h.fake.call('/onebot-qq/api/modules/ui', undefined, { method: 'GET' })
  assert.deepEqual(catalog.json.items[0].grantedCapabilities, [])
})

test('sandbox assets: GET/HEAD MIME/CSP, generation, traversal, private files, links and no listings', async (t) => {
  const h = await harness(t)
  for (const ext of Object.keys(UI_MIME)) await writeFile(join(h.dir, 'webui', 'asset' + ext), 'public')
  for (const name of ['.hidden.html', 'secret.json', 'app.js.map', 'config.html.bak']) await writeFile(join(h.dir, 'webui', name), 'private-marker')
  await mkdir(join(h.dir, 'webui', 'data')); await writeFile(join(h.dir, 'webui', 'data', 'secret.html'), 'private-marker')
  await h.kernel.reload('external'); await h.grant()
  for (const [ext, mime] of Object.entries(UI_MIME)) {
    for (const method of ['GET', 'HEAD']) {
      const res = await h.fake.call(h.url('asset' + ext), undefined, { method })
      assert.equal(res.status, 200); assert.equal(res.headers['content-type'], mime)
      assert.equal(res.headers['content-security-policy'], SANDBOX_CSP)
      assert.equal(res.headers['cache-control'], 'no-store'); assert.equal(res.headers['x-content-type-options'], 'nosniff')
      assert.equal(res.headers['referrer-policy'], 'no-referrer')
      assert.equal(res.text, method === 'HEAD' ? '' : 'public')
    }
  }
  for (const path of ['', '.hidden.html', 'secret.json', 'app.js.map', 'config.html.bak', 'data/secret.html', '%2e%2e%2fconfig.json', '%252e%252e/index.html', 'a%5cindex.html', 'a%00.html', '%ZZ.html', '%2findex.html', 'sub/../index.html', 'https://evil/index.html']) {
    const res = await h.fake.call(h.url(path), undefined, { method: 'GET' })
    assert.equal(res.status, 404, path); assert.equal(res.text, 'Not found'); assert.doesNotMatch(res.text, /private-marker|dsh-sandbox/)
  }
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) assert.equal((await h.fake.call(h.url(), {}, { method })).status, 404)
  for (const target of [join(h.dir, 'webui', 'index.html'), join(h.dir, 'config.json')]) {
    await symlink(target, join(h.dir, 'webui', 'link.html'))
    assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
    await unlink(join(h.dir, 'webui', 'link.html'))
    await h.kernel.reload('external'); await h.grant()
  }
  await mkdir(join(h.dir, 'webui', 'nested'))
  await symlink(join(h.dir, 'webui', 'nested'), join(h.dir, 'webui', 'alias'), 'dir')
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
})

test('sandbox grant/state write failure preserves access state; malformed saved grant fails closed', async (t) => {
  const h = await harness(t)
  await mkdir(join(h.root, 'state.json'))
  assert.equal((await h.grant()).json.code, 'MODULE_UI_WRITE_FAILED')
  assert.deepEqual(h.item().grantedCapabilities, [])
  await rm(join(h.root, 'state.json'), { recursive: true })
  await h.grant()
  await rm(join(h.root, 'state.json')); await mkdir(join(h.root, 'state.json'))
  assert.equal((await h.grant(false)).json.code, 'MODULE_UI_WRITE_FAILED')
  assert.deepEqual(h.item().grantedCapabilities, ['ui.sandbox'])
  await rm(join(h.root, 'state.json'), { recursive: true })
  await writeFile(join(h.root, 'state.json'), JSON.stringify({ uiGrants: { external: { id: 'external', uiRevision: 'forged' } } }))
  const kernel = createModuleKernel({ dataDir: h.root, registry: [] })
  await kernel.start(); assert.deepEqual(kernel.uiCatalog().items[0].grantedCapabilities, []); await kernel.dispose()
})

test('opaque browser contexts and subresource/frame navigation cannot invoke host APIs', async (t) => {
  const h = await harness(t)
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-dest': 'iframe' }, { 'sec-fetch-dest': 'frame' }, { 'sec-fetch-dest': 'script' }, { 'sec-fetch-dest': 'image' }, { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-origin', origin: 'null' }, { 'sec-fetch-dest': 'object' }]) {
    const grant = await h.fake.call('/onebot-qq/api/modules/ui/grant', { id: 'external', enabled: true }, { headers })
    assert.equal(grant.status, 403); assert.deepEqual(h.item().grantedCapabilities, [])
    const catalog = await h.fake.call('/onebot-qq/api/modules/ui', undefined, { method: 'GET', headers })
    assert.equal(catalog.status, 403)
  }
  const allowed = await h.fake.call('/onebot-qq/api/modules/ui/grant', { id: 'external', enabled: true }, { headers: { origin: 'http://dsh-fake.local', 'sec-fetch-dest': 'empty' } })
  assert.equal(allowed.json.ok, true)
  // Existing core sticker previews are same-origin image requests, not opaque UI.
  createRoutes({ ctx: h.fake.ctx, providerRegistry: { get: name => name === 'mediaFeatures' ? { authorizeStickerLibrary: () => true } : null }, stickers: { fileFor: async () => ({ mime: 'image/png', path: join(h.dir, 'webui', 'index.html') }) } })
  const imagePath = '/onebot-qq/api/media/stickers/file?id=example'
  const image = await h.fake.call(imagePath, undefined, { method: 'GET', headers: { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'same-origin' } })
  assert.equal(image.status, 200); assert.equal(image.headers['content-type'], 'image/png')
  for (const headers of [{ origin: 'null' }, { 'sec-fetch-dest': 'image', 'sec-fetch-site': 'cross-site' }]) {
    assert.equal((await h.fake.call(imagePath, undefined, { method: 'GET', headers })).status, 403)
  }
})

test('sandbox artifacts: bounded file/count/depth and replaced webui directory fail closed', async (t) => {
  const h = await harness(t)
  await h.grant()
  await writeFile(join(h.dir, 'webui', 'large.js'), Buffer.alloc(2 * 1024 * 1024 + 1))
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
  await unlink(join(h.dir, 'webui', 'large.js'))
  for (let i = 0; i < 128; i++) await writeFile(join(h.dir, 'webui', 'f' + i + '.js'), '')
  await h.kernel.reload('external'); assert.equal((await h.grant()).json.ok, false)
  for (let i = 0; i < 128; i++) await unlink(join(h.dir, 'webui', 'f' + i + '.js'))
  const nested = join(h.dir, 'webui', ...Array(9).fill('nested'))
  await mkdir(nested, { recursive: true }); await writeFile(join(nested, 'deep.html'), '')
  await h.kernel.reload('external'); assert.equal((await h.grant()).json.ok, false)
  await rm(join(h.dir, 'webui', 'nested'), { recursive: true })
  await h.kernel.reload('external'); await h.grant()
  await rm(join(h.dir, 'webui'), { recursive: true })
  const outside = join(h.root, 'public-copy'); await mkdir(outside); await writeFile(join(outside, 'index.html'), '<p>escape</p>')
  await symlink(outside, join(h.dir, 'webui'), 'dir')
  assert.equal((await h.fake.call(h.url(), undefined, { method: 'GET' })).status, 404)
})
