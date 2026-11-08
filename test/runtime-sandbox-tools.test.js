import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSandboxService } from '../src/sandbox/service.js'
import { createSandboxTools } from '../src/runtime/sandbox-tools.js'
import { policyGeneration } from '../src/sandbox/policy.js'
import { createAgentRuntime, SANDBOX_PRIVATE_PRESET, SANDBOX_SOCIAL_PRESET } from '../src/runtime/agent.js'
import { composeReply } from '../src/cognition/analysis.js'
import { assembleServices } from '../src/services/assembly.js'
import { normalizeConfig } from '../src/core/config.js'

const owner = { chatType: 'private', chatId: '10001', senderId: '10001' }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const jobId = 'job_12345678-1234-1234-1234-123456789012'
function config() {
  return { access: { ownerQQ: '10001', operators: ['10002'] }, sandbox: { enabled: true }, runtime: { engine: 'agent', replyTimeoutMs: 1000 } }
}
function fakeBroker(cfg) {
  const calls = [], cancelled = []
  return { calls, cancelled,
    status: async () => ({ state: 'ready', policyGeneration: policyGeneration(cfg) }),
    async create(context, input, options) { calls.push({ context, input, options }); return { job: { id: jobId, state: 'succeeded', artifact: false } } },
    async cancel(context, id) { cancelled.push({ context, id }); return { ok: true } },
  }
}
function toolEnv(t, { real = false, principalId = '10001', chatType = 'private' } = {}) {
  const cfg = config(), persona = { id: 'self', generation: 1 }, abort = new AbortController()
  let broker, revoked = []
  if (real) {
    const root = mkdtempSync(join(tmpdir(), 'c07-tools-'))
    broker = createSandboxService({ root, getConfig: () => cfg, driver: {
      name: 'fake', probe: async () => ({ ready: true }),
      execute: async () => ({ reason: 'EXITED', exitCode: 0, output: 'fake output' }),
    } })
    t.after(async () => { abort.abort(); await broker.dispose(); rmSync(root, { recursive: true, force: true }) })
  } else broker = fakeBroker(cfg)
  const binding = { environment: 'live', personaId: 'self', personaGeneration: 1, principalId,
    chatType, chatId: '10001', scopeId: 'isolated-instance', policyGeneration: policyGeneration(cfg) }
  const tools = new Map(createSandboxTools({ broker, binding, getConfig: () => cfg, getPersona: () => persona,
    signal: abort.signal, isAdmitted: () => !abort.signal.aborted, onRevoke: code => revoked.push(code),
  }).map(tool => [tool.name, tool]))
  return { cfg, persona, binding, broker, tools, abort, revoked }
}

test('sandbox tools: six strict schemas, real broker file/shell jobs and bounded results', async t => {
  const { broker, tools } = toolEnv(t, { real: true })
  await broker.probe()
  assert.equal(tools.size, 6)
  for (const tool of tools.values()) {
    assert.equal(tool.parameters.additionalProperties, false)
    assert.doesNotMatch(JSON.stringify(tool.parameters), /role|policy|host|env|principal|session/)
    assert.equal(tool.output.render({}, { ok: true })[0].text, '{"ok":true}')
  }
  assert.equal((await tools.get('sandbox_file_write').execute({ path: 'note.txt', content: '沙盒' })).ok, true)
  assert.equal((await tools.get('sandbox_file_read').execute({ path: 'note.txt' })).output, '沙盒')
  assert.match((await tools.get('sandbox_file_list').execute({})).output, /note.txt/)
  assert.equal((await tools.get('sandbox_shell').execute({ code: 'echo fake' })).output, 'fake output')
  assert.deepEqual(await tools.get('sandbox_python').execute({ code: 'print(1)' }), { ok: false, error: 'SANDBOX_CAPABILITY_UNAVAILABLE' })
  assert.equal((await tools.get('sandbox_action').execute({ action: 'file.delete', path: 'note.txt' })).ok, true)
})

