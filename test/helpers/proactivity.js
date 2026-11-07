import { createLoopObserver } from '../../src/observability/loop.js'
import { createStore } from '../../src/cognition/store.js'
import { createPersonaScopedStore } from '../../src/cognition/persona-scope.js'
import { createProactivityPort } from '../../src/modules/proactivity-port.js'
import { createProactivityEngine } from '../../src/modules/builtin/proactivity/engine.js'
import { createOutbound } from '../../src/cognition/outbound.js'
import { createDeliveryService } from '../../src/delivery/service.js'
import { createPolicyService } from '../../src/cognition/policy.js'
import { normalizeConfig } from '../../src/core/config.js'

export const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
export function harness(t, { memoryFactory, llm, sendMessage, observe = false } = {}) {
  let personaId = 'self', scopeGeneration = 0, active = true, now = new Date(2026, 10, 7, 12).getTime()
  const clock = { now: () => now }
  const base = createStore({ clock })
  t.after(() => base.close())
  const store = createPersonaScopedStore({ base, getPersonaId: () => personaId })
  const config = normalizeConfig({ access: { ownerQQ: '10001' }, cognition: { enabled: true, dryRun: false, proactivity: { enabled: true, quietStart: 0, quietEnd: 0 } } }).config
  const calls = [], modelCalls = []
  const services = {
    persona: { get: () => ({ style: { warmth: 0.8, formality: 0.3, verbosity: 0.4 } }), scopeGeneration: () => scopeGeneration },
    emotion: { get: () => ({}) },
    llm: { async complete(request) { modelCalls.push(request); return llm ? llm(request) : { ok: true, text: 'hello' } } },
  }
  const observer = observe ? createLoopObserver({ base, getPersonaId: () => personaId, clock }) : null
  services.loopObserver = observer
  const policy = createPolicyService({ store, clock, getConfig: () => config })
  const access = { canSend: () => ({ allowed: true }) }
  const outbound = createOutbound({ observer, getConfig: () => config, clock, policy, access, gateway: { actions: { async sendMessage(intent) { calls.push(intent); return sendMessage ? sendMessage(intent) : { message_id: 'one' } } } } })
  const delivery = createDeliveryService({ outbound })
  const port = createProactivityPort({ store, services, clock, delivery, getConfig: () => config, memoryFactory, moduleId: 'builtin-proactivity', runtimeGeneration: 'runtime_1',
    getState: () => ({ ready: true }), assertActive() { if (!active) throw Error('MODULE_DISABLED') },
  })
  const timers = new Map(), delays = []
  let nextTimer = 0
  const scheduler = { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, fn); delays.push(delay); return { id } }, clearTimeout(id) { timers.delete(id) } }
  const engine = createProactivityEngine({ port, getConfig: () => config.cognition.proactivity, scheduler })
  const seed = (id = 'r1', patch = {}) => {
    store.put('person', 'p1', { displayName: 'friend' })
    store.put('relationship', id, { personId: 'p1', scopeType: 'private', scopeId: '10001', familiarity: 0.9, affinity: 0.8, initiative: 0.7, trust: 0.6, intimacy: 0.5, ...patch })
  }
  seed()
  engine.start()
  return { base, store, config, services, policy, access, outbound, delivery, port, engine, calls, modelCalls, timers, delays, seed,
    switchPersona(id) { personaId = id; scopeGeneration++ }, stop() { active = false; engine.stop() }, advance(ms) { now += ms },
    async fire() { const [id, fn] = timers.entries().next().value; timers.delete(id); await fn() },
  }
}
