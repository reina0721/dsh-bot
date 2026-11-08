export const READINESS = Object.freeze(['disabled', 'checking', 'ready', 'unavailable', 'draining', 'failed'])
export const REASONS = Object.freeze(['DISABLED', 'CHECKING', 'READY', 'UNSUPPORTED_PLATFORM', 'DRIVER_UNAVAILABLE', 'BWRAP_MISSING', 'BWRAP_UNSAFE', 'CGROUP_UNAVAILABLE', 'ROOTFS_UNSAFE', 'PROBE_FAILED', 'DRAINING', 'AUDIT_UNAVAILABLE', 'DRIVER_FAILED'])
export const reasonCode = value => REASONS.includes(value) ? value : 'DRIVER_FAILED'
export function fail(code) { throw Object.assign(new Error(code), { code }) }
export function assertDriver(driver) {
  if (!driver || typeof driver.probe !== 'function' || typeof driver.execute !== 'function') fail('DRIVER_UNAVAILABLE')
  return driver
}
// Driver contract: probe() -> { ready, reason }; execute({ code, snapshot,
// limits, signal }) -> { reason, exitCode, output }. execute resolves only after
// the entire process tree is dead; setup/cleanup errors reject with fixed codes.
// Driver output is untrusted, bounded again by the broker, never audit data.
