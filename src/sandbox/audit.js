import { open, rename, readFile, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { privateDirectory } from './workspace.js'
import { fail } from './driver-contract.js'

const FIELDS = ['id', 'scope', 'kind', 'state', 'reason', 'at', 'createdAt', 'commandHash', 'requestHash', 'fingerprint', 'policyGeneration', 'outputBytes', 'artifact', 'exitCode']
export function createAudit({ root, capacity = 512 }) {
  let rows = [], chain = Promise.resolve(), loaded = false
  const initialize = async () => {
    if (loaded) return
    await privateDirectory(root)
    try {
      const h = await open(join(root, 'audit.json'), constants.O_RDONLY | constants.O_NOFOLLOW)
      let raw
      try { if ((await h.stat()).size > 1024 * 1024) fail('AUDIT_UNAVAILABLE'); raw = await h.readFile('utf8') } finally { await h.close() }
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed) || parsed.length > capacity) fail('AUDIT_UNAVAILABLE')
      rows = parsed.map(row => Object.fromEntries(FIELDS.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]])))
    } catch (e) { if (e.code !== 'ENOENT') fail('AUDIT_UNAVAILABLE') }
    loaded = true
  }
  const enqueue = work => {
    const next = chain.catch(() => {}).then(work); chain = next; return next
  }
  return {
    load: () => enqueue(async () => { await initialize(); return structuredClone(rows) }),
    append: entry => enqueue(async () => {
      let tmp
      try {
        await initialize()
        const row = Object.fromEntries(FIELDS.filter(k => Object.hasOwn(entry, k)).map(k => [k, entry[k]]))
        const next = [...rows, row].slice(-capacity)
        tmp = join(root, `.audit-${randomUUID()}`)
        const h = await open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try { await h.writeFile(JSON.stringify(next)); await h.sync() } finally { await h.close() }
        await rename(tmp, join(root, 'audit.json'))
        // Directory fsync is not available on Windows and must not make audit writes fail.
        if (process.platform !== 'win32') {
          const dir = await open(root, constants.O_RDONLY)
          try { await dir.sync() } finally { await dir.close() }
        }
        rows = next
      } catch { fail('AUDIT_UNAVAILABLE') }
      finally { if (tmp) await rm(tmp, { force: true }).catch(() => {}) }
    }),
  }
}
