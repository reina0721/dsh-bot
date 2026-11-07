// 静态、受信任的包内目录；禁止文件系统发现。关闭时不调用 load。
function builtinUi(componentKey, binding, panel = null) {
  return Object.freeze({
    version: 1,
    config: Object.freeze({ binding, schemaVersion: 1, available: true }),
    surfaces: Object.freeze([
      Object.freeze({ id: 'detail', hook: 'module.detail', renderer: 'builtin-react', componentKey, order: 0 }),
      Object.freeze({ id: 'config', hook: 'module.config', renderer: 'schema', order: 10 }),
      ...(panel ? [Object.freeze({ id: 'panel', hook: 'module.panel', renderer: 'builtin-react', componentKey: panel, order: 20 })] : []),
    ]),
    requestedCapabilities: Object.freeze([]),
  })
}
export const builtinRegistry = Object.freeze([
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-proactivity', name: '主动行为', version: '1.0.0',
      description: '私聊主动行为策略与调度；人格、模型预算和交付闸门由核心管理',
      entry: 'builtin/proactivity/index.js', apiVersion: 1,
      permissions: Object.freeze(['providers:register', 'scheduler', 'config:read', 'proactivity:service']),
      requires: Object.freeze([]),
    }),
    provides: Object.freeze(['proactivity']),
    ui: builtinUi('proactivity.preview', 'legacy-core'),
    defaultEnabled: true,
    load: () => import('./builtin/proactivity/index.js'),
  }),
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-media-features', name: '媒体功能', version: '1.0.0',
      description: 'B站公共内容与表情包策略、命令；存储和媒体传输由核心管理',
      entry: 'builtin/media-features/index.js', apiVersion: 1,
      permissions: Object.freeze(['providers:register', 'media:features', 'commands', 'commands:override']),
      requires: Object.freeze([]),
    }),
    provides: Object.freeze(['mediaFeatures']),
    ui: builtinUi('media-features.preview', 'legacy-core', 'media-features.panel'),
    defaultEnabled: true,
    load: () => import('./builtin/media-features/index.js'),
  }),
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-reminders', name: '本地提醒', version: '1.0.0',
      description: '沿用 cognition.reminders 配置与原人格提醒数据，接管提醒调度与命令',
      entry: 'builtin/reminders.js', apiVersion: 1,
      permissions: Object.freeze(['providers:register', 'scheduler', 'reminders:service', 'config:read', 'commands', 'commands:override', 'access:check', 'delivery:send']),
      requires: Object.freeze([]),
    }),
    provides: Object.freeze(['reminders']),
    ui: builtinUi('reminders.preview', 'legacy-core'),
    defaultEnabled: true,
    load: () => import('./builtin/reminders.js'),
  }),
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-typing', name: '私聊输入状态', version: '1.0.0',
      description: '使用 cognition.typing.enabled 在私聊轮次开始和结束时提示输入状态',
      entry: 'builtin/typing.js', apiVersion: 1,
      permissions: Object.freeze(['turn:lifecycle', 'status:write']), requires: Object.freeze([]),
    }),
    defaultEnabled: true,
    load: () => import('./builtin/typing.js'),
    ui: builtinUi('typing.preview', 'legacy-core'),
  }),
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-reply-delivery', name: '回复交付', version: '1.0.0',
      description: '使用 cognition.reply 配置规划回复分条、引用、@ 与条间等待',
      entry: 'builtin/reply-delivery.js', apiVersion: 1,
      permissions: Object.freeze(['delivery:plan']), requires: Object.freeze([]),
    }),
    defaultEnabled: true,
    load: () => import('./builtin/reply-delivery.js'),
    ui: builtinUi('reply-delivery.preview', 'legacy-core'),
  }),
  Object.freeze({
    manifest: Object.freeze({
      id: 'builtin-sample', name: '内置示例', version: '1.0.0',
      description: '默认关闭的模块 API 示例', entry: 'builtin/sample.js', apiVersion: 1,
      permissions: Object.freeze(['commands', 'storage']), requires: Object.freeze([]),
    }),
    defaultEnabled: false,
    ui: builtinUi('sample.preview', 'module-file'),
    config: Object.freeze({
      version: 1,
      fields: Object.freeze([
        Object.freeze({ path: 'message', type: 'text', label: '示例回复', default: '内置示例模块已启用。', maxChars: 200, help: '主人使用 /module-sample 时发送的回复。' }),
      ]),
    }),
    load: () => import('./builtin/sample.js'),
  }),
])
