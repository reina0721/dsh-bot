// Shared normalization for the WebUI and legacy feature links.
import {
  DEFAULT_TARGET, NAVIGATION_REGISTRY, LEGACY_ALIASES, LEGACY_TABS,
  LEGACY_COGNITION_SECTIONS, LEGACY_CONFIG_GROUPS, LEGACY_MODULE_IDS,
  LEGACY_ANCHORS, LEGACY_SETTINGS_SECTIONS, SETTINGS_FIELDS, isCanonicalDestination,
} from './settings-schema.js'

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/
const fieldAliases = new Map(SETTINGS_FIELDS.flatMap(field => field.aliases.map(alias => [
  alias, { ...field.canonical, fieldPath: field.path },
])))
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined
const copy = target => target ? { ...target } : null
const fallback = () => ({ ...DEFAULT_TARGET })

/** Unambiguous namespaces are preferred; bare names prefer tabs, then groups. */
export function resolveAlias(value) {
  if (typeof value !== 'string' || !value) return null
  const id = value.startsWith('#') ? value.slice(1) : value
  return copy(own(LEGACY_ALIASES, id) || fieldAliases.get(id)
    || own(LEGACY_TABS, id) || own(LEGACY_CONFIG_GROUPS, id)
    || own(LEGACY_COGNITION_SECTIONS, id)
    || (LEGACY_MODULE_IDS.includes(id) ? LEGACY_ALIASES[`module:${id}`] : null)
    || dynamicAnchor(id))
}

function dynamicAnchor(anchor) {
  const match = /^(ob-cog-(decision|task)-)(.+)$/.exec(anchor)
  if (!match || !ID.test(anchor) || !ID.test(match[3])) return null
  return {
    area: 'profiles', section: match[2] === 'decision' ? 'policy' : 'learning',
    anchor, [match[2] === 'decision' ? 'decisionId' : 'taskId']: match[3],
  }
}

function samePlace(a, b) {
  return a.area === b.area && a.section === b.section
    && (!a.moduleId || !b.moduleId || a.moduleId === b.moduleId)
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return null
  const allowed = ['tab', 'area', 'section', 'moduleId', 'anchor', 'decisionId', 'taskId', 'fieldPath']
  if (Object.keys(input).some(key => !allowed.includes(key))) return null
  for (const key of allowed) {
    if (input[key] != null && input[key] !== '' && (typeof input[key] !== 'string'
      || (key !== 'fieldPath' && !ID.test(input[key])))) return null
  }
  const canonical = Boolean(input.area)
  const legacyTab = input.tab?.replace(/^(?:tab:|ob-tab-|ob-panel-)/, '')
  if (canonical && input.tab) return null
  let target = canonical
    ? { area: input.area, section: input.section || NAVIGATION_REGISTRY.find(area => area.id === input.area)?.sections[0].id }
    : resolveAlias(input.tab)
  if (!target) return null

  // Legacy section names live in their tab's namespace. A section may be a
  // config group, whose landing destination can belong to another area.
  if (!canonical && input.section) {
    const tab = legacyTab
    let sectionTarget
    if (tab === 'cognition') sectionTarget = own(LEGACY_COGNITION_SECTIONS, input.section)
      || (input.section.startsWith('cog-') && own(LEGACY_CONFIG_GROUPS, input.section))
    else if (tab === 'config') sectionTarget = own(LEGACY_CONFIG_GROUPS, input.section)
    else if (tab === 'settings') sectionTarget = own(LEGACY_SETTINGS_SECTIONS, input.section)
    else if (tab === 'modules' && ['detail', 'config', 'panel', 'reminders'].includes(input.section)) {
      sectionTarget = { area: 'extensions', section: 'module', anchor: `ob-module-${input.section}` }
    } else if (tab === 'media' && input.section === 'stickers') sectionTarget = LEGACY_ANCHORS['ob-media-stickers']
    if (!sectionTarget) return null
    target = { ...sectionTarget }
  }
  if (!isCanonicalDestination(target)) return null

  if (input.moduleId) {
    if (target.area !== 'extensions' || !['modules', 'module'].includes(target.section)
      || (target.moduleId && target.moduleId !== input.moduleId)) return null
    target = { ...target, section: 'module', moduleId: input.moduleId }
  }

  if (input.fieldPath) {
    const field = fieldAliases.get(input.fieldPath)
    if (!field || (canonical && !samePlace(target, field))
      || (input.moduleId && input.moduleId !== field.moduleId)) return null
    target = { ...field }
  }

  if (input.anchor) {
    const anchor = input.anchor
    // Old go('cognition', group) used section=settings, anchor=cog-*.
    const group = own(LEGACY_CONFIG_GROUPS, anchor)
    if (group && !canonical && (legacyTab === 'config'
      || (legacyTab === 'cognition' && (!input.section || input.section === 'settings')))) {
      target = { ...group }
    } else {
      const prefixed = anchor.startsWith('ob-') ? anchor
        : target.area === 'extensions' ? `ob-module-${anchor}`
          : target.area === 'profiles' ? `ob-cog-${anchor}`
            : target.area === 'data' && target.section === 'media' ? `ob-media-${anchor}` : anchor
      const anchorTarget = own(LEGACY_ANCHORS, prefixed) || dynamicAnchor(prefixed)
      if (anchorTarget) {
        // An unqualified cognition link may infer its subsection from the anchor.
        const infer = !canonical && legacyTab === 'cognition' && !input.section
        if (!infer && !samePlace(target, anchorTarget)) return null
        target = { ...target, ...anchorTarget, ...(target.moduleId ? { moduleId: target.moduleId } : {}) }
      } else if (target.area === 'system' && target.section === 'appearance'
        && own(LEGACY_SETTINGS_SECTIONS, anchor)) target.anchor = anchor
      else return null
    }
  }

  if (input.decisionId && input.taskId) return null
  for (const [key, section] of [['decisionId', 'policy'], ['taskId', 'learning']]) {
    if (!input[key]) continue
    if (target.area !== 'profiles' || (target.section !== section
      && (canonical || input.section || input.anchor))) return null
    if (target[key] && target[key] !== input[key]) return null
    target = { ...target, section, [key]: input[key] }
  }
  if (target.area === 'extensions' && target.section === 'module') {
    // Generic module anchors are templates; selecting a concrete module is
    // required before scrolling. External local module IDs remain opaque.
    if (!target.moduleId) return null
    if (!target.anchor) target.anchor = 'ob-module-detail'
    if (['detail', 'config', 'panel', 'reminders'].includes(target.anchor)) target.anchor = `ob-module-${target.anchor}`
  }
  // Later aliases must not silently replace an explicitly selected identity.
  if (input.moduleId && target.moduleId !== input.moduleId) return null
  if (input.fieldPath) {
    const field = fieldAliases.get(input.fieldPath)
    if (!samePlace(target, field)) return null
    target.fieldPath = field.fieldPath
  }
  return target
}

