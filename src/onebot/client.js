// OneBot v11 客户端：HTTP 调接口、WS（Universal）收事件、断线自动重连。
// 移植/改写自 aureth-labs/dsh-aurabot-qq 的 src/onebot/client.js（MIT，见 THIRD_PARTY_NOTICES.md）：
//   - 重连退避/抖动、超时、重试全部由配置注入（不再写死常量）；
//   - 增加 HTTP token 的三种携带方式与连接统计；
//   - 只依赖 Node 自带的 fetch / WebSocket（Node >= 22）。
//
// 事件流与调用流的职责：
//   ws 只负责收事件 + 承载 echo 回包；有 HTTP 地址时调用优先走 HTTP，失败再退回 WS。

export class OneBotError extends Error {
  /**
   * @param {string} action
   * @param {object} data OneBot 返回体或 { message }
   * @param {{ transport?: boolean }} [options] transport=true 表示网络层失败（可重试）
   */
  constructor(action, data, { transport = false } = {}) {
    super(`${action} 失败：${data?.message || data?.wording || data?.retcode || '未知错误'}`)
    this.name = 'OneBotError'
    this.action = action
    this.data = data
    this.transport = transport
  }
}

const DEFAULT_RECONNECT = { enabled: true, minDelayMs: 2000, maxDelayMs: 30000, factor: 2, jitterRatio: 0.2 }
const DEFAULT_TIMEOUTS = { callMs: 30000, connectMs: 10000, verifyMs: 10000, probeMs: 3000, maxRetries: 3, retryDelaysMs: [1000, 3000, 5000] }

// A transport failure can occur after acceptance. Sends must never be replayed,
// including HTTP-to-WS fallback or an explicit retries option.
const isSend = action => action.startsWith('send_')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} o
 * @param {() => { httpUrl: string, wsUrl: string, httpToken: string, wsToken: string, httpAuth?: string }} o.endpoint 每次调用时现取端点
 * @param {(event: object) => void} o.onEvent WS 收到的 OneBot 事件
 * @param {(state: string, detail?: string) => void} [o.onState]
 * @param {{ info: Function, warn: Function, debug: Function }} o.log
 * @param {() => { reconnect?: object, timeouts?: object }} [o.options] 每次生效时现取（配置热更新）
 */
