import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinRegistry } from '../src/modules/registry.js'
import { createModuleKernel } from '../src/modules/kernel.js'
import { validateConfigSchema } from '../src/modules/config.js'
import { BUILTIN_COMPONENT_KEYS, MAX_UI_BYTES, UI_HOOKS, loadWebuiDescriptor, validateWebuiDescriptor } from '../src/modules/webui.js'

const surface = (hook = 'module.detail', extra = {}) => ({ id: 'detail', hook, renderer: 'status', ...extra })
const descriptor = (extra = {}) => ({ version: 1, surfaces: [surface()], ...extra })
const configSchema = validateConfigSchema({ version: 1, fields: [{ path: 'message', type: 'text', label: '回复', default: 'private-default-marker' }] })
const validate = (raw, source = 'external', schema = null) => validateWebuiDescriptor(raw, { source, configSchema: schema })

test('WebUI builtin-react: frozen compile-time allowlist and strict source/key matrix', () => {
  assert.ok(Object.isFrozen(BUILTIN_COMPONENT_KEYS))
  assert.deepEqual(BUILTIN_COMPONENT_KEYS, ['reply-delivery.preview', 'typing.preview', 'reminders.preview', 'sample.preview', 'media-features.preview', 'media-features.panel'])
  const react = (componentKey) => descriptor({ surfaces: [surface('module.detail', { renderer: 'builtin-react', componentKey })] })
  for (const key of BUILTIN_COMPONENT_KEYS) {
    assert.equal(validate(react(key), 'builtin').surfaces[0].componentKey, key)
    assert.throws(() => validate(react(key), 'external'), /MODULE_UI_INVALID/)
    for (const renderer of ['status', 'schema']) {
      assert.throws(() => validate(descriptor({ surfaces: [surface('module.detail', { renderer, componentKey: key })] }), 'builtin'), /MODULE_UI_INVALID/)
    }
  }
  for (const key of [undefined, null, 1, '', 'unknown.preview', 'Sample.preview', '../sample.preview', 'sample.preview/evil', 'a'.repeat(32) + '.' + 'b'.repeat(32), () => 'sample.preview']) {
    assert.throws(() => validate(react(key), 'builtin'), /MODULE_UI_INVALID/)
  }
  let executed = false
  const getter = { id: 'detail', hook: 'module.detail', renderer: 'builtin-react', get componentKey() { executed = true; return 'sample.preview' } }
  assert.throws(() => validate(descriptor({ surfaces: [getter] }), 'builtin'), /MODULE_UI_INVALID/)
  assert.equal(executed, false)
  const duplicate = react('sample.preview')
  duplicate.surfaces.push({ ...duplicate.surfaces[0], id: 'duplicate' })
  assert.throws(() => validate(duplicate, 'builtin'), /MODULE_UI_INVALID/)
})

