import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { assertDriver, fail, reasonCode } from './driver-contract.js'
import { digest, deriveScope, effectivePolicy, normalizeSandbox, policyGeneration, validateJob } from './policy.js'
import { createWorkspace, privateDirectory } from './workspace.js'
import { createAudit } from './audit.js'
import { fileWorker } from './file-worker.js'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
const SAFE_ERRORS = new Set(['INVALID_SANDBOX_INPUT', 'POLICY_CHANGED', 'POLICY_DENIED', 'SCOPE_UNAVAILABLE', 'SANDBOX_DISABLED', 'SANDBOX_UNAVAILABLE', 'SANDBOX_DRAINING', 'SANDBOX_BUSY', 'JOB_NOT_FOUND', 'ARTIFACT_NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'AUDIT_UNAVAILABLE', 'WORKSPACE_PATH_INVALID', 'WORKSPACE_UNSAFE', 'WORKSPACE_QUOTA', 'PROBE_BUSY', 'DRIVER_FAILED'])
export const publicError = e => SAFE_ERRORS.has(e?.code) ? e.code : e?.code === 'ENOENT' ? 'ARTIFACT_NOT_FOUND' : 'SANDBOX_UNAVAILABLE'
export function createSandboxService({ root, getConfig, driver, audit = createAudit({ root: join(root, 'audit') }), workspace = createWorkspace({ root: join(root, 'workspace') }), now = Date.now }) {
  assertDriver(driver)
  const jobs = new Map(), controllers = new Map()
  let chain = Promise.resolve(), running = 0, stopping = false, auditFailed = false, probePromise, probedGeneration = null, lastProbe = -Infinity
  let readiness = 'disabled', reason = 'DISABLED'
  const serial = work => { const next = chain.catch(() => {}).then(work); chain = next; return next }
  const init = privateDirectory(root).then(() => audit.load()).then(async rows => {
    for (const row of rows) if (/^job_[a-f0-9-]{36}$/.test(row.id)) {
      if (row.state === 'forgotten') jobs.delete(row.id)
      else jobs.set(row.id, { ...row })
    }
    for (const row of jobs.values()) if (!TERMINAL.has(row.state)) {
      row.state = 'interrupted'; row.reason = 'RESTARTED'; row.at = now(); row.artifact = false
      await audit.append(row)
    }
    while (jobs.size > 128) {
      const oldest = jobs.values().next().value
      await audit.append({ ...oldest, state: 'forgotten', at: now() })
      await rm(join(root, 'artifacts', oldest.id), { force: true })
      jobs.delete(oldest.id)
    }
  }).catch(() => { auditFailed = true; readiness = 'failed'; reason = 'AUDIT_UNAVAILABLE' })
  const policy = context => {
    const config = getConfig(), scope = deriveScope(config, context)
    return { scope, effective: effectivePolicy(config, scope) }
  }
  const refresh = () => {
    const cfg = normalizeSandbox(getConfig()?.sandbox), generation = policyGeneration(getConfig())
    if (stopping) { readiness = 'draining'; reason = 'DRAINING' }
    else if (auditFailed) { readiness = 'failed'; reason = 'AUDIT_UNAVAILABLE' }
    else if (!cfg.enabled) { readiness = 'disabled'; reason = 'DISABLED'; probedGeneration = null }
    else if (probedGeneration !== generation) { readiness = 'checking'; reason = 'CHECKING' }
    for (const [id, ctl] of controllers) if (stopping || !cfg.enabled || jobs.get(id)?.policyGeneration !== generation || auditFailed || (readiness === 'failed' && jobs.get(id)?.kind === 'execute')) ctl.abort()
    return cfg
  }
  const save = async row => {
    try { await audit.append(row) } catch { auditFailed = true; refresh(); fail('AUDIT_UNAVAILABLE') }
  }
  const view = row => ({ id: row.id, kind: row.kind, state: row.state, reason: row.reason || null, createdAt: row.createdAt, updatedAt: row.at,
    policyGeneration: row.policyGeneration, commandHash: row.commandHash, outputBytes: row.outputBytes || 0, artifact: row.artifact === true, exitCode: row.exitCode ?? null })
  const owned = (context, id) => {
    const { scope } = policy(context), row = jobs.get(id)
    if (!row || row.scope !== scope.key) fail('JOB_NOT_FOUND')
    return row
  }
  const artifactPath = id => join(root, 'artifacts', id)
  const persistArtifact = async (row, data, cap) => {
    const content = Buffer.from(data).subarray(0, cap)
    await privateDirectory(join(root, 'artifacts'))
    const h = await open(artifactPath(row.id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
    try { await h.writeFile(content); await h.sync() } finally { await h.close() }
    row.outputBytes = content.length; row.artifact = true
  }
  async function perform(original, input, context, admissionSignal) {
    const row = { ...original }
    const ctl = new AbortController(); controllers.set(row.id, ctl); running++
    const revoke = () => ctl.abort()
    admissionSignal?.addEventListener('abort', revoke, { once: true })
    if (admissionSignal?.aborted) revoke()
    try {
      if (ctl.signal.aborted) return
      await workspace.locked(row.scope, async base => {
        const { scope, effective } = policy(context)
        refresh()
        if (scope.key !== row.scope || row.policyGeneration !== effective.generation || !effective.enabled) fail('POLICY_CHANGED')
        if (ctl.signal.aborted) return
        row.state = 'running'; row.at = now(); await save(row)
        if (ctl.signal.aborted || policy(context).effective.generation !== row.policyGeneration) { ctl.abort(); return }
        jobs.set(row.id, { ...row })
        if (input.kind === 'execute') {
          if (readiness !== 'ready') fail('SANDBOX_UNAVAILABLE')
          const snapshot = await workspace.snapshot(base)
          let result
          try {
            if (ctl.signal.aborted || policy(context).effective.generation !== row.policyGeneration) { ctl.abort(); return }
            result = await driver.execute({ code: input.code, snapshot: snapshot.path, limits: effective.limits, signal: ctl.signal })
          } catch { readiness = 'failed'; reason = 'DRIVER_FAILED'; fail('DRIVER_FAILED') }
          finally { await snapshot.dispose() }
          if (!result || !['EXITED', 'TIMEOUT', 'OUTPUT_LIMIT', 'MEMORY_LIMIT', 'PROCESS_LIMIT', 'CANCELLED'].includes(result.reason)) {
            readiness = 'failed'; reason = 'DRIVER_FAILED'; fail('DRIVER_FAILED')
          }
          row.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null
          row.reason = result.reason
          row.state = result.reason === 'CANCELLED' ? 'cancelled' : result.reason === 'EXITED' && row.exitCode === 0 ? 'succeeded' : 'failed'
          await persistArtifact(row, result.output || '', effective.limits.outputBytes)
        } else {
          const result = await fileWorker(workspace, base, input)
          if (result.artifact) await persistArtifact(row, result.artifact, effective.limits.outputBytes)
          // Listings contain only broker workspace paths, never host paths.
          if (input.kind === 'file.list') await persistArtifact(row, JSON.stringify(result), effective.limits.outputBytes)
          row.state = 'succeeded'; row.reason = 'COMPLETED'
        }
      })
      if (ctl.signal.aborted) { row.state = 'cancelled'; row.reason = 'CANCELLED' }
    } catch (e) {
      row.state = ctl.signal.aborted ? 'cancelled' : 'failed'; row.reason = ctl.signal.aborted ? 'CANCELLED' : publicError(e)
      if (e?.code === 'DRIVER_FAILED') { readiness = 'failed'; reason = 'DRIVER_FAILED' }
    } finally {
      if (!TERMINAL.has(row.state)) { row.state = 'cancelled'; row.reason = 'CANCELLED' }
      row.at = now()
      await save(row).catch(() => { row.reason = 'AUDIT_UNAVAILABLE'; row.state = 'failed' })
      jobs.set(row.id, { ...row })
      admissionSignal?.removeEventListener('abort', revoke)
      controllers.delete(row.id); running--
      pump()
    }
  }
  const pending = new Map()
  function pump() {
    const cfg = refresh()
    for (const [id, item] of pending) {
      if (running >= cfg.limits.concurrency) break
      pending.delete(id)
      if (jobs.get(id)?.state !== 'queued') continue
      void perform(jobs.get(id), item.input, item.context, item.admissionSignal)
    }
  }
  const monitor = setInterval(() => { refresh(); pump() }, 100)
  monitor.unref()
  const api = {
    async status(context) {
      await init; refresh()
      const { effective } = policy(context)
      return { ok: true, state: readiness, reason, driver: driver.name, network: false, policyGeneration: effective.generation, capabilities: effective.capabilities,
        workspaceAvailable: effective.capabilities.includes('workspace') && !stopping && !auditFailed,
        running, queued: pending.size, limits: effective.limits }
    },
    async probe({ force = false } = {}) {
      await init
      const cfg = refresh()
      if (!cfg.enabled || stopping || auditFailed) return { state: readiness, reason }
      if (probePromise) return probePromise
      if (running || (force && now() - lastProbe < 60000)) fail('PROBE_BUSY')
      lastProbe = now(); readiness = 'checking'; reason = 'CHECKING'
      const generation = policyGeneration(getConfig())
      probePromise = (async () => {
        try {
          const result = await driver.probe()
          if (policyGeneration(getConfig()) !== generation || stopping) { refresh(); return { state: readiness, reason } }
          probedGeneration = generation; readiness = result?.ready === true ? 'ready' : 'unavailable'; reason = result?.ready === true ? 'READY' : reasonCode(result?.reason)
        } catch { probedGeneration = generation; readiness = 'unavailable'; reason = 'PROBE_FAILED' }
        finally { probePromise = null }
        return { state: readiness, reason }
      })()
      return probePromise
    },
    // Internal AbortSignal is never read from job/HTTP input; rechecked before execution.
    create: (context, raw, { signal: admissionSignal } = {}) => serial(async () => {
      await init;
      if (admissionSignal?.aborted) fail('POLICY_CHANGED')
      const input = validateJob(raw), { scope, effective } = policy(context)
      refresh()
      if (stopping) fail('SANDBOX_DRAINING')
      if (auditFailed) fail('AUDIT_UNAVAILABLE')
      if (!effective.enabled) fail('SANDBOX_DISABLED')
      if (input.policyGeneration !== effective.generation) fail('POLICY_CHANGED')
      if (!effective.capabilities.includes(input.kind === 'execute' ? 'execute' : 'workspace')) fail('POLICY_DENIED')
      const requestHash = digest([scope.key, input.requestId]), fingerprint = digest(input)
      const previous = [...jobs.values()].find(row => row.requestHash === requestHash)
      if (previous) { if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT'); return { ok: true, job: view(previous), reused: true } }
      if (input.kind === 'execute' && readiness !== 'ready') fail('SANDBOX_UNAVAILABLE')
      while (jobs.size >= effective.limits.jobs) {
        const oldest = [...jobs.values()].find(row => TERMINAL.has(row.state))
        if (!oldest) fail('SANDBOX_BUSY')
        await save({ ...oldest, state: 'forgotten', at: now() })
        jobs.delete(oldest.id)
        await rm(artifactPath(oldest.id), { force: true })
      }
      const row = { id: 'job_' + randomUUID(), scope: scope.key, kind: input.kind, state: 'queued', createdAt: now(), at: now(),
        commandHash: digest(input.kind === 'execute' ? input.code : { kind: input.kind, path: input.path, content: input.content }), requestHash, fingerprint, policyGeneration: effective.generation, artifact: false, outputBytes: 0 }
      await save(row) // Durable admission precedes every side effect.
      jobs.set(row.id, row)
      pending.set(row.id, { input, context: structuredClone(context), admissionSignal })
      setImmediate(pump)
      return { ok: true, job: view(row), reused: false }
    }),
    async list(context) { await init; const { scope } = policy(context); return { ok: true, items: [...jobs.values()].filter(row => row.scope === scope.key).slice(-128).map(view) } },
    async audit(context) {
      await init; if (auditFailed) fail('AUDIT_UNAVAILABLE')
      const { scope } = policy(context)
      return { ok: true, items: (await audit.load()).filter(row => row.scope === scope.key).slice(-128).map(view) }
    },
    async detail(context, id) { await init; return { ok: true, job: view(owned(context, id)) } },
    cancel: (context, id) => serial(async () => {
      await init; const row = owned(context, id)
      if (TERMINAL.has(row.state)) return { ok: true, job: view(row) }
      // Persist cancellation intent before interrupting. Audit outage still
      // aborts running jobs through refresh(), never permits more admissions.
      await save({ ...row, state: 'cancelling', at: now() })
      const current = owned(context, id)
      if (TERMINAL.has(current.state)) { await save(current); return { ok: true, job: view(current) } }
      if (pending.delete(id)) { current.state = 'cancelled'; current.reason = 'CANCELLED'; current.at = now(); await save(current) }
      else { current.state = 'cancelling'; current.at = now(); controllers.get(id)?.abort() }
      return { ok: true, job: view(current) }
    }),
    async artifact(context, id) {
      await init; if (auditFailed) fail('AUDIT_UNAVAILABLE'); const row = owned(context, id)
      if (!TERMINAL.has(row.state) || !row.artifact) fail('ARTIFACT_NOT_FOUND')
      await privateDirectory(join(root, 'artifacts'))
      const h = await open(artifactPath(row.id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      try { const st = await h.stat(); if (!st.isFile() || st.nlink !== 1 || st.size > 65536) fail('ARTIFACT_NOT_FOUND'); return { ok: true, id, encoding: 'base64', bytes: st.size, content: (await h.readFile()).toString('base64') } }
      finally { await h.close() }
    },
    async dispose() {
      stopping = true; refresh(); clearInterval(monitor)
      await chain.catch(() => {})
      for (const id of pending.keys()) { const row = jobs.get(id); row.state = 'cancelled'; row.reason = 'DRAINING'; row.at = now(); await save(row).catch(() => {}) }
      pending.clear()
      while (running) await new Promise(resolve => setTimeout(resolve, 10))
      if (probePromise) await probePromise
      await driver.dispose?.()
    },
  }
  return api
}
