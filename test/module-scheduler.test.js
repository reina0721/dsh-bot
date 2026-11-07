import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createModuleKernel } from '../src/modules/kernel.js'

const MAX_DELAY = 2_592_000_000
const NATIVE_MAX = 2_147_483_647

// 仅测试注入描述符，不改变生产 registry 或模块数量。
function builtin(id, setup, manifest = {}) {
  return {
    manifest: { id, permissions: ['scheduler'], ...manifest },
    defaultEnabled: true,
    load: () => ({ setup }),
  }
}

async function harness(t, registry, logger = null) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-scheduler-'))
  const kernel = createModuleKernel({ dataDir: root, registry, logger })
  t.after(async () => { await kernel.dispose(); await rm(root, { recursive: true, force: true }) })
  return { root, kernel }
}

async function external(root, id, manifest = {}, source = 'export function setup() {}') {
  const dir = join(root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'module.json'), JSON.stringify({ id, entry: 'index.mjs', ...manifest }))
  await writeFile(join(dir, 'index.mjs'), source)
}

function fakeClock(t) {
  let now = 0, next = 0
  const pending = new Map(), history = new Map(), delays = [], cleared = []
  t.mock.method(performance, 'now', () => now)
  t.mock.method(globalThis, 'setTimeout', (fn, delay) => {
    const native = ++next
    const timer = { fn, at: now + delay }
    pending.set(native, timer); history.set(native, timer); delays.push(delay)
    return native
  })
  t.mock.method(globalThis, 'clearTimeout', (native) => { cleared.push(native); pending.delete(native) })
  return {
    pending, delays, cleared,
    late(native) { history.get(native).fn() },
    advance(ms) {
      now += ms
      for (;;) {
        const due = [...pending].find(([, timer]) => timer.at <= now)
        if (!due) break
        pending.delete(due[0]); due[1].fn()
      }
    },
  }
}

test('scheduler: real global timers fire once after delay, including asynchronous zero delay', async (t) => {
  let scheduler
  const h = await harness(t, [builtin('builtin-clock', api => { scheduler = api.scheduler })])
  await h.kernel.start()
  const start = performance.now()
  let calls = 0, timer
  await new Promise(resolve => {
    timer = scheduler.setTimeout((...args) => { calls++; assert.deepEqual(args, []); resolve() }, 10)
  })
  assert.ok(performance.now() - start >= 10)
  assert.equal(calls, 1)
  assert.equal(timer.dispose(), false)
  assert.equal(scheduler.clearTimeout(timer.id), false)
  let zeroFired = false
  const zero = new Promise(resolve => scheduler.setTimeout(() => { zeroFired = true; resolve() }, 0))
  assert.equal(zeroFired, false)
  await zero
  assert.equal(zeroFired, true)
})

test('scheduler: opaque module-local IDs, clear/dispose, late callbacks and fire free registrations', async (t) => {
  const clock = fakeClock(t), apis = []
  const h = await harness(t, ['a', 'b'].map(id => builtin(`builtin-${id}`, api => { apis.push(api) })))
  await h.kernel.start()
  const [a, b] = apis.map(api => api.scheduler)
  let calls = 0
  const timer = a.setTimeout(() => calls++, 100)
  const native = [...clock.pending.keys()][0]
  assert.equal(typeof timer.id, 'string')
  assert.ok(Object.isFrozen(timer)); assert.ok(Object.isFrozen(a))
  assert.notEqual(timer.id, String(native))
  assert.equal(b.clearTimeout(timer.id), false)
  for (const id of [null, undefined, {}, timer, 1, 'unknown']) assert.equal(a.clearTimeout(id), false)
  clock.advance(99); assert.equal(calls, 0)
  clock.advance(1); assert.equal(calls, 1)
  clock.late(native); assert.equal(calls, 1)
  assert.equal(a.clearTimeout(timer.id), false)
  const canceled = a.setTimeout(() => calls++, 1)
  const canceledNative = [...clock.pending.keys()][0]
  assert.equal(a.clearTimeout(canceled.id), true)
  assert.equal(canceled.dispose(), false)
  clock.late(canceledNative); clock.advance(1); assert.equal(calls, 1)
  const disposed = a.setTimeout(() => calls++, 0)
  assert.equal(disposed.dispose(), true); assert.equal(disposed.dispose(), false)
  assert.equal(clock.pending.size, 0)
  assert.equal(clock.cleared.length, 2)
})

