import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFakeDsh } from './helpers/fake-dsh.js'
import { apply } from '../src/host.js'

test('all seven real builtins are healthy after activation without a first business run', async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-builtin-health-'))
  const previous = process.env.DSH_BOT_DATA_DIR
  process.env.DSH_BOT_DATA_DIR = root
  const fake = createFakeDsh()
  const host = apply(fake.ctx, {})
  t.after(async () => {
    await host.modules.dispose()
    host.dispose(); fake.dispose()
    if (previous === undefined) delete process.env.DSH_BOT_DATA_DIR
    else process.env.DSH_BOT_DATA_DIR = previous
    await rm(root, { recursive: true, force: true })
  })
  await host.ready
  assert.equal(host.modules.health('builtin-sample').items[0].health, 'stopped')
  await host.modules.setEnabled('builtin-sample', true)
  const health = host.modules.health()
  assert.equal(health.items.length, 7)
  for (const item of health.items) {
    assert.equal(item.lifecycle, 'loaded', item.moduleId)
    assert.equal(item.health, 'healthy', item.moduleId)
    assert.ok(item.observedAt, item.moduleId)
    assert.equal(item.engine.runs, null, 'setup idle must not invent a business run')
  }
  for (const id of ['builtin-learning', 'builtin-proactivity', 'builtin-reminders']) {
    const item = host.modules.health(id).items[0]
    assert.equal(item.scheduler.active, 1, id)
    assert.equal(item.scheduler.running, 0, id)
  }
  await host.modules.setEnabled('builtin-media-features', false)
  assert.equal(host.modules.health('builtin-media-features').items[0].health, 'stopped')
})
