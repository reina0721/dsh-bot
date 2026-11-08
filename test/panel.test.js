// dsh-bot 网页半边单元测试（node:test，不依赖浏览器 / 真实网关）
//
// 做法：伪造 window.__ModuleLoader__ 捕获插件注册对象，用极简 React shim 执行 factory，
// 然后断言导出的纯函数、样式契约与 apply 的 slot 注册形状。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { go as contractGo, goTo as contractGoTo } from '../src/core/navigation.js'
import { SETTINGS_FIELDS, LEGACY_ALIASES, NAVIGATION_REGISTRY, LEGACY_TABS, LEGACY_COGNITION_SECTIONS, LEGACY_CONFIG_GROUPS, LEGACY_MODULE_IDS } from '../src/core/settings-schema.js'
import { CONFIG_GROUPS, DEFAULTS } from '../src/core/config.js'
import { DIMENSIONS } from '../src/cognition/relationships.js'
import { BUILTIN_COMPONENT_KEYS } from '../src/modules/webui.js'

let captured = null
globalThis.window = {
  __DSH_BOT_BRAND__: '小葵',
  __ModuleLoader__: {
    load(registration) {
      captured = registration
    },
  },
}

let stateOverrides = null
let hookSession = null

function shimState(initial) {
  if (!hookSession) return [stateOverrides?.length ? stateOverrides.shift() : typeof initial === 'function' ? initial() : initial, () => {}]
  const session = hookSession, index = session.index++
  if (!(index in session.values)) session.values[index] = typeof initial === 'function' ? initial() : initial
  return [session.values[index], (next) => { session.values[index] = typeof next === 'function' ? next(session.values[index]) : next }]
}

// Keep editor state/ref values across explicit renders without a browser or React dependency.
function mountNode(node) {
  const session = { values: [], index: 0 }
  return () => {
    session.index = 0
    hookSession = session
    try { return node.type(node.props) } finally { hookSession = null }
  }
}

const treeNodes = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(treeNodes) : [tree, ...treeNodes(tree.children)]
const control = (tree, text) => {
  const node = treeNodes(tree).find((node) => node.children?.includes(text) && typeof node.props?.onClick === 'function')
  assert.ok(node, 'missing control: ' + text)
  return node
}
const field = (tree, label) => {
  const node = treeNodes(tree).find((node) => node.props?.['aria-label'] === label)
  assert.ok(node, 'missing field: ' + label)
  return node
}
function renderPersons(detail, toast = () => {}, selected = detail.person.id) {
  stateOverrides = ['', selected, { items: [detail.person] }, '', false, detail, '', false]
  try { return panel.CogPersons({ toast }) } finally { stateOverrides = null }
}
function renderRelationships(items, toast = () => {}) {
  stateOverrides = [{ items }, '', false]
  try { return panel.CogRelationships({ toast }) } finally { stateOverrides = null }
}
const facetFixture = (scopeType = 'group') => ({ id: 'facet-1', personId: 'person-1', facet: 'impression', value: '原印象', confidence: 0.8, status: 'active', evidenceKind: 'observation', scopeType, scopeId: scopeType === 'group' ? '123' : '456' })
const relationshipFixture = (scopeType = 'group') => ({ id: 'person-1:' + scopeType + ':123', personId: 'person-1', scopeType, scopeId: scopeType === 'global' ? '' : '123', dimensions: Object.fromEntries(DIMENSIONS.map((key, index) => [key, index / 10])), summary: ['初识'], interactions: 1 })
function mockCognitionApi(calls, response = { ok: true }) {
  const original = globalThis.fetch
  globalThis.fetch = async (path, init) => {
    assert.ok(path.startsWith(panel.API_PREFIX + '/cognition/'), 'only local cognition API is allowed')
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    return { ok: true, json: async () => response }
  }
  return () => { globalThis.fetch = original }
}

const reactShim = {
  createElement: (type, props, ...children) => ({ type, props: props || null, children }),
  createContext: (defaultValue) => ({ Provider: 'Provider', Consumer: 'Consumer', _default: defaultValue }),
  useContext: () => ({ mode: 'full', systemReduced: false, categories: { screen: true, async: true, reveal: true, swap: true, feedback: true, media: true } }),
  useState: shimState,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useRef: (initial) => hookSession ? shimState(() => ({ current: initial === undefined ? null : initial }))[0] : ({ current: initial === undefined ? null : initial }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  Fragment: Symbol('Fragment'),
  Component: class Component {
    constructor(props) {
      this.props = props
      this.state = {}
    }
    setState() {}
  },
}

const requireShim = (name) => {
  if (name === 'react') return reactShim
  throw new Error('unexpected module: ' + name)
}

await import('../client.js')

const registration = captured
const panel = registration ? registration.factory(requireShim) : null

test('CogMemories: import panel scopes, file size gate, payload, counts/error and refresh', async () => {
  const calls = [], originalFetch = globalThis.fetch
  const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)]
  const file = { size: 100, text: async () => '[{"text":"old archive"}]' }
  const render = ({ archiveFile = file, scope = 'global', scopeId = '', result = null, error = '', kind = 'memory' } = {}) => {
    stateOverrides = ['query', 'semantic', { items: [] }, false, '', archiveFile, scope, scopeId, false, result, error, kind]
    try { return panel.CogMemories({ toast() {} }) } finally { stateOverrides = null }
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    return { ok: true, json: async () => ({ ok: true, imported: 1, skipped: 0, invalid: 0, bytes: 100, items: [] }) }
  }
  try {
    const tree = render(), all = nodes(tree), json = JSON.stringify(tree)
    assert.match(json, /导入旧档案/); assert.match(json, /当前人格/); assert.match(json, /幂等/); assert.match(json, /不上传到外部服务/)
    assert.equal(field(tree, '导入种类').props.value, 'memory')
    assert.deepEqual(nodes(field(tree, '导入种类')).filter((node) => node.type === 'option').map((node) => node.props.value), ['memory', 'timeline'])
    const input = all.find((node) => node.props?.type === 'file')
    assert.equal(input.props.accept, '.json,.jsonl,.txt')
    const select = all.find((node) => node.props?.['aria-label'] === '导入作用域')
    assert.equal(select.props.value, 'global')
    assert.deepEqual(nodes(select).filter((node) => node.type === 'option').map((node) => node.props.value), ['global', 'private', 'group'])
    assert.equal(all.some((node) => node.props?.['aria-label'] === '导入作用域 ID'), false)
    await all.find((node) => node.children?.includes('导入')).props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/cognition/import', method: 'POST', body: { format: 'auto', kind: 'memory', content: '[{"text":"old archive"}]', scopeType: 'global', scopeId: '' } })
    assert.equal(calls[1].method, 'GET')
    assert.match(calls[1].path, /query=query&type=semantic/)
    for (const scope of ['private', 'group']) {
      const scoped = nodes(render({ scope, scopeId: '12345' }))
      assert.equal(scoped.find((node) => node.props?.['aria-label'] === '导入作用域 ID').props.value, '12345')
      await scoped.find((node) => node.children?.includes('导入')).props.onClick()
      assert.equal(calls.at(-2).body.scopeType, scope)
      assert.equal(calls.at(-2).body.scopeId, '12345')
    }
    await control(render({ kind: 'timeline' }), '导入').props.onClick()
    assert.equal(calls.at(-2).body.kind, 'timeline')
    const mounted = mountNode({ type: panel.CogMemories, props: { toast() {} } })
    field(mounted(), '旧档案文件').props.onChange({ target: { files: [file] } })
    field(mounted(), '导入种类').props.onChange({ target: { value: 'timeline' } })
    assert.equal(field(mounted(), '导入种类').props.value, 'timeline')
    await control(mounted(), '导入').props.onClick()
    assert.equal(calls.at(-2).body.kind, 'timeline')
    assert.match(JSON.stringify(render({ result: { kind: 'timeline', imported: 2, skipped: 0, invalid: 1, bytes: 90 } })), /时间轴导入 2/)
    const previous = calls.length
    for (const options of [{ archiveFile: { size: 5242881, text: () => { throw new Error('must not read oversized file') } } }, { scope: 'group', scopeId: 'bad' }, { archiveFile: null }]) {
      await nodes(render(options)).find((node) => node.children?.includes('导入')).props.onClick()
    }
    assert.equal(calls.length, previous)
    assert.match(JSON.stringify(render({ result: { imported: 3, skipped: 2, invalid: 1, bytes: 100 } })), /导入 3 · 跳过 2 · 无效 1 · 字节 100/)
    assert.match(JSON.stringify(render({ error: '导入旧档案已禁用' })), /导入旧档案已禁用/)
  } finally { globalThis.fetch = originalFetch }
})

test('CogPersons: group/private facet editors save Unicode content and refresh the same person without scope edits', async () => {
  const calls = [], restore = mockCognitionApi(calls)
  try {
    for (const scopeType of ['group', 'private']) {
      const facet = facetFixture(scopeType), detail = { person: { id: facet.personId, displayName: '测试人物' }, identities: [], facets: [facet] }
      const parent = renderPersons(detail)
      const editorNode = treeNodes(parent).find((node) => node.type?.name === 'CogPersonFacet')
      assert.ok(editorNode)
      assert.equal(editorNode.props.personId, facet.personId)
      const render = mountNode(editorNode)
      let tree = render()
      assert.match(JSON.stringify(tree), new RegExp(scopeType + ':' + facet.scopeId))
      assert.ok(control(tree, '删除此项'))
      control(tree, '编辑').props.onClick()
      tree = render()
      assert.equal(field(tree, '画像内容').props.value, '原印象')
      assert.equal(field(tree, '画像置信度').props.min, 0)
      assert.equal(field(tree, '画像置信度').props.max, 1)
      assert.deepEqual(treeNodes(field(tree, '画像状态')).filter((node) => node.type === 'option').map((node) => node.props.value), ['', 'active', 'disputed'])
      assert.equal(treeNodes(tree).filter((node) => ['input', 'textarea', 'select'].includes(node.type)).length, 3)
      const previous = calls.length, value = '😀'.repeat(2000)
      field(tree, '画像内容').props.onChange({ target: { value } })
      field(render(), '画像置信度').props.onChange({ target: { value: scopeType === 'group' ? '0' : '1' } })
      field(render(), '画像状态').props.onChange({ target: { value: 'disputed' } })
      assert.equal(calls.length, previous, 'editing must not auto-save')
      await control(render(), '保存').props.onClick()
      assert.deepEqual(calls[previous], { path: panel.API_PREFIX + '/cognition/person/correct-facet', method: 'POST', body: { personId: facet.personId, facetId: facet.id, patch: { value, confidence: scopeType === 'group' ? 0 : 1, status: 'disputed', actor: 'ui' } } })
      assert.deepEqual(calls[previous + 1], { path: panel.API_PREFIX + '/cognition/person?personId=person-1', method: 'GET', body: undefined })
      assert.ok(control(render(), '编辑'))
    }
    const stale = renderPersons({ person: { id: 'old-person' }, facets: [facetFixture()] }, () => {}, 'new-person')
    assert.equal(treeNodes(stale).some((node) => node.type?.name === 'CogPersonFacet'), false, 'stale detail cannot be edited under another person')
  } finally { restore() }
})

test('CogPersons: facet validation, cancel, optional status and existing deletion use mocked APIs', async () => {
  const calls = [], toasts = [], restore = mockCognitionApi(calls)
  try {
    const facet = { ...facetFixture(), status: 'outdated' }, detail = { person: { id: facet.personId }, facets: [facet] }
    const render = mountNode(treeNodes(renderPersons(detail, (...args) => toasts.push(args))).find((node) => node.type?.name === 'CogPersonFacet'))
    control(render(), '编辑').props.onClick()
    for (const value of ['', '😀'.repeat(2001)]) {
      field(render(), '画像内容').props.onChange({ target: { value } })
      await control(render(), '保存').props.onClick()
    }
    field(render(), '画像内容').props.onChange({ target: { value: '修正印象' } })
    for (const value of ['', '-0.1', '1.1', 'NaN']) {
      field(render(), '画像置信度').props.onChange({ target: { value } })
      await control(render(), '保存').props.onClick()
    }
    assert.equal(calls.length, 0)
    assert.equal(toasts.length, 6)
    assert.ok(toasts.every(([, tone]) => tone === 'err'))
    control(render(), '取消').props.onClick()
    control(render(), '编辑').props.onClick()
    assert.equal(field(render(), '画像内容').props.value, facet.value)
    assert.equal(field(render(), '画像状态').props.value, '')
    await control(render(), '保存').props.onClick()
    assert.equal(Object.hasOwn(calls[0].body.patch, 'status'), false, 'outdated status is preserved unless explicitly changed')
    await control(render(), '删除此项').props.onClick()
    assert.deepEqual(calls[2].body, { personId: facet.personId, facetId: facet.id })
    assert.equal(calls[2].path, panel.API_PREFIX + '/cognition/person/delete-facet')
    assert.equal(calls[3].method, 'GET')
  } finally { restore() }
})

test('CogPersons: pending save disables editor/delete controls, prevents duplicates and retains draft on API errors', async () => {
  const original = globalThis.fetch, calls = [], toasts = []
  let release
  globalThis.fetch = (path) => { calls.push(path); return new Promise((resolve) => { release = resolve }) }
  try {
    const facet = facetFixture(), detail = { person: { id: facet.personId }, facets: [facet] }
    const render = mountNode(treeNodes(renderPersons(detail, (...args) => toasts.push(args))).find((node) => node.type?.name === 'CogPersonFacet'))
    control(render(), '编辑').props.onClick()
    field(render(), '画像内容').props.onChange({ target: { value: '保留草稿' } })
    const save = control(render(), '保存').props.onClick, pending = save()
    await save()
    assert.equal(calls.length, 1)
    for (const node of treeNodes(render()).filter((node) => ['input', 'select', 'textarea'].includes(node.type) || node.type?.name === 'Btn')) assert.ok(node.props.disabled || node.props.busy)
    release({ ok: true, json: async () => ({ ok: false, message: '修正失败' }) })
    await pending
    assert.equal(calls.length, 1, 'failed save does not refresh')
    assert.equal(field(render(), '画像内容').props.value, '保留草稿')
    assert.match(toasts.at(-1)[0], /修正失败/)
    assert.equal(control(render(), '保存').props.busy, false)
  } finally { globalThis.fetch = original }
})

test('CogRelationships: all API dimensions have manual sliders; only changed dimensions save within the original scope', async () => {
  const calls = [], restore = mockCognitionApi(calls)
  try {
    const items = ['global', 'group', 'private'].map(relationshipFixture)
    const cards = treeNodes(renderRelationships(items)).filter((node) => node.type?.name === 'CogRelationshipCard')
    assert.equal(cards.length, 3)
    for (const card of cards) {
      const render = mountNode(card), previous = calls.length
      assert.equal(treeNodes(render()).filter((node) => node.type?.name === 'CogBar').length, DIMENSIONS.length)
      control(render(), '调整').props.onClick()
      const tree = render(), sliders = treeNodes(tree).filter((node) => node.props?.type === 'range')
      assert.deepEqual(sliders.map((node) => node.props['aria-label'].replace('调整关系 ', '')), DIMENSIONS)
      for (const slider of sliders) {
        assert.equal(slider.props.min, -1); assert.equal(slider.props.max, 1)
        assert.equal(slider.props.value, card.props.item.dimensions[slider.props['aria-label'].replace('调整关系 ', '')])
      }
      assert.equal(treeNodes(tree).filter((node) => ['input', 'select', 'textarea'].includes(node.type)).length, DIMENSIONS.length)
      assert.match(JSON.stringify(tree), /source=ui/)
      assert.match(JSON.stringify(tree), /记录历史/)
      assert.equal(control(tree, '保存').props.disabled, true)
      await control(tree, '保存').props.onClick()
      field(tree, '调整关系 affinity').props.onChange({ target: { value: '-1' } })
      field(render(), '调整关系 trust').props.onChange({ target: { value: '1' } })
      field(render(), '调整关系 respect').props.onChange({ target: { value: '-0.8' } })
      field(render(), '调整关系 respect').props.onChange({ target: { value: String(card.props.item.dimensions.respect) } })
      assert.equal(calls.length, previous, 'sliders and unchanged save must not apply changes')
      await control(render(), '保存').props.onClick()
      assert.deepEqual(calls[previous], { path: panel.API_PREFIX + '/cognition/relationship/adjust', method: 'POST', body: { personId: card.props.item.personId, patch: { scopeType: card.props.item.scopeType, scopeId: card.props.item.scopeId, affinity: -1, trust: 1 } } })
      assert.deepEqual(calls[previous + 1], { path: panel.API_PREFIX + '/cognition/relationships', method: 'GET', body: undefined })
      assert.ok(control(render(), '调整'))
    }
  } finally { restore() }
})

test('CogRelationships: cancel discards draft and invalid dimensions never reach the API', async () => {
  const calls = [], toasts = [], restore = mockCognitionApi(calls)
  try {
    const item = relationshipFixture()
    const render = mountNode(treeNodes(renderRelationships([item], (...args) => toasts.push(args))).find((node) => node.type?.name === 'CogRelationshipCard'))
    control(render(), '调整').props.onClick()
    for (const value of ['NaN', '-1.1', '1.1']) {
      field(render(), '调整关系 affinity').props.onChange({ target: { value } })
      await control(render(), '保存').props.onClick()
    }
    assert.equal(calls.length, 0)
    assert.equal(toasts.length, 3)
    control(render(), '取消').props.onClick()
    control(render(), '调整').props.onClick()
    assert.equal(field(render(), '调整关系 affinity').props.value, item.dimensions.affinity)
    assert.equal(control(render(), '保存').props.disabled, true)
    assert.equal(calls.length, 0)
  } finally { restore() }
})

test('CogRelationships: pending save disables controls, prevents duplicates and shows network failure without losing draft', async () => {
  const original = globalThis.fetch, calls = [], toasts = []
  let rejectFetch
  globalThis.fetch = (path) => { calls.push(path); return new Promise((resolve, reject) => { rejectFetch = reject }) }
  try {
    const render = mountNode(treeNodes(renderRelationships([relationshipFixture()], (...args) => toasts.push(args))).find((node) => node.type?.name === 'CogRelationshipCard'))
    control(render(), '调整').props.onClick()
    field(render(), '调整关系 affinity').props.onChange({ target: { value: '0.75' } })
    const save = control(render(), '保存').props.onClick, pending = save()
    await save()
    for (const node of treeNodes(render()).filter((node) => node.props?.type === 'range' || node.type?.name === 'Btn')) assert.ok(node.props.disabled || node.props.busy)
    rejectFetch(new Error('offline'))
    await pending
    assert.equal(calls.length, 1)
    assert.equal(field(render(), '调整关系 affinity').props.value, 0.75)
    assert.match(toasts.at(-1)[0], /offline/)
    assert.equal(toasts.at(-1)[1], 'err')
    assert.equal(control(render(), '保存').props.busy, false)
  } finally { globalThis.fetch = original }
})

test('module loader：id 与 factory 形状正确', () => {
  assert.ok(registration, 'client.js 应该调用 window.__ModuleLoader__.load')
  assert.equal(registration.id, 'dsh-bot')
  assert.equal(typeof registration.factory, 'function')
  assert.ok(panel, 'factory 应该返回 module.exports')
  assert.equal(typeof panel, 'object')
})

test('导出契约：inject / apply / 组件 / 纯函数齐全', () => {
  assert.deepEqual(panel.inject, ['slots', 'theme'])
  assert.equal(typeof panel.apply, 'function')
  assert.equal(typeof panel.OneBotPage, 'function')
  assert.equal(typeof panel.OneBotIcon, 'function')
  assert.equal(panel.PANEL_ID, 'onebot-qq')
  assert.equal(panel.API_PREFIX, '/onebot-qq/api')
  for (const name of [
    'getByPath',
    'setByPath',
    'deepEqual',
    'buildFieldSpecs',
    'flattenFieldSpecs',
    'fieldSpecByPath',
    'defaultsFromGroups',
    'computeRefreshMs',
    'mergeConfigSave',
    'parseApiResponse',
    'formatTime',
    'formatDuration',
    'formatRelative',
    'maskEndpoint',
    'describeEvent',
    'normalizeLogEntry',
    'mergeIncremental',
    'nextSince',
    'describeProbe',
    'describeDetect',
    'resolveMotionMode',
    'resolveContrast',
    'motionCategories',
    'motionDisabled',
    'shouldAnimate',
    'revealDelayMs',
    'countUpValue',
    'easeOutCubic',
    'nextPresence',
    'pageTransitionClass',
    'contentTransitionFor',
    'applyConfigPatch',
    'settingsSections',
    'accentValues',
    'fontScalePercent',
    'densityMetrics',
    'contentMaxWidth',
    'normalizeUiPreferences',
    'uiRootData',
    'splitBufferValue',
    'formatCount',
    'formatNumberList',
    'bindClientTheme',
  ]) {
    assert.equal(typeof panel[name], 'function', name + ' 应该是导出的函数')
  }
  assert.equal(typeof panel.SettingsTab, 'function', '系统设置组件应导出')
  assert.equal(typeof panel.SettingsShell, 'function', '持久设置壳组件应导出')
  assert.equal(typeof panel.ContentPage, 'function', '内容页组件应导出')
  assert.equal(typeof panel.TOKEN_CSS, 'string')
  assert.equal(typeof panel.MOTION_CSS, 'string')
  assert.equal(typeof panel.ACCENT_TOKENS, 'object')
  assert.equal(typeof panel.DEFAULT_UI, 'object')
  assert.equal(panel.DEFAULT_UI.contrast, 'system')
  assert.deepEqual(
    panel.TABS.map((tab) => tab.id),
    ['overview', 'chat', 'profiles', 'extensions', 'data', 'system'],
  )
})

test('回归：module.exports 不能有 Config 属性（Cordis 把它当配置 schema，会让客户端插件激活失败）', () => {
  // Cordis 的 validateConfig 是：if (!runtime.Config) return config; runtime.Config['~standard'].validate(...)。
  // 面板组件曾经叫 Config 并挂到 exports.Config，导致真实 DSH 里 client entry 激活即崩溃
  // （TypeError: Cannot read properties of undefined (reading 'validate')），这里锁死这个坑。
  assert.equal(panel.Config, undefined, 'exports 上不能出现 Config（Cordis 保留字）')
  assert.equal(typeof panel.ConfigTab, 'function', '配置页组件应导出为 ConfigTab')
})

test('apply：注册 sidebar.panellist 与 main 两个 slot', () => {
  const injected = []
  const registered = []
  const slots = {
    inject(name, register) {
      injected.push(name)
      assert.equal(typeof register, 'function')
      register()
    },
    register(def, component) {
      registered.push({ def, component })
      return def
    },
  }
  const ctx = {
    get(key) {
      return key === 'slots' ? slots : undefined
    },
    effect() {
      return () => {}
    },
  }
  assert.doesNotThrow(() => panel.apply(ctx))
  assert.deepEqual(injected, ['main', 'sidebar.panellist'])
  assert.equal(registered.length, 2)

  const main = registered.find((entry) => entry.def.name === 'main')
  assert.ok(main, '应该注册 main')
  assert.equal(main.def.key, 'onebot-qq')
  assert.equal(typeof main.component, 'function')

  const sidebar = registered.find((entry) => entry.def.name === 'sidebar.panellist')
  assert.ok(sidebar, '应该注册 sidebar.panellist')
  assert.equal(sidebar.def.id, 'onebot-qq')
  assert.equal(sidebar.def.order, 20)
  assert.equal(typeof sidebar.def.label, 'function')
  assert.equal(sidebar.def.label(), '小葵')
  assert.equal(typeof sidebar.component, 'function')
})

test('six-area root mounts grouped navigation inside the branded two-slot shell', () => {
  stateOverrides = ['overview', { brand: '葵' }, {}]
  let nodes
  try { nodes = treeNodes(panel.OneBotPage()) } finally { stateOverrides = null }
  const header = nodes.find(node => node.type?.name === 'PageHeader')
  assert.equal(header.props.title, '概览')
  assert.equal(header.props.eyebrow, 'Overview')
  assert.ok(nodes.some(node => node.type === panel.NavigationMenu))
  assert.equal(nodes.some(node => node.type?.name === 'Tabs'), false)
  assert.ok(nodes.some(node => node.props?.role === 'region' && node.props.id === 'ob-panel-overview-overview'))
})

test('面板品牌：factory 清理注入名称并回退 dsh-bot', () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, '__DSH_BOT_BRAND__')
  const sidebarLabel = () => {
    let label
    registration.factory(requireShim).apply({ slots: {
      inject: (_name, register) => register(),
      register: (def) => { if (def.name === 'sidebar.panellist') label = def.label() },
    } })
    return label
  }
  try {
    for (const [value, expected] of [[undefined, 'dsh-bot'], [null, 'dsh-bot'], [{}, 'dsh-bot'], [' \n\u0000 ', 'dsh-bot'], [' \u0000小葵\n\u007f\u0085 ', '小葵'], ['😀'.repeat(41), '😀'.repeat(40)]]) {
      window.__DSH_BOT_BRAND__ = value
      assert.equal(sidebarLabel(), expected)
    }
    Object.defineProperty(window, '__DSH_BOT_BRAND__', { configurable: true, get() { throw new Error('unavailable') } })
    assert.equal(sidebarLabel(), 'dsh-bot')
  } finally {
    Object.defineProperty(window, '__DSH_BOT_BRAND__', descriptor)
  }
})

test('apply：兼容 ctx.slots 写法，缺 slots 时不抛错', () => {
  const registered = []
  const slots = {
    inject(name, register) {
      register()
    },
    register(def) {
      registered.push(def)
      return def
    },
  }
  assert.doesNotThrow(() => panel.apply({ slots }))
  assert.equal(registered.length, 2)
  assert.doesNotThrow(() => panel.apply({}))
  assert.doesNotThrow(() => panel.apply(null))
})

test('OneBotPage：无网关/无 document 时可安全渲染加载骨架', () => {
  let tree = null
  assert.doesNotThrow(() => {
    tree = panel.OneBotPage()
  })
  assert.ok(tree && typeof tree === 'object')
  const json = JSON.stringify(tree)
  assert.match(json, /ob-root/)
  assert.match(json, /ob-header/, '首屏应渲染页头骨架')
  assert.match(json, /ob-stat-grid/, '首屏应渲染统计骨架')
  assert.doesNotMatch(json, /ob-tabs/, '首屏骨架不渲染真实标签栏')
  const icon = panel.OneBotIcon({ size: 18 })
  assert.ok(icon && typeof icon === 'object')
  assert.equal(icon.props.name, 'message', '侧栏图标应渲染消息图标')
})

test('全部标签页：无数据与有数据都能渲染（不依赖真实网关）', () => {  const noop = () => {}
  const baseProps = {
    status: null,
    configInfo: null,
    draft: null,
    updateDraft: noop,
    toast: noop,
    go: noop,
    gatewayAction: async () => ({ ok: true }),
    refreshAll: noop,
    refreshStatus: noop,
    runWithProgress: (task) => task(),
    now: Date.now(),
    saving: false,
    dirty: false,
    issues: [],
    save: noop,
    reset: noop,
    undo: noop,
    saveUiPatch: () => Promise.resolve(true),
    retryPrefSave: noop,
    prefStatus: { saving: false, error: '', savedAt: 0 },
  }
  const tabNames = ['Overview', 'Connect', 'Messages', 'MediaPage', 'ModulesPage', 'ContentPage', 'BackupPage', 'SecurityPage', 'ConfigTab', 'PersonaTab', 'ModelTab', 'SettingsTab', 'CognitionTab', 'Logs', 'About']
  for (const name of tabNames) {
    assert.equal(typeof panel[name], 'function', name + ' 应该导出')
    assert.doesNotThrow(() => panel[name](baseProps), name + ' 空数据应可渲染')
  }

  const groups = [
    {
      id: 'basic',
      title: '基本',
      description: '基础配置',
      fields: [
        { path: 'enabled', label: '启用', type: 'switch', default: true },
        { path: 'gateway', label: '网关', type: 'select', default: 'onebot', options: [{ value: 'onebot', label: '地址' }, { value: 'snowluma', label: 'SnowLuma' }] },
        { path: 'onebot.wsUrl', label: 'WS', type: 'text', default: '' },
        { path: 'onebot.wsToken', label: 'Token', type: 'secret', default: '' },
        { path: 'ui.refreshMs', label: '刷新', type: 'number', default: 2000, min: 500, max: 60000, step: 250, unit: 'ms' },
        { path: 'events.ignoreUsers', label: '忽略', type: 'string-list', default: [] },
        { path: 'timeouts.retryDelaysMs', label: '重试', type: 'number-list', default: [1000] },
        { path: 'note', label: '备注', type: 'textarea', default: '' },
      ],
    },
    {
      id: 'ui',
      title: '界面偏好',
      description: '外观与动效',
      fields: [
        { path: 'ui.refreshMs', label: '刷新', type: 'number', default: 2000 },
        { path: 'ui.accent', label: '强调色', type: 'select', default: 'purple', options: [{ value: 'purple', label: '紫' }, { value: 'blue', label: '蓝' }, { value: 'inherit', label: '跟随 DSH' }] },
        { path: 'ui.contrast', label: '对比度', type: 'select', default: 'system', options: [{ value: 'system', label: '跟随系统' }, { value: 'high', label: '高对比度' }] },
        { path: 'ui.density', label: '密度', type: 'select', default: 'standard', options: [{ value: 'compact', label: '紧凑' }, { value: 'standard', label: '标准' }] },
        { path: 'ui.fontScale', label: '字号', type: 'select', default: 'standard', options: [{ value: 'small', label: '小' }, { value: 'standard', label: '标准' }] },
        { path: 'ui.contentWidth', label: '内容宽度', type: 'select', default: 'wide', options: [{ value: 'wide', label: '宽' }, { value: 'auto', label: '自动' }] },
        { path: 'ui.motion', label: '动效模式', type: 'select', default: 'system', options: [{ value: 'system', label: '跟随系统' }, { value: 'full', label: '始终开启' }] },
        { path: 'ui.pageTransition', label: '页面切换动画', type: 'select', default: 'default', options: [{ value: 'default', label: '默认' }, { value: 'fade', label: '淡入' }] },
      ],
    },
  ]
  const config = {
    enabled: true,
    gateway: 'onebot',
    onebot: { wsUrl: 'ws://127.0.0.1:3001', wsToken: 'secret-token', httpUrl: '', httpToken: '' },
    ui: { refreshMs: 2000, accent: 'purple', contrast: 'system', density: 'standard', fontScale: 'standard', contentWidth: 'wide', motion: 'system', pageTransition: 'default' },
    events: { ignoreUsers: ['123'] },
    timeouts: { retryDelaysMs: [1000, 3000] },
  }
  const configInfo = { config, defaults: {}, groups, version: '0.1.0', apiVersion: 1, dataDir: 'C:\\data' }
  const status = {
    ok: true,
    apiVersion: 1,
    version: '0.1.0',
    dataDir: 'C:\\data',
    config,
    gateway: {
      state: 'connected',
      configured: true,
      endpoint: { mode: 'onebot', wsConfigured: true, httpConfigured: false, wsUrlSafe: 'ws://127.0.0.1:3001', httpUrlSafe: '' },
      connectedAt: Date.now() - 5000,
      lastDisconnectAt: 0,
      lastError: '',
      reconnects: 2,
      loginAttempts: 1,
      login: { userId: '10001', nickname: '机器人' },
      loginCheck: 'ok',
      expectedBotQQ: '10001',
      accountCheck: 'warn',
      snowluma: null,
    },
    events: {
      received: 10,
      accepted: 9,
      dropped: 1,
      byKind: { message: 8, notice: 1 },
      byChat: { private: 3, group: 6, other: 0 },
      buffered: 9,
      capacity: 200,
      lastAt: Date.now(),
    },
    logs: { total: 20, buffered: 20, byLevel: { debug: 0, info: 20, warn: 0, error: 0 } },
    recentEvents: [
      {
        seq: 1,
        kind: 'message',
        time: 1700000000,
        message: { chatType: 'private', chatId: 1, sender: { userId: 2, nickname: 'A' }, text: 'hi', segments: [{ type: 'text', data: { text: 'hi' } }] },
      },
    ],
  }
  const fullProps = Object.assign({}, baseProps, { status, configInfo, draft: JSON.parse(JSON.stringify(config)) })
  for (const name of tabNames) {
    let tree = null
    assert.doesNotThrow(() => {
      tree = panel[name](fullProps)
    }, name + ' 有数据应可渲染')
    assert.ok(tree && typeof tree === 'object', name + ' 应返回 React 元素')
  }
})

