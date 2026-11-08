import { join } from 'node:path'
import { createSandboxService } from './service.js'
import { createLocalLinuxDriver } from './drivers/local-linux.js'
import { createUnavailableDriver } from './drivers/unavailable.js'
import { normalizeSandbox } from './policy.js'

export function bootstrapSandbox({ root, getConfig }) {
  const linux = process.platform === 'linux' ? createLocalLinuxDriver({ root: join(root, 'driver') }) : createUnavailableDriver()
  const unavailable = createUnavailableDriver('DRIVER_UNAVAILABLE')
  const selected = () => normalizeSandbox(getConfig()?.sandbox).driver === 'unavailable' ? unavailable : linux
  const driver = { get name() { return selected().name }, probe: () => selected().probe(), execute: input => selected().execute(input), dispose: () => linux.dispose() }
  const service = createSandboxService({ root, getConfig, driver })
  void service.probe().catch(() => {})
  return service
}
