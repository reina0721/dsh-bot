import { executeDeliveryPlan } from './executor.js'
import { validateDeliveryPlan } from './plan.js'

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Single-part automatic intents share the executor and outbound guards. */
export function createDeliveryService({ outbound, sleep = defaultSleep, observer = outbound?.loopObserver } = {}) {
  async function deliver({ chatType, chatId, segments, text = '', source = 'pipeline', decisionId = '', dryRun = null, decisionPolicy, loop = null, moduleId = null, runtimeGeneration = null } = {}) {
    const reject = preflightResult => executeDeliveryPlan({ observer, loop, decisionId, moduleId, runtimeGeneration, preflightResult })
    if (!['private', 'group'].includes(chatType) || !String(chatId ?? '').trim()) return reject({ ok: false, status: 'failed', error: 'INVALID_TARGET', parts: 0 })
    const body = segments !== undefined ? segments
      : typeof text === 'string' && text.trim() ? [{ type: 'text', data: { text } }] : []
    const plan = {
      target: { chatType, chatId }, source, decisionId,
      parts: [{ segments: body, delayAfterMs: 0 }],
    }
    if (!validateDeliveryPlan(plan)) return reject({ ok: false, status: 'empty', error: 'EMPTY_MESSAGE', parts: 0 })
    if (typeof outbound?.deliver !== 'function') return reject({ ok: false, status: 'failed', error: 'OUTBOUND_UNAVAILABLE', parts: 0 })

    let outboundResult
    const result = await executeDeliveryPlan({
      plan, sleep, dryRun, observer, loop, decisionId, moduleId, runtimeGeneration,
      deliver: async (intent) => {
        outboundResult = await outbound.deliver({ ...intent, ...(decisionPolicy ? { decisionPolicy } : {}) })
        return outboundResult
      },
    })
    return { ...outboundResult, ...result }
  }

  return { deliver }
}
