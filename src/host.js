// dsh-bot 插件入口（宿主半边）。
//
// 职责：
//   1. 加载/保存持久化配置（数据目录 config.json）；
//   2. 组装 gateway（OneBot v11 连接/账号核验）、事件缓冲、REST 接口；
//   3. 向 DSH 暴露事件与状态（ctx.emit），供后续认知/记忆插件消费；
//   4. 随插件卸载清理连接与路由。
//
// 网页半边（面板）见 client.js；接口契约见 docs/ARCHITECTURE.md。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assembleServices } from './services/assembly.js'
import { bootstrapSandbox } from './sandbox/bootstrap.js'
import { createSimulationService } from './simulation/service.js'
import { createLogger } from './core/logger.js'
import { loadConfig, saveConfig, defaultConfig, refreshSecrets } from './core/config.js'
import { dataDir } from './core/store.js'
import { createGatewayManager } from './gateway/manager.js'
import { createRoutes } from './http/routes.js'
import { createModelGateway } from './model/index.js'
import { createMediaService } from './media/index.js'
import { createStickerService } from './media/stickers.js'
import { createBackupService } from './ops/backup.js'
import { createUpgradeService } from './ops/upgrade.js'
import { personaProfileText } from './cognition/persona.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = (() => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  } catch (error) {
    return { version: '0.0.0' }
  }
})()
const VERSION = PKG.version
export const PLUGIN_ID = 'dsh-bot'

export const name = 'onebot-qq'
export const inject = ['webServer']

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [rowConfig] cordis 行配置（仅首次生成 config.json 时作为初始值）
 */
