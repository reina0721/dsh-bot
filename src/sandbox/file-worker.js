import { fail } from './driver-contract.js'
// Runs only in the broker and only while holding the scope's workspace lock.
export async function fileWorker(workspace, base, input) {
  if (input.kind === 'file.write') return workspace.write(base, input.path, input.content)
  if (input.kind === 'file.delete') return workspace.remove(base, input.path)
  if (input.kind === 'file.list') return workspace.scan(base)
  if (input.kind === 'file.read') return { artifact: await workspace.read(base, input.path, 65536) }
  fail('INVALID_SANDBOX_INPUT')
}
