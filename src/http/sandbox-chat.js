import { randomUUID } from 'node:crypto'
import { REAL_MODEL_PREVIEW_STATUS } from '../simulation/preview-contract.js'

export const SANDBOX_CHAT_LIMITS = Object.freeze({ bodyBytes: 16 * 1024, requestsPerMinute: 120, pending: 8, operations: 1000 })
const fail = code => { throw new Error(code) }
const fields = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_SIMULATION_INPUT')
}
const validId = id => typeof id === 'string' && /^sim_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
const empty = () => ({ transcript: [], captures: [], capturedActions: [], receipts: [], deliveryReceipts: [], loops: [], stages: [] })
export const sandboxChatEnvelope = (value = {}, requestId = `req_${randomUUID()}`) => ({ ...empty(), ...value, environment: 'simulation', realSends: 0, realModelPreview: { ...REAL_MODEL_PREVIEW_STATUS }, requestId })

// Capability boundary: only an isolated service and an identity reader. No live
// gateway, config, store, loop observer, runtime, or network capability enters here.
export function createSandboxChatApi({ simulations, currentPersonaId, now = Date.now }) {
  const owners = new Map()
  let queue = Promise.resolve(), pending = 0, windowAt = now(), requests = 0
  const owner = () => {
    const id = currentPersonaId?.()
    if (typeof id !== 'string' || !id) fail('SIMULATION_UNAVAILABLE')
    return id
  }
  const matchesOwner = personaId => { try { return owner() === personaId } catch { return false } }
  const find = (id, personaId) => {
    if (!validId(id) || owners.get(id)?.personaId !== personaId) fail('SIMULATION_NOT_FOUND')
    return owners.get(id)
  }
  const detail = async (id, personaId) => {
    find(id, personaId)
    const state = await simulations.read(id)
    return { ...state, boundPersonaId: personaId, capturedActions: state.captures,
      stages: state.loops.flatMap(loop => (loop.stages || []).map(stage => ({ loopId: loop.id, ...stage }))) }
  }
  return {
    async handle(action, input) {
      let requestId = `req_${randomUUID()}`
      const envelope = value => sandboxChatEnvelope(value, requestId)
      try {
        if (now() - windowAt >= 60000) { windowAt = now(); requests = 0 }
        if (++requests > SANDBOX_CHAT_LIMITS.requestsPerMinute || pending >= SANDBOX_CHAT_LIMITS.pending) fail('SIMULATION_RATE_LIMIT')
        const personaId = owner()
        const keys = { create: ['requestId', 'typing', 'reminders'], event: ['requestId', 'id', 'event'], advance: ['requestId', 'id', 'ms'],
          reset: ['requestId', 'id'], delete: ['requestId', 'id'], detail: ['id'], list: [] }
        if (!Object.hasOwn(keys, action)) fail('INVALID_SIMULATION_INPUT')
        fields(input, keys[action])
        if (!['detail', 'list'].includes(action)) {
          if (typeof input.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(input.requestId)) fail('INVALID_SIMULATION_INPUT')
          requestId = input.requestId
        }
        if (action === 'create') {
          for (const key of ['typing', 'reminders']) if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('INVALID_SIMULATION_INPUT')
        } else if (action !== 'list') find(input.id, personaId)
        if (action === 'event') {
          fields(input.event, ['kind', 'chatType', 'text', 'addressed', 'type'])
        }
        if (action === 'advance' && (!Number.isSafeInteger(input.ms) || input.ms < 0 || input.ms > 86400000)) fail('INVALID_ADVANCE')
        // Serialize ownership checks and service calls together, including queued reads.
        pending++
        const work = queue.then(async () => {
          if (!matchesOwner(personaId)) fail('SIMULATION_NOT_FOUND')
          if (action === 'list') return { ok: true, items: [...owners].filter(([, row]) => row.personaId === personaId).map(([id]) => ({ id })) }
          if (action === 'create') {
            const created = await simulations.create({ typing: input.typing ?? true, reminders: input.reminders ?? true })
            if (!matchesOwner(personaId)) { await simulations.delete(created.id); fail('SIMULATION_NOT_FOUND') }
            owners.set(created.id, { personaId, operations: 0 })
            return detail(created.id, personaId)
          }
          const session = find(input.id, personaId)
          if (!['detail', 'reset', 'delete'].includes(action) && session.operations >= SANDBOX_CHAT_LIMITS.operations) fail('SIMULATION_OPERATION_LIMIT')
          if (action === 'event') {
            const receipt = await simulations.submit(input.id, { ...input.event, requestId })
            session.operations++
            return { ...await detail(input.id, personaId), receipt }
          }
          if (action === 'advance') {
            const timer = await simulations.advance(input.id, input.ms)
            session.operations++
            return { ...await detail(input.id, personaId), timer }
          }
          if (action === 'reset') { await simulations.reset(input.id); session.operations = 0 }
          if (action === 'delete') {
            await simulations.delete(input.id); owners.delete(input.id)
            return { ok: true, id: input.id, deleted: true }
          }
          return detail(input.id, personaId)
        }).then(result => {
          if (!matchesOwner(personaId)) fail('SIMULATION_NOT_FOUND')
          return { ...result, boundPersonaId: personaId }
        })
        queue = work.catch(() => {})
        try { return { status: 200, body: envelope(await work) } } finally { pending-- }
      } catch (error) {
        const message = String(error?.message || '')
        const code = /^(INVALID_SIMULATION_INPUT|INVALID_ADVANCE|SIMULATION_(NOT_FOUND|RATE_LIMIT|SESSION_LIMIT|OPERATION_LIMIT|REQUEST_CONFLICT|TIMER_LIMIT|UNAVAILABLE))$/.test(message) ? message : 'SIMULATION_UNAVAILABLE'
        const status = code === 'SIMULATION_NOT_FOUND' ? 404 : /_LIMIT$/.test(code) ? 429 : code === 'SIMULATION_REQUEST_CONFLICT' ? 409 : code === 'SIMULATION_UNAVAILABLE' ? 503 : 400
        return { status, body: envelope({ ok: false, code, message: code }) }
      }
    },
  }
}
