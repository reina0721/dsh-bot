import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../../src/cognition/store.js'
import { createPersonaScopedStore } from '../../src/cognition/persona-scope.js'
import { createKnowledgeService } from '../../src/cognition/knowledge.js'
import { createLearningPort } from '../../src/modules/learning-port.js'
import { createLearningEngine } from '../../src/modules/builtin/learning/engine.js'
import { normalizeConfig } from '../../src/core/config.js'

export const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { resolve, promise } }
export function harness(t, { autoResearch = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-learning-'))
  let now = 10000000, personaId = 'self', generation = 0, active = true
  const config = normalizeConfig({ cognition: { enabled: true, learning: { autoResearch, maxTasksPerHour: 10, sources: { web: false, wikipedia: false, openalex: false, github: false } } } }).config
  const clock = { now: () => now }, base = createStore({ file: join(root, 'c.sqlite'), clock })
  const store = createPersonaScopedStore({ base, getPersonaId: () => personaId })
  const calls = []
  const source = { id: 'fake', reliability: 0.9,
    async search(query) { calls.push(['search', query]); return [{ url: 'https://a.example/x', snippet: 'definition', title: 'title' }, { url: 'https://b.example/y', snippet: 'definition', title: 'title' }] },
    async fetch(url) { calls.push(['fetch', url]); return { url, text: url.includes('a.example') ? 'definition A' : 'definition B' } },
  }
  const services = { knowledge: createKnowledgeService({ store, getConfig: () => config, clock }), sources: { list: () => [source] }, persona: { scopeGeneration: () => generation } }
  const port = createLearningPort({ store, getConfig: () => config, services, clock, getState: () => ({ ready: true, enabled: config.cognition.enabled, paused: config.cognition.paused }), assertActive: () => { if (!active) throw Error('MODULE_DISABLED') } })
  const timers = new Map(); let timerId = 0
  const scheduler = { setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id }, clearTimeout(id) { timers.delete(id) } }
  const engine = createLearningEngine({ port, getConfig: () => config.cognition.learning, scheduler })
  t.after(() => { engine.stop(); base.close(); rmSync(root, { recursive: true, force: true }) })
  const detect = (surface = 'concept', scopeType = 'group') => services.knowledge.detectFromTurn({ turn: { text: surface, chatType: scopeType }, analysis: { unknownCandidates: [{ surface }], confidence: 0.7 }, scope: { scopeType } })
  const seed = (id = 't', patch = {}) => { store.put('unknown', 'u' + id, { id: 'u' + id, status: 'open', scopeType: 'group', surface: 'concept' }); return store.put('learning_task', id, { id, unknownId: 'u' + id, surface: 'concept', status: 'pending', nextRunAt: now, attempts: 0, version: 1, createdAt: now, ...patch }) }
  return { root, config, clock, base, store, services, source, port, engine, scheduler, timers, calls, detect, seed,
    revoke() { active = false }, advance(ms) { now += ms }, switchPersona(id) { personaId = id; generation++ },
    async tick() { const [id, timer] = timers.entries().next().value; timers.delete(id); await timer.fn() },
  }
}
