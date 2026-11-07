import { normalizeConfig } from '../core/config.js'

// 每次读取当前规范化快照；固定路径和 normalizer 的固定字段共同阻止秘密/其它配置泄漏。
export function createLegacyConfig({ getConfig, assertActive, moduleId }) {
  return Object.freeze({
    section(path) {
      assertActive()
      const allowed = moduleId === 'builtin-learning' ? 'cognition.learning' : moduleId === 'builtin-proactivity' ? 'cognition.proactivity' : 'cognition.reminders'
      if (arguments.length !== 1 || path !== allowed) throw new Error(`只允许读取 ${allowed}`)
      try {
        const key = allowed.split('.')[1]
        const section = getConfig?.()?.cognition?.[key]
        return structuredClone(normalizeConfig({ cognition: { [key]: section } }).config.cognition[key])
      } catch { throw new Error(moduleId === 'builtin-proactivity' ? '主动行为配置读取失败' : '提醒配置读取失败') }
    },
  })
}
