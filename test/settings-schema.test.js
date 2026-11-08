import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { CONFIG_GROUPS, DEFAULTS } from '../src/core/config.js'
import { builtinRegistry } from '../src/modules/registry.js'
import {
  OWNER_CLASSES, APPLY_BEHAVIORS, NAVIGATION_REGISTRY, SETTINGS_FIELDS, SETTINGS_GROUPS,
  LEGACY_TABS, LEGACY_COGNITION_SECTIONS, LEGACY_CONFIG_GROUPS, LEGACY_ANCHORS,
  LEGACY_MODULE_IDS, LEGACY_SETTINGS_SECTIONS, OPERATION_CONTRACTS, validateSettingsSchema,
} from '../src/core/settings-schema.js'

const leaves = (object, prefix = '') => Object.entries(object).flatMap(([key, value]) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? leaves(value, `${prefix}${key}.`) : [`${prefix}${key}`])
const fields = new Map(SETTINGS_FIELDS.map(field => [field.path, field]))
const sorted = items => [...items].sort()
const clientSource = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

test('complete config.js inventory: 31 groups, 291 panel fields, all 310 config leaves', () => {
  assert.equal(CONFIG_GROUPS.length, 31)
  assert.equal(CONFIG_GROUPS.filter(group => group.id.startsWith('cog-')).length, 17)
  assert.deepEqual(sorted(Object.keys(LEGACY_CONFIG_GROUPS)), sorted(CONFIG_GROUPS.map(group => group.id)))
  const panelPaths = CONFIG_GROUPS.flatMap(group => group.fields.map(field => field.path))
  assert.equal(panelPaths.length, 291)
  assert.equal(new Set(panelPaths).size, panelPaths.length)
  assert.deepEqual(sorted(SETTINGS_FIELDS.filter(field => field.exposure === 'panel').map(field => field.path)), sorted(panelPaths))
  assert.deepEqual(sorted(SETTINGS_FIELDS.filter(field => field.storage === 'config.json').map(field => field.path)), sorted(leaves(DEFAULTS)))
  assert.equal(leaves(DEFAULTS).length, 310)
  for (const group of CONFIG_GROUPS) for (const spec of group.fields) {
    const field = fields.get(spec.path)
    assert.ok(field, spec.path)
    assert.equal(field.legacyGroup, group.id, spec.path)
    assert.ok(field.aliases.includes(`group:${group.id}/${spec.path}`), spec.path)
    assert.equal(field.canonical.moduleId, spec.module, spec.path)
    assert.equal(field.ownerClass === 'module', Boolean(spec.module), spec.path)
    assert.equal(field.sensitivity === 'secret', spec.type === 'secret', spec.path)
  }
})

test('every current module ID and module-file field has one owner', () => {
  assert.deepEqual(sorted(LEGACY_MODULE_IDS), sorted(builtinRegistry.map(entry => entry.manifest.id)))
  const actual = builtinRegistry.flatMap(entry => (entry.config?.fields || []).map(spec => `modules.${entry.manifest.id}.${spec.path}`))
  assert.deepEqual(sorted(SETTINGS_FIELDS.filter(field => field.storage === 'module-file').map(field => field.path)), sorted(actual))
  for (const path of actual) {
    assert.equal(fields.get(path).ownerClass, 'module')
    assert.equal(fields.get(path).scope, 'module')
  }
})

test('canonical groups partition all fields without duplicate system/profile/module editing owners', () => {
  assert.deepEqual(OWNER_CLASSES, ['system', 'profile', 'module', 'operation'])
  assert.equal(validateSettingsSchema().fields, 311)
  const grouped = SETTINGS_GROUPS.flatMap(group => group.fields)
  assert.equal(new Set(grouped).size, grouped.length)
  assert.deepEqual(sorted(grouped), sorted(fields.keys()))
  assert.equal(fields.get('media.images.enabled').ownerClass, 'system')
  assert.equal(fields.get('media.stickers.enabled').canonical.moduleId, 'builtin-media-features')
  assert.equal(fields.get('cognition.reply.split').canonical.moduleId, 'builtin-reply-delivery')
  assert.equal(fields.get('cognition.notice.patReply').ownerClass, 'profile')
  assert.equal(fields.get('cognition.llm.dailyTokenBudget').ownerClass, 'system')
  assert.equal(fields.get('cognition.llm.personaDailyTokenBudget').ownerClass, 'profile')
  assert.equal(fields.get('cognition.debug.trace').ownerClass, 'system')
  for (const field of SETTINGS_FIELDS) assert.ok(APPLY_BEHAVIORS.includes(field.apply))
})

test('validator rejects duplicate fields, aliases, cross-owner groups, missing fields and invalid metadata', () => {
  const cloneFields = () => structuredClone(SETTINGS_FIELDS)
  const cloneGroups = () => structuredClone(SETTINGS_GROUPS)
  assert.throws(() => validateSettingsSchema([...SETTINGS_FIELDS, SETTINGS_FIELDS[0]]), /field owner/)
  let next = cloneFields()
  next[1].aliases.push(next[0].aliases[0])
  assert.throws(() => validateSettingsSchema(next), /field alias/)
  let groups = cloneGroups()
  groups[1].fields.push(groups[0].fields[0])
  assert.throws(() => validateSettingsSchema(SETTINGS_FIELDS, groups), /group owner/)
  groups = cloneGroups()
  groups[0].fields.pop()
  assert.throws(() => validateSettingsSchema(SETTINGS_FIELDS, groups), /missing canonical/)
  assert.throws(() => validateSettingsSchema(SETTINGS_FIELDS, [...SETTINGS_GROUPS, SETTINGS_GROUPS[0]]), /owner group/)
  for (const patch of [{ ownerClass: 'operation' }, { scope: 'unknown' }, { apply: 'unknown' },
    { sensitivity: 'unknown' }, { value: 'forbidden runtime payload' }, { canonical: { area: 'unknown', section: 'general' } },
    { canonical: { area: 'extensions', section: 'module', moduleId: 'fake-owner' } }]) {
    next = cloneFields()
    Object.assign(next[0], patch)
    assert.throws(() => validateSettingsSchema(next), /metadata/)
  }
})