test('路径读写：getByPath / setByPath / deepEqual', () => {
  const source = { onebot: { wsUrl: 'ws://a' }, ui: { refreshMs: 2000 } }
  assert.equal(panel.getByPath(source, 'onebot.wsUrl'), 'ws://a')
  assert.equal(panel.getByPath(source, 'missing.deep.path'), undefined)

  const next = panel.setByPath(source, 'onebot.wsUrl', 'ws://b')
  assert.notEqual(next, source)
  assert.equal(next.onebot.wsUrl, 'ws://b')
  assert.equal(source.onebot.wsUrl, 'ws://a', 'setByPath 不能修改入参')
  assert.equal(panel.getByPath(panel.setByPath({}, 'a.b.c', 1), 'a.b.c'), 1)

  assert.equal(panel.deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), true)
  assert.equal(panel.deepEqual({ a: 1 }, { a: 1, b: undefined }), false)
  assert.equal(panel.deepEqual({ a: [1] }, { a: [1, 2] }), false)
  assert.equal(panel.deepEqual(null, null), true)
  assert.equal(panel.deepEqual(Number.NaN, Number.NaN), true)
})

test('buildFieldSpecs：数据驱动字段表降级/过滤/默认值', () => {
  const groups = [
    {
      id: 'basic',
      title: '基本',
      description: '基础配置',
      fields: [
        { path: 'enabled', label: '启用', type: 'switch', default: true, help: '帮助' },
        {
          path: 'gateway',
          label: '网关',
          type: 'select',
          default: 'onebot',
          options: [{ value: 'onebot', label: '地址' }, { value: 'snowluma' }],
        },
        { path: 'onebot.wsUrl', label: 'WS', type: 'text', default: '', placeholder: 'ws://127.0.0.1:3001' },
        { path: 'reconnect.minDelayMs', label: '等待', type: 'number', default: 2000, min: 500, max: 60000, step: 500, unit: 'ms' },
        { path: 'mystery', label: '未知类型', type: 'weird' },
        { label: '没有 path' },
        null,
      ],
    },
    { title: '没有 id', fields: [{ path: 'a.b', type: 'textarea' }] },
    { id: 'empty', fields: [] },
    'bad',
  ]
  const specs = panel.buildFieldSpecs(groups)
  assert.equal(specs.length, 2)
  assert.equal(specs[0].id, 'basic')
  assert.equal(specs[0].fields.length, 5, '没有 path 的字段应被跳过')
  const enabled = panel.fieldSpecByPath(groups, 'enabled')
  assert.equal(enabled.type, 'switch')
  assert.equal(enabled.default, true)
  assert.equal(enabled.help, '帮助')
  const gateway = panel.fieldSpecByPath(groups, 'gateway')
  assert.deepEqual(gateway.options, [
    { value: 'onebot', label: '地址' },
    { value: 'snowluma', label: 'snowluma' },
  ])
  const number = panel.fieldSpecByPath(groups, 'reconnect.minDelayMs')
  assert.equal(number.type, 'number')
  assert.equal(number.min, 500)
  assert.equal(number.max, 60000)
  assert.equal(number.step, 500)
  assert.equal(number.unit, 'ms')
  assert.equal(panel.fieldSpecByPath(groups, 'mystery').type, 'text', '未知 type 降级为 text')
  assert.equal(specs[1].id, 'group-1')
  assert.equal(specs[1].title, '没有 id')
  assert.equal(panel.flattenFieldSpecs(groups).length, 6)

  const defaults = panel.defaultsFromGroups(groups)
  assert.equal(defaults.enabled, true)
  assert.equal(defaults.gateway, 'onebot')
  assert.equal(defaults.onebot.wsUrl, '')
  assert.equal(defaults.reconnect.minDelayMs, 2000)
  assert.deepEqual(panel.buildFieldSpecs(null), [])
  assert.deepEqual(panel.buildFieldSpecs(undefined), [])
})

test('computeRefreshMs：取自配置并 clamp 500–60000', () => {
  assert.equal(panel.computeRefreshMs({ ui: { refreshMs: 100 } }), 500)
  assert.equal(panel.computeRefreshMs({ ui: { refreshMs: 999999 } }), 60000)
  assert.equal(panel.computeRefreshMs({ ui: { refreshMs: 2500 } }), 2500)
  assert.equal(panel.computeRefreshMs({ ui: { refreshMs: '3000' } }), 3000)
  assert.equal(panel.computeRefreshMs({}, [{ id: 'ui', fields: [{ path: 'ui.refreshMs', type: 'number', default: 3000 }] }]), 3000)
  assert.equal(panel.computeRefreshMs(undefined, undefined), 2000)
  assert.equal(panel.computeRefreshMs({ ui: { refreshMs: 'abc' } }, undefined, 7000), 7000)
})

test('parseApiResponse / mergeConfigSave：统一错误形状', () => {
  assert.equal(panel.parseApiResponse(null).ok, false)
  assert.equal(panel.parseApiResponse(undefined).message, '没有收到插件响应')
  const failed = panel.parseApiResponse({ ok: false, message: '只支持 POST' })
  assert.equal(failed.ok, false)
  assert.equal(failed.message, '只支持 POST')
  assert.equal(panel.parseApiResponse({ ok: false }).message, '操作失败')
  const good = panel.parseApiResponse({ ok: true, config: {} })
  assert.equal(good.ok, true)
  assert.equal(good.data.config !== undefined, true)

  const saved = panel.mergeConfigSave({ ok: true, config: { a: 1 }, issues: ['提示一', '', 2] })
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.config, { a: 1 })
  assert.deepEqual(saved.issues, ['提示一', '2'])
  const savedNoIssues = panel.mergeConfigSave({ ok: true, config: { b: 2 } })
  assert.deepEqual(savedNoIssues.issues, [])
  const saveFailed = panel.mergeConfigSave({ ok: false, message: '写盘失败' })
  assert.equal(saveFailed.ok, false)
  assert.equal(saveFailed.message, '写盘失败')
  assert.equal(saveFailed.config, null)
  assert.equal(panel.mergeConfigSave({ ok: true, config: [] }).config, null, '数组不是合法 config')
})

test('时间格式化：秒/毫秒时间戳与相对时间', () => {
  const time = panel.formatTime(1700000000000)
  assert.match(time, /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(panel.formatTime(1700000000), time, 'Unix 秒与毫秒应得到同一时刻')
  assert.equal(panel.formatTime('not-a-time'), '—')
  assert.match(panel.formatDateTime(1700000000000), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)

  const now = 1700000000000
  assert.equal(panel.formatRelative(now - 3000, now), '刚刚')
  assert.equal(panel.formatRelative(now - 120000, now), '2 分钟前')
  assert.equal(panel.formatRelative(now - 7200000, now), '2 小时前')
  assert.equal(panel.formatRelative(now - 3 * 86400000, now), '3 天前')
  assert.equal(panel.formatRelative(null, now), '—')

  assert.equal(panel.formatDuration(500), '500 毫秒')
  assert.equal(panel.formatDuration(1500), '1 秒')
  assert.equal(panel.formatDuration(90000), '1 分 30 秒')
  assert.equal(panel.formatDuration(3661000), '1 小时 1 分')
  assert.equal(panel.formatDuration(90000000), '1 天 1 小时')
  assert.equal(panel.formatDuration(-1), '—')
  assert.equal(panel.formatDuration('abc'), '—')
})

test('maskEndpoint / buildQuery / truncateText', () => {
  assert.equal(panel.maskEndpoint('ws://127.0.0.1:3001?access_token=secret'), 'ws://127.0.0.1:3001?access_token=***')
  assert.equal(panel.maskEndpoint('http://user:pass@example.com:3000/api?token=x&foo=1'), 'http://example.com:3000/api?token=***&foo=1')
  assert.equal(panel.maskEndpoint('ws://127.0.0.1:3001'), 'ws://127.0.0.1:3001')
  assert.equal(panel.maskEndpoint(''), '')
  assert.equal(panel.maskEndpoint(null), '')
  assert.equal(panel.maskEndpoint('http://x/?access_token=abc'), 'http://x?access_token=***')

  assert.equal(panel.buildQuery({ since: 0, limit: 50 }), '?since=0&limit=50')
  assert.equal(panel.buildQuery({ since: 0, level: '', limit: undefined }), '?since=0')
  assert.equal(panel.buildQuery({}), '')
  assert.equal(panel.truncateText('abcdef', 4), 'abc…')
  assert.equal(panel.truncateText('abc', 10), 'abc')
})

test('状态/核验/事件标签', () => {
  assert.equal(panel.stateLabel('connected').text, '已连接')
  assert.equal(panel.stateLabel('connected').tone, 'ok')
  assert.equal(panel.stateLabel('paused').tone, 'err')
  assert.equal(panel.stateLabel('weird').text, 'weird')
  assert.equal(panel.stateLabel('').text, '未知')
  assert.equal(panel.loginCheckLabel('ok').text, '核验通过')
  assert.equal(panel.loginCheckLabel('mismatch').tone, 'err')
  assert.equal(panel.loginCheckLabel('off').text, '未开启核验')
  assert.equal(panel.eventKindLabel('message'), '消息')
  assert.equal(panel.eventKindLabel('meta_event'), '元事件')
  assert.equal(panel.endpointModeLabel('snowluma'), '从 SnowLuma 读取')
  assert.equal(panel.accountCheckLabel('enforce'), '断开并暂停自动重连')
})

test('describeEvent：消息/通知/空事件都能得到可展示结构', () => {
  const messageEvent = {
    seq: 3,
    kind: 'message',
    time: 1700000000,
    message: {
      chatType: 'group',
      chatId: 123456,
      sender: { userId: 456, nickname: '小明', card: '' },
      text: '你好',
      segments: [
        { type: 'text', data: { text: '你好' } },
        { type: 'image', data: { url: 'http://example.com/a.png' } },
      ],
      mentions: [{ userId: '789', name: '小红' }],
      images: [{ url: 'http://example.com/a.png', summary: '图' }],
    },
  }
  const described = panel.describeEvent(messageEvent)
  assert.equal(described.seq, 3)
  assert.equal(described.kind, 'message')
  assert.equal(described.kindLabel, '消息')
  assert.equal(described.chatType, 'group')
  assert.equal(described.chatLabel, '群 123456')
  assert.equal(described.senderName, '小明')
  assert.equal(described.summary, '你好')
  assert.equal(described.segments.length, 2)
  assert.equal(described.mentions.length, 1)
  assert.equal(described.images.length, 1)
  assert.match(described.time, /^\d{2}:\d{2}:\d{2}$/)

  const noticeEvent = {
    seq: 4,
    kind: 'notice',
    notice: { type: 'notice', subType: 'group_increase', groupId: 111, userId: 222 },
  }
  const notice = panel.describeEvent(noticeEvent)
  assert.match(notice.summary, /\[通知\]/)
  assert.match(notice.summary, /group_increase/)
  assert.equal(notice.chatLabel, '群 111')

  const fallback = panel.describeEvent({ kind: 'request', request: { type: 'friend' } })
  assert.match(fallback.summary, /\[请求\]/)
  const empty = panel.describeEvent(null)
  assert.equal(empty.kind, 'unknown')
  assert.doesNotThrow(() => panel.describeEvent({}))
})

test('normalizeFriend / normalizeGroup / normalizeLogEntry', () => {
  assert.deepEqual(panel.normalizeFriend({ user_id: 10001, nickname: '昵称', remark: '备注' }), {
    id: '10001',
    name: '备注',
    nickname: '昵称',
    remark: '备注',
  })
  assert.equal(panel.normalizeFriend(null).id, '')
  assert.deepEqual(panel.normalizeGroup({ group_id: 888, group_name: '群名', member_count: 42 }), {
    id: '888',
    name: '群名',
    memberCount: 42,
  })
  assert.equal(panel.normalizeGroup({}).memberCount, null)

  const entry = panel.normalizeLogEntry({ seq: 1, t: 1700000000000, level: 'weird', area: 'gateway', text: 'hi' })
  assert.equal(entry.level, 'info')
  assert.equal(entry.area, 'gateway')
  assert.equal(entry.text, 'hi')
  assert.match(entry.time, /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(panel.normalizeLogEntry({ level: 'warn', time: '12:00:00' }).time, '12:00:00')
})

test('mergeIncremental / nextSince：增量去重与游标', () => {
  const merged = panel.mergeIncremental(
    [{ seq: 2, text: 'old' }, { seq: 1 }],
    [{ seq: 2, text: 'new' }, { seq: 3 }, { bad: true }],
  )
  assert.deepEqual(merged.map((item) => item.seq), [1, 2, 3])
  assert.equal(merged[1].text, 'new', '同 seq 用新数据覆盖')
  assert.deepEqual(panel.mergeIncremental(null, null), [])
  assert.equal(panel.nextSince([], 5), 5)
  assert.equal(panel.nextSince([{ seq: 1 }, { seq: 7 }], 0), 7)
  assert.equal(panel.nextSince(null, 3), 3)
})

test('probeEndpointFromDraft / describeProbe / describeDetect', () => {
  const endpoint = panel.probeEndpointFromDraft({ gateway: 'snowluma', onebot: { wsUrl: 'ws://a', httpUrl: 'http://b', wsToken: 't', httpToken: 'u', httpAuth: 'bearer' } })
  assert.equal(endpoint.mode, 'snowluma')
  assert.equal(endpoint.wsUrl, 'ws://a')
  assert.equal(endpoint.httpAuth, 'bearer')
  assert.deepEqual(panel.probeEndpointFromDraft(null), {
    mode: 'onebot',
    wsUrl: '',
    httpUrl: '',
    wsToken: '',
    httpToken: '',
    httpAuth: '',
  })

  // 真实 manager.probe() 形状：{ ok, url, httpStatus, elapsedMs, login, message }
  const probeOk = panel.describeProbe({
    ok: true,
    probe: { ok: true, url: 'http://127.0.0.1:3000/get_login_info', httpStatus: 200, elapsedMs: 12, login: { userId: '1', nickname: '机器人' } },
  })
  assert.equal(probeOk.ok, true)
  assert.equal(probeOk.endpointHint, 'http://127.0.0.1:3000/get_login_info')
  assert.equal(probeOk.httpStatus, 200)
  assert.equal(probeOk.elapsedMs, 12)
  assert.deepEqual(probeOk.login, { userId: '1', nickname: '机器人' })
  // 也兼容契约里提到的 endpointHint 字段
  assert.equal(panel.describeProbe({ ok: true, probe: { ok: true, endpointHint: 'http://hint' } }).endpointHint, 'http://hint')
  const probeFail = panel.describeProbe({ ok: true, probe: { ok: false, message: '连不上网关：ECONNREFUSED', url: 'http://127.0.0.1:3000' } })
  assert.equal(probeFail.ok, false)
  assert.equal(probeFail.error, '连不上网关：ECONNREFUSED')
  assert.equal(panel.describeProbe({ ok: false, message: '未开启' }).ok, false)

  // 真实 snowluma.detectGateway() 形状：endpoint 只有脱敏后的 safeUrl。
  const detect = panel.describeDetect({
    ok: true,
    mode: 'onebot',
    source: 'snowluma',
    reason: '',
    snowluma: { installed: true, dir: 'C:\\SnowLuma', version: '2.0.0', reason: '' },
    endpoint: { httpUrlSafe: 'http://127.0.0.1:3000', wsUrlSafe: 'ws://127.0.0.1:3001', httpConfigured: true, wsConfigured: true, source: 'snowluma' },
  })
  assert.equal(detect.ok, true)
  assert.equal(detect.snowluma.installed, true)
  assert.equal(detect.snowluma.dir, 'C:\\SnowLuma')
  assert.equal(detect.snowluma.endpointFound, true)
  assert.equal(detect.endpoint.httpUrl, 'http://127.0.0.1:3000')
  assert.equal(detect.endpoint.wsUrl, 'ws://127.0.0.1:3001')
  assert.equal(detect.endpoint.source, 'snowluma')
  assert.equal(panel.describeDetect({ ok: false, message: '检测失败' }).ok, false)
})

test('样式契约：令牌唯一色值 / 动效唯一 keyframes / 面板样式消费变量', () => {
  const token = panel.TOKEN_CSS
  const motion = panel.MOTION_CSS
  const css = panel.PANEL_CSS

  // 令牌块：console-web 浅色/暗色 palette、强调色、密度/字号/宽度与动效变量
  assert.match(token, /--ob-canvas:#f6f7fb/)
  assert.match(token, /--ob-surface:#ffffff/)
  assert.match(token, /body\[data-ds-dark-theme\] \.ob-root/)
  assert.match(token, /--ob-canvas:#0d111c/)
  for (const accent of ['purple', 'blue', 'green', 'orange', 'inherit']) {
    assert.match(token, new RegExp("\\[data-accent='" + accent + "'\\]"), '缺少强调色 ' + accent)
  }
  assert.match(token, /\[data-density='compact'\]/)
  assert.match(token, /\[data-density='comfortable'\]/)
  assert.match(token, /\[data-font-scale='large'\]/)
  assert.match(token, /\[data-content-width='wide'\]/)
  assert.match(token, /\[data-contrast='high'\]/)
  assert.match(token, /--ob-preview-light-canvas:/)
  assert.match(token, /--ob-preview-dark-canvas:/)
  assert.match(token, /--ob-dur-fast:120ms/)
  assert.match(token, /--ob-dur-standard:180ms/)
  assert.match(token, /--ob-dur-slow:240ms/)
  assert.match(token, /--ob-ease:cubic-bezier\(0\.2,0\.8,0\.2,1\)/)

  // 动效块：语义配方 + reduced/off 降级
  for (const name of ['ob-content-rise', 'ob-swap-in', 'ob-reveal-rise', 'ob-feedback-enter', 'ob-feedback-exit', 'ob-feed-in', 'ob-progress-grow', 'ob-ping', 'ob-pulse']) {
    assert.match(motion, new RegExp('@keyframes ' + name), '缺少 keyframe ' + name)
  }
  assert.match(motion, /\.ob-enter-default/)
  assert.match(motion, /\.ob-swap\{/)
  assert.match(motion, /\[data-motion='reduced'\]/)
  assert.match(motion, /\[data-motion='off'\]/)
  assert.match(motion, /prefers-reduced-motion: reduce/)

  // 面板块：只用变量；无裸色值/裸字重/动画声明/UI 库
  assert.match(css, /\.ob-root/)
  assert.match(css, /\.ob-tabs/)
  assert.match(css, /\.ob-panel/)
  assert.match(css, /\.ob-settings-nav/)
  assert.match(css, /\.ob-option-card/)
  assert.match(css, /\.ob-theme-preview/)
  assert.match(css, /\.ob-state/)
  assert.match(css, /\.ob-savebar/)
  assert.match(css, /\.ob-toast/)
  assert.match(css, /\.ob-stat-value/)
  assert.match(css, /@media \(pointer:coarse\)/)
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b/, '组件样式不应写死十六进制颜色（应消耗 --ob-* 令牌）')
  assert.doesNotMatch(css, /font-weight\s*:\s*\d/, '组件样式不应写裸字重（应消耗 --ob-weight-* 令牌）')
  assert.doesNotMatch(css, /@keyframes|animation\s*:/, '组件样式不应声明动画（动效统一放 MOTION_CSS）')
  assert.doesNotMatch(css + token + motion, /@import|tailwind|bootstrap|antd|element-plus/i)
})

test('Motion Policy：system/full/reduced/off 与系统偏好矩阵', () => {
  assert.equal(panel.resolveMotionMode('system', false), 'full')
  assert.equal(panel.resolveMotionMode('system', true), 'reduced')
  assert.equal(panel.resolveMotionMode('full', true), 'full', 'full 显式覆盖系统减少动效')
  assert.equal(panel.resolveMotionMode('reduced', false), 'reduced')
  assert.equal(panel.resolveMotionMode('off', false), 'off')
  assert.equal(panel.resolveMotionMode('weird', false), 'full', '非法值回退 system')
  assert.equal(panel.motionDisabled('reduced'), true)
  assert.equal(panel.motionDisabled('off'), true)
  assert.equal(panel.motionDisabled('full'), false)
  assert.deepEqual(panel.motionCategories('off'), { screen: false, async: false, reveal: false, swap: false, feedback: false, media: false })
  assert.equal(panel.shouldAnimate('full', 'reveal'), true)
  assert.equal(panel.shouldAnimate('reduced', 'reveal'), false)
  assert.equal(panel.shouldAnimate('full', 'nope'), false)
})

test('动效数值：reveal stagger / count-up / presence / page transition', () => {
  assert.equal(panel.revealDelayMs(0), 0)
  assert.equal(panel.revealDelayMs(1), 40)
  assert.equal(panel.revealDelayMs(3), 120)
  assert.equal(panel.revealDelayMs(9), 120, 'stagger 上限 120ms')
  assert.equal(panel.revealDelayMs(-1), 0)

  assert.equal(panel.easeOutCubic(0), 0)
  assert.equal(panel.easeOutCubic(1), 1)
  assert.equal(panel.countUpValue(0, 100, 0), 0)
  assert.equal(panel.countUpValue(0, 100, 1), 100)
  assert.equal(panel.countUpValue(10, 20, 0.5), 19)
  assert.equal(panel.countUpValue(0, 10, 2), 10, 'progress 超出范围会 clamp')
  assert.equal(panel.countUpValue(0, 'abc', 0.5), 'abc')

  assert.equal(panel.nextPresence('unmounted', true), 'enter')
  assert.equal(panel.nextPresence('enter', true), 'stable')
  assert.equal(panel.nextPresence('enter', false), 'exit')
  assert.equal(panel.nextPresence('stable', false), 'exit')
  assert.equal(panel.nextPresence('exit', true), 'enter', '快速反转安全')
  assert.equal(panel.nextPresence('exit', false), 'unmounted')

  assert.equal(panel.pageTransitionClass('default'), 'ob-enter-default')
  assert.equal(panel.pageTransitionClass('fade-slide'), 'ob-enter-slide')
  assert.equal(panel.pageTransitionClass('fade-up'), 'ob-enter-up')
  assert.equal(panel.pageTransitionClass('fade-down'), 'ob-enter-down')
  assert.equal(panel.pageTransitionClass('fade'), 'ob-enter-fade')
  assert.equal(panel.pageTransitionClass('none'), '')
  assert.equal(panel.pageTransitionClass('zoom'), 'ob-enter-default', '非法值回退 default')
})

test('外观偏好：accent/density/fontScale/contentWidth/motion/pageTransition/contrast 映射与回退', () => {
  const prefs = panel.normalizeUiPreferences({
    accent: 'blue',
    density: 'compact',
    fontScale: 'large',
    contentWidth: 'standard',
    motion: 'reduced',
    pageTransition: 'fade',
    contrast: 'high',
  })
  assert.deepEqual(prefs, { accent: 'blue', density: 'compact', fontScale: 'large', contentWidth: 'standard', motion: 'reduced', pageTransition: 'fade', contrast: 'high' })
  const fallback = panel.normalizeUiPreferences({ accent: 'magenta', density: 'huge', motion: 'sometimes', contrast: 'ultra' })
  assert.equal(fallback.accent, 'purple')
  assert.equal(fallback.density, 'standard')
  assert.equal(fallback.motion, 'system')
  assert.equal(fallback.contrast, 'system')
  assert.deepEqual(panel.normalizeUiPreferences(null), {
    accent: 'purple',
    density: 'standard',
    fontScale: 'standard',
    contentWidth: 'wide',
    motion: 'system',
    pageTransition: 'default',
    contrast: 'system',
  })

  const root = panel.uiRootData(prefs, false, false)
  assert.deepEqual(root, {
    'data-accent': 'blue',
    'data-density': 'compact',
    'data-font-scale': 'large',
    'data-content-width': 'standard',
    'data-motion': 'reduced',
    'data-page-transition': 'fade',
    'data-contrast': 'high',
  })
  assert.equal(panel.uiRootData({ motion: 'system' }, true)['data-motion'], 'reduced')
  assert.equal(panel.uiRootData({ motion: 'full' }, true)['data-motion'], 'full')

  // 对比度：system 跟随 prefers-contrast；standard/high 显式生效；非法值回退 system。
  assert.equal(panel.resolveContrast('system', false), 'standard')
  assert.equal(panel.resolveContrast('system', true), 'high')
  assert.equal(panel.resolveContrast('standard', true), 'standard')
  assert.equal(panel.resolveContrast('high', false), 'high')
  assert.equal(panel.resolveContrast('weird', true), 'high')
  assert.equal(panel.uiRootData({}, false, false)['data-contrast'], 'standard')
  assert.equal(panel.uiRootData({}, false, true)['data-contrast'], 'high')

  assert.equal(panel.accentValues('purple', false).brand, '#5d49d6')
  assert.equal(panel.accentValues('purple', true).brand, '#9b8cff')
  assert.equal(panel.accentValues('inherit', false), null)
  assert.equal(panel.fontScalePercent('small'), 93.75)
  assert.equal(panel.fontScalePercent('large'), 112.5)
  assert.equal(panel.fontScalePercent('weird'), 100)
  assert.equal(panel.densityMetrics('compact').control, '2.25rem')
  assert.equal(panel.densityMetrics('weird').control, '2.75rem')
  assert.equal(panel.contentMaxWidth('standard'), '72rem')
  assert.equal(panel.contentMaxWidth('auto'), 'none')
  assert.equal(panel.contentMaxWidth('weird'), '100rem')
})

test('ConfigTab 过滤 ui 组；SettingsTab 渲染持久壳分类', () => {
  const groups = [
    { id: 'basic', title: '基本', fields: [{ path: 'enabled', label: '启用', type: 'switch', default: true }] },
    { id: 'ui', title: '界面偏好', fields: [{ path: 'ui.accent', label: '强调色', type: 'select', default: 'purple', options: [{ value: 'purple', label: '紫' }] }] },
  ]
  const config = { enabled: true, ui: { accent: 'purple' } }
  const configInfo = { config, defaults: {}, groups, version: '0.3.0', apiVersion: 1, dataDir: 'C:\\data' }
  const baseProps = {
    status: null,
    configInfo,
    draft: JSON.parse(JSON.stringify(config)),
    updateDraft: () => {},
    toast: () => {},
    go: () => {},
    gatewayAction: async () => ({ ok: true }),
    refreshAll: () => {},
    refreshStatus: () => {},
    runWithProgress: (task) => task(),
    now: Date.now(),
    saving: false,
    dirty: false,
    issues: [],
    save: () => {},
    reset: () => {},
    undo: () => {},
    saveUiPatch: () => Promise.resolve(true),
    retryPrefSave: () => {},
    prefStatus: { saving: false, error: '', savedAt: 0 },
  }
  const configJson = JSON.stringify(panel.ConfigTab(baseProps))
  assert.doesNotMatch(configJson, /界面偏好/, '配置页不应再渲染 ui 分组')
  assert.match(configJson, /保存与重置/)
  const settingsJson = JSON.stringify(panel.SettingsTab(baseProps))
  assert.match(settingsJson, /外观/)
  assert.match(settingsJson, /DSH 主题/)
  assert.match(settingsJson, /即时保存/)
})

test('设置壳转场：配置/系统设置强制 fade，其它页签使用配置值', () => {
  assert.equal(panel.contentTransitionFor('config', 'fade-slide'), 'fade')
  assert.equal(panel.contentTransitionFor('settings', 'fade-up'), 'fade')
  assert.equal(panel.contentTransitionFor('settings', 'none'), 'fade')
  assert.equal(panel.contentTransitionFor('overview', 'fade-slide'), 'fade-slide')
  assert.equal(panel.contentTransitionFor('logs', 'fade-up'), 'fade-up')
  assert.equal(panel.contentTransitionFor('about', 'bogus'), 'default')
  assert.equal(panel.contentTransitionFor('messages', 'none'), 'none')
})

test('applyConfigPatch：多字段不可变合并', () => {
  const base = { ui: { accent: 'purple', contrast: 'system' }, onebot: { wsUrl: 'ws://a' }, enabled: true }
  const next = panel.applyConfigPatch(base, { 'ui.accent': 'blue', 'ui.contrast': 'high' })
  assert.equal(next.ui.accent, 'blue')
  assert.equal(next.ui.contrast, 'high')
  assert.equal(next.onebot.wsUrl, 'ws://a')
  assert.equal(next.enabled, true)
  assert.equal(base.ui.accent, 'purple', '不能修改入参')
  const nested = panel.applyConfigPatch({}, { 'ui.motion': 'reduced', 'onebot.httpUrl': 'http://b' })
  assert.equal(nested.ui.motion, 'reduced')
  assert.equal(nested.onebot.httpUrl, 'http://b')
  assert.deepEqual(panel.applyConfigPatch(null, null), {})
})

test('settingsSections：ui 字段分类、未知字段落到 other、无 ui 组时只保留主题/重置', () => {
  const groups = [
    {
      id: 'ui',
      title: '界面偏好',
      fields: [
        { path: 'ui.accent', label: '强调色', type: 'select', default: 'purple', options: [{ value: 'purple', label: '紫' }] },
        { path: 'ui.contrast', label: '对比度', type: 'select', default: 'system', options: [{ value: 'high', label: '高' }] },
        { path: 'ui.density', label: '密度', type: 'select', default: 'standard', options: [{ value: 'compact', label: '紧凑' }] },
        { path: 'ui.motion', label: '动效模式', type: 'select', default: 'system', options: [{ value: 'full', label: '开' }] },
        { path: 'ui.pageTransition', label: '页面切换动画', type: 'select', default: 'default', options: [{ value: 'fade', label: '淡入' }] },
        { path: 'ui.futureThing', label: '未来字段', type: 'text', default: '' },
        { path: 'ui.refreshMs', label: '刷新间隔', type: 'number', default: 2000 },
      ],
    },
  ]
  const sections = panel.settingsSections(groups)
  const ids = sections.map((section) => section.id)
  assert.deepEqual(ids, ['appearance', 'layout', 'data', 'motion', 'other', 'reset'])
  const appearance = sections.find((section) => section.id === 'appearance')
  assert.deepEqual(appearance.fields.map((field) => field.path), ['ui.accent', 'ui.contrast'])
  const layout = sections.find((section) => section.id === 'layout')
  assert.deepEqual(layout.fields.map((field) => field.path), ['ui.density'])
  const data = sections.find((section) => section.id === 'data')
  assert.deepEqual(data.fields.map((field) => field.path), ['ui.refreshMs'])
  const motion = sections.find((section) => section.id === 'motion')
  assert.deepEqual(motion.fields.map((field) => field.path), ['ui.motion', 'ui.pageTransition'])
  const other = sections.find((section) => section.id === 'other')
  assert.deepEqual(other.fields.map((field) => field.path), ['ui.futureThing'])
  const reset = sections.find((section) => section.id === 'reset')
  assert.deepEqual(reset.fields, [])

  const empty = panel.settingsSections([])
  assert.deepEqual(empty.map((section) => section.id), ['appearance', 'reset'])
  assert.deepEqual(empty[0].fields, [])
})

test('格式化与缓冲值：formatCount / splitBufferValue', () => {
  assert.equal(panel.formatCount(0), '0')
  assert.equal(panel.formatCount(999), '999')
  assert.equal(panel.formatCount(1000), '1,000')
  assert.equal(panel.formatCount(1234567), '1,234,567')
  assert.equal(panel.formatCount('abc'), 'abc')
  assert.deepEqual(panel.splitBufferValue('2 / 200'), { used: 2, capacity: 200 })
  assert.deepEqual(panel.splitBufferValue('0/1'), { used: 0, capacity: 1 })
  assert.equal(panel.splitBufferValue('anything'), null)
  assert.equal(panel.splitBufferValue(null), null)
  assert.equal(panel.formatNumberList([1000, 3000]), '1000, 3000')
  assert.equal(panel.formatNumberList(null), '')
})


test('BackupPage: status/list render, staged restore defaults false and apply requires permission', async () => {
  const id = '20261106T000000000Z-deadbeef'
  const calls = []
  const originalFetch = globalThis.fetch
  const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children), ...nodes(tree.props?.actions)]
  const render = (allowRestore) => {
    stateOverrides = [{ status: { enabled: true, snapshotCount: 1, maxSnapshots: 10, maxBytes: 209715200, allowRestore }, items: [{ id, createdAt: '2026-11-06T00:00:00Z', note: 'before change', bytes: 100, files: 2, includeMedia: false }] }, false, false, '', '', false, 'restore-' + id]
    try { return panel.BackupPage({ toast() {} }) } finally { stateOverrides = null }
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, body: init.body ? JSON.parse(init.body) : null })
    return { ok: true, json: async () => path.endsWith('/restore') ? { ok: true, stagedPath: 'restore-' + id } : { ok: true, status: {}, items: [] } }
  }
  try {
    const tree = render(false)
    const text = JSON.stringify(tree)
    assert.match(text, /before change/)
    assert.match(text, /restore-20261106/)
    assert.match(text, /重启/)
    assert.match(text, /密钥/)
    const buttons = nodes(tree)
    const stage = buttons.find((node) => node.children?.includes('暂存恢复'))
    const apply = buttons.find((node) => node.children?.includes('应用恢复'))
    assert.equal(apply.props.disabled, true)
    await stage.props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/backup/restore', body: { id, apply: false } })
    const permitted = nodes(render(true)).find((node) => node.children?.includes('应用恢复'))
    assert.equal(permitted.props.disabled, false)
    await permitted.props.onClick()
    assert.ok(calls.some((call) => call.path.endsWith('/restore') && call.body.apply === true))
  } finally { globalThis.fetch = originalFetch }
})

test('SecurityPage: read-only launch checklist, last five audit rows, manual upgrade check', async () => {
  const calls = [], visited = []
  const originalFetch = globalThis.fetch
  const data = {
    status: { version: '0.10.0', gateway: { state: 'connected' }, config: { security: { allowRawAction: false, leakGuard: { enabled: true, action: 'redact', content: 'NEVER_RENDER_SECRET' } }, media: { enabled: true, images: { visionEnabled: true, visionBaseUrl: 'https://example.test/v1', visionModel: 'vision', visionApiKeyEnv: 'VISION_KEY' }, audio: { asrEnabled: false, ttsEnabled: false } } } },
    access: { mode: 'allowlist', ownerQQ: '123456', allow: { private: 2, groups: 3 }, counters: { inboundBlocked: 7, outboundBlocked: 8 }, recent: Array.from({ length: 7 }, (_, index) => ({ at: index + 1, direction: 'in', chatType: 'private', chatId: 'u' + index, reason: 'audit-' + index })) },
    backup: { status: { snapshotCount: 1, allowRestore: false } },
    upgrade: { enabled: true, current: '0.10.0', channel: 'beta', checkedAt: '2026-11-06T00:00:00Z', cached: { latest: 'v0.11.0-beta.1', updateAvailable: true, notes: 'Release note', url: 'https://github.com/reina0721/dsh-bot/releases/tag/v0.11.0-beta.1' } },
  }
  const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children), ...nodes(tree.props?.actions)]
  const render = (loaded = data) => {
    stateOverrides = [loaded, false, false, '']
    try { return panel.SecurityPage({ go: (id) => visited.push(id) }) } finally { stateOverrides = null }
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null })
    const name = path.replace(panel.API_PREFIX, '')
    const values = { '/status': data.status, '/access/stats': data.access, '/backup': data.backup, '/upgrade': data.upgrade }
    return { ok: true, json: async () => name === '/upgrade/check' ? { ok: true, latest: 'v0.11.0-beta.1', updateAvailable: true } : { ok: true, ...values[name] } }
  }
  try {
    const tree = render(), json = JSON.stringify(tree)
    assert.equal(panel.TABS.length, 6)
    assert.ok(panel.NAVIGATION_REGISTRY.find(area => area.id === 'system').sections.some(section => section.id === 'security'))
    for (const text of ['访问控制', '出站文本防泄漏', '没有扫描内容/密钥', 'redact（脱敏后发送）', '危险面', '上线检查', '升级', '123456', 'VISION_KEY', '人工审核', '不是沙箱', 'v0.11.0-beta.1', '不自动检查、下载或安装']) assert.ok(json.includes(text), text)
    assert.doesNotMatch(json, /audit-0|audit-1|NEVER_RENDER_SECRET/)
    const disabledGuard = JSON.stringify(render({ ...data, status: { config: { security: { leakGuard: { enabled: false, action: 'block' } } } } }))
    assert.match(disabledGuard, /禁用/)
    assert.match(disabledGuard, /block（阻止发送）/)
    assert.match(json, /audit-2/)
    assert.match(json, /audit-6/)
    assert.equal(nodes(tree).filter((node) => node.children?.includes('通过')).length, 5)
    assert.equal(nodes(tree).filter((node) => node.children?.includes('待检查')).length, 1)
    assert.ok(!nodes(tree).some((node) => ['input', 'select', 'textarea'].includes(node.type)))
    const warningData = { ...data, status: { config: { security: { allowRawAction: true }, media: { enabled: true, audio: { ttsEnabled: true } } } }, access: { mode: 'open' }, backup: { status: { snapshotCount: 0 } } }
    const warnings = nodes(render(warningData))
    assert.equal(warnings.filter((node) => node.children?.includes('待检查')).length, 6)
    for (const label of ['前往连接', '前往配置', '前往备份']) warnings.find((node) => node.children?.includes(label)).props.onClick()
    assert.deepEqual(visited, ['connect', 'config', 'backup'])
    const unknown = nodes(render({}))
    assert.equal(unknown.filter((node) => node.children?.includes('通过')).length, 0)
    assert.equal(unknown.find((node) => node.children?.includes('检查更新')).props.disabled, true)
    await nodes(tree).find((node) => node.children?.includes('检查更新')).props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/upgrade/check', method: 'POST', body: { force: true } })
    assert.deepEqual(calls.slice(1).map((call) => call.path).sort(), ['/status', '/access/stats', '/backup', '/upgrade'].map((path) => panel.API_PREFIX + path).sort())
    assert.ok(calls.slice(1).every((call) => call.method === 'GET'))
  } finally { globalThis.fetch = originalFetch }
})

