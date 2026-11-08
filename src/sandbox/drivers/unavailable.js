import { fail } from '../driver-contract.js'
export function createUnavailableDriver(reason = 'UNSUPPORTED_PLATFORM') {
  return { name: 'unavailable', probe: async () => ({ ready: false, reason }), execute: async () => fail('DRIVER_UNAVAILABLE'), dispose: async () => {} }
}
