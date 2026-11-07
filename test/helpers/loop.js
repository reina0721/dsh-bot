import { createStore } from '../../src/cognition/store.js'
import { createLoopObserver, LOOP_RUN_KIND, DELIVERY_RECEIPT_KIND } from '../../src/observability/loop.js'
import { scopedPersonaKind } from '../../src/cognition/persona-scope.js'

export function loopHarness(t) {
  let personaId = 'self', time = 1000000000
  const clock = { now: () => time }
  const base = createStore({ clock })
  t.after(() => base.close())
  for (const id of ['self', 'other']) base.put('persona', id, {})
  const observer = createLoopObserver({ base, getPersonaId: () => personaId, clock })
  const rows = (name, persona = personaId) => base.list(scopedPersonaKind(persona, name), { limit: 10000, order: 'asc' })
  return { base, clock, observer, loops: persona => rows(LOOP_RUN_KIND, persona), receipts: persona => rows(DELIVERY_RECEIPT_KIND, persona),
    switchPersona(id) { personaId = id }, advance(ms) { time += ms },
  }
}