test('MediaPage: image status, text-only source, generation/edit payloads and local result/error', async () => {
  const calls = [], originalFetch = globalThis.fetch
  const nodes = (tree) => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)]
  const render = (result = '', error = '') => {
    stateOverrides = [{ enabled: true, images: { generate: { enabled: true, configured: true }, edit: { enabled: true, configured: false } } }, [], false, '', '', '', 'cat', '512x512', 'inbound/cat.png', result, error, '']
    try { return panel.MediaPage({ toast() {} }) } finally { stateOverrides = null }
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ ok: true, path: 'generated/result.png', size: '512x512' }) }
  }
  try {
    const tree = render()
    assert.ok(JSON.stringify(tree).includes('生图/改图'))
    const all = nodes(tree)
    const source = all.find((node) => node.props?.['aria-label'] === '源图片相对路径')
    assert.equal(source.type, 'input')
    assert.notEqual(source.props.type, 'file')
    assert.equal(source.props.value, 'inbound/cat.png')
    assert.equal(all.filter((node) => node.type === 'option').length, 5)
    const generate = all.find((node) => node.children?.includes('生成图片'))
    const edit = all.find((node) => node.children?.includes('编辑图片'))
    await generate.props.onClick()
    await edit.props.onClick()
    assert.deepEqual(calls, [
      { path: panel.API_PREFIX + '/media/image/generate', body: { prompt: 'cat', size: '512x512' } },
      { path: panel.API_PREFIX + '/media/image/edit', body: { prompt: 'cat', size: '512x512', path: 'inbound/cat.png' } },
    ])
    assert.ok(JSON.stringify(render('generated/result.png')).includes('生成路径：generated/result.png'))
    assert.ok(JSON.stringify(render('', 'provider HTTP 401')).includes('provider HTTP 401'))
  } finally { globalThis.fetch = originalFetch }
})

test('MediaPage stickers: libraryAvailable controls list/upload/tag/delete/preview with images off', async () => {
  const originalFetch = globalThis.fetch, OriginalReader = globalThis.FileReader
  const originalPrompt = window.prompt, originalConfirm = window.confirm
  const calls = []
  const item = { id: 'cat', name: 'cat.png', tags: ['猫'] }
  // Deliberately disagree with the legacy alias to verify all controls use the new field.
  const status = { enabled: true, images: { enabled: false }, stickers: { available: false, libraryAvailable: true, sendAvailable: false, sendReason: 'IMAGES_DISABLED', count: 1 } }
  const session = { values: [status, [item], false], index: 0 }
  const render = () => {
    session.index = 0
    hookSession = session
    try { return panel.MediaPage({ toast() {} }) } finally { hookSession = null }
  }
  const libraryPanel = tree => treeNodes(tree).find(node => node.type?.name === 'Panel' && node.props.title === '表情包库')
  const uploadInput = tree => treeNodes(libraryPanel(tree).props.actions).find(node => node.type === 'input')
  let reader
  globalThis.FileReader = class { readAsDataURL() { reader = this } }
  window.prompt = () => '新标签'
  window.confirm = () => true
  globalThis.fetch = async (path, init) => {
    calls.push({ path, body: init.body ? JSON.parse(init.body) : undefined })
    const payload = path.endsWith('/media/status') ? status
      : path.includes('/media/stickers?') ? { ok: true, items: [item] } : { ok: true, items: [] }
    return { ok: true, json: async () => payload }
  }
  try {
    const tree = render()
    assert.match(JSON.stringify(tree), /库可用；图片开关关闭导致发送禁用/)
    assert.equal(uploadInput(tree).props.disabled, false)
    assert.ok(treeNodes(tree).some(node => node.type === 'img' && node.props.src.endsWith('/media/stickers/file?id=cat')))
    await control(libraryPanel(tree).props.actions, '刷新').props.onClick()
    assert.ok(calls.some(call => call.path.endsWith('/media/stickers?limit=200')))
    const refreshed = render()
    await control(refreshed, '编辑标签').props.onClick()
    await control(refreshed, '删除').props.onClick()
    uploadInput(render()).props.onChange({ target: { files: [{ name: 'cat.png', type: 'image/png' }], value: 'cat.png' } })
    reader.result = 'data:image/png;base64,aW1hZ2U='
    await reader.onload()
    assert.deepEqual(calls.filter(call => call.body), [
      { path: panel.API_PREFIX + '/media/stickers/tag', body: { id: 'cat', tags: ['新标签'] } },
      { path: panel.API_PREFIX + '/media/stickers/delete', body: { id: 'cat' } },
      { path: panel.API_PREFIX + '/media/stickers/upload', body: { name: 'cat.png', mime: 'image/png', data: 'aW1hZ2U=' } },
    ])
    // Let the action-triggered refreshes settle before testing a closed library.
    await new Promise(resolve => setImmediate(resolve))
    session.values[0] = { ...status, stickers: { available: true, libraryAvailable: false, sendAvailable: false } }
    const closed = render()
    assert.equal(uploadInput(closed).props.disabled, true)
    assert.equal(treeNodes(libraryPanel(closed)).some(node => node.type === 'img'), false)
    assert.equal(treeNodes(libraryPanel(closed)).some(node => node.children?.includes('编辑标签') || node.children?.includes('删除')), false)
  } finally {
    globalThis.fetch = originalFetch; globalThis.FileReader = OriginalReader
    window.prompt = originalPrompt; window.confirm = originalConfirm
  }
})

test('CogTimeline: all remains default, Event filter queries API and renders event tone', async () => {
  const calls = [], restore = mockCognitionApi(calls)
  const refresh = (tree) => control(treeNodes(tree).find((node) => node.type?.name === 'Panel').props.actions, '刷新')
  const render = (type = '') => {
    stateOverrides = [type, { items: [{ id: 'event:e1', type: 'event', title: '旧日回忆', detail: '事件正文', at: 1000 }] }, '', false]
    try { return panel.CogTimeline({ toast() {} }) } finally { stateOverrides = null }
  }
  try {
    const all = render()
    assert.equal(control(all, '全部').props.kind, 'primary')
    assert.equal(control(all, '事件').props.kind, 'ghost')
    await refresh(all).props.onClick()
    assert.equal(calls.at(-1).path, panel.API_PREFIX + '/cognition/timeline?limit=120')
    const event = render('event')
    assert.equal(control(event, '事件').props.kind, 'primary')
    const tag = treeNodes(event).find((node) => node.type?.name === 'CogTag' && node.children?.includes('event'))
    assert.equal(tag.props.tone, 'warn')
    assert.match(JSON.stringify(event), /旧日回忆/)
    assert.match(JSON.stringify(event), /事件正文/)
    await refresh(event).props.onClick()
    assert.equal(calls.at(-1).path, panel.API_PREFIX + '/cognition/timeline?limit=120&types=event')
    const mounted = mountNode({ type: panel.CogTimeline, props: { toast() {} } })
    control(mounted(), '事件').props.onClick()
    await refresh(mounted()).props.onClick()
    assert.match(calls.at(-1).path, /types=event$/)
  } finally { restore() }
})

function mountMediaFiles(toast = () => {}) {
  const session = { values: [{ enabled: true, maxBytes: 1024, files: { enabled: true } }, [], false], index: 0 }
  return () => {
    session.index = 0
    hookSession = session
    try { return panel.MediaPage({ toast }) } finally { hookSession = null }
  }
}
const filePanel = (tree) => treeNodes(tree).find((node) => node.type?.name === 'Panel' && node.props.title === '文件')
const fileInput = (tree) => field(filePanel(tree).props.actions, '上传文件')
const refreshFilesButton = (tree) => control(filePanel(tree).props.actions, '刷新文件')

test('MediaPage files: base64 upload, busy guard, refresh and path/size/time rendering without send', async () => {
  const originalFetch = globalThis.fetch, OriginalReader = globalThis.FileReader
  const calls = [], toasts = [], render = mountMediaFiles((...args) => toasts.push(args))
  let reader, reads = 0
  globalThis.FileReader = class {
    readAsDataURL() { reader = this; reads++ }
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    assert.ok(['/media/file/upload', '/media/files'].some((suffix) => path.endsWith(suffix)))
    return { ok: true, json: async () => path.endsWith('/upload')
      ? { ok: true, path: 'files/1-deadbeef-报告.txt', name: '报告.txt', size: 6 }
      : { ok: true, items: [{ path: 'files/1-deadbeef-报告.txt', name: '报告.txt', size: 6, at: Date.UTC(2026, 10, 6) }], totalBytes: 6 } }
  }
  try {
    const initial = render()
    assert.equal(fileInput(initial).props.accept, '.txt,.md,.json,.csv,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.7z,.rar')
    assert.equal(fileInput(initial).props.disabled, false)
    assert.match(JSON.stringify(filePanel(initial)), /\/file 相对路径/)
    const event = () => ({ target: { files: [{ name: '报告.txt', size: 6 }], value: 'selected' } })
    const firstEvent = event(), pending = fileInput(initial).props.onChange(firstEvent)
    assert.equal(firstEvent.target.value, '')
    assert.equal(fileInput(render()).props.disabled, true)
    await fileInput(render()).props.onChange(event())
    assert.equal(reads, 1, 'reading and POST must share one busy guard')
    reader.result = 'data:text/plain;base64,5L2g5aW9'
    reader.onload()
    await pending
    assert.deepEqual(calls, [
      { path: panel.API_PREFIX + '/media/file/upload', method: 'POST', body: { name: '报告.txt', dataBase64: '5L2g5aW9' } },
      { path: panel.API_PREFIX + '/media/files', method: 'GET', body: undefined },
    ])
    const done = render(), json = JSON.stringify(filePanel(done))
    for (const text of ['报告.txt', 'files/1-deadbeef-报告.txt', '6 bytes', '2026-11-06']) assert.ok(json.includes(text), text)
    assert.equal(fileInput(done).props.disabled, false)
    assert.deepEqual(toasts, [['文件已上传', 'ok']])
    const fileNodes = [...treeNodes(filePanel(done)), ...treeNodes(filePanel(done).props.actions)]
    assert.ok(!fileNodes.some((node) => node.children?.includes('发送')))
    assert.equal(control(filePanel(done), '下载').props.disabled, false)
    assert.equal(control(filePanel(done), '删除').props.disabled, false)
    await refreshFilesButton(done).props.onClick()
    assert.equal(calls.at(-1).method, 'GET')
  } finally { globalThis.fetch = originalFetch; globalThis.FileReader = OriginalReader }
})

test('MediaPage files: confirmed delete, cancellation, shared busy guard, list refresh and no QQ sends', async () => {
  const originalFetch = globalThis.fetch, originalConfirm = window.confirm
  const calls = [], toasts = [], confirmations = [], render = mountMediaFiles((...args) => toasts.push(args))
  const item = { path: 'files/1-deadbeef-报告.txt', name: '报告.txt', size: 6, at: Date.now() }
  let deleted = false, release
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    if (path.endsWith('/delete')) return new Promise((resolve) => { release = () => { deleted = true; resolve({ ok: true, json: async () => ({ ok: true, removed: true }) }) } })
    assert.ok(path.endsWith('/media/files'))
    return { ok: true, json: async () => ({ ok: true, items: deleted ? [] : [item], totalBytes: deleted ? 0 : 6 }) }
  }
  try {
    await refreshFilesButton(render()).props.onClick()
    const tree = render(), remove = control(filePanel(tree), '删除'), download = control(filePanel(tree), '下载')
    window.confirm = (text) => { confirmations.push(text); return false }
    await remove.props.onClick()
    assert.match(confirmations[0], /报告.txt.*无法恢复/)
    assert.equal(calls.length, 1)
    delete window.confirm
    await remove.props.onClick()
    assert.equal(calls.length, 1, 'delete requires a confirmation dialog')
    window.confirm = () => true
    const pending = remove.props.onClick()
    assert.deepEqual(calls[1], { path: panel.API_PREFIX + '/media/file/delete', method: 'POST', body: { name: '1-deadbeef-报告.txt' } })
    for (const label of ['下载', '删除']) assert.equal(control(filePanel(render()), label).props.disabled, true)
    assert.equal(fileInput(render()).props.disabled, true)
    assert.equal(refreshFilesButton(render()).props.disabled, true)
    await download.props.onClick()
    await remove.props.onClick()
    await refreshFilesButton(tree).props.onClick()
    await fileInput(tree).props.onChange({ target: { files: [{ name: 'a.txt', size: 1 }], value: 'selected' } })
    assert.equal(calls.length, 2, 'stale handlers must share the in-flight guard')
    release()
    await pending
    assert.deepEqual(toasts, [['文件已删除', 'ok']])
    assert.equal(calls.at(-1).path, panel.API_PREFIX + '/media/files')
    assert.match(JSON.stringify(filePanel(render())), /还没有文件/)
    assert.equal(fileInput(render()).props.disabled, false)
  } finally { globalThis.fetch = originalFetch; window.confirm = originalConfirm }
})

test('MediaPage files: download JSON to binary Blob, original filename, click and object URL cleanup', async (t) => {
  const originalFetch = globalThis.fetch, originalDocument = globalThis.document
  const render = mountMediaFiles(), calls = [], events = []
  let blob, link
  t.mock.method(URL, 'createObjectURL', (value) => { blob = value; return 'blob:local-file' })
  t.mock.method(URL, 'revokeObjectURL', (value) => events.push(['revoke', value]))
  globalThis.document = {
    body: { appendChild(value) { assert.equal(value, link); events.push(['append']) } },
    createElement(tag) {
      assert.equal(tag, 'a')
      link = { click() { events.push(['click', this.href, this.download]) }, remove() { events.push(['remove']) } }
      return link
    },
  }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method })
    return { ok: true, json: async () => path.endsWith('/media/files')
      ? { ok: true, items: [{ path: 'files/1-deadbeef-报告.PDF', name: '报告.PDF', size: 5 }] }
      : { ok: true, name: '1-deadbeef-报告.PDF', size: 5, mime: 'application/pdf', dataBase64: 'AAH//oA=' } }
  }
  try {
    await refreshFilesButton(render()).props.onClick()
    await control(filePanel(render()), '下载').props.onClick()
    assert.deepEqual(calls[1], { path: panel.API_PREFIX + '/media/file/download?name=' + encodeURIComponent('1-deadbeef-报告.PDF'), method: 'GET' })
    assert.equal(blob.type, 'application/pdf')
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from([0, 1, 255, 254, 128]))
    assert.deepEqual(events, [['append'], ['click', 'blob:local-file', '报告.PDF'], ['remove'], ['revoke', 'blob:local-file']])
    assert.equal(control(filePanel(render()), '下载').props.disabled, false)
  } finally { globalThis.fetch = originalFetch; globalThis.document = originalDocument }
})

test('MediaPage files: action/API/network/data errors toast and release busy state, disabled switches block actions', async () => {
  const originalFetch = globalThis.fetch, originalConfirm = window.confirm
  const toasts = [], render = mountMediaFiles((...args) => toasts.push(args))
  let failed = false, requests = 0, payload = { ok: false, message: '文件不存在' }
  globalThis.fetch = async (path) => {
    requests++
    if (path.endsWith('/media/files')) return { ok: true, json: async () => ({ ok: true, items: [{ path: 'files/1-deadbeef-a.txt', name: 'a.txt', size: 1 }] }) }
    if (failed) throw new Error('本地连接失败')
    return { ok: true, json: async () => payload }
  }
  window.confirm = () => true
  try {
    await refreshFilesButton(render()).props.onClick()
    for (const label of ['下载', '删除']) {
      await control(filePanel(render()), label).props.onClick()
      assert.deepEqual(toasts.at(-1), ['文件不存在', 'err'])
      assert.match(JSON.stringify(filePanel(render())), /文件不存在/)
      assert.equal(control(filePanel(render()), label).props.disabled, false)
    }
    failed = true
    await control(filePanel(render()), '下载').props.onClick()
    assert.match(toasts.at(-1)[0], /本地连接失败/)
    assert.equal(control(filePanel(render()), '删除').props.disabled, false)
    failed = false
    payload = { ok: true }
    await control(filePanel(render()), '下载').props.onClick()
    assert.deepEqual(toasts.at(-1), ['文件下载数据无效', 'err'])
    const before = requests
    for (const enabled of [false, true]) {
      stateOverrides = [{ enabled, files: { enabled: !enabled } }, [], false, '', '', '', '', '1024x1024', '', '', '', '', { items: [{ path: 'files/a.txt', name: 'a.txt' }] }]
      const tree = panel.MediaPage({ toast() {} })
      stateOverrides = null
      for (const label of ['下载', '删除']) {
        const button = control(filePanel(tree), label)
        assert.equal(button.props.disabled, true)
        await button.props.onClick()
      }
    }
    assert.equal(requests, before)
  } finally { stateOverrides = null; globalThis.fetch = originalFetch; window.confirm = originalConfirm }
})

test('MediaPage files: size/extension checks before reading, read/upload/list errors and disabled input', async () => {
  const originalFetch = globalThis.fetch, OriginalReader = globalThis.FileReader
  const render = mountMediaFiles()
  let reads = 0, calls = 0, readFails = false, uploadFails = true
  globalThis.FileReader = class {
    readAsDataURL() {
      reads++
      if (readFails) this.onerror()
      else { this.result = 'data:text/plain;base64,YQ=='; this.onload() }
    }
  }
  globalThis.fetch = async (path) => {
    calls++
    return { ok: true, json: async () => path.endsWith('/upload')
      ? { ok: !uploadFails, message: '文件名无效' }
      : { ok: false, message: '文件功能未启用' } }
  }
  const choose = (file) => fileInput(render()).props.onChange({ target: { files: file ? [file] : [], value: 'selected' } })
  try {
    await choose()
    for (const size of [0, 1025]) {
      await choose({ name: 'a.txt', size })
      assert.match(JSON.stringify(filePanel(render())), /大小限制 1024/)
    }
    await choose({ name: 'a.exe', size: 1 })
    assert.match(JSON.stringify(filePanel(render())), /扩展名/)
    assert.equal(reads, 0)
    assert.equal(calls, 0)
    readFails = true
    await choose({ name: 'a.txt', size: 1 })
    assert.match(JSON.stringify(filePanel(render())), /读取文件失败/)
    assert.equal(calls, 0)
    readFails = false
    await choose({ name: 'a.txt', size: 1 })
    assert.match(JSON.stringify(filePanel(render())), /文件名无效/)
    assert.equal(fileInput(render()).props.disabled, false)
    uploadFails = false
    await choose({ name: 'a.txt', size: 1 })
    assert.match(JSON.stringify(filePanel(render())), /文件功能未启用/)
    stateOverrides = [{ enabled: true, files: { enabled: false } }, [], false]
    const disabled = panel.MediaPage({ toast() {} })
    stateOverrides = null
    assert.equal(fileInput(disabled).props.disabled, true)
    assert.ok(treeNodes(disabled).some((node) => node.props?.title === '生图/改图'))
    stateOverrides = [{ enabled: false, files: { enabled: true } }, [], false]
    assert.equal(fileInput(panel.MediaPage({ toast() {} })).props.disabled, true)
  } finally { stateOverrides = null; globalThis.fetch = originalFetch; globalThis.FileReader = OriginalReader }
})


test('ContentPage：评论与分享本地查询、禁用/防重、纯文本渲染和输入切换清空', async () => {
  const originalFetch = globalThis.fetch, calls = [], toasts = []
  const render = mountNode({ type: panel.MediaFeaturesPanel, props: { toast: (...args) => toasts.push(args) } })
  let release
  globalThis.fetch = (path) => {
    calls.push(path)
    return new Promise((resolve) => { release = (payload) => resolve({ ok: true, json: async () => payload }) })
  }
  try {
    let tree = render()
    assert.match(JSON.stringify(tree), /Cookie\/WBI/)
    assert.match(JSON.stringify(tree), /不验证视频是否存在/)
    assert.equal(calls.length, 0, 'mount must not access network')
    await control(tree, '查看公开评论').props.onClick()
    assert.deepEqual(toasts, [['请输入 BV 号', 'warn']])
    field(tree, 'B站 BV 号').props.onChange({ target: { value: 'BV1xx411c7mD' } })
    tree = render()
    const pending = control(tree, '查看公开评论').props.onClick()
    await control(tree, '生成分享链接').props.onClick()
    assert.equal(calls.length, 1)
    assert.equal(field(render(), 'B站 BV 号').props.disabled, true)
    assert.equal(control(render(), '生成分享链接').props.disabled, true)
    assert.equal(calls[0], panel.API_PREFIX + '/content/bilibili/comments?bvid=BV1xx411c7mD')
    release({ ok: true, items: [{ author: '测试作者', like: 8, content: '<img src=x onerror=alert(1)>正文' }] })
    await pending
    tree = render()
    assert.ok(treeNodes(tree).some((node) => node.type === 'strong' && node.children.includes('测试作者 · 赞 8')))
    assert.ok(treeNodes(tree).some((node) => node.type === 'p' && node.children.includes('<img src=x onerror=alert(1)>正文')))
    assert.ok(!treeNodes(tree).some((node) => node.props?.dangerouslySetInnerHTML))
    assert.equal(field(tree, 'B站 BV 号').props.disabled, false)
    const sharing = control(tree, '生成分享链接').props.onClick()
    release({ ok: true, url: 'https://www.bilibili.com/video/BV1xx411c7mD' })
    await sharing
    tree = render()
    assert.ok(treeNodes(tree).some((node) => node.type === 'a' && node.props.href === 'https://www.bilibili.com/video/BV1xx411c7mD'))
    assert.ok(calls.every((path) => path.startsWith(panel.API_PREFIX + '/content/bilibili/')))
    field(tree, 'B站 BV 号').props.onChange({ target: { value: 'BV2xx411c7mD' } })
    assert.ok(!treeNodes(render()).some((node) => node.type === 'a' && node.props.href.includes('BV1xx411c7mD')))
  } finally { globalThis.fetch = originalFetch }
})

test('ContentPage：空评论、服务关闭/风控与网络失败明确展示，失败后可重试', async () => {
  const originalFetch = globalThis.fetch
  const render = mountNode({ type: panel.MediaFeaturesPanel, props: { toast() {} } })
  let payload = { ok: true, items: [] }, failure = false
  globalThis.fetch = async () => {
    if (failure) throw new Error('本地请求失败')
    return { ok: true, json: async () => payload }
  }
  try {
    field(render(), 'B站 BV 号').props.onChange({ target: { value: 'BV1xx411c7mD' } })
    await control(render(), '查看公开评论').props.onClick()
    assert.match(JSON.stringify(render()), /没有可显示的 B站公开评论/)
    for (const message of ['B站内容未启用', 'B站公开接口要求登录或当前访问被限制；本服务不使用 Cookie/WBI']) {
      payload = { ok: false, message }
      await control(render(), '生成分享链接').props.onClick()
      assert.ok(JSON.stringify(render()).includes(message))
      assert.equal(control(render(), '查看公开评论').props.disabled, false)
    }
    failure = true
    await control(render(), '查看公开评论').props.onClick()
    assert.match(JSON.stringify(render()), /本地请求失败/)
    failure = false
    payload = { ok: true, items: [] }
    await control(render(), '查看公开评论').props.onClick()
    assert.doesNotMatch(JSON.stringify(render()), /本地请求失败/)
  } finally { globalThis.fetch = originalFetch }
})

const budgetControl = (tree, text) => control([tree, tree.props.actions, ...treeNodes(tree).map((node) => node.props?.actions)], text)

function renderBudget({ usageToday = 120, budget = 500, personaUsed = 50, personaBudget = 200, scope = 'global', loading = false, error = '', resetting = false, toast = () => {} } = {}) {
  const counter = (usageToday, budget) => ({ usageToday, budget, budgetLeft: Math.max(0, budget - usageToday), exhausted: usageToday >= budget })
  const global = counter(usageToday, budget), persona = { ...counter(personaUsed, personaBudget), personaScoped: true }
  const effectiveLeft = scope === 'both' ? Math.min(global.budgetLeft, persona.budgetLeft) : (scope === 'global' ? global : persona).budgetLeft
  stateOverrides = [{ date: '2026-11-06', scope, global, persona, effectiveLeft, exhausted: effectiveLeft <= 0, personaId: 'self' }, error, loading, resetting]
  try { return panel.CogBudgetCard({ toast }) } finally { stateOverrides = null }
}

test('CogBudgetCard: both rows, three scope badges, effective remaining and progress', () => {
  const normal = renderBudget(), json = JSON.stringify(normal)
  assert.equal(normal.props.title, '今日 LLM 预算')
  assert.match(json, /2026-11-06 UTC/)
  assert.match(json, /所有人格共享此计数/)
  assert.match(json, /仅当前人格：self/)
  assert.match(json, /analysis.*reply.*cog-learning/)
  const stats = treeNodes(normal).filter((node) => node.type?.name === 'StatTile')
  assert.deepEqual(stats.map((node) => node.props.value), ['120', '500', '380', '50', '200', '150', '380'])
  const bars = treeNodes(normal).filter((node) => node.type?.name === 'CogBar')
  assert.deepEqual(bars.map((bar) => bar.props.value), [0.24, 0.25])
  assert.deepEqual(bars.map((bar) => bar.props.label), ['全局今日预算使用率', '当前人格今日预算使用率'])
  assert.doesNotMatch(json, /已耗尽|接近上限/)
  for (const [text, label] of [['重置全局今日', '重置全局今日用量（所有人格共享）'], ['重置当前人格今日', '重置当前人格今日用量']]) {
    const button = budgetControl(normal, text)
    assert.equal(button.type(button.props).props['aria-label'], label)
  }
  for (const [scope, label, left] of [['global', '全局', '380'], ['persona', '按人格', '150'], ['both', '两者取最小', '150']]) {
    const tree = renderBudget({ scope })
    assert.match(JSON.stringify(tree.props.actions), new RegExp(label))
    assert.equal(treeNodes(tree).filter((node) => node.type?.name === 'StatTile').at(-1).props.value, left)
  }
})

