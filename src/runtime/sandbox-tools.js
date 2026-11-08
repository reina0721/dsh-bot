// Agent inputs describe jobs only. Identity, policy and cancellation stay in the runtime.
import { randomUUID } from 'node:crypto'
import { deriveScope, effectivePolicy, policyGeneration, validateJob } from '../sandbox/policy.js'
import { fail } from '../sandbox/driver-contract.js'
import { publicError } from '../sandbox/service.js'

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled', 'interrupted'])
const TOOL_ERRORS = new Set(['SESSION_REVOKED', 'PERSONA_CHANGED', 'SANDBOX_TIMEOUT', 'SANDBOX_CAPABILITY_UNAVAILABLE'])
const schema = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required })
const string = { type: 'string' }

export function sandboxContext(binding) {
  // Include the runtime environment and instance in the broker's existing session dimension.
  return Object.freeze({ personaId: binding.personaId, principalId: binding.principalId,
    chatType: binding.chatType, chatId: binding.chatId, sessionId: binding.scopeId })
}

export function checkSandboxBinding({ binding, getConfig, getPersona, isAdmitted = () => true }) {
  if (!isAdmitted()) fail('SESSION_REVOKED')
  const persona = getPersona()
  if (persona.id !== binding.personaId || persona.generation !== binding.personaGeneration) fail('PERSONA_CHANGED')
  const config = getConfig()
  if (policyGeneration(config) !== binding.policyGeneration) fail('POLICY_CHANGED')
  const policy = effectivePolicy(config, deriveScope(config, sandboxContext(binding)))
  if (!policy.enabled) fail('SANDBOX_DISABLED')
  return policy
}

export async function sandboxAdmission(options) {
  const policy = checkSandboxBinding(options)
  if (!options.broker) fail('SANDBOX_UNAVAILABLE')
  const status = await options.broker.status(sandboxContext(options.binding))
  checkSandboxBinding(options)
  if (status?.state !== 'ready') fail('SANDBOX_UNAVAILABLE')
  if (status.policyGeneration !== options.binding.policyGeneration) fail('POLICY_CHANGED')
  return policy
}

