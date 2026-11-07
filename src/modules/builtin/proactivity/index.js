import { createProactivityEngine } from './engine.js'

export function setup(api) {
  if (!api.proactivity) throw new Error('主动行为服务不可用')
  const engine = createProactivityEngine({ port: api.proactivity, getConfig: () => api.legacyConfig.section('cognition.proactivity'), scheduler: api.scheduler, health: api.health })
  api.providers.register('proactivity', engine)
  engine.start()
  api.providers.started?.('proactivity')
  return () => engine.stop()
}