test('CogBudgetCard: each row warns at 80%, exhausted/zero clamp progress; only active limits block', () => {
  for (const options of [{ usageToday: 400 }, { personaUsed: 160 }]) {
    assert.match(JSON.stringify(renderBudget(options)), /已使用至少 80%，接近上限/)
  }
  for (const options of [{ usageToday: 500 }, { usageToday: 750 }, { usageToday: 0, budget: 0 },
    { personaUsed: 200, scope: 'persona' }, { personaUsed: 300, scope: 'both' }, { personaBudget: 0, personaUsed: 0, scope: 'both' }]) {
    const tree = renderBudget(options)
    assert.match(JSON.stringify(tree), /今日 LLM 预算已耗尽/)
    const bar = treeNodes(tree).filter((node) => node.type?.name === 'CogBar').find((node) => node.props.value === 1)
    assert.ok(bar)
    assert.match(JSON.stringify(bar.type(bar.props)), /100.0%/)
  }
  assert.doesNotMatch(JSON.stringify(renderBudget({ personaUsed: 300 })), /今日 LLM 预算已耗尽/)
  assert.doesNotMatch(JSON.stringify(renderBudget({ usageToday: 700, scope: 'persona' })), /今日 LLM 预算已耗尽/)
  assert.equal(budgetControl(renderBudget({ usageToday: 0 }), '重置全局今日').props.disabled, true)
  assert.equal(budgetControl(renderBudget({ personaUsed: 0 }), '重置当前人格今日').props.disabled, true)
  assert.equal(budgetControl(renderBudget({ usageToday: 0 }), '重置当前人格今日').props.disabled, false)
})

test('CogBudgetCard: loading, errors/retry and reset busy state disable both reset actions', async () => {
  const loading = renderBudget({ loading: true })
  assert.match(JSON.stringify(loading), /正在加载今日 LLM 用量/)
  for (const name of ['重置全局今日', '重置当前人格今日', '刷新']) assert.equal(budgetControl(loading, name).props.disabled, true)
  assert.equal(treeNodes(loading).some((node) => node.type?.name === 'StatTile'), false)
  const calls = [], restore = mockCognitionApi(calls)
  try {
    const error = renderBudget({ error: '读取用量失败' })
    assert.match(JSON.stringify(error), /读取用量失败/)
    for (const name of ['重置全局今日', '重置当前人格今日']) assert.equal(budgetControl(error, name).props.disabled, true)
    await budgetControl(error, '重试').props.onClick()
    await budgetControl(renderBudget(), '刷新').props.onClick()
    assert.equal(calls.length, 2)
    assert.ok(calls.every((call) => call.method === 'GET' && call.path === panel.API_PREFIX + '/cognition/llm/usage'))
    const resetting = renderBudget({ resetting: true })
    for (const name of ['重置全局今日', '重置当前人格今日']) {
      assert.equal(budgetControl(resetting, name).props.busy, true)
      assert.equal(budgetControl(resetting, name).props.disabled, true)
    }
    assert.equal(budgetControl(resetting, '刷新').props.disabled, true)
  } finally { restore() }
})

for (const [scope, label] of [['global', '全局'], ['persona', '当前人格']]) {
  test(`CogBudgetCard: ${scope} cancel makes no request, confirm POSTs scope then reloads`, async () => {
    const calls = [], toasts = [], restore = mockCognitionApi(calls), originalConfirm = window.confirm
    const prompts = []
    try {
      window.confirm = (message) => { prompts.push(message); return false }
      await budgetControl(renderBudget(), '重置' + label + '今日').props.onClick()
      assert.deepEqual(calls, [])
      assert.deepEqual(prompts, ['重置' + label + '今日已用 token？不会修改预算、人格或配置。'])
      window.confirm = () => true
      await budgetControl(renderBudget({ toast: (...args) => toasts.push(args) }), '重置' + label + '今日').props.onClick()
      assert.deepEqual(calls, [
        { path: panel.API_PREFIX + '/cognition/llm/usage/reset', method: 'POST', body: { confirm: true, scope } },
        { path: panel.API_PREFIX + '/cognition/llm/usage', method: 'GET', body: undefined },
      ])
      assert.deepEqual(toasts, [['已重置' + label + '今日 LLM 用量', 'ok']])
    } finally { restore(); window.confirm = originalConfirm }
  })
}

test('CogBudgetCard: failed reset shows error toast without success or reload', async () => {
  const calls = [], toasts = [], restore = mockCognitionApi(calls, { ok: false, message: '重置失败' }), originalConfirm = window.confirm
  try {
    window.confirm = () => true
    await budgetControl(renderBudget({ toast: (...args) => toasts.push(args) }), '重置全局今日').props.onClick()
    assert.equal(calls.length, 1)
    assert.deepEqual(toasts, [['重置失败', 'err']])
  } finally { restore(); window.confirm = originalConfirm }
})

test('CogSettings: budget card appears only above cog-llm fields and keeps config editor', () => {
  const groups = [{ id: 'cog-core', title: '核心', fields: [{ path: 'cognition.enabled', type: 'switch' }] }, { id: 'cog-llm', title: '模型路由与预算', fields: ['dailyTokenBudget', 'budgetScope', 'personaDailyTokenBudget'].map((name) => ({ path: 'cognition.llm.' + name })) }]
  for (const active of ['cog-core', 'cog-llm']) {
    stateOverrides = [active]
    let tree
    try { tree = panel.CogSettings({ configInfo: { groups }, draft: {}, saveUiPatch() {} }) } finally { stateOverrides = null }
    const nodes = treeNodes(tree), cards = nodes.filter((node) => node.type === panel.CogBudgetCard)
    assert.equal(cards.length, active === 'cog-llm' ? 1 : 0)
    if (cards.length) {
      const editors = nodes.filter((node) => node.type?.name === 'FieldRow')
      assert.deepEqual(editors.map((editor) => editor.props.spec.path), ['cognition.llm.dailyTokenBudget', 'cognition.llm.budgetScope', 'cognition.llm.personaDailyTokenBudget'])
      assert.ok(editors.every((editor) => nodes.indexOf(cards[0]) < nodes.indexOf(editor)))
    }
  }
})

test('ModulesPage: 来源/计数/依赖/blocked、内置隐藏重载、清单上限与刷新', async () => {
  const items = [
    { id: 'builtin-typing', name: '私聊输入状态', builtin: true, status: 'loaded', enabled: true, hasConfig: false, permissions: ['turn:lifecycle', 'status:write'], canReload: false, canToggle: true },
    { id: 'builtin-reply-delivery', name: '回复交付', builtin: true, status: 'loaded', enabled: true, hasConfig: false, permissions: ['delivery:plan'], canReload: false, canToggle: true },
    { id: 'builtin-sample', name: '内置示例', builtin: true, status: 'blocked', enabled: true, requires: ['external'], permissions: ['commands'], canReload: false, canToggle: true },
    { id: 'external', name: '外部清单关闭', builtin: false, status: 'disabled', enabled: false, requires: [], canReload: true, canToggle: false },
  ]
  const session = { values: [items, false, '', ''], index: 0 }
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({ toast() {} }) } finally { hookSession = null } }
  const tree = render(), text = JSON.stringify(tree)
  assert.match(text, /内置 3/); assert.match(text, /外部 1/); assert.match(text, /blocked/); assert.match(text, /依赖：external/)
  assert.match(text, /permissions 不是沙箱/)
  const panels = treeNodes(tree).filter((node) => node.props?.title)
  const built = panels.find((node) => node.props.title === '内置示例')
  assert.equal(treeNodes(built.props.footer).some((node) => node.children?.includes('重载')), false)
  assert.equal(control(built.props.footer, '停用').props.disabled, false)
  const reply = panels.find((node) => node.props.title === '回复交付')
  assert.ok(reply)
  assert.equal(treeNodes(reply.props.footer).some((node) => node.children?.includes('配置')), false)
  assert.equal(control(reply.props.footer, '停用').props.disabled, false)
  const typing = panels.find((node) => node.props.title === '私聊输入状态')
  assert.ok(typing)
  assert.equal(treeNodes(typing.props.footer).some((node) => ['配置', '重载'].some(label => node.children?.includes(label))), false)
  assert.equal(control(typing.props.footer, '停用').props.disabled, false)
  const external = panels.find((node) => node.props.title === '外部清单关闭')
  assert.equal(control(external.props.footer, '启用').props.disabled, true)
  assert.equal(control(external.props.footer, '重载').props.disabled, false)
  const original = globalThis.fetch, calls = []
  globalThis.fetch = async (path, options) => { calls.push([path, options.method]); return { ok: true, json: async () => ({ ok: true, items }) } }
  try {
    const header = panels.find((node) => node.props.title === '模块目录')
    await control(header.props.actions, '刷新').props.onClick()
    assert.deepEqual(calls, [[panel.API_PREFIX + '/modules', 'GET'], [panel.API_PREFIX + '/modules/ui', 'GET']])
  } finally { globalThis.fetch = original }
})

function moduleUi(item, patch = {}) {
  return {
    moduleId: item.id, source: item.source, trust: item.source, generation: item.generation, uiRevision: item.uiRevision, status: item.status,
    config: { binding: item.hasConfig ? 'module-file' : 'none', schemaVersion: item.hasConfig ? 1 : null, available: item.hasConfig === true },
    surfaces: [
      { id: 'detail', hook: 'module.detail', renderer: 'status', order: 0 },
      ...(item.hasConfig ? [{ id: 'config', hook: 'module.config', renderer: 'schema', order: 1 }] : []),
    ],
    requestedCapabilities: [], grantedCapabilities: [], uiWarning: '', ...patch,
  }
}
const moduleCatalog = (...items) => ({ ok: true, version: 1, items })
const moduleControl = (tree, text) => control([tree, ...treeNodes(tree).flatMap((node) => [node.props?.actions, node.props?.footer])], text)

// Include component action/footer slots so a second set hidden in a Panel/Banner prop fails too.
function savebarNodes(tree) {
  return treeNodes(tree).flatMap(node => [node, ...savebarNodes(node.props?.actions), ...savebarNodes(node.props?.footer)])
}
function assertExplicitSavebar(tree, className, labels) {
  const nodes = savebarNodes(tree)
  const bars = nodes.filter(node => node.props?.className === className)
  assert.equal(bars.length, 1, 'exactly one toolbar across all responsive states')
  const bar = bars[0]
  assert.equal(bar.props.role, 'group')
  assert.ok(bar.props['aria-label'])
  assert.deepEqual(treeNodes(bar).filter(node => node.type?.name === 'Btn').map(node => node.children[0]), labels)
  for (const label of labels) {
    assert.equal(nodes.filter(node => node.type?.name === 'Btn' && node.children?.includes(label)).length, 1, label)
  }
  for (const node of nodes.filter(node => node.type?.name === 'Panel')) {
    assert.ok(!savebarNodes(node).includes(bar), 'toolbar must be outside every clipping Panel')
  }
  assert.ok(!nodes.some(node => node.type?.name === 'Savebar' || node.props?.className === 'ob-savebar'))
  return bar
}

test('ModulesPage WebUI: list → disabled detail → back, status text and unavailable future hooks', async () => {
  const item = { id: 'disabled', name: '声明式模块', source: 'external', builtin: false, status: 'disabled', generation: 'current', uiRevision: 'revision', enabled: false, canToggle: true }
  const ui = moduleUi(item, { surfaces: [
    { id: 'detail', hook: 'module.detail', renderer: 'status', order: 0 },
    { id: 'config', hook: 'module.config', renderer: 'status', order: 1 },
    { id: 'actions', hook: 'module.actions', renderer: 'status', order: 2 },
    { id: 'panel', hook: 'module.panel', renderer: 'schema', order: 3 },
  ] })
  const session = { values: [[item], false, '', ''], index: 0 }, calls = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
  const actions = (title) => { const node = treeNodes(render()).find((node) => node.props?.title === title); return title === '模块目录' ? node.props.actions : node.props.footer }
  const original = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    calls.push([path, options.method])
    return { ok: true, json: async () => ({ ok: true, version: 1, items: path.endsWith('/modules/ui') ? [ui] : [item] }) }
  }
  try {
    await control(actions('模块目录'), '刷新').props.onClick()
    control(actions(item.name), '详情').props.onClick()
    const tree = render(), detail = treeNodes(tree).find((node) => node.props?.['aria-label'] === '模块详情')
    assert.ok(detail)
    assert.match(JSON.stringify(detail), /声明式模块|disabled/)
    assert.match(JSON.stringify(detail), /外部声明式（无执行权限）/)
    assert.match(JSON.stringify(detail), /状态：disabled/)
    for (const hook of ['module.config', 'module.actions', 'module.panel']) {
      const surface = treeNodes(detail).find((node) => node.props?.['aria-label'] === hook)
      assert.ok(surface)
      assert.equal(treeNodes(surface).find((node) => node.children?.includes('暂不可用') && node.type?.name === 'Btn').props.disabled, true)
    }
    assert.ok(!treeNodes(tree).some((node) => node.props?.title === '模块目录'))
    assert.equal(treeNodes(detail).some((node) => ['iframe', 'script', 'input'].includes(node.type) || node.type?.name === 'FieldRow'), false)
    assert.deepEqual(calls, [[panel.API_PREFIX + '/modules', 'GET'], [panel.API_PREFIX + '/modules/ui', 'GET']])
    control(render(), '返回模块列表').props.onClick()
    assert.ok(!treeNodes(render()).some((node) => node.props?.['aria-label'] === '模块详情'))
    assert.ok(treeNodes(render()).some((node) => node.props?.title === '模块目录'))
  } finally { globalThis.fetch = original }
})

test('ModulesPage WebUI: unknown/invalid/stale/absent UI falls back without hiding module', async () => {
  const item = { id: 'builtin-test', name: '受信模块', source: 'builtin', builtin: true, hasConfig: true, status: 'disabled', generation: 'new', uiRevision: 'new', enabled: false, canToggle: true }
  const base = moduleUi(item)
  const cases = [
    { ok: true, version: 2, items: [base] }, { ok: true, version: 1, items: [] },
    ...[
      { generation: 'old' }, { uiRevision: 'old' }, { status: 'loaded' }, { trust: 'external' },
      { config: null }, { config: { binding: 'unknown', schemaVersion: 1, available: true } },
      { config: { binding: 'legacy-core', schemaVersion: 0, available: true } },
      { requestedCapabilities: ['execute'] }, { grantedCapabilities: ['execute'] }, { componentKey: 'malicious' }, { sandbox: {} },
      { surfaces: [null] }, { surfaces: ['invalid'] },
      { surfaces: [{ ...base.surfaces[0], renderer: 'builtin-react' }] },
      { surfaces: [{ ...base.surfaces[0], hook: 'sidebar.panellist' }] },
      { surfaces: [{ ...base.surfaces[0], componentKey: 'malicious' }] },
      { surfaces: [{ ...base.surfaces[0], sandbox: { url: 'javascript:evil()' } }] },
      { surfaces: [{ ...base.surfaces[0], order: 101 }] },
      { surfaces: Array(6).fill(base.surfaces[0]) },
      { surfaces: [base.surfaces[0], { ...base.surfaces[0], id: 'duplicate-hook' }] },
      { surfaces: [] }, { uiWarning: 'MODULE_UI_INVALID' },
    ].map((patch) => ({ ok: true, version: 1, items: [{ ...base, ...patch }] })),
  ]
  const original = globalThis.fetch
  try {
    for (const response of cases) {
      const session = { values: [[item], false, '', ''], index: 0 }
      const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
      const actions = (title) => { const node = treeNodes(render()).find((node) => node.props?.title === title); return title === '模块目录' ? node.props.actions : node.props.footer }
      globalThis.fetch = async (path) => ({ ok: true, json: async () => path.endsWith('/modules/ui') ? response : { ok: true, items: [item] } })
      await control(actions('模块目录'), '刷新').props.onClick()
      control(actions(item.name), '详情').props.onClick()
      const detail = treeNodes(render()).find((node) => node.props?.['aria-label'] === '模块详情')
      assert.match(JSON.stringify(detail), /内置受信任/)
      assert.match(JSON.stringify(detail), /UI 描述不可用或未声明/)
      assert.equal(treeNodes(detail).filter((node) => node.type === 'li' || node.type?.name === 'FieldRow' || node.props?.['aria-label'] === '模块配置').length, 0)
      assert.ok(!treeNodes(detail).some((node) => node.type === 'iframe' || node.type === 'script'))
      assert.ok(treeNodes(detail).some(node => node.type === panel.CoreModuleActions && node.props.moduleId === item.id))
    }
  } finally { globalThis.fetch = original }
})

test('ModulesPage WebUI: UI request failure preserves list, toggles and safe detail', async () => {
  const item = { id: 'external', source: 'external', status: 'disabled', enabled: false, canToggle: true }
  const session = { values: [[item], false, '', ''], index: 0 }, calls = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
  const actions = (title) => { const node = treeNodes(render()).find((node) => node.props?.title === title); return title === '模块目录' ? node.props.actions : node.props.footer }
  const original = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    calls.push(path)
    if (path.endsWith('/modules/ui')) throw Error('UI offline')
    return { ok: true, json: async () => options.method === 'POST' ? { ok: true, item: { ...item, status: 'loaded' } } : { ok: true, items: [item] } }
  }
  try {
    await control(actions('模块目录'), '刷新').props.onClick()
    assert.match(JSON.stringify(render()), /UI 目录暂不可用/)
    control(actions(item.id), '详情').props.onClick()
    assert.match(JSON.stringify(render()), /UI 描述不可用或未声明/)
    await control(actions(item.id), '启用').props.onClick()
    assert.ok(calls.includes(panel.API_PREFIX + '/modules/toggle'))
    assert.equal(session.values[2], '')
  } finally { globalThis.fetch = original }
})

test('ModulesPage external: compatible 启停 payload、状态 toast、失败后清除 busy，空/错误/加载状态', async () => {
  const item = { id: 'external-sample', builtin: false, status: 'disabled', enabled: false, canReload: false, canToggle: true }
  const session = { values: [[item], false, '', ''], index: 0 }, toasts = [], calls = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({ toast: (...args) => toasts.push(args) }) } finally { hookSession = null } }
  const button = () => control(treeNodes(render()).find((node) => node.props?.title === item.id).props.footer, '启用')
  const original = globalThis.fetch
  let status = 'blocked', reject = false
  globalThis.fetch = async (path, options) => {
    calls.push({ path, method: options.method, body: options.body ? JSON.parse(options.body) : undefined })
    if (reject) throw Error('offline')
    return { ok: true, json: async () => options.method === 'POST' ? { ok: true, item: { ...item, status } } : { ok: true, items: [item] } }
  }
  try {
    for (const [nextStatus, message, tone] of [['blocked', '模块被依赖阻塞', 'err'], ['error', '模块加载失败', 'err'], ['loaded', '模块已加载', 'ok']]) {
      status = nextStatus
      await button().props.onClick()
      assert.deepEqual(toasts.at(-1), [message, tone])
      assert.equal(button().props.disabled, false)
    }
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/modules/toggle', method: 'POST', body: { id: item.id, enabled: true } })
    reject = true
    await button().props.onClick()
    assert.equal(button().props.disabled, false)
    assert.equal(toasts.at(-1)[1], 'err')
    assert.ok(session.values[2])
  } finally { globalThis.fetch = original }
  stateOverrides = [[], false, '', '']
  try { assert.match(JSON.stringify(panel.ModulesPage({})), /还没有模块/) } finally { stateOverrides = null }
  stateOverrides = [[], false, '列表失败', '']
  try { assert.match(JSON.stringify(panel.ModulesPage({})), /列表失败/) } finally { stateOverrides = null }
  stateOverrides = [[], true, '', '']
  try { assert.doesNotMatch(JSON.stringify(panel.ModulesPage({})), /还没有模块/) } finally { stateOverrides = null }
})

for (const source of ['builtin', 'external']) test(`ModulesPage ${source} config: detail only, generic FieldRow/FieldControl, save revision, reread and cancel`, async () => {
  const item = { id: source === 'builtin' ? 'builtin-sample' : 'external-sample', name: '配置示例', builtin: source === 'builtin', source, hasConfig: true, status: 'loaded', enabled: true, canToggle: true, generation: 'sample', uiRevision: 'sample-ui' }
  const external = { ...item, id: 'external', name: '外部', builtin: false, source: 'external' }
  const absent = { ...item, id: 'builtin-plain', name: '无配置', hasConfig: false }
  const fields = [
    { path: 'message', label: '回复', type: 'text', maxChars: 200 },
    { path: 'on', label: '开关', type: 'switch' }, { path: 'details', label: '说明', type: 'textarea' },
    { path: 'count', label: '数量', type: 'number', min: 0, max: 10 },
    { path: 'mode', label: '模式', type: 'select', options: [{ value: 'a', label: 'A' }] },
    { path: 'names', label: '名称', type: 'string-list' }, { path: 'numbers', label: '数字', type: 'number-list' },
  ]
  let payload = { ok: true, id: item.id, schema: { version: 1, fields }, values: { message: '原文', on: true, details: '', count: 1, mode: 'a', names: ['name'], numbers: [1] }, revision: 7 }
  const catalog = moduleCatalog(moduleUi(item), moduleUi(external, { config: { binding: 'module-file', schemaVersion: 1, available: false } }), moduleUi(absent))
  const session = { values: [[item, external, absent], false, '', '', null, '', catalog], index: 0 }, calls = [], toasts = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({ toast: (...args) => toasts.push(args) }) } finally { hookSession = null } }
  const card = (tree, title) => treeNodes(tree).find((node) => node.props?.title === title)
  const original = globalThis.fetch
  globalThis.fetch = async (path, options) => {
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ path, method: options.method, body })
    if (options.method === 'POST') payload = { ...payload, values: body.values, revision: payload.revision + 1 }
    return { ok: true, json: async () => path.endsWith('/modules/ui') ? catalog : path.endsWith('/modules') ? { ok: true, items: [item, external, absent] } : payload }
  }
  try {
    const initial = render()
    assert.ok(control(card(initial, item.name).props.footer, '配置'))
    for (const title of [external.name, absent.name]) assert.ok(!treeNodes(card(initial, title).props.footer).some((node) => node.children?.includes('配置')))
    assert.ok(!treeNodes(initial).some((node) => node.props?.['aria-label'] === '模块配置' || node.type?.name === 'FieldRow'))
    await control(card(initial, item.name).props.footer, '配置').props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/modules/config?id=' + item.id, method: 'GET', body: undefined })
    let tree = render()
    assertExplicitSavebar(tree, 'ob-module-savebar', ['保存配置', '重新加载配置', '取消'])
    assert.equal(treeNodes(tree).filter((node) => node.props?.['aria-label'] === '模块配置').length, 1)
    assert.equal(treeNodes(tree).filter((node) => node.props?.['aria-label'] === '模块详情').length, 1)
    if (source === 'external') assert.match(JSON.stringify(tree), /外部声明式（无执行权限）/)
    assert.equal(treeNodes(tree).some((node) => ['iframe', 'script'].includes(node.type) || Object.values(panel.BUILTIN_MODULE_UI).includes(node.type)), false)
    assert.ok(!treeNodes(tree).some((node) => node.props?.title === '模块目录' || node.props?.title === external.name))
    const rows = treeNodes(tree).filter((node) => node.type?.name === 'FieldRow')
    assert.deepEqual(rows.map((node) => node.props.spec.type), fields.map((field) => field.type))
    for (const row of rows) {
      const rowTree = row.type(row.props)
      const fieldControl = treeNodes(rowTree).find((node) => node.type?.name === 'FieldControl')
      assert.ok(fieldControl)
      assert.ok(fieldControl.type(fieldControl.props))
    }
    rows[0].props.onChange('新文')
    tree = render()
    await control(tree, '保存配置').props.onClick()
    const saved = calls.find((call) => call.method === 'POST')
    assert.deepEqual(saved, { path: panel.API_PREFIX + '/modules/config', method: 'POST', body: { id: item.id, values: { ...payload.values, message: '新文' }, revision: 7 } })
    assert.equal(calls.filter((call) => call.path.includes('/modules/config?id=')).length, 2)
    assert.equal(session.values[4].revision, 8)
    assert.equal(session.values[4].values.message, '新文')
    assert.deepEqual(toasts.at(-1), ['模块配置已保存', 'ok'])
    await control(render(), '取消').props.onClick()
    assert.ok(!treeNodes(render()).some((node) => node.type?.name === 'FieldRow'))
    assert.ok(!savebarNodes(render()).some(node => node.props?.className === 'ob-module-savebar'))
    assert.ok(control(render(), '加载配置'))
    control(render(), '返回模块列表').props.onClick()
    assert.ok(!treeNodes(render()).some((node) => node.props?.['aria-label'] === '模块配置' || node.type?.name === 'FieldRow'))
  } finally { globalThis.fetch = original }
})

test('ModulesPage config: busy 禁用、冲突/保存错误保留草稿、重新加载与加载失败', async () => {
  const item = { id: 'builtin-test', source: 'builtin', builtin: true, hasConfig: true, canToggle: true, enabled: true, status: 'loaded', generation: 'current', uiRevision: 'current' }
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(moduleUi(item))], index: 0 }, toasts = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({ toast: (...args) => toasts.push(args) }) } finally { hookSession = null } }
  const payload = { ok: true, id: item.id, schema: { version: 1, fields: [{ path: 'message', label: '回复', type: 'text' }] }, values: { message: 'original' }, revision: 1 }
  const original = globalThis.fetch
  let postResult = { ok: false, code: 'MODULE_CONFIG_CONFLICT', message: 'conflict' }, getError = '', release = null
  globalThis.fetch = async (_path, options) => {
    if (options.method === 'POST') {
      await new Promise((resolve) => { release = resolve })
      if (postResult instanceof Error) throw postResult
      return { ok: true, json: async () => postResult }
    }
    if (getError) throw Error(getError)
    return { ok: true, json: async () => payload }
  }
  try {
    await control(treeNodes(render()).find((node) => node.props?.title === item.id).props.footer, '配置').props.onClick()
    treeNodes(render()).find((node) => node.type?.name === 'FieldRow').props.onChange('draft')
    for (const [result, expected] of [
      [postResult, /配置冲突/], [{ ok: false, code: 'MODULE_CONFIG_INVALID', message: 'invalid value' }, /invalid value/],
      [{ ok: false, code: 'MODULE_CONFIG_WRITE_FAILED', message: 'write failed' }, /write failed/],
      [{ ok: false, code: 'MODULE_CONFIG_UNAVAILABLE', message: 'unavailable' }, /unavailable/], [Error('offline'), /offline/],
    ]) {
      postResult = result
      const saving = control(render(), '保存配置').props.onClick()
      const pending = render()
      assertExplicitSavebar(pending, 'ob-module-savebar', ['保存配置', '重新加载配置', '取消'])
      assert.equal(control(pending, '保存配置').props.disabled, true)
      assert.equal(control(pending, '取消').props.disabled, true)
      assert.equal(control(pending, '重新加载配置').props.disabled, true)
      assert.ok(treeNodes(pending).filter((node) => node.type?.name === 'FieldRow').every((node) => node.props.disabled))
      release(); await saving
      assert.match(JSON.stringify(render()), expected)
      assertExplicitSavebar(render(), 'ob-module-savebar', ['保存配置', '重新加载配置', '取消'])
      assert.equal(session.values[4].values.message, 'draft')
      assert.equal(session.values[4].revision, 1)
      assert.equal(control(render(), '保存配置').props.disabled, false)
    }
    assert.equal(toasts.length, 0)
    await control(render(), '重新加载配置').props.onClick()
    assert.equal(session.values[4].values.message, 'original')
    getError = 'load failed'
    await control(render(), '重新加载配置').props.onClick()
    assert.match(JSON.stringify(render()), /load failed/)
    assertExplicitSavebar(render(), 'ob-module-savebar', ['保存配置', '重新加载配置', '取消'])
    assert.equal(control(render(), '保存配置').props.disabled, true)
    assert.equal(control(render(), '取消').props.disabled, false)
  } finally { globalThis.fetch = original }
})


test('ModulesPage WebUI: card background and detail button navigate; card/detail summaries are text', async () => {
  const text = '<img src=x onerror=evil()> <script>evil()</script>'
  const item = { id: 'text-only', name: '安全文本', description: text, error: text, builtin: false, source: 'external', enabled: true, status: 'error', generation: 'current', uiRevision: 'ui' }
  const ui = moduleUi(item, { surfaces: [
    { id: 'card', hook: 'module.card', renderer: 'status', order: 0 },
    { id: 'detail', hook: 'module.detail', renderer: 'status', order: 1 },
  ] })
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(ui)], index: 0 }
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
  const card = treeNodes(render()).find((node) => node.type === 'article')
  const summary = treeNodes(card).find((node) => node.props?.['aria-label'] === 'module.card')
  assert.ok(treeNodes(summary).some((node) => node.type === 'p' && node.children.includes(text)))
  await card.props.onClick({ target: { closest: () => ({ tagName: 'BUTTON' }) } })
  assert.ok(!treeNodes(render()).some((node) => node.props?.['aria-label'] === '模块详情'))
  await card.props.onClick({ target: { closest: () => null } })
  const detail = render()
  for (const hook of ['module.card', 'module.detail']) assert.ok(treeNodes(detail).some((node) => node.props?.['aria-label'] === hook))
  assert.match(JSON.stringify(detail), /外部声明式（无执行权限）|已启用|error/)
  assert.ok(treeNodes(detail).some((node) => node.type === 'p' && node.children.includes(text)))
  assert.ok(!treeNodes(detail).some((node) => ['img', 'script', 'iframe'].includes(node.type) || node.props?.dangerouslySetInnerHTML))
  control(detail, '返回模块列表').props.onClick()
  await moduleControl(render(), '详情').props.onClick()
  assert.ok(treeNodes(render()).some((node) => node.props?.['aria-label'] === '模块详情'))
})

for (const source of ['builtin', 'external']) test(`ModulesPage ${source} config: disabled loads read-only; toggle enables editing and disabling blocks writes`, async () => {
  let item = { id: source === 'builtin' ? 'builtin-sample' : 'external-sample', builtin: source === 'builtin', source, hasConfig: true, enabled: false, status: 'disabled', generation: 'sample', uiRevision: 'ui', canToggle: true }
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(moduleUi(item))], index: 0 }, calls = []
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
  const payload = { ok: true, schema: { version: 1, fields: [{ path: 'message', type: 'text', label: '示例回复' }] }, values: { message: 'original' }, revision: 3 }
  const original = globalThis.fetch, confirm = window.confirm
  window.confirm = () => true
  const catalog = () => ({ ok: true, moduleId: item.id, expectedGeneration: 'runtime', items: [{ actionId: item.enabled ? 'module.disable' : 'module.enable', available: true }] })
  const toggle = async label => {
    if (source === 'external') return moduleControl(render(), label).props.onClick()
    const node = treeNodes(render()).find(node => node.type === panel.CoreModuleActions)
    const saved = hookSession
    stateOverrides = [catalog(), '', false, { current: true }]
    let tree
    try { tree = node.type(node.props) } finally { stateOverrides = null; hookSession = saved }
    return control(tree, label).props.onClick()
  }
  globalThis.fetch = async (path, options) => {
    calls.push([path, options.method])
    if (path.includes('/modules/actions?')) return { ok: true, json: async () => catalog() }
    if (path.endsWith('/modules/action')) {
      const enabled = JSON.parse(options.body).actionId === 'module.enable'
      item = { ...item, enabled, status: enabled ? 'loaded' : 'disabled' }
      return { ok: true, json: async () => ({ ok: true, operation: { id: 'op', status: 'succeeded', phase: 'done', result: { ok: true } } }) }
    }
    if (path.endsWith('/modules/toggle')) {
      const enabled = JSON.parse(options.body).enabled
      item = { ...item, enabled, status: enabled ? 'loaded' : 'disabled' }
      return { ok: true, json: async () => ({ ok: true, item }) }
    }
    return { ok: true, json: async () => path.endsWith('/modules/ui') ? moduleCatalog(moduleUi(item)) : path.endsWith('/modules') ? { ok: true, items: [item] } : payload }
  }
  try {
    await moduleControl(render(), '详情').props.onClick()
    assert.match(JSON.stringify(render()), /配置只读/)
    assertExplicitSavebar(render(), 'ob-module-savebar', ['保存配置', '重新加载配置', '取消'])
    let row = treeNodes(render()).find((node) => node.type?.name === 'FieldRow')
    assert.equal(row.props.disabled, true)
    row.props.onChange('forbidden')
    assert.equal(session.values[4].values.message, 'original')
    assert.equal(control(render(), '保存配置').props.disabled, true)
    await control(render(), '保存配置').props.onClick()
    assert.equal(calls.filter(([, method]) => method === 'POST').length, 0)
    await toggle('启用')
    row = treeNodes(render()).find((node) => node.type?.name === 'FieldRow')
    assert.equal(row.props.disabled, false)
    row.props.onChange('draft')
    assert.equal(session.values[4].values.message, 'draft')
    await toggle('停用')
    assert.equal(control(render(), '保存配置').props.disabled, true)
    await control(render(), '保存配置').props.onClick()
    assert.equal(calls.some(([path, method]) => path.endsWith('/modules/config') && method === 'POST'), false)
    assert.ok(!treeNodes(render()).some((node) => ['iframe', 'script'].includes(node.type)))
  } finally { globalThis.fetch = original; window.confirm = confirm }
})