/** Unknown/malformed input returns Overview, with no stale IDs or side effects. */
export function goTo(target) {
  try { return normalize(target) || fallback() } catch { return fallback() }
}

/** Compatibility with both go(tab) and go(tab, configGroup). */
export function go(id, group = '') {
  if (typeof id !== 'string' || typeof group !== 'string') return fallback()
  if (!group) {
    const alias = resolveAlias(id)
    return alias ? goTo(alias) : fallback()
  }
  return goTo({ tab: id, ...(id === 'cognition' && group.startsWith('cog-')
    ? { section: 'settings', anchor: group } : { section: group }) })
}

export const normalizeNavigation = goTo


// Only this query parameter belongs to the panel. The host path/hash/state stay intact.
export const NAVIGATION_PARAM = 'ob-nav'
export function readNavigationUrl(href) {
  try {
    const url = new URL(href, 'http://localhost')
    const value = url.searchParams.get(NAVIGATION_PARAM)
    if (value !== null) return goTo(JSON.parse(value))
    return go(decodeURIComponent(url.hash.slice(1)))
  } catch { return fallback() }
}
export function navigationUrl(href, target) {
  const url = new URL(href, 'http://localhost')
  url.searchParams.set(NAVIGATION_PARAM, JSON.stringify(goTo(target)))
  return url.pathname + url.search + url.hash
}
export function createNavigationHistory(host, onChange) {
  const read = () => onChange(readNavigationUrl(host.location.href))
  host.addEventListener('popstate', read)
  host.addEventListener('hashchange', read)
  return {
    navigate(input) {
      const target = goTo(input)
      host.history.pushState(host.history.state, '', navigationUrl(host.location.href, target))
      onChange(target)
      return target
    },
    dispose() {
      host.removeEventListener('popstate', read)
      host.removeEventListener('hashchange', read)
    },
  }
}

// Metadata is explicitly projected: neither current settings nor defaults enter search.
export function navigationSearchIndex(labels = {}) {
  const rows = NAVIGATION_REGISTRY.flatMap(area => area.sections
    .filter(section => section.id !== 'module' && !(area.id === 'profiles' && section.id === 'settings'))
    .map(section => ({ label: area.label + ' / ' + (labels[section.id] || section.id), target: { area: area.id, section: section.id }, terms: area.label + ' ' + section.id + ' ' + (labels[section.id] || '') })))
  for (const [alias, target] of Object.entries(LEGACY_ALIASES)) {
    if (target.section === 'module' && !target.moduleId) continue
    const row = rows.find(row => samePlace(row.target, target))
    if (row) row.terms += ' ' + alias + ' ' + (labels[alias.replace(/^tab:/, '')] || '')
    else rows.push({ label: labels[alias] || alias, target: goTo(target), terms: alias + ' ' + (labels[alias] || '') })
  }
  for (const field of SETTINGS_FIELDS) rows.push({
    label: labels[field.path] || field.path, target: { ...field.canonical, fieldPath: field.path },
    terms: [field.path, labels[field.path] || '', field.legacyGroup || '', labels['group:' + field.legacyGroup] || '', ...field.aliases].join(' '),
  })
  return rows
}
export function searchNavigation(query, labels = {}) {
  const terms = typeof query === 'string' ? query.trim().toLowerCase().split(/\s+/).filter(Boolean) : []
  return terms.length ? navigationSearchIndex(labels).filter(row => terms.every(term => (row.label + ' ' + row.terms).toLowerCase().includes(term))) : []
}
