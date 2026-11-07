// One process owns this file. It is an audit, never a recovery queue.
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export const ACTION_AUDIT_LIMIT = 128
export const ACTION_AUDIT_TTL_MS = 3600000
export const ACTION_AUDIT_MAX_BYTES = 256 * 1024

export function createActionAudit({ file } = {}) {
  return Object.freeze({
    load() {
      try {
        if (statSync(file).size > ACTION_AUDIT_MAX_BYTES) throw Error('audit too large')
        const data = JSON.parse(readFileSync(file, 'utf8'))
        if (data?.version !== 1 || !Array.isArray(data.operations) || data.operations.length > ACTION_AUDIT_LIMIT) throw Error('invalid audit')
        return data.operations
      } catch (error) {
        if (error.code === 'ENOENT') return []
        throw Object.assign(new Error('MODULE_AUDIT_READ_FAILED'), { code: 'MODULE_AUDIT_READ_FAILED' })
      }
    },
    save(operations) {
      const value = JSON.stringify({ version: 1, operations })
      if (operations.length > ACTION_AUDIT_LIMIT || Buffer.byteLength(value) > ACTION_AUDIT_MAX_BYTES) throw Error('audit too large')
      mkdirSync(dirname(file), { recursive: true })
      const temp = `${file}.${randomUUID()}.tmp`
      let fd
      try {
        fd = openSync(temp, 'wx', 0o600)
        writeFileSync(fd, value, 'utf8')
        fsyncSync(fd)
        closeSync(fd); fd = undefined
        renameSync(temp, file)
      } finally {
        if (fd !== undefined) closeSync(fd)
        try { unlinkSync(temp) } catch {}
      }
    },
  })
}
