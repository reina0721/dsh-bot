// dsh-bot 网页半边单元测试（node:test，不依赖浏览器 / 真实网关）
//
// 做法：伪造 window.__ModuleLoader__ 捕获插件注册对象，用极简 React shim 执行 factory，
// 然后断言导出的纯函数、样式契约与 apply 的 slot 注册形状。

import { test } from 'node:test'
import assert from 'node:assert/strict'
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
    ['overview', 'connect', 'messages', 'media', 'content', 'modules', 'backup', 'security', 'config', 'persona', 'models', 'settings', 'cognition', 'logs', 'about'],
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

test('面板品牌：初始名称、status 更新、tabs aria 与关于标题', () => {
  const render = (tab, status) => {
    stateOverrides = [tab, status, {}]
    try { return treeNodes(panel.OneBotPage()) } finally { stateOverrides = null }
  }
  for (const [status, brand] of [[null, '小葵'], [{ brand: '' }, '小葵'], [{ brand: '葵' }, '葵']]) {
    const nodes = render('overview', status)
    const header = nodes.find((node) => node.type?.name === 'PageHeader')
    assert.equal(header.props.title, brand)
    assert.equal(header.props.eyebrow, `ONEBOT V11 · ${brand}`)
    const tabs = nodes.find((node) => node.type?.name === 'Tabs')
    assert.equal(tabs.type(tabs.props).props['aria-label'], '小葵 面板')
    assert.doesNotMatch(JSON.stringify(nodes), /QQ 连接/)
  }
  assert.equal(render('about', { brand: '葵' }).find((node) => node.type?.name === 'PageHeader').props.title, '关于 dsh-bot')
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
    assert.equal(panel.TABS.length, 15)
    assert.deepEqual(panel.TABS.find((tab) => tab.id === 'security'), { id: 'security', label: '安全', icon: 'shield' })
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
  assert.equal(treeNodes(built.props.actions).some((node) => node.children?.includes('重载')), false)
  assert.equal(control(built.props.actions, '停用').props.disabled, false)
  const reply = panels.find((node) => node.props.title === '回复交付')
  assert.ok(reply)
  assert.equal(treeNodes(reply.props.actions).some((node) => node.children?.includes('配置')), false)
  assert.equal(control(reply.props.actions, '停用').props.disabled, false)
  const typing = panels.find((node) => node.props.title === '私聊输入状态')
  assert.ok(typing)
  assert.equal(treeNodes(typing.props.actions).some((node) => ['配置', '重载'].some(label => node.children?.includes(label))), false)
  assert.equal(control(typing.props.actions, '停用').props.disabled, false)
  const external = panels.find((node) => node.props.title === '外部清单关闭')
  assert.equal(control(external.props.actions, '启用').props.disabled, true)
  assert.equal(control(external.props.actions, '重载').props.disabled, false)
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
const moduleControl = (tree, text) => control([tree, ...treeNodes(tree).map((node) => node.props?.actions)], text)

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
  const actions = (title) => treeNodes(render()).find((node) => node.props?.title === title).props.actions
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
      const actions = (title) => treeNodes(render()).find((node) => node.props?.title === title).props.actions
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
  const actions = (title) => treeNodes(render()).find((node) => node.props?.title === title).props.actions
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
  const button = () => control(treeNodes(render()).find((node) => node.props?.title === item.id).props.actions, '启用')
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
    assert.ok(control(card(initial, item.name).props.actions, '配置'))
    for (const title of [external.name, absent.name]) assert.ok(!treeNodes(card(initial, title).props.actions).some((node) => node.children?.includes('配置')))
    assert.ok(!treeNodes(initial).some((node) => node.props?.['aria-label'] === '模块配置' || node.type?.name === 'FieldRow'))
    await control(card(initial, item.name).props.actions, '配置').props.onClick()
    assert.deepEqual(calls[0], { path: panel.API_PREFIX + '/modules/config?id=' + item.id, method: 'GET', body: undefined })
    let tree = render()
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
    await control(treeNodes(render()).find((node) => node.props?.title === item.id).props.actions, '配置').props.onClick()
    treeNodes(render()).find((node) => node.type?.name === 'FieldRow').props.onChange('draft')
    for (const [result, expected] of [
      [postResult, /配置冲突/], [{ ok: false, code: 'MODULE_CONFIG_INVALID', message: 'invalid value' }, /invalid value/],
      [{ ok: false, code: 'MODULE_CONFIG_WRITE_FAILED', message: 'write failed' }, /write failed/],
      [{ ok: false, code: 'MODULE_CONFIG_UNAVAILABLE', message: 'unavailable' }, /unavailable/], [Error('offline'), /offline/],
    ]) {
      postResult = result
      const saving = control(render(), '保存配置').props.onClick()
      const pending = render()
      assert.equal(control(pending, '保存配置').props.disabled, true)
      assert.equal(control(pending, '取消').props.disabled, true)
      assert.equal(control(pending, '重新加载配置').props.disabled, true)
      assert.ok(treeNodes(pending).filter((node) => node.type?.name === 'FieldRow').every((node) => node.props.disabled))
      release(); await saving
      assert.match(JSON.stringify(render()), expected)
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
  assert.deepEqual(panel.navigationTarget({ tab: 'cognition', section: 'loop', decisionId: 'decision_1', taskId: 'task_1', anchor: 'tasks', extra: 'ignored' }), { tab: 'cognition', section: 'loop', decisionId: 'decision_1', taskId: 'task_1', anchor: 'tasks' })
  for (const input of [{ tab: 'sidebar' }, { tab: 'modules', moduleId: '../bad' }, { tab: 'cognition', taskId: {} }]) assert.throws(() => panel.navigationTarget(input), /无效/)
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
  const currentPage = () => treeNodes(root()).find(node => typeof node.props?.goTo === 'function')
  currentPage().props.go('cognition', 'cog-llm')
  assert.equal(currentPage().props.configTarget, 'cog-llm')
  assert.deepEqual(currentPage().props.navigation, { tab: 'cognition', section: 'settings', anchor: 'cog-llm' })
  currentPage().props.goTo({ tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' })
  assert.deepEqual(currentPage().props.navigation, { tab: 'modules', moduleId: 'builtin-media-features', anchor: 'panel' })
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
