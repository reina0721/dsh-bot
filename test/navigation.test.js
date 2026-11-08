import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_TARGET, LEGACY_TABS, LEGACY_COGNITION_SECTIONS, LEGACY_CONFIG_GROUPS,
  LEGACY_ALIASES, LEGACY_MODULE_IDS, LEGACY_ANCHORS, SETTINGS_FIELDS,
} from '../src/core/settings-schema.js'
import { go, goTo, resolveAlias, normalizeNavigation } from '../src/core/navigation.js'

const target = (area, section, extra = {}) => ({ area, section, ...extra })
const expanded = value => value.moduleId && ['config', 'detail'].includes(value.anchor)
  ? { ...value, anchor: `ob-module-${value.anchor}` } : { ...value }

test('all 15 tabs and their old tab/panel anchors have canonical destinations', () => {
  const expected = {
    overview: ['overview', 'overview'], connect: ['system', 'connection'],
    messages: ['chat', 'messages'], media: ['data', 'media'], content: ['data', 'content'],
    modules: ['extensions', 'modules'], backup: ['data', 'backup'], security: ['system', 'security'],
    config: ['system', 'general'], persona: ['profiles', 'library'], models: ['system', 'models'],
    settings: ['system', 'appearance'], cognition: ['profiles', 'overview'], logs: ['data', 'logs'], about: ['system', 'about'],
  }
  assert.equal(Object.keys(expected).length, Object.keys(LEGACY_TABS).length)
  for (const [id, [area, section]] of Object.entries(expected)) {
    for (const alias of [id, `tab:${id}`, `ob-tab-${id}`, `ob-panel-${id}`, `#ob-tab-${id}`]) {
      assert.deepEqual(go(alias), target(area, section), alias)
    }
    assert.deepEqual(goTo({ tab: id }), target(area, section))
  }
})

test('all 15 cognition subsections resolve independently of colliding top-level names', () => {
  for (const section of Object.keys(LEGACY_COGNITION_SECTIONS)) {
    const expected = target('profiles', section)
    assert.deepEqual(goTo({ tab: 'cognition', section }), expected, section)
    assert.deepEqual(go(`cognition:${section}`), expected)
    assert.deepEqual(go('cognition', section), expected)
  }
  assert.deepEqual(go('overview'), target('overview', 'overview'))
  assert.deepEqual(go('settings'), target('system', 'appearance'))
  assert.deepEqual(go('cognition:settings'), target('profiles', 'settings'))
})

test('all 31 config groups resolve via config and all 17 cog groups via old go/goTo forms', () => {
  const expected = {
    'system/general': ['basic'], 'system/connection': ['endpoint', 'snowluma'],
    'system/timeouts': ['timeouts'], 'data/events': ['events'], 'data/logs': ['logging'],
    'system/appearance': ['ui'], 'system/security': ['security', 'sandbox'], 'system/access': ['access', 'cog-permissions', 'cog-admin'],
    'system/runtime': ['runtime'], 'system/media': ['media'], 'data/backup': ['ops'],
    'profiles/general': ['cog-core'], 'profiles/models': ['cog-llm'], 'profiles/turn': ['cog-turn'],
    'profiles/reply': ['cog-reply'], 'profiles/purpose': ['cog-purpose'], 'profiles/persona': ['cog-persona'],
    'profiles/emotion': ['cog-emotion'], 'profiles/relationships': ['cog-relationship'],
    'profiles/memories': ['cog-memory'], 'data/import': ['cog-import'], 'profiles/policy': ['cog-policy'],
    'data/privacy': ['cog-privacy'],
    'module/builtin-media-features': ['content'], 'module/builtin-reminders': ['cog-reminders'],
    'module/builtin-learning': ['cog-learning'], 'module/builtin-proactivity': ['cog-proactivity'],
  }
  assert.deepEqual(Object.values(expected).flat().sort(), Object.keys(LEGACY_CONFIG_GROUPS).sort())
  for (const [place, groups] of Object.entries(expected)) {
    const [area, section] = place.split('/')
    const wanted = area === 'module'
      ? target('extensions', 'module', { moduleId: section, anchor: 'ob-module-config' }) : target(area, section)
    for (const group of groups) {
      assert.deepEqual(go(`group:${group}`), wanted, group)
      assert.deepEqual(go('config', group), wanted)
      assert.deepEqual(goTo({ tab: 'config', section: group }), wanted)
      assert.deepEqual(goTo({ tab: 'config', anchor: group }), wanted)
      if (group.startsWith('cog-')) {
        assert.deepEqual(go('cognition', group), wanted)
        assert.deepEqual(goTo({ tab: 'cognition', section: 'settings', anchor: group }), wanted)
        assert.deepEqual(goTo({ tab: 'cognition', section: group }), wanted)
        assert.deepEqual(goTo({ tab: 'ob-tab-cognition', section: 'settings', anchor: group }), wanted)
      }
    }
  }
  assert.deepEqual(go('media'), target('data', 'media'))
  assert.deepEqual(go('group:media'), target('system', 'media'))
})