export function createSandboxTools(options) {
  const { broker, binding, signal, onRevoke = () => {} } = options
  const context = sandboxContext(binding)
  const check = () => checkSandboxBinding(options)
  const codeOf = error => TOOL_ERRORS.has(error?.code) ? error.code : publicError(error)
  const definitions = [
    ['sandbox_file_list', '列出当前沙盒工作区文件。', 'file.list', {}, []],
    ['sandbox_file_read', '读取当前沙盒工作区相对路径。', 'file.read', { path: string }, ['path']],
    ['sandbox_file_write', '写入当前沙盒工作区相对路径（UTF-8，最多 64 KiB）。', 'file.write', { path: string, content: string }, ['path', 'content']],
    ['sandbox_python', '当前最小驱动没有 Python；返回固定不可用代码。', 'python', { code: string }, ['code']],
    ['sandbox_shell', '在 broker 隔离环境执行有界 shell 作业，无网络。', 'execute', { code: string }, ['code']],
    ['sandbox_action', '仅支持删除当前工作区相对路径，不提供通用动作。', 'file.delete', { action: { type: 'string', enum: ['file.delete'] }, path: string }, ['action', 'path']],
  ]
  return definitions.map(([name, description, kind, properties, required]) => ({
    name, description, parameters: schema(properties, required),
    output: { schema: schema({ ok: { type: 'boolean' }, error: string, jobId: string, state: string,
      output: string, bytes: { type: 'integer' }, truncated: { type: 'boolean' } }, ['ok']),
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args) {
      let jobId, cancelled = false, expired = false, timer
      const cancel = () => {
        if (jobId && !cancelled) {
          cancelled = true
          void Promise.resolve().then(() => broker.cancel(context, jobId)).catch(() => {})
        }
      }
      const abort = new AbortController()
      const stop = () => { abort.abort(); cancel() }
      signal?.addEventListener('abort', stop, { once: true })
      if (signal?.aborted) stop()
      // Race waits with revocation, including an admission that returns after dispose.
      const wait = promise => {
        const work = Promise.resolve(promise)
        if (abort.signal.aborted) { work.catch(() => {}); return Promise.reject(Object.assign(Error('SESSION_REVOKED'), { code: expired ? 'SANDBOX_TIMEOUT' : 'SESSION_REVOKED' })) }
        return new Promise((resolve, reject) => {
          const interrupted = () => reject(Object.assign(Error('SESSION_REVOKED'), { code: expired ? 'SANDBOX_TIMEOUT' : 'SESSION_REVOKED' }))
          abort.signal.addEventListener('abort', interrupted, { once: true })
          work.then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', interrupted))
        })
      }
      const admit = async () => { if (abort.signal.aborted) fail(expired ? 'SANDBOX_TIMEOUT' : 'SESSION_REVOKED'); return wait(sandboxAdmission(options)) }
      try {
        timer = setTimeout(() => { expired = true; stop(); onRevoke('SANDBOX_TIMEOUT') }, 35000)
        const admittedPolicy = await admit()
        if (!admittedPolicy.capabilities.includes(['execute', 'python'].includes(kind) ? 'execute' : 'workspace')) fail('POLICY_DENIED')
        if (!args || typeof args !== 'object' || Array.isArray(args)
          || Object.keys(args).some(key => !Object.hasOwn(properties, key))
          || required.some(key => typeof args[key] !== 'string')
          || (name === 'sandbox_action' && args.action !== 'file.delete')) fail('INVALID_SANDBOX_INPUT')
        if (kind === 'python') fail('SANDBOX_CAPABILITY_UNAVAILABLE')
        const input = validateJob({ kind, requestId: randomUUID(), policyGeneration: binding.policyGeneration,
          ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'action')) })
        const policy = check()
        if (!policy.capabilities.includes(kind === 'execute' ? 'execute' : 'workspace')) fail('POLICY_DENIED')
        const creation = Promise.resolve(broker.create(context, input, { signal: abort.signal })).then(result => {
          jobId = result?.job?.id
          if (abort.signal.aborted) cancel()
          return result
        })
        let job = (await wait(creation))?.job
        if (!/^job_[a-f0-9-]{36}$/.test(jobId || '')) fail('SANDBOX_UNAVAILABLE')
        while (true) {
          await admit()
          if (TERMINAL.has(job?.state)) break
          await wait(new Promise(resolve => setTimeout(resolve, 25)))
          job = (await wait(broker.detail(context, jobId)))?.job
        }
        if (job.state !== 'succeeded') {
          const error = job.reason === 'TIMEOUT' ? 'SANDBOX_TIMEOUT' : job.state === 'cancelled' ? 'SESSION_REVOKED' : 'SANDBOX_UNAVAILABLE'
          if (['SANDBOX_TIMEOUT', 'SESSION_REVOKED'].includes(error)) onRevoke(error)
          return { ok: false, error }
        }
        let output = '', bytes = 0, truncated = false
        if (job.artifact) {
          const artifact = await wait(broker.artifact(context, jobId))
          await admit()
          if (artifact?.encoding !== 'base64' || typeof artifact.content !== 'string' || artifact.content.length > 87384
            || !Number.isInteger(artifact.bytes) || artifact.bytes < 0 || artifact.bytes > 65536) fail('SANDBOX_UNAVAILABLE')
          const data = Buffer.from(artifact.content, 'base64')
          if (data.length !== artifact.bytes || data.toString('base64') !== artifact.content) fail('SANDBOX_UNAVAILABLE')
          // Invalid UTF-8 expands into replacement characters. Bound encoded output too.
          const text = Buffer.from(data.subarray(0, 16384).toString('utf8'))
          bytes = data.length; truncated = bytes > 16384 || text.length > 16384
          output = new TextDecoder().decode(text.subarray(0, 16384), { stream: true })
        }
        check()
        return { ok: true, jobId, state: 'succeeded', output, bytes, truncated }
      } catch (error) {
        cancel()
        const code = codeOf(error)
        if (['SESSION_REVOKED', 'PERSONA_CHANGED', 'POLICY_CHANGED', 'SANDBOX_DISABLED', 'SANDBOX_UNAVAILABLE'].includes(code)) onRevoke(code)
        return { ok: false, error: code }
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
      }
    },
  }))
}
