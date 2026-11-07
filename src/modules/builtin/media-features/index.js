import { createBilibiliService } from './bilibili.js'
import { biliCommand, stickerCommand } from './commands.js'

export function createBuiltinMediaFeatures(api) {
  const port = api.mediaFeatures
  const getConfig = () => port.config()
  let active = false
  const requireActive = () => { if (!active) throw new Error('媒体功能模块未启用'); port.status() }
  const service = createBilibiliService({
    getConfig: () => { requireActive(); return { content: { bilibili: getConfig().bilibili } } },
    transport: port.bilibili,
  })
  const bilibili = Object.freeze(Object.fromEntries(Object.entries(service).map(([name, method]) => [name, (...args) => { requireActive(); return method(...args) }])))
  function authorizeStickers() {
    if (!active) return false
    requireActive()
    const status = port.status()
    return status.stickersEnabled && status.mediaEnabled && status.imagesEnabled
  }
  const engine = Object.freeze({
    start() { active = true },
    stop() { active = false },
    status() { return { active, ...port.status() } },
    authorizeStickers, bilibili,
  })
  api.providers.register('mediaFeatures', engine)
  engine.start()
  api.registerCommand('bili', input => biliCommand({ ...input, bilibili, getConfig }), { overrideBuiltin: true, audience: 'owner-or-operator' })
  api.registerCommand('sticker', input => stickerCommand({ ...input, port, authorize: authorizeStickers }), { overrideBuiltin: true, audience: 'owner' })
  return engine
}

export function setup(api) {
  const engine = createBuiltinMediaFeatures(api)
  return () => engine.stop()
}