test('every field alias leads to the single editable owner, including mixed legacy groups', () => {
  for (const field of SETTINGS_FIELDS) {
    const expected = expanded({ ...field.canonical, fieldPath: field.path })
    for (const alias of field.aliases) {
      assert.deepEqual(resolveAlias(alias), { ...field.canonical, fieldPath: field.path }, alias)
      assert.deepEqual(go(alias), expected, alias)
    }
    assert.deepEqual(goTo(expected), expected, field.path)
  }
})

test('all static aliases are resolvable; generic module anchors require a concrete module', () => {
  for (const [alias, expected] of Object.entries(LEGACY_ALIASES)) {
    assert.deepEqual(resolveAlias(alias), expected, alias)
    if (expected.section === 'module' && !expected.moduleId) assert.deepEqual(go(alias), DEFAULT_TARGET)
    else assert.deepEqual(go(alias), expanded(expected), alias)
  }
  for (const moduleId of LEGACY_MODULE_IDS) {
    assert.deepEqual(go(moduleId), target('extensions', 'module', { moduleId, anchor: 'ob-module-detail' }))
    for (const name of ['detail', 'config', 'panel', 'reminders']) {
      const expected = target('extensions', 'module', { moduleId, anchor: `ob-module-${name}` })
      for (const anchor of [name, `ob-module-${name}`]) assert.deepEqual(goTo({ tab: 'modules', moduleId, anchor }), expected)
      assert.deepEqual(goTo({ tab: 'modules', moduleId, section: name }), expected)
    }
  }
  const moduleId = 'Local.Module_v2:ABC-123'
  assert.deepEqual(goTo({ tab: 'modules', moduleId }), target('extensions', 'module', { moduleId, anchor: 'ob-module-detail' }))
  assert.deepEqual(goTo({ tab: 'logs', moduleId }), DEFAULT_TARGET)
})

test('media, learning and appearance anchors support short and existing full IDs', () => {
  for (const anchor of ['stickers', 'ob-media-stickers']) {
    assert.deepEqual(goTo({ tab: 'media', anchor }), LEGACY_ANCHORS['ob-media-stickers'])
  }
  for (const name of ['unknowns', 'tasks', 'claims']) for (const anchor of [name, `ob-cog-${name}`]) {
    const expected = target('profiles', 'learning', { anchor: `ob-cog-${name}` })
    assert.deepEqual(goTo({ tab: 'cognition', section: 'learning', anchor }), expected)
    assert.deepEqual(goTo({ tab: 'cognition', anchor }), expected)
  }
  for (const section of ['appearance', 'layout', 'data', 'motion', 'reset']) {
    assert.deepEqual(goTo({ tab: 'settings', section }), target('system', 'appearance', { anchor: section }))
  }
  assert.deepEqual(goTo({ tab: 'logs', anchor: 'ob-media-stickers' }), DEFAULT_TARGET)
  assert.deepEqual(goTo({ tab: 'cognition', section: 'persona', anchor: 'tasks' }), DEFAULT_TARGET)
})