test('sandbox tools: reject traversal, unknown identity/env/policy inputs and generic actions before admission', async t => {
  const { tools, broker } = toolEnv(t)
  for (const path of ['../x', '/etc/passwd', 'a/../x', 'a//b', 'C:\\host', 'a\0b', './x']) {
    assert.deepEqual(await tools.get('sandbox_file_read').execute({ path }), { ok: false, error: 'WORKSPACE_PATH_INVALID' })
  }
  for (const args of [{ code: 'x', role: 'owner' }, { code: 'x', env: {} }, { code: 'x', policyGeneration: 'x' }, { code: 'x', hostPath: '/tmp' }]) {
    assert.equal((await tools.get('sandbox_shell').execute(args)).error, 'INVALID_SANDBOX_INPUT')
  }
  assert.equal((await tools.get('sandbox_action').execute({ action: 'send_message', path: 'x' })).error, 'INVALID_SANDBOX_INPUT')
  assert.equal(broker.calls.length, 0)
})

test('sandbox tools: server-derived operator/other/group deny, capability matrix restricts shell', async t => {
  for (const options of [{ principalId: '10002' }, { principalId: '10003' }, { chatType: 'group' }]) {
    const { tools, broker } = toolEnv(t, options)
    assert.equal((await tools.get('sandbox_shell').execute({ code: 'x' })).error, 'POLICY_DENIED')
    assert.equal((await tools.get('sandbox_file_list').execute({})).error, 'POLICY_DENIED')
    assert.equal(broker.calls.length, 0)
  }
  const { cfg, binding, tools } = toolEnv(t)
  cfg.sandbox.policy = { ownerPrivate: ['workspace'] }
  binding.policyGeneration = policyGeneration(cfg)
  assert.equal((await tools.get('sandbox_shell').execute({ code: 'x' })).error, 'POLICY_DENIED')
  assert.equal((await tools.get('sandbox_file_list').execute({})).ok, true)
})

test('sandbox tools: every call checks readiness, generation and persona; errors never expose driver paths', async t => {
  for (const change of [e => { e.cfg.sandbox.enabled = false }, e => { e.persona.generation++ }, e => { e.persona.id = 'other' }, e => { e.abort.abort() }]) {
    const e = toolEnv(t); change(e)
    assert.match((await e.tools.get('sandbox_file_list').execute({})).error, /POLICY_CHANGED|PERSONA_CHANGED|SESSION_REVOKED/)
    assert.equal(e.broker.calls.length, 0)
  }
  const e = toolEnv(t)
  e.broker.status = async () => ({ state: 'unavailable' })
  assert.equal((await e.tools.get('sandbox_file_list').execute({})).error, 'SANDBOX_UNAVAILABLE')
  e.broker.status = async () => { throw Error('/host/secret raw error') }
  assert.deepEqual(await e.tools.get('sandbox_file_list').execute({}), { ok: false, error: 'SANDBOX_UNAVAILABLE' })
  assert.equal(e.broker.calls.length, 0)
})

test('sandbox tools: bounded artifact projection and malformed artifacts rejected', async t => {
  const e = toolEnv(t)
  e.broker.create = async () => ({ job: { id: jobId, state: 'succeeded', artifact: true, hostPath: '/private' } })
  e.broker.artifact = async () => ({ encoding: 'base64', bytes: 65536, content: Buffer.alloc(65536, 'x').toString('base64'), hostPath: '/private' })
  const result = await e.tools.get('sandbox_file_read').execute({ path: 'x' })
  assert.equal(result.output.length, 16384)
  assert.equal(result.truncated, true)
  assert.equal(result.bytes, 65536)
  assert.doesNotMatch(JSON.stringify(result), /private|hostPath/)
  e.broker.artifact = async () => ({ encoding: 'base64', bytes: 16384, content: Buffer.alloc(16384, 255).toString('base64') })
  const binary = await e.tools.get('sandbox_file_read').execute({ path: 'x' })
  assert.equal(binary.ok, true)
  assert.ok(Buffer.byteLength(binary.output) <= 16384)
  assert.equal(binary.truncated, true)
  e.broker.artifact = async () => ({ encoding: 'base64', bytes: 65537, content: 'x' })
  assert.equal((await e.tools.get('sandbox_file_read').execute({ path: 'x' })).error, 'SANDBOX_UNAVAILABLE')
})

