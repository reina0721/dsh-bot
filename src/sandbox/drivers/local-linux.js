import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { access, readFile, writeFile, mkdir, rm, lstat, copyFile, realpath, rmdir, readlink } from 'node:fs/promises'
import { join, dirname, resolve, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { privateDirectory, WORKSPACE_LIMITS } from '../workspace.js'
import { fail } from '../driver-contract.js'

const exec = promisify(execFile)
const ENV = Object.freeze({ PATH: '/bin', HOME: '/work', LANG: 'C', LC_ALL: 'C', TMPDIR: '/work' })
const HOST_ENV = Object.freeze({ PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' })
const BWRAP = '/usr/bin/bwrap'
// Fixed trusted system utilities and their resolved ELF libraries only. Never
// bind /, /usr, /lib, host HOME, repository, DSH, sockets or device trees.
const BINARIES = ['dash', 'cat', 'sleep', 'env', 'head', 'yes', 'wc', 'ls']
export function createLocalLinuxDriver({ root }) {
  let rootfs, cgroup, prepared = false, disposed = false, poisoned = false
  const prepareRoot = async () => {
    rootfs = await privateDirectory(join(root, 'rootfs-' + randomUUID()))
    const copy = async (source, target) => {
      const actual = await realpath(source), st = await lstat(actual)
      if (!st.isFile() || (st.mode & 0o6022) || st.uid !== 0) fail('ROOTFS_UNSAFE')
      await mkdir(dirname(join(rootfs, target)), { recursive: true, mode: 0o700 })
      await copyFile(actual, join(rootfs, target))
    }
    for (const name of BINARIES) {
      const binary = await realpath('/usr/bin/' + name)
      await copy(binary, 'bin/' + (name === 'dash' ? 'sh' : name))
      const result = await exec('/usr/bin/ldd', [binary], { env: HOST_ENV, timeout: 1000, maxBuffer: 65536 })
      for (const line of result.stdout.split('\n')) {
        const lib = line.match(/(?:=>\s*)?(\/[^\s]+)\s+\(/)?.[1]
        if (lib) await copy(lib, lib.slice(1))
        if (/not found/.test(line)) fail('ROOTFS_UNSAFE')
      }
    }
    for (const dir of ['work', 'workspace', 'proc', 'dev', 'tmp']) await mkdir(join(rootfs, dir), { recursive: true, mode: 0o755 })
  }
  const prepareCgroup = async () => {
    // Only use the process's existing delegation, never enable controllers on
    // the host's shared parent or accept a caller-controlled cgroup path.
    const membership = (await readFile('/proc/self/cgroup', 'utf8')).trim().match(/^0::([^\n]+)$/)?.[1]
    if (!membership || !isAbsolute(membership) || membership.split('/').includes('..')) fail('CGROUP_UNAVAILABLE')
    const parent = resolve('/sys/fs/cgroup', '.' + membership)
    if (parent !== '/sys/fs/cgroup' && !parent.startsWith('/sys/fs/cgroup/')) fail('CGROUP_UNAVAILABLE')
    cgroup = join(parent, 'dsh-sandbox-' + randomUUID())
    await mkdir(cgroup)
    const controllers = (await readFile(join(cgroup, 'cgroup.controllers'), 'utf8')).split(/\s+/)
    if (!['memory', 'pids', 'cpu'].every(c => controllers.includes(c))) fail('CGROUP_UNAVAILABLE')
    await writeFile(join(cgroup, 'cgroup.subtree_control'), '+memory +pids +cpu')
    const test = join(cgroup, 'check')
    await mkdir(test)
    try {
      for (const file of ['memory.max', 'memory.swap.max', 'memory.oom.group', 'pids.max', 'cpu.max', 'cgroup.kill']) await access(join(test, file), constants.W_OK)
      await writeFile(join(test, 'cgroup.kill'), '1')
    } finally { await rmdir(test).catch(() => {}) }
  }
  const argsFor = snapshot => {
    const args = ['--unshare-all', '--unshare-user', '--unshare-cgroup', '--die-with-parent', '--new-session', '--disable-userns', '--cap-drop', 'ALL', '--clearenv', '--info-fd', '4', '--ro-bind', rootfs, '/', '--dev', '/dev', '--size', String(WORKSPACE_LIMITS.bytes), '--tmpfs', '/work', '--size', '1048576', '--tmpfs', '/tmp', '--chdir', '/work']
    if (snapshot) args.push('--ro-bind', snapshot, '/workspace')
    for (const [k, v] of Object.entries(ENV)) args.push('--setenv', k, v)
    return args
  }
  async function run({ code, snapshot, limits, signal }) {
    if (!prepared || disposed) fail('DRIVER_UNAVAILABLE')
    if (signal?.aborted) return { reason: 'CANCELLED', output: '', exitCode: null }
    const group = join(cgroup, 'job-' + randomUUID())
    await mkdir(group)
    let child, timer, killing, output = Buffer.alloc(0), reason = null, killError = false, started = false, handshake = '', namespaceInfo = ''
    const kill = why => {
      reason ||= why
      // cgroup.kill is authoritative, process group is additional cleanup.
      if (killing) return killing
      killing = writeFile(join(group, 'cgroup.kill'), '1').catch(() => { killError = true }).finally(() => {
        if (child?.pid) { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      })
      return killing
    }
    const abort = () => { void kill('CANCELLED') }
    try {
      await writeFile(join(group, 'memory.max'), String(limits.memoryMiB * 1024 * 1024))
      await writeFile(join(group, 'memory.swap.max'), '0')
      await writeFile(join(group, 'memory.oom.group'), '1')
      await writeFile(join(group, 'pids.max'), String(limits.processes))
      await writeFile(join(group, 'cpu.max'), '100000 100000')
      // Gate the trusted launcher until enrolled: untrusted code can never run
      // between spawn() and cgroup.procs. No user value enters launcher syntax.
      child = spawn('/bin/sh', ['-c', 'ulimit -c 0; read -r gate; [ "$gate" = run ] || exit 125; exec "$@"', 'sandbox', BWRAP, ...argsFor(snapshot), '/bin/sh', '-c', 'printf \'BROKER_READY\\n\' >&3; exec 3>&-; exec /bin/sh -c "$1"', 'sandbox', code], { env: HOST_ENV, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'] })
      const ended = new Promise((resolveEnd, reject) => { child.once('error', reject); child.once('close', (exitCode, sig) => resolveEnd({ exitCode, signal: sig })) })
      child.stdin.on('error', () => {})
      child.stdio[4].on('data', chunk => { namespaceInfo += chunk.toString(); if (namespaceInfo.length > 4096) void kill('DRIVER_FAILED') })
      child.stdio[3].on('data', chunk => { handshake += chunk.toString(); if (handshake.length > 64) void kill('DRIVER_FAILED'); started = handshake === 'BROKER_READY\n' })
      for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
        const room = limits.outputBytes - output.length
        output = Buffer.concat([output, chunk.subarray(0, Math.max(0, room))])
        if (chunk.length > room) void kill('OUTPUT_LIMIT')
      })
      timer = setTimeout(() => { void kill('TIMEOUT') }, limits.timeoutMs)
      signal?.addEventListener('abort', abort, { once: true })
      try {
        await writeFile(join(group, 'cgroup.procs'), String(child.pid))
        if (signal?.aborted) await kill('CANCELLED')
        else child.stdin.end('run\n')
      } catch { await kill('DRIVER_FAILED') }
      const result = await ended
      await kill(reason || 'EXITED')
      const events = await readFile(join(group, 'memory.events'), 'utf8')
      if (/^oom_kill [1-9]/m.test(events)) reason = 'MEMORY_LIMIT'
      const pids = await readFile(join(group, 'pids.events'), 'utf8')
      if (['EXITED', 'TIMEOUT'].includes(reason) && /^max [1-9]/m.test(pids)) reason = 'PROCESS_LIMIT'
      // Suppress setup diagnostics (which may include host paths).
      if (!started && !['CANCELLED', 'TIMEOUT', 'MEMORY_LIMIT', 'OUTPUT_LIMIT'].includes(reason)) { prepared = false; fail('DRIVER_FAILED') }
      // A kill failure invalidates readiness; never silently downgrade cleanup.
      if (killError) { poisoned = true; prepared = false; fail('DRIVER_FAILED') }
      let isolated = false
      if (started) {
        const info = JSON.parse(namespaceInfo)
        for (const name of ['mnt', 'net', 'pid', 'ipc', 'uts', 'cgroup']) {
          const host = await readlink('/proc/self/ns/' + name)
          if (!Number.isSafeInteger(info[name + '-namespace']) || String(info[name + '-namespace']) === host.match(/\[(\d+)\]/)?.[1]) { prepared = false; fail('DRIVER_FAILED') }
        }
        isolated = true
      }
      let text = started ? output.toString('utf8') : ''
      for (const hidden of [rootfs, cgroup, snapshot].filter(Boolean)) text = text.replaceAll(hidden, '[sandbox]')
      return { ...result, reason, output: text, isolated }
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', abort)
      if (child) await kill(reason || 'DRIVER_FAILED')
      // Wait for cgroup tree cleanup before exposing artifacts/releasing locks.
      for (let i = 0; i < 50; i++) {
        const events = await readFile(join(group, 'cgroup.events'), 'utf8').catch(() => '')
        if (!/^populated 1$/m.test(events)) break
        await new Promise(r => setTimeout(r, 10))
      }
      const populated = await readFile(join(group, 'cgroup.events'), 'utf8').catch(() => 'populated 1')
      if (/^populated 1$/m.test(populated) || killError) { poisoned = true; prepared = false; fail('DRIVER_FAILED') }
      await rmdir(group).catch(() => { poisoned = true; prepared = false; fail('DRIVER_FAILED') })
    }
  }
  return {
    name: 'local-linux',
    async probe() {
      if (poisoned) return { ready: false, reason: 'DRIVER_FAILED' }
      if (disposed) return { ready: false, reason: 'DRIVER_UNAVAILABLE' }
      if (process.platform !== 'linux') return { ready: false, reason: 'UNSUPPORTED_PLATFORM' }
      try { const st = await lstat(BWRAP); if (!st.isFile() || st.uid !== 0 || (st.mode & 0o6022)) return { ready: false, reason: 'BWRAP_UNSAFE' }; await access(BWRAP, constants.X_OK) }
      catch { return { ready: false, reason: 'BWRAP_MISSING' } }
      if (!prepared) {
        if (cgroup) await rmdir(cgroup).catch(() => {})
        if (rootfs) await rm(rootfs, { recursive: true, force: true })
        try { await prepareCgroup() } catch { if (cgroup) await rmdir(cgroup).catch(() => {}); return { ready: false, reason: 'CGROUP_UNAVAILABLE' } }
        try { await prepareRoot() } catch { return { ready: false, reason: 'ROOTFS_UNSAFE' } }
        prepared = true
      }
      try {
        const result = await run({ code: 'test "$$" -eq 2 && test ! -e /proc/self/mountinfo && test ! -e /etc/passwd && test ! -e /sys && test ! -e /home && test -z "$DSH_SANDBOX_CANARY" && printf sandbox-ready', limits: { timeoutMs: 2000, outputBytes: 1024, memoryMiB: 32, processes: 8 } })
        if (result.exitCode !== 0 || result.output !== 'sandbox-ready' || result.reason !== 'EXITED') throw Error()
        return { ready: true, reason: 'READY' }
      } catch { prepared = false; return { ready: false, reason: 'PROBE_FAILED' } }
    },
    async execute(input) {
      try { return await run(input) } catch (e) { prepared = false; throw e }
    },
    async dispose() {
      disposed = true; prepared = false
      if (cgroup) await rmdir(cgroup).catch(() => {})
      if (rootfs) await rm(rootfs, { recursive: true, force: true })
    },
  }
}