test('schema contains metadata only, is deeply immutable, and distinguishes secrets from references', () => {
  const check = value => {
    if (!value || typeof value !== 'object') return
    assert.ok(Object.isFrozen(value))
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!['value', 'values', 'default', 'token', 'apiKey'].includes(key), key)
      check(child)
    }
  }
  check(SETTINGS_FIELDS)
  check(SETTINGS_GROUPS)
  check(NAVIGATION_REGISTRY)
  assert.equal(fields.get('onebot.wsToken').sensitivity, 'secret')
  assert.equal(fields.get('media.images.visionApiKeyEnv').sensitivity, 'secret-reference')
  assert.equal(fields.get('cognition.memory.embedding.apiKeyEnv').sensitivity, 'secret-reference')
  assert.equal(fields.get('cognition.persona.profile.identity').sensitivity, 'private')
  assert.equal(fields.get('onebot.wsToken').apply, 'gateway-reconnect')
  assert.equal(fields.get('reconnect.factor').apply, 'next-use')
  assert.equal(fields.get('cognition.reminders.tickMs').apply, 'module-restart')
  for (const path of ['version', 'cognition.delivery.engine', 'cognition.turn.addressedOnlyGroups']) {
    assert.equal(fields.get(path).apply, 'read-only')
  }
  assert.equal(new Set(OPERATION_CONTRACTS.map(item => item.id)).size, OPERATION_CONTRACTS.length)
  assert.ok(OPERATION_CONTRACTS.every(item => item.ownerClass === 'operation' && item.scope === 'request' && item.apply === 'explicit-action'))
})

test('registry matches every live tab, cognition subsection, settings category and static anchor', () => {
  const extractIds = name => [...clientSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\n    \\]`))[1].matchAll(/\bid: '([^']+)'/g)].map(match => match[1])
  assert.match(clientSource, /const TABS = NAVIGATION_REGISTRY.map/)
  assert.equal(Object.keys(LEGACY_TABS).length, 15)
  assert.deepEqual(sorted(Object.keys(LEGACY_COGNITION_SECTIONS)), sorted(extractIds('COG_SECTIONS')))
  assert.equal(Object.keys(LEGACY_COGNITION_SECTIONS).length, 15)
  assert.deepEqual(sorted(Object.keys(LEGACY_SETTINGS_SECTIONS)), sorted(extractIds('SETTINGS_CATEGORY_DEFS')))
  const anchors = [...clientSource.matchAll(/\bid: '(ob-(?:media|cog|module)-[^']+)'(?!\s*\+)/g)].map(match => match[1])
  for (const anchor of anchors) assert.ok(Object.hasOwn(LEGACY_ANCHORS, anchor), anchor)
  assert.ok(clientSource.includes("id: 'ob-cog-decision-' + item.id"))
  assert.ok(clientSource.includes("id: 'ob-cog-task-' + task.id"))
  for (const area of NAVIGATION_REGISTRY) for (const section of area.sections) {
    for (const component of section.components) assert.ok(clientSource.includes(`function ${component}(`), component)
  }
})

test('six-area metadata stays pure; DSH registration remains main and sidebar.panellist', () => {
  assert.deepEqual(NAVIGATION_REGISTRY.map(area => area.label), [
    'Overview', 'Chat & Sandbox', 'Profiles', 'Extensions', 'Data & Logs', 'System',
  ])
  assert.equal(new Set(NAVIGATION_REGISTRY.map(area => area.id)).size, 6)
  for (const area of NAVIGATION_REGISTRY) assert.equal(new Set(area.sections.map(section => section.id)).size, area.sections.length)
  assert.deepEqual(NAVIGATION_REGISTRY.find(area => area.id === 'chat').sections.find(section => section.id === 'sandbox'),
    { id: 'sandbox', components: ['SandboxChat'], availability: 'existing' })
  for (const file of ['settings-schema.js', 'navigation.js']) {
    const source = readFileSync(new URL(`../src/core/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /slots\.(?:register|inject)|window\.|document\./)
  }
  let entry
  runInNewContext(clientSource, { window: { __ModuleLoader__: { load(value) { entry = value } } } })
  const client = entry.factory(() => ({ createElement() {}, createContext: () => ({}), Component: class {}, Fragment: 'fragment' }))
  const registrations = []
  const slots = { inject(name, register) { register() }, register(def) { registrations.push(def.name) } }
  client.apply({ get: name => name === 'slots' ? slots : undefined, effect() {} })
  assert.deepEqual(registrations, ['main', 'sidebar.panellist'])
})

test('C03 embedded client navigation is reproducible from the shared contracts', () => {
  execFileSync(process.execPath, ['scripts/sync-client-navigation.mjs', '--check'], { cwd: new URL('..', import.meta.url) })
})
