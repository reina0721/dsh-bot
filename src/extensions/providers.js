// Internal composition slots. Only the host/module kernel may expose registration.
const ALLOWED_NAMES = new Set(['reminders', 'mediaFeatures', 'proactivity', 'learning'])

export function createProviderRegistry({ logger } = {}) {
  const registrations = new Map()
  const listeners = new Set()
  function notify({ name, moduleId }) {
    for (const listener of [...listeners]) {
      try { Promise.resolve(listener(Object.freeze({ name, moduleId }))).catch(() => {}) } catch {}
    }
  }
  function subscribe(listener) {
    if (typeof listener !== 'function') throw new Error('provider listener 必须是函数')
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  function register(name, provider, { moduleId, source = 'builtin' } = {}) {
    if (!ALLOWED_NAMES.has(name)) throw new Error('未知 provider 名称')
    if (source !== 'builtin') throw new Error('provider 仅允许内置模块注册')
    if (typeof moduleId !== 'string' || !moduleId.trim()) throw new Error('provider 需要 moduleId')
    if (name === 'learning' && moduleId !== 'builtin-learning') throw new Error('learning 仅允许 builtin-learning 注册')
    if (name === 'learning' && ['runPending', 'cancel', 'retry', 'stats'].some(key => typeof provider?.[key] !== 'function')) throw new Error('learning 需要 runPending/cancel/retry/stats 函数')
    if (name === 'proactivity' && moduleId !== 'builtin-proactivity') throw new Error('proactivity 仅允许 builtin-proactivity 注册')
    if (name === 'proactivity' && (typeof provider?.tick !== 'function' || typeof provider?.stats !== 'function')) throw new Error('proactivity 需要 tick/stats 函数')
    if (name === 'mediaFeatures' && moduleId !== 'builtin-media-features') throw new Error('mediaFeatures 仅允许 builtin-media-features 注册')
    if (name === 'mediaFeatures' && (typeof provider?.authorizeStickers !== 'function' || !provider?.bilibili)) throw new Error('mediaFeatures 需要功能端口')
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)
      || typeof provider.start !== 'function' || typeof provider.stop !== 'function'
      || (provider.status !== undefined && typeof provider.status !== 'function')) {
      throw new Error('provider 需要 start/stop 函数，status 必须是函数')
    }
    if (registrations.has(name)) throw new Error('provider 名称已注册')
    if ([...registrations.values()].some((entry) => entry.moduleId === moduleId)) throw new Error('provider moduleId 已注册')
    const entry = { name, moduleId, source, provider }
    registrations.set(name, entry)
    notify(entry)
    // A stale disposer cannot remove a later registration in the same slot.
    return () => {
      if (registrations.get(name) === entry) { registrations.delete(name); notify(entry) }
    }
  }

  function get(name) { return registrations.get(name)?.provider || null }
  function list() {
    return [...registrations.values()].map(({ name, moduleId, source }) => ({ name, moduleId, source }))
  }
  function remove(moduleId) {
    for (const [name, entry] of registrations) {
      if (entry.moduleId === moduleId) { registrations.delete(name); notify(entry); return true }
    }
    return false
  }

  return Object.freeze({ register, get, list, remove, subscribe })
}
