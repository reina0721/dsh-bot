import { observeLoop, deliveryObservation } from '../observability/loop.js'
import { buildFallbackPlan, validateDeliveryPlan } from './plan.js'

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * plan may be a value or a synchronous builder so planner exceptions can recover
 * before any I/O. text/turn/source/decisionId provide trusted fallback context.
 * fallbackDeliver is the legacy transport when deliver is unavailable, never a
 * retry after an outbound rejection. Callbacks receive zero-based index and the
 * planned total; only real successful sends invoke onPartSent.
 * Result parts counts real sends; failedPart is zero-based. Partial failures
 * retain ok:true for compatibility and never retry or roll back prior sends.
 */
export async function executeDeliveryPlan({
  plan, deliver, fallbackDeliver = null, sleep = defaultSleep, onPartSent, onPartFailed, onPlanFallback,
  text = '', turn, source = 'pipeline', decisionId = '', dryRun = null,
  observer = null, loop = null, moduleId = null, runtimeGeneration = null, preflightResult = null,
}) {
  const attempt = observeLoop(observer, 'beginDelivery', loop, { decisionId, moduleId, runtimeGeneration })
  const finish = result => { observeLoop(observer, 'finishDelivery', attempt, deliveryObservation(result)); return result }
  try {
    if (preflightResult) return finish(preflightResult)
    let resolved
    try {
      resolved = typeof plan === 'function' ? plan() : plan
      if (!validateDeliveryPlan(resolved)) resolved = null
    } catch {
      resolved = null
    }
    if (!resolved) {
      onPlanFallback?.()
      resolved = buildFallbackPlan({ text, turn, source, decisionId })
      if (!validateDeliveryPlan(resolved)) return finish({ ok: false, status: 'empty', error: 'EMPTY_MESSAGE', parts: 0 })
    }
    const send = typeof deliver === 'function' ? deliver : fallbackDeliver
    let firstMessageId = ''
    let sentParts = 0
    let lastResult = null
    let outcome = { status: 'sent' }
    for (let index = 0; index < resolved.parts.length; index += 1) {
      const part = resolved.parts[index]
      const delivered = typeof send === 'function' ? await send({
        ...(observer ? { deliveryOwner: true, deliveryAttempt: attempt } : {}),
        chatType: resolved.target.chatType,
        chatId: resolved.target.chatId,
        segments: part.segments,
        decisionId: index === 0 ? resolved.decisionId : '',
        source: resolved.source,
        dryRun: typeof dryRun === 'function' ? dryRun() : dryRun,
      }) : { ok: false, error: 'GATEWAY_UNAVAILABLE' }
      if (!delivered?.ok) {
        onPartFailed?.({ delivered, index, parts: resolved.parts.length })
        if (!sentParts) return finish({ ok: false, status: 'failed', error: delivered?.error || 'SEND_FAILED', blocked: Boolean(delivered?.blocked), reason: delivered?.reason || '', parts: 0 })
        outcome = { status: 'partial', partial: true, sentParts, failedPart: index, error: 'PARTIAL_SEND' }
        break
      }
      if (delivered.dryRun) {
        if (index === 0) return finish({ ok: true, status: 'dry_run', dryRun: true, messageId: '', parts: 0 })
        outcome = { status: 'dry_run' }
        break
      }
      const messageId = String(delivered.messageId || '')
      if (!firstMessageId) firstMessageId = messageId
      lastResult = delivered.result
      sentParts += 1
      onPartSent?.({ messageId, index, parts: resolved.parts.length })
      if (index < resolved.parts.length - 1 && part.delayAfterMs) await sleep(part.delayAfterMs)
    }
    return finish({ ok: true, ...outcome, messageId: firstMessageId, result: lastResult, parts: sentParts })
  } catch (error) {
    observeLoop(observer, 'finishDelivery', attempt, null, { threw: true })
    throw error
  }
}
