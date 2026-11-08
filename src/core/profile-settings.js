// Profile ownership, persistence and captured runtime resolution.
import { createHash } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { sanitizePersona } from '../cognition/persona.js'
import { SETTINGS_FIELDS, SETTINGS_GROUPS } from './settings-schema.js'
import { clone, getPath, setPath, normalizeConfig, publicConfig } from './config.js'
import { scopedPersonaKind } from '../cognition/persona-scope.js'

export const PROFILE_SETTINGS_KIND = 'profile_settings'
export const PROFILE_SETTINGS_ID = 'config'
export const PROFILE_MIGRATION_KEY = 'profile.settingsMigration.c02'
export const PROFILE_RUNTIME_MODE = 'profile'
const fields = new Map(SETTINGS_FIELDS.map(field => [field.path, field]))
const profileFields = SETTINGS_FIELDS.filter(field => field.ownerClass === 'profile')
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const owner = field => field.ownerClass === 'module' ? `module:${field.canonical.moduleId}` : field.ownerClass
const fail = code => { throw Object.assign(new Error(code), { code }) }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const kind = id => scopedPersonaKind(id, PROFILE_SETTINGS_KIND)
const personaFields = profileFields.filter(field => /^cognition\.persona\.(traits\.|style\.|values$|profile\.)/.test(field.path))
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
  const runtime = new AsyncLocalStorage()
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
          if (previous?.migrationVersion === 1) {
            if (previous.runtimeVersion === 1) continue
            if (previous.runtimeVersion !== undefined) fail('SETTINGS_PROFILE_INVALID')
            const source = store.get(scopedPersonaKind(id, 'profile_settings_snapshot'), 'c02')
            if (!source || source.version !== 1 || !object(source.values) || hash(source.values) !== previous.sourceHash) fail('SETTINGS_PROFILE_INVALID')
            safeSnapshot(source.values, getConfig())
            // C02 legacy editors/config files could change after the snapshot.
            // Refresh untouched leaves; keep deliberately saved staged overrides.
            const values = snapshotProfile(getConfig(), persona.getById(id))
            for (const [path, value] of Object.entries(previous.values)) {
              if (!Object.hasOwn(source.values, path) || !same(value, source.values[path])) values[path] = clone(value)
            }
            safeSnapshot(values, getConfig())
            const changed = !same(values, previous.values)
            if (changed && !Number.isSafeInteger(previous.revision + 1)) fail('SETTINGS_REVISION_INVALID')
            store.put(kind(id), PROFILE_SETTINGS_ID, { ...previous, values, runtimeVersion: 1, revision: previous.revision + (changed ? 1 : 0) })
            continue
          }
          if (previous?.revision === Number.MAX_SAFE_INTEGER) fail('SETTINGS_REVISION_INVALID')
          const snapshot = snapshotProfile(getConfig(), persona.getById(id))
          sources[id] = snapshot
          const sourceHash = hash(snapshot)
          store.put(scopedPersonaKind(id, 'profile_settings_snapshot'), 'c02', { version: 1, sourceHash, values: snapshot })
          // Presence, including false/zero/empty/null, wins over the snapshot.
          store.put(kind(id), PROFILE_SETTINGS_ID, {
            version: 1, migrationVersion: 1, runtimeVersion: 1, sourceHash,
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

  function runtimeRecord(id) {
    if (!available) return null
    try {
      const record = read(id)
      if (!record || record.version !== 1 || record.migrationVersion !== 1 || record.runtimeVersion !== 1 || !Number.isSafeInteger(record.revision) || record.revision < 1 || !object(record.values)) fail('SETTINGS_PROFILE_INVALID')
      safeSnapshot(record.values, getConfig())
      return record
    } catch {
      // Fail closed for the whole resolver, never run a partially valid profile.
      available = false
      migrationState = { ok: false, code: 'SETTINGS_MIGRATION_UNAVAILABLE' }
      return null
    }
  }

  function status() {
    if (available) runtimeRecord(persona.activeId())
    return { editingAvailable: available, runtimeMode: available ? PROFILE_RUNTIME_MODE : 'legacy',
      profileEditsApply: available ? 'applied' : 'staged', migration: clone(migrationState) }
  }

  function resolution(id = persona.activeId()) {
    const config = clone(getConfig())
    let currentPersona = null
    try { currentPersona = persona.getById(id) } catch { /* Legacy config remains usable. */ }
    for (const key of ['traits', 'style', 'values', 'profile']) {
      if (currentPersona?.[key] !== undefined) setPath(config, `cognition.persona.${key}`, currentPersona[key])
    }
    const record = runtimeRecord(id)
    const values = Object.fromEntries(profileFields.map(field => [field.path, clone(getPath(config, field.path))]))
    if (record) Object.assign(values, clone(record.values))
    return freeze({ personaId: id, personaGeneration: persona.scopeGeneration(), profileRevision: record?.revision || null,
      runtimeMode: record ? PROFILE_RUNTIME_MODE : 'legacy', values })
  }

  function applyResolution(config, resolved) {
    for (const [path, value] of Object.entries(resolved.values)) setPath(config, path, clone(value))
    return config
  }

  // Only profile-owned values are pinned. System policy, credentials and module
  // bindings keep their live legacy reads (including safety revocations).
  function resolveConfig() {
    const resolved = runtime.getStore() || resolution()
    const config = clone(getConfig())
    return resolved.runtimeMode === 'profile' ? applyResolution(config, resolved) : config
  }

  function runtimePersonaId() { return runtime.getStore()?.personaId || persona.activeId() }

  function personaView(current) {
    if (!available) return current
    let existing
    try { existing = read(current.id) } catch { runtimeRecord(current.id); return current }
    if (!existing) return current // New record, before initialize.
    const record = runtimeRecord(current.id)
    if (!record) return current
    const next = clone(current)
    for (const field of personaFields) if (Object.hasOwn(record.values, field.path)) setPath(next, field.path.slice('cognition.persona.'.length), clone(record.values[field.path]))
    return sanitizePersona(next, getConfig()?.cognition)
  }

  function runtimePersona(current) {
    const resolved = runtime.getStore()
    if (!resolved) return personaView(current)
    const next = clone(current)
    for (const field of personaFields) setPath(next, field.path.slice('cognition.persona.'.length), clone(resolved.values[field.path]))
    return sanitizePersona(next, getConfig()?.cognition)
  }

  function withRuntime(work, { fresh = false } = {}) {
    if (!fresh && runtime.getStore()) return work(captureResolved(runtime.getStore()))
    const resolved = resolution()
    return runtime.run(resolved, () => work(captureResolved(resolved)))
  }

  // Legacy persona edits/reset/evolution share the canonical profile row. The
  // caller's persona write and this revision update belong to the same store tx.
  function personaSaved(previous, next) {
    if (!available) return
    const record = runtimeRecord(next.id)
    if (!record) return
    const values = clone(record.values)
    let changed = false
    for (const field of personaFields) {
      const path = field.path.slice('cognition.persona.'.length)
      if (!same(getPath(previous, path), getPath(next, path))) {
        values[field.path] = clone(getPath(next, path)); changed = true
      }
    }
    if (!changed) return
    const captured = runtime.getStore()
    if (captured?.personaId === next.id && captured.profileRevision !== record.revision) fail('SETTINGS_CONFLICT')
    safeSnapshot(values, getConfig())
    if (!Number.isSafeInteger(record.revision + 1)) fail('SETTINGS_REVISION_INVALID')
    store.put(kind(next.id), PROFILE_SETTINGS_ID, { ...record, values, revision: record.revision + 1 })
  }

  function saveRuntimeConfig(next) {
    const resolved = runtime.getStore() || resolution()
    if (resolved.personaId !== persona.activeId() || resolved.personaGeneration !== persona.scopeGeneration()) fail('SETTINGS_CONFLICT')
    if (!available) {
      if (resolved.runtimeMode === 'profile') fail('SETTINGS_MIGRATION_UNAVAILABLE')
      if (typeof setConfig !== 'function') fail('SETTINGS_WRITE_UNAVAILABLE')
      return setConfig(next)
    }
    const current = applyResolution(clone(getConfig()), resolved)
    const changes = {}
    for (const field of SETTINGS_FIELDS.filter(field => field.storage === 'config.json')) {
      const value = getPath(next, field.path)
      if (!same(value, getPath(current, field.path))) changes[field.path] = masked(field) ? { op: 'set', value } : value
    }
    if (!Object.keys(changes).length) return { config: resolveConfig(), issues: [] }
    const owners = new Set(Object.keys(changes).map(path => owner(fields.get(path))))
    if (owners.size !== 1) fail('SETTINGS_MULTI_OWNER')
    const scope = [...owners][0]
    const result = patch({ scope, id: resolved.personaId,
      revision: scope === 'profile' ? resolved.profileRevision : rawView(scope).revision, patch: changes })
    return { config: resolveConfig(), issues: result.issues }
  }

  function initialize(id, copyFrom = '') {
    requireAvailable()
    const values = snapshotProfile(getConfig(), persona.getById(id))
    const source = copyFrom && read(copyFrom)
    if (source) {
      Object.assign(values, clone(source.values))
      values['cognition.persona.profile.displayName'] = persona.getById(id).profile.displayName
    }
    store.put(kind(id), PROFILE_SETTINGS_ID, { version: 1, migrationVersion: 1, runtimeVersion: 1, revision: 1, sourceHash: hash(values), values })
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
      const record = runtimeRecord(id)
      if (!record) fail('SETTINGS_MIGRATION_UNAVAILABLE')
      return { values: resolution(id).values, revision: record.revision, selected }
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
    return { ok: true, scope, ...(scope === 'profile' ? { id, activeId: persona.activeId() } : {}), revision, values: dto, ...status() }
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
        if (changed.length) {
          // Mirror expression fields to the persona record for legacy readers and
          // fallback, without re-entering persona hooks or applying twice.
          if (changed.some(path => personaFields.some(field => field.path === path))) {
            const next = clone(store.get('persona', id))
            for (const field of personaFields) if (Object.hasOwn(values, field.path)) setPath(next, field.path.slice('cognition.persona.'.length), values[field.path])
            const sanitized = sanitizePersona(next, getConfig()?.cognition)
            for (const field of personaFields) if (changed.includes(field.path)) values[field.path] = clone(getPath(sanitized, field.path.slice('cognition.persona.'.length)))
            store.put('persona', id, sanitized)
          }
          store.put(kind(id), PROFILE_SETTINGS_ID, { ...latest, values, revision: latest.revision + 1 })
        }
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
    const resolved = resolution(id)
    const config = resolved.runtimeMode === 'profile' ? applyResolution(clone(getConfig()), resolved) : clone(getConfig())
    let profileRevision = 0
    if (available) { try { profileRevision = read(id)?.revision || 0 } catch { runtimeRecord(id) } }
    return { ok: true, config: publicConfig(config), personaId: id,
      revision: hash([id, persona.scopeGeneration(), profileRevision, getConfig()]), ...status() }
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

  // Public diagnostic captures are redacted, frozen and never persisted on turns.
  function captureResolved(resolved) {
    const effective = publicConfig(applyResolution(clone(getConfig()), resolved))
    return freeze({ personaId: resolved.personaId, profileRevision: resolved.profileRevision,
      runtimeMode: resolved.runtimeMode, editingAvailable: resolved.runtimeMode === 'profile',
      effective, candidate: clone(effective) })
  }

  function capture(id = persona.activeId()) { return captureResolved(resolution(id)) }

  function schema() {
    return { ok: true, fields: clone(SETTINGS_FIELDS), groups: clone(SETTINGS_GROUPS),
      profileStorage: { kind: PROFILE_SETTINGS_KIND, id: PROFILE_SETTINGS_ID, namespace: 'persona', schemaVersion: 1 }, ...status() }
  }
  return { migrate, status, initialize, view, patch, legacyView, legacySave, capture, schema, resolveConfig, withRuntime, runtimePersonaId, runtimePersona, personaView, personaSaved, saveRuntimeConfig }
}
