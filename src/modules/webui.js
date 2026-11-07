// Pure metadata contract. No module loaders, filesystem access or config values.
import { createHash } from 'node:crypto'
import { ID_RE } from './manifest.js'

export const MAX_UI_BYTES = 64 * 1024
export const UI_HOOKS = Object.freeze(['module.card', 'module.detail', 'module.config', 'module.actions', 'module.panel'])
export const BUILTIN_COMPONENT_KEYS = Object.freeze(['reply-delivery.preview', 'typing.preview', 'reminders.preview', 'sample.preview'])
const COMPONENT_KEY_RE = /^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9-]{0,31}$/
const RENDERERS = new Set(['status', 'schema', 'builtin-react', 'sandbox'])
const BINDINGS = new Set(['none', 'legacy-core', 'module-file'])
const STATUSES = new Set(['disabled', 'loading', 'loaded', 'blocked', 'error'])
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const emptyConfig = () => ({ binding: 'none', schemaVersion: null, available: false })

export function validSandboxEntry(entry) {
  return typeof entry === 'string' && entry.length <= 256 && entry.startsWith('webui/') && entry.endsWith('.html') && entry.split('/').length <= 9 && entry.split('/').every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && part !== '..')
}

export function sandboxEligible(record) {
  return record.source === 'external' && !record.builtin && record.ui?.sandbox && record.permissions?.includes('ui:sandbox') && record.ui.requestedCapabilities.includes('ui.sandbox')
}

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

/** v1 accepts metadata only, including keys into the trusted compile-time registry. */
export function validateWebuiDescriptor(raw, { source, configSchema = null } = {}) {
  if (!['builtin', 'external'].includes(source)) invalid()
  jsonOnly(raw)
  if (Buffer.byteLength(JSON.stringify(raw), 'utf8') > MAX_UI_BYTES) invalid()
  keys(raw, ['version', 'config', 'surfaces', 'requestedCapabilities', 'sandbox'])
  if (raw.version !== 1) invalid()
  const config = raw.config === undefined ? emptyConfig() : raw.config
  keys(config, ['binding', 'schemaVersion', 'available'])
  if (!BINDINGS.has(config.binding) || typeof config.available !== 'boolean') invalid()
  if (config.schemaVersion !== null && (!Number.isSafeInteger(config.schemaVersion) || config.schemaVersion < 1)) invalid()
  if (config.binding === 'none' && (config.available || config.schemaVersion !== null)) invalid()
  if (config.binding === 'legacy-core' && source !== 'builtin') invalid()
  // Schema is validated by the loader; UI metadata cannot grant config access.
  if (source === 'external' && config.available && (!configSchema || config.binding !== 'module-file' || config.schemaVersion !== 1)) invalid()
  const requested = raw.requestedCapabilities === undefined ? [] : raw.requestedCapabilities
  if (!Array.isArray(requested) || requested.length > 1 || requested.some((cap) => cap !== 'ui.sandbox') || (source !== 'external' && requested.length)) invalid()
  if (raw.sandbox !== undefined) {
    keys(raw.sandbox, ['entry'])
    if (source !== 'external' || !validSandboxEntry(raw.sandbox.entry) || !requested.includes('ui.sandbox')) invalid()
  } else if (requested.length) invalid()
  const surfaces = raw.surfaces === undefined ? [] : raw.surfaces
  if (!Array.isArray(surfaces) || surfaces.length > 5) invalid()
  const ids = new Set(), hooks = new Set()
  let sandboxCount = 0
  const normalized = surfaces.map((surface) => {
    keys(surface, ['id', 'hook', 'renderer', 'order', 'componentKey'])
    if (typeof surface.id !== 'string' || !ID_RE.test(surface.id) || ids.has(surface.id)) invalid()
    if (!UI_HOOKS.includes(surface.hook) || hooks.has(surface.hook) || !RENDERERS.has(surface.renderer)) invalid()
    if (source === 'external' && surface.hook === 'module.config' && surface.renderer === 'schema' && !configSchema) invalid()
    if (surface.renderer === 'sandbox') {
      if (source !== 'external' || !raw.sandbox || !['module.panel', 'module.detail'].includes(surface.hook) || ++sandboxCount > 1) invalid()
    }
    if (surface.renderer === 'builtin-react') {
      if (source !== 'builtin' || typeof surface.componentKey !== 'string' || surface.componentKey.length > 64 || !COMPONENT_KEY_RE.test(surface.componentKey) || !BUILTIN_COMPONENT_KEYS.includes(surface.componentKey)) invalid()
    } else if (Object.hasOwn(surface, 'componentKey')) invalid()
    const order = surface.order === undefined ? 0 : surface.order
    if (!Number.isInteger(order) || order < -100 || order > 100) invalid()
    ids.add(surface.id); hooks.add(surface.hook)
    return { id: surface.id, hook: surface.hook, renderer: surface.renderer, order, ...(surface.renderer === 'builtin-react' ? { componentKey: surface.componentKey } : {}) }
  }).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  if (raw.sandbox && sandboxCount !== 1) invalid()
  return { ...(raw.sandbox ? { sandbox: { entry: raw.sandbox.entry } } : {}), version: 1, config: { binding: config.binding, schemaVersion: config.schemaVersion, available: config.available }, surfaces: normalized, requestedCapabilities: [...requested] }
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
export function buildModuleUiCatalog(records, grantFor = () => false) {
  const items = [...records].filter((record) => ID_RE.test(record.id)).map((record) => ({
    moduleId: record.id,
    source: record.source === 'builtin' ? 'builtin' : 'external',
    trust: record.source === 'builtin' ? 'builtin' : 'external',
    generation: record.generation,
    uiRevision: record.uiRevision || 'none',
    status: STATUSES.has(record.status) ? record.status : 'error',
    config: record.ui ? { ...record.ui.config } : emptyConfig(),
    surfaces: record.ui ? record.ui.surfaces.map(({ id, hook, renderer, order, componentKey }) => ({ id, hook, renderer, order, ...(renderer === 'builtin-react' ? { componentKey } : {}) })) : [],
    requestedCapabilities: record.ui ? [...record.ui.requestedCapabilities] : [],
    grantedCapabilities: grantFor(record) ? ['ui.sandbox'] : [],
    ...(record.ui?.sandbox ? { sandbox: { entry: record.ui.sandbox.entry, available: Boolean(record.uiArtifactHash), reason: !sandboxEligible(record) ? '缺少 ui:sandbox 权限' : !record.uiArtifactHash ? '隔离 UI 资源不可用，请重载模块' : !grantFor(record) ? '未授权或授权已失效，请确认后启用隔离 WebUI' : '' } } : {}),
    uiWarning: record.uiWarning ? 'MODULE_UI_INVALID' : '',
  })).sort((a, b) => a.moduleId.localeCompare(b.moduleId))
  return { version: 1, catalogRevision: hash(items), items }
}
