// 原始事件入站编排；各服务继续拥有访问、规范化、过滤与认知语义。
export function createIngressCoordinator({ access, cognition, events, modules, ctx, normalizeEvent, getConfig, logger, clock = { now: Date.now } }) {
  const counts = { received: 0, admitted: 0, rejected: 0, filtered: 0, unrecognized: 0, errors: 0, firstAt: null, lastAt: null }
  const rejectedReasons = { private_not_allowed: 0, group_not_allowed: 0, other: 0 }
  const filteredReasons = { disabled: 0, kind: 0, subType: 0, ignoreUser: 0, ignoreGroup: 0, self: 0, invalid: 0, other: 0 }
  const reasonCount = (counts, reason) => { const key = Object.hasOwn(counts, reason) ? reason : 'other'; counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + 1) }
  function handleRaw(raw) {
    counts.received += 1
    let at = null
    try { at = clock.now() } catch {}
    counts.firstAt ??= at
    counts.lastAt = at
    // 仅在本次调用中保留引用，不扩展规范化事件或对外广播的 record。
    const envelope = {
      version: 1,
      platform: 'onebot',
      raw,
      normalized: null,
      accepted: false,
      reason: '',
      correlationId: '',
    }
    const result = () => ({ accepted: envelope.accepted, reason: envelope.reason, correlationId: envelope.correlationId })

    try {
      // 访问控制先于一切：被拒绝的消息不落 raw、不聚合、不回复。
      const gate = access.decideRaw(raw)
      if (!gate.allowed) {
        counts.rejected += 1
        reasonCount(rejectedReasons, gate.reason)
        envelope.reason = gate.reason || ''
        logger.debug(`访问拒绝：${gate.chatType || '?'}:${gate.chatId || '?'}/${gate.senderId || '?'}（${gate.reason}）`)
        return result()
      }
      // 过滤前先交给认知：原始事件不能因为过滤规则丢失。
      try { cognition.ingestRaw(raw) } catch (error) { logger.warn('认知 raw 事件失败：', error.message) }
      const normalized = normalizeEvent(raw, getConfig())
      if (!normalized) {
        counts.unrecognized += 1
        envelope.reason = 'unrecognized'
        return result()
      }
      envelope.normalized = normalized
      const id = normalized.message?.id ?? normalized.notice?.messageId ?? normalized.notice?.flag ?? normalized.request?.flag ?? ''
      envelope.correlationId = typeof id === 'string' || typeof id === 'number' ? id : ''
      const pushed = events.push(normalized)
      counts[pushed.accepted ? 'admitted' : 'filtered'] += 1
      envelope.accepted = pushed.accepted
      envelope.reason = pushed.reason || ''
      try { cognition.observe(pushed.record || normalized, { accepted: pushed.accepted, reason: pushed.reason || '' }) } catch (error) { logger.warn('认知 observe 失败：', error.message) }
      if (!pushed.accepted) {
        reasonCount(filteredReasons, pushed.reason)
        logger.debug(`事件被过滤：${pushed.reason}`)
        return result()
      }
      // 模块事件与宿主广播并行；模块异常由 kernel 隔离，不能阻塞 OneBot 事件循环。
      modules.dispatch(pushed.record).catch((error) => logger.warn('模块事件分发失败：', error.message))
      try {
        ctx.emit?.('onebot-qq/event', pushed.record)
      } catch (error) {
        logger.warn('广播 onebot-qq/event 失败：', error.message)
      }
    } catch (error) {
      counts.errors += 1
      logger.warn('处理 OneBot 事件失败：', error.message)
      if (!envelope.accepted) envelope.reason ||= 'error'
    }
    return result()
  }

  return { handleRaw, stats: () => ({ ...counts, rejectedReasons: { ...rejectedReasons }, filteredReasons: { ...filteredReasons } }) }
}