async function harness(t, registry = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-webui-'))
  const kernel = createModuleKernel({ dataDir: root, registry, getConfig() { throw Error('catalog must not read core config') } })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  const external = async (id, webui, extra = {}, code = 'export function setup() {}') => {
    const dir = join(root, id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', webui, ...extra }))
    await writeFile(join(dir, 'index.mjs'), code)
    return dir
  }
  return { root, kernel, external, item: (id) => kernel.uiCatalog().items.find((row) => row.moduleId === id) }
}

test('WebUI v1: five hooks, unique contribution, bounded order and fresh metadata', () => {
  const raw = descriptor({ surfaces: UI_HOOKS.map((hook, i) => surface(hook, { id: 's' + i, renderer: i % 2 ? 'schema' : 'status', order: 100 - i * 50 })) })
  const ui = validate(raw, 'external', configSchema)
  assert.equal(ui.surfaces.length, 5)
  assert.deepEqual(ui.surfaces.map((item) => item.order), [-100, -50, 0, 50, 100])
  assert.deepEqual(ui.config, { binding: 'none', schemaVersion: null, available: false })
  assert.deepEqual(ui.requestedCapabilities, [])
  ui.surfaces[0].id = 'changed'
  assert.notEqual(validate(raw, 'external', configSchema).surfaces[0].id, 'changed')
  assert.equal(validate(descriptor()).surfaces[0].order, 0)
})

test('WebUI v1: strict JSON, version, size, ids, hooks, renderers and capability denial', () => {
  assert.equal(MAX_UI_BYTES, 65536)
  const invalid = [
    null, [], 'script', {}, descriptor({ version: '1' }), descriptor({ version: 2 }),
    descriptor({ componentKey: 'evil' }), descriptor({ sandbox: {} }), descriptor({ exports: {} }),
    descriptor({ values: { secret: 'secret' } }), descriptor({ schema: { default: 'secret' } }),
    descriptor({ surfaces: {} }), descriptor({ surfaces: Array(6).fill(surface()) }),
    descriptor({ surfaces: [surface(), surface('module.config')] }),
    descriptor({ surfaces: [surface(), surface('module.detail', { id: 'other' })] }),
    ...['main', 'sidebar.panellist', 'module.unknown'].map((hook) => descriptor({ surfaces: [surface(hook)] })),
    ...['builtin-react', 'sandbox', 'html', 'unknown'].map((renderer) => descriptor({ surfaces: [surface('module.detail', { renderer })] })),
    ...[-101, 101, 0.5, '0', null].map((order) => descriptor({ surfaces: [surface('module.detail', { order })] })),
    ...['../secret', '/tmp/private', 'a'.repeat(65), ''].map((id) => descriptor({ surfaces: [surface('module.detail', { id })] })),
    descriptor({ surfaces: [surface('module.detail', { componentKey: 'evil' })] }),
    descriptor({ surfaces: [surface('module.detail', { sandbox: 'https://evil.invalid' })] }),
    descriptor({ requestedCapabilities: ['config:read'] }), descriptor({ requestedCapabilities: ['unknown'] }),
    descriptor({ requestedCapabilities: {} }), descriptor({ grantedCapabilities: [] }),
    descriptor({ surfaces: [surface('module.detail', { order: NaN })] }),
    descriptor({ padding: '密'.repeat(MAX_UI_BYTES / 2) }),
  ]
  for (const raw of invalid) {
    for (const source of ['builtin', 'external']) assert.throws(() => validate(raw, source), /MODULE_UI_INVALID/)
  }
  let executed = false
  for (const raw of [
    { ...descriptor(), toJSON() { executed = true; return descriptor() } },
    { get version() { executed = true; return 1 }, surfaces: [] },
    descriptor({ surfaces: [surface('module.detail', { renderer() { executed = true } })] }),
  ]) assert.throws(() => validate(raw), /MODULE_UI_INVALID/)
  assert.equal(executed, false)
  assert.throws(() => validateWebuiDescriptor(descriptor()), /MODULE_UI_INVALID/)
})

test('WebUI config is metadata only; no external grant or legacy ownership spoof', () => {
  const config = { binding: 'module-file', schemaVersion: 1, available: false }
  assert.deepEqual(validate(descriptor({ config })).config, config)
  for (const patch of [
    { binding: 'unknown' }, { binding: 'legacy-core' }, { available: true },
    { schemaVersion: 0 }, { schemaVersion: '1' }, { values: { secret: 'secret' } },
    { schema: {} }, { path: '/private/config.json' },
  ]) assert.throws(() => validate(descriptor({ config: { ...config, ...patch } })), /MODULE_UI_INVALID/)
  const legacy = { binding: 'legacy-core', schemaVersion: 1, available: true }
  assert.deepEqual(validateWebuiDescriptor(descriptor({ config: legacy }), { source: 'builtin' }).config, legacy)
  assert.throws(() => validate(descriptor({ config: legacy })), /MODULE_UI_INVALID/)
  assert.throws(() => validate(descriptor({ config: { binding: 'none', schemaVersion: 1, available: false } })), /MODULE_UI_INVALID/)
})

test('WebUI external config requires validated schema; no React/componentKey/sandbox grant even with config', async (t) => {
  const config = { binding: 'module-file', schemaVersion: 1, available: true }
  const webui = descriptor({ config, surfaces: [surface(), surface('module.config', { id: 'config', renderer: 'schema' })] })
  assert.deepEqual(validate(webui, 'external', configSchema).config, config)
  assert.throws(() => validate(webui), /MODULE_UI_INVALID/)
  assert.throws(() => validate(descriptor({ surfaces: [surface('module.config', { renderer: 'schema' })] })), /MODULE_UI_INVALID/)
  assert.throws(() => validate({ ...webui, config: { ...config, schemaVersion: 2 } }, 'external', configSchema), /MODULE_UI_INVALID/)
  const h = await harness(t)
  await h.external('configured', webui, { config: configSchema })
  await h.external('no-schema', webui)
  await h.external('no-webui', undefined, { config: configSchema })
  const invalid = [
    { ...webui, componentKey: 'sample.preview' }, { ...webui, sandbox: {} },
    { ...webui, surfaces: [surface('module.detail', { renderer: 'builtin-react', componentKey: 'sample.preview' })] },
    { ...webui, surfaces: [surface('module.config', { renderer: 'schema', componentKey: 'sample.preview' })] },
    { ...webui, surfaces: [surface('module.detail', { renderer: 'sandbox' })] },
  ]
  for (const [i, ui] of invalid.entries()) await h.external('invalid-' + i, ui, { config: configSchema })
  await h.kernel.start()
  assert.deepEqual(h.item('configured').config, config)
  assert.equal(h.item('configured').trust, 'external')
  assert.ok(h.item('configured').surfaces.some(surface => surface.hook === 'module.config' && surface.renderer === 'schema'))
  for (const id of ['no-schema', 'no-webui', ...invalid.map((_, i) => 'invalid-' + i)]) {
    assert.equal(h.item(id).status, 'loaded')
    assert.equal(h.item(id).config.available, false)
    assert.deepEqual(h.item(id).surfaces, [])
    assert.equal(h.item(id).uiWarning, id === 'no-webui' ? '' : 'MODULE_UI_INVALID')
  }
  const catalog = h.kernel.uiCatalog()
  await h.kernel.setModuleConfig('configured', { message: 'private-value-marker' }, 0)
  assert.deepEqual(h.kernel.uiCatalog(), catalog)
  assert.doesNotMatch(JSON.stringify(catalog), /private-value-marker|private-default-marker|values|fields|default|config\.json|componentKey/)
  assert.ok(!JSON.stringify(catalog).includes(h.root))
})

test('WebUI built-in registry catalog includes disabled sample; no import/config read on catalog', async (t) => {
  let imports = 0
  const registry = builtinRegistry.map((row) => ({ ...row, defaultEnabled: false, load() { imports++; throw Error('must not import') } }))
  const h = await harness(t, registry)
  const dir = join(h.root, '.builtin', 'builtin-sample')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'config.json'), JSON.stringify({ version: 1, revision: 2, values: { message: 'private-config-marker' } }))
  await h.kernel.start()
  const catalog = h.kernel.uiCatalog()
  assert.equal(catalog.version, 1)
  assert.equal(catalog.items.length, 5)
  for (const item of catalog.items) {
    assert.equal(item.status, 'disabled')
    assert.equal(item.source, 'builtin'); assert.equal(item.trust, 'builtin')
    assert.equal(typeof item.generation, 'string'); assert.match(item.uiRevision, /^[a-f0-9]{64}$/)
    assert.deepEqual(item.surfaces.map((row) => row.hook), item.moduleId === 'builtin-media-features' ? ['module.detail', 'module.config', 'module.panel'] : ['module.detail', 'module.config'])
    assert.equal(item.surfaces[0].renderer, 'builtin-react')
    assert.equal(item.surfaces[0].componentKey, item.moduleId.slice('builtin-'.length) + '.preview')
    assert.equal(item.surfaces[1].renderer, 'schema')
    assert.equal(Object.hasOwn(item.surfaces[1], 'componentKey'), false)
    assert.deepEqual(item.requestedCapabilities, []); assert.deepEqual(item.grantedCapabilities, [])
    assert.equal(item.uiWarning, '')
    assert.deepEqual(item.config, { binding: item.moduleId === 'builtin-sample' ? 'module-file' : 'legacy-core', schemaVersion: 1, available: true })
  }
  assert.equal(imports, 0)
  assert.ok(!JSON.stringify(catalog).includes(h.root))
  assert.doesNotMatch(JSON.stringify(catalog), /private-config-marker|config\.json|entry|values|fields|default/)
  await rm(h.root, { recursive: true })
  assert.deepEqual(h.kernel.uiCatalog(), catalog) // No rescan, module/config file reads or imports.
  catalog.items[0].surfaces[0].id = 'mutated'
  catalog.items[0].config.binding = 'mutated'
  assert.notEqual(h.kernel.uiCatalog().items[0].surfaces[0].id, 'mutated')
  assert.notEqual(h.kernel.uiCatalog().items[0].config.binding, 'mutated')
})