test('scheduler: validates function/integer delay and 64 live timers per module, releases quota before callback', async (t) => {
  const clock = fakeClock(t), apis = []
  const h = await harness(t, ['a', 'b'].map(id => builtin(`builtin-${id}`, api => { apis.push(api) })))
  await h.kernel.start()
  const [a, b] = apis.map(api => api.scheduler)
  for (const fn of [null, {}, 'callback', 1]) assert.throws(() => a.setTimeout(fn, 0), /必须是函数/)
  for (const ms of [undefined, null, '1', false, {}, NaN, Infinity, -Infinity, -1, 0.5, MAX_DELAY + 1, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => a.setTimeout(() => {}, ms), /延迟必须/)
  }
  assert.equal(clock.pending.size, 0)
  let replacement
  const timers = [a.setTimeout(() => { replacement = a.setTimeout(() => {}, 100) }, 0)]
  for (let i = 1; i < 64; i++) timers.push(a.setTimeout(() => {}, 100))
  assert.throws(() => a.setTimeout(() => {}, 0), /64/)
  const other = b.setTimeout(() => {}, 100)
  assert.equal(clock.pending.size, 65)
  clock.advance(0)
  assert.ok(replacement)
  assert.equal(clock.pending.size, 65)
  assert.throws(() => a.setTimeout(() => {}, 0), /64/)
  assert.equal(timers[1].dispose(), true)
  assert.doesNotThrow(() => a.setTimeout(() => {}, 100))
  other.dispose()
})

test('scheduler: 30-day delays are segmented within Node timeout limit and honor monotonic deadline', async (t) => {
  const clock = fakeClock(t)
  let scheduler, calls = 0
  const h = await harness(t, [builtin('builtin-clock', api => { scheduler = api.scheduler })])
  await h.kernel.start()
  const timer = scheduler.setTimeout(() => calls++, MAX_DELAY)
  assert.deepEqual(clock.delays, [NATIVE_MAX])
  clock.advance(NATIVE_MAX - 1); assert.equal(calls, 0)
  clock.advance(1); assert.equal(calls, 0)
  assert.deepEqual(clock.delays, [NATIVE_MAX, MAX_DELAY - NATIVE_MAX])
  clock.advance(MAX_DELAY - NATIVE_MAX - 1); assert.equal(calls, 0)
  clock.advance(1); assert.equal(calls, 1)
  assert.equal(timer.dispose(), false)
  // 事件循环迟到时按已经经过的时间触发，不再等待一个完整分段。
  scheduler.setTimeout(() => calls++, MAX_DELAY)
  clock.advance(MAX_DELAY + 1000); assert.equal(calls, 2)
  const canceled = scheduler.setTimeout(() => calls++, MAX_DELAY)
  clock.advance(NATIVE_MAX)
  const native = [...clock.pending.keys()][0]
  assert.equal(canceled.dispose(), true)
  clock.advance(MAX_DELAY); clock.late(native)
  assert.equal(calls, 2)
  assert.ok(clock.delays.every(ms => ms >= 0 && ms <= NATIVE_MAX))
})

test('scheduler: API absent without builtin permission and external manifests cannot forge access', async (t) => {
  const clock = fakeClock(t)
  let denied
  const h = await harness(t, [builtin('builtin-denied', api => { denied = api }, { permissions: [] })])
  for (const id of ['external-denied', 'external-forged']) {
    await external(h.root, id, { permissions: ['scheduler'], builtin: true, source: 'builtin' }, `
      export function setup(api) {
        if (Object.hasOwn(api, 'scheduler')) throw Error('scheduler was exposed')
        api.scheduler.setTimeout(() => {}, 0)
      }
    `)
  }
  await h.kernel.start()
  assert.equal(Object.hasOwn(denied, 'scheduler'), false)
  assert.throws(() => denied.scheduler.setTimeout(() => {}, 0), TypeError)
  for (const item of h.kernel.list().filter(row => !row.builtin)) {
    assert.equal(item.status, 'error')
    assert.match(item.error, /setTimeout/)
    assert.doesNotMatch(item.error, /scheduler was exposed|未知 permission/)
    assert.equal(item.source, 'external')
  }
  assert.equal(clock.pending.size, 0)
})

