import { parseBubbles } from './bubble.js'

// Compatibility facade for the core rollback path and Phase 1 callers.
export { buildReplyPlan } from './reply-plan.js'

/** Boolean validation deliberately contains no payloads or diagnostic secrets. */
export function validateDeliveryPlan(plan) {
  if (!plan || !['private', 'group'].includes(plan.target?.chatType)) return false
  const id = plan.target.chatId
  if (!['string', 'number'].includes(typeof id) || !String(id).trim() || (typeof id === 'number' && !Number.isFinite(id))) return false
  if (!Array.isArray(plan.parts) || !plan.parts.length || plan.parts.length > 10) return false
  return plan.parts.every((part) => part && Array.isArray(part.segments) && part.segments.length > 0
    && part.segments.every((segment) => segment && typeof segment.type === 'string' && segment.type.length > 0
      && segment.data && typeof segment.data === 'object' && !Array.isArray(segment.data)
      && (segment.type !== 'text' || (typeof segment.data.text === 'string' && segment.data.text.length > 0)))
    && typeof part.delayAfterMs === 'number' && Number.isFinite(part.delayAfterMs) && part.delayAfterMs >= 0)
}

/** Recovery is one text-only message, through the same outbound guards. */
export function buildFallbackPlan({ text, turn, decision, source = 'pipeline', decisionId = '' }) {
  const texts = parseBubbles(text, { split: false })
  return {
    source,
    decisionId: decisionId || decision?.id || '',
    target: { chatType: turn?.chatType, chatId: turn?.chatId },
    parts: texts.map(value => ({ segments: [{ type: 'text', data: { text: value } }], delayAfterMs: 0 })),
    meta: { planner: 'core', fallback: true },
  }
}