test('WebUI external opt-in/denial is independent of valid backend module lifecycle', async (t) => {
  const h = await harness(t)
  await h.external('opt-in', descriptor(), { source: 'builtin', builtin: true })
  await h.external('opt-out', undefined)
  await h.external('invalid', descriptor({ componentKey: '/private/secret-marker' }))
  await h.external('too-large', descriptor({ padding: 'x'.repeat(MAX_UI_BYTES + 1) }))
  await h.external('react-spoof', descriptor({ surfaces: [surface('module.detail', { renderer: 'builtin-react', componentKey: 'sample.preview' })] }), { source: 'builtin', builtin: true })
  const disabledDir = await h.external('disabled', descriptor(), { enabled: false }, 'throw Error("disabled code imported")')
  await h.kernel.start()
  for (const id of ['opt-in', 'opt-out', 'invalid', 'too-large']) assert.equal(h.item(id).status, 'loaded')
  assert.equal(h.item('opt-in').trust, 'external')
  assert.equal(h.item('opt-in').surfaces.length, 1)
  assert.deepEqual(h.item('opt-out').surfaces, []); assert.equal(h.item('opt-out').uiWarning, '')
  for (const id of ['invalid', 'too-large', 'react-spoof']) {
    assert.equal(h.item(id).status, 'loaded')
    assert.deepEqual(h.item(id).surfaces, []); assert.equal(h.item(id).uiWarning, 'MODULE_UI_INVALID')
    assert.deepEqual(h.item(id).config, { binding: 'none', schemaVersion: null, available: false })
  }
  assert.equal(h.item('disabled').status, 'disabled'); assert.equal(h.item('disabled').surfaces.length, 1)
  await rm(disabledDir, { recursive: true })
  assert.equal(h.item('disabled').surfaces.length, 1)
  assert.ok(!JSON.stringify(h.kernel.uiCatalog()).includes(h.root))
  assert.doesNotMatch(JSON.stringify(h.kernel.uiCatalog()), /secret-marker|index\.mjs|componentKey/)
})

