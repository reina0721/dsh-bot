import { constants } from 'node:fs'
import { mkdir, lstat, readdir, open, rename, unlink, rm } from 'node:fs/promises'
import { resolve, join, dirname, parse, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fail } from './driver-contract.js'

export const WORKSPACE_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, entries: 1024 })
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || value.includes('\\') || value.includes('\0') || value.split('/').some(p => !p || p === '.' || p === '..' || !/^[\p{L}\p{N}_. -]+$/u.test(p))) fail('WORKSPACE_PATH_INVALID')
  return value
}
// Reject symbolic ancestors, including a redirected data root. These directories
// are private to the broker; no untrusted process ever receives a writable bind.
export async function privateDirectory(path) {
  const absolute = resolve(path), root = parse(absolute).root
  let current = root
  for (const part of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, part)
    try { await mkdir(current, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    const st = await lstat(current)
    if (!st.isDirectory() || st.isSymbolicLink()) fail('WORKSPACE_UNSAFE')
    if (process.platform !== 'win32') {
      const trustedOwner = st.uid === 0 || st.uid === process.getuid()
      const stickyRoot = st.uid === 0 && (st.mode & 0o1000)
      if (!trustedOwner || ((st.mode & 0o022) && !stickyRoot)) fail('WORKSPACE_UNSAFE')
    }
  }
  const final = await lstat(absolute)
  if (process.platform !== 'win32' && ((final.mode & 0o022) || final.uid !== process.getuid())) fail('WORKSPACE_UNSAFE')
  return absolute
}
export function createWorkspace({ root, limits = WORKSPACE_LIMITS }) {
  const queues = new Map()
  const cap = { bytes: Math.min(limits.bytes, WORKSPACE_LIMITS.bytes), entries: Math.min(limits.entries, WORKSPACE_LIMITS.entries) }
  const directory = async key => {
    if (!/^[a-f0-9]{64}$/.test(key)) fail('SCOPE_UNAVAILABLE')
    await privateDirectory(root)
    return privateDirectory(join(root, 'scopes', key))
  }
  const scan = async base => {
    const entries = []; let bytes = 0
    async function walk(dir, prefix = '') {
      for (const name of await readdir(dir)) {
        const path = prefix + name, st = await lstat(join(dir, name))
        if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile()) || (st.isFile() && st.nlink !== 1)) fail('WORKSPACE_UNSAFE')
        if (st.isFile()) bytes += st.size
        entries.push({ path, directory: st.isDirectory(), bytes: st.isFile() ? st.size : 0 })
        if (bytes > cap.bytes || entries.length > cap.entries) fail('WORKSPACE_QUOTA')
        if (st.isDirectory()) await walk(join(dir, name), path + '/')
      }
    }
    await walk(base)
    return { entries, bytes }
  }
  const read = async (base, path, maxBytes = cap.bytes) => {
    relativePath(path)
    const pieces = path.split('/'); let target = base
    for (const piece of pieces) {
      target = join(target, piece)
      const st = await lstat(target)
      if (st.isSymbolicLink()) fail('WORKSPACE_UNSAFE')
    }
    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
    try {
      const st = await handle.stat()
      if (!st.isFile() || st.nlink !== 1) fail('WORKSPACE_UNSAFE')
      if (st.size > maxBytes) fail('WORKSPACE_QUOTA')
      return await handle.readFile()
    } finally { await handle.close() }
  }
  async function locked(key, work) {
    const previous = queues.get(key) || Promise.resolve()
    const next = previous.catch(() => {}).then(async () => {
      const base = await directory(key)
      await scan(base)
      return work(base)
    })
    queues.set(key, next)
    try { return await next } finally { if (queues.get(key) === next) queues.delete(key) }
  }
  const write = async (base, path, content) => {
    relativePath(path)
    const before = await scan(base), data = Buffer.from(content)
    const existing = before.entries.find(e => e.path === path)
    if (existing?.directory) fail('WORKSPACE_PATH_INVALID')
    const missing = []; let prefix = ''
    for (const piece of path.split('/').slice(0, -1)) {
      prefix += (prefix ? '/' : '') + piece
      const found = before.entries.find(e => e.path === prefix)
      if (found && !found.directory) fail('WORKSPACE_PATH_INVALID')
      if (!found) missing.push(prefix)
    }
    if (before.bytes - (existing?.bytes || 0) + data.length > cap.bytes || before.entries.length + missing.length + (existing ? 0 : 1) > cap.entries) fail('WORKSPACE_QUOTA')
    for (const dir of missing) await mkdir(join(base, dir), { mode: 0o700 })
    const tmp = join(base, `.write-${randomUUID()}`)
    const handle = await open(tmp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(data); await handle.sync() } finally { await handle.close() }
    try { await rename(tmp, join(base, path)) } finally { await rm(tmp, { force: true }) }
    return { bytes: data.length }
  }
  return {
    locked, scan, read, write,
    remove: async (base, path) => { relativePath(path); await read(base, path); await unlink(join(base, path)); return {} },
    snapshot: async base => {
      const state = await scan(base)
      const target = await privateDirectory(join(root, 'snapshots', randomUUID()))
      try {
        for (const entry of state.entries) {
          const dest = join(target, entry.path)
          if (entry.directory) await mkdir(dest, { recursive: true, mode: 0o700 })
          else {
            await mkdir(dirname(dest), { recursive: true, mode: 0o700 })
            const handle = await open(dest, 'wx', 0o400)
            try { await handle.writeFile(await read(base, entry.path)) } finally { await handle.close() }
          }
        }
        return { path: target, dispose: () => rm(target, { recursive: true, force: true }) }
      } catch (e) { await rm(target, { recursive: true, force: true }); throw e }
    },
  }
}