test('scheduler: disable/re-enable and dispose clear timers before cleanup and reject old generations', async (t) => {
  const clock = fakeClock(t), apis = [], timers = [], cleanupStates = []
  let calls = 0
  const h = await harness(t, [builtin('builtin-clock', api => {
    apis.push(api)
    timers.push(api.scheduler.setTimeout(() => calls++, 10))
    return () => {
      let registrationError
      try { api.scheduler.setTimeout(() => {}, 0) } catch (error) { registrationError = error.message }
      cleanupStates.push({ pending: clock.pending.size, registrationError })
    }
  })])
  await h.kernel.start()
  const oldNative = [...clock.pending.keys()][0]
  await h.kernel.setEnabled('builtin-clock', false)
  assert.equal(clock.pending.size, 0)
  assert.deepEqual(cleanupStates, [{ pending: 0, registrationError: '模块已停止' }])
  assert.equal(timers[0].dispose(), false)
  clock.late(oldNative); assert.equal(calls, 0)
  await h.kernel.setEnabled('builtin-clock', true)
  assert.notEqual(timers[0].id, timers[1].id)
  assert.equal(apis[1].scheduler.clearTimeout(timers[0].id), false)
  assert.equal(apis[0].scheduler.clearTimeout(timers[1].id), false)
  assert.throws(() => apis[0].scheduler.setTimeout(() => {}, 0), /已停止/)
  clock.late(oldNative); assert.equal(calls, 0)
  const currentNative = [...clock.pending.keys()][0]
  await h.kernel.dispose()
  assert.deepEqual(cleanupStates, Array.from({ length: 2 }, () => ({ pending: 0, registrationError: '模块已停止' })))
  assert.equal(clock.pending.size, 0)
  clock.late(currentNative); clock.advance(100)
  assert.equal(calls, 0)
  assert.equal(timers[1].dispose(), false)
  assert.throws(() => apis[1].scheduler.setTimeout(() => {}, 0), /已停止/)
})

test('scheduler: setup failure, event isolation and dependency reload/disable clear registrations', async (t) => {
  const clock = fakeClock(t), apis = []
  let calls = 0
  const h = await harness(t, [
    builtin('builtin-failed', api => {
      api.scheduler.setTimeout(() => calls++, 10)
      throw Error('setup failed')
    }),
    builtin('builtin-event', api => {
      api.scheduler.setTimeout(() => calls++, 10)
      api.on('message', () => { throw Error('event failed') })
    }, { permissions: ['scheduler', 'events'] }),
    builtin('builtin-dependent', api => {
      apis.push(api)
      api.scheduler.setTimeout(() => calls++, 10)
    }, { permissions: ['scheduler'], requires: ['dependency'] }),
  ])
  await external(h.root, 'dependency')
  await h.kernel.start()
  assert.equal(h.kernel.list().find(row => row.id === 'builtin-failed').status, 'error')
  assert.equal(clock.pending.size, 2)
  await h.kernel.dispatch({ kind: 'message' })
  assert.equal(clock.pending.size, 1)
  const oldNative = [...clock.pending.keys()][0]
  await h.kernel.reload('dependency')
  assert.equal(apis.length, 2); assert.equal(clock.pending.size, 1)
  clock.late(oldNative); assert.equal(calls, 0)
  assert.throws(() => apis[0].scheduler.setTimeout(() => {}, 0), /已停止/)
  await h.kernel.setEnabled('dependency', false)
  assert.equal(clock.pending.size, 0)
  assert.equal(h.kernel.list().find(row => row.id === 'builtin-dependent').status, 'blocked')
  for (const native of [1, 2, 3, 4]) clock.late(native)
  clock.advance(100); assert.equal(calls, 0)
})

