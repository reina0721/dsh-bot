// C02 persistence and resolver boundary. Runtime cutover is deliberately gated.
import { createHash } from 'node:crypto'
import { SETTINGS_FIELDS, SETTINGS_GROUPS } from './settings-schema.js'
import { clone, getPath, setPath, normalizeConfig, publicConfig } from './config.js'
import { scopedPersonaKind } from '../cognition/persona-scope.js'

export const PROFILE_SETTINGS_KIND = 'profile_settings'
export const PROFILE_SETTINGS_ID = 'config'
export const PROFILE_MIGRATION_KEY = 'profile.settingsMigration.c02'
export const PROFILE_RUNTIME_MODE = 'legacy' // No writable flag: cutover needs a separate reviewed change.
const fields = new Map(SETTINGS_FIELDS.map(field => [field.path, field]))
const profileFields = SETTINGS_FIELDS.filter(field => field.ownerClass === 'profile')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const owner = field => field.ownerClass === 'module' ? `module:${field.canonical.moduleId}` : field.ownerClass
const fail = code => { throw Object.assign(new Error(code), { code }) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const kind = id => scopedPersonaKind(id, PROFILE_SETTINGS_KIND)
const masked = field => ['secret', 'secret-reference'].includes(field.sensitivity)

function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }
  return value
}

// Profile URLs must not smuggle credentials into a migration snapshot.
function safeSnapshot(values, config) {
  const secrets = [config.onebot?.wsToken, config.onebot?.httpToken].filter(value => typeof value === 'string' && value.length >= 4)
  for (const [path, value] of Object.entries(values)) {
    if (!fields.has(path) || fields.get(path).ownerClass !== 'profile') fail('SETTINGS_PROFILE_INVALID')
    if (fields.get(path).sensitivity === 'secret') fail('SETTINGS_PROFILE_INVALID')
    if (typeof value === 'string' && /baseUrl$/i.test(path) && value) {
      try {
        const url = new URL(value)
        if (url.username || url.password || url.search || url.hash) fail('SETTINGS_PROFILE_INVALID')
      } catch { fail('SETTINGS_PROFILE_INVALID') }
    }
    if (secrets.some(secret => JSON.stringify(value).includes(secret))) fail('SETTINGS_PROFILE_INVALID')
  }
  return clone(values)
}

export function snapshotProfile(config, persona) {
  const effective = clone(config)
  // These already live in persona records; snapshot each persona's actual behavior.
  for (const key of ['traits', 'style', 'values', 'profile']) {
    if (persona?.[key] !== undefined) setPath(effective, `cognition.persona.${key}`, persona[key])
  }
  const values = Object.fromEntries(profileFields.map(field => [field.path, clone(getPath(effective, field.path))]))
  return safeSnapshot(values, config)
}

