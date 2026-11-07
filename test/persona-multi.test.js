// 多人格库：默认迁移、创建/复制/切换/删除、active 持久化与内容隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/cognition/store.js'

import {
  PROFILE_TEXT_LIMITS,
  createPersonaService,
  defaultPersona,
  sanitizePersona,
} from '../src/cognition/persona.js'

const CONFIG = {
  cognition: {
    persona: {
      traits: {},
      style: {},
      values: [],
      profile: {},
      evolutionEnabled: true,
      evolutionPerDay: 0.005,
    },
  },
}

function createClock(start = 1000) {
  let now = start
  return { now: () => (now += 1), advance: (ms) => { now += ms } }
}

function createMemoryStore(initial = []) {
  const data = new Map()
  for (const [kind, id, value] of initial) data.set(kind + ':' + id, { kind, id, value: JSON.parse(JSON.stringify(value)) })
  const api = {
    get(kind, id) {
      const item = data.get(kind + ':' + id)
      return item ? JSON.parse(JSON.stringify(item.value)) : null
    },
    put(kind, id, value) {
      data.set(kind + ':' + id, { kind, id, value: JSON.parse(JSON.stringify(value)) })
    },
    remove(kind, id) { data.delete(kind + ':' + id) },
    list(kind) {
      return [...data.values()].filter((item) => item.kind === kind).map((item) => ({ ...JSON.parse(JSON.stringify(item.value)), id: item.id }))
    },
    tx(fn) { return fn() },
  }
  return api
}

function serviceFor(store, clock) {
  return createPersonaService({ store, getConfig: () => CONFIG, clock })
}

test('C02 persona creation hooks share the persona transaction; failure cannot leave an active or orphan profile', t => {
  const store = createStore({ file: ':memory:' }); t.after(() => store.close())
  const clock = createClock()
  const service = createPersonaService({ store, clock, getConfig: () => CONFIG, settingsHooks: {
    created(id) {
      store.put(`persona_${id}:profile_settings`, 'config', { revision: 1 })
      throw new Error('profile initialization failed')
    },
  } })
  service.ensure()
  const generation = service.scopeGeneration()
  assert.throws(() => service.create({ name: 'failed' }), /profile initialization failed/)
  assert.equal(service.list().length, 1)
  assert.equal(service.activeId(), 'self')
  assert.equal(service.scopeGeneration(), generation)
  const inspected = service.getById('self')
  assert.equal(inspected.id, 'self')
  assert.equal(service.scopeGeneration(), generation)
})

test('多人格：旧 self 自动成为默认 active，list 返回 active 标记', () => {
  const clock = createClock()
  const legacy = sanitizePersona({ ...defaultPersona(CONFIG.cognition), id: 'self', profile: { displayName: '旧人格' } }, CONFIG.cognition)
  const store = createMemoryStore([['persona', 'self', legacy]])
  const service = serviceFor(store, clock)
  const current = service.get()
  assert.equal(current.id, 'self')
  assert.equal(service.activeId(), 'self')
  const list = service.list()
  assert.equal(list.length, 1)
  assert.equal(list[0].id, 'self')
  assert.equal(list[0].displayName, '旧人格')
  assert.equal(list[0].active, true)
})

test('多人格：创建空人格/复制/切换，内容与历史互不影响', () => {
  const clock = createClock()
  const store = createMemoryStore()
  const service = serviceFor(store, clock)
  service.ensure()
  const self = service.create({ name: '第一人格' })
  assert.equal(self.ok, true)
  assert.equal(self.personas.length, 2, '默认 self + 新建人格')
  assert.equal(self.persona.profile.displayName, '第一人格')
  assert.equal(self.activeId, self.persona.id)

  const edited = service.edit({ profile: { displayName: '第一人格（改）', personality: '温和' } })
  assert.equal(edited.persona.profile.displayName, '第一人格（改）')
  assert.equal(edited.persona.version, 2)

  const second = service.create({ name: '第二人格' })
  assert.notEqual(second.persona.id, edited.persona.id)
  assert.equal(second.activeId, second.persona.id)
  assert.equal(second.persona.profile.personality, '')
  assert.equal(second.personas.length, 3, 'self + 第一 + 第二')

  const copied = service.duplicate(edited.persona.id)
  assert.equal(copied.ok, true)
  assert.notEqual(copied.persona.id, edited.persona.id)
  assert.equal(copied.persona.profile.personality, '温和')
  assert.equal(copied.persona.profile.displayName, '第一人格（改） 副本')
  assert.equal(copied.persona.version, 1)
  assert.equal(copied.personas.length, 4)

  service.activate(second.persona.id)
  assert.equal(service.get().id, second.persona.id)
  assert.equal(service.get().profile.displayName, '第二人格')
})