test('module ownership metadata survives normalization and rejects unbounded/non-string IDs', () => {
  for (const module of ['builtin-typing', 'a'.repeat(64)]) {
    assert.equal(panel.normalizeFieldSpec({ path: 'x', module }).module, module)
    assert.equal(panel.buildFieldSpecs([{ fields: [{ path: 'x', module }] }])[0].fields[0].module, module)
  }
  for (const module of ['', 'a'.repeat(65), ' builtin-typing ', 'UPPER', {}, true, null]) {
    assert.equal(panel.normalizeFieldSpec({ path: 'x', module }).module, undefined)
  }
})

test('ModulesPage legacy config: all owned fields, draft values, global patch saves and preference status; no module-file requests', async () => {
  const original = globalThis.fetch, calls = [], patches = []
  globalThis.fetch = async (path) => { calls.push(path); throw Error('legacy detail must not fetch module-file config') }
  try {
    for (const id of ['builtin-learning', 'builtin-reply-delivery', 'builtin-typing', 'builtin-reminders', 'builtin-media-features', 'builtin-proactivity']) {
      const owned = CONFIG_GROUPS.flatMap((group) => group.fields).filter((spec) => spec.module === id)
      assert.ok(owned.length)
      const item = { id, builtin: true, source: 'builtin', status: 'loaded', enabled: true, generation: id, uiRevision: 'ui' }
      const catalog = moduleCatalog(moduleUi(item, {
        config: { binding: 'legacy-core', schemaVersion: 1, available: true },
        surfaces: [{ id: 'config', hook: 'module.config', renderer: 'schema', order: 1 }],
      }))
      const session = { values: [[item], false, '', '', null, '', catalog], index: 0 }
      let draft = panel.setByPath(DEFAULTS, owned[0].path, owned[0].type === 'switch' ? !owned[0].default : 17)
      const prefStatus = { state: 'saved' }
      const render = () => {
        session.index = 0; hookSession = session
        try { return panel.ModulesPage({ configInfo: { groups: CONFIG_GROUPS }, draft, saveUiPatch: (patch) => patches.push(patch), prefStatus }) }
        finally { hookSession = null }
      }
      await moduleControl(render(), '配置').props.onClick()
      let tree = render()
      assert.match(JSON.stringify(tree), /这些设置属于本模块；存储键保持不变/)
      assert.equal(treeNodes(tree).filter((node) => node.props?.['aria-label'] === '模块配置').length, 1)
      const rows = treeNodes(tree).filter((node) => node.type?.name === 'FieldRow')
      assert.deepEqual(rows.map((row) => row.props.spec.path), owned.map((spec) => spec.path))
      assert.equal(treeNodes(tree).find((node) => node.type?.name === 'PreferenceSaveStatus').props.status, prefStatus)
      assert.ok(!savebarNodes(tree).some(node => ['ob-module-savebar', 'ob-owner-savebar', 'ob-savebar'].includes(node.props?.className) || node.type?.name === 'Savebar'))
      for (const row of rows) {
        const { spec } = row.props
        assert.equal(row.props.value, panel.getByPath(draft, spec.path))
        assert.equal(row.props.disabled, false)
        assert.ok(treeNodes(row.type(row.props)).some((node) => node.type?.name === 'FieldControl'))
        const next = spec.type === 'switch' ? !row.props.value : row.props.value + 1
        row.props.onChange(next)
        assert.deepEqual(patches.at(-1), { [spec.path]: next })
      }
      draft = panel.setByPath(draft, owned[0].path, owned[0].default)
      assert.equal(treeNodes(render()).find((node) => node.type?.name === 'FieldRow').props.value, owned[0].default)
      assert.ok(!treeNodes(tree).some((node) => node.children?.includes('保存配置') || node.children?.includes('加载配置')))
      for (const [enabled, status] of [[false, 'disabled'], [true, 'loading'], [true, 'blocked'], [true, 'error'], [false, 'loaded']]) {
        session.values[0] = [{ ...item, enabled, status }]
        session.values[6] = moduleCatalog({ ...catalog.items[0], status })
        tree = render()
        assert.match(JSON.stringify(tree), /配置只读/)
        const disabledRows = treeNodes(tree).filter((node) => node.type?.name === 'FieldRow')
        assert.equal(disabledRows.length, owned.length)
        const count = patches.length
        for (const row of disabledRows) { assert.equal(row.props.disabled, true); row.props.onChange('forbidden') }
        assert.equal(patches.length, count)
      }
      session.values[0] = [item]
      session.values[6] = catalog
      assert.ok(treeNodes(render()).filter((node) => node.type?.name === 'FieldRow').every((row) => !row.props.disabled))
      for (const invalid of [null, moduleCatalog({ ...catalog.items[0], generation: 'old' }), moduleCatalog({ ...catalog.items[0], config: { ...catalog.items[0].config, available: false } })]) {
        session.values[6] = invalid
        assert.ok(!treeNodes(render()).some((node) => node.type?.name === 'FieldRow'))
      }
    }
    assert.deepEqual(calls, [])
  } finally { globalThis.fetch = original }
})

test('system settings exclude module fields and empty reminders group without duplicate paths', () => {
  const modulePaths = CONFIG_GROUPS.flatMap((group) => group.fields).filter((spec) => spec.module).map((spec) => spec.path)
  const props = { configInfo: { groups: CONFIG_GROUPS }, draft: DEFAULTS, issues: [], saveUiPatch() {} }
  const cog = panel.CogSettings(props)
  const groupIds = cog.props.items.map((group) => group.id)
  assert.ok(!groupIds.includes('cog-reminders'))
  assert.ok(groupIds.includes('cog-reply') && groupIds.includes('cog-turn'))
  const systemPaths = []
  for (const id of groupIds) {
    stateOverrides = [id]
    let tree
    try { tree = panel.CogSettings(props) } finally { stateOverrides = null }
    const paths = treeNodes(tree).filter((node) => node.type?.name === 'FieldRow').map((row) => row.props.spec.path)
    if (id === 'cog-reply') assert.deepEqual(paths, ['cognition.notices.enabled', 'cognition.requests.enabled', 'cognition.notice.patReply', 'cognition.notice.patCooldownMs'])
    if (id === 'cog-turn') assert.deepEqual(paths, CONFIG_GROUPS.find((group) => group.id === id).fields.filter((spec) => !spec.module).map((spec) => spec.path))
    systemPaths.push(...paths)
  }
  // Removed navigation targets safely fall back to a nonempty system group.
  stateOverrides = ['cog-reminders']
  try { assert.ok(!treeNodes(panel.CogSettings(props)).some((node) => node.props?.spec?.module)) } finally { stateOverrides = null }
  const config = panel.ConfigTab(props)
  const configIds = treeNodes(config).find((node) => node.type?.name === 'SettingsShell').props.items.map((group) => group.id)
  for (const id of configIds) {
    stateOverrides = [id]
    try { systemPaths.push(...treeNodes(panel.ConfigTab(props)).filter((node) => node.type?.name === 'FieldRow').map((row) => row.props.spec.path)) }
    finally { stateOverrides = null }
  }
  systemPaths.push(...panel.settingsSections(CONFIG_GROUPS).flatMap((group) => group.fields.map((spec) => spec.path)))
  assert.equal(new Set([...systemPaths, ...modulePaths]).size, systemPaths.length + modulePaths.length)
  assert.deepEqual(new Set([...systemPaths, ...modulePaths]), new Set(CONFIG_GROUPS.flatMap((group) => group.fields.map((spec) => spec.path))))
})

test('ModulesPage config: successful save keeps new revision when reread fails', async () => {
  const item = { id: 'builtin-sample', builtin: true, source: 'builtin', hasConfig: true, enabled: true, status: 'loaded', generation: 'sample', uiRevision: 'ui' }
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(moduleUi(item))], index: 0 }
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({}) } finally { hookSession = null } }
  const payload = { ok: true, schema: { version: 1, fields: [{ path: 'message', type: 'text' }] }, values: { message: 'saved' }, revision: 5 }
  let saved = false
  const original = globalThis.fetch
  globalThis.fetch = async (_path, options) => {
    if (options.method === 'POST') { saved = true; return { ok: true, json: async () => ({ ...payload, revision: 6 }) } }
    if (saved) throw Error('reread failed')
    return { ok: true, json: async () => payload }
  }
  try {
    await moduleControl(render(), '详情').props.onClick()
    await control(render(), '保存配置').props.onClick()
    assert.equal(session.values[4].revision, 6)
    assert.equal(session.values[4].values.message, 'saved')
    assert.match(JSON.stringify(render()), /reread failed/)
  } finally { globalThis.fetch = original }
})

test('ModulesPage trusted previews render bounded read-only drafts without requests', () => {
  assert.ok(Object.isFrozen(panel.BUILTIN_MODULE_UI))
  assert.deepEqual(Object.keys(panel.BUILTIN_MODULE_UI), BUILTIN_COMPONENT_KEYS)
  const draft = { secret: 'global-secret-marker', content: { bilibili: { enabled: false } }, media: { enabled: true, images: { enabled: true }, stickers: { enabled: true } }, cognition: {
    reply: { split: true, maxChars: 480, maxParts: 4, quote: true, atSender: false, delayMs: 800, secret: 'reply-secret-marker' },
    typing: { enabled: true },
    learning: { enabled: true, autoResearch: false, detectUnknowns: true, maxTasksPerHour: 3, secret: 'learning-secret-marker' },
    proactivity: { enabled: true, quietStart: 23, quietEnd: 8, maxPrivatePerDay: 1, maxGroupPerDay: 0, minFamiliarity: 0.5, backoffHours: 24, secret: 'proactive-secret-marker' },
    reminders: { enabled: true, maxActive: 25, minIntervalSeconds: 120, maxIntervalSeconds: 3600, tickMs: 5000 },
  } }
  const original = globalThis.fetch
  globalThis.fetch = () => { throw Error('preview must not request data') }
  try {
    const cases = [
      ['reply-delivery', ['模块启用：开启', '长回复分条：开启', '单条字数上限：480', '最多分条：4', '引用原消息：开启；群聊 @ 对方：关闭', '分条等待：800 ms / 条间']],
      ['learning', ['模块启用：开启', '学习开关：开启', '自动外部检索：关闭', '未知检测：开启', '每小时任务上限：3']],
      ['typing', ['模块启用：开启', '输入状态开关：开启', '输入状态有效状态：开启（仅私聊，依赖网关支持）']],
      ['proactivity', ['模块启用：开启', '主动行为开关：开启（仅私聊）', '安静时段（本地小时）：23–8', '滚动 24 小时私聊上限：1', '最低熟悉度：0.5；无回应退避：24 小时']],
      ['reminders', ['模块启用：开启', '主人提醒开关：开启', '每人格活跃提醒上限：25', '最短重复间隔：120 s', '最长重复间隔：3600 s', '到期检查间隔：5000 ms']],
      ['sample', ['示例回复：<img src=x onerror=evil()> 只读样例']],
      ['media-features', ['模块启用：开启', 'B站公共内容：关闭', '表情包开关：开启', '表情包库有效状态：开启', '表情包发送有效状态：开启']],
    ]
    for (const [name, expected] of cases) {
      const item = { id: 'builtin-' + name, name: 'n'.repeat(200), builtin: true, source: 'builtin', enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
      const key = name + '.preview'
      const ui = moduleUi(item, { surfaces: [{ id: 'detail', hook: 'module.detail', renderer: 'builtin-react', componentKey: key, order: 0 }] })
      const editor = { id: item.id, values: { message: '<img src=x onerror=evil()> 只读样例', secret: 'sample-secret-marker' } }
      stateOverrides = [[item], false, '', '', editor, '', moduleCatalog(ui), '', item.id]
      let tree
      try { tree = panel.ModulesPage({ draft, saveUiPatch() { throw Error('preview must not save') } }) } finally { stateOverrides = null }
      const preview = treeNodes(tree).find((node) => node.type === panel.BUILTIN_MODULE_UI[key])
      assert.ok(preview, key)
      for (const data of [preview.props.module, preview.props.config, preview.props.summary]) assert.ok(Object.isFrozen(data))
      assert.ok(preview.props.module.name.length <= 128)
      assert.equal(preview.props.summary.readOnly, true)
      assert.doesNotMatch(JSON.stringify(preview.props), /secret-marker|saveUiPatch/)
      const rendered = preview.type(preview.props)
      for (const text of expected) assert.ok(JSON.stringify(rendered).includes(text), text)
      assert.equal(treeNodes(rendered).some((node) => ['input', 'textarea', 'button', 'iframe', 'script', 'img'].includes(node.type) || node.props?.dangerouslySetInnerHTML || Object.keys(node.props || {}).some((key) => key.startsWith('on'))), false)
      if (name === 'typing') {
        for (const module of [{ ...preview.props.module, enabled: false }, { ...preview.props.module, status: 'error' }]) assert.match(JSON.stringify(preview.type({ ...preview.props, module })), /输入状态有效状态：未生效/)
        assert.match(JSON.stringify(preview.type({ ...preview.props, config: { enabled: false } })), /输入状态有效状态：未生效/)
      }
      if (name === 'media-features') {
        const imagesOff = preview.type({ ...preview.props, config: { ...preview.props.config, imagesEnabled: false } })
        assert.match(JSON.stringify(imagesOff), /表情包库有效状态：开启/)
        assert.match(JSON.stringify(imagesOff), /表情包发送有效状态：未生效/)
        for (const module of [{ ...preview.props.module, enabled: false }, { ...preview.props.module, status: 'error' }]) {
          const closed = JSON.stringify(preview.type({ ...preview.props, module }))
          assert.match(closed, /表情包库有效状态：未生效/)
          assert.match(closed, /表情包发送有效状态：未生效/)
        }
        for (const flag of ['mediaEnabled', 'stickersEnabled']) {
          const closed = JSON.stringify(preview.type({ ...preview.props, config: { ...preview.props.config, [flag]: false } }))
          assert.match(closed, /表情包库有效状态：未生效/)
          assert.match(closed, /表情包发送有效状态：未生效/)
        }
      }
      if (name === 'reply-delivery') assert.match(JSON.stringify(preview.type({ ...preview.props, config: { ...preview.props.config, split: false } })), /分条关闭，无条间等待/)
    }
    assert.equal(draft.cognition.reply.maxChars, 480)
  } finally { globalThis.fetch = original }
})

test('ModulesPage Phase 3B: unknown key fallback and external builtin-react never reaches registry', () => {
  const base = { id: 'builtin-sample', builtin: true, source: 'builtin', enabled: false, status: 'disabled', generation: 'g', uiRevision: 'r' }
  for (const [patch, key, fallback] of [
    [{}, 'unknown.preview', '内置预览组件不可用'],
    [{}, 'constructor.preview', '内置预览组件不可用'],
    [{ id: 'external', builtin: false, source: 'external' }, 'sample.preview', 'UI 描述不可用或未声明'],
    [{ id: 'external-config', builtin: false, source: 'external', hasConfig: true }, 'sample.preview', 'UI 描述不可用或未声明'],
    [{ id: 'spoof', builtin: false, source: 'builtin' }, 'typing.preview', 'UI 描述不可用或未声明'],
  ]) {
    const item = { ...base, ...patch }
    const ui = moduleUi(item, { surfaces: [{ id: 'detail', hook: 'module.detail', renderer: 'builtin-react', componentKey: key, order: 0 }] })
    stateOverrides = [[item], false, '', '', null, '', moduleCatalog(ui), '', item.id]
    let tree
    try { tree = panel.ModulesPage({}) } finally { stateOverrides = null }
    assert.match(JSON.stringify(tree), new RegExp(fallback))
    assert.equal(treeNodes(tree).some((node) => Object.values(panel.BUILTIN_MODULE_UI).includes(node.type)), false)
  }
})

test('ModulesPage Phase 3B: missing or oversized config stays bounded and module scoped', () => {
  const item = { id: 'builtin-sample', builtin: true, source: 'builtin', status: 'disabled', generation: 'g', uiRevision: 'r' }
  const ui = moduleUi(item, { surfaces: [{ id: 'detail', hook: 'module.detail', renderer: 'builtin-react', componentKey: 'sample.preview', order: 0 }] })
  for (const editor of [null, { id: 'other', values: { message: 'wrong-module-marker' } }, { id: item.id, values: { message: 'x'.repeat(1000) } }]) {
    stateOverrides = [[item], false, '', '', editor, '', moduleCatalog(ui), '', item.id]
    let tree
    try { tree = panel.ModulesPage({}) } finally { stateOverrides = null }
    const preview = treeNodes(tree).find((node) => node.type === panel.BUILTIN_MODULE_UI['sample.preview'])
    assert.ok(preview.props.config.message.length <= 200)
    assert.doesNotMatch(JSON.stringify(preview.props), /wrong-module-marker/)
    if (!editor || editor.id !== item.id) assert.match(JSON.stringify(preview.type(preview.props)), /未加载配置/)
  }
})

test('ModulesPage sandbox: grant fallback/confirmation, external loaded gating and iframe attributes', async () => {
  let item = { id: 'sandbox-test', name: '隔离测试', builtin: false, source: 'external', permissions: ['ui:sandbox'], enabled: true, status: 'loaded', generation: 'generation', uiRevision: 'revision', canToggle: true }
  let granted = false
  const ui = () => moduleUi(item, { surfaces: [{ id: 'panel', hook: 'module.panel', renderer: 'sandbox', order: 0 }], sandbox: { entry: 'webui/index.html', available: true, reason: granted ? '' : '未授权或授权已失效' }, requestedCapabilities: ['ui.sandbox'], grantedCapabilities: granted ? ['ui.sandbox'] : [] })
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(ui()), '', item.id], index: 0 }
  const render = () => { session.index = 0; hookSession = session; try { return panel.ModulesPage({ toast() {} }) } finally { hookSession = null } }
  const original = globalThis.fetch, confirm = window.confirm, calls = [], prompts = []
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : undefined })
    if (path.endsWith('/grant')) { granted = JSON.parse(init.body).enabled; item = { ...item, generation: 'new-generation' }; return { ok: true, json: async () => ({ ok: true }) } }
    return { ok: true, json: async () => path.endsWith('/modules/ui') ? moduleCatalog(ui()) : { ok: true, items: [item] } }
  }
  try {
    assert.match(JSON.stringify(render()), /未授权或授权已失效/)
    assert.equal(treeNodes(render()).some((node) => node.type === panel.SandboxModuleFrame), false)
    window.confirm = (text) => { prompts.push(text); return false }
    await moduleControl(render(), '启用隔离 WebUI').props.onClick()
    assert.deepEqual(calls, []); assert.match(prompts[0], /HTML\/脚本.*DOM.*Cookie.*API/)
    window.confirm = () => true
    await moduleControl(render(), '启用隔离 WebUI').props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/modules/ui/grant', method: 'POST', body: { id: item.id, enabled: true } })
    const component = treeNodes(render()).find((node) => node.type === panel.SandboxModuleFrame)
    assert.ok(component)
    assert.deepEqual(Object.keys(component.props.item).sort(), ['generation', 'id', 'uiRevision'])
    const iframe = component.type(component.props)
    assert.equal(iframe.type, 'iframe'); assert.equal(iframe.props.sandbox, 'allow-scripts'); assert.equal(iframe.props.referrerPolicy, 'no-referrer')
    assert.equal(iframe.props.src, '/onebot-qq/module-ui/sandbox-test/new-generation/index.html')
    assert.equal(iframe.props.style.width, '100%'); assert.equal(iframe.props.style.minWidth, 0); assert.equal(iframe.props.style.maxWidth, '100%')
    assert.equal(iframe.props.srcDoc, undefined); assert.equal(iframe.props.allow, undefined)
    for (const patch of [{ enabled: false }, { status: 'disabled' }, { status: 'blocked' }, { permissions: [] }, { builtin: true, source: 'builtin' }]) {
      const changed = { ...item, ...patch }
      session.values[0] = [changed]
      assert.equal(treeNodes(render()).some((node) => node.type === panel.SandboxModuleFrame), false)
    }
    session.values[0] = [item]
    await moduleControl(render(), '撤销').props.onClick()
    assert.equal(granted, false)
    assert.equal(treeNodes(render()).some((node) => node.type === panel.SandboxModuleFrame), false)
    // List never instantiates external frames.
    session.values[8] = ''
    assert.equal(treeNodes(render()).some((node) => node.type === panel.SandboxModuleFrame), false)
  } finally { globalThis.fetch = original; window.confirm = confirm }
})