export function createProfileSettings({ store, persona, getConfig, setConfig, clock = { now: Date.now } }) {
  let available = false
  let migrationState = { ok: false, code: 'SETTINGS_MIGRATION_UNAVAILABLE' }
  const read = id => store.get(kind(id), PROFILE_SETTINGS_ID)
  const requirePersona = id => {
    if (typeof id !== 'string' || !id || !persona.getById(id)) fail('PERSONA_NOT_FOUND')
    return id
  }
  const requireAvailable = () => { if (!available) fail('SETTINGS_MIGRATION_UNAVAILABLE') }

  function migrate() {
    try {
      if (store.atomicTransactions !== true) fail('SETTINGS_ATOMIC_STORE_REQUIRED')
      store.tx(() => {
        const marker = store.get('setting', PROFILE_MIGRATION_KEY)
        if (marker && marker.version !== 1) fail('SETTINGS_MIGRATION_UNAVAILABLE')
        const sources = {}
        // Use the store inventory, without activating any inspected persona.
        for (const row of store.list('persona', { limit: 1000000 })) {
          const id = requirePersona(row.id)
          const previous = read(id)
          if (previous && (previous.version !== 1 || !Number.isSafeInteger(previous.revision) || previous.revision < 1 || !object(previous.values))) fail('SETTINGS_PROFILE_INVALID')
          if (previous) safeSnapshot(previous.values, getConfig())
          if (previous?.migrationVersion === 1) continue
          if (previous?.revision === Number.MAX_SAFE_INTEGER) fail('SETTINGS_REVISION_INVALID')
          const snapshot = snapshotProfile(getConfig(), persona.getById(id))
          sources[id] = snapshot
          const sourceHash = hash(snapshot)
          store.put(scopedPersonaKind(id, 'profile_settings_snapshot'), 'c02', { version: 1, sourceHash, values: snapshot })
          // Presence, including false/zero/empty/null, wins over the snapshot.
          store.put(kind(id), PROFILE_SETTINGS_ID, {
            version: 1, migrationVersion: 1, sourceHash,
            revision: (previous?.revision || 0) + 1,
            values: { ...snapshot, ...previous?.values },
          })
        }
        if (!marker) store.put('setting', PROFILE_MIGRATION_KEY, { version: 1, sourceHash: hash(sources), personaIds: Object.keys(sources), at: clock.now() })
      })
      available = true
      migrationState = { ok: true, version: 1, sourceHash: store.get('setting', PROFILE_MIGRATION_KEY).sourceHash }
    } catch {
      available = false
      migrationState = { ok: false, code: 'SETTINGS_MIGRATION_UNAVAILABLE' }
    }
    return status()
  }

  function status() { return { editingAvailable: available, runtimeMode: PROFILE_RUNTIME_MODE, profileEditsApply: 'staged', migration: clone(migrationState) } }

  function initialize(id, copyFrom = '') {
    requireAvailable()
    const values = snapshotProfile(getConfig(), persona.getById(id))
    const source = copyFrom && read(copyFrom)
    if (source) {
      Object.assign(values, clone(source.values))
      values['cognition.persona.profile.displayName'] = persona.getById(id).profile.displayName
    }
    store.put(kind(id), PROFILE_SETTINGS_ID, { version: 1, migrationVersion: 1, revision: 1, sourceHash: hash(values), values })
  }

  function scopeFields(scope) {
    const selected = SETTINGS_FIELDS.filter(field => owner(field) === scope)
    if (!selected.length) fail('SETTINGS_SCOPE_INVALID')
    return selected
  }

  function rawView(scope, id) {
    const selected = scopeFields(scope)
    if (scope === 'profile') {
      requireAvailable(); requirePersona(id)
      const record = read(id)
      if (!record) fail('SETTINGS_MIGRATION_UNAVAILABLE')
      return { values: clone(record.values), revision: record.revision, selected }
    }
    if (selected.some(field => field.storage !== 'config.json')) fail('SETTINGS_MODULE_FILE_REQUIRED')
    const values = Object.fromEntries(selected.map(field => [field.path, clone(getPath(getConfig(), field.path))]))
    return { values, revision: hash(values), selected }
  }

  function view({ scope = 'system', id = '' } = {}) {
    const { values, revision, selected } = rawView(scope, id)
    const dto = {}
    for (const field of selected) {
      if (masked(field)) dto[field.path] = { masked: true, present: Boolean(values[field.path]) }
      else {
        const container = {}; setPath(container, field.path, values[field.path])
        dto[field.path] = getPath(publicConfig(container), field.path)
      }
    }
    return { ok: true, scope, ...(scope === 'profile' ? { id } : {}), revision, values: dto, ...status() }
  }

  function patch({ scope, id = '', revision, patch: changes } = {}) {
    if (!object(changes) || !Object.keys(changes).length) fail('SETTINGS_PATCH_INVALID')
    // Validate every owner before doing any write, even if the revision is stale.
    const owners = new Set(Object.keys(changes).map(path => {
      const field = fields.get(path)
      if (!field || field.apply === 'read-only') fail('SETTINGS_PATH_INVALID')
      return owner(field)
    }))
    if (owners.size !== 1 || !owners.has(scope)) fail('SETTINGS_MULTI_OWNER')
    const current = rawView(scope, id)
    if (revision !== current.revision) fail('SETTINGS_CONFLICT')
    const candidate = clone(getConfig())
    if (scope === 'profile') for (const [path, value] of Object.entries(current.values)) setPath(candidate, path, value)
    const changed = []
    for (const [path, input] of Object.entries(changes)) {
      const field = fields.get(path)
      let value = input
      if (masked(field)) {
        if (!object(input) || !['keep', 'set', 'clear'].includes(input.op)
          || Object.keys(input).some(key => !['op', 'value'].includes(key))
          || (input.op === 'set' ? typeof input.value !== 'string' || input.value === '***' : Object.hasOwn(input, 'value'))) fail('SETTINGS_SECRET_INVALID')
        if (input.op === 'keep') continue
        value = input.op === 'clear' ? '' : input.value
      }
      const fallback = getPath(getConfig(), path)
      if (value === undefined || value === null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback)) fail('SETTINGS_VALUE_INVALID')
      setPath(candidate, path, clone(value)); changed.push(path)
    }
    const normalized = normalizeConfig(candidate)
    // Only the requested paths are written; normalization cannot change other owners.
    if (scope === 'profile') {
      store.tx(() => {
        const latest = read(id)
        if (latest.revision !== revision) fail('SETTINGS_CONFLICT')
        const values = clone(latest.values)
        for (const path of changed) values[path] = clone(getPath(normalized.config, path))
        safeSnapshot(values, getConfig())
        if (!Number.isSafeInteger(latest.revision + 1)) fail('SETTINGS_REVISION_INVALID')
        if (changed.length) store.put(kind(id), PROFILE_SETTINGS_ID, { ...latest, values, revision: latest.revision + 1 })
      })
    } else if (changed.length) {
      const next = clone(getConfig())
      for (const path of changed) setPath(next, path, getPath(normalized.config, path))
      if (typeof setConfig !== 'function') fail('SETTINGS_WRITE_UNAVAILABLE')
      setConfig(next)
    }
    return { ...view({ scope, id }), issues: normalized.issues.length ? ['SETTINGS_VALUES_NORMALIZED'] : [] }
  }

  function legacyView() {
    const id = persona.activeId()
    const config = clone(getConfig())
    if (available) for (const [path, value] of Object.entries(read(id)?.values || {})) setPath(config, path, value)
    return { ok: true, config: publicConfig(config), personaId: id,
      revision: hash([id, persona.scopeGeneration(), read(id)?.revision || 0, getConfig()]), ...status() }
  }

  function legacySave(body) {
    if (!object(body) || !object(body.config)) fail('SETTINGS_PATCH_INVALID')
    const current = legacyView()
    if (body.revision !== current.revision || body.personaId !== current.personaId) fail('SETTINGS_CONFLICT')
    const changes = {}
    // Flatten only known field leaves. Unknown input is never silently dropped.
    function walk(value, prefix = '') {
      if (fields.has(prefix)) {
        const field = fields.get(prefix)
        if (masked(field) && (value === '***' || object(value) && value.masked === true)) return
        if (!same(value, getPath(current.config, prefix))) changes[prefix] = value
        return
      }
      if (!object(value) || !Object.keys(value).length || Object.keys(value).some(key => ['__proto__', 'constructor', 'prototype'].includes(key))) fail('SETTINGS_PATH_INVALID')
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key)
    }
    for (const [key, value] of Object.entries(body.config)) walk(value, key)
    if (!Object.keys(changes).length) return { ...current, issues: [] }
    const owners = new Set(Object.keys(changes).map(path => owner(fields.get(path))))
    if (owners.size !== 1) fail('SETTINGS_MULTI_OWNER')
    const scope = [...owners][0]
    const result = patch({ scope, id: current.personaId, revision: rawView(scope, current.personaId).revision, patch: changes })
    return { ...legacyView(), issues: result.issues }
  }

  // Capture masks credentials and is never persisted on turn records.
  // Candidate resolution includes profile overrides; runtime continues reading legacy config.
  function capture(id = persona.activeId()) {
    const config = clone(getConfig())
    const currentPersona = persona.getById(id)
    for (const key of ['traits', 'style', 'values', 'profile']) {
      if (currentPersona?.[key] !== undefined) setPath(config, `cognition.persona.${key}`, currentPersona[key])
    }
    const record = available ? read(id) : null
    const candidate = clone(config)
    if (record) for (const [path, value] of Object.entries(record.values)) setPath(candidate, path, value)
    return freeze({ personaId: id, profileRevision: record?.revision || null, runtimeMode: PROFILE_RUNTIME_MODE,
      editingAvailable: available, effective: publicConfig(config), candidate: publicConfig(candidate) })
  }

  function schema() {
    return { ok: true, fields: clone(SETTINGS_FIELDS), groups: clone(SETTINGS_GROUPS),
      profileStorage: { kind: PROFILE_SETTINGS_KIND, id: PROFILE_SETTINGS_ID, namespace: 'persona', schemaVersion: 1 }, ...status() }
  }
  return { migrate, status, initialize, view, patch, legacyView, legacySave, capture, schema }
}
