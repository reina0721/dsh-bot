// Pure metadata contract. No module loaders, filesystem access or config values.
import { createHash } from 'node:crypto'
import { ID_RE } from './manifest.js'

export const MAX_UI_BYTES = 64 * 1024
export const UI_HOOKS = Object.freeze(['module.card', 'module.detail', 'module.config', 'module.actions', 'module.panel'])
const RENDERERS = new Set(['status', 'schema'])
const BINDINGS = new Set(['none', 'legacy-core', 'module-file'])
const STATUSES = new Set(['disabled', 'loading', 'loaded', 'blocked', 'error'])
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const emptyConfig = () => ({ binding: 'none', schemaVersion: null, available: false })

function invalid() { throw new Error('MODULE_UI_INVALID') }

// Reject executable/non-JSON values before serialization, including getters/toJSON.
function jsonOnly(value, depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (!value || typeof value !== 'object' || depth > 8) invalid()
  if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid()
  if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index)))) invalid()
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue
    const property = Object.getOwnPropertyDescriptor(value, key)
    if (typeof key !== 'string' || !property.enumerable || !('value' in property)) invalid()
    jsonOnly(property.value, depth + 1)
  }
}

function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid()
}

/** v1 accepts metadata only; future renderers/capabilities require a new contract. */
export function validateWebuiDescriptor(raw, { source } = {}) {
  if (!['builtin', 'external'].includes(source)) invalid()
  jsonOnly(raw)
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_UI_BYTES) invalid()
  keys(raw, ['version', 'config', 'surfaces', 'requestedCapabilities'])
  if (raw.version !== 1) invalid()
  const config = raw.config === undefined ? emptyConfig() : raw.config
  keys(config, ['binding', 'schemaVersion', 'available'])
  if (!BINDINGS.has(config.binding) || typeof config.available !== 'boolean') invalid()
  if (config.schemaVersion !== null && (!Number.isSafeInteger(config.schemaVersion) || config.schemaVersion < 1)) invalid()
  if (config.binding === 'none' && (config.available || config.schemaVersion !== null)) invalid()
  if (config.binding === 'legacy-core' && (source !== 'builtin' || config.available)) invalid()
  // External config editing is not implemented. Opt-in cannot grant it.
  if (source === 'external' && config.available) invalid()
  const requested = raw.requestedCapabilities === undefined ? [] : raw.requestedCapabilities
  // Phase 1 has no UI capabilities. Backend module permissions are independent.
  if (!Array.isArray(requested) || requested.length) invalid()
  const surfaces = raw.surfaces === undefined ? [] : raw.surfaces
  if (!Array.isArray(surfaces) || surfaces.length > 5) invalid()
  const ids = new Set(), hooks = new Set()
  const normalized = surfaces.map((surface) => {
    keys(surface, ['id', 'hook', 'renderer', 'order'])
    if (typeof surface.id !== 'string' || !ID_RE.test(surface.id) || ids.has(surface.id)) invalid()
    if (!UI_HOOKS.includes(surface.hook) || hooks.has(surface.hook) || !RENDERERS.has(surface.renderer)) invalid()
    const order = surface.order === undefined ? 0 : surface.order
    if (!Number.isInteger(order) || order < -100 || order > 100) invalid()
    ids.add(surface.id); hooks.add(surface.hook)
    return { id: surface.id, hook: surface.hook, renderer: surface.renderer, order }
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  return { version: 1, config: { binding: config.binding, schemaVersion: config.schemaVersion, available: config.available }, surfaces: normalized, requestedCapabilities: [] }
}

/** Called only when the registry/manifest is loaded, never by catalog reads. */
export function loadWebuiDescriptor(raw, options) {
  if (raw === undefined) return { ui: null, uiRevision: 'none', uiWarning: '' }
  try {
    const ui = validateWebuiDescriptor(raw, options)
    return { ui, uiRevision: hash(ui), uiWarning: '' }
  } catch {
    // Fixed warning: do not reflect descriptor contents, paths or secrets.
    return { ui: null, uiRevision: 'invalid', uiWarning: 'MODULE_UI_INVALID' }
  }
}

/** Build fresh bounded public items from already validated kernel records. */
export function buildModuleUiCatalog(records) {
  const items = [...records].filter((record) => ID_RE.test(record.id)).map((record) => ({
    moduleId: record.id,
    source: record.source === 'builtin' ? 'builtin' : 'external',
    trust: record.source === 'builtin' ? 'builtin' : 'external',
    generation: record.generation,
    uiRevision: record.uiRevision || 'none',
    status: STATUSES.has(record.status) ? record.status : 'error',
    config: record.ui ? { ...record.ui.config } : emptyConfig(),
    surfaces: record.ui ? record.ui.surfaces.map((surface) => ({ ...surface })) : [],
    requestedCapabilities: [], grantedCapabilities: [],
    uiWarning: record.uiWarning ? 'MODULE_UI_INVALID' : '',
  })).sort((a, b) => a.moduleId.localeCompare(b.moduleId))
  return { version: 1, catalogRevision: hash(items), items }
}
