// Node React shim: execute event handlers/effects. No browser binary or layout verification.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.children)]
const button = (tree, label) => { const node = nodes(tree).find(row => row.children?.includes(label) && row.props?.onClick); assert.ok(node, label); return node }
const field = (tree, label) => { const node = nodes(tree).find(row => row.props?.['aria-label'] === label); assert.ok(node, label); return node }
const snapshot = (extra = {}) => ({ ok: true, environment: 'simulation', realSends: 0, id: 'sim_example', boundPersonaId: 'persona-a', generation: 1, now: Date.UTC(2026, 0, 1),
  transcript: [], captures: [], receipts: [], deliveryReceipts: [], loops: [], stages: [], persona: { profile: { displayName: '只读模拟人格' } }, configSnapshot: { network: false, model: 'fixture/offline' }, ...extra })
function mount(fetcher) {
  const state = [], refs = [], effects = []
  let index = 0, refIndex = 0, entry, serial = 0
  const react = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    createContext: () => ({}), Component: class {}, Fragment: 'Fragment',
    useState(initial) { const key = index++; if (!(key in state)) state[key] = typeof initial === 'function' ? initial() : initial; return [state[key], value => { state[key] = typeof value === 'function' ? value(state[key]) : value }] },
    useRef(initial) { return refs[refIndex++] ||= { current: initial } }, useEffect(effect) { effects.push(effect) } }
  runInNewContext(source, { window: { __ModuleLoader__: { load(value) { entry = value } } },
    fetch: fetcher, crypto: { randomUUID: () => 'uuid_' + ++serial }, Date, Math })
  const panel = entry.factory(name => { assert.equal(name, 'react'); return react })
  const render = () => { index = refIndex = 0; effects.length = 0; return panel.SandboxChat() }
  render()
  return { render, panel, effect: effects[0], change(label, value) { field(render(), label).props.onChange({ target: { value } }) } }
}
const response = body => ({ ok: body.ok !== false, json: async () => body })

test('sandbox UI creates/selects, private/group commands/events, advances, resets/deletes and renders captures/receipts/stages read-only', async () => {
  const calls = []
  const h = mount(async (path, init) => {
    assert.ok(path.startsWith('/onebot-qq/api/sandbox/chat/'))
    const body = init.body && JSON.parse(init.body); calls.push({ path, method: init.method, body })
    if (path.endsWith('/list')) return response(snapshot({ items: [{ id: 'sim_example' }] }))
    return response(snapshot({ transcript: [{ direction: 'in', chatType: 'private', text: '<img src=https://invalid>', at: 1 }, { direction: 'out', chatType: 'group', text: '离线回答', at: 1 }],
      captures: [{ action: 'send_group_msg', realSend: false }], receipts: [{ requestId: body?.requestId || 'r', accepted: true }], deliveryReceipts: [{ status: 'sent' }], loops: [{ id: 'loop-1' }], stages: [{ loopId: 'loop-1', stage: 'closed' }], ...(path.endsWith('/delete') ? { deleted: true } : {}) }))
  })
  assert.match(JSON.stringify(h.render()), /SIMULATION \/ zero real sends/)
  assert.ok(nodes(h.render()).some(row => row.props?.['data-state'] === 'empty'))
  await button(h.render(), '创建模拟').props.onClick()
  let tree = h.render()
  assert.match(JSON.stringify(tree), /只读模拟人格|Captured actions|入站回执|交付回执|loop-1|closed/)
  assert.equal(field(tree, '模拟文本或命令').props.maxLength, 4000)
  for (const chatType of ['private', 'group']) {
    h.change('模拟会话类型', chatType); h.change('模拟文本或命令', '/help')
    await button(h.render(), '提交模拟事件').props.onClick()
    assert.equal(calls.at(-1).body.event.chatType, chatType)
    assert.equal(calls.at(-1).body.event.text, '/help')
    assert.equal(calls.at(-1).body.event.addressed, chatType === 'group')
    assert.ok(calls.at(-1).body.requestId.startsWith('ui_'))
  }
  for (const kind of ['notice', 'request']) {
    h.change('模拟事件类型', kind)
    await button(h.render(), '提交模拟事件').props.onClick()
    assert.equal(calls.at(-1).body.event.kind, kind)
  }
  h.change('推进虚拟时间（毫秒）', '120000')
  await button(h.render(), '推进虚拟时间').props.onClick()
  assert.equal(calls.at(-1).body.ms, 120000)
  await button(h.render(), '重置模拟').props.onClick()
  assert.ok(calls.at(-1).path.endsWith('/reset'))
  await field(h.render(), '选择模拟').props.onChange({ target: { value: 'sim_example' } })
  assert.ok(calls.at(-1).path.endsWith('/detail?id=sim_example'))
  await button(h.render(), '删除模拟').props.onClick()
  assert.equal(field(h.render(), '选择模拟').props.value, '')
  assert.ok(nodes(h.render()).some(row => row.props?.['data-state'] === 'empty'))
  assert.ok(calls.every(row => !/\/(send|action|config|models|cognition)\b/.test(row.path)))
  assert.equal(new Set(calls.filter(row => row.method === 'POST').map(row => row.body.requestId)).size, calls.filter(row => row.method === 'POST').length)
  assert.ok(nodes(tree).every(row => !['img', 'iframe', 'video', 'audio'].includes(row.type) && !row.props?.dangerouslySetInnerHTML))
  assert.ok(nodes(tree).filter(row => ['input', 'textarea', 'select'].includes(row.type)).every(row => !/人格|配置/.test(row.props?.['aria-label'] || '')))
  assert.ok(h.panel.PANEL_CSS.includes('.ob-sandbox-grid { grid-template-columns:minmax(0,1fr); }'))
  assert.equal(h.panel.TABS.length, 6)
})

