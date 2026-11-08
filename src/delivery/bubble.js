import { splitReply } from './text-split.js'

const HARD_LIMIT = 2000
// Recognize only the protocol's name, including incomplete markers. Ordinary
// markup (and words such as <bubblegum>) belongs to the reply and is preserved.
const MARKER = /<\s*(\/?)\s*bubble\b(?:[^<>]*>|\s*)/gi

/** Pure model bubble protocol parser. Length never determines normal pacing. */
export function parseBubbles(text, { split = true, maxParts = 3, maxChars = HARD_LIMIT } = {}) {
  const value = String(text ?? '')
  const parts = []
  let buffer = '', cursor = 0, opened = false, tagged = false, malformed = false
  const flush = () => { if (buffer.trim()) parts.push(buffer.trim()); buffer = '' }
  for (const marker of value.matchAll(MARKER)) {
    const between = value.slice(cursor, marker.index)
    if (!opened && between.trim()) malformed = true
    buffer += between
    tagged = true
    if (!/^<\s*\/?\s*bubble\s*>$/i.test(marker[0])) malformed = true
    if (marker[1]) {
      if (!opened) malformed = true
      opened = false
    } else {
      if (opened) malformed = true
      flush()
      opened = true
    }
    cursor = marker.index + marker[0].length
  }
  const tail = value.slice(cursor)
  if (opened || (tagged && tail.trim())) malformed = true
  buffer += tail
  flush()
  if (split === false) return parts.length ? [parts.join('\n')] : []

  const cap = Math.max(1, Math.min(10, Math.round(Number(maxParts) || 3)))
  // The legacy target is used only for missing/broken protocol over 2000 chars.
  // Valid tagged bubbles use the hard limit, regardless of maxChars.
  const safetyTarget = !tagged || malformed ? maxChars : HARD_LIMIT
  const safe = parts.flatMap(part => part.length > HARD_LIMIT
    ? splitReply(part, { maxChars: safetyTarget, maxParts: cap }) : [part])
  if (safe.length <= cap) return safe
  return [...safe.slice(0, cap - 1), safe.slice(cap - 1).join('\n')]
}
