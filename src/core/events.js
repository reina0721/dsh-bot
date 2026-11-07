// 规范化事件缓冲：过滤 + 环形缓冲 + 统计 + 可选 JSONL 落盘。
//
// 事件是后续认知/记忆/防抖插件的输入，因此这里保持「只追加、不推断」：
// 平台给什么就存什么，过滤规则全部来自配置（config.events.*），没有任何写死的业务判断。

import { join } from 'node:path'
import { dataDir, appendJsonl } from './store.js'

const MAX_BUFFER = 5000

/**
 * @param {object} o
 * @param {() => object} o.getConfig
 * @param {import('./logger.js').createLogger extends Function ? object : object} [o.log]
 */
export function createEventStore({ getConfig, log, dataRoot = null, clock = { now: () => Date.now() } } = {}) {
  const state = {
    buffer: [],
    seq: 0,
    received: 0,
    accepted: 0,
    dropped: 0,
    byKind: { message: 0, notice: 0, request: 0, meta_event: 0, unknown: 0 },
    byChat: { private: 0, group: 0, other: 0 },
    lastAt: 0,
    lastSeq: 0,
    droppedReasons: { disabled: 0, kind: 0, subType: 0, ignoreUser: 0, ignoreGroup: 0, self: 0, invalid: 0 },
  }

  const cfg = () => {
    try {
      return (getConfig && getConfig()) || {}
    } catch (error) {
      return {}
    }
  }

  /** 依据配置判断是否接受该事件；返回 null 表示接受，否则返回丢弃原因。 */
  function rejectReason(event) {
    const c = cfg()
    const e = c.events || {}
    if (!e.enabled) return 'disabled'
    if (!event || typeof event !== 'object') return 'invalid'
    if (typeof event.seqless !== 'boolean') return 'invalid'
    const kind = String(event.kind || 'unknown')
    if (e.kinds && Object.prototype.hasOwnProperty.call(e.kinds, kind) && e.kinds[kind] === false) return 'kind'
    if (kind === 'message') {
      const chatType = event.message?.chatType
      if (chatType === 'private' && e.messageSubTypes?.private === false) return 'subType'
      if (chatType === 'group' && e.messageSubTypes?.group === false) return 'subType'
    }
    // 机器人自己发的消息：群聊事件里发送者等于自己
    if (kind === 'message' && e.includeSelfMessages === false && isSelfMessage(event)) return 'self'
    const userId = String(event.message?.sender?.userId ?? event.notice?.userId ?? '')
    const groupId = String(event.message?.chatType === 'group' ? event.message?.chatId : event.notice?.groupId ?? '')
    if (userId && (e.ignoreUsers || []).includes(userId)) return 'ignoreUser'
    if (groupId && (e.ignoreGroups || []).includes(groupId)) return 'ignoreGroup'
    return null
  }

  function isSelfMessage(event) {
    if (event.postType === 'message_sent') return true
    const selfId = String(event.selfId || '')
    const senderId = String(event.message?.sender?.userId ?? '')
    return Boolean(selfId && senderId && selfId === senderId)
  }

  function capacity() {
    const size = Number(cfg().events?.bufferSize) || 200
    return Math.max(10, Math.min(MAX_BUFFER, size))
  }

  function push(normalized) {
    state.received += 1
    const reason = rejectReason(normalized)
    if (reason) {
      state.dropped += 1
      state.droppedReasons[reason] = (state.droppedReasons[reason] || 0) + 1
      return { accepted: false, reason }
    }
    const record = {
      seq: ++state.seq,
      receivedAt: clock.now(),
      ...normalized,
    }
    state.accepted += 1
    state.lastAt = record.receivedAt
    state.lastSeq = record.seq
    const kind = String(record.kind || 'unknown')
    state.byKind[kind] = (state.byKind[kind] || 0) + 1
    const chatType = record.message?.chatType || (kind === 'message' ? 'other' : 'other')
    state.byChat[chatType] = (state.byChat[chatType] || 0) + 1

    state.buffer.push(record)
    const cap = capacity()
    while (state.buffer.length > cap) state.buffer.shift()

    const persist = cfg().events?.persist
    if (persist?.enabled) {
      try {
        appendJsonl(dataRoot ? join(dataRoot, 'events.jsonl') : dataDir(persist.file || 'events.jsonl'), record, { maxBytes: (Number(persist.maxMB) || 32) * 1024 * 1024 })
      } catch (error) {
        log?.warn?.('事件落盘失败：', error.message)
      }
    }
    return { accepted: true, record }
  }

  /** 增量拉取：返回 seq > since 的最新 limit 条（升序）。 */
  function list({ since = 0, limit = 50 } = {}) {
    const floor = Number(since) || 0
    const cap = Math.max(1, Math.min(2000, Number(limit) || 50))
    const items = state.buffer.filter((item) => item.seq > floor).slice(-cap)
    return { items, nextSince: items.length ? items[items.length - 1].seq : floor }
  }

  function recent(limit = 20) {
    return state.buffer.slice(-Math.max(1, Math.min(500, Number(limit) || 20)))
  }

  function clear() {
    state.buffer.length = 0
    state.dropped = 0
    state.accepted = 0
    state.received = 0
    state.byKind = { message: 0, notice: 0, request: 0, meta_event: 0, unknown: 0 }
    state.byChat = { private: 0, group: 0, other: 0 }
    state.droppedReasons = { disabled: 0, kind: 0, subType: 0, ignoreUser: 0, ignoreGroup: 0, self: 0, invalid: 0 }
    return { ok: true }
  }

  function stats() {
    return {
      received: state.received,
      accepted: state.accepted,
      dropped: state.dropped,
      droppedReasons: { ...state.droppedReasons },
      byKind: { ...state.byKind },
      byChat: { ...state.byChat },
      buffered: state.buffer.length,
      capacity: capacity(),
      lastAt: state.lastAt,
      lastSeq: state.lastSeq,
    }
  }

  return { push, list, recent, clear, stats, dispose() {} }
}
