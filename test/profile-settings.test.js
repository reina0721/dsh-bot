import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore } from '../src/cognition/store.js'
import { createPersonaService } from '../src/cognition/persona.js'
import { scopedPersonaKind, dropPersonaData } from '../src/cognition/persona-scope.js'
import { defaultConfig, normalizeConfig, getPath, refreshSecrets } from '../src/core/config.js'
import { SETTINGS_FIELDS } from '../src/core/settings-schema.js'
import { createProfileSettings, PROFILE_MIGRATION_KEY, snapshotProfile } from '../src/core/profile-settings.js'

const clock = { now: () => 123456 }
function setup(store = createStore({ file: ':memory:' }), input = defaultConfig()) {
  let config = input
  let settings
  const getConfig = () => config
  const setConfig = next => { config = normalizeConfig(next).config; refreshSecrets(config); return { config, issues: [] } }
  refreshSecrets(config)
  const persona = createPersonaService({ store, getConfig, clock, settingsHooks: {
    created: (id, from) => { if (settings?.status().editingAvailable) settings.initialize(id, from) },
  } })
  persona.ensure()
  const service = () => createProfileSettings({ store, persona, getConfig, setConfig, clock })
  settings = service()
  return { store, persona, settings, getConfig, setConfig, service }
}
const profileRecord = (store, id = 'self') => store.get(scopedPersonaKind(id, 'profile_settings'), 'config')
const profileView = (s, id = 'self') => s.view({ scope: 'profile', id })
const save = (s, patch, id = 'self') => s.patch({ scope: 'profile', id, revision: profileView(s, id).revision, patch })
const code = expected => error => error.code === expected && error.message === expected

test('C02 migration snapshots every persona effective behavior, with exhaustive sole ownership and immutable sources', t => {
  const h = setup(); t.after(() => h.store.close())
  const other = h.persona.create({ name: 'other', traits: { humor: 0.2 }, activate: false }).persona
  h.persona.edit({ profile: { identity: 'existing identity' }, traits: { humor: 0.8 } }, 'self')
  const legacy = structuredClone(h.getConfig())
  assert.equal(h.settings.migrate().editingAvailable, true)
  const profilePaths = SETTINGS_FIELDS.filter(f => f.ownerClass === 'profile').map(f => f.path).sort()
  for (const id of ['self', other.id]) {
    const record = profileRecord(h.store, id)
    assert.deepEqual(Object.keys(record.values).sort(), profilePaths)
    assert.deepEqual(record.values, snapshotProfile(legacy, h.persona.getById(id)))
    assert.equal(record.revision, 1)
    assert.equal(record.sourceHash.length, 64)
    const snapshot = h.store.get(scopedPersonaKind(id, 'profile_settings_snapshot'), 'c02')
    assert.deepEqual(snapshot.values, record.values)
    assert.equal(snapshot.sourceHash, record.sourceHash)
    for (const field of SETTINGS_FIELDS.filter(f => f.ownerClass !== 'profile')) assert.ok(!Object.hasOwn(record.values, field.path), field.path)
  }
  assert.equal(profileRecord(h.store).values['cognition.persona.traits.humor'], 0.8)
  assert.equal(profileRecord(h.store, other.id).values['cognition.persona.traits.humor'], 0.2)
  assert.deepEqual(h.getConfig(), legacy)
  const marker = h.store.get('setting', PROFILE_MIGRATION_KEY)
  const first = profileRecord(h.store)
  h.setConfig({ ...legacy, cognition: { ...legacy.cognition, timezone: 'new legacy value' } })
  h.settings.migrate(); h.service().migrate()
  assert.deepEqual(profileRecord(h.store), first)
  assert.deepEqual(h.store.get('setting', PROFILE_MIGRATION_KEY), marker)
  assert.equal(h.persona.activeId(), 'self')
})