test('sandbox tools: revocation cancels jobs including admission returning late; late output is ignored', async t => {
  for (const lateAdmission of [true, false]) {
    const e = toolEnv(t), admitted = deferred(), creating = deferred(), reading = deferred()
    e.broker.create = async () => { creating.resolve(); if (lateAdmission) await admitted.promise; return { job: { id: jobId, state: 'running' } } }
    e.broker.detail = async () => { reading.resolve(); await admitted.promise; return { job: { id: jobId, state: 'succeeded' } } }
    const pending = e.tools.get('sandbox_shell').execute({ code: 'x' })
    await (lateAdmission ? creating.promise : reading.promise)
    e.abort.abort()
    assert.equal((await pending).error, 'SESSION_REVOKED')
    admitted.resolve()
    await pause(0)
    assert.equal(e.broker.cancelled.length, 1)
  }
})

function runtimeEnv(t, { cfg = config(), silent = false, broker: providedBroker, delivery = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'c07-runtime-')), listeners = new Set(), agents = new Map(), created = []
  const persona = { id: 'self', generation: 1 }, broker = providedBroker === undefined ? fakeBroker(cfg) : providedBroker
  const emit = (id, event) => { for (const fn of listeners) fn({ id }, event) }
  const controller = { async create({ agentPreset }) {
    const id = `session-${created.length + 1}`, registered = new Map(), removed = []
    const agent = { session: { id }, registered, removed, stopped: 0,
      ctx: { tools: { register(tool) { registered.set(tool.name, tool); return () => { removed.push(tool.name) } } } },
      abort() { this.stopped++ },
      followup() { if (!silent) queueMicrotask(() => finish(id, 'ok')) }, steer() {},
    }
    agents.set(id, agent); created.push({ id, preset: agentPreset }); return { sessionId: id }
  }, rename() {} }
  const ctx = { get(name) { return { agents, sessionController: controller,
    workspaceRegistry: { list: () => [], create: async () => ({ id: 'workspace' }) } }[name] },
  on(_name, fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const finish = (id, text) => {
    emit(id, { type: 'assistant/message', message: { content: [{ type: 'text', text }] } })
    emit(id, { type: 'turn/end' })
  }
  const runtime = createAgentRuntime({ ctx, dataRoot: root, getConfig: () => cfg, getPersona: () => persona, executionSandbox: broker, delivery })
  t.after(() => { runtime.dispose(); rmSync(root, { recursive: true, force: true }) })
  return { runtime, cfg, broker, persona, agents, created, finish, ctx, root, controller }
}
const compose = (e, turn = owner) => e.runtime.compose({ turn, user: 'hello' })

test('runtime sandbox: ready broker mounts six sandbox tools alongside unchanged QQ tools, uses safe presets', async t => {
  const e = runtimeEnv(t)
  const result = await compose(e)
  const agent = e.agents.get(result.sessionId)
  assert.equal(e.created[0].preset, SANDBOX_PRIVATE_PRESET)
  assert.deepEqual([...agent.registered.keys()], ['qq_send_text', 'qq_like_user', 'qq_poke_user',
    'sandbox_file_list', 'sandbox_file_read', 'sandbox_file_write', 'sandbox_python', 'sandbox_shell', 'sandbox_action'])
  assert.equal((await agent.registered.get('sandbox_shell').execute({ code: 'echo x' })).ok, true)
  const context = e.broker.calls[0].context
  assert.ok(e.broker.calls[0].options.signal instanceof AbortSignal)
  assert.equal(context.principalId, owner.senderId)
  assert.equal(context.personaId, 'self')
  assert.notEqual(context.sessionId, result.sessionId)
  assert.doesNotMatch(JSON.stringify([...agent.registered.keys()]), /web_fetch|fs_read|exec_command/)
  const again = await compose(e)
  assert.equal(again.sessionId, result.sessionId)
})

test('runtime sandbox: unavailable/disabled/missing broker mounts no sandbox tools; default QQ behavior retained', async t => {
  for (const mode of ['unavailable', 'disabled', 'missing']) {
    const cfg = config(), broker = fakeBroker(cfg)
    if (mode === 'unavailable') broker.status = async () => ({ state: 'unavailable' })
    if (mode === 'disabled') cfg.sandbox.enabled = false
    const e = runtimeEnv(t, { cfg, broker: mode === 'missing' ? null : broker })
    const result = await compose(e)
    assert.equal(result.ok, true)
    assert.deepEqual([...e.agents.get(result.sessionId).registered.keys()], ['qq_send_text', 'qq_like_user', 'qq_poke_user'])
    assert.equal(e.broker?.calls.length || 0, 0)
    if (mode !== 'disabled') assert.equal(e.created[0].preset, SANDBOX_PRIVATE_PRESET)
  }
})

test('runtime sandbox: denied operator/other/group mount none; explicit group workspace grant is honored', async t => {
  for (const turn of [{ ...owner, chatId: '10002', senderId: '10002' }, { ...owner, chatId: '10003', senderId: '10003' }, { ...owner, chatType: 'group' }]) {
    const e = runtimeEnv(t)
    const result = await compose(e, turn)
    assert.equal(result.ok, true)
    assert.equal(e.created[0].preset, SANDBOX_SOCIAL_PRESET)
    assert.equal(e.agents.get(result.sessionId).registered.size, 0)
  }
  const cfg = config(); cfg.sandbox.policy = { group: ['workspace'] }
  const e = runtimeEnv(t, { cfg })
  const result = await compose(e, { ...owner, chatType: 'group' })
  const tools = e.agents.get(result.sessionId).registered
  assert.equal(tools.size, 6)
  assert.equal((await tools.get('sandbox_shell').execute({ code: 'x' })).error, 'POLICY_DENIED')
})

test('runtime sandbox: policy/persona/principal changes retire sessions, deny old QQ actions and ignore late events', async t => {
  for (const change of [e => { e.cfg.access.operators.push('999') }, e => { e.persona.generation++ }, e => { e.persona.id = 'other' }]) {
    const sent = [], e = runtimeEnv(t, { delivery: { deliver: async data => { sent.push(data); return { ok: true } } } })
    const first = await compose(e), old = e.agents.get(first.sessionId)
    change(e)
    await assert.rejects(old.registered.get('qq_send_text').execute({ text: 'late' }), /SESSION_REVOKED/)
    assert.equal(old.stopped, 1)
    assert.equal(old.removed.length, 9)
    e.finish(first.sessionId, 'late')
    assert.equal(sent.length, 0)
    assert.notEqual((await compose(e)).sessionId, first.sessionId)
  }
  const e = runtimeEnv(t)
  const first = await compose(e, { ...owner, chatType: 'group' })
  const second = await compose(e, { ...owner, chatType: 'group', senderId: '10002' })
  assert.notEqual(second.sessionId, first.sessionId)
  assert.equal(e.agents.get(first.sessionId).stopped, 1)
})

test('runtime sandbox: timeout cancels running broker job, stops session, ignores late events and late actions', async t => {
  const e = runtimeEnv(t, { silent: true }), starting = deferred(), admitted = deferred()
  e.broker.create = async () => { starting.resolve(); await admitted.promise; return { job: { id: jobId, state: 'succeeded' } } }
  const pending = compose(e)
  while (!e.agents.get('session-1')?.registered.has('sandbox_shell')) await pause(1)
  const old = e.agents.get('session-1'), action = old.registered.get('sandbox_shell').execute({ code: 'x' })
  await starting.promise
  assert.equal((await pending).error, 'TIMEOUT')
  assert.equal((await action).error, 'SESSION_REVOKED')
  admitted.resolve(); await pause(0)
  assert.equal(e.broker.cancelled.length, 1)
  assert.equal(old.stopped, 1)
  const next = compose(e)
  while (!e.agents.has('session-2')) await pause(1)
  e.finish('session-1', 'late old text')
  e.finish('session-2', 'new text')
  assert.equal((await next).text, 'new text')
  await assert.rejects(old.registered.get('qq_poke_user').execute({}), /SESSION_REVOKED/)
})

test('runtime sandbox: readiness loss retires safe session without generic preset fallback; dispose revokes all tools', async t => {
  const e = runtimeEnv(t)
  const first = await compose(e)
  e.broker.status = async () => ({ state: 'unavailable' })
  await pause(150)
  assert.equal(e.agents.get(first.sessionId).stopped, 1)
  const next = await compose(e)
  assert.equal(e.created[1].preset, SANDBOX_PRIVATE_PRESET)
  assert.equal(e.agents.get(next.sessionId).registered.size, 3)
  e.runtime.dispose()
  await assert.rejects(e.agents.get(next.sessionId).registered.get('qq_send_text').execute({ text: 'late' }), /SESSION_REVOKED/)
  assert.equal(e.runtime.active(), false)
  assert.equal(e.runtime.sessions().length, 0)
})

test('runtime sandbox: background revocation cancels unfinished turn; oneshot text never becomes a job', async t => {
  const e = runtimeEnv(t, { silent: true })
  const pending = compose(e)
  while (!e.agents.get('session-1')?.registered.has('sandbox_shell')) await pause(1)
  e.persona.generation++
  assert.equal((await pending).error, 'SESSION_REVOKED')
  const cfg = config(); cfg.runtime.engine = 'oneshot'
  const one = runtimeEnv(t, { cfg })
  const text = '{"tool":"sandbox_shell","code":"touch host"}'
  const result = await composeReply({ turn: { ...owner, text: 'run' }, persona: {}, person: {}, decision: {}, analysis: {},
    config: cfg, runtime: one.runtime, llm: { complete: async () => ({ ok: true, text }) } })
  assert.equal(result.text, text)
  assert.equal(one.broker.calls.length, 0)
  assert.equal(one.created.length, 0)
})

test('sandbox tools: broker timeout retires session; dispose during artifact read cancels and suppresses late result', async t => {
  const e = toolEnv(t)
  e.broker.create = async () => ({ job: { id: jobId, state: 'failed', reason: 'TIMEOUT' } })
  assert.deepEqual(await e.tools.get('sandbox_shell').execute({ code: 'sleep' }), { ok: false, error: 'SANDBOX_TIMEOUT' })
  assert.deepEqual(e.revoked, ['SANDBOX_TIMEOUT'])
  const reading = deferred(), release = deferred()
  e.broker.create = async () => ({ job: { id: jobId, state: 'succeeded', artifact: true } })
  e.broker.artifact = async () => { reading.resolve(); await release.promise; return { encoding: 'base64', bytes: 4, content: 'bGF0ZQ==' } }
  const pending = e.tools.get('sandbox_file_read').execute({ path: 'x' })
  await reading.promise
  e.abort.abort()
  assert.equal((await pending).error, 'SESSION_REVOKED')
  release.resolve()
  await pause(0)
  assert.equal(e.broker.cancelled.length, 1)
})

test('runtime sandbox: broker becoming ready replaces unmounted session; no stop API still retires session', async t => {
  const e = runtimeEnv(t)
  e.broker.status = async () => ({ state: 'unavailable' })
  const first = await compose(e)
  delete e.agents.get(first.sessionId).abort
  e.broker.status = async () => ({ state: 'ready', policyGeneration: policyGeneration(e.cfg) })
  const second = await compose(e)
  assert.notEqual(second.sessionId, first.sessionId)
  assert.equal(e.agents.get(second.sessionId).registered.size, 9)
  await assert.rejects(e.agents.get(first.sessionId).registered.get('qq_like_user').execute({}), /SESSION_REVOKED/)
  e.finish(first.sessionId, 'late')
})

test('runtime sandbox: dispose interrupts active job and turn before late execution; queued compose stays inactive', async t => {
  const e = runtimeEnv(t, { silent: true }), reading = deferred(), release = deferred()
  e.broker.create = async () => ({ job: { id: jobId, state: 'running' } })
  e.broker.detail = async () => { reading.resolve(); await release.promise; return { job: { id: jobId, state: 'succeeded' } } }
  const pending = compose(e), queued = compose(e)
  while (!e.agents.get('session-1')?.registered.has('sandbox_shell')) await pause(1)
  const tool = e.agents.get('session-1').registered.get('sandbox_shell')
  const action = tool.execute({ code: 'x' })
  await reading.promise
  e.runtime.dispose()
  assert.equal((await pending).error, 'RUNTIME_DISPOSED')
  assert.equal((await action).error, 'SESSION_REVOKED')
  release.resolve(); await pause(0)
  assert.equal(e.broker.cancelled.length, 1)
  assert.equal((await queued).ok, false)
  e.finish('session-1', 'late')
})


test('C07 shared assembly: injects broker and actual persona edit/switch generations into live runtime', async t => {
  const cfg = normalizeConfig(config()).config
  const e = runtimeEnv(t, { cfg })
  e.runtime.dispose()
  const graph = assembleServices({ dataRoot: join(e.root, 'graph'), getConfig: () => cfg,
    runtimeContext: e.ctx, executionSandbox: e.broker, registry: [], discoverExternal: false })
  await graph.modulesReady
  t.after(async () => { await graph.modules.dispose(); graph.cognition.dispose(); rmSync(e.root, { recursive: true, force: true }) })
  const runtime = graph.cognition.services.runtime
  assert.ok(runtime, graph.cognition.snapshot().error)
  const first = await runtime.compose({ turn: owner, user: 'hello' })
  assert.equal(first.ok, true)
  assert.equal(e.agents.get(first.sessionId).registered.size, 9)
  graph.cognition.services.persona.edit({ profile: { displayName: 'changed' } })
  await assert.rejects(e.agents.get(first.sessionId).registered.get('qq_like_user').execute({}), /SESSION_REVOKED/)
  const second = await runtime.compose({ turn: owner, user: 'hello' })
  assert.notEqual(second.sessionId, first.sessionId)
  const before = graph.cognition.services.persona.activeId()
  graph.cognition.services.persona.create({ name: 'new', activate: true })
  graph.cognition.services.persona.activate(before)
  await assert.rejects(e.agents.get(second.sessionId).registered.get('qq_like_user').execute({}), /SESSION_REVOKED/)
})

test('runtime sandbox: missing safe preset fails closed without attempting legacy preset or generic tools', async t => {
  const e = runtimeEnv(t)
  const attempts = []
  e.controller.create = async ({ agentPreset }) => { attempts.push(agentPreset); throw Error('/host/preset missing') }
  assert.deepEqual(await compose(e), { ok: false, error: 'RUNTIME_FAILED' })
  assert.deepEqual(attempts, [SANDBOX_PRIVATE_PRESET])
  assert.equal(e.broker.calls.length, 0)
  assert.doesNotMatch(JSON.stringify(e.runtime.summary().stats), /host|preset missing/)
})

test('sandbox tools: total wait deadline revokes admission and cancels a broker call that never finishes', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const e = toolEnv(t), reading = deferred(), release = deferred()
  e.broker.create = async () => ({ job: { id: jobId, state: 'succeeded', artifact: true } })
  e.broker.artifact = async () => { reading.resolve(); await release.promise; return {} }
  const pending = e.tools.get('sandbox_file_read').execute({ path: 'x' })
  await reading.promise
  t.mock.timers.tick(35000)
  assert.deepEqual(await pending, { ok: false, error: 'SANDBOX_TIMEOUT' })
  assert.equal(e.broker.cancelled.length, 1)
  assert.deepEqual(e.revoked, ['SANDBOX_TIMEOUT'])
  release.resolve()
})


