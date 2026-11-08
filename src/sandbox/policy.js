import { createHash } from 'node:crypto'
import { relativePath } from './workspace.js'
import { fail } from './driver-contract.js'

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
export const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex')
export const SANDBOX_DEFAULTS = Object.freeze({
  enabled: false, driver: 'auto', network: false,
  limits: { concurrency: 2, jobs: 128, timeoutMs: 10000, outputBytes: 65536, memoryMiB: 128, processes: 32 },
  policy: { ownerPrivate: ['workspace', 'execute'], operatorPrivate: [], otherPrivate: [], group: [] },
})
export function normalizeSandbox(raw = {}) {
  const limit = (key, min, max) => Number.isInteger(raw?.limits?.[key]) ? Math.max(min, Math.min(max, raw.limits[key])) : SANDBOX_DEFAULTS.limits[key]
  const capabilities = key => Array.isArray(raw?.policy?.[key])
    ? ['workspace', 'execute'].filter(c => raw.policy[key].includes(c)) : [...SANDBOX_DEFAULTS.policy[key]]
  return {
    enabled: raw?.enabled === true, driver: ['auto', 'local-linux', 'unavailable'].includes(raw?.driver) ? raw.driver : 'auto', network: false,
    limits: { concurrency: limit('concurrency', 1, 4), jobs: limit('jobs', 1, 128), timeoutMs: limit('timeoutMs', 100, 30000), outputBytes: limit('outputBytes', 1024, 65536), memoryMiB: limit('memoryMiB', 32, 256), processes: limit('processes', 4, 64) },
    policy: Object.fromEntries(Object.keys(SANDBOX_DEFAULTS.policy).map(key => [key, capabilities(key)])),
  }
}
// Only trusted adapters call this; request bodies never supply identity/scope.
export function deriveScope(config, context) {
  if (!context || !['personaId', 'principalId', 'chatId', 'sessionId'].every(k => typeof context[k] === 'string' && context[k].length > 0 && context[k].length <= 128)) fail('SCOPE_UNAVAILABLE')
  if (!['private', 'group'].includes(context.chatType)) fail('SCOPE_UNAVAILABLE')
  const role = context.management === true ? 'owner' : config?.access?.ownerQQ && context.principalId === config.access.ownerQQ ? 'owner'
    : config?.access?.operators?.includes(context.principalId) ? 'operator' : 'other'
  const identity = [context.personaId, context.principalId, context.chatType, context.chatId, context.sessionId]
  return Object.freeze({ key: digest(identity), role, chatType: context.chatType })
}
export const policyGeneration = config => digest({ sandbox: normalizeSandbox(config?.sandbox), owner: config?.access?.ownerQQ || '', operators: config?.access?.operators || [] })
export function effectivePolicy(config, scope) {
  const settings = normalizeSandbox(config?.sandbox)
  const row = scope.chatType === 'group' ? 'group' : `${scope.role}Private`
  const capabilities = settings.enabled ? settings.policy[row] || [] : []
  return { ...settings, capabilities, generation: policyGeneration(config) }
}
export function validateJob(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || typeof input.kind !== 'string') fail('INVALID_SANDBOX_INPUT')
  const fields = {
    execute: ['kind', 'requestId', 'policyGeneration', 'code'],
    'file.write': ['kind', 'requestId', 'policyGeneration', 'path', 'content'],
    'file.read': ['kind', 'requestId', 'policyGeneration', 'path'],
    'file.list': ['kind', 'requestId', 'policyGeneration'],
    'file.delete': ['kind', 'requestId', 'policyGeneration', 'path'],
  }[input.kind]
  if (!fields || Object.keys(input).some(k => !fields.includes(k))) fail('INVALID_SANDBOX_INPUT')
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(input.requestId) || typeof input.policyGeneration !== 'string' || !/^[a-f0-9]{64}$/.test(input.policyGeneration)) fail('INVALID_SANDBOX_INPUT')
  if (input.kind === 'execute' && (typeof input.code !== 'string' || !input.code.trim() || Buffer.byteLength(input.code) > 16384 || input.code.includes('\0'))) fail('INVALID_SANDBOX_INPUT')
  if (fields.includes('path') && (typeof input.path !== 'string' || input.path.length > 240)) fail('INVALID_SANDBOX_INPUT')
  if (fields.includes('path')) relativePath(input.path)
  if (input.kind === 'file.write' && (typeof input.content !== 'string' || Buffer.byteLength(input.content) > 65536)) fail('INVALID_SANDBOX_INPUT')
  return structuredClone(input)
}