test('decision/task IDs remain opaque and exact; dynamic anchors infer the right subsection', () => {
  for (const [name, section, key] of [['decision', 'policy', 'decisionId'], ['task', 'learning', 'taskId']]) {
    for (const id of ['ABC_01:part.v2-3', 'a', 'a'.repeat(64)]) {
      const expected = target('profiles', section, { [key]: id })
      assert.deepEqual(goTo({ tab: 'cognition', section, [key]: id }), expected)
      assert.deepEqual(goTo({ tab: 'cognition', [key]: id }), expected)
      const anchor = `ob-cog-${name}-${id}`
      const anchored = { ...expected, anchor }
      assert.deepEqual(go(anchor), anchored)
      assert.deepEqual(goTo({ tab: 'cognition', section, anchor }), anchored)
      assert.deepEqual(goTo({ tab: 'cognition', section, anchor: `${name}-${id}`, [key]: id }), anchored)
      assert.deepEqual(goTo(anchored), anchored)
      assert.deepEqual(goTo({ tab: 'cognition', section, anchor, [key]: 'different' }), DEFAULT_TARGET)
    }
    const longestId = 'Z'.repeat(96)
    assert.deepEqual(goTo({ tab: 'cognition', section, [key]: longestId }), target('profiles', section, { [key]: longestId }))
    assert.equal(resolveAlias(`ob-cog-${name}-${longestId}`), null)
  }
  assert.deepEqual(goTo({ tab: 'cognition', section: 'policy', taskId: 'task' }), DEFAULT_TARGET)
  assert.deepEqual(goTo({ tab: 'cognition', decisionId: 'd', taskId: 't' }), DEFAULT_TARGET)
})

test('unknown, malformed, inherited and conflicting input falls back without retaining IDs or throwing', () => {
  for (const value of [undefined, null, false, 1, '', [], new Date(), {},
    { tab: 'missing', decisionId: 'old' }, { tab: '__proto__' }, { tab: 'constructor' },
    { tab: 'cognition', section: 'missing' }, { tab: 'config', section: 'missing' },
    { tab: 'media', anchor: 'ob-media-missing' }, { tab: 'modules', anchor: 'config' },
    { tab: 'cognition', decisionId: '../escape' }, { tab: 'modules', moduleId: 'a'.repeat(97) },
    { tab: 'modules', moduleId: '<script>' }, { tab: 'config', section: 1 },
    { tab: 'config', anchor: {} }, { tab: 'config', unknown: true },
    { area: 'missing', section: 'overview' }, { area: 'system', section: 'missing' },
    { area: 'system', section: 'general', tab: 'config' }, Object.create({ tab: 'config' }),
    { area: 'system', section: 'general', fieldPath: 'media.enabled' },
    { tab: 'cognition', section: 'settings', anchor: 'cog-learning', moduleId: 'wrong' },
    { tab: 'config', section: 'cog-learning', moduleId: 'builtin-learning', anchor: 'cog-proactivity' },
    { tab: 'config', fieldPath: 'onebot.wsToken', anchor: 'cog-learning' },
    { get tab() { throw new Error('untrusted getter') } },
  ]) assert.deepEqual(goTo(value), DEFAULT_TARGET)
  for (const id of ['missing', '__proto__', 'constructor', '../config', ' config', '<script>', 1, null]) {
    assert.deepEqual(go(id), DEFAULT_TARGET)
    assert.equal(resolveAlias(id), null)
  }
  assert.deepEqual(go('config', {}), DEFAULT_TARGET)
  const result = go('missing')
  result.section = 'mutated'
  assert.deepEqual(go('missing'), DEFAULT_TARGET)
})

test('canonical normalization is idempotent, immutable and has no navigation/action side effects', () => {
  assert.equal(normalizeNavigation, goTo)
  const input = Object.freeze({ tab: 'modules', moduleId: 'builtin-learning', anchor: 'config' })
  const first = goTo(input)
  assert.deepEqual(goTo(first), first)
  assert.equal(input.anchor, 'config')
  assert.deepEqual(goTo({ area: 'system' }), target('system', 'general'))
  assert.deepEqual(goTo(Object.assign(Object.create(null), { tab: 'config' })), target('system', 'general'))
})