test('runtime sandbox: readiness revoked immediately before turn/end suppresses result before monitor tick', async t => {
  const e = runtimeEnv(t, { silent: true })
  const pending = compose(e)
  while (!e.agents.get('session-1')?.registered.has('sandbox_shell')) await pause(1)
  e.broker.status = async () => ({ state: 'unavailable' })
  e.finish('session-1', 'revoked result')
  assert.equal((await pending).error, 'SESSION_REVOKED')
  assert.equal(e.agents.get('session-1').stopped, 1)
})


test('C07 broker admission signal prevents execution after cancellation during durable admission and aborts running job', async t => {
  const root = mkdtempSync(join(tmpdir(), 'c07-admission-')), cfg = config()
  const saving = deferred(), release = deferred(), started = deferred(), calls = [], rows = []
  let blockAdmission = true
  const broker = createSandboxService({ root, getConfig: () => cfg,
    audit: { load: async () => rows, append: async row => {
      rows.push({ ...row })
      if (row.state === 'queued' && blockAdmission) { saving.resolve(); await release.promise }
    } },
    driver: { name: 'fake', probe: async () => ({ ready: true }), execute: async ({ signal }) => {
      calls.push('execute'); started.resolve()
      await new Promise(resolve => { if (signal.aborted) resolve(); else signal.addEventListener('abort', resolve, { once: true }) })
      return { reason: 'CANCELLED', output: '', exitCode: null }
    } },
  })
  t.after(async () => { release.resolve(); await broker.dispose(); rmSync(root, { recursive: true, force: true }) })
  await broker.probe()
  const context = { personaId: 'self', principalId: '10001', chatType: 'private', chatId: '10001', sessionId: 'test-signal' }
  const input = { kind: 'execute', requestId: 'cancel-admission', code: 'hold', policyGeneration: policyGeneration(cfg) }
  const abort = new AbortController()
  const pending = broker.create(context, input, { signal: abort.signal })
  await saving.promise
  abort.abort(); release.resolve()
  const first = (await pending).job.id
  let terminal
  do { await pause(10); terminal = (await broker.detail(context, first)).job } while (terminal.state !== 'cancelled')
  assert.equal(calls.length, 0, 'revoked admission must never reach driver')
  await assert.rejects(broker.create(context, { ...input, requestId: 'already-aborted' }, { signal: abort.signal }), /POLICY_CHANGED/)
  blockAdmission = false
  const runningAbort = new AbortController()
  const second = (await broker.create(context, { ...input, requestId: 'cancel-running' }, { signal: runningAbort.signal })).job.id
  await started.promise
  runningAbort.abort()
  do { await pause(10); terminal = (await broker.detail(context, second)).job } while (terminal.state !== 'cancelled')
  assert.equal(calls.length, 1)
})


