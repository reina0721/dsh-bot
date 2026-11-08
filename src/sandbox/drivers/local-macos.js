import { constants } from 'node:fs'
import { access, lstat } from 'node:fs/promises'
import { fail, UNPROVEN_ENFORCEMENT } from '../driver-contract.js'

const SEATBELT = '/usr/bin/sandbox-exec'

// Discovery seam only. No profile or child process is launched: Seatbelt binary
// presence proves neither containment nor per-job resource/tree enforcement.
// The filesystem/platform parameters allow probe unit tests on other hosts.
export function createLocalMacosDriver({ platform = process.platform, filesystem = { access, lstat } } = {}) {
  let disposed = false
  const unavailable = (reason, seatbeltAvailable = false) => ({
    ready: false, reason, seatbeltAvailable, enforcement: { ...UNPROVEN_ENFORCEMENT },
  })
  return {
    name: 'local-macos',
    async probe() {
      if (disposed) return unavailable('DRIVER_UNAVAILABLE')
      if (platform !== 'darwin') return unavailable('UNSUPPORTED_PLATFORM')
      try {
        const stat = await filesystem.lstat(SEATBELT)
        if (!stat.isFile() || stat.uid !== 0 || (stat.mode & 0o6022)) return unavailable('SEATBELT_UNSAFE')
        await filesystem.access(SEATBELT, constants.X_OK)
      } catch (error) {
        return unavailable(error?.code === 'ENOENT' ? 'SEATBELT_MISSING' : 'SEATBELT_UNSAFE')
      }
      return unavailable('RESOURCE_LIMITS_UNPROVEN', true)
    },
    async execute() { fail('DRIVER_UNAVAILABLE') },
    async dispose() { disposed = true },
  }
}
