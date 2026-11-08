import { publicError } from './service.js'
import { fail } from './driver-contract.js'

export const SANDBOX_BODY_BYTES = 96 * 1024
const ACTIONS = { status: [], probe: [], jobs: [], audit: [], create: null, detail: ['id'], cancel: ['id'], artifact: ['id'] }
export function createSandboxApi({ service, currentPersonaId, now = Date.now }) {
  let windowAt = now(), requests = 0, inFlight = 0
  // DSH's management webServer is the authenticated admin boundary. Never take
  // a QQ identity, role, workspace, env, session or persona from HTTP input.
  const context = () => ({ management: true, personaId: currentPersonaId(), principalId: 'management', chatType: 'private', chatId: 'management', sessionId: 'management' })
  return {
    async handle(action, input) {
      try {
        if (now() - windowAt >= 60000) { windowAt = now(); requests = 0 }
        if (++requests > 120 || inFlight >= 8) fail('SANDBOX_BUSY')
        if (!Object.hasOwn(ACTIONS, action) || !input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_SANDBOX_INPUT')
        const fields = ACTIONS[action]
        if (fields && Object.keys(input).some(k => !fields.includes(k))) fail('INVALID_SANDBOX_INPUT')
        if (fields?.includes('id') && !/^job_[a-f0-9-]{36}$/.test(input.id || '')) fail('JOB_NOT_FOUND')
        inFlight++
        try {
          const scope = context()
          let body
          if (action === 'status') body = await service.status(scope)
          if (action === 'probe') body = { ok: true, ...await service.probe({ force: true }) }
          if (action === 'audit') body = await service.audit(scope)
          if (action === 'jobs') body = await service.list(scope)
          if (action === 'create') body = await service.create(scope, input)
          if (action === 'detail') body = await service.detail(scope, input.id)
          if (action === 'cancel') body = await service.cancel(scope, input.id)
          if (action === 'artifact') body = await service.artifact(scope, input.id)
          return { status: 200, body }
        } finally { inFlight-- }
      } catch (e) {
        const code = publicError(e)
        const status = code === 'INVALID_SANDBOX_INPUT' || code.startsWith('WORKSPACE_') ? 400 : ['JOB_NOT_FOUND', 'ARTIFACT_NOT_FOUND'].includes(code) ? 404
          : code === 'POLICY_DENIED' ? 403 : ['POLICY_CHANGED', 'IDEMPOTENCY_CONFLICT'].includes(code) ? 409 : ['SANDBOX_BUSY', 'PROBE_BUSY'].includes(code) ? 429 : 503
        return { status, body: { ok: false, code, message: code } }
      }
    },
  }
}
