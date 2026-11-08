// Service composition only. Registration, live gateway and process configuration belong to host.
import { join } from 'node:path'
import { createAccess } from '../core/access.js'
import { createEventStore } from '../core/events.js'
import { normalizeEvent } from '../gateway/normalize.js'
import { createIngressCoordinator } from '../ingress/coordinator.js'
import { createCognition } from '../cognition/index.js'
import { createTurnHooks } from '../cognition/turn-hooks.js'
import { createProviderRegistry } from '../extensions/providers.js'
import { createDeliveryRegistry } from '../delivery/registry.js'
import { createModuleKernel } from '../modules/kernel.js'
import { builtinRegistry } from '../modules/registry.js'

export function assembleServices({
  dataRoot, configSnapshot = {}, getConfig: readConfig, setConfig: writeConfig,
  eventBus = {}, runtimeContext = eventBus, actionTransport, modelAdapter = null,
  store = null, clock, scheduler, runtimeAdapter = null, sourceRegistry = null,
  embeddingAdapter = null, deliverySleep = null, logger = { info() {}, warn() {}, debug() {}, error() {} }, media = null, stickers = null,
  registry = builtinRegistry, discoverExternal = true, eventDataRoot = dataRoot,
  reminderControl = {}, executionSandbox = null,
} = {}) {
  if (!dataRoot) throw new Error('Service assembly requires dataRoot')
  let config = structuredClone(configSnapshot)
  const getConfig = readConfig || (() => config)
  const setConfig = writeConfig || (next => { config = structuredClone(next); return { config, issues: [] } })
  const access = createAccess({ getConfig, clock, logger: logger?.child?.('access') })
  const events = createEventStore({ getConfig, log: logger?.child?.('events'), clock, dataRoot: eventDataRoot })
  const providerRegistry = createProviderRegistry({ logger: logger?.child?.('providers') })
  const deliveryRegistry = createDeliveryRegistry()
  const turnHooks = createTurnHooks({ logger: logger?.child?.('turn-hooks') })
  const gateway = { get actions() { return actionTransport?.actions } }
  const cognition = createCognition({
    ctx: runtimeContext, getConfig, setConfig, gateway, logger, models: modelAdapter,
    dataRoot: join(dataRoot, 'cognition'), runtimeDataRoot: join(dataRoot, 'runtime'),
    store, clock, scheduler, runtimeAdapter, sourceRegistry, embeddingAdapter, deliverySleep,
    access, media, providerRegistry, deliveryRegistry, turnHooks, executionSandbox,
  })
  const modules = createModuleKernel({
    dataDir: join(dataRoot, 'modules'), getConfig, ctx: eventBus, logger, cognition,
    media, stickers, access, gateway, providerRegistry, deliveryRegistry, turnHooks,
    reminderControl, registry, discoverExternal, clock, scheduler,
    outbound: cognition.services.outbound, delivery: cognition.services.delivery,
    commands: cognition.services.commands, personaStore: cognition.services.personaStore,
  })
  const ingress = createIngressCoordinator({ access, cognition, events, modules, ctx: eventBus, normalizeEvent, getConfig, logger: logger?.child?.('plugin') || logger, clock })
  const modulesReady = modules.start()
  return { getConfig, setConfig, access, events, providerRegistry, deliveryRegistry, turnHooks, cognition, modules, ingress, modulesReady }
}