test('多人格：activeId 跨 service 实例持久化；删除 active 自动切换，最后一份不可删', () => {
  const clock = createClock()
  const store = createMemoryStore()
  const first = serviceFor(store, clock)
  first.ensure()
  const a = first.create({ name: 'A' }).persona
  const b = first.create({ name: 'B' }).persona
  first.activate(a.id)
  assert.equal(serviceFor(store, clock).get().profile.displayName, 'A')

  const removed = first.remove(a.id)
  assert.equal(removed.ok, true)
  assert.equal(removed.personas.length, 2)
  assert.notEqual(removed.activeId, a.id)
  assert.equal(removed.persona.id, removed.activeId, '删除 active 后必须切到剩余人格')
  const withoutB = first.remove(b.id)
  assert.equal(withoutB.ok, true)
  assert.equal(withoutB.personas.length, 1)
  const last = first.remove(withoutB.activeId)
  assert.equal(last.ok, false)
  assert.equal(last.code, 'LAST_PERSONA')
  assert.equal(first.get().id, withoutB.activeId)
})

test('多人格：指定 personaId 编辑/重置只影响目标，不误伤 active', () => {
  const clock = createClock()
  const store = createMemoryStore()
  const service = serviceFor(store, clock)
  service.ensure()
  const a = service.create({ name: 'A' }).persona
  const b = service.create({ name: 'B' }).persona
  service.activate(a.id)

  const target = service.edit({ profile: { personality: 'B 的性格' } }, b.id)
  assert.equal(target.persona.id, b.id)
  assert.equal(service.get().id, a.id)
  assert.equal(service.getById(b.id).profile.personality, 'B 的性格')
  assert.equal(service.getById(a.id).profile.personality, '')

  const resetB = service.reset(b.id)
  assert.equal(resetB.id, b.id)
  assert.equal(resetB.profile.displayName, '')
  assert.equal(service.get().profile.displayName, 'A')
})

test('多人格：ID/显示名清洗、复制不共享引用', () => {
  const clock = createClock()
  const store = createMemoryStore()
  const service = serviceFor(store, clock)
  service.ensure()
  const a = service.create({ name: 'x'.repeat(100) }).persona
  assert.equal([...a.profile.displayName].length, PROFILE_TEXT_LIMITS.displayName)
  assert.match(a.id, /^persona_/)
  const copied = service.duplicate(a.id).persona
  copied.profile.displayName = '改副本'
  service.save(copied, 'user_edit', copied.id)
  assert.equal(service.getById(a.id).profile.displayName, 'x'.repeat(PROFILE_TEXT_LIMITS.displayName))
  assert.equal(service.getById(copied.id).profile.displayName, '改副本')
  assert.equal(service.getById('missing'), null)
  assert.equal(service.activate('missing').ok, false)
})

test('人格导入：profile/traits/style/source 一次性写入并激活，不覆盖 self', () => {
  const clock = createClock()
  const store = createMemoryStore()
  const service = serviceFor(store, clock)
  service.ensure()
  const imported = service.importPersona({
    name: '深作葵',
    profile: {
      displayName: '深作葵',
      tagline: '虚拟角色版',
      identity: 'COPPELION 的虚拟角色',
      personality: '害怕与关心并存',
      speakingStyle: '中文短句；严肃时停玩笑',
      boundaries: ['不伪造真人经历'],
      examples: '用户：你是谁？\n葵：我是深作葵。',
    },
    traits: { extraversion: 0.55, caution: 0.65 },
    style: { formality: 0.2, warmth: 0.75 },
    values: ['尊重边界'],
    source: { repo: 'https://example.invalid/aoi', commit: 'abc123', version: 'test' },
  })
  assert.equal(imported.ok, true)
  assert.equal(imported.activeId, imported.persona.id)
  assert.equal(service.get().id, imported.persona.id)
  assert.equal(imported.persona.profile.displayName, '深作葵')
  assert.equal(imported.persona.profile.identity, 'COPPELION 的虚拟角色')
  assert.equal(imported.persona.traits.extraversion, 0.55)
  assert.equal(imported.persona.style.warmth, 0.75)
  assert.deepEqual(imported.persona.values, ['尊重边界'])
  assert.equal(imported.persona.source.commit, 'abc123')
  assert.equal(service.getById('self').profile.displayName, '', 'self 不被覆盖')
  assert.equal(service.list().find((item) => item.id === imported.persona.id).source.commit, 'abc123')
})