test('sandbox UI bounds text/timers, preserves drafts on error and clears cross-persona data', async () => {
  let error = '', calls = 0
  const h = mount(async () => { calls++; return response(error ? { ok: false, code: error } : snapshot()) })
  await button(h.render(), '创建模拟').props.onClick()
  h.change('模拟文本或命令', 'x'.repeat(4001))
  await button(h.render(), '提交模拟事件').props.onClick()
  assert.equal(calls, 1)
  for (const invalid of ['', '-1', '1.5', '86400001']) {
    h.change('推进虚拟时间（毫秒）', invalid)
    await button(h.render(), '推进虚拟时间').props.onClick()
  }
  assert.equal(calls, 1)
  h.change('模拟文本或命令', '保留草稿'); error = 'SIMULATION_RATE_LIMIT'
  await button(h.render(), '提交模拟事件').props.onClick()
  assert.equal(field(h.render(), '模拟文本或命令').props.value, '保留草稿')
  assert.ok(nodes(h.render()).some(row => row.props?.['data-state'] === 'error'))
  error = 'SIMULATION_NOT_FOUND'
  await button(h.render(), '提交模拟事件').props.onClick()
  assert.equal(field(h.render(), '选择模拟').props.value, '')
  assert.equal(nodes(h.render()).some(row => row.props?.['aria-label'] === '模拟文本或命令'), false)
})

test('sandbox UI loading blocks duplicate calls, discards unmounted results, and rejects invalid responses', async () => {
  let release, count = 0
  const h = mount(() => { count++; return new Promise(resolve => { release = resolve }) })
  const pending = button(h.render(), '创建模拟').props.onClick()
  await button(h.render(), '创建模拟').props.onClick()
  assert.equal(count, 1)
  assert.equal(button(h.render(), '创建模拟').props.disabled, true)
  assert.ok(nodes(h.render()).some(row => row.props?.['data-state'] === 'loading'))
  release(response({ ok: true, environment: 'live', realSends: 1 }))
  await pending
  assert.match(JSON.stringify(h.render()), /SIMULATION_RESPONSE_INVALID/)
  const cleanup = h.effect()
  // effect starts list; completing after unmount must not adopt the returned session.
  cleanup()
  release(response(snapshot({ items: [{ id: 'stale' }] })))
  await new Promise(resolve => setImmediate(resolve))
  assert.doesNotMatch(JSON.stringify(h.render()), /stale/)
})
