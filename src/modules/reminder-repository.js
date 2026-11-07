// 内置提醒端口：只通过已注入的当前人格 facade 操作核心 reminder kind。
const FIELDS = ['id', 'scopeType', 'scopeId', 'text', 'at', 'everySeconds', 'nextAt', 'status', 'createdBy', 'createdAt', 'sentCount', 'lastError']
const PATCH_FIELDS = ['nextAt', 'status', 'sentCount', 'lastError']
const STATUSES = new Set(['active', 'sent', 'cancelled'])
const ERRORS = new Set(['', 'ACCESS_DENIED', 'RATE_LIMITED', 'LEAK_BLOCKED', 'GATEWAY_UNAVAILABLE', 'SEND_FAILED'])

function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => !allowed.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    throw new Error('提醒仓库字段不合法')
  }
}

function idOf(id) {
  if (typeof id !== 'string' || !/^rem_[0-9a-f]{24}$/.test(id)) throw new Error('提醒仓库 ID 不合法')
  return id
}

function timestamp(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) throw new Error('提醒仓库时间戳不合法')
}

function statusOf(status) {
  if (!STATUSES.has(status)) throw new Error('提醒仓库 status 不合法')
  return status
}

function limitOf(limit, maximum) {
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) throw new Error(`提醒仓库 limit 必须是 1–${maximum} 的整数`)
  return limit
}

function targetId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
}

function validate(row) {
  object(row, FIELDS)
  if (FIELDS.some(key => !Object.hasOwn(row, key))) throw new Error('提醒仓库需要完整行')
  idOf(row.id)
  statusOf(row.status)
  if (!['private', 'group'].includes(row.scopeType) || !targetId(row.scopeId) || !targetId(row.createdBy)) throw new Error('提醒仓库 target/createdBy 不合法')
  if (typeof row.text !== 'string' || !row.text.trim() || Array.from(row.text).length > 500) throw new Error('提醒仓库 text 必须是 1–500 字符')
  if ((row.at === null) === (row.everySeconds === null)) throw new Error('提醒仓库 schedule 不合法')
  if (row.at !== null) timestamp(row.at)
  if (row.everySeconds !== null && (!Number.isInteger(row.everySeconds) || row.everySeconds < 60 || row.everySeconds > 2592000)) throw new Error('提醒仓库 everySeconds 不合法')
  timestamp(row.nextAt)
  timestamp(row.createdAt)
  if (!Number.isSafeInteger(row.sentCount) || row.sentCount < 0) throw new Error('提醒仓库 sentCount 不合法')
  if (!ERRORS.has(row.lastError)) throw new Error('提醒仓库 lastError 不合法')
  return structuredClone(row)
}

// 只输出核心业务字段；底层 kind/updatedAt 等元数据不进入模块。
const project = row => row ? structuredClone(Object.fromEntries(FIELDS.map(key => [key, row[key]]))) : null

export function createReminderRepository({ store, assertActive, assertDrain = assertActive }) {
  function ready(actual, minimum, maximum = minimum) {
    assertActive()
    if (actual < minimum || actual > maximum) throw new Error('提醒仓库参数不合法')
    if (!store) throw new Error('提醒仓库服务不可用')
  }
  function access(work) {
    try { return work() } catch { throw new Error('提醒仓库操作失败') }
  }
  return Object.freeze({
    // Fixed-kind full scan for duplicate/limit checks and scoped command listing.
    all(status = 'active') {
      ready(arguments.length, 0, 1)
      statusOf(status)
      return access(() => store.list('reminder', { where: row => row.status === status, limit: 1000000 }).map(project))
    },
    capture() {
      ready(arguments.length, 0)
      return access(() => {
        const kind = store.scopedKind?.('reminder') || 'reminder'
        const target = store.base || store
        const bound = createReminderRepository({ assertActive: assertDrain, assertDrain, store: {
          get: (_, id) => target.get(kind, id),
          put: (_, ...args) => target.put(kind, ...args),
          list: (_, options) => target.list(kind, options),
          count: (_, where) => target.count(kind, where),
          remove: (_, id) => target.remove(kind, id),
          tx: work => target.tx(work),
        } })
        const captured = Object.freeze({ ...bound, capture() {
          assertDrain()
          if (arguments.length) throw new Error('提醒仓库参数不合法')
          return captured
        }, isCurrent() {
          assertDrain()
          if (arguments.length) throw new Error('提醒仓库参数不合法')
          return access(() => !store.scopedKind || store.scopedKind('reminder') === kind)
        } })
        return captured
      })
    },
    get(id) {
      ready(arguments.length, 1)
      idOf(id)
      return access(() => project(store.get('reminder', id)))
    },
    list(options = {}) {
      ready(arguments.length, 0, 1)
      object(options, ['status', 'limit'])
      const status = statusOf(options.status === undefined ? 'active' : options.status)
      const limit = limitOf(options.limit === undefined ? 50 : options.limit, 50)
      return access(() => store.list('reminder', { where: row => row.status === status, limit }).map(project))
    },
    findDue(now, limit = 20) {
      ready(arguments.length, 1, 2)
      timestamp(now)
      limitOf(limit, 20)
      // 必须先按 nextAt 排序再截断，不能先取最新创建的 20 行。
      return access(() => store.list('reminder', {
        where: row => row.status === 'active' && Number.isFinite(row.nextAt) && row.nextAt <= now,
        limit: Number.MAX_SAFE_INTEGER,
      }).sort((a, b) => a.nextAt - b.nextAt || a.id.localeCompare(b.id)).slice(0, limit).map(project))
    },
    countActive() {
      ready(arguments.length, 0)
      return access(() => store.count('reminder', row => row.status === 'active'))
    },
    put(row) {
      ready(arguments.length, 1)
      const copy = validate(row)
      // 完整 upsert；创建时间沿用核心 store 的首次创建时间语义。
      return access(() => project(store.put('reminder', copy.id, copy, { createdAt: copy.createdAt })))
    },
    update(id, patch) {
      ready(arguments.length, 2)
      idOf(id)
      object(patch, PATCH_FIELDS)
      // 在存储访问之前验证 patch；不存在的 ID 也不能绕过值校验。
      if (Object.hasOwn(patch, 'status')) statusOf(patch.status)
      if (Object.hasOwn(patch, 'nextAt')) timestamp(patch.nextAt)
      if (Object.hasOwn(patch, 'sentCount') && (!Number.isSafeInteger(patch.sentCount) || patch.sentCount < 0)) throw new Error('提醒仓库 sentCount 不合法')
      if (Object.hasOwn(patch, 'lastError') && !ERRORS.has(patch.lastError)) throw new Error('提醒仓库 lastError 不合法')
      const copy = structuredClone(patch)
      return access(() => store.tx(() => {
        const current = store.get('reminder', id)
        if (!current) return null
        const next = validate({ ...project(current), ...copy })
        return project(store.put('reminder', id, next))
      }))
    },
    remove(id) {
      ready(arguments.length, 1)
      idOf(id)
      return access(() => store.tx(() => {
        if (!store.get('reminder', id)) return false
        store.remove('reminder', id)
        return true
      }))
    },
  })
}
