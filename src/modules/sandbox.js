// Public UI files only. This protects the browser boundary, not same-process backend JS.
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { extname, join, sep } from 'node:path'

export const MODULE_UI_PREFIX = '/onebot-qq/module-ui/'
export const SANDBOX_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"
export const UI_MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' })
const MAX_FILES = 128, MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_TOTAL_BYTES = 8 * 1024 * 1024
export const validPublicPath = (path) => typeof path === 'string' && path.length <= 250 && path.split('/').length <= 8 && path.split('/').every((part) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(part) && !['config', 'data'].includes(part)) && Object.hasOwn(UI_MIME, extname(path))
const fail = () => { throw Error('MODULE_UI_UNAVAILABLE') }

/** Hash exactly the bounded public artifact; serve these same bytes after verification. */
export async function readUiArtifact(root, record) {
  const moduleDir = join(await realpath(root), record.id), publicDir = join(moduleDir, 'webui')
  // Disallow even contained links, including a replaced installed module directory.
  for (const dir of [moduleDir, publicDir]) {
    const info = await lstat(dir)
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(dir) !== dir) fail()
  }
  if (await realpath(moduleDir) !== record.moduleDir) fail()
  const files = new Map(), hash = createHash('sha256')
  let total = 0, visited = 0
  async function walk(dir, prefix = '') {
    for (const row of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 256) fail()
      const name = prefix + row.name, file = join(dir, row.name)
      if (row.isSymbolicLink()) fail()
      if (!/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(row.name) || ['config', 'data'].includes(row.name)) continue
      if (name.length > 250 || name.split('/').length > 8) fail()
      if (row.isDirectory()) { await walk(file, name + '/'); continue }
      if (!validPublicPath(name)) continue
      if (files.size >= MAX_FILES || !row.isFile()) fail()
      if (await realpath(file) !== file || !(await realpath(file)).startsWith(publicDir + sep)) fail()
      const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
      let body
      try {
        const info = await handle.stat()
        if (!info.isFile() || info.size > MAX_FILE_BYTES || (total += info.size) > MAX_TOTAL_BYTES) fail()
        // Bounded read, even if a local writer grows the file after stat.
        body = Buffer.alloc(info.size + 1)
        let offset = 0
        while (offset < body.length) {
          const { bytesRead } = await handle.read(body, offset, body.length - offset, offset)
          if (!bytesRead) break
          offset += bytesRead
        }
        if (offset !== info.size) fail()
        body = body.subarray(0, offset)
      } finally { await handle.close() }
      files.set(name, body)
      hash.update(JSON.stringify([name, body.length])).update(body)
    }
  }
  await walk(publicDir)
  if (!files.has(record.ui.sandbox.entry.slice('webui/'.length))) fail()
  return { hash: hash.digest('hex'), files }
}

export function createModuleUiHandler(modules) {
  return async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('content-security-policy', SANDBOX_CSP)
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    const missing = () => { res.statusCode = 404; res.setHeader('content-type', 'text/plain; charset=utf-8'); res.end(req.method === 'HEAD' ? undefined : 'Not found') }
    try {
      if (!['GET', 'HEAD'].includes(req.method)) return missing()
      const raw = String(req.url || '').split('?')[0]
      if (!raw.startsWith(MODULE_UI_PREFIX)) return missing()
      const decoded = decodeURIComponent(raw.slice(MODULE_UI_PREFIX.length))
      const [id, generation, ...parts] = decoded.split('/')
      const path = parts.join('/')
      if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(id) || !/^[a-zA-Z0-9-]{1,64}$/.test(generation) || !validPublicPath(path)) return missing()
      const asset = await modules.readSandboxAsset(id, generation, path)
      if (!asset) return missing()
      res.statusCode = 200
      res.setHeader('content-type', UI_MIME[extname(path)])
      res.setHeader('content-length', asset.length)
      res.end(req.method === 'HEAD' ? undefined : asset)
    } catch { missing() }
  }
}
