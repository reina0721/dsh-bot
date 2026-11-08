/**
 * Proposed real-model preview interface, NOT an installed adapter or live gate.
 * Authorization must be derived by an authenticated administrator adapter, never
 * from a request's role/approved field. Consent is single-request and cannot be
 * inherited by events, virtual timers, retries, reset or session creation.
 *
 * @typedef {object} RealModelPreviewRequest
 * @property {string} requestId Unique request within the bound preview generation.
 * @property {string} sessionId Server-owned simulation session, bound to persona.
 * @property {number} generation Reject stale/reset/persona-switched requests.
 * @property {string} modelId Administrator-allowlisted model, no URL/credentials.
 * @property {string} prompt Explicit, bounded preview text.
 * @property {number} maxOutputTokens Bounded by the administrator's preview budget.
 *
 * @typedef {object} RealModelPreviewUsage
 * @property {'preview'} scope Separate ledger; never charge live or fixture usage.
 * @property {string} requestId Includes failed/cancelled attempts and provider usage.
 * @property {number} inputTokens
 * @property {number} outputTokens
 *
 * @typedef {object} RealModelPreviewAdapter
 * @property {function(RealModelPreviewRequest, { signal: AbortSignal }): Promise<{text: string, usage: RealModelPreviewUsage}>} preview
 * Must check trusted per-request consent, reserve a separate budget before I/O,
 * bound timeout/output, account late/cancelled responses, and use capture-only
 * actions with no gateway/tools/live store. No automatic invocation or fallback.
 */

export const REAL_MODEL_PREVIEW_STATUS = Object.freeze({
  available: false, reason: 'REAL_MODEL_PREVIEW_UNAVAILABLE', implementation: 'contract-only',
})