test('C02 partial explicit values preserve false, zero, empty arrays, strings and null; migration source remains available', t => {
  const h = setup(); t.after(() => h.store.close())
  const explicit = { 'cognition.enabled': false, 'cognition.turn.groupReplyProbability': 0, 'cognition.persona.values': [], 'cognition.timezone': '', 'cognition.persona.profile.identity': null }
  h.store.put(scopedPersonaKind('self', 'profile_settings'), 'config', { version: 1, revision: 4, values: explicit })
  h.settings.migrate()
  const record = profileRecord(h.store)
  for (const [path, value] of Object.entries(explicit)) assert.deepEqual(record.values[path], value)
  assert.equal(record.revision, 5)
  assert.equal(profileView(h.settings).values['cognition.persona.profile.identity'], null)
  assert.equal(h.store.get(scopedPersonaKind('self', 'profile_settings_snapshot'), 'c02').values['cognition.enabled'], true)
  h.settings.migrate()
  assert.deepEqual(profileRecord(h.store), record)
})

for (const backend of ['sqlite', 'json']) {
  test(`C02 ${backend} restart preserves snapshot, revision, active persona and explicit edits`, t => {
    const dir = mkdtempSync(join(tmpdir(), 'profile-settings-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
    const file = join(dir, 'test.sqlite')
    if (backend === 'json') mkdirSync(file)
    let store = createStore({ file })
    assert.equal(store.mode, backend)
    let h = setup(store)
    const other = h.persona.create({ name: 'other' }).persona
    h.settings.migrate()
    save(h.settings, { 'cognition.timezone': 'Asia/Tokyo', 'cognition.enabled': false }, other.id)
    const before = profileRecord(store, other.id)
    const source = store.get(scopedPersonaKind(other.id, 'profile_settings_snapshot'), 'c02')
    store.close()
    store = createStore({ file }); t.after(() => store.close())
    h = setup(store)
    assert.equal(h.persona.activeId(), other.id)
    assert.equal(h.settings.migrate().editingAvailable, true)
    assert.deepEqual(profileRecord(store, other.id), before)
    assert.deepEqual(store.get(scopedPersonaKind(other.id, 'profile_settings_snapshot'), 'c02'), source)
    assert.equal(profileView(h.settings, other.id).values['cognition.timezone'], 'Asia/Tokyo')
    assert.equal(h.getConfig().cognition.enabled, true, 'legacy runtime stays unchanged')
  })
}

test('C02 migration failures roll back all rows and marker, retain legacy runtime, retry safely and never expose exception text', t => {
  const base = createStore({ file: ':memory:' }); t.after(() => base.close())
  let failing = true
  const wrapped = { ...base, put(kind, id, value, options) {
    if (failing && kind === 'setting' && id === PROFILE_MIGRATION_KEY) throw new Error('sk-MIGRATION_SECRET_marker')
    return base.put(kind, id, value, options)
  } }
  const h = setup(wrapped)
  const other = h.persona.create({ name: 'other', activate: false }).persona
  const before = structuredClone(h.getConfig())
  assert.deepEqual(h.settings.migrate().migration, { ok: false, code: 'SETTINGS_MIGRATION_UNAVAILABLE' })
  for (const id of ['self', other.id]) {
    assert.equal(profileRecord(base, id), null)
    assert.equal(base.get(scopedPersonaKind(id, 'profile_settings_snapshot'), 'c02'), null)
  }
  assert.equal(base.get('setting', PROFILE_MIGRATION_KEY), null)
  assert.throws(() => profileView(h.settings), code('SETTINGS_MIGRATION_UNAVAILABLE'))
  assert.equal(h.settings.capture().runtimeMode, 'legacy')
  assert.equal(h.settings.legacyView().editingAvailable, false)
  assert.deepEqual(h.getConfig(), before)
  assert.doesNotMatch(JSON.stringify(h.settings.status()), /sk-MIGRATION_SECRET/)
  failing = false
  assert.equal(h.settings.migrate().editingAvailable, true)
  assert.equal(profileRecord(base).revision, 1)
})

test('C02 profile patch checks every field ownership, rejects unknown/read-only/mixed owners without writes', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const initial = profileRecord(h.store)
  for (const field of SETTINGS_FIELDS) {
    const wrongScope = field.ownerClass === 'profile' ? 'system' : 'profile'
    assert.throws(() => h.settings.patch({ scope: wrongScope, id: 'self', revision: 1, patch: { [field.path]: getPath(h.getConfig(), field.path) } }),
      code(field.apply === 'read-only' ? 'SETTINGS_PATH_INVALID' : 'SETTINGS_MULTI_OWNER'), field.path)
  }
  for (const patch of [{ unknown: true }, { '__proto__.polluted': true }, { 'cognition.timezone': 'UTC', 'ui.motion': 'none' }, { 'cognition.reply.split': true, 'cognition.typing.enabled': true }]) {
    assert.throws(() => h.settings.patch({ scope: 'profile', id: 'self', revision: 1, patch }), /SETTINGS_(PATH_INVALID|MULTI_OWNER)/)
  }
  assert.deepEqual(profileRecord(h.store), initial)
})

test('C02 revision conflicts, scope-only updates and inspection never activate; capture remains immutable and staged', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const other = h.persona.create({ name: 'other', activate: false }).persona
  const generation = h.persona.scopeGeneration()
  const initial = profileView(h.settings, other.id)
  const capture = h.settings.capture(other.id)
  assert.equal(Object.isFrozen(capture.candidate.cognition), true)
  assert.throws(() => h.settings.patch({ scope: 'profile', id: other.id, patch: { 'cognition.enabled': false } }), code('SETTINGS_CONFLICT'))
  const saved = h.settings.patch({ scope: 'profile', id: other.id, revision: initial.revision, patch: { 'cognition.enabled': false, 'cognition.timezone': 'UTC' } })
  assert.equal(saved.revision, initial.revision + 1)
  assert.equal(saved.profileEditsApply, 'staged')
  assert.throws(() => h.settings.patch({ scope: 'profile', id: other.id, revision: initial.revision, patch: { 'cognition.enabled': true } }), code('SETTINGS_CONFLICT'))
  assert.equal(h.persona.activeId(), 'self'); assert.equal(h.persona.scopeGeneration(), generation)
  assert.equal(capture.candidate.cognition.enabled, true)
  assert.equal(h.settings.capture(other.id).candidate.cognition.enabled, false)
  assert.equal(h.settings.capture(other.id).effective.cognition.enabled, true)
  assert.equal(h.getConfig().cognition.enabled, true)
  assert.equal(profileView(h.settings).values['cognition.enabled'], true)
  const sys = h.settings.view({ scope: 'system' })
  h.settings.patch({ scope: 'system', revision: sys.revision, patch: { 'ui.motion': 'reduced' } })
  assert.equal(h.getConfig().ui.motion, 'reduced')
  assert.throws(() => h.settings.patch({ scope: 'system', revision: sys.revision, patch: { 'ui.motion': 'full' } }), code('SETTINGS_CONFLICT'))
  assert.equal(profileView(h.settings, other.id).revision, saved.revision)
})

