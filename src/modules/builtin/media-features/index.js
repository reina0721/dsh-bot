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
  function status() {
    const current = port.status() // Rechecks the owning runtime, including stale instances.
    const libraryReason = !active ? 'MODULE_DISABLED'
      : !current.mediaEnabled ? 'MEDIA_DISABLED'
        : !current.stickersEnabled ? 'STICKERS_DISABLED'
          : !current.stickerLibraryAvailable ? 'LIBRARY_UNAVAILABLE' : null
    const sendReason = libraryReason || (!current.imagesEnabled ? 'IMAGES_DISABLED'
      : !current.stickerSendAvailable ? 'DELIVERY_UNAVAILABLE' : null)
    return { active, ...current, libraryAvailable: !libraryReason, sendAvailable: !sendReason, libraryReason, sendReason }
  }
  const authorizeStickerLibrary = () => active && status().libraryAvailable
  const authorizeStickerSend = () => active && status().sendAvailable
  const engine = Object.freeze({
    start() { active = true },
    stop() { active = false },
    status,
    authorizeStickerLibrary, authorizeStickerSend, bilibili,
  })
  api.providers.register('mediaFeatures', engine)
  engine.start()
  api.providers.started?.('mediaFeatures')
  api.registerCommand('bili', input => biliCommand({ ...input, bilibili, getConfig }), { overrideBuiltin: true, audience: 'owner-or-operator' })
  api.registerCommand('sticker', input => stickerCommand({ ...input, port, authorize: authorizeStickerSend }), { overrideBuiltin: true, audience: 'owner' })
  return engine
}

export function setup(api) {
  const engine = createBuiltinMediaFeatures(api)
  return () => engine.stop()
}
