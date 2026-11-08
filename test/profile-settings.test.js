import { test } from 'node:test'
import { createProactivityPort } from '../src/modules/proactivity-port.js'
import { createProactivityEngine } from '../src/modules/builtin/proactivity/engine.js'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStore } from '../src/cognition/store.js'
import { createPersonaService } from '../src/cognition/persona.js'
import { scopedPersonaKind, dropPersonaData, createPersonaScopedStore } from '../src/cognition/persona-scope.js'
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
    config: () => settings?.resolveConfig() || getConfig(),
    currentId: () => settings?.runtimePersonaId(),
    read: value => settings?.personaView(value) || value,
    runtimeRead: value => settings?.runtimePersona(value) || value,
    saved: (previous, next) => settings?.personaSaved(previous, next),
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
    const dir = mkdtempSync(join(tmpdir(), 'profile-settings-')); t.after(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) } catch {} })
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
    assert.equal(h.getConfig().cognition.enabled, true, 'legacy file is preserved')
    assert.equal(h.settings.resolveConfig().cognition.enabled, false, 'restarted runtime uses persisted profile')
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
  h.persona.edit({ profile: { identity: 'legacy persona record' } })
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
  assert.deepEqual(h.settings.resolveConfig(), before, 'legacy runtime keeps raw config and separate persona records')
  assert.equal(h.persona.get().profile.identity, 'legacy persona record')
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