test('C02 secret keep/set/clear, masked reads, safe snapshots and owner-only module bindings', t => {
  const config = defaultConfig(); config.onebot.wsToken = 'sensitive-token-12345'; config.runtime.workspaceDir = '/private/host-path'
  const h = setup(undefined, config); t.after(() => h.store.close()); h.settings.migrate()
  const s = h.settings
  const sys = s.view({ scope: 'system' })
  assert.deepEqual(sys.values['onebot.wsToken'], { masked: true, present: true })
  const before = profileRecord(h.store)
  for (const dto of [s.schema(), sys, s.legacyView(), s.capture(), before, h.store.get('setting', PROFILE_MIGRATION_KEY)]) assert.doesNotMatch(JSON.stringify(dto), /sensitive-token-12345/)
  assert.doesNotMatch(JSON.stringify(before), /private\/host-path|dailyTokenBudget|maxConcurrency|wsToken/)
  for (const input of ['***', 'raw-token', null, { op: 'keep', value: 'oops' }, { op: 'set', value: '***' }]) assert.throws(() => s.patch({ scope: 'system', revision: sys.revision, patch: { 'onebot.wsToken': input } }), code('SETTINGS_SECRET_INVALID'))
  const keep = s.patch({ scope: 'system', revision: sys.revision, patch: { 'onebot.wsToken': { op: 'keep' } } })
  assert.equal(keep.revision, sys.revision)
  const set = s.patch({ scope: 'system', revision: keep.revision, patch: { 'onebot.wsToken': { op: 'set', value: 'new-sensitive-token' } } })
  assert.equal(h.getConfig().onebot.wsToken, 'new-sensitive-token')
  assert.doesNotMatch(JSON.stringify(set), /new-sensitive-token/)
  s.patch({ scope: 'system', revision: set.revision, patch: { 'onebot.wsToken': { op: 'clear' } } })
  assert.equal(h.getConfig().onebot.wsToken, '')
  const mod = s.view({ scope: 'module:builtin-typing' })
  s.patch({ scope: mod.scope, revision: mod.revision, patch: { 'cognition.typing.enabled': true } })
  assert.equal(h.getConfig().cognition.typing.enabled, true)
  assert.deepEqual(profileRecord(h.store), before)
  const p = save(s, { 'cognition.memory.embedding.apiKeyEnv': { op: 'set', value: 'MY_EMBEDDING_KEY' } })
  assert.deepEqual(p.values['cognition.memory.embedding.apiKeyEnv'], { masked: true, present: true })
  assert.equal(process.env.MY_EMBEDDING_KEY, undefined)
  assert.throws(() => save(s, { 'cognition.memory.embedding.baseUrl': 'https://user:password@example.org/v1' }), code('SETTINGS_PROFILE_INVALID'))
})