test('WebUI generations/revisions survive reads, change on activation/reload, never reuse old UI', async (t) => {
  const h = await harness(t)
  await h.external('external', descriptor())
  await h.kernel.start()
  const first = h.item('external'), firstCatalog = h.kernel.uiCatalog()
  assert.deepEqual(h.kernel.uiCatalog(), firstCatalog)
  assert.equal(h.kernel.list()[0].generation, first.generation)
  assert.equal(h.kernel.list()[0].uiRevision, first.uiRevision)
  await h.kernel.setEnabled('external', false)
  assert.equal(h.item('external').status, 'disabled')
  assert.equal(h.item('external').surfaces.length, 1)
  assert.notEqual(h.kernel.uiCatalog().catalogRevision, firstCatalog.catalogRevision)
  await h.kernel.setEnabled('external', true)
  const active = h.item('external')
  assert.notEqual(active.generation, first.generation); assert.equal(active.uiRevision, first.uiRevision)
  await h.kernel.reload('external')
  assert.notEqual(h.item('external').generation, active.generation)
  assert.equal(h.item('external').uiRevision, first.uiRevision)
  await h.external('external', descriptor({ surfaces: [surface('module.config', { renderer: 'schema' })] }), { config: configSchema })
  await h.kernel.reload('external')
  assert.notEqual(h.item('external').uiRevision, first.uiRevision)
  await h.external('external', descriptor({ sandbox: {} }))
  await h.kernel.reload('external')
  assert.deepEqual(h.item('external').surfaces, [])
  assert.equal(h.item('external').uiRevision, 'invalid')
  const invalidGeneration = h.item('external').generation
  await h.external('external', descriptor(), { entry: '../outside.mjs' })
  await h.kernel.reload('external')
  assert.notEqual(h.item('external').generation, invalidGeneration)
  assert.equal(h.item('external').status, 'error')
  assert.deepEqual(h.item('external').surfaces, [])
  assert.deepEqual(first, firstCatalog.items[0])
})