test('C09 sandbox enabled: every non-ready or stale broker state fails closed without generic DSH/web tools', async t => {
  const sandboxNames = ['sandbox_file_list', 'sandbox_file_read', 'sandbox_file_write', 'sandbox_python', 'sandbox_shell', 'sandbox_action']
  const qqNames = ['qq_send_text', 'qq_like_user', 'qq_poke_user']
  const cases = [
    ...['disabled', 'checking', 'unavailable', 'draining', 'failed'].map(state => ({ state })),
    { state: 'ready', policyGeneration: 'stale' }, {}, null, 'throws',
  ]
  for (const status of cases) {
    for (const turn of [owner, { ...owner, chatType: 'group' }]) {
      const e = runtimeEnv(t)
      e.broker.status = async () => {
        if (status === 'throws') throw Error('private broker detail')
        return status && { policyGeneration: policyGeneration(e.cfg), ...status }
      }
      const result = await compose(e, turn)
      assert.equal(result.ok, true, JSON.stringify(status))
      assert.equal(e.created[0].preset, turn.chatType === 'private' ? SANDBOX_PRIVATE_PRESET : SANDBOX_SOCIAL_PRESET)
      const names = [...e.agents.get(result.sessionId).registered.keys()]
      assert.deepEqual(names, turn.chatType === 'private' ? qqNames : [])
      assert.equal(names.some(name => sandboxNames.includes(name)), false)
      assert.equal(e.broker.calls.length, 0)
      e.runtime.dispose()
    }
  }
  // A ready fake broker proves the registration allowlist, never OS containment.
  const e = runtimeEnv(t), result = await compose(e)
  assert.deepEqual([...e.agents.get(result.sessionId).registered.keys()], [...qqNames, ...sandboxNames])
  assert.equal(e.created[0].preset, SANDBOX_PRIVATE_PRESET)
})