test('scheduler: sync/async callback exceptions isolated, safe logs and logger failures swallowed', async (t) => {
  const clock = fakeClock(t), logs = []
  let scheduler, healthy = 0, badLogger = false
  const logger = { warn(...args) { logs.push(args); if (badLogger) throw Error('logger failed') } }
  const h = await harness(t, [builtin('builtin-clock', api => { scheduler = api.scheduler })], logger)
  await h.kernel.start()
  const secret = 'chatId=1000199876543 payload=private-message'
  scheduler.setTimeout(() => { throw Error(secret) }, 0)
  scheduler.setTimeout(async () => { throw Error(secret) }, 0)
  scheduler.setTimeout(() => { throw { get message() { throw Error(secret) } } }, 0)
  scheduler.setTimeout(() => healthy++, 0)
  assert.doesNotThrow(() => clock.advance(0))
  await new Promise(setImmediate)
  assert.equal(healthy, 1); assert.equal(logs.length, 3)
  assert.deepEqual(logs, Array.from({ length: 3 }, () => ['模块 builtin-clock 调度回调失败']))
  assert.doesNotMatch(JSON.stringify(logs), /1000199876543|private-message|payload|chatId/)
  assert.equal(h.kernel.list()[0].status, 'loaded')
  assert.equal(clock.pending.size, 0)
  badLogger = true
  scheduler.setTimeout(() => { throw Error(secret) }, 0)
  scheduler.setTimeout(async () => { throw Error(secret) }, 0)
  assert.doesNotThrow(() => clock.advance(0))
  await new Promise(setImmediate)
  assert.equal(logs.length, 5)
  assert.equal(h.kernel.list()[0].status, 'loaded')
})

test('scheduler health counts registration/fire/cancel/completion/failure without guessing business health', async t => {
  const clock = fakeClock(t), apis = []
  const h = await harness(t, [builtin('builtin-clock', api => { apis.push(api) })])
  await h.kernel.start()
  const read = () => h.kernel.health('builtin-clock').items[0]
  const scheduler = apis[0].scheduler
  assert.deepEqual(read().scheduler, { active: 0, running: 0, scheduled: 0, fired: 0, cancelled: 0, completed: 0, failed: 0, nextDueAt: null })
  assert.equal(read().telemetry.timerScheduled, false)
  const cancelled = scheduler.setTimeout(() => {}, 200)
  let release
  const gate = new Promise(resolve => { release = resolve })
  scheduler.setTimeout(() => gate, 10)
  scheduler.setTimeout(() => { throw Error('SECRET') }, 20)
  assert.equal(read().scheduler.active, 3)
  const nextDueAt = read().scheduler.nextDueAt
  assert.equal(read().telemetry.nextRunAt, nextDueAt)
  assert.equal(read().health, 'healthy', 'successful setup is idle; a timer is not business success')
  assert.equal(read().engine.succeeded, null)
  assert.equal(cancelled.dispose(), true)
  clock.advance(10)
  assert.equal(read().scheduler.running, 1)
  assert.equal(read().scheduler.fired, 1)
  assert.equal(read().scheduler.active, 1)
  release(); await new Promise(setImmediate)
  assert.equal(read().scheduler.completed, 1)
  assert.equal(read().scheduler.running, 0)
  clock.advance(10)
  await new Promise(setImmediate)
  assert.deepEqual(read().scheduler, { active: 0, running: 0, scheduled: 3, fired: 2, cancelled: 1, completed: 1, failed: 1, nextDueAt: null })
  assert.equal(read().reasonCode, 'SCHEDULER_CALLBACK_FAILED')
  assert.equal(read().lastError.reasonCode, 'SCHEDULER_CALLBACK_FAILED')
  assert.equal(read().health, 'degraded')
  assert.equal(read().lifecycle, 'loaded')
  const oldGeneration = read().runtimeGeneration
  scheduler.setTimeout(() => {}, 100)
  await h.kernel.setEnabled('builtin-clock', false)
  assert.equal(read().scheduler.cancelled, 2)
  assert.equal(read().telemetryGeneration, oldGeneration)
  assert.equal(read().telemetry.timerScheduled, false)
  await h.kernel.setEnabled('builtin-clock', true)
  assert.notEqual(read().runtimeGeneration, oldGeneration)
  assert.equal(read().scheduler.scheduled, 0)
})

test('scheduler health rejects old async completions after a new setup generation', async t => {
  const clock = fakeClock(t), apis = []
  const h = await harness(t, [builtin('builtin-clock', api => { apis.push(api) })])
  await h.kernel.start()
  let reject
  apis[0].scheduler.setTimeout(() => new Promise((resolve, fail) => { reject = fail }), 0)
  clock.advance(0)
  assert.equal(h.kernel.health().items[0].scheduler.running, 1)
  await h.kernel.setEnabled('builtin-clock', false)
  await h.kernel.setEnabled('builtin-clock', true)
  const before = h.kernel.health()
  reject(Error('SECRET'))
  await new Promise(setImmediate)
  assert.deepEqual(h.kernel.health().items, before.items)
  assert.equal(h.kernel.health().revision, before.revision)
})