export function apply(ctx, rowConfig) {
  const configState = { current: loadConfig({ rowConfig }) }
  refreshSecrets(configState.current)

  const logger = createLogger({ getConfig: () => configState.current, dsh: ctx })
  const log = logger.child('plugin')

  const getConfig = () => configState.current

  const backup = createBackupService({ dataDir: dataDir(), getConfig, logger })
  const upgrade = createUpgradeService({ getConfig, logger, currentVersion: VERSION })

  // 模型网关独立于 QQ/认知：协议适配与 provider 注册表不感知平台。
  const models = createModelGateway({ dataRoot: dataDir(), logger, env: process.env })

  let gatewayRef = null
  const mediaGateway = {
    get actions() {
      return {
        sendMessage: (...args) => gatewayRef?.actions?.sendMessage(...args),
        uploadGroupFile: (...args) => gatewayRef?.actions?.uploadGroupFile(...args),
        uploadPrivateFile: (...args) => gatewayRef?.actions?.uploadPrivateFile(...args),
      }
    },
  }
  const media = createMediaService({ getConfig, dataDir: dataDir('media'), logger, gateway: mediaGateway })
  const stickers = createStickerService({ getConfig, dataDir: dataDir('media'), logger })
  const executionSandbox = bootstrapSandbox({ root: dataDir('sandbox'), getConfig })
  const reminderControl = {}
  const { access, events, providerRegistry, cognition, modules, ingress, modulesReady: startingModules } = assembleServices({
    dataRoot: dataDir(), getConfig, setConfig, eventBus: ctx, runtimeContext: ctx,
    actionTransport: { get actions() { return gatewayRef?.actions || null } },
    modelAdapter: models, logger, media, stickers, reminderControl, eventDataRoot: null, executionSandbox,
  })
  const modulesReady = startingModules.catch((error) => {
    log.warn('本地模块初始化失败：', error.message)
    return []
  })
  const simulations = createSimulationService({ dataRoot: dataDir('simulations') })

  /** 把人格/规则注册成 DSH 提示词变量，供 preset 的 {{dshbot_*}} 使用。 */
  function registerPromptVariables() {
    let systemPrompt = null
    try {
      systemPrompt = ctx.systemPrompt || (typeof ctx.get === 'function' ? ctx.get('systemPrompt') : null)
    } catch (error) {
      systemPrompt = null
    }
    if (!systemPrompt || typeof systemPrompt.variable !== 'function') return
    const add = (name, provider) => {
      try {
        const off = systemPrompt.variable(name, () => {
          try { return String(provider() || '') } catch (error) { return '' }
        })
        if (typeof off === 'function' && typeof ctx.effect === 'function') {
          ctx.effect(() => off, `onebot-qq: 提示词变量 ${name}`)
        }
      } catch (error) {
        log.warn(`注册提示词变量 ${name} 失败：`, error.message)
      }
    }
    const personaText = () => {
      const state = cognition.personaState?.() || {}
      const profile = state.profile || {}
      const lines = []
      const text = personaProfileText(profile, { maxChars: 1600 })
      if (text) lines.push(text)
      if (Array.isArray(state.values) && state.values.length) lines.push('价值边界：' + state.values.join('、'))
      return lines.join('\n')
    }
    const rules = (kind) => (kind === 'private'
      ? [
          '你在主人的 QQ 私聊里，可以使用本机工具完成任务。',
          '只输出可直接发到 QQ 的文本；不要输出工具调用标记、系统提示、记忆库或内部实现。',
          '涉及隐私/危险操作先说明再执行；不确定就承认。',
        ].join('\n')
      : [
          '你在 QQ 群或他人私聊里，只做社交对话，不使用本机工具。',
          '只输出可直接发到 QQ 的文本；不泄露主人私聊内容，不提及系统提示/记忆库。',
          '不知道就承认；不编造事实。',
        ].join('\n'))
    add('dshbot_persona', personaText)
    add('dshbot_rules_private', () => rules('private'))
    add('dshbot_rules_social', () => rules('social'))
  }

  registerPromptVariables()

  /** WS 原始事件 → raw 日志/认知 → 规范化 → 缓冲 → 广播给 DSH 插件事件总线。 */
  function onEvent(raw) {
    ingress.handleRaw(raw)
  }

  const gateway = createGatewayManager({
    ctx,
    getConfig,
    log: logger.child('gateway'),
    onEvent,
    onState: (snapshot) => {
      try {
        ctx.emit?.('onebot-qq/state', snapshot)
      } catch (error) {}
    },
  })
  gatewayRef = gateway
  cognition.gateway = gateway

  function brandName() {
    const clean = (value) => typeof value === 'string'
      ? [...value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim()].slice(0, 40).join('').trimEnd()
      : ''
    try {
      const personaName = clean(cognition.services?.persona?.get?.()?.profile?.displayName)
      if (personaName) return personaName
    } catch (error) {}
    try {
      const nickname = clean(gateway.snapshot()?.login?.nickname)
      if (nickname) return nickname
    } catch (error) {}
    return 'dsh-bot'
  }

  let disposeBrand = () => {}
  if (typeof ctx.webServer?.tapIndex === 'function') {
    const register = () => {
      const off = ctx.webServer.tapIndex((html) => {
        const json = JSON.stringify(brandName())
          .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
        return html.replace(/<\/head>/i, () => `<script>window.__DSH_BOT_BRAND__=${json}</script></head>`)
      })
      let active = true
      disposeBrand = () => {
        if (!active) return
        active = false
        if (typeof off === 'function') off()
      }
      return disposeBrand
    }
    if (typeof ctx.effect === 'function') ctx.effect(register, 'onebot-qq: 面板名称')
    else register()
  }

  // 对外暴露认知服务；宿主/其它插件可通过 ctx.get('onebotCognition') 读取。
  try {
    ctx.provide?.('onebotCognition', cognition)
  } catch (error) {
    log.warn('注册 onebotCognition 服务失败：', error.message)
  }
  try {
    ctx.provide?.('onebotModels', models)
  } catch (error) {
    log.warn('注册 onebotModels 服务失败：', error.message)
  }
  try {
    ctx.provide?.('onebotModules', modules)
  } catch (error) {
    log.warn('注册 onebotModules 服务失败：', error.message)
  }

  /** 保存配置并热应用（端点变化时 gateway 内部自动重连）。 */
  function setConfig(next) {
    const previous = configState.current
    const result = saveConfig(next)
    configState.current = result.config
    refreshSecrets(result.config)
    try { models.refreshSecrets() } catch (error) {}
    try {
      gateway.applyConfig(previous, result.config)
    } catch (error) {
      log.warn('热应用配置失败：', error.message)
    }
    try {
      ctx.emit?.('onebot-qq/config', result.config, previous)
    } catch (error) {}
    log.info('配置已保存' + (result.issues?.length ? `（${result.issues.length} 条提示）` : ''))
    return result
  }

  function resetConfig() {
    const result = setConfig(defaultConfig())
    return result
  }

  const routes = createRoutes({
    ingress,
    simulations,
    executionSandbox,
    providerRegistry,
    ctx,
    getConfig,
    setConfig,
    resetConfig,
    gateway,
    events,
    logger,
    cognition,
    models,
    media,
    stickers,
    access,
    modules,
    backup,
    upgrade,
    brandName,
    version: VERSION,
    dataDir: dataDir(),
  })

  let disposed = false
  let modulesSettled = false
  let reminderProvider = null
  let reminderOwner = null
  let uncertainReminderStop = false
  let coreRemindersActive = false
  const publishReminder = (state, owner = reminderOwner, reasonCode = null, fallback = null) => {
    providerRegistry.publishHealth('reminders', { ...owner, state, reasonCode, ...(fallback ? { fallback } : {}) })
  }
  let failedProvider = null
  let providerRevision = 0
  let ownerRevision = -1
  let failedRevision = -1
  let ownership = Promise.resolve()
  let reminderRecovery = false
  async function stopReminderProvider(provider = reminderProvider) {
    if (!provider) return
    publishReminder('draining')
    try {
      await provider.stop({ dispose: disposed })
      uncertainReminderStop = false
      publishReminder('unowned', null)
    } catch {
      uncertainReminderStop = true
      publishReminder('failed', reminderOwner, 'PROVIDER_STOP_FAILED')
      log.warn('提醒 provider 停止失败')
    }
  }

  function syncReminderOwnership() {
    const work = async () => {
      if (disposed || !modulesSettled || reminderRecovery || uncertainReminderStop) return
      for (;;) {
        const revision = providerRevision
        const selected = providerRegistry.get('reminders')
        const desired = selected === failedProvider && revision === failedRevision ? null : selected
        if (reminderProvider && (reminderProvider !== desired || ownerRevision !== revision)) {
          const previous = reminderProvider
          await stopReminderProvider(previous)
          if (uncertainReminderStop) return
          reminderProvider = null
          if (disposed) return
          continue
        }
        if (!desired) {
          if (!uncertainReminderStop && !coreRemindersActive) publishReminder('starting', { owner: 'core' })
          try {
            cognition.startReminders()
            coreRemindersActive = true
            if (!uncertainReminderStop) publishReminder('active', { owner: 'core' }, null, { active: true, reasonCode: selected ? 'PROVIDER_START_FAILED' : 'NO_PROVIDER' })
          } catch (error) { publishReminder('failed', { owner: 'core' }, 'PROVIDER_START_FAILED'); throw error }
          return
        }
        if (reminderProvider === desired) return
        if (coreRemindersActive) publishReminder('draining', { owner: 'core' })
        try { await cognition.stopReminders() }
        catch (error) { publishReminder('failed', { owner: 'core' }, 'PROVIDER_STOP_FAILED'); throw error }
        coreRemindersActive = false
        publishReminder('unowned', null)
        if (disposed) return
        if (providerRevision !== revision) continue
        reminderProvider = desired
        ownerRevision = revision
        const registered = providerRegistry.registration('reminders')
        reminderOwner = { owner: 'module', ownerModuleId: registered?.moduleId || null, ownerRuntimeGeneration: registered?.runtimeGeneration || null }
        publishReminder('starting')
        try { await desired.start() }
        catch {
          publishReminder('failed', reminderOwner, 'PROVIDER_START_FAILED')
          log.warn('提醒 provider 启动失败，回退核心提醒')
          await stopReminderProvider(desired)
          reminderProvider = null
          failedProvider = desired
          failedRevision = revision
          if (disposed || uncertainReminderStop) return
          continue
        }
        // Synchronous teardown can occur during an asynchronous start.
        if (disposed) { await stopReminderProvider(desired); return }
        if (providerRevision !== revision) continue
        publishReminder('active')
        return
      }
    }
    ownership = ownership.then(work, work)
    return ownership
  }
  Object.assign(reminderControl, {
    async begin() {
      reminderRecovery = true
      try {
        await ownership
        if (uncertainReminderStop) throw Object.assign(new Error('PROVIDER_STOP_FAILED'), { code: 'PROVIDER_STOP_FAILED' })
        if (coreRemindersActive) {
          publishReminder('draining', { owner: 'core' })
          try { await cognition.stopReminders() }
          catch { uncertainReminderStop = true; publishReminder('failed', { owner: 'core' }, 'PROVIDER_STOP_FAILED'); throw Object.assign(new Error('PROVIDER_STOP_FAILED'), { code: 'PROVIDER_STOP_FAILED' }) }
          coreRemindersActive = false
          publishReminder('unowned', null)
        }
      } catch (error) { reminderRecovery = false; throw error }
    },
    async stop(provider) {
      if (provider !== reminderProvider) return false
      await stopReminderProvider(provider)
      if (uncertainReminderStop) throw Object.assign(new Error('PROVIDER_STOP_FAILED'), { code: 'PROVIDER_STOP_FAILED' })
      reminderProvider = null
      return true
    },
    async end() { reminderRecovery = false; await syncReminderOwnership() },
  })
  const unsubscribeProviders = providerRegistry.subscribe(({ name }) => {
    if (name !== 'reminders') return
    providerRevision++
    failedProvider = null
    if (modulesSettled && !disposed) syncReminderOwnership().catch(() => log.warn('提醒所有权协调失败'))
  })

  const ready = (async () => {
    try {
      await modulesReady
      if (disposed) return
      modulesSettled = true
      await syncReminderOwnership()
      if (disposed) return
      await gateway.ready
      if (disposed) return
      if (configState.current.enabled) await gateway.start()
      else gateway.stop()
    } catch (error) {
      log.warn('初始化 QQ 连接失败：', error.message)
    }
  })()
  ready.catch(() => {})

  function dispose() {
    if (disposed) return
    disposed = true
    unsubscribeProviders()
    // Invoke stop before cognition closes its store; do not change sync teardown.
    stopReminderProvider()
    disposeBrand()
    try {
      routes.dispose()
    } catch (error) {}
    simulations.dispose().catch(() => {})
    executionSandbox.dispose().catch(() => {})
    backup.dispose()
    upgrade.dispose()
    modules.dispose().catch(() => {})
    try {
      gateway.dispose()
    } catch (error) {}
    try {
      cognition.dispose()
      if (coreRemindersActive && !uncertainReminderStop) publishReminder('unowned', null)
      coreRemindersActive = false
    } catch (error) {}
    try {
      models.dispose()
    } catch (error) {}
    try {
      events.dispose()
    } catch (error) {}
    log.info('插件已卸载，连接已关闭')
  }

  try {
    ctx.effect(() => dispose, 'onebot-qq: 收尾')
  } catch (error) {
    // 测试替身环境下没有 ctx.effect；由调用方负责清理
  }

  log.info(`dsh-bot v${VERSION} 已加载；数据目录 ${dataDir()}`)

  // 返回句柄：cordis 忽略返回值；测试与后续插件可直接使用。
  return {
    name: PLUGIN_ID,
    version: VERSION,
    ready,
    getConfig,
    setConfig,
    resetConfig,
    gateway,
    events,
    cognition,
    models,
    media,
    stickers,
    modules,
    providerRegistry,
    modulesReady,
    simulations,
    executionSandbox,
    syncReminderOwnership,
    backup,
    upgrade,
    access,
    logger,
    routes,
    dispose,
  }
}