test('navigation URL reload preserves outer DSH routes, query and opaque identities', async () => {
  const { readNavigationUrl, navigationUrl } = await import('../src/core/navigation.js')
  for (const outer of ['https://dsh.local/work?host=keep#/main/onebot-qq', 'https://dsh.local/main/onebot-qq?x=1#outer']) {
    for (const input of [go('config'), go('cognition'), goTo({ tab: 'modules', moduleId: 'Local.v2:ABC', anchor: 'config' }), goTo({ tab: 'cognition', taskId: 'Task:ABC-1', anchor: 'tasks' })]) {
      const next = new URL(navigationUrl(outer, input), outer), before = new URL(outer)
      assert.equal(next.pathname, before.pathname)
      assert.equal(next.hash, before.hash)
      for (const [key, value] of before.searchParams) assert.equal(next.searchParams.get(key), value)
      assert.deepEqual(readNavigationUrl(next.href), input)
    }
  }
  assert.deepEqual(readNavigationUrl('https://local/#ob-tab-config'), go('config'))
  assert.deepEqual(readNavigationUrl('https://local/?ob-nav=invalid#/main/onebot-qq'), DEFAULT_TARGET)
  assert.deepEqual(readNavigationUrl('https://local/?ob-nav=%7B%22area%22:%22bad%22%7D'), DEFAULT_TARGET)
})

test('history adapter handles same-area updates, back/forward, reload and listener cleanup', async () => {
  const { createNavigationHistory, readNavigationUrl } = await import('../src/core/navigation.js')
  const listeners = new Map(), changes = [], entries = ['https://local/?host=keep#/main/onebot-qq']
  let position = 0
  const outerState = { route: 'main', host: { key: 3 } }
  const host = { location: { href: entries[0] },
    addEventListener: (name, listener) => listeners.set(name, listener), removeEventListener: (name, listener) => { assert.equal(listeners.get(name), listener); listeners.delete(name) },
    history: { state: outerState, pushState(state, _title, path) { assert.equal(state, outerState); entries.splice(++position); entries.push(new URL(path, host.location.href).href); host.location.href = entries[position] } } }
  const history = createNavigationHistory(host, value => changes.push(value))
  const first = goTo({ tab: 'cognition', section: 'learning', taskId: 'Task:A', anchor: 'tasks' })
  const second = { ...first, taskId: 'Task:B' }
  history.navigate(first); history.navigate(second)
  assert.deepEqual(changes, [first, second])
  host.location.href = entries[--position]; listeners.get('popstate')()
  assert.deepEqual(changes.at(-1), first)
  host.location.href = entries[++position]; listeners.get('popstate')()
  assert.deepEqual(changes.at(-1), second)
  assert.deepEqual(readNavigationUrl(host.location.href), second)
  history.navigate({ tab: 'invalid', moduleId: 'stale' })
  assert.deepEqual(changes.at(-1), DEFAULT_TARGET)
  history.dispose(); assert.equal(listeners.size, 0)
})

test('search indexes section labels, legacy aliases and every field path without values', async () => {
  const { navigationSearchIndex, searchNavigation } = await import('../src/core/navigation.js')
  for (const field of SETTINGS_FIELDS) assert.ok(searchNavigation(field.path).some(row => row.target.fieldPath === field.path), field.path)
  for (const [alias, destination] of Object.entries(LEGACY_ALIASES)) {
    if (destination.section === 'module' && !destination.moduleId) continue
    assert.ok(searchNavigation(alias).some(row => row.terms.includes(alias)), alias)
  }
  assert.ok(searchNavigation('旧配置', { config: '旧配置' }).some(row => row.target.area === 'system'))
  assert.ok(searchNavigation('回复分段', { 'cognition.reply.split': '回复分段' }).some(row => row.target.moduleId === 'builtin-reply-delivery'))
  assert.equal(searchNavigation('SAMPLE_SECRET_VALUE').length, 0)
  assert.deepEqual(searchNavigation('   '), [])
  assert.ok(navigationSearchIndex().every(row => Object.keys(row).sort().join(',') === 'label,target,terms'))
})
