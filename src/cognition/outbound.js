// 统一出站：认知侧所有自动消息（回复、撤回处理、主动行为）都从这里走。
//
// 顺序：访问闸门 → 频率上限 → 文本 leak guard（dryRun 也扫描）→ dryRun → 发送 → 归因/计数。
// 只做一次发送，不自动重试（OneBot 发送非幂等，重试可能重复发消息）。
// 面板手动 /send 是人工操作，不经过这里。

import { observeLoop, deliveryObservation } from '../observability/loop.js'
import { reasonText } from '../core/access.js'
import { createLeakGuard } from '../core/leak-guard.js'

function toSegments(message) {
  if (Array.isArray(message)) return message
  if (typeof message === 'string' && message.trim()) return [{ type: 'text', data: { text: message } }]
  return []
}

function messageIdOf(result) {
  return String(result?.message_id ?? result?.data?.message_id ?? result?.id ?? '')
}

/**
 * @param {object} o
 * @param {() => object} o.getConfig 完整插件配置
 * @param {{ actions?: { sendMessage?: Function } }} o.gateway
 * @param {{ canSend?: Function, markSent?: Function, markFailed?: Function }} [o.policy]
 * @param {ReturnType<import('../core/access.js').createAccess>} [o.access]
 * @param {object} [o.logger]
 * @param {() => number} [o.clock]
 */
export function createOutbound({ getConfig, gateway, policy = null, access = null, logger = null, clock = () => Date.now(), observer = null } = {}) {
  const now = () => (typeof clock === 'function' ? Number(clock()) : typeof clock?.now === 'function' ? Number(clock.now()) : Date.now())
  const state = {
    sent: 0,
    dryRuns: 0,
    blocked: 0,
    rateLimited: 0,
    leakBlocked: 0,
    failed: 0,
    lastError: '',
    lastAt: 0,
  }
  const cfg = () => {
    try {
      return (getConfig && getConfig()) || {}
    } catch (error) {
      return {}
    }
  }

  const leakGuard = createLeakGuard({ getConfig: cfg, logger })

  function finish(result) {
    state.lastAt = now()
    if (result?.error) state.lastError = String(result.error)
    return result
  }

  /**
   * @param {object} o
   * @param {'private'|'group'} o.chatType
   * @param {string|number} o.chatId
   * @param {string|Array} o.segments 消息段（或纯文本）
   * @param {string} [o.decisionId]
   * @param {string} [o.source]
   * @param {boolean|null} [o.dryRun] 显式覆盖；null/undefined 读 cognition.dryRun
   */
  async function deliverPart({ chatType, chatId, segments, decisionId = '', source = 'pipeline', dryRun = null, decisionPolicy = policy } = {}) {
    const type = chatType === 'group' ? 'group' : chatType === 'private' ? 'private' : ''
    const id = String(chatId ?? '').trim()
    if (!type || !id) return finish({ ok: false, error: 'INVALID_TARGET' })

    let body = toSegments(segments)
    if (!body.length) return finish({ ok: false, error: 'EMPTY_MESSAGE' })

    const gate = access?.canSend?.({ chatType: type, chatId: id })
    if (gate && !gate.allowed) {
      state.blocked += 1
      logger?.debug?.('出站被访问控制拒绝：', `${type}:${id}`, gate.reason)
      return finish({ ok: false, blocked: true, error: 'ACCESS_DENIED', reason: gate.reason })
    }

    if (policy && typeof policy.canSend === 'function') {
      const rate = policy.canSend(type, id)
      if (rate && rate.ok === false) {
        state.rateLimited += 1
        return finish({ ok: false, error: 'RATE_LIMITED', reason: rate.reason || 'rate_limited' })
      }
    }

    let guarded
    try {
      guarded = leakGuard.guard(body)
    } catch {
      // 畸形文本也不能绕过检查；异常内容不进入日志/返回值。
      guarded = { blocked: true }
    }
    if (guarded.blocked) {
      state.leakBlocked += 1
      return finish({ ok: false, error: 'LEAK_BLOCKED' })
    }
    body = guarded.segments
    const leakStatus = guarded.detections.length ? { leakGuard: 'redacted' } : {}
    const config = cfg()
    const isDry = dryRun === true || (dryRun == null && Boolean(config?.cognition?.dryRun))
    if (isDry) {
      try {
        if (decisionId) decisionPolicy?.markSent?.(decisionId, { dryRun: true })
      } catch (error) {}
      state.dryRuns += 1
      access?.noteDryRun?.()
      return finish({ ok: true, dryRun: true, messageId: '', ...leakStatus })
    }

    const actions = gateway?.actions
    if (!actions || typeof actions.sendMessage !== 'function') {
      return finish({ ok: false, error: 'GATEWAY_UNAVAILABLE', reason: 'gateway_unavailable' })
    }

    try {
      const result = await actions.sendMessage({ chatType: type, chatId: id, message: body })
      const messageId = messageIdOf(result)
      state.sent += 1
      access?.noteSent?.()
      try {
        if (decisionId) decisionPolicy?.markSent?.(decisionId, { messageId })
      } catch (error) {}
      return finish({ ok: true, messageId, result, source, ...leakStatus })
    } catch (error) {
      const message = 'send_failed' // 网关异常可能回显正文/密钥，不传播原始异常。
      state.failed += 1
      access?.noteFailed?.({ chatType: type, chatId: id, reason: 'send_failed' })
      try {
        if (decisionId) decisionPolicy?.markFailed?.(decisionId, message)
      } catch (inner) {}
      logger?.warn?.('出站发送失败：', `${type}:${id}`, message)
      return finish({ ok: false, error: 'SEND_FAILED', message, source })
    }
  }

  async function deliver(input = {}) {
    const owned = input.deliveryOwner === true
    const attempt = owned ? input.deliveryAttempt : observeLoop(observer, 'beginDelivery', input.loop || null, { decisionId: input.decisionId, moduleId: input.moduleId, runtimeGeneration: input.runtimeGeneration })
    try {
      const result = await deliverPart(input)
      if (!owned) observeLoop(observer, 'finishDelivery', attempt, deliveryObservation({
        status: result.dryRun ? 'dry_run' : result.ok ? 'sent' : result.error === 'EMPTY_MESSAGE' ? 'empty' : 'failed',
        parts: result.ok && !result.dryRun ? 1 : 0, error: result.error,
      }), { attemptedParts: 1 })
      return result
    } catch (error) {
      if (!owned) observeLoop(observer, 'finishDelivery', attempt, null, { threw: true, attemptedParts: 1 })
      throw error
    }
  }

  function stats() {
    return {
      ...state,
      lastErrorText: state.lastError ? reasonText('send_failed') : '',
    }
  }

  return { deliver, stats, loopObserver: observer }
}