test('C02 revision conflicts, scope-only updates and inspection never activate; capture remains immutable and applied', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const other = h.persona.create({ name: 'other', activate: false }).persona
  const generation = h.persona.scopeGeneration()
  const initial = profileView(h.settings, other.id)
  const capture = h.settings.capture(other.id)
  assert.equal(Object.isFrozen(capture.candidate.cognition), true)
  assert.throws(() => h.settings.patch({ scope: 'profile', id: other.id, patch: { 'cognition.enabled': false } }), code('SETTINGS_CONFLICT'))
  const saved = h.settings.patch({ scope: 'profile', id: other.id, revision: initial.revision, patch: { 'cognition.enabled': false, 'cognition.timezone': 'UTC' } })
  assert.equal(saved.revision, initial.revision + 1)
  assert.equal(saved.profileEditsApply, 'applied')
  assert.throws(() => h.settings.patch({ scope: 'profile', id: other.id, revision: initial.revision, patch: { 'cognition.enabled': true } }), code('SETTINGS_CONFLICT'))
  assert.equal(h.persona.activeId(), 'self'); assert.equal(h.persona.scopeGeneration(), generation)
  assert.equal(capture.candidate.cognition.enabled, true)
  assert.equal(h.settings.capture(other.id).candidate.cognition.enabled, false)
  assert.equal(h.settings.capture(other.id).effective.cognition.enabled, false)
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


test('profile runtime pins persona settings across awaits; system/module reads stay live and nested captures do not apply twice', async t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const s = h.settings
  const other = h.persona.create({ name: 'other', activate: false }).persona
  save(s, { 'cognition.timezone': 'UTC', 'cognition.persona.profile.identity': 'first identity' })
  save(s, { 'cognition.timezone': 'Asia/Tokyo' }, other.id)
  let entered, release
  const enteredPromise = new Promise(resolve => { entered = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const work = s.withRuntime(async captured => {
    const revision = captured.profileRevision
    entered(); await gate
    assert.equal(s.runtimePersonaId(), 'self')
    assert.equal(s.resolveConfig().cognition.timezone, 'UTC')
    assert.equal(h.persona.get().profile.identity, 'first identity')
    assert.equal(s.resolveConfig().ui.motion, 'reduced')
    assert.equal(s.resolveConfig().cognition.typing.enabled, true)
    assert.equal(s.resolveConfig().access.ownerQQ, '123456')
    await s.withRuntime(inner => { assert.equal(inner.profileRevision, revision) })
    assert.throws(() => s.saveRuntimeConfig(s.resolveConfig()), code('SETTINGS_CONFLICT'))
  })
  await enteredPromise
  save(s, { 'cognition.timezone': 'Europe/Paris', 'cognition.persona.profile.identity': 'new identity' })
  h.setConfig({ ...h.getConfig(), ui: { motion: 'reduced' }, access: { ownerQQ: '123456' }, cognition: { ...h.getConfig().cognition, typing: { enabled: true } } })
  h.persona.activate(other.id)
  assert.equal(s.resolveConfig().cognition.timezone, 'Asia/Tokyo')
  release(); await work
  assert.equal(profileView(s).values['cognition.timezone'], 'Europe/Paris')
  h.persona.activate('self')
  assert.equal(h.persona.get().profile.identity, 'new identity')
  assert.equal(s.resolveConfig().cognition.timezone, 'Europe/Paris')
})

test('profile runtime legacy persona edit/reset/evolution share one revision and roll back together on write failure', t => {
  const base = createStore({ file: ':memory:' }); t.after(() => base.close())
  let failing = false
  const store = { ...base, put(kind, ...args) {
    if (failing && kind.endsWith(':profile_settings')) throw Error('PRIVATE_WRITE_FAILURE')
    return base.put(kind, ...args)
  } }
  const h = setup(store); const s = h.settings; s.migrate()
  const before = profileView(s)
  h.persona.edit({ traits: { humor: 0.7 }, profile: { displayName: 'edited' } })
  assert.equal(profileView(s).revision, before.revision + 1)
  assert.equal(s.resolveConfig().cognition.persona.traits.humor, 0.7)
  assert.equal(s.capture().effective.cognition.persona.profile.displayName, 'edited')
  assert.throws(() => s.patch({ scope: 'profile', id: 'self', revision: before.revision, patch: { 'cognition.timezone': 'UTC' } }), code('SETTINGS_CONFLICT'))
  const edited = profileRecord(store)
  h.persona.edit({ traits: { humor: 0.7 } })
  assert.equal(profileView(s).revision, edited.revision, 'same value is not applied again')
  failing = true
  assert.throws(() => h.persona.edit({ traits: { humor: 0.8 } }), /PRIVATE_WRITE_FAILURE/)
  assert.deepEqual(profileRecord(store), edited)
  assert.equal(h.persona.get().traits.humor, 0.7)
  failing = false
  h.persona.maybeEvolve({ humor: 1 })
  assert.equal(profileView(s).revision, edited.revision + 1)
  assert.equal(profileView(s).values['cognition.persona.traits.humor'], h.persona.get().traits.humor)
  h.persona.reset()
  assert.equal(profileView(s).revision, edited.revision + 2)
  assert.equal(s.resolveConfig().cognition.persona.traits.humor, h.persona.get().traits.humor)
})

test('profile runtime config commands use CAS, reject mixed owners before writing, and fall back as a whole', t => {
  const h = setup(); t.after(() => h.store.close()); const s = h.settings; s.migrate()
  const before = structuredClone(h.getConfig())
  const next = s.resolveConfig(); next.cognition.modelRouting.privateDefault = 'provider/model'
  s.saveRuntimeConfig(next)
  assert.equal(s.resolveConfig().cognition.modelRouting.privateDefault, 'provider/model')
  assert.deepEqual(h.getConfig(), before)
  const other = h.persona.create({ name: 'other', activate: false }).persona
  s.withRuntime(() => {
    h.persona.activate(other.id); h.persona.activate('self')
    const stale = s.resolveConfig(); stale.cognition.timezone = 'UTC'
    assert.throws(() => s.saveRuntimeConfig(stale), code('SETTINGS_CONFLICT'))
  })
  const revision = profileView(s).revision
  const mixed = s.resolveConfig(); mixed.cognition.paused = true; mixed.cognition.typing.enabled = true
  assert.throws(() => s.saveRuntimeConfig(mixed), code('SETTINGS_MULTI_OWNER'))
  assert.equal(profileView(s).revision, revision)
  assert.deepEqual(h.getConfig(), before)
  s.withRuntime(() => {
    save(s, { 'cognition.timezone': 'UTC' })
    const stale = s.resolveConfig(); stale.cognition.timezone = 'Asia/Tokyo'
    assert.throws(() => s.saveRuntimeConfig(stale), code('SETTINGS_CONFLICT'))
  })
  // Corrupt a different owner into the profile: no system override may execute.
  const record = profileRecord(h.store)
  h.store.put(scopedPersonaKind('self', 'profile_settings'), 'config', { ...record, values: { ...record.values, 'ui.motion': 'reduced' } })
  assert.equal(s.resolveConfig().cognition.modelRouting.privateDefault, before.cognition.modelRouting.privateDefault)
  assert.equal(s.resolveConfig().ui.motion, before.ui.motion)
  assert.equal(s.status().runtimeMode, 'legacy')
  assert.equal(s.status().profileEditsApply, 'staged')
  assert.throws(() => profileView(s), code('SETTINGS_MIGRATION_UNAVAILABLE'))
  const legacy = s.resolveConfig(); legacy.cognition.timezone = 'UTC'
  s.saveRuntimeConfig(legacy)
  assert.equal(h.getConfig().cognition.timezone, 'UTC')
})


test('C02-to-runtime migration refreshes untouched snapshots from actual legacy behavior, keeps deliberate overrides and is idempotent', t => {
  const h = setup(); t.after(() => h.store.close()); h.settings.migrate()
  const original = profileRecord(h.store)
  const source = h.store.get(scopedPersonaKind('self', 'profile_settings_snapshot'), 'c02')
  const { runtimeVersion, ...c02 } = original
  h.store.put(scopedPersonaKind('self', 'profile_settings'), 'config', { ...c02, values: { ...c02.values, 'cognition.timezone': 'Asia/Tokyo' } })
  const rawPersona = h.store.get('persona', 'self')
  h.store.put('persona', 'self', { ...rawPersona, traits: { ...rawPersona.traits, humor: 0.83 }, profile: { ...rawPersona.profile, identity: 'later legacy identity' } })
  h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition, dryRun: true, timezone: 'UTC' } })
  const restarted = setup(h.store, h.getConfig())
  assert.equal(restarted.settings.migrate().runtimeMode, 'profile')
  const effective = restarted.settings.resolveConfig()
  assert.equal(effective.cognition.persona.traits.humor, 0.83)
  assert.equal(effective.cognition.persona.profile.identity, 'later legacy identity')
  assert.equal(effective.cognition.dryRun, true)
  assert.equal(effective.cognition.timezone, 'Asia/Tokyo', 'deliberately edited C02 override is applied')
  const after = profileRecord(h.store)
  assert.equal(after.revision, c02.revision + 1)
  assert.equal(after.runtimeVersion, 1)
  restarted.settings.migrate()
  assert.deepEqual(profileRecord(h.store), after)
  assert.deepEqual(h.store.get(scopedPersonaKind('self', 'profile_settings_snapshot'), 'c02'), source)
})


