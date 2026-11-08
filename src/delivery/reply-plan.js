import { parseBubbles } from './bubble.js'

/** Pure reply layout; no configuration reads, policy checks or delivery I/O. */
export function buildReplyPlan({ text, turn, decision, replyCfg = {}, replyTo = '', source = 'pipeline', decisionId = '' }) {
  const texts = parseBubbles(text, replyCfg)
  const quoteId = replyTo || turn?.messages?.at(-1)?.messageId
  const delayMs = Math.max(0, Number(replyCfg.delayMs) || 0)
  return {
    source,
    decisionId: decisionId || decision?.id || '',
    target: { chatType: turn?.chatType, chatId: turn?.chatId },
    parts: texts.map((value, index) => {
      const segments = []
      if (index === 0 && replyCfg.quote !== false && quoteId) segments.push({ type: 'reply', data: { id: quoteId } })
      if (index === 0 && turn?.chatType === 'group' && replyCfg.atSender === true && turn.senderId) segments.push({ type: 'at', data: { qq: String(turn.senderId) } })
      segments.push({ type: 'text', data: { text: value } })
      return { segments, delayAfterMs: index < texts.length - 1 ? delayMs : 0 }
    }),
    meta: { planner: 'core', fallback: false },
  }
}
