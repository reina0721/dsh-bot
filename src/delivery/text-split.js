// 回复分条：把一条长回复切成多条 QQ 消息，避免刷屏式长文。
//
// 规则：
//   - 短于 maxChars 不切；
//   - 优先在段落/换行/句末标点处切，实在找不到才硬切；
//   - 最多 maxParts 条，剩余内容并入最后一条（不丢内容）；
//   - 纯函数，不依赖配置/网络。

const HARD_MIN_RATIO = 0.45

function cutIndex(text, maxChars) {
  const min = Math.max(1, Math.floor(maxChars * HARD_MIN_RATIO))
  const window = text.slice(0, maxChars)
  const candidates = [
    window.lastIndexOf('\n\n'),
    window.lastIndexOf('\n'),
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('!'),
    window.lastIndexOf('?'),
    window.lastIndexOf('；'),
    window.lastIndexOf(';'),
    window.lastIndexOf('，'),
    window.lastIndexOf(','),
    window.lastIndexOf(' '),
  ].filter((index) => index >= min)
  if (candidates.length) return Math.max(...candidates) + 1
  return Math.max(min, Math.min(maxChars, text.length))
}

/**
 * @param {string} text
 * @param {{maxChars?:number,maxParts?:number}} [options]
 * @returns {string[]}
 */
export function splitReply(text, { maxChars = 300, maxParts = 3 } = {}) {
  const value = String(text || '').trim()
  if (!value) return []
  const limit = Math.max(40, Math.min(2000, Math.round(Number(maxChars) || 300)))
  const partsLimit = Math.max(1, Math.min(10, Math.round(Number(maxParts) || 3)))
  if (value.length <= limit || partsLimit === 1) return [value]

  const parts = []
  let rest = value
  while (rest && parts.length < partsLimit) {
    if (rest.length <= limit) {
      parts.push(rest)
      rest = ''
      break
    }
    const cut = cutIndex(rest, limit)
    const head = rest.slice(0, cut).trim()
    if (head) parts.push(head)
    rest = rest.slice(cut).trim()
  }
  if (rest) {
    const last = parts.length - 1
    parts[last] = `${parts[last]}${rest}`.trim()
  }
  return parts.filter(Boolean)
}
