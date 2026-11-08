import { join } from 'node:path'
import { createSandboxService } from './service.js'
import { createLocalLinuxDriver } from './drivers/local-linux.js'
import { createLocalMacosDriver } from './drivers/local-macos.js'
import { createUnavailableDriver } from './drivers/unavailable.js'
import { normalizeSandbox } from './policy.js'

export function bootstrapSandbox({ root, getConfig }) {
  const drivers = {
    'local-linux': createLocalLinuxDriver({ root: join(root, 'driver') }),
    'local-macos': createLocalMacosDriver(),
    unavailable: createUnavailableDriver('DRIVER_UNAVAILABLE'),
  }
  const unsupported = createUnavailableDriver()
  const selected = () => {
    const name = normalizeSandbox(getConfig()?.sandbox).driver
    return name === 'auto' ? drivers[{ linux: 'local-linux', darwin: 'local-macos' }[process.platform]] || unsupported : drivers[name]
  }
  const driver = { get name() { return selected().name }, probe: () => selected().probe(), execute: input => selected().execute(input), dispose: () => Promise.all(Object.values(drivers).map(item => item.dispose())) }
  const service = createSandboxService({ root, getConfig, driver })
  void service.probe().catch(() => {})
  return service
}