test('WebUI built-in activation has fresh generation; config value revision is separate', async (t) => {
  const sample = builtinRegistry.find((row) => row.manifest.id === 'builtin-sample')
  const h = await harness(t, [{ ...sample, load: () => ({ setup() {} }) }])
  await h.kernel.start()
  const initial = h.item(sample.manifest.id), catalog = h.kernel.uiCatalog()
  await h.kernel.setModuleConfig(initial.moduleId, { message: 'secret-changed-value' }, 0)
  assert.deepEqual(h.kernel.uiCatalog(), catalog)
  await h.kernel.setEnabled(initial.moduleId, true)
  const active = h.item(initial.moduleId)
  assert.notEqual(active.generation, initial.generation)
  assert.equal(active.uiRevision, initial.uiRevision)
  await h.kernel.setEnabled(initial.moduleId, false)
  await h.kernel.setEnabled(initial.moduleId, true)
  assert.notEqual(h.item(initial.moduleId).generation, active.generation)
  assert.doesNotMatch(JSON.stringify(h.kernel.uiCatalog()), /secret-changed-value/)
})

test('WebUI malformed built-in UI falls back; warnings never echo hostile data', async (t) => {
  const sample = builtinRegistry[3]
  const h = await harness(t, [{ ...sample, defaultEnabled: true, ui: descriptor({ componentKey: '/private/secret' }), load: () => ({ setup() {} }) }])
  await h.kernel.start()
  const item = h.item(sample.manifest.id)
  assert.equal(item.status, 'loaded'); assert.equal(item.uiWarning, 'MODULE_UI_INVALID')
  assert.deepEqual(item.surfaces, [])
  assert.deepEqual(loadWebuiDescriptor(undefined, { source: 'external' }), { ui: null, uiRevision: 'none', uiWarning: '' })
  assert.doesNotMatch(JSON.stringify(item), /private|secret/)
})

test('WebUI dependency reload/disable recycles runtime generation, including built-in dependents', async (t) => {
  const sample = builtinRegistry[3]
  const h = await harness(t, [{ ...sample, manifest: { ...sample.manifest, requires: ['root'] }, defaultEnabled: true, load: () => ({ setup() {} }) }])
  await h.external('root', descriptor())
  await h.kernel.start()
  const first = h.item(sample.manifest.id)
  await h.kernel.reload('root')
  const second = h.item(sample.manifest.id)
  assert.notEqual(second.generation, first.generation)
  assert.equal(second.uiRevision, first.uiRevision)
  await h.kernel.setEnabled('root', false)
  assert.equal(h.item(sample.manifest.id).status, 'blocked')
  await h.kernel.setEnabled('root', true)
  assert.notEqual(h.item(sample.manifest.id).generation, second.generation)
  assert.equal(h.item(sample.manifest.id).uiRevision, first.uiRevision)
})