test('C02 legacy adapter maps active profile, rejects stale/switch/multiple owners and preserves masked credentials', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const s = h.settings
  let view = s.legacyView()
  const saveLegacy = config => s.legacySave({ config, revision: view.revision, personaId: view.personaId })
  const result = saveLegacy({ cognition: { timezone: 'UTC' } })
  assert.equal(result.config.cognition.timezone, 'UTC')
  assert.equal(h.getConfig().cognition.timezone, '')
  assert.throws(() => saveLegacy({ cognition: { timezone: 'other' } }), code('SETTINGS_CONFLICT'))
  view = s.legacyView()
  assert.throws(() => saveLegacy({ cognition: { timezone: 'other' }, ui: { motion: 'reduced' } }), code('SETTINGS_MULTI_OWNER'))
  const other = h.persona.create({ name: 'other' }).persona
  assert.throws(() => saveLegacy({ cognition: { timezone: 'other' } }), code('SETTINGS_CONFLICT'))
  h.persona.activate('self')
  assert.throws(() => saveLegacy({ cognition: { timezone: 'other' } }), code('SETTINGS_CONFLICT'))
  h.persona.activate(other.id)
  assert.equal(profileView(s).values['cognition.timezone'], 'UTC')
  assert.equal(profileView(s, other.id).values['cognition.timezone'], '')
  view = s.legacyView()
  saveLegacy({ onebot: { wsToken: { op: 'set', value: 'legacy-secret-value' } } })
  view = s.legacyView()
  assert.equal(view.config.onebot.wsToken, '***')
  saveLegacy(view.config)
  assert.equal(h.getConfig().onebot.wsToken, 'legacy-secret-value')
  assert.throws(() => s.legacySave({ config: { enabled: false } }), code('SETTINGS_CONFLICT'))
})

test('C02 profile create/duplicate/delete lifecycle keeps independent config and excludes settings from data copy groups', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  save(h.settings, { 'cognition.timezone': 'Asia/Tokyo', 'cognition.persona.traits.humor': 0.12 })
  const duplicate = h.persona.duplicate('self').persona
  assert.equal(profileView(h.settings, duplicate.id).values['cognition.timezone'], 'Asia/Tokyo')
  assert.equal(profileView(h.settings, duplicate.id).values['cognition.persona.traits.humor'], 0.12)
  save(h.settings, { 'cognition.timezone': 'UTC' }, duplicate.id)
  assert.equal(profileView(h.settings).values['cognition.timezone'], 'Asia/Tokyo')
  h.persona.remove(duplicate.id); dropPersonaData({ base: h.store, personaId: duplicate.id })
  assert.equal(profileRecord(h.store, duplicate.id), null)
  assert.equal(h.persona.activeId(), 'self')
  assert.throws(() => profileView(h.settings, duplicate.id), code('PERSONA_NOT_FOUND'))
})
