import { createLearningEngine } from './engine.js'

export function setup(api) {
  if (!api.learning) throw Error('学习服务不可用')
  const engine = createLearningEngine({ port: api.learning, getConfig: () => api.legacyConfig.section('cognition.learning'), scheduler: api.scheduler })
  api.providers.register('learning', engine)
  engine.start()
  return () => engine.stop()
}
