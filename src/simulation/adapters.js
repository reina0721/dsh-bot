import { createActions } from '../gateway/actions.js'

const copy = value => structuredClone(value)
const KNOWN = new Set([
  'send_private_msg', 'send_group_msg', 'upload_group_file', 'upload_private_file',
  'set_input_status', 'set_friend_add_request', 'set_group_add_request', 'send_like',
  'group_poke', 'friend_poke', 'set_msg_emoji_like', 'set_qq_profile', 'set_group_card',
  'set_group_name', 'set_group_admin', 'set_group_ban', 'set_group_whole_ban', 'set_group_kick',
  'set_essence_msg', 'delete_msg', 'get_msg', 'get_forward_msg', 'get_login_info',
  'get_friend_list', 'get_group_list', 'get_group_info', 'get_group_member_info', 'get_status', 'get_version_info',
])

// No socket/client/fetch capability exists in this transport, including its fallback paths.
export function createCapturingTransport({ clock, namespace = 'simulation' } = {}) {
  const captures = []
  let closed = false
  async function capture(action, params = {}, blocked = false) {
    const row = { environment: 'simulation', id: `${namespace}:action:${captures.length + 1}`, at: clock.now(),
      action, params: copy(params), status: blocked || closed ? 'blocked' : 'captured', realSend: false }
    captures.push(row)
    if (blocked || closed) throw Object.assign(new Error('SIMULATION_ACTION_BLOCKED'), { code: 'SIMULATION_ACTION_BLOCKED' })
    if (action.startsWith('send_') && action.endsWith('_msg')) return { message_id: String(captures.length), environment: 'simulation', captured: true }
    if (['get_friend_list', 'get_group_list'].includes(action)) return []
    return { environment: 'simulation', captured: true }
  }
  const call = (action, params) => capture(action, params, !KNOWN.has(action))
  const methods = createActions({ call })
  methods.raw = (action, params = {}) => capture(`raw:${action}`, params, true)
  const actions = new Proxy(methods, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return Reflect.get(target, key)
      if (typeof key !== 'string' || key === 'then') return undefined
      return (...args) => capture(`unknown:${key}`, { args }, true)
    },
  })
  return { actions, call, captures: () => copy(captures), close() { closed = true } }
}

export function createFixtureModel({ reply = '这是一条离线模拟回复。', analysis = {} } = {}) {
  const fixture = copy({ reply, analysis })
  const calls = []
  return {
    selected: () => ({ resolved: true, available: true, provider: 'fixture', model: 'offline' }),
    fallback: () => [], list: () => ({ providers: [{ id: 'fixture' }] }),
    async complete(input) {
      calls.push(copy(input))
      return { text: input.purpose === 'analysis' ? JSON.stringify(fixture.analysis) : fixture.reply,
        route: { provider: 'fixture', model: 'offline' }, usage: { total: 1 }, finish: { kind: 'stop' } }
    },
    calls: () => copy(calls), dispose() {},
  }
}

export function createFixtureSources(fixtures = []) {
  const pages = copy(fixtures)
  const source = {
    id: 'fixture', label: 'Offline fixture', reliability: 1,
    async search(query, { maxResults = 4 } = {}) {
      return copy(pages.filter(page => `${page.title} ${page.text}`.includes(String(query))).slice(0, maxResults)
        .map(page => ({ title: page.title, url: page.url, snippet: page.text })))
    },
    async fetch(url) { return copy(pages.find(page => page.url === url) || null) },
  }
  return { list: () => [source], get: id => id === 'fixture' ? source : null }
}

export function createFixtureRuntime({ namespace, models }) {
  const sessions = new Map()
  return {
    active: () => true, available: () => true, engine: () => 'fixture',
    async compose({ turn, system, user }) {
      const key = `${turn.chatType}:${turn.chatId}`
      if (!sessions.has(key)) sessions.set(key, `${namespace}:session:${sessions.size + 1}`)
      const result = await models.complete({ system, messages: [{ role: 'user', content: user }], purpose: 'compose' })
      return { ok: true, text: result.text, sessionId: sessions.get(key), environment: 'simulation' }
    },
    steer: async () => ({ ok: false, error: 'SIMULATION_STEER_UNAVAILABLE' }),
    summary: () => ({ engine: 'fixture', active: true, sessions: sessions.size, environment: 'simulation' }),
    sessions: () => [...sessions].map(([key, sessionId]) => ({ key, sessionId })),
    dispose() { sessions.clear() },
  }
}

// Async fixture work can schedule further virtual jobs. Drain microtasks between deadlines,
// without awaiting callbacks that themselves wait for a future virtual timer.
export function createVirtualScheduler(start = Date.UTC(2026, 0, 1)) {
  let current = start
  let sequence = 0
  let closed = false
  const jobs = new Map()
  const errors = []
  const sleepers = new Map()
  const settle = () => new Promise(resolve => setImmediate(resolve))
  return {
    now: () => current,
    setTimeout(fn, ms) {
      if (closed) throw new Error('SIMULATION_DISPOSED')
      const id = ++sequence
      jobs.set(id, { at: current + Math.max(0, Number(ms) || 0), fn })
      return id
    },
    clearTimeout(id) { jobs.delete(id) },
    sleep(ms) {
      if (closed) return Promise.resolve()
      return new Promise(resolve => {
        const id = ++sequence
        sleepers.set(id, resolve)
        jobs.set(id, { at: current + Math.max(0, Number(ms) || 0), fn: () => { sleepers.delete(id); resolve() } })
      })
    },
    async advance(ms) {
      if (closed) throw new Error('SIMULATION_DISPOSED')
      if (!Number.isSafeInteger(ms) || ms < 0 || ms > 86400000) throw new Error('INVALID_ADVANCE')
      const target = current + ms
      await settle()
      for (let count = 0; ; count++) {
        const due = [...jobs].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!due) break
        if (count >= 10000) throw new Error('SIMULATION_TIMER_LIMIT')
        jobs.delete(due[0]); current = due[1].at
        try { Promise.resolve(due[1].fn()).catch(error => errors.push(String(error.message))) }
        catch (error) { errors.push(String(error.message)) }
        await settle()
      }
      current = target
      await settle()
      return { now: current, pending: jobs.size, errors: [...errors] }
    },
    dispose() { closed = true; jobs.clear(); for (const resolve of sleepers.values()) resolve(); sleepers.clear() },
  }
}