test('ModulesPage sandbox: malformed catalog or missing permission never mounts a frame', () => {
  const item = { id: 'sandbox-test', builtin: false, source: 'external', permissions: ['ui:sandbox'], enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
  const base = moduleUi(item, { sandbox: { entry: 'webui/index.html', available: true, reason: '' }, surfaces: [{ id: 'panel', hook: 'module.panel', renderer: 'sandbox', order: 0 }], requestedCapabilities: ['ui.sandbox'], grantedCapabilities: ['ui.sandbox'] })
  for (const patch of [
    { sandbox: { ...base.sandbox, entry: '../index.html' } }, { sandbox: { ...base.sandbox, entry: 'webui/a\\index.html' } },
    { sandbox: { ...base.sandbox, url: 'https://evil/' } }, { sandbox: { ...base.sandbox, available: false } },
    { requestedCapabilities: [] }, { grantedCapabilities: ['host.api'] }, { generation: 'old' },
    { surfaces: [{ ...base.surfaces[0], componentKey: 'sample.preview' }] },
    { surfaces: [{ ...base.surfaces[0], hook: 'module.card' }] },
    { surfaces: [...base.surfaces, { id: 'detail', hook: 'module.detail', renderer: 'sandbox', order: 1 }] },
  ]) {
    stateOverrides = [[item], false, '', '', null, '', moduleCatalog({ ...base, ...patch }), '', item.id]
    try {
      const tree = panel.ModulesPage({})
      assert.equal(treeNodes(tree).some((node) => node.type === panel.SandboxModuleFrame), false)
      assert.match(JSON.stringify(tree), /UI 描述不可用/)
    } finally { stateOverrides = null }
  }
  stateOverrides = [[{ ...item, permissions: [] }], false, '', '', null, '', moduleCatalog({ ...base, grantedCapabilities: [] }), '', item.id]
  try {
    const tree = panel.ModulesPage({})
    assert.match(JSON.stringify(tree), /缺少 ui:sandbox 权限/)
    assert.equal(moduleControl(tree, '启用隔离 WebUI').props.disabled, true)
  } finally { stateOverrides = null }
})

test('sandbox bridge: nonce/source/version/type, forged/stale/oversize messages, bounded callbacks and cleanup', () => {
  const listeners = new Set(), timers = new Map(), posted = [], resized = [], notices = []
  let random = 0, current = true
  const host = {
    crypto: { getRandomValues(bytes) { bytes.fill(++random) } },
    addEventListener(type, fn) { assert.equal(type, 'message'); listeners.add(fn) },
    removeEventListener(type, fn) { listeners.delete(fn) },
    setTimeout(fn, delay) { assert.equal(delay, 10000); const id = timers.size + 1; timers.set(id, fn); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const frame = { contentWindow: { postMessage(data, origin) { posted.push({ data, origin }) } } }
  const metadata = { id: 'external', generation: 'g', uiRevision: 'r', config: { secret: 'must-not-send' } }
  const callbacks = { current: () => current, resize: (h) => resized.push(h), notify: (text) => notices.push(text) }
  const stop = panel.attachSandboxBridge(frame, metadata, callbacks, host)
  const init = posted[0].data
  assert.equal(posted[0].origin, '*'); assert.match(init.nonce, /^[a-f0-9]{32}$/)
  assert.deepEqual(init.module, { id: 'external', generation: 'g', uiRevision: 'r' }); assert.doesNotMatch(JSON.stringify(init), /secret|config/)
  const send = (data, patch = {}) => { for (const fn of listeners) fn({ source: frame.contentWindow, origin: 'null', data: { version: 1, nonce: init.nonce, ...data }, ...patch }) }
  send({ type: 'resize', height: 400 }); assert.deepEqual(resized, [])
  for (const patch of [{ source: {} }, { origin: 'https://host.local' }]) send({ type: 'ready' }, patch)
  for (const data of [{ type: 'ready', nonce: 'forged' }, { type: 'ready', version: 2 }, { type: 'ready', secret: 'extra' }, { type: 'fetch' }]) send(data)
  send({ type: 'resize', height: 400 }); assert.deepEqual(resized, [])
  send({ type: 'ready' }); assert.equal(timers.size, 0)
  for (const height of [-1, 119, 1001, Infinity, '400', 400.5]) send({ type: 'resize', height })
  for (const text of ['', 'x'.repeat(201), '\0secret', {}, ['text']]) send({ type: 'notify', text })
  send({ type: 'resize', height: 500, url: '/api' })
  assert.deepEqual(resized, []); assert.deepEqual(notices, [])
  send({ type: 'resize', height: 500 }); send({ type: 'notify', text: '<b>plain text</b>' })
  assert.deepEqual(resized, [500]); assert.deepEqual(notices, ['<b>plain text</b>'])
  current = false; send({ type: 'resize', height: 600 }); assert.deepEqual(resized, [500])
  current = true
  const saved = frame.contentWindow; frame.contentWindow = {}
  send({ type: 'notify', text: 'stale window' }, { source: saved }); assert.equal(notices.length, 1)
  frame.contentWindow = saved
  stop(); stop(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0)
  const stopNew = panel.attachSandboxBridge(frame, metadata, callbacks, host)
  assert.notEqual(posted[1].data.nonce, init.nonce)
  send({ type: 'ready' }); send({ type: 'notify', text: 'old nonce' }); assert.equal(notices.length, 1)
  const timer = [...timers.values()][0]; timer(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0)
  stopNew()
})

test('sandbox iframe: repeated loads rotate bridge and unmount removes listener/timeouts', () => {
  const effect = reactShim.useEffect, host = { crypto: window.crypto, add: window.addEventListener, remove: window.removeEventListener, timeout: window.setTimeout, clear: window.clearTimeout }
  const listeners = new Set(), timers = new Set(), posted = []
  let unmount, count = 0
  try {
    reactShim.useEffect = (fn) => { unmount = fn() }
    window.crypto = { getRandomValues(bytes) { bytes.fill(++count) } }
    window.addEventListener = (type, fn) => listeners.add(fn)
    window.removeEventListener = (type, fn) => listeners.delete(fn)
    window.setTimeout = (fn) => { timers.add(fn); return fn }
    window.clearTimeout = (fn) => timers.delete(fn)
    // Factory captures hooks, so create this instance with the effect-aware shim.
    const component = registration.factory(requireShim).SandboxModuleFrame
    const iframe = component({ item: { id: 'external', generation: 'g', uiRevision: 'r' }, entry: 'webui/index.html' })
    iframe.props.ref.current = { contentWindow: { postMessage(data) { posted.push(data) } } }
    iframe.props.onLoad(); assert.equal(listeners.size, 1); assert.equal(timers.size, 1)
    iframe.props.onLoad(); assert.equal(listeners.size, 1); assert.equal(timers.size, 1)
    assert.notEqual(posted[0].nonce, posted[1].nonce)
    unmount(); assert.equal(listeners.size, 0); assert.equal(timers.size, 0)
    iframe.props.onLoad(); assert.equal(listeners.size, 0)
  } finally {
    reactShim.useEffect = effect
    window.crypto = host.crypto; window.addEventListener = host.add; window.removeEventListener = host.remove; window.setTimeout = host.timeout; window.clearTimeout = host.clear
  }
})

test('media module panel mounts only in loaded builtin detail; content tab only points to modules', () => {
  const item = { id: 'builtin-media-features', builtin: true, source: 'builtin', enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
  const ui = moduleUi(item, { surfaces: [{ id: 'panel', hook: 'module.panel', renderer: 'builtin-react', componentKey: 'media-features.panel', order: 0 }] })
  const render = (patch = {}) => {
    const current = { ...item, ...patch }
    stateOverrides = [[current], false, '', '', null, '', moduleCatalog({ ...ui, status: current.status }), '', item.id]
    try { return panel.ModulesPage({ toast() {} }) } finally { stateOverrides = null }
  }
  assert.ok(treeNodes(render()).some(node => node.type === panel.MediaFeaturesPanel))
  assert.equal(treeNodes(render({ enabled: false, status: 'disabled' })).some(node => node.type === panel.MediaFeaturesPanel), false)
  const navigation = []
  const tree = panel.ContentPage({ goTo: value => navigation.push(value) })
  control(tree, '打开模块').props.onClick()
  assert.deepEqual(navigation, [{ tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' }])
  assert.equal(treeNodes(tree).some(node => node.type === panel.MediaFeaturesPanel || node.type === 'input'), false)
})

// C07: execute handlers and effects with the existing React shim; no browser required.
test('C07 health: core lifecycle, ownership, dependencies, generations and null counters remain distinct', () => {
  const data = { ok: true, items: [{ moduleId: 'builtin-reminders', lifecycle: 'loaded', phase: 'draining', health: 'degraded', reasonCode: 'STOP_PENDING', reasons: ['STOP_PENDING'], runtimeGeneration: 'run-2', telemetryGeneration: 'run-1', lastError: { reasonCode: 'PROVIDER_STOP_FAILED', observedAt: 1, runtimeGeneration: 'run-1' }, dependencies: [{ moduleId: 'dependency', available: false }], providers: [{ name: 'reminders', registeredModuleId: 'builtin-reminders', owner: 'core', ownerModuleId: null, state: 'active', fallback: { active: true, reasonCode: 'PROVIDER_UNAVAILABLE' } }], scheduler: { running: 0, scheduled: null }, engine: { runs: 4, skipped: 3 } }] }
  stateOverrides = [data, '', false]
  let tree
  try { tree = panel.CoreModuleHealth({ moduleId: 'builtin-reminders' }) } finally { stateOverrides = null }
  const text = JSON.stringify(tree)
  for (const word of ['lifecycle', 'loaded', 'health', 'degraded', 'STOP_PENDING', 'lastError', 'PROVIDER_STOP_FAILED', 'registeredModuleId', 'ownerModuleId', 'core', 'fallback', 'dependency', 'run-1', 'run-2', '调度计数', '引擎计数', '未观察']) assert.ok(text.includes(word), word)
  stateOverrides = [{ items: [{ moduleId: 'plain', providers: [], dependencies: [] }] }, '', false]
  try { assert.match(JSON.stringify(panel.CoreModuleHealth({ moduleId: 'plain' })), /不适用（无 Provider）/) } finally { stateOverrides = null }
})

test('C07 actions: guarded admission, effects confirmation, STOP_PENDING polling, no success on skip/busy/fail', async () => {
  const original = globalThis.fetch, confirm = window.confirm, calls = [], confirms = [], observations = []
  const catalog = { ok: true, moduleId: 'builtin-learning', expectedGeneration: 'runtime-generation', expectedPersonaId: 'self', expectedPersonaGeneration: 2, items: [{ actionId: 'learning.runPending', available: true }] }
  let terminal = { id: 'op', status: 'failed', phase: 'done', code: 'NO_TASK', result: { ok: false, code: 'NO_TASK' } }, poll = 0
  window.confirm = text => { confirms.push(text); return true }
  globalThis.fetch = async (path, init) => {
    calls.push({ path, method: init.method, body: init.body && JSON.parse(init.body) })
    const response = path.includes('/actions?') ? catalog : init.method === 'POST' ? { ok: true, operation: { id: 'op', status: 'queued', phase: 'queued' } } : { ok: true, operation: ++poll === 1 ? { id: 'op', status: 'STOP_PENDING', phase: 'draining', code: 'STOP_PENDING' } : terminal }
    return { ok: true, json: async () => response }
  }
  try {
    const result = await panel.invokeModuleAction(catalog.moduleId, 'learning.runPending', { wait: async () => {}, onOperation: value => observations.push(value.status) })
    assert.deepEqual(observations, ['queued', 'queued', 'STOP_PENDING', 'failed'])
    assert.equal(panel.operationSucceeded(result), false)
    const submitted = calls.find(row => row.method === 'POST').body
    assert.equal(submitted.expectedGeneration, 'runtime-generation')
    assert.equal(submitted.expectedPersonaId, 'self'); assert.equal(submitted.expectedPersonaGeneration, 2)
    assert.match(submitted.requestId, /^[A-Za-z0-9_-]{1,128}$/)
    assert.match(confirms[0], /外部检索、调用模型/)
    assert.equal(calls.filter(row => row.method === 'POST').length, 1)
    for (const code of ['BUSY', 'MODULE_RUN_FAILED', 'NO_TASK']) assert.equal(panel.operationSucceeded({ ...terminal, code }), false)
    assert.equal(panel.operationSucceeded({ status: 'succeeded', result: { ok: false } }), false)
    assert.equal(panel.operationSucceeded({ status: 'succeeded', result: { ok: true } }), true)
    const count = calls.length
    window.confirm = () => false
    assert.equal(await panel.invokeModuleAction(catalog.moduleId, 'learning.runPending', { catalog }), null)
    assert.equal(calls.length, count)
    await assert.rejects(panel.invokeModuleAction('external', 'proactivity.runOnce', { catalog: { moduleId: 'external', items: [{ actionId: 'proactivity.runOnce', available: false }] } }), /MODULE_ACTION_UNAVAILABLE/)
    assert.equal(calls.length, count)
  } finally { globalThis.fetch = original; window.confirm = confirm }
})

test('C07 actions: lost POST response recovers by same requestId; rejected/stale admissions never retry', async () => {
  const original = globalThis.fetch, confirm = window.confirm, calls = []
  const catalog = { moduleId: 'builtin-proactivity', expectedGeneration: 'runtime', items: [{ actionId: 'proactivity.runOnce', available: true }] }
  let reject = false, body
  window.confirm = text => { assert.match(text, /模型并向 QQ 发送消息/); return true }
  globalThis.fetch = async (path, init) => {
    calls.push([path, init.method])
    if (init.method === 'POST') {
      body = JSON.parse(init.body)
      if (!reject) throw Error('response lost')
      return { ok: true, json: async () => ({ ok: false, code: 'MODULE_RUNTIME_CONFLICT' }) }
    }
    assert.equal(new URL(path, 'http://local').searchParams.get('requestId'), body.requestId)
    return { ok: true, json: async () => ({ ok: true, operation: { id: 'op', status: 'succeeded', phase: 'done', result: { ok: true } } }) }
  }
  try {
    assert.equal(panel.operationSucceeded(await panel.invokeModuleAction(catalog.moduleId, 'proactivity.runOnce', { catalog })), true)
    assert.equal(calls.filter(([, method]) => method === 'POST').length, 1)
    reject = true
    const observed = []
    await assert.rejects(panel.invokeModuleAction(catalog.moduleId, 'proactivity.runOnce', { catalog, onOperation: value => observed.push(value) }), /MODULE_RUNTIME_CONFLICT/)
    assert.equal(observed.at(-1).status, 'failed')
    assert.equal(calls.filter(([, method]) => method === 'GET').length, 1)
  } finally { globalThis.fetch = original; window.confirm = confirm }
})

test('C07 action controls: service catalog only, duplicate click guard, pending/error display and terminal toast', async () => {
  const original = globalThis.fetch, confirm = window.confirm, toasts = []
  const catalog = { moduleId: 'external', expectedGeneration: 'runtime', items: [{ actionId: 'module.reload', available: true }, { actionId: 'proactivity.runOnce', available: false, reasonCode: 'MODULE_ACTION_UNAVAILABLE' }, { actionId: 'evil', available: true }] }
  const session = { values: [catalog, '', false], index: 0 }
  const render = () => { session.index = 0; hookSession = session; try { return panel.CoreModuleActions({ moduleId: 'external', toast: (...args) => toasts.push(args) }) } finally { hookSession = null } }
  let release, posts = 0
  window.confirm = () => true
  globalThis.fetch = async (path, init) => {
    if (init.method === 'POST') { posts++; await new Promise(resolve => { release = resolve }); return { ok: true, json: async () => ({ ok: true, operation: { id: 'op', status: 'failed', phase: 'done', code: 'BUSY', result: { ok: false } } }) } }
    return { ok: true, json: async () => ({ ok: true, ...catalog }) }
  }
  try {
    const tree = render()
    assert.equal(control(tree, '执行一次主动行为').props.disabled, true)
    assert.doesNotMatch(JSON.stringify(tree), /evil/)
    const running = control(tree, '重载').props.onClick()
    await control(tree, '重载').props.onClick()
    assert.equal(posts, 1)
    assert.equal(control(render(), '重载').props.disabled, true)
    release(); await running
    assert.deepEqual(toasts, [['BUSY', 'err']])
    session.values[4] = { id: 'op', status: 'STOP_PENDING', phase: 'draining', code: 'STOP_PENDING' }
    assert.match(JSON.stringify(render()), /仍在排空/)
    assert.ok(control(render(), '继续观察操作'))
  } finally { globalThis.fetch = original; window.confirm = confirm }
})

test('C07 typed navigation: same mounted cognition/config destinations, go compatibility and backlinks', async () => {
  assert.deepEqual(panel.navigationTarget({ tab: 'cognition', section: 'loop', decisionId: 'decision_1', taskId: 'task_1', anchor: 'tasks', extra: 'ignored' }), { area: 'overview', section: 'overview' })
  for (const input of [{ tab: 'sidebar' }, { tab: 'modules', moduleId: '../bad' }, { tab: 'cognition', taskId: {} }]) assert.deepEqual(panel.navigationTarget(input), { area: 'overview', section: 'overview' })
  const originalEffect = reactShim.useEffect, effects = []
  reactShim.useEffect = (effect, deps) => effects.push({ effect, deps })
  const props = { navigation: { tab: 'cognition', section: 'learning', taskId: 'task_1' } }
  const mountedPanel = registration.factory(requireShim)
  const render = mountNode({ type: mountedPanel.CognitionTab, props })
  try {
    assert.equal(render().props.active, 'learning')
    for (const section of ['proactivity', 'loop', 'learning']) {
      props.navigation = { tab: 'cognition', section }
      effects.length = 0; render()
      effects.find(row => row.deps?.length === 2 && row.deps[0] === props.navigation).effect()
      assert.equal(render().props.active, section)
    }
    assert.ok(panel.COG_SECTIONS.some(row => row.label === '主动行为'))
    assert.ok(panel.COG_SECTIONS.some(row => row.label === '闭环'))
  } finally { reactShim.useEffect = originalEffect }
  // Root go() remains compatible with config group arguments and shares typed state.
  const session = { values: ['overview', { gateway: {} }, {}, {}, false], index: 0 }
  const root = () => { session.index = 0; hookSession = session; try { return panel.OneBotPage() } finally { hookSession = null } }
  const currentPage = () => treeNodes(root()).find(node => node.type === panel.AreaContent)
  currentPage().props.go('cognition', 'cog-llm')
  assert.equal(currentPage().props.configTarget, '')
  assert.deepEqual(currentPage().props.navigation, { area: 'profiles', section: 'models' })
  currentPage().props.goTo({ tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' })
  assert.deepEqual(currentPage().props.navigation, { area: 'extensions', section: 'module', moduleId: 'builtin-media-features', anchor: 'ob-module-panel' })
  const navigate = []
  const shared = { goTo: value => navigate.push(value) }
  for (const [moduleId, label, target] of [
    ['builtin-media-features', '表情包库', { tab: 'media', anchor: 'stickers' }],
    ['builtin-proactivity', '主动行为', { tab: 'cognition', section: 'proactivity' }],
    ['builtin-learning', '学习', { tab: 'cognition', section: 'learning' }],
    ['builtin-reminders', '提醒数据', { tab: 'modules', moduleId: 'builtin-reminders', anchor: 'reminders' }],
  ]) {
    control(panel.ModuleFeatureLinks({ ...shared, item: { id: moduleId, builtin: true, source: 'builtin' } }), label).props.onClick()
    assert.deepEqual(navigate.at(-1), target)
  }
  assert.equal(panel.ModuleFeatureLinks({ ...shared, item: { id: 'builtin-learning', builtin: false, source: 'external' } }), null)
  for (const [Component, moduleId] of [[panel.CogLearning, 'builtin-learning'], [panel.CogProactivity, 'builtin-proactivity'], [panel.MediaPage, 'builtin-media-features']]) {
    if (Component === panel.MediaPage) stateOverrides = [{}, [], false]
    let tree
    try { tree = Component({ ...shared, toast() {} }) } finally { stateOverrides = null }
    control(tree, '返回模块详情').props.onClick()
    assert.deepEqual(navigate.at(-1), { tab: 'modules', moduleId })
  }
})

test('C07 mounted module navigation opens target config once and consumes repeated same-tab requests', async () => {
  const item = { id: 'builtin-sample', builtin: true, source: 'builtin', hasConfig: true, enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
  const props = { navigation: { tab: 'modules', moduleId: item.id, anchor: 'config' } }
  const session = { values: [[item], false, '', '', null, '', moduleCatalog(moduleUi(item)), '', ''], index: 0 }
  const originalEffect = reactShim.useEffect, originalFetch = globalThis.fetch, effects = [], calls = []
  reactShim.useEffect = (effect, deps) => effects.push({ effect, deps })
  globalThis.fetch = async path => { calls.push(path); return { ok: true, json: async () => ({ ok: true, schema: { version: 1, fields: [{ path: 'message', type: 'text', label: 'message' }] }, values: { message: 'saved' }, revision: 1 }) } }
  const mountedPanel = registration.factory(requireShim)
  const render = () => { session.index = 0; effects.length = 0; hookSession = session; try { return mountedPanel.ModulesPage(props) } finally { hookSession = null } }
  const navigate = async () => {
    render(); effects.find(row => row.deps?.length === 5 && row.deps[0] === props.navigation).effect()
    await new Promise(resolve => setImmediate(resolve))
    return render()
  }
  try {
    let tree = await navigate()
    assert.equal(treeNodes(tree).filter(node => node.type?.name === 'FieldRow').length, 1)
    assert.ok(treeNodes(tree).some(node => node.type === mountedPanel.CoreModuleHealth))
    assert.ok(treeNodes(tree).some(node => node.type === mountedPanel.CoreModuleActions))
    assert.equal(calls.length, 1)
    await navigate(); assert.equal(calls.length, 1, 'consumed target must preserve editor draft')
    props.navigation = { ...props.navigation }
    await navigate(); assert.equal(calls.length, 2, 'same mounted target responds to new request')
  } finally { reactShim.useEffect = originalEffect; globalThis.fetch = originalFetch }
})

test('C07 learning: queue toolbar only, task-specific retry/cancel and selected task; reminder count reuses persona API', async () => {
  const task = { id: 'task-1', status: 'pending', surface: 'concept', plan: [], attempts: 0 }
  stateOverrides = [{ items: [] }, '', false, { items: [task] }, '', false, { items: [] }, '', false]
  let tree
  try { tree = panel.CogLearning({ navigation: { taskId: task.id }, toast() {} }) } finally { stateOverrides = null }
  const all = [tree, ...treeNodes(tree).map(node => node.props?.actions)]
  assert.equal(treeNodes(all).some(node => node.children?.includes('运行')), false)
  assert.ok(treeNodes(all).some(node => node.type === panel.CoreModuleActions && node.props.actionIds.includes('learning.runPending')))
  assert.ok(treeNodes(tree).some(node => node.props?.['aria-current'] === 'true'))
  const originalFetch = globalThis.fetch, calls = []
  globalThis.fetch = async (path, init) => { calls.push({ path, body: init.body && JSON.parse(init.body) }); return { ok: true, json: async () => ({ ok: true }) } }
  try {
    await control(tree, '重试').props.onClick()
    await control(tree, '取消').props.onClick()
    assert.deepEqual(calls.filter(row => row.body).map(row => row.body), [{ taskId: task.id }, { taskId: task.id }])
  } finally { globalThis.fetch = originalFetch }
  stateOverrides = [{ summary: { groups: [{ id: 'reminders', count: 7 }] } }, '', false]
  try { assert.match(JSON.stringify(panel.ReminderData({})), /提醒记录：7/) } finally { stateOverrides = null }
})

test('C07 loop rendering: stages, partial/interrupted receipts, provenance/policy and research links; no raw fields', () => {
  const navigation = []
  const data = {
    item: { id: 'loop_1', kind: 'social', status: 'interrupted', moduleId: 'builtin-learning', decisionId: 'decision_1', unknownId: 'unknown_1', stages: [{ stage: 'detected', at: 1 }, { stage: 'delivering', at: 2 }], raw: 'PRIVATE_CONTENT' },
    receipts: [
      { id: 'r1', kind: 'delivery', status: 'interrupted', attemptedParts: 3, eventId: 'PRIVATE_EVENT_ID', data: { status: 'partial', parts: 1, failedPart: 2, errorCode: 'SEND_FAILED', content: 'PRIVATE_CONTENT' } },
      { id: 'r2', kind: 'feedback', status: 'completed', data: { source: 'manual', attribution: 'direct', observation: 'negative', policyUpdated: true, sourceEventId: 'PRIVATE_EVENT_ID' } },
    ],
    feedback: [{ id: 'outcome_1', source: 'manual', attribution: 'direct', attributionConfidence: 1, reward: -0.8, policyUpdated: true, policyBefore: { trials: 0 }, policyAfter: { trials: 1 }, sourceEventId: 'PRIVATE_EVENT_ID' }],
    research: { unknowns: [{ id: 'unknown_1', status: 'open' }], tasks: [{ id: 'task_1', status: 'done' }], evidence: [{ id: 'evidence_1', taskId: 'task_1' }], claims: [{ id: 'claim_1', taskId: 'task_1', status: 'active' }], taskCount: 1, evidenceCount: 1, claimCount: 1 },
  }
  const tree = panel.LoopDetail({ data, goTo: value => navigation.push(value) }), text = JSON.stringify(tree)
  for (const word of ['已中断', 'detected', 'delivering', '部分发送', 'attemptedParts：3', 'sent parts：1', 'failedPart：2', 'SEND_FAILED', 'manual', 'direct', 'negative', 'policy committed：已提交', 'unknown_1', 'task_1', 'evidence_1', 'claim_1']) assert.ok(text.includes(word), word)
  assert.doesNotMatch(text, /PRIVATE_CONTENT|PRIVATE_EVENT_ID|sourceEventId/)
  control(tree, '查看学习任务').props.onClick()
  assert.deepEqual(navigation.at(-1), { tab: 'cognition', section: 'learning', taskId: 'task_1', anchor: 'tasks' })
  control(tree, '查看决策').props.onClick()
  assert.deepEqual(navigation.at(-1), { tab: 'cognition', section: 'policy', decisionId: 'decision_1' })
  assert.match(JSON.stringify(panel.LoopDetail({ data: { item: { id: 'loop_2', kind: 'social', stages: [] } } })), /未观察/)
  assert.match(JSON.stringify(panel.LoopDetail({ data: { item: { id: 'loop_3', kind: 'research', stages: [] } } })), /不适用/)
  assert.match(JSON.stringify(panel.LoopDetail({})), /不可用/)
})

test('C07 loop summary/detail loader: local current-persona paths, pagination, failed reads and safe projection', async () => {
  const originalFetch = globalThis.fetch, calls = []
  const props = { navigation: { decisionId: 'decision_1' } }
  const render = mountNode({ type: panel.CogLoop, props })
  let personaId = 'self', fail = false, mixed = false
  const summary = () => ({ ok: true, personaId, retained: { loops: 2, receipts: 1, attemptedParts: null, sentParts: 1, sentPartsComplete: false, loopStates: { interrupted: 1 }, feedback: { count: 1, policyCommitted: 1 } }, businessRecords: { evidenceCount: 2 }, raw: 'DO_NOT_RENDER' })
  globalThis.fetch = async path => {
    calls.push(path)
    let result = fail ? { ok: false, code: 'LOOP_READ_UNAVAILABLE' } : path.includes('/summary') ? summary() : path.includes('/runs?') ? { ok: true, items: [{ id: 'loop_1', personaId, kind: 'social', status: 'interrupted', stage: 'delivering' }], nextBefore: 'signed.cursor' } : { ok: true, item: { id: 'loop_1', personaId: mixed ? 'other' : personaId, kind: 'social', stages: [] } }
    return { ok: true, json: async () => result }
  }
  try {
    await moduleControl(render(), '刷新闭环').props.onClick()
    const tree = render(), text = JSON.stringify(tree)
    assert.match(text, /attemptedParts/); assert.match(text, /未观察/); assert.match(text, /policyCommitted/)
    assert.doesNotMatch(text, /DO_NOT_RENDER/)
    assert.ok(treeNodes(tree).some(node => node.type === panel.LoopDetail))
    assert.ok(calls.some(path => path.endsWith('/system/loop/detail?decisionId=decision_1')))
    assert.equal(calls.some(path => path.includes('personaId=')), false)
    control(tree, '下一页').props.onClick()
    await moduleControl(render(), '刷新闭环').props.onClick()
    assert.ok(calls.some(path => path.includes('before=signed.cursor')))
    mixed = true
    await moduleControl(render(), '刷新闭环').props.onClick()
    assert.match(JSON.stringify(render()), /当前人格已变化/)
    assert.equal(treeNodes(render()).some(node => node.type === panel.LoopDetail), false)
    fail = true
    await moduleControl(render(), '刷新闭环').props.onClick()
    assert.match(JSON.stringify(render()), /闭环不可用/)
  } finally { globalThis.fetch = originalFetch }
})

test('C07 decision feedback supplies C06 requestId; task navigation promotes a loaded target beyond first 20', async () => {
  const originalFetch = globalThis.fetch, calls = []
  globalThis.fetch = async (path, init) => { if (init.body) calls.push(JSON.parse(init.body)); return { ok: true, json: async () => ({ ok: true }) } }
  try {
    stateOverrides = [{ items: [{ id: 'decision_1', action: 'reply', status: 'sent' }] }, '', false]
    let tree
    try { tree = panel.CogPolicy({ toast() {} }) } finally { stateOverrides = null }
    assert.ok(treeNodes(tree).some(node => node.props?.id === 'ob-cog-decision-decision_1'))
    await control(tree, '标记正向').props.onClick()
    await control(tree, '标记负向').props.onClick()
    assert.equal(calls.length, 2)
    for (const body of calls) { assert.equal(body.decisionId, 'decision_1'); assert.match(body.requestId, /^[A-Za-z0-9_-]{1,128}$/) }
    assert.notEqual(calls[0].requestId, calls[1].requestId)
    const tasks = Array.from({ length: 25 }, (_, index) => ({ id: 'task_' + index, status: 'pending' }))
    stateOverrides = [{ items: [] }, '', false, { items: tasks }, '', false, { items: [] }, '', false]
    try { tree = panel.CogLearning({ navigation: { taskId: 'task_24' }, toast() {} }) } finally { stateOverrides = null }
    assert.equal(treeNodes(tree).filter(node => node.props?.id?.startsWith('ob-cog-task-')).length, 20)
    assert.equal(treeNodes(tree).find(node => node.props?.['aria-current'] === 'true').props.id, 'ob-cog-task-task_24')
  } finally { globalThis.fetch = originalFetch }
})

test('C07 ordinary module detail survives directory/action refresh and reloads health without duplicating config', async () => {
  const item = { id: 'builtin-sample', builtin: true, source: 'builtin', hasConfig: true, enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
  const props = { navigation: { tab: 'modules' } }, session = { values: [[item], false, '', '', null, '', moduleCatalog(moduleUi(item)), '', ''], index: 0 }
  const originalEffect = reactShim.useEffect, originalFetch = globalThis.fetch, effects = []
  reactShim.useEffect = (effect, deps) => effects.push({ effect, deps })
  const instance = registration.factory(requireShim)
  const render = () => { effects.length = 0; session.index = 0; hookSession = session; try { return instance.ModulesPage(props) } finally { hookSession = null } }
  const applyNavigation = () => effects.find(row => row.deps?.length === 5 && row.deps[0] === props.navigation).effect()
  globalThis.fetch = async path => ({ ok: true, json: async () => path.endsWith('/modules') ? { ok: true, items: [item] } : path.endsWith('/modules/ui') ? moduleCatalog(moduleUi(item)) : { ok: true, schema: { version: 1, fields: [{ path: 'message', type: 'text', label: 'message' }] }, values: { message: 'saved' }, revision: 1 } })
  try {
    let tree = render(); applyNavigation()
    await moduleControl(tree, '详情').props.onClick()
    tree = render()
    treeNodes(tree).find(node => node.type?.name === 'FieldRow').props.onChange('draft')
    const previousKey = treeNodes(tree).find(node => node.type === instance.CoreModuleHealth).props.key
    await moduleControl(tree, '刷新详情').props.onClick()
    tree = render(); applyNavigation(); tree = render()
    assert.ok(treeNodes(tree).some(node => node.props?.['aria-label'] === '模块详情'))
    assert.notEqual(treeNodes(tree).find(node => node.type === instance.CoreModuleHealth).props.key, previousKey)
    assert.equal(treeNodes(tree).filter(node => node.type?.name === 'FieldRow').length, 1)
    assert.equal(session.values[4].values.message, 'draft')
  } finally { reactShim.useEffect = originalEffect; globalThis.fetch = originalFetch }
})

test('C07 task-specific controls never report nested disabled/null/failed task results as success', async () => {
  const task = { id: 'task_1', status: 'pending' }, toasts = [], original = globalThis.fetch
  const render = () => {
    stateOverrides = [{ items: [] }, '', false, { items: [task] }, '', false, { items: [] }, '', false]
    try { return panel.CogLearning({ toast: (...args) => toasts.push(args) }) } finally { stateOverrides = null }
  }
  let response
  globalThis.fetch = async () => ({ ok: true, json: async () => response })
  try {
    for (const value of [null, { ok: false, reason: 'MODULE_DISABLED' }, { id: task.id, status: 'failed' }]) {
      response = { ok: true, task: value }
      await control(render(), '重试').props.onClick()
      await control(render(), '取消').props.onClick()
    }
    assert.equal(toasts.length, 6); assert.equal(toasts.some(([, tone]) => tone === 'ok'), false)
    for (const [label, status] of [['重试', 'pending'], ['取消', 'cancelled']]) {
      response = { ok: true, task: { id: task.id, status } }
      await control(render(), label).props.onClick()
      assert.equal(toasts.at(-1)[1], 'ok')
    }
  } finally { globalThis.fetch = original }
})

test('operation restart interruption is terminal: polling stops without retry or success', async () => {
  const original = globalThis.fetch
  let reads = 0, waits = 0
  globalThis.fetch = async (_path, init) => {
    assert.equal(init.method, 'GET')
    reads++
    return { ok: true, json: async () => ({ ok: true, operation: { id: 'interrupted-op', status: 'interrupted', phase: 'done', code: 'PROCESS_RESTART', result: { ok: false, code: 'PROCESS_RESTART' } } }) }
  }
  try {
    const operation = await panel.pollModuleOperation({ id: 'interrupted-op', status: 'running' }, { wait: async () => { waits++; if (waits > 1) throw Error('polled a terminal operation') } })
    assert.equal(operation.status, 'interrupted')
    assert.equal(panel.operationSucceeded(operation), false)
    assert.equal(reads, 1)
    assert.equal(waits, 1)
  } finally { globalThis.fetch = original }
})

test('C03 embedded browser contract matches all C01 aliases and fields', () => {
  assert.deepEqual(panel.NAVIGATION_REGISTRY, NAVIGATION_REGISTRY)
  for (const [alias] of Object.entries(LEGACY_ALIASES)) assert.deepEqual(panel.resolveLegacyGo(alias), contractGo(alias), alias)
  for (const field of SETTINGS_FIELDS) for (const alias of field.aliases) assert.deepEqual(panel.resolveLegacyGo(alias), contractGo(alias), alias)
  for (const group of CONFIG_GROUPS) assert.deepEqual(panel.resolveLegacyGo('config', group.id), contractGo('config', group.id))
  assert.deepEqual(panel.navigationTarget({ tab: 'cognition', section: 'learning', taskId: 'Task:ABC-1', anchor: 'tasks' }), contractGoTo({ tab: 'cognition', section: 'learning', taskId: 'Task:ABC-1', anchor: 'tasks' }))
})

test('C03 owner destinations partition every editable config field; module editors remain in details', () => {
  const paths = []
  for (const area of NAVIGATION_REGISTRY) for (const section of area.sections) {
    if (area.id === 'extensions') continue
    paths.push(...panel.ownerFields({ area: area.id, section: section.id }).map(field => field.path))
  }
  for (const moduleId of new Set(SETTINGS_FIELDS.filter(field => field.ownerClass === 'module').map(field => field.canonical.moduleId))) {
    const fields = panel.ownerFields({ area: 'extensions', section: 'module', moduleId })
    assert.ok(fields.every(field => field.canonical.moduleId === moduleId))
    paths.push(...fields.map(field => field.path))
  }
  assert.equal(paths.length, new Set(paths).size)
  assert.deepEqual(paths.sort(), SETTINGS_FIELDS.filter(field => field.storage === 'config.json' && field.apply !== 'read-only').map(field => field.path).sort())
  const props = { toast() {}, navigation: { area: 'system', section: 'general' } }
  const tree = panel.AreaContent(props)
  assert.equal(treeNodes(tree).filter(node => node.type === panel.OwnerSettings).length, 1)
  assert.equal(treeNodes(tree).some(node => node.type === panel.ConfigTab || node.type === panel.CogSettings), false)
  const moduleTree = panel.AreaContent({ ...props, navigation: { area: 'extensions', section: 'module', moduleId: 'builtin-learning' } })
  assert.equal(treeNodes(moduleTree).filter(node => node.type === panel.OwnerSettings).length, 0)
  assert.ok(treeNodes(moduleTree).some(node => node.type === panel.ModulesPage))
  const connection = panel.Connect({ ...props, operationsOnly: true, configInfo: { groups: CONFIG_GROUPS }, draft: DEFAULTS })
  assert.equal(treeNodes(connection).filter(node => node.type?.name === 'FieldRow').length, 0)
  const model = panel.ModelTab({ ...props, ownerIntegration: true })
  assert.equal(treeNodes(model).some(node => node.props?.['aria-label'] === '模型路由模式'), false)
})

// Navigation DOM shim: layout effects run after refs attach, with dependency cleanup.
// It exercises handlers/lifecycles; native top-layer rendering still needs a browser.
function navigationHarness({ mobile = false, stored, storageThrows = false, props: overrides = {} } = {}) {
  const saved = { document: globalThis.document, effect: reactShim.useLayoutEffect }
  const windowKeys = ['localStorage', 'matchMedia', 'innerWidth', 'innerHeight', 'scrollX', 'scrollY', 'scrollTo', 'getComputedStyle']
  const windowSaved = Object.fromEntries(windowKeys.map(key => [key, Object.getOwnPropertyDescriptor(window, key)]))
  const values = new Map(stored === undefined ? [] : [['dsh-bot:navigation:desktop:v1', stored]])
  const writes = [], listeners = new Set(), focusLog = [], scrollLog = [], targets = []
  const media = { matches: mobile, addEventListener: (name, fn) => { assert.equal(name, 'change'); listeners.add(fn) }, removeEventListener: (name, fn) => listeners.delete(fn) }
  const style = (initial = '') => {
    let data = {}
    const camel = key => key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
    const proxy = new Proxy({}, {
      get: (_, key) => key === 'cssText' ? Object.entries(data).map(([name, value]) => name.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()) + ': ' + value + ';').join(' ') : data[key] || '',
      set: (_, key, value) => {
        if (key === 'cssText') data = Object.fromEntries(value.split(';').filter(row => row.includes(':')).map(row => { const at = row.indexOf(':'); return [camel(row.slice(0, at).trim()), row.slice(at + 1).trim()] }))
        else if (value === '') delete data[key]
        else data[key] = value
        return true
      },
    })
    proxy.cssText = initial
    return proxy
  }
  let documentMock
  const matches = (node, selector) => {
    if (selector === ':disabled') return Boolean(node.disabled || node.disabledFieldset)
    if (selector === '[hidden],[inert],[aria-hidden="true"]') return node.props.hidden || node.props.inert || node.props['aria-hidden'] === 'true'
    if (selector === '[data-desktop-toggle]') return node.props['data-desktop-toggle']
    if (selector.startsWith('#')) return node.props.id === selector.slice(1)
    if (selector.startsWith('.')) return (node.props.className || '').split(' ').includes(selector.slice(1))
    return selector.split(',').some(tag => tag === node.type || (tag === 'a[href]' && node.type === 'a' && node.props.href) || (tag === '[tabindex]' && node.props.tabIndex !== undefined))
  }
  const descendants = node => node.children.flatMap(child => [child, ...descendants(child)])
  const element = (type, props = {}) => ({
    type, props, children: [], parent: null, isConnected: true, open: false, showCount: 0, closeCount: 0,
    style: style(), scrollTop: 0, scrollLeft: 0, clientWidth: 300, offsetWidth: 315,
    get tabIndex() { return this.props.tabIndex ?? (['button', 'input', 'select', 'textarea', 'a'].includes(this.type) ? 0 : -1) },
    get disabled() { return this.props.disabled },
    matches(selector) { return matches(this, selector) },
    closest(selector) { for (let node = this; node; node = node.parent) if (matches(node, selector)) return node; return null },
    querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)) },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null },
    getClientRects() {
      for (let node = this; node; node = node.parent) {
        if (!node.isConnected || node.props.hidden || (node.type === 'dialog' && !node.open)) return []
        if (!media.matches && /ob-mobile-(topbar|sections)/.test(node.props.className || '')) return []
      }
      return [{}]
    },
    getBoundingClientRect() { return { top: 60, bottom: 800, left: 0, right: 300 } },
    focus() { if (this.isConnected) { documentMock.activeElement = this; focusLog.push(this) } },
    showModal() { assert.equal(this.open, false); this.open = true; this.showCount++ },
    close() { this.open = false; this.closeCount++; this.props.onClose?.({ currentTarget: this }) },
  })
  const html = element('html'), body = element('body'), root = element('div', { className: 'ob-root' })
  html.style = style('overflow: auto; scroll-behavior: smooth;'); html.clientWidth = 780
  body.style = style('position: relative; padding-right: 7px;')
  root.style = style('overflow: auto; padding-right: 9px;'); root.scrollTop = 317; root.scrollLeft = 3
  body.parent = html; html.children = [body]; root.parent = body; body.children = [root]
  const destination = element('div', { id: 'ob-navigation-destination', tabIndex: -1 })
  destination.parent = root
  documentMock = { documentElement: html, body, activeElement: null, querySelector: selector => html.querySelector(selector) }
  globalThis.document = documentMock
  window.localStorage = { getItem: key => { if (storageThrows) throw Error('storage blocked'); return values.get(key) ?? null }, setItem: (key, value) => { if (storageThrows) throw Error('storage blocked'); writes.push([key, value]); values.set(key, value) } }
  window.matchMedia = query => { assert.equal(query, '(max-width:900px)'); return media }
  window.innerWidth = 800; window.innerHeight = 900; window.scrollX = 4; window.scrollY = 611
  window.scrollTo = value => { scrollLog.push(value); window.scrollX = value.left; window.scrollY = value.top }
  window.getComputedStyle = node => ({ paddingRight: node.style.paddingRight, borderLeftWidth: '0px', borderRightWidth: '0px', visibility: node.style.visibility || 'visible' })
  const session = { values: [], index: 0 }, scheduled = [], effects = new Set()
  reactShim.useLayoutEffect = (run, deps) => {
    const state = shimState(() => ({ deps: undefined, cleanup: null, mounted: false }))[0]
    if (!state.mounted || !deps || deps.some((dep, index) => !Object.is(dep, state.deps?.[index]))) scheduled.push(() => {
      state.cleanup?.(); state.cleanup = run(); state.deps = deps; state.mounted = true; effects.add(state)
    })
  }
  const instance = registration.factory(requireShim)
  const props = { navigation: { area: 'profiles', section: 'turn' }, goTo: target => targets.push(target), configInfo: { groups: CONFIG_GROUPS }, ...overrides }
  let tree, nodes = new Map()
  const attach = (node, parent, path, next) => {
    if (Array.isArray(node)) { node.forEach((child, i) => attach(child, parent, path + '.' + i, next)); return }
    if (!node || typeof node !== 'object') return
    if (typeof node.type !== 'string') { attach(node.children, parent, path + '.component', next); return }
    const key = path + ':' + node.type
    const dom = nodes.get(key) || element(node.type)
    dom.props = node.props || {}; dom.parent = parent; dom.children = []; dom.isConnected = true
    parent.children.push(dom); next.set(key, dom)
    if (dom.props.ref) dom.props.ref.current = dom
    attach(node.children, dom, path, next)
  }
  const render = () => {
    session.index = 0; hookSession = session
    try { tree = instance.NavigationMenu(props) } finally { hookSession = null }
    const next = new Map(); root.children = []
    attach(tree, root, 'nav', next); root.children.push(destination)
    for (const [key, dom] of nodes) if (!next.has(key)) { dom.isConnected = false; if (dom.props.ref?.current === dom) dom.props.ref.current = null }
    nodes = next
    for (const run of scheduled.splice(0)) run()
    return tree
  }
  const get = selector => root.querySelector(selector)
  const byLabel = label => descendants(root).filter(node => node.props['aria-label'] === label).sort((a, b) => Number(a.type === 'section') - Number(b.type === 'section'))[0]
  const click = label => { const node = byLabel(label); assert.ok(node, label); node.props.onClick({ currentTarget: node }); return render() }
  const unmount = () => {
    for (const dom of nodes.values()) dom.isConnected = false
    for (const state of effects) { state.cleanup?.(); state.cleanup = null }
    effects.clear()
  }
  return { render, props, get, byLabel, click, root, html, body, destination, media, values, writes, targets, focusLog, scrollLog, listeners,
    get tree() { return tree }, get active() { return documentMock.activeElement },
    resize(value) { media.matches = value; for (const fn of listeners) fn({ matches: value }); return render() },
    unmount,
    restore() { unmount(); reactShim.useLayoutEffect = saved.effect; globalThis.document = saved.document; for (const key of windowKeys) { if (windowSaved[key]) Object.defineProperty(window, key, windowSaved[key]); else delete window[key] } },
  }
}

test('C05 six explicit area controls, current section, search alias selection and offline sandbox', () => {
  const h = navigationHarness()
  try {
    const tree = h.render()
    assert.equal(field(tree, '六区导航').type, 'nav')
    assert.deepEqual(treeNodes(tree).filter(node => node.props?.['data-area']).map(node => node.props['data-area']), NAVIGATION_REGISTRY.map(area => area.id))
    assert.equal(h.get('.ob-nav-dialog'), null)
    assert.equal(h.byLabel('Profiles').props['aria-current'], 'true')
    assert.equal(treeNodes(tree).find(node => node.props?.['data-section'] === 'profiles:turn').props['aria-current'], 'page')
    const search = h.byLabel('搜索页面、旧名称或设置路径')
    search.props.onChange({ target: { value: 'cognition.reply.split' } }); h.render()
    control(h.tree, '长回复分条').props.onClick(); h.render()
    assert.deepEqual(h.targets.at(-1), contractGo('cognition.reply.split'))
    assert.equal(h.byLabel('搜索页面、旧名称或设置路径').props.value, '')
    assert.equal(panel.AreaContent({ navigation: { area: 'chat', section: 'sandbox' } }).type, panel.SandboxChat)
    assert.equal(panel.TABS.length, 6)
  } finally { h.restore() }
})

test('desktop navigation lazy preference, invalid/blocked storage, 72px rail controls and tab exclusion', () => {
  for (const [stored, storageThrows, expected] of [[undefined, false, 'expanded'], ['expanded', false, 'expanded'], ['collapsed', false, 'collapsed'], ['invalid', false, 'expanded'], ['collapsed', true, 'expanded']]) {
    const h = navigationHarness({ stored, storageThrows })
    try {
      let tree = h.render()
      assert.equal(h.get('.ob-navigation-host').props['data-desktop'], expected, 'first render uses stored preference')
      if (expected === 'expanded') h.click('折叠导航')
      tree = h.render()
      assert.equal(h.byLabel('展开导航').props['aria-expanded'], false)
      assert.equal(h.byLabel('展开导航').props['aria-controls'], 'ob-nav-sections')
      assert.equal(treeNodes(tree).filter(node => node.props?.['data-area']).length, 6)
      assert.equal(h.byLabel('搜索页面、旧名称或设置路径'), undefined)
      const sections = treeNodes(tree).filter(node => node.props?.className === 'ob-nav-sections')
      assert.equal(sections.length, 6)
      assert.ok(sections.every(section => section.props.hidden && treeNodes(section).filter(node => node.type === 'button').every(node => node.props.tabIndex === -1)))
      assert.equal(h.byLabel('Profiles').props['aria-current'], 'true')
      assert.equal(h.targets.length, 0, 'collapse changes neither route nor page state')
      if (!storageThrows) assert.equal(h.values.get('dsh-bot:navigation:desktop:v1'), 'collapsed')
      h.click('展开导航')
      assert.equal(h.byLabel('折叠导航').props['aria-expanded'], true)
      assert.ok(treeNodes(h.tree).filter(node => node.props?.['data-section']).every(node => node.props.tabIndex === undefined))
      if (!storageThrows) assert.equal(h.values.get('dsh-bot:navigation:desktop:v1'), 'expanded')
    } finally { h.restore() }
  }
})

test('collapsed keyboard/hover tooltips and search expand before focus; preference survives remount', () => {
  let persisted
  const h = navigationHarness({ stored: 'collapsed' })
  try {
    h.render()
    for (const label of [...NAVIGATION_REGISTRY.map(area => area.label), '展开导航', '搜索导航']) {
      const button = h.byLabel(label)
      assert.equal(button.type, 'button')
      button.props.onFocus({ currentTarget: button }); h.render()
      assert.equal(h.get('#ob-nav-tooltip').props.role, 'tooltip')
      assert.equal(h.byLabel(label).props['aria-describedby'], 'ob-nav-tooltip')
      assert.equal(treeNodes(h.tree).find(node => node.props?.role === 'tooltip').children[0], label)
      h.byLabel(label).props.onBlur(); h.render()
      assert.equal(h.get('#ob-nav-tooltip'), null)
      h.byLabel(label).props.onMouseEnter({ currentTarget: button }); h.render()
      assert.ok(h.get('#ob-nav-tooltip'))
      h.byLabel(label).props.onMouseLeave({ currentTarget: button }); h.render()
      assert.equal(h.get('#ob-nav-tooltip'), null)
    }
    h.byLabel('搜索导航').props.onFocus({ currentTarget: h.byLabel('搜索导航') }); h.render()
    h.get('.ob-navigation-host').props.onKeyDown({ key: 'Escape' }); h.render()
    assert.equal(h.get('#ob-nav-tooltip'), null)
    h.click('搜索导航')
    assert.equal(h.get('.ob-navigation-host').props['data-desktop'], 'expanded')
    assert.equal(h.active, h.byLabel('搜索页面、旧名称或设置路径'))
    assert.equal(h.targets.length, 0)
    h.click('折叠导航'); persisted = h.values.get('dsh-bot:navigation:desktop:v1')
  } finally { h.restore() }
  const reloaded = navigationHarness({ stored: persisted })
  try { reloaded.render(); assert.ok(reloaded.byLabel('展开导航')) } finally { reloaded.restore() }
})

test('desktop storage getter failure still defaults expanded and toggles without navigating', () => {
  const h = navigationHarness()
  try {
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw Error('getter blocked') } })
    h.render(); assert.ok(h.byLabel('折叠导航'))
    assert.doesNotThrow(() => h.click('折叠导航'))
    assert.ok(h.byLabel('展开导航')); assert.deepEqual(h.targets, [])
  } finally { h.restore() }
})

test('desktop collapse and breakpoint preserve mounted destination identity, root draft and URL', () => {
  const originalLocation = window.location
  window.location = { href: 'https://example.test/console?keep=1#onebot-qq' }
  const session = { values: [], index: 0 }
  const renderPage = () => {
    session.index = 0; hookSession = session
    try { return panel.OneBotPage() } finally { hookSession = null }
  }
  const page = tree => treeNodes(tree).find(node => node.type === panel.AreaContent)
  let h
  try {
    renderPage()
    session.values[0] = 'profiles'; session.values[2] = { config: DEFAULTS, groups: CONFIG_GROUPS }
    session.values[3] = { ...DEFAULTS, ui: { ...DEFAULTS.ui, accent: 'green' } }
    session.values[4] = false; session.values[6] = 'temporary gateway error'
    session.values[13] = { area: 'profiles', section: 'reply' }
    const before = renderPage(), body = page(before)
    const nav = treeNodes(before).find(node => node.type === panel.NavigationMenu)
    const destination = treeNodes(before).find(node => node.props?.id === 'ob-navigation-destination')
    h = navigationHarness({ props: nav.props }); h.render()
    h.click('折叠导航'); h.click('展开导航'); h.resize(true); h.click('导航与搜索'); h.resize(false)
    const after = renderPage(), nextBody = page(after)
    assert.equal(nextBody.type, body.type); assert.equal(nextBody.props.draft, body.props.draft)
    assert.equal(nextBody.props.navigation, body.props.navigation)
    assert.equal(nextBody.props.dirty, true)
    assert.equal(treeNodes(after).find(node => node.props?.id === 'ob-navigation-destination').type, destination.type)
    assert.equal(window.location.href, 'https://example.test/console?keep=1#onebot-qq')
    assert.ok(treeNodes(after).some(node => node.props?.message === 'temporary gateway error'))
    assert.ok(treeNodes(after).some(node => node.type === panel.NavigationMenu), 'navigation stays outside the error/loading branch')
  } finally { h?.restore(); window.location = originalLocation }
})

test('mobile modal locks root/document, compensates scrollbars, focuses search and restores exact styles/scroll', () => {
  const h = navigationHarness({ mobile: true, stored: 'collapsed' })
  try {
    h.render()
    const before = [h.html, h.body, h.root].map(node => node.style.cssText)
    assert.equal(h.get('#ob-navigation-dialog').open, false)
    assert.equal(h.byLabel('导航与搜索').props['aria-haspopup'], 'dialog')
    h.click('导航与搜索')
    const dialog = h.get('#ob-navigation-dialog')
    assert.equal(dialog.type, 'dialog'); assert.equal(dialog.open, true); assert.equal(dialog.showCount, 1)
    assert.equal(h.root.querySelectorAll('nav').length, 1)
    assert.equal(h.byLabel('导航与搜索').props['aria-expanded'], true)
    assert.equal(h.active, h.byLabel('搜索页面、旧名称或设置路径'))
    assert.ok([h.html, h.body, h.root].every(node => node.style.overflow === 'hidden'))
    assert.equal(h.body.style.position, 'fixed'); assert.equal(h.body.style.top, '-611px'); assert.equal(h.body.style.left, '-4px')
    assert.equal(h.body.style.boxSizing, 'border-box', 'scrollbar padding stays inside the fixed body width')
    assert.equal(h.body.style.paddingRight, '27px'); assert.equal(h.root.style.paddingRight, '24px')
    assert.equal(h.byLabel('展开导航'), undefined, 'mobile ignores the desktop rail preference')
    assert.ok(treeNodes(h.tree).filter(node => node.props?.['data-section']).every(node => node.props.tabIndex === undefined))
    h.root.scrollTop = 0; h.root.scrollLeft = 0; window.scrollY = 0
    h.click('关闭导航')
    assert.deepEqual([h.html, h.body, h.root].map(node => node.style.cssText), before)
    assert.equal(h.root.scrollTop, 317); assert.equal(h.root.scrollLeft, 3)
    assert.deepEqual(h.scrollLog.at(-1), { left: 4, top: 611, behavior: 'instant' })
    assert.equal(h.active, h.byLabel('导航与搜索'))
    assert.equal(h.values.get('dsh-bot:navigation:desktop:v1'), 'collapsed')
  } finally { h.restore() }
})

test('mobile Tab trap filters hidden, inert, disabled and negative tabindex controls, including empty dialog', () => {
  const h = navigationHarness({ mobile: true })
  try {
    h.render(); h.click('导航与搜索')
    const dialog = h.get('#ob-navigation-dialog'), first = h.byLabel('六区导航').querySelector('button')
    const controls = dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')
    const last = controls.at(-1)
    const tab = (target, shiftKey = false) => {
      let prevented = false
      dialog.props.onKeyDown({ key: 'Tab', target, currentTarget: dialog, shiftKey, preventDefault: () => { prevented = true } })
      return prevented
    }
    assert.equal(tab(last), true); assert.equal(h.active, first)
    assert.equal(tab(first, true), true); assert.equal(h.active, last)
    assert.equal(tab(controls[1]), false)
    assert.equal(tab(dialog), true); assert.equal(h.active, first)
    const enabled = controls.slice(0, -6).at(-1)
    controls.at(-1).props.disabled = true
    controls.at(-2).props.hidden = true
    controls.at(-3).props.tabIndex = -1
    controls.at(-4).props.inert = true
    controls.at(-5).disabledFieldset = true
    controls.at(-6).style.visibility = 'hidden'
    assert.equal(tab(first, true), true); assert.equal(h.active, enabled)
    for (const node of controls) node.props.disabled = true
    assert.equal(tab(first), true); assert.equal(h.active, dialog)
    let prevented = false
    dialog.props.onKeyDown({ key: 'ArrowDown', currentTarget: dialog, preventDefault: () => { prevented = true } })
    assert.equal(prevented, false)
  } finally { h.restore() }
})

test('mobile Escape/native close/backdrop/selection/breakpoint/unmount all clean up modal and scroll lock', () => {
  for (const path of ['escape', 'native', 'backdrop', 'selection', 'breakpoint', 'unmount']) {
    const h = navigationHarness({ mobile: true, stored: 'collapsed' })
    try {
      h.render(); const styles = [h.html, h.body, h.root].map(node => node.style.cssText)
      h.click('导航与搜索')
      const dialog = h.get('#ob-navigation-dialog')
      if (path === 'escape') {
        let prevented = false
        dialog.props.onCancel({ preventDefault: () => { prevented = true } }); assert.equal(prevented, true); h.render()
      } else if (path === 'native') { dialog.close(); h.render() }
      else if (path === 'backdrop') {
        // Interior dialog padding and bubbling child clicks must not dismiss it.
        dialog.props.onClick({ currentTarget: dialog, target: dialog, clientX: 100, clientY: 100 }); h.render(); assert.equal(dialog.open, true)
        dialog.props.onClick({ currentTarget: dialog, target: h.byLabel('六区导航'), clientX: 700, clientY: 100 }); h.render(); assert.equal(dialog.open, true)
        dialog.props.onClick({ currentTarget: dialog, target: dialog, clientX: 700, clientY: 100 }); h.render()
      } else if (path === 'selection') {
        const button = treeNodes(h.tree).find(node => node.props?.['data-section'] === 'system:appearance')
        button.props.onClick(); h.props.navigation = { area: 'system', section: 'appearance' }; h.render()
        assert.deepEqual(h.targets, [{ area: 'system', section: 'appearance' }])
        assert.equal(h.active, h.destination)
      } else if (path === 'breakpoint') {
        h.resize(false)
        assert.equal(h.get('#ob-navigation-dialog'), null)
        assert.equal(h.get('.ob-navigation-host').props['data-desktop'], 'collapsed')
        assert.equal(h.active, h.byLabel('展开导航'))
        h.resize(true)
        assert.equal(h.get('#ob-navigation-dialog').open, false)
        assert.equal(h.byLabel('导航与搜索').props['aria-expanded'], false)
      } else h.unmount()
      assert.equal(dialog.open, false, path)
      assert.deepEqual([h.html, h.body, h.root].map(node => node.style.cssText), styles, path)
      assert.equal(h.root.scrollTop, 317, path)
      assert.equal(h.values.get('dsh-bot:navigation:desktop:v1'), 'collapsed', path)
      if (['escape', 'native', 'backdrop'].includes(path)) {
        assert.equal(h.active, h.byLabel('导航与搜索'), path)
        // Reopening after native close must create a modal again, without accumulating locks.
        h.click('导航与搜索'); assert.equal(h.get('#ob-navigation-dialog').open, true)
        h.click('关闭导航'); assert.deepEqual([h.html, h.body, h.root].map(node => node.style.cssText), styles)
      }
      h.unmount(); assert.equal(h.listeners.size, 0)
    } finally { h.restore() }
  }
})

test('mobile search aliases/deep links and labelled section selector share canonical routes and module list/current state', () => {
  const h = navigationHarness({ mobile: true })
  try {
    for (const area of NAVIGATION_REGISTRY) {
      h.props.navigation = { area: area.id, section: area.sections[0].id }; h.render()
      const selector = h.get('#ob-mobile-section')
      assert.equal(selector.type, 'select'); assert.equal(selector.props['aria-label'], '当前区域分区')
      assert.equal(treeNodes(h.tree).find(node => node.type === 'label' && node.props?.htmlFor === 'ob-mobile-section').children[0], '分区')
      assert.deepEqual(selector.children.map(node => node.props.value), area.sections.filter(section => section.id !== 'module' && !(area.id === 'profiles' && section.id === 'settings')).map(section => section.id))
      for (const option of selector.children) {
        selector.props.onChange({ target: { value: option.props.value } }); h.render()
        assert.deepEqual(h.targets.at(-1), contractGoTo({ area: area.id, section: option.props.value }))
        assert.equal(h.active, h.destination)
      }
    }
    h.props.navigation = contractGoTo({ tab: 'modules', moduleId: 'builtin-learning', anchor: 'config' }); h.render()
    const selector = h.get('#ob-mobile-section')
    assert.equal(selector.props.value, 'module')
    assert.deepEqual(selector.children.map(node => node.props.value), ['modules', 'module'])
    assert.equal(treeNodes(h.tree).find(node => node.props?.['data-section'] === 'extensions:modules').props['aria-current'], 'page')
    assert.equal(treeNodes(h.tree).find(node => node.type === 'option' && node.props?.value === 'module').children[0], '当前模块 · builtin-learning')
    const count = h.targets.length
    selector.props.onChange({ target: { value: 'module' } }); h.render(); assert.equal(h.targets.length, count)
    selector.props.onChange({ target: { value: 'modules' } }); h.render()
    assert.deepEqual(h.targets.at(-1), { area: 'extensions', section: 'modules' })
    h.props.navigation = { area: 'profiles', section: 'settings' }; h.render()
    assert.equal(h.get('#ob-mobile-section').props.value, 'settings')
    assert.ok(h.get('#ob-mobile-section').children.some(node => node.props.value === 'settings' && node.props.disabled), 'hidden canonical deep link still displays its current section')
    for (const alias of ['cognition.reply.split', 'cog-core', 'builtin-learning', 'settings']) {
      h.click('导航与搜索')
      h.byLabel('搜索页面、旧名称或设置路径').props.onChange({ target: { value: alias } }); h.render()
      const row = panel.searchNavigation(alias, { ...panel.SECTION_LABELS })[0]
      assert.ok(row, alias)
      const result = h.get('.ob-nav-results').querySelector('button')
      result.props.onClick(); h.render()
      assert.deepEqual(h.targets.at(-1), row.target)
      assert.equal(h.active, h.destination)
    }
  } finally { h.restore() }
})

test('navigation remains a content sibling in loading/error shell and uses source-level responsive CSS contracts', () => {
  const tree = panel.OneBotPage(), nodes = treeNodes(tree)
  const shell = nodes.find(node => node.props?.className === 'ob-shell ob-area-shell')
  assert.equal(shell.children[0].type, panel.NavigationMenu)
  assert.equal(shell.children[1].props.id, 'ob-navigation-destination')
  assert.equal(shell.children[1].props.tabIndex, -1)
  assert.equal(shell.children[1].type, 'div')
  const rules = [...panel.PANEL_CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const rule = selector => { const found = rules.find(row => row[1].trim() === selector); assert.ok(found, selector); return found[2] }
  assert.match(rule('.ob-area-shell'), /grid-template-columns:240px minmax\(0,1fr\)/)
  assert.match(rule(".ob-area-shell:has(> .ob-navigation-host[data-desktop='collapsed'])"), /grid-template-columns:72px minmax\(0,1fr\)/)
  assert.match(rule('.ob-navigation-host'), /position:sticky/)
  assert.match(rule('.ob-mobile-topbar'), /position:sticky;top:0;display:flex/)
  assert.match(rule('.ob-nav-dialog'), /width:min\(320px,85vw\)/)
  assert.match(rule('.ob-nav-dialog'), /height:100vh;height:100dvh/)
  assert.match(rule('.ob-nav-dialog .ob-navigation'), /overflow-y:auto/)
  assert.match(rule('.ob-nav-dialog .ob-navigation'), /safe-area-inset-bottom/)
  assert.match(rule('.ob-nav-tools'), /position:sticky;top:0/)
  assert.match(rule('.ob-nav-sections[hidden]'), /display:none/)
  assert.match(rule('.ob-nav-rail-control'), /width:44px;height:44px/)
  assert.match(rule('.ob-root input,.ob-root select,.ob-root textarea'), /font-size:16px/)
  assert.match(rule('.ob-root .ob-grid,.ob-root .ob-grid.two,.ob-root .ob-stat-grid,.ob-root .ob-models-grid,.ob-root .ob-split,.ob-root .ob-settings,.ob-root .ob-sandbox-grid'), /grid-template-columns:minmax\(0,1fr\)/)
  assert.match(rule('.ob-page,.ob-content,.ob-area-shell > *'), /min-width:0/)
  assert.match(rule('.ob-root pre'), /white-space:pre-wrap;overflow-wrap:anywhere/)
  assert.match(panel.MOTION_CSS, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.ob-root \.ob-navigation-host \*::after\{animation:none!important;transition:none!important\}/)
})


function ownerHarness(props) {
  const session = { values: [], index: 0 }, effects = [], original = reactShim.useEffect
  reactShim.useEffect = (effect, deps) => effects.push({ effect, deps })
  const instance = registration.factory(requireShim)
  const render = () => { session.index = 0; effects.length = 0; hookSession = session; try { return instance.OwnerSettings(props) } finally { hookSession = null } }
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return { render, effects, settle, async load() { render(); effects.find(row => row.deps?.length === 3 && typeof row.deps[0] === 'function').effect(); await settle(); return render() }, restore() { reactShim.useEffect = original } }
}

test('profile applied editor reads inactive IDs, sends only changed owner fields with revision and retains conflicts', async () => {
  const original = globalThis.fetch, calls = [], toasts = []
  const props = { navigation: { area: 'profiles', section: 'reply' }, configInfo: { groups: CONFIG_GROUPS }, toast: (...args) => toasts.push(args) }
  let conflict = false
  globalThis.fetch = async (path, init) => {
    const body = init.body && JSON.parse(init.body); calls.push({ path, body })
    return { ok: true, json: async () => path.endsWith('/profiles') ? { ok: true, activeId: 'active', items: [{ id: 'active' }, { id: 'inactive' }] }
      : body ? conflict ? { ok: false, code: 'SETTINGS_CONFLICT' } : { ok: true, revision: 8, values: { ...Object.fromEntries(panel.ownerFields(props.navigation).map(field => [field.path, true])), ...body.patch } }
      : { ok: true, id: path.endsWith('inactive') ? 'inactive' : 'active', revision: 7, values: Object.fromEntries(panel.ownerFields(props.navigation).map(field => [field.path, true])), runtimeMode: 'profile', profileEditsApply: 'applied' } }
  }
  const harness = ownerHarness(props)
  try {
    harness.render(); harness.effects.find(row => row.deps?.length === 1 && row.deps[0] === true).effect(); await harness.settle()
    let tree = await harness.load()
    field(tree, '设置人格').props.onChange({ target: { value: 'inactive' } }); tree = await harness.load()
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.ok(calls.at(-1).path.endsWith('/profiles/config?id=inactive'))
    assert.match(JSON.stringify(tree), /激活后应用/)
    assert.doesNotMatch(JSON.stringify(tree), /staged|Staged|旧编辑器/)
    const editors = treeNodes(tree).filter(node => node.type?.name === 'FieldRow')
    assert.deepEqual(editors.map(node => node.props.spec.path).sort(), panel.ownerFields(props.navigation).map(field => field.path).sort())
    editors.find(node => node.props.spec.path === 'cognition.notices.enabled').props.onChange(false)
    await moduleControl(harness.render(), '保存设置').props.onClick()
    assert.deepEqual(calls.find(row => row.body).body, { id: 'inactive', revision: 7, patch: { 'cognition.notices.enabled': false } })
    assert.ok(calls.find(row => row.body).path.endsWith('/profiles/config/save'))
    assert.match(toasts.at(-1)[0], /激活该人格后使用新设置/)
    tree = harness.render(); treeNodes(tree).find(node => node.type?.name === 'FieldRow').props.onChange(false)
    conflict = true
    await moduleControl(harness.render(), '保存设置').props.onClick()
    assert.match(JSON.stringify(harness.render()), /SETTINGS_CONFLICT/)
    assertExplicitSavebar(harness.render(), 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.equal(moduleControl(harness.render(), '保存设置').props.disabled, false)
    const changed = () => treeNodes(harness.render()).find(node => node.props?.spec?.path === 'cognition.notices.enabled')
    assert.equal(changed().props.value, false, 'conflict keeps the draft')
    assert.equal(calls.filter(row => row.body).at(-1).body.revision, 8, 'conflict uses the last saved profile revision')
    await control(harness.render(), '重新读取').props.onClick()
    assert.equal(changed().props.value, true, 'reread discards the draft')
    assert.equal(control(harness.render(), '保存设置').props.disabled, true)
    assert.doesNotMatch(JSON.stringify(harness.render()), /SETTINGS_CONFLICT/)
    assertExplicitSavebar(harness.render(), 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.equal(calls.some(row => /switch|activate|config\/save$/.test(row.path) && !row.path.includes('/profiles/')), false)
  } finally { harness.restore(); globalThis.fetch = original }
})

test('C03 system secrets use explicit keep/set/clear and never render mask objects as values', async () => {
  const original = globalThis.fetch, calls = []
  const props = { navigation: { area: 'system', section: 'connection' }, configInfo: { groups: CONFIG_GROUPS } }
  const values = Object.fromEntries(panel.ownerFields(props.navigation).map(field => [field.path, field.sensitivity.startsWith('secret') ? { masked: true, present: true } : 'value']))
  globalThis.fetch = async (path, init) => { const body = init.body && JSON.parse(init.body); calls.push({ path, body }); return { ok: true, json: async () => ({ ok: true, values, revision: 'cas' }) } }
  const harness = ownerHarness(props)
  try {
    let tree = await harness.load()
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.equal(field(tree, 'onebot.wsToken').props.value, '')
    field(tree, 'onebot.wsToken').props.onChange({ target: { value: 'new-secret' } })
    await moduleControl(harness.render(), '保存设置').props.onClick()
    assert.deepEqual(calls.at(-1).body, { scope: 'system', revision: 'cas', patch: { 'onebot.wsToken': { op: 'set', value: 'new-secret' } } })
    control(harness.render(), '清除 onebot.wsToken').props.onClick()
    await moduleControl(harness.render(), '保存设置').props.onClick()
    assert.deepEqual(calls.at(-1).body.patch, { 'onebot.wsToken': { op: 'clear' } })
    tree = harness.render(); field(tree, 'onebot.wsToken').props.onChange({ target: { value: '' } })
    await moduleControl(harness.render(), '保存设置').props.onClick()
    assert.deepEqual(calls.at(-1).body.patch, { 'onebot.wsToken': { op: 'keep' } })
    assert.doesNotMatch(JSON.stringify(panel.navigationSearchIndex()), /new-secret|masked|cas/)
  } finally { harness.restore(); globalThis.fetch = original }
})

test('C03 persona library has management only; runtime expression editor stays in its owner destination', () => {
  const persona = { id: 'active', profile: { displayName: 'current' }, traits: {}, style: {}, values: [] }
  const props = { ownerIntegration: true, navigation: { area: 'profiles', section: 'library' }, configInfo: { config: DEFAULTS }, toast() {} }
  const render = extra => {
    stateOverrides = [persona, [{ id: 'active' }], 'active', persona.profile, {}, '', false, false, false]
    try { return panel.PersonaTab({ ...props, ...extra }) } finally { stateOverrides = null }
  }
  const titles = tree => treeNodes(tree).filter(node => node.props?.title).map(node => node.props.title)
  assert.ok(titles(render()).includes('人格库'))
  for (const title of ['人格', 'Prompt 预览', '群聊参与', '高级认知参数', '演化历史']) assert.equal(titles(render()).includes(title), false, title)
  assert.ok(titles(render({ runtimeEditor: true })).includes('人格'))
  assert.equal(titles(render({ runtimeEditor: true })).includes('群聊参与'), false)
  const staged = panel.OwnerSettings({ ...props, navigation: { area: 'profiles', section: 'persona' } })
  assert.match(JSON.stringify(staged), /Profile 设置与运行状态/)
  assert.equal(treeNodes(staged).filter(node => node.type === panel.PersonaTab).length, 0)
})

test('C03 live appearance and module bindings save serial owner patches, without legacy full-config writes', async () => {
  const original = globalThis.fetch, calls = []
  const session = { values: ['overview', {}, {}], index: 0 }
  const root = () => { session.index = 0; hookSession = session; try { return panel.OneBotPage() } finally { hookSession = null } }
  const shared = () => treeNodes(root()).find(node => node.type === panel.AreaContent).props
  let revision = 1
  globalThis.fetch = async (path, init) => {
    const body = init.body && JSON.parse(init.body); calls.push({ path, body })
    return { ok: true, json: async () => path.includes('/settings/view?') ? { ok: true, revision }
      : body ? (assert.equal(body.revision, revision++), { ok: true, revision })
        : { ok: true, config: DEFAULTS, groups: CONFIG_GROUPS } }
  }
  try {
    const first = shared().saveUiPatch({ 'ui.accent': 'green' })
    const second = shared().saveUiPatch({ 'cognition.typing.enabled': true })
    assert.equal(await first, true); assert.equal(await second, true)
    assert.deepEqual(calls.filter(row => row.body).map(row => row.body), [
      { scope: 'system', revision: 1, patch: { 'ui.accent': 'green' } },
      { scope: 'module:builtin-typing', revision: 2, patch: { 'cognition.typing.enabled': true } },
    ])
    assert.ok(calls.some(row => row.path.endsWith('/settings/view?scope=module%3Abuiltin-typing')))
    assert.equal(calls.some(row => row.path.endsWith('/config/save')), false)
    assert.equal(await shared().saveUiPatch({ 'ui.accent': 'blue', 'cognition.typing.enabled': false }), false)
    assert.equal(calls.filter(row => row.body).length, 2)
  } finally { globalThis.fetch = original }
})

test('C03 legacy appearance categories and field searches select the direct category in the same mount', () => {
  const originalEffect = reactShim.useEffect
  reactShim.useEffect = () => {}
  const instance = registration.factory(requireShim), targets = []
  const props = { ownerIntegration: true, navigation: contractGo('settings:motion'), configInfo: { groups: CONFIG_GROUPS, config: DEFAULTS }, draft: DEFAULTS, goTo: value => targets.push(value), saveUiPatch() {} }
  const render = mountNode({ type: instance.SettingsTab, props })
  try {
    assert.ok(treeNodes(render()).some(node => node.props?.['aria-current'] === 'page' && treeNodes(node).some(child => child.children?.includes('动效'))))
    props.navigation = contractGo('ui.fontScale')
    assert.ok(treeNodes(render()).some(node => node.props?.['aria-current'] === 'page' && treeNodes(node).some(child => child.children?.includes('布局与字号'))))
    const button = treeNodes(render()).find(node => node.type === 'button' && treeNodes(node).some(child => child.children?.includes('数据与刷新')))
    button.props.onClick()
    assert.deepEqual(targets.at(-1), { area: 'system', section: 'appearance', anchor: 'data' })
  } finally { reactShim.useEffect = originalEffect }
})

test('C03 every mounted owner form renders each of its fields exactly once and no foreign field', () => {
  const seen = []
  for (const area of NAVIGATION_REGISTRY) for (const section of area.sections) {
    const navigation = { area: area.id, section: section.id }, fields = panel.ownerFields(navigation)
    if (!fields.length) continue
    const values = Object.fromEntries(fields.map(field => [field.path, field.sensitivity.startsWith('secret') ? { masked: true, present: true } : panel.getByPath(DEFAULTS, field.path)]))
    stateOverrides = [[], 'active', { revision: 1, values }, 'active', {}, '', false]
    let tree
    try { tree = panel.OwnerSettings({ navigation, configInfo: { groups: CONFIG_GROUPS } }) } finally { stateOverrides = null }
    const rendered = treeNodes(tree).filter(node => node.props?.['data-setting-path']).map(node => node.props['data-setting-path'])
    assert.deepEqual(rendered.sort(), fields.map(field => field.path).sort())
    assert.equal(rendered.length, new Set(rendered).size)
    seen.push(...rendered)
    const page = panel.AreaContent({ navigation })
    assert.equal(treeNodes(page).filter(node => node.type === panel.OwnerSettings).length, area.id === 'system' && section.id === 'appearance' ? 0 : 1)
  }
  assert.equal(seen.length, new Set(seen).size)
  assert.equal(seen.length, SETTINGS_FIELDS.filter(field => field.ownerClass !== 'module' && field.apply !== 'read-only').length)
})

test('C03 module-file setting search scrolls the local schema field after loading, without a browser', async () => {
  const originalEffect = reactShim.useEffect, originalDocument = globalThis.document, effects = [], ids = []
  reactShim.useEffect = (effect, deps) => effects.push({ effect, deps })
  const instance = registration.factory(requireShim)
  const navigation = contractGo('modules.builtin-sample.message')
  globalThis.document = { getElementById: id => { ids.push(id); return { scrollIntoView() {} } } }
  try {
    stateOverrides = [[], false, '', '', { id: 'builtin-sample', values: { message: '' } }, '', null, '', 'builtin-sample']
    try { instance.ModulesPage({ navigation }) } finally { stateOverrides = null }
    const cleanup = effects.find(row => row.deps?.length === 4 && row.deps[0] === navigation).effect()
    await new Promise(resolve => setTimeout(resolve, 5))
    cleanup?.()
    assert.deepEqual(ids, ['ob-field-message'])
  } finally { reactShim.useEffect = originalEffect; if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument }
})


test('C09 client legacy object forms exhaustively match the canonical navigation contract (Node shim)', () => {
  const check = input => assert.deepEqual(panel.navigationTarget(input), contractGoTo(input), JSON.stringify(input))
  for (const alias of Object.keys(LEGACY_ALIASES)) assert.deepEqual(panel.resolveLegacyGo('#' + alias), contractGo('#' + alias), alias)
  for (const tab of Object.keys(LEGACY_TABS)) {
    for (const name of [tab, `tab:${tab}`, `ob-tab-${tab}`, `ob-panel-${tab}`]) check({ tab: name })
  }
  for (const section of Object.keys(LEGACY_COGNITION_SECTIONS)) check({ tab: 'cognition', section })
  for (const group of Object.keys(LEGACY_CONFIG_GROUPS)) {
    for (const input of [{ tab: 'config', section: group }, { tab: 'config', anchor: group }]) check(input)
    if (group.startsWith('cog-')) {
      check({ tab: 'cognition', section: group })
      check({ tab: 'ob-tab-cognition', section: 'settings', anchor: group })
    }
  }
  for (const moduleId of [...LEGACY_MODULE_IDS, 'Local.Module_v2:ABC-123']) {
    for (const name of ['detail', 'config', 'panel', 'reminders']) {
      check({ tab: 'modules', moduleId, section: name })
      for (const anchor of [name, `ob-module-${name}`]) check({ tab: 'modules', moduleId, anchor })
    }
  }
  for (const [name, section, key] of [['decision', 'policy', 'decisionId'], ['task', 'learning', 'taskId']]) {
    for (const id of ['ABC_01:part.v2-3', 'Z'.repeat(96)]) {
      check({ tab: 'cognition', section, [key]: id })
      for (const anchor of [`${name}-${id}`, `ob-cog-${name}-${id}`]) check({ tab: 'cognition', section, anchor, [key]: id })
    }
  }
})

// UI phase 3: DOM structure and CSS contracts; these are not browser layout measurements.
test('UI phase 3 module cards: dedicated container/grid, title-only header, footer controls and long text retained', () => {
  const long = 'VeryLongModuleValue'.repeat(80)
  const item = { id: 'external-long', name: long, description: long + '-description', version: long + '-version', builtin: false, source: 'external', status: 'loaded', enabled: true, hasConfig: true, canReload: true, canToggle: false, permissions: [long + '-permission'], requires: [long + '-dependency'], error: long + '-error', generation: 'g', uiRevision: 'r' }
  stateOverrides = [[item, { ...item, id: 'short', name: '短标题', description: '短说明' }], false, '', '', null, '', moduleCatalog(moduleUi(item))]
  let tree
  try { tree = panel.ModulesPage({}) } finally { stateOverrides = null }
  const nodes = treeNodes(tree), list = nodes.find(node => node.props?.className === 'ob-module-list')
  assert.equal(list.children[0].props.className, 'ob-module-grid')
  assert.ok(!nodes.some(node => node.props?.className === 'ob-grid two'))
  const cards = nodes.filter(node => node.type === 'article')
  assert.equal(cards.length, 2)
  for (const card of cards) {
    assert.equal(card.props.className, 'ob-module-card')
    const component = card.children[0]
    assert.equal(component.props.actions, undefined)
    assert.equal(component.props.footer.props.className, 'ob-module-actions')
    const controls = savebarNodes(component).filter(node => node.type?.name === 'Btn')
    const labels = controls.map(node => node.children[0])
    assert.equal(new Set(labels).size, labels.length, 'card controls occur once across body, actions and footer')
    assert.deepEqual(controls, treeNodes(component.props.footer).filter(node => node.type?.name === 'Btn'))
    const rendered = component.type({ ...component.props, children: component.children })
    const header = rendered.children[0], footer = rendered.children[2]
    assert.equal(header.props.className, 'ob-panel-head with-line')
    assert.equal(treeNodes(header).some(node => node.type?.name === 'Btn' || node.type === 'button'), false)
    assert.equal(footer.props.className, 'ob-panel-foot')
    assert.deepEqual(treeNodes(footer).filter(node => node.type?.name === 'Btn').map(node => node.children[0]), card.props.key === item.id ? ['详情', '配置', '重载', '停用'] : ['详情', '重载', '停用'])
  }
  const panelNode = cards[0].children[0]
  assert.equal(panelNode.props.title, long)
  assert.equal(panelNode.props.description, item.description)
  for (const value of [item.version, ...item.permissions, ...item.requires, item.error]) assert.ok(JSON.stringify(tree).includes(value), value)
  const toggle = treeNodes(panelNode.props.footer).find(node => node.children?.includes('停用'))
  const reason = nodes.find(node => node.props?.id === toggle.props['aria-describedby'])
  assert.ok(reason)
  assert.equal(reason.type, 'p')
  assert.equal(toggle.props.disabled, true)
  const nativeButton = toggle.type({ ...toggle.props, children: toggle.children })
  assert.equal(nativeButton.props['aria-describedby'], reason.props.id)
  stateOverrides = [[], true]
  try {
    const loading = panel.ModulesPage({})
    assert.equal(loading.props.className, 'ob-module-list ob-module-scope')
    assert.equal(loading.children[0].props.className, 'ob-module-grid')
  } finally { stateOverrides = null }
})

test('UI phase 3 module detail: summary, health, actions, links, reminders and surfaces are siblings with stable anchors/keys', () => {
  const transparentChildren = value => Array.isArray(value) ? value.flatMap(transparentChildren) : !value ? [] : value.type === reactShim.Fragment ? transparentChildren(value.children) : [value]
  for (const id of ['builtin-reminders', 'builtin-media-features']) {
    const item = { id, name: id, builtin: true, source: 'builtin', enabled: true, status: 'loaded', canToggle: true, generation: 'g', uiRevision: 'r' }
    const surfaces = [
      { id: 'preview', hook: 'module.detail', renderer: 'builtin-react', componentKey: id === 'builtin-reminders' ? 'reminders.preview' : 'media-features.preview', order: 0 },
      { id: 'settings', hook: 'module.config', renderer: 'schema', order: 1 },
      { id: 'panel', hook: 'module.panel', renderer: id === 'builtin-reminders' ? 'status' : 'builtin-react', ...(id === 'builtin-media-features' ? { componentKey: 'media-features.panel' } : {}), order: 2 },
    ]
    const ui = moduleUi(item, { config: { binding: 'legacy-core', available: true, schemaVersion: 1 }, surfaces })
    stateOverrides = [[item], false, '', '', null, '', moduleCatalog(ui), '', item.id]
    let tree
    try { tree = panel.ModulesPage({}) } finally { stateOverrides = null }
    assert.equal(tree.props.id, 'ob-module-detail')
    const siblings = transparentChildren(tree.children)
    assert.equal(siblings[0].props.className, 'ob-module-toolbar')
    const summary = siblings.find(node => node.props?.className === 'ob-module-summary')
    assert.ok(summary)
    assert.ok(!treeNodes(summary).some(node => [panel.CoreModuleHealth, panel.CoreModuleActions, panel.ModuleFeatureLinks].includes(node.type)))
    const health = siblings.find(node => node.type === panel.CoreModuleHealth), actions = siblings.find(node => node.type === panel.CoreModuleActions)
    assert.equal(health.props.key, id + ':g:health:0')
    assert.equal(actions.props.key, id + ':actions')
    assert.ok(siblings.some(node => node.type === panel.ModuleFeatureLinks))
    if (id === 'builtin-reminders') assert.ok(siblings.some(node => node.props?.id === 'ob-module-reminders'))
    for (const [anchor, key] of [['ob-module-config', 'settings'], ['ob-module-panel', 'panel'], ['ob-module-surface-preview', 'preview']]) {
      const section = siblings.find(node => node.props?.id === anchor)
      assert.ok(section, anchor)
      assert.equal(section.props.key, key)
      assert.equal(section.children[0].props?.key, anchor === 'ob-module-panel' && id === 'builtin-media-features' ? key : undefined)
    }
    const config = siblings.find(node => node.props?.id === 'ob-module-config')
    assert.equal(config.children[0].type.name, 'Panel')
    const media = siblings.find(node => node.props?.id === 'ob-module-panel')
    if (id === 'builtin-media-features') assert.equal(media.children[0].type, panel.MediaFeaturesPanel, 'media owns its Panels, with no extra padded Panel')
    const previewSection = siblings.find(node => node.props?.id === 'ob-module-surface-preview')
    const preview = treeNodes(previewSection).find(node => node.type === panel.BUILTIN_MODULE_UI[surfaces[0].componentKey])
    assert.ok(preview)
    assert.equal(previewSection.children[0].children[0].props.key, 'preview')
    assert.equal(preview.type(preview.props).props.className, 'ob-module-preview')
  }
})

test('UI phase 3 metadata/actions: long health values and reasons wrap without text loss; reasons describe native buttons', () => {
  const long = 'unbroken-runtime-generation-dependency-reason-error-'.repeat(40)
  const health = { moduleId: 'module-long', runtimeGeneration: long + 'generation', reasonCode: long + 'reason', reasons: [long + 'reasons'], lastError: { reasonCode: long + 'error' }, providers: [{ name: long + 'provider', fallback: { reasonCode: long + 'fallback' } }], dependencies: [{ moduleId: long + 'dependency', available: false }] }
  stateOverrides = [{ items: [health] }, '', false]
  let tree
  try { tree = panel.CoreModuleHealth({ moduleId: health.moduleId }) } finally { stateOverrides = null }
  const metadata = treeNodes(tree).filter(node => node.type === 'dl')
  assert.ok(metadata.length > 1)
  assert.ok(metadata.every(node => node.props.className === 'ob-module-metadata ob-small'))
  for (const list of metadata) {
    const terms = treeNodes(list).filter(node => node.type === 'dt' || node.type === 'dd')
    assert.ok(terms.length > 0)
    assert.equal(terms.length % 2, 0)
    assert.ok(terms.every((node, index) => node.type === (index % 2 ? 'dd' : 'dt')), 'metadata keeps label/value pairs')
  }
  for (const suffix of ['generation', 'reason', 'reasons', 'error', 'provider', 'fallback', 'dependency']) assert.ok(JSON.stringify(tree).includes(long + suffix), suffix)
  stateOverrides = [{ items: [{ actionId: 'module.reload', available: false, reasonCode: long }] }, '', false]
  try { tree = panel.CoreModuleActions({ moduleId: health.moduleId }) } finally { stateOverrides = null }
  const group = treeNodes(tree).find(node => node.props?.className === 'ob-module-actions')
  const action = treeNodes(group).find(node => node.props?.className === 'ob-module-action')
  const [button, reason] = action.children
  assert.equal(reason.type, 'p')
  assert.equal(reason.children[0], long)
  assert.equal(button.props['aria-describedby'], reason.props.id)
  assert.equal(button.type(button.props).props['aria-describedby'], reason.props.id)
  assert.ok(!treeNodes(button).includes(reason))
})

test('UI phase 3 module config: number input/unit, field id/key and bounded long preview remain intact', () => {
  const item = { id: 'builtin-sample', source: 'builtin', builtin: true, hasConfig: true, enabled: true, status: 'loaded', generation: 'g', uiRevision: 'r' }
  const long = '长预览WithoutSpaces'.repeat(10)
  const spec = { path: 'count', type: 'number', label: '数量', min: 0, max: 100, step: 2, unit: 'long-unit-without-breaks'.repeat(10) }
  const editor = { id: item.id, schema: { fields: [spec] }, values: { count: 8, message: long }, revision: 1 }
  const ui = moduleUi(item, { surfaces: [{ id: 'preview', hook: 'module.detail', renderer: 'builtin-react', componentKey: 'sample.preview', order: 0 }, { id: 'config', hook: 'module.config', renderer: 'schema', order: 1 }] })
  stateOverrides = [[item], false, '', '', editor, '', moduleCatalog(ui), '', item.id]
  let tree
  try { tree = panel.ModulesPage({}) } finally { stateOverrides = null }
  const preview = treeNodes(tree).find(node => node.type === panel.BUILTIN_MODULE_UI['sample.preview'])
  assert.ok(JSON.stringify(preview.type(preview.props)).includes(long))
  const row = treeNodes(tree).find(node => node.type?.name === 'FieldRow')
  assert.equal(row.props.key, item.id + ':' + spec.path)
  const rowTree = row.type(row.props)
  const fieldControl = treeNodes(rowTree).find(node => node.type?.name === 'FieldControl')
  let changed
  const number = fieldControl.type({ ...fieldControl.props, onChange: value => { changed = value } })
  assert.equal(number.props.className, 'ob-number-control')
  assert.equal(number.props.style, undefined, 'no inline nowrap')
  const [input, unit] = number.children
  assert.equal(input.props.id, 'ob-field-count')
  assert.equal(treeNodes(rowTree).find(node => node.type === 'label').props.htmlFor, input.props.id)
  assert.equal(input.props.type, 'number')
  assert.deepEqual([input.props.min, input.props.max, input.props.step], [0, 100, 2])
  assert.equal(unit.children[0], spec.unit)
  input.props.onChange({ target: { value: '12' } })
  assert.equal(changed, 12)
  input.props.onChange({ target: { value: '' } })
  assert.equal(changed, '')
})

test('UI phase 3 CSS: container AND viewport thresholds, equal-height footer cards, wrapping and mobile single columns', () => {
  const css = panel.PANEL_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const rule = (selector, last = false) => { const matches = rules.filter(row => row[1].trim() === selector); const found = last ? matches.at(-1) : matches[0]; assert.ok(found, selector); return found[2] }
  assert.match(rule('.ob-module-list'), /container:ob-module-list \/ inline-size/)
  assert.match(rule('.ob-module-grid'), /grid-template-columns:minmax\(0,1fr\)/)
  assert.match(css, /@media \(width > 900px\)\{\s*@container ob-module-list \(min-width:760px\)\{\s*\.ob-module-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)
  assert.match(rule('.ob-module-card'), /min-inline-size:0;max-inline-size:100%;display:flex;flex-direction:column/)
  assert.match(rule('.ob-module-card > .ob-panel'), /flex:1;display:flex;flex-direction:column/)
  assert.match(rule('.ob-module-card > .ob-panel > .ob-panel-body'), /flex:1/)
  assert.match(rule('.ob-module-card > .ob-panel > .ob-panel-foot'), /margin-block-start:auto/)
  assert.match(rule('.ob-module-scope,.ob-module-scope *'), /min-inline-size:0;max-inline-size:100%/)
  assert.match(rule('.ob-module-scope'), /overflow-wrap:anywhere/)
  assert.match(rule('.ob-module-scope .ob-panel'), /overflow:visible/)
  assert.match(rule('.ob-module-scope .ob-badge'), /height:auto;min-height:22px;white-space:normal;overflow-wrap:anywhere/)
  assert.match(rule('.ob-module-toolbar,.ob-module-actions'), /display:flex;flex-wrap:wrap/)
  assert.match(rule('.ob-module-metadata'), /display:grid;grid-template-columns:minmax\(0,12rem\) minmax\(0,1fr\)/)
  assert.match(rule('.ob-module-metadata dt,.ob-module-metadata dd'), /margin:0;min-inline-size:0;max-inline-size:100%;overflow-wrap:anywhere/)
  assert.match(rule('.ob-module-preview'), /gap:8px;margin:0/)
  assert.match(rule('.ob-module-preview p'), /margin:0/)
  assert.match(rule('.ob-module-scope iframe'), /width:100%;min-width:0;max-width:100%/)
  assert.match(rule('.ob-number-control .ob-input'), /flex:1 1 8rem;min-width:0;width:auto/)
  assert.match(rule('.ob-number-control .ob-field-unit'), /white-space:normal;overflow-wrap:anywhere/)
  assert.match(css, /@media \(max-width:900px\)\{\s*\.ob-module-grid,\.ob-module-metadata\{grid-template-columns:minmax\(0,1fr\)\}/)
  assert.match(rule('.ob-module-card .ob-module-actions', true), /display:grid;grid-template-columns:minmax\(0,1fr\);width:100%/)
  assert.match(rule('.ob-module-card .ob-module-actions > .ob-btn'), /width:100%/)
  assert.match(rule('.ob-module-toolbar .ob-btn,.ob-module-actions .ob-btn'), /min-height:44px/)
  assert.match(rule('.ob-number-control'), /flex-wrap:wrap/)
  assert.match(rule('.ob-number-control', true), /flex-direction:column;align-items:stretch/)
  assert.match(rule('.ob-number-control .ob-input', true), /flex:1 1 auto;width:100%;min-height:44px/)
})

test('UI phase 4 OwnerSettings: one toolbar during loading/errors, disabled save and busy actions', async () => {
  const original = globalThis.fetch, calls = []
  const props = { navigation: { area: 'system', section: 'general' }, configInfo: { groups: CONFIG_GROUPS } }
  const values = Object.fromEntries(panel.ownerFields(props.navigation).map(spec => [spec.path, panel.getByPath(DEFAULTS, spec.path)]))
  let readError = true, release
  globalThis.fetch = async (path, init) => {
    const body = init.body && JSON.parse(init.body); calls.push({ path, body })
    if (body) await new Promise(resolve => { release = resolve })
    return { ok: true, json: async () => readError ? { ok: false, code: 'SETTINGS_READ_UNAVAILABLE' }
      : { ok: true, revision: body ? 5 : 4, values: { ...values, ...body?.patch } } }
  }
  const harness = ownerHarness(props)
  try {
    let tree = harness.render()
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.equal(control(tree, '保存设置').props.disabled, true)
    assert.equal(control(tree, '重新读取').props.disabled, false)
    tree = await harness.load()
    assert.match(JSON.stringify(tree), /SETTINGS_READ_UNAVAILABLE/)
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.equal(control(tree, '保存设置').props.disabled, true)
    readError = false
    await control(tree, '重新读取').props.onClick()
    assert.equal(control(harness.render(), '保存设置').props.disabled, true, 'unchanged form')
    const row = treeNodes(harness.render()).find(node => node.type?.name === 'FieldRow')
    const next = row.props.spec.type === 'switch' ? !row.props.value : 'changed'
    row.props.onChange(next)
    const saving = control(harness.render(), '保存设置').props.onClick()
    tree = harness.render()
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    for (const label of ['保存设置', '重新读取']) assert.equal(control(tree, label).props.disabled, true)
    assert.ok(treeNodes(tree).filter(node => node.type?.name === 'FieldRow').every(node => node.props.disabled))
    await control(tree, '保存设置').props.onClick()
    assert.equal(calls.filter(row => row.body).length, 1, 'busy guard prevents a second write')
    assert.deepEqual(calls.at(-1).body, { scope: 'system', revision: 4, patch: { [row.props.spec.path]: next } })
    release(); await saving
    assert.equal(control(harness.render(), '保存设置').props.disabled, true)
    assert.equal(control(harness.render(), '重新读取').props.disabled, false)
  } finally { harness.restore(); globalThis.fetch = original }
})

test('UI phase 4 profile toolbar preserves unavailable editing and conflict disabled states', () => {
  const navigation = { area: 'profiles', section: 'reply' }
  const values = Object.fromEntries(panel.ownerFields(navigation).map(spec => [spec.path, true]))
  for (const editingAvailable of [false, true]) for (const busy of [false, true]) {
    stateOverrides = [[], 'inactive', { revision: 9, values, editingAvailable }, 'active', { 'cognition.notices.enabled': false }, 'SETTINGS_CONFLICT', busy]
    let tree
    try { tree = panel.OwnerSettings({ navigation, configInfo: { groups: CONFIG_GROUPS } }) } finally { stateOverrides = null }
    assertExplicitSavebar(tree, 'ob-owner-savebar', ['保存设置', '重新读取'])
    assert.match(JSON.stringify(tree), /SETTINGS_CONFLICT/)
    assert.equal(control(tree, '保存设置').props.disabled, busy || !editingAvailable)
    assert.equal(control(tree, '重新读取').props.disabled, busy)
    assert.equal(field(tree, '设置人格').props.disabled, busy)
  }
})

test('UI phase 4 CSS: only local explicit toolbars stick on mobile with opaque surface, safe area and scroll clearance', () => {
  const css = panel.PANEL_CSS
  const mobile = styleBlocks(css, '@media (max-width:900px)').find(block => block.includes('.ob-mobile-topbar{'))
  assert.ok(mobile, 'mobile-only rules at the shared navigation breakpoint')
  const rules = source => [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const rule = (source, selector) => { const row = rules(source).find(row => row[1].trim() === selector); assert.ok(row, selector); return row[2] }
  const selector = '.ob-module-savebar,.ob-owner-savebar'
  const desktop = rule(css, selector), toolbar = rule(mobile, selector)
  assert.match(desktop, /display:flex;flex-wrap:wrap/)
  assert.doesNotMatch(desktop, /position:|bottom:|safe-area/)
  assert.match(toolbar, /position:sticky;bottom:0;z-index:20/)
  assert.match(toolbar, /padding:12px 12px calc\(12px \+ env\(safe-area-inset-bottom,0px\)\)/)
  assert.match(toolbar, /border-top:1px solid var\(--ob-border\);background:var\(--ob-surface\)/)
  assert.doesNotMatch(toolbar, /transparent|color-mix|backdrop-filter|overflow:|position:fixed/)
  assert.match(rule(mobile, '.ob-module-savebar > .ob-btn,.ob-owner-savebar > .ob-btn'), /flex:1 1 8rem;height:auto;min-height:44px;white-space:normal;overflow-wrap:anywhere/)
  assert.match(rule(mobile, '.ob-root:has(.ob-module-savebar,.ob-owner-savebar)'), /scroll-padding-bottom:calc\(12rem \+ env\(safe-area-inset-bottom,0px\)\)/)
  assert.match(rule(mobile, '.ob-module-scope :is(input,select,textarea,[tabindex],.ob-banner),.ob-owner-settings :is([data-setting-path],input,select,textarea,[tabindex],.ob-banner)'), /scroll-margin-block:12px/)
  assert.match(rule(css, '.ob-root'), /overflow:auto;overflow-x:clip/)
  assert.ok(rules(css).some(row => row[1].trim() === '.ob-content' && /overflow-x:clip/.test(row[2])), 'content does not create a second vertical scroller')
})

// Balanced blocks keep breakpoint assertions scoped, including nested container queries.
function styleBlocks(source, header) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, ''), blocks = []
  let offset = 0
  while ((offset = css.indexOf(header + '{', offset)) !== -1) {
    const start = offset + header.length
    let end = start + 1, depth = 1
    while (end < css.length && depth) {
      if (css[end] === '{') depth++
      if (css[end] === '}') depth--
      end++
    }
    assert.equal(depth, 0, `Unclosed CSS block: ${header}`)
    blocks.push(css.slice(start + 1, end - 1))
    offset = end
  }
  return blocks
}

test('UI phase 5 CSS: mobile topbar/dialog, all safe areas and 44px targets stay inside the shared breakpoint', () => {
  const mobile = styleBlocks(panel.PANEL_CSS, '@media (max-width:900px)').find(block => block.includes('.ob-mobile-topbar{'))
  assert.ok(mobile)
  const rules = [...mobile.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  const rule = selector => { const row = rules.find(row => row[1].trim() === selector); assert.ok(row, selector); return row[2] }
  assert.match(rule('.ob-area-shell'), /display:block/)
  assert.match(rule('.ob-navigation-host'), /top:0;z-index:30;background:var\(--ob-canvas\)/)
  assert.match(rule('.ob-mobile-topbar'), /position:sticky;top:0;display:flex/)
  assert.match(rule('.ob-mobile-topbar'), /padding:calc\(8px \+ env\(safe-area-inset-top,0px\)\)/)
  assert.match(rule('.ob-mobile-sections'), /display:flex/)
  assert.match(rule('.ob-nav-dialog'), /position:fixed;inset:0 auto 0 0/)
  assert.match(rule('.ob-nav-dialog'), /width:min\(320px,85vw\);max-width:85vw/)
  assert.match(rule('.ob-nav-dialog'), /height:100vh;height:100dvh;max-height:100vh;max-height:100dvh/)
  assert.match(rule('.ob-nav-dialog'), /overscroll-behavior:contain;overflow:hidden/)
  assert.match(rule('.ob-nav-dialog::backdrop'), /background:var\(--ob-scrim\)/)
  const navigation = rule('.ob-nav-dialog .ob-navigation')
  assert.match(navigation, /overflow-y:auto;overscroll-behavior:contain/)
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.ok(navigation.includes(`env(safe-area-inset-${edge},0px)`), edge)
  const shell = rule('.ob-root .ob-shell')
  for (const edge of ['left', 'right']) assert.ok(shell.includes(`padding-${edge}:max(12px,env(safe-area-inset-${edge},0px))`), edge)
  assert.match(rule('.ob-root'), /padding-bottom:calc\(48px \+ env\(safe-area-inset-bottom,0px\)\)/)
  assert.match(rule('.ob-root button,.ob-root input:not([type=checkbox]):not([type=radio]),.ob-root select'), /min-height:44px/)
  assert.match(rule('.ob-root button'), /min-width:44px;max-width:100%;white-space:normal/)
  assert.match(rule('.ob-root input,.ob-root select,.ob-root textarea'), /font-size:16px/)

  const desktop = styleBlocks(panel.PANEL_CSS, '@media (width > 900px)')
  assert.equal(desktop.length, 1)
  const container = styleBlocks(desktop[0], '@container ob-module-list (min-width:760px)')
  assert.equal(container.length, 1)
  assert.match(container[0], /\.ob-module-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/)
})

test('UI phase 5 navigation: repeated desktop/mobile transitions keep one nav, unique controls/IDs and desktop-only storage writes', () => {
  const h = navigationHarness({ stored: 'collapsed' })
  const assertUnique = mobile => {
    const nodes = treeNodes(h.tree)
    assert.equal(nodes.filter(node => node.type === 'nav').length, 1)
    assert.equal(nodes.filter(node => node.type === 'dialog').length, mobile ? 1 : 0)
    const ids = nodes.flatMap(node => node.props?.id ? [node.props.id] : [])
    assert.equal(new Set(ids).size, ids.length, 'no duplicate DOM IDs')
    const areas = nodes.filter(node => node.props?.['data-area']).map(node => node.props['data-area'])
    assert.deepEqual(areas, NAVIGATION_REGISTRY.map(area => area.id), 'one control per area')
    const sections = nodes.filter(node => node.props?.['data-section']).map(node => node.props['data-section'])
    assert.equal(new Set(sections).size, sections.length, 'one control per destination')
    assert.equal(nodes.filter(node => node.type === 'input' && node.props.type === 'search').length, mobile ? 1 : 0)
  }
  try {
    h.render(); assertUnique(false)
    assert.deepEqual(h.writes, [], 'initial preference read does not write storage')
    for (let cycle = 0; cycle < 3; cycle++) {
      h.resize(true); h.render(); assertUnique(true)
      h.click('导航与搜索'); assertUnique(true)
      assert.equal(h.byLabel('导航与搜索').props['aria-controls'], h.get('.ob-nav-dialog').props.id)
      assert.equal(h.get('.ob-nav-dialog').children[0], h.get('#ob-navigation'))
      h.click('关闭导航'); assertUnique(true)
      h.resize(false); h.render(); assertUnique(false)
      assert.equal(h.get('.ob-navigation-host').props['data-desktop'], 'collapsed')
      assert.equal(h.root.style.overflow, 'auto')
      assert.equal(h.body.style.position, 'relative')
    }
    assert.deepEqual(h.writes, [], 'mobile open/close and resize never persist desktop state')
    assert.deepEqual(h.targets, [], 'responsive transitions never navigate')
    h.click('展开导航')
    assert.deepEqual(h.writes, [['dsh-bot:navigation:desktop:v1', 'expanded']])
    assert.equal(h.root.querySelectorAll('nav').length, 1)
    assert.equal(h.root.querySelectorAll('input').length, 1)
  } finally { h.restore() }
  assert.equal(h.listeners.size, 0, 'media listener is cleaned up')
})