export function createOneBotClient({ endpoint, onEvent, onState, log, options }) {
  let ws = null
  let stopped = true
  let timer = null
  let backoff = 0
  let state = 'stopped'
  let echoSeq = 0
  const pending = new Map()
  const stats = {
    connects: 0,
    disconnects: 0,
    reconnects: 0,
    calls: 0,
    failures: 0,
    lastConnectedAt: 0,
    lastDisconnectAt: 0,
    lastError: '',
  }

  const opts = () => {
    try {
      const value = options ? options() : {}
      return {
        reconnect: { ...DEFAULT_RECONNECT, ...(value?.reconnect || {}) },
        timeouts: { ...DEFAULT_TIMEOUTS, ...(value?.timeouts || {}) },
      }
    } catch (error) {
      return { reconnect: { ...DEFAULT_RECONNECT }, timeouts: { ...DEFAULT_TIMEOUTS } }
    }
  }

  const setState = (next, detail) => {
    if (state === next) return
    state = next
    if (next === 'connected') {
      stats.connects += 1
      stats.lastConnectedAt = Date.now()
    }
    if (next === 'disconnected') {
      stats.disconnects += 1
      stats.lastDisconnectAt = Date.now()
    }
    try {
      onState?.(next, detail)
    } catch (error) {}
  }

  function describeNetError(error, ep) {
    const where = ep.httpUrl || ep.wsUrl || '(没配地址)'
    const why = error?.cause?.code || error?.cause?.message || error?.message || String(error)
    return `连不上 QQ 网关（${where}）：${why}`
  }

  function httpCall(action, params, timeoutMs) {
    const ep = endpoint()
    const ctrl = new AbortController()
    const timerId = setTimeout(() => ctrl.abort(), timeoutMs)
    const headers = { 'content-type': 'application/json' }
    const token = String(ep.httpToken || '')
    let url = `${ep.httpUrl.replace(/\/+$/, '')}/${action}`
    if (token) {
      if (ep.httpAuth === 'query') {
        url += (url.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(token)}`
      } else if (ep.httpAuth === 'header-token') {
        headers['x-access-token'] = token
      } else {
        headers.authorization = `Bearer ${token}`
      }
    }
    return fetch(url, { method: 'POST', headers, body: JSON.stringify(params || {}), signal: ctrl.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({ status: 'failed', retcode: response.status, message: `HTTP ${response.status}` }))
        if (body && (body.status === 'ok' || body.retcode === 0)) return body.data
        throw new OneBotError(action, body)
      })
      .catch((error) => {
        if (error instanceof OneBotError) throw error
        // 超时可能「已经发出去了只是没等到回执」，重试会重复发消息 —— 不重试
        if (error?.name === 'AbortError') throw new OneBotError(action, { message: `超时（${timeoutMs}ms）` })
        throw new OneBotError(action, { message: describeNetError(error, ep) }, { transport: true })
      })
      .finally(() => clearTimeout(timerId))
  }

  function callWs(action, params, timeoutMs) {
    if (!ws || ws.readyState !== 1) {
      return Promise.reject(new OneBotError(action, { message: '没连上 QQ 网关（WS）' }, { transport: true }))
    }
    const echo = `onebot-qq-${Date.now()}-${++echoSeq}`
    return new Promise((resolve, reject) => {
      const timerId = setTimeout(() => {
        pending.delete(echo)
        reject(new OneBotError(action, { message: `超时（${timeoutMs}ms）` }))
      }, timeoutMs)
      pending.set(echo, { resolve, reject, timerId, action })
      try {
        ws.send(JSON.stringify({ action, params: params || {}, echo }))
      } catch (error) {
        clearTimeout(timerId)
        pending.delete(echo)
        reject(new OneBotError(action, { message: error.message }, { transport: true }))
      }
    })
  }

  async function callOnce(action, params, timeoutMs) {
    const ep = endpoint()
    if (ep.httpUrl) {
      try {
        return await httpCall(action, params, timeoutMs)
      } catch (error) {
        if (error instanceof OneBotError && !error.transport) throw error
        if (!isSend(action) && ws && ws.readyState === 1) return callWs(action, params, timeoutMs)
        throw error
      }
    }
    return callWs(action, params, timeoutMs)
  }

  /**
   * 调用一个 OneBot action。读取调用的网络层失败按配置重试；发送不重试/切换传输，业务错误不重试。
   * @param {string} action
   * @param {object} [params]
   * @param {{ timeoutMs?: number, retries?: number }} [opts]
   */
  async function call(action, params = {}, { timeoutMs, retries } = {}) {
    const ep = endpoint()
    if (!ep.httpUrl && !ep.wsUrl) {
      throw new OneBotError(action, { message: '还没配置 QQ 网关地址' }, { transport: true })
    }
    const { timeouts } = opts()
    const timeout = Number(timeoutMs) || timeouts.callMs
    const retryDelays = Array.isArray(timeouts.retryDelaysMs) && timeouts.retryDelaysMs.length ? timeouts.retryDelaysMs : DEFAULT_TIMEOUTS.retryDelaysMs
    const maxRetries = isSend(action) ? 0 : retries === undefined ? Math.max(0, Math.min(retryDelays.length, Number(timeouts.maxRetries) || 0)) : retries
    stats.calls += 1
    let lastError = null
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await callOnce(action, params, timeout)
      } catch (error) {
        lastError = error
        stats.failures += 1
        stats.lastError = error?.message || String(error)
        if (!(error instanceof OneBotError) || !error.transport) throw error
        if (attempt >= maxRetries) break
        const wait = retryDelays[attempt] ?? retryDelays[retryDelays.length - 1] ?? 1000
        log?.warn?.(`${action}：网关暂时连不上，${Math.round(wait / 1000)}s 后重试（${attempt + 1}/${maxRetries}）`)
        await sleep(wait)
      }
    }
    throw lastError
  }

  function jitter(ms, ratio) {
    const r = Math.max(0, Math.min(1, Number(ratio) || 0))
    if (!r) return ms
    const delta = ms * r
    return Math.max(100, Math.round(ms - delta + Math.random() * delta * 2))
  }

  function schedule() {
    clearTimeout(timer)
    if (stopped) return
    const { reconnect } = opts()
    if (!reconnect.enabled) {
      setState('disconnected', '自动重连已关闭')
      return
    }
    const wait = jitter(backoff, reconnect.jitterRatio)
    timer = setTimeout(() => {
      stats.reconnects += 1
      connect()
    }, wait)
    if (typeof timer.unref === 'function') timer.unref()
  }

  function connect() {
    if (stopped) return
    const ep = endpoint()
    if (!ep.wsUrl) {
      setState('unconfigured', '没有 WS 地址')
      return
    }
    setState('connecting')
    let url = ep.wsUrl
    if (ep.wsToken) url += (url.includes('?') ? '&' : '?') + `access_token=${encodeURIComponent(ep.wsToken)}`
    let socket
    try {
      socket = new WebSocket(url)
    } catch (error) {
      stats.lastError = `WS 连接失败：${error.message}`
      log?.warn?.(stats.lastError)
      setState('disconnected', error.message)
      const { reconnect } = opts()
      backoff = backoff ? Math.min(reconnect.maxDelayMs, Math.round(backoff * reconnect.factor)) : reconnect.minDelayMs
      schedule()
      return
    }
    ws = socket
    // WS 握手超时：timeouts.connectMs 来自配置（不是写死常量）。超时后主动 close，
    // onclose 会按重连策略继续调度，避免半开连接让状态永远停在 connecting。
    const { timeouts } = opts()
    const connectMs = Math.max(1000, Number(timeouts.connectMs) || 10000)
    const handshakeTimer = setTimeout(() => {
      if (socket.readyState === 1) return
      stats.lastError = `WS 握手超时（${connectMs}ms）`
      log?.warn?.(stats.lastError)
      try {
        socket.close()
      } catch (error) {}
    }, connectMs)
    if (typeof handshakeTimer.unref === 'function') handshakeTimer.unref()
    socket.onopen = () => {
      clearTimeout(handshakeTimer)
      const { reconnect } = opts()
      backoff = reconnect.minDelayMs
      stats.lastError = ''
      setState('connected')
      log?.info?.('已连上 QQ 网关（WS）')
    }
    socket.onmessage = (event) => {
      let data
      try {
        data = JSON.parse(typeof event.data === 'string' ? event.data : Buffer.from(event.data).toString('utf8'))
      } catch (error) {
        return
      }
      if (data && data.echo && pending.has(data.echo)) {
        const waiter = pending.get(data.echo)
        pending.delete(data.echo)
        clearTimeout(waiter.timerId)
        if (data.status === 'ok' || data.retcode === 0) waiter.resolve(data.data)
        else waiter.reject(new OneBotError(waiter.action, data))
        return
      }
      if (data && data.post_type) {
        try {
          onEvent?.(data)
        } catch (error) {
          log?.warn?.('处理事件出错：', error.message)
        }
      }
    }
    socket.onclose = (event) => {
      clearTimeout(handshakeTimer)
      if (ws === socket) ws = null
      for (const [echo, waiter] of pending) {
        clearTimeout(waiter.timerId)
        waiter.reject(new OneBotError(waiter.action, { message: '连接断开' }))
        pending.delete(echo)
      }
      if (!stopped) {
        const { reconnect } = opts()
        backoff = backoff
          ? Math.min(reconnect.maxDelayMs, Math.round(backoff * reconnect.factor))
          : reconnect.minDelayMs
        setState('disconnected', `code ${event?.code ?? ''}`)
        schedule()
      }
    }
    socket.onerror = () => {}
  }

  return {
    call,
    start() {
      if (!stopped) return
      stopped = false
      const { reconnect } = opts()
      backoff = reconnect.minDelayMs
      connect()
    },
    stop() {
      stopped = true
      clearTimeout(timer)
      setState('stopped')
      try {
        ws?.close()
      } catch (error) {}
      ws = null
      for (const [echo, waiter] of pending) {
        clearTimeout(waiter.timerId)
        waiter.reject(new OneBotError(waiter.action, { message: '连接已停止' }))
        pending.delete(echo)
      }
    },
    restart() {
      this.stop()
      this.start()
    },
    /** 仅切 WS：用于配置热更新后无缝重连 */
    reconnectNow() {
      if (stopped) return
      clearTimeout(timer)
      try {
        ws?.close()
      } catch (error) {}
      ws = null
      const { reconnect } = opts()
      backoff = reconnect.minDelayMs
      connect()
    },
    get state() {
      return state
    },
    get wsState() {
      return ws?.readyState ?? 3
    },
    stats() {
      return { ...stats, state, wsState: ws?.readyState ?? 3, pending: pending.size }
    },
  }
}