test('profile task entry captures fresh settings even from an old timer context; async module dependencies use that capture', async t => {
  const h = setup(); t.after(() => h.store.close()); const s = h.settings; s.migrate()
  h.setConfig({ ...h.getConfig(), cognition: { ...h.getConfig().cognition, proactivity: { enabled: true, quietStart: 0, quietEnd: 0 } } })
  const store = createPersonaScopedStore({ base: h.store, getPersonaId: s.runtimePersonaId })
  store.put('person', 'p1', { displayName: 'friend' })
  store.put('relationship', 'r1', { personId: 'p1', scopeType: 'private', scopeId: '10001', familiarity: 0.9, initiative: 0.8 })
  let enter, release, fire, capturedWarmth, capturedRoute, sends = 0
  const entered = new Promise(resolve => { enter = resolve })
  const gate = new Promise(resolve => { release = resolve })
  const port = createProactivityPort({ store, services: { settings: s, persona: h.persona, llm: { async complete({ user }) {
    capturedWarmth = user
    capturedRoute = s.resolveConfig().cognition.modelRouting.privateDefault
    return { ok: true, text: 'hello' }
  } } }, getConfig: s.resolveConfig, clock, getState: () => ({ ready: true }),
    memoryFactory: () => ({ async retrieveAsync() { enter(); await gate; return [] } }),
    delivery: { async deliver() { sends++; return { ok: true, messageId: 'one' } } },
  })
  const engine = createProactivityEngine({ port, getConfig: () => h.getConfig().cognition.proactivity,
    scheduler: { setTimeout(fn) { fire = fn; return 1 }, clearTimeout() {} },
  })
  t.after(() => engine.stop())
  save(s, { 'cognition.persona.style.warmth': 0.1 })
  let timerWork
  await s.withRuntime(async () => {
    engine.start()
    save(s, { 'cognition.persona.style.warmth': 0.3, 'cognition.modelRouting.privateDefault': 'captured/model' })
    timerWork = fire()
    await entered
    save(s, { 'cognition.persona.style.warmth': 0.9, 'cognition.modelRouting.privateDefault': 'new/model' })
    release(); await timerWork
  })
  assert.match(capturedWarmth, /温暖 0.3/)
  assert.equal(capturedRoute, 'captured/model')
  assert.equal(sends, 1)
  assert.equal(s.resolveConfig().cognition.persona.style.warmth, 0.9)
})

for (const missingSource of [false, true]) test(`runtime migration rollback keeps every profile legacy when ${missingSource ? 'C02 source is missing' : 'cutover persistence fails'}`, t => {
  const base = createStore({ file: ':memory:' }); t.after(() => base.close())
  let failing = false
  const wrapped = { ...base, put(kind, ...args) {
    if (failing && kind.endsWith(':profile_settings')) throw Error('PRIVATE_RUNTIME_MIGRATION_ERROR')
    return base.put(kind, ...args)
  } }
  const h = setup(wrapped); h.persona.create({ name: 'other', activate: false }); h.settings.migrate()
  for (const row of base.list('persona')) {
    const { runtimeVersion, ...record } = profileRecord(base, row.id)
    base.put(scopedPersonaKind(row.id, 'profile_settings'), 'config', record)
  }
  if (missingSource) base.remove(scopedPersonaKind('self', 'profile_settings_snapshot'), 'c02')
  failing = !missingSource
  const restart = setup(wrapped, h.getConfig())
  assert.equal(restart.settings.migrate().runtimeMode, 'legacy')
  assert.equal(restart.settings.status().editingAvailable, false)
  for (const row of base.list('persona')) assert.equal(profileRecord(base, row.id).runtimeVersion, undefined)
  assert.equal(restart.settings.resolveConfig().cognition.enabled, h.getConfig().cognition.enabled)
  assert.doesNotMatch(JSON.stringify(restart.settings.status()), /PRIVATE_RUNTIME_MIGRATION_ERROR/)
})


test('a delayed turn cannot evolve over a newer profile edit', t => {
  const h = setup(); t.after(() => h.store.close()); const s = h.settings; s.migrate()
  s.withRuntime(() => {
    save(s, { 'cognition.persona.traits.humor': 0.8 })
    assert.throws(() => h.persona.maybeEvolve({ humor: 1 }), code('SETTINGS_CONFLICT'))
  })
  assert.equal(profileView(s).values['cognition.persona.traits.humor'], 0.8)
  assert.equal(h.persona.get().traits.humor, 0.8)
})
