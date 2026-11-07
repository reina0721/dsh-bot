// C01: schema and navigation data only. No runtime registration or config writes.
function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

export const OWNER_CLASSES = freeze(['system', 'profile', 'module', 'operation'])
export const APPLY_BEHAVIORS = freeze(['next-use', 'gateway-reconnect', 'module-restart', 'read-only'])

const section = (id, components, availability = 'existing') => ({ id, components, availability })
// Component keys describe existing surfaces, not imports or DSH slots. A planned
// surface must never imply that it can be mounted or that its capability exists.
export const NAVIGATION_REGISTRY = freeze([
  { id: 'overview', label: 'Overview', sections: [section('overview', ['Overview'])] },
  { id: 'chat', label: 'Chat & Sandbox', sections: [
    section('messages', ['Messages']), section('sandbox', [], 'planned'),
  ] },
  { id: 'profiles', label: 'Profiles', sections: [
    section('overview', ['CognitionTab']), section('library', ['PersonaTab']),
    section('general', ['CogSettings']), section('persona', ['CogPersona']),
    section('models', ['CogSettings']), section('turn', ['CogSettings']),
    section('reply', ['CogSettings']), section('persons', ['CogPersons']),
    section('relationships', ['CogRelationships']), section('memories', ['CogMemories']),
    section('timeline', ['CogTimeline']), section('emotion', ['CogEmotion']),
    section('purpose', ['CogPurpose']), section('policy', ['CogPolicy']),
    section('proactivity', ['CogProactivity']), section('loop', ['CogLoop']),
    section('learning', ['CogLearning']), section('skills', ['CogSkills']),
    section('meta', ['CogMeta']), section('settings', ['CogSettings']),
  ] },
  { id: 'extensions', label: 'Extensions', sections: [
    section('modules', ['ModulesPage']), section('module', ['CoreModuleHealth', 'CoreModuleActions'], 'module-dependent'),
  ] },
  { id: 'data', label: 'Data & Logs', sections: [
    section('media', ['MediaPage']), section('content', ['ContentPage']), section('logs', ['Logs']),
    section('events', ['Messages']), section('backup', ['BackupPage']),
    section('privacy', ['CogSettings']), section('import', ['CogSettings']),
  ] },
  { id: 'system', label: 'System', sections: [
    section('general', ['ConfigTab']), section('connection', ['Connect']),
    section('timeouts', ['ConfigTab']), section('appearance', ['SettingsTab']),
    section('security', ['SecurityPage']), section('access', ['ConfigTab']),
    section('runtime', ['ConfigTab']), section('media', ['ConfigTab']),
    section('models', ['ModelTab']), section('diagnostics', ['CogSettings']), section('about', ['About']),
  ] },
])

export const destination = (area, section, extra = {}) => ({ area, section, ...extra })
export const DEFAULT_TARGET = freeze(destination('overview', 'overview'))
export const isCanonicalDestination = (target) => Boolean(target && NAVIGATION_REGISTRY
  .some(area => area.id === target.area && area.sections.some(section => section.id === target.section)))

export const LEGACY_TABS = freeze({
  overview: destination('overview', 'overview'), connect: destination('system', 'connection'),
  messages: destination('chat', 'messages'), media: destination('data', 'media'),
  content: destination('data', 'content'), modules: destination('extensions', 'modules'),
  backup: destination('data', 'backup'), security: destination('system', 'security'),
  config: destination('system', 'general'), persona: destination('profiles', 'library'),
  models: destination('system', 'models'), settings: destination('system', 'appearance'),
  cognition: destination('profiles', 'overview'), logs: destination('data', 'logs'),
  about: destination('system', 'about'),
})

export const LEGACY_COGNITION_SECTIONS = freeze(Object.fromEntries([
  'overview', 'persona', 'persons', 'relationships', 'memories', 'timeline', 'emotion',
  'purpose', 'policy', 'proactivity', 'loop', 'learning', 'skills', 'meta', 'settings',
].map(id => [id, destination('profiles', id)])))

const moduleTarget = (moduleId, anchor = 'config') => destination('extensions', 'module', {
  moduleId, anchor: anchor.startsWith('ob-module-') ? anchor : `ob-module-${anchor}`,
})
export const LEGACY_MODULE_IDS = freeze([
  'builtin-learning', 'builtin-proactivity', 'builtin-media-features', 'builtin-reminders',
  'builtin-typing', 'builtin-reply-delivery', 'builtin-sample',
])

// Legacy groups are landing aliases. Mixed groups do not grant a second editor:
// individual field aliases below always point to their sole canonical owner.
export const LEGACY_CONFIG_GROUPS = freeze({
  basic: destination('system', 'general'), endpoint: destination('system', 'connection'),
  snowluma: destination('system', 'connection'), timeouts: destination('system', 'timeouts'),
  events: destination('data', 'events'), logging: destination('data', 'logs'),
  ui: destination('system', 'appearance'), security: destination('system', 'security'),
  access: destination('system', 'access'), runtime: destination('system', 'runtime'),
  media: destination('system', 'media'), content: moduleTarget('builtin-media-features'),
  ops: destination('data', 'backup'),
  'cog-core': destination('profiles', 'general'), 'cog-permissions': destination('system', 'access'),
  'cog-reminders': moduleTarget('builtin-reminders'), 'cog-llm': destination('profiles', 'models'),
  'cog-turn': destination('profiles', 'turn'), 'cog-reply': destination('profiles', 'reply'),
  'cog-admin': destination('system', 'access'), 'cog-purpose': destination('profiles', 'purpose'),
  'cog-persona': destination('profiles', 'persona'), 'cog-emotion': destination('profiles', 'emotion'),
  'cog-relationship': destination('profiles', 'relationships'), 'cog-memory': destination('profiles', 'memories'),
  'cog-import': destination('data', 'import'), 'cog-policy': destination('profiles', 'policy'),
  'cog-learning': moduleTarget('builtin-learning'), 'cog-proactivity': moduleTarget('builtin-proactivity'),
  'cog-privacy': destination('data', 'privacy'),
})

export const LEGACY_ANCHORS = freeze({
  'ob-media-stickers': destination('data', 'media', { anchor: 'ob-media-stickers' }),
  ...Object.fromEntries(['unknowns', 'tasks', 'claims'].map(id => [
    `ob-cog-${id}`, destination('profiles', 'learning', { anchor: `ob-cog-${id}` }),
  ])),
  ...Object.fromEntries(['detail', 'config', 'panel', 'reminders'].map(id => [
    `ob-module-${id}`, destination('extensions', 'module', { anchor: `ob-module-${id}` }),
  ])),
})

export const LEGACY_SETTINGS_SECTIONS = freeze(Object.fromEntries(
  ['appearance', 'layout', 'data', 'motion', 'reset'].map(id => [id, destination('system', 'appearance', { anchor: id })]),
))

// Namespaces avoid collisions such as tab:security vs group:security and
// tab:overview vs cognition:overview. Unqualified lookup uses those priorities.
export const LEGACY_ALIASES = freeze({
  ...Object.fromEntries(Object.entries(LEGACY_TABS).flatMap(([id, target]) => [
    [`tab:${id}`, target], [`ob-tab-${id}`, target], [`ob-panel-${id}`, target],
  ])),
  ...Object.fromEntries(Object.entries(LEGACY_COGNITION_SECTIONS).map(([id, target]) => [`cognition:${id}`, target])),
  ...Object.fromEntries(Object.entries(LEGACY_CONFIG_GROUPS).map(([id, target]) => [`group:${id}`, target])),
  ...Object.fromEntries(Object.entries(LEGACY_SETTINGS_SECTIONS).map(([id, target]) => [`settings:${id}`, target])),
  ...Object.fromEntries(LEGACY_MODULE_IDS.map(id => [`module:${id}`, moduleTarget(id, 'detail')])),
  ...LEGACY_ANCHORS,
})

// Explicit baseline inventory (config.json paths; arrays are single fields).
// New fields must be assigned here and pass the config.js cross-check in tests.
// [ownerClass, scope, area, section, moduleId, legacyGroup, paths]
const FIELD_SETS = [
  ['system', 'system', 'system', 'runtime', null, null,
    [
      'version',
      'cognition.delivery.engine',
    ]],
  ['system', 'system', 'system', 'general', null, 'basic',
    [
      'enabled',
      'gateway',
      'botQQ',
      'accountCheck',
    ]],
  ['system', 'system', 'system', 'connection', null, 'endpoint',
    [
      'onebot.wsUrl',
      'onebot.httpUrl',
      'onebot.wsToken',
      'onebot.httpToken',
      'onebot.httpAuth',
      'reconnect.enabled',
      'reconnect.minDelayMs',
      'reconnect.maxDelayMs',
      'reconnect.factor',
      'reconnect.jitterRatio',
    ]],
  ['system', 'system', 'system', 'connection', null, 'snowluma',
    [
      'snowluma.dir',
      'snowluma.uin',
      'snowluma.autoDetect',
    ]],
  ['system', 'system', 'system', 'timeouts', null, 'timeouts',
    [
      'timeouts.callMs',
      'timeouts.connectMs',
      'timeouts.verifyMs',
      'timeouts.probeMs',
      'timeouts.maxRetries',
      'timeouts.retryDelaysMs',
      'verification.enabled',
      'verification.bufferSize',
    ]],
  ['system', 'system', 'data', 'events', null, 'events',
    [
      'events.enabled',
      'events.bufferSize',
      'events.includeSelfMessages',
      'events.kinds.message',
      'events.kinds.notice',
      'events.kinds.request',
      'events.kinds.meta_event',
      'events.messageSubTypes.private',
      'events.messageSubTypes.group',
      'events.ignoreUsers',
      'events.ignoreGroups',
      'events.rawMaxBytes',
      'events.persist.enabled',
      'events.persist.file',
      'events.persist.maxMB',
    ]],
  ['system', 'system', 'data', 'logs', null, 'logging',
    [
      'logging.level',
      'logging.bufferSize',
      'logging.persist.enabled',
      'logging.redact',
    ]],
  ['system', 'system', 'system', 'appearance', null, 'ui',
    [
      'ui.refreshMs',
      'ui.eventPageSize',
      'ui.logPageSize',
      'ui.accent',
      'ui.density',
      'ui.fontScale',
      'ui.contentWidth',
      'ui.motion',
      'ui.pageTransition',
      'ui.contrast',
    ]],
  ['system', 'system', 'system', 'security', null, 'security',
    [
      'security.allowRawAction',
      'security.leakGuard.enabled',
      'security.leakGuard.action',
    ]],
  ['system', 'system', 'data', 'backup', null, 'ops',
    [
      'ops.upgrade.enabled',
      'ops.upgrade.channel',
      'ops.upgrade.repo',
      'ops.upgrade.timeoutMs',
      'ops.upgrade.cacheMinutes',
      'ops.backup.enabled',
      'ops.backup.includeMedia',
      'ops.backup.maxSnapshots',
      'ops.backup.maxBytes',
      'ops.backup.maxFiles',
      'ops.backup.prune',
      'ops.backup.allowRestore',
    ]],
  ['system', 'system', 'system', 'media', null, 'media',
    [
      'media.enabled',
      'media.maxBytes',
      'media.dir',
      'media.tts.maxChars',
      'media.images.enabled',
      'media.images.visionEnabled',
      'media.images.visionBaseUrl',
      'media.images.visionModel',
      'media.images.visionApiKeyEnv',
      'media.images.generateEnabled',
      'media.images.generateBaseUrl',
      'media.images.generateModel',
      'media.images.generateApiKeyEnv',
      'media.images.generateSize',
      'media.images.editEnabled',
      'media.images.editBaseUrl',
      'media.images.editModel',
      'media.images.editApiKeyEnv',
      'media.images.editSize',
      'media.audio.asrEnabled',
      'media.audio.asrBaseUrl',
      'media.audio.asrModel',
      'media.audio.asrApiKeyEnv',
      'media.audio.ttsEnabled',
      'media.audio.ttsBaseUrl',
      'media.audio.ttsModel',
      'media.audio.ttsVoice',
      'media.audio.ttsApiKeyEnv',
      'media.files.enabled',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-media-features', 'media',
    [
      'media.stickers.enabled',
      'media.stickers.maxCount',
      'media.stickers.maxBytes',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-media-features', 'content',
    [
      'content.bilibili.enabled',
      'content.bilibili.timeoutMs',
      'content.bilibili.maxResults',
    ]],
  ['system', 'system', 'system', 'access', null, 'access',
    [
      'access.mode',
      'access.ownerQQ',
      'access.ownerName',
      'access.operators',
      'access.private',
      'access.groups',
      'access.auditSize',
    ]],
  ['system', 'system', 'system', 'runtime', null, 'runtime',
    [
      'runtime.engine',
      'runtime.workspaceDir',
      'runtime.replyTimeoutMs',
    ]],
  ['profile', 'profile', 'profiles', 'general', null, 'cog-core',
    [
      'cognition.enabled',
      'cognition.paused',
      'cognition.dryRun',
      'cognition.locale',
      'cognition.timezone',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-typing', 'cog-turn',
    [
      'cognition.typing.enabled',
    ]],
  ['profile', 'profile', 'profiles', 'turn', null, 'cog-turn',
    [
      'cognition.turn.privateBaseMs',
      'cognition.turn.privateMaxMs',
      'cognition.turn.groupMaxMs',
      'cognition.turn.fastPathMs',
      'cognition.turn.shortMsgMs',
      'cognition.turn.incompleteFactorMs',
      'cognition.turn.habitAdjMaxMs',
      'cognition.turn.maxAggregateMessages',
      'cognition.turn.groupReplyMode',
      'cognition.turn.groupReplyProbability',
      'cognition.turn.groupRelevance.enabled',
      'cognition.turn.groupRelevance.minScore',
      'cognition.turn.groupCooldownMs',
      'cognition.turn.groupMaxRepliesPerMinute',
      'cognition.turn.maxConsecutiveGroupReplies',
      'cognition.turn.addressedOnlyGroups',
      'cognition.turn.wakeWords',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-reply-delivery', 'cog-reply',
    [
      'cognition.reply.split',
      'cognition.reply.maxChars',
      'cognition.reply.maxParts',
      'cognition.reply.delayMs',
      'cognition.reply.quote',
      'cognition.reply.atSender',
    ]],
  ['profile', 'profile', 'profiles', 'reply', null, 'cog-reply',
    [
      'cognition.notices.enabled',
      'cognition.requests.enabled',
      'cognition.notice.patReply',
      'cognition.notice.patCooldownMs',
    ]],
  ['system', 'system', 'system', 'access', null, 'cog-permissions',
    [
      'cognition.permissions.deniedCommands',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-reminders', 'cog-reminders',
    [
      'cognition.reminders.enabled',
      'cognition.reminders.maxActive',
      'cognition.reminders.minIntervalSeconds',
      'cognition.reminders.maxIntervalSeconds',
      'cognition.reminders.tickMs',
    ]],
  ['system', 'system', 'system', 'access', null, 'cog-admin',
    [
      'cognition.qqAdmin.enabled',
      'cognition.qqAdmin.requireApproval',
      'cognition.qqAdmin.requireConfirm',
      'cognition.qqAdmin.maxText',
    ]],
  ['profile', 'profile', 'profiles', 'purpose', null, 'cog-purpose',
    [
      'cognition.purpose.enabled',
      'cognition.purpose.maxActive',
      'cognition.purpose.injectPrompt',
      'cognition.purpose.promptLimit',
    ]],
  ['system', 'system', 'data', 'import', null, 'cog-import',
    [
      'cognition.import.enabled',
      'cognition.import.maxBytes',
      'cognition.import.maxItems',
    ]],
  ['profile', 'profile', 'profiles', 'memories', null, 'cog-memory',
    [
      'cognition.consolidation.enabled',
      'cognition.consolidation.hour',
      'cognition.consolidation.reflect',
      'cognition.consolidation.reflectMinEpisodes',
      'cognition.memory.retrievalTopK',
      'cognition.memory.maxContextChars',
      'cognition.memory.recencyWeight',
      'cognition.memory.importanceWeight',
      'cognition.memory.relevanceWeight',
      'cognition.memory.emotionWeight',
      'cognition.memory.relationshipWeight',
      'cognition.memory.associationWeight',
      'cognition.memory.recencyHalfLifeDays',
      'cognition.memory.forgetHalfLifeDays',
      'cognition.memory.consolidateEvery',
      'cognition.memory.semanticIndex',
      'cognition.memory.embedding.enabled',
      'cognition.memory.embedding.baseUrl',
      'cognition.memory.embedding.model',
      'cognition.memory.embedding.apiKeyEnv',
      'cognition.memory.embedding.weight',
    ]],
  ['profile', 'profile', 'profiles', 'models', null, 'cog-llm',
    [
      'cognition.llm.mode',
      'cognition.llm.provider',
      'cognition.llm.model',
      'cognition.llm.reasoningEffort',
      'cognition.llm.temperature',
      'cognition.llm.analysisMaxTokens',
      'cognition.llm.composeMaxTokens',
      'cognition.llm.budgetScope',
      'cognition.llm.personaDailyTokenBudget',
      'cognition.modelRouting.privateDefault',
      'cognition.modelRouting.groupDefault',
      'cognition.modelRouting.routes',
    ]],
  ['system', 'system', 'system', 'models', null, 'cog-llm',
    [
      'cognition.llm.fallbackToDsh',
      'cognition.llm.timeoutMs',
      'cognition.llm.dailyTokenBudget',
      'cognition.llm.maxConcurrency',
      'cognition.llm.retry',
      'cognition.llm.cache',
    ]],
  ['profile', 'profile', 'profiles', 'persona', null, 'cog-persona',
    [
      'cognition.persona.traits.extraversion',
      'cognition.persona.traits.openness',
      'cognition.persona.traits.agreeableness',
      'cognition.persona.traits.conscientiousness',
      'cognition.persona.traits.emotionalSensitivity',
      'cognition.persona.traits.humor',
      'cognition.persona.traits.socialInitiative',
      'cognition.persona.traits.caution',
      'cognition.persona.traits.expressiveness',
      'cognition.persona.traits.conflictApproach',
      'cognition.persona.traits.riskTolerance',
      'cognition.persona.traits.consistency',
      'cognition.persona.style.formality',
      'cognition.persona.style.verbosity',
      'cognition.persona.style.emojiRate',
      'cognition.persona.style.punctuation',
      'cognition.persona.style.teasingBound',
      'cognition.persona.style.warmth',
      'cognition.persona.values',
      'cognition.persona.profile.displayName',
      'cognition.persona.profile.tagline',
      'cognition.persona.profile.identity',
      'cognition.persona.profile.background',
      'cognition.persona.profile.personality',
      'cognition.persona.profile.speakingStyle',
      'cognition.persona.profile.likes',
      'cognition.persona.profile.dislikes',
      'cognition.persona.profile.boundaries',
      'cognition.persona.profile.examples',
      'cognition.persona.evolutionPerDay',
      'cognition.persona.evolutionEnabled',
      'cognition.persona.min',
      'cognition.persona.max',
    ]],
  ['profile', 'profile', 'profiles', 'emotion', null, 'cog-emotion',
    [
      'cognition.emotion.sensitivity',
      'cognition.emotion.regulation',
      'cognition.emotion.valenceHalfLifeMin',
      'cognition.emotion.arousalHalfLifeMin',
      'cognition.emotion.stressHalfLifeMin',
      'cognition.emotion.moodHalfLifeMin',
      'cognition.emotion.effectsEnabled',
    ]],
  ['profile', 'profile', 'profiles', 'relationships', null, 'cog-relationship',
    [
      'cognition.relationship.learningRate',
      'cognition.relationship.trustRate',
      'cognition.relationship.intimacyRate',
      'cognition.relationship.conflictRise',
      'cognition.relationship.conflictDecay',
      'cognition.relationship.inertia',
      'cognition.relationship.repairThreshold',
    ]],
  ['profile', 'profile', 'profiles', 'policy', null, 'cog-policy',
    [
      'cognition.policy.replyThreshold',
      'cognition.policy.waitThreshold',
      'cognition.policy.silenceThreshold',
      'cognition.policy.addressedBoost',
      'cognition.policy.groupPenalty',
      'cognition.policy.epsilon',
      'cognition.policy.dailyGlobalLimit',
      'cognition.policy.perChatPrivate',
      'cognition.policy.perChatGroup',
      'cognition.policy.maxConsecutiveBotMessages',
      'cognition.policy.proactive',
      'cognition.policy.groupAmbient',
      'cognition.policy.analyzeWithLlm',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-learning', 'cog-learning',
    [
      'cognition.learning.enabled',
      'cognition.learning.autoResearch',
      'cognition.learning.detectUnknowns',
      'cognition.learning.maxTasksPerHour',
      'cognition.learning.maxQueries',
      'cognition.learning.maxSources',
      'cognition.learning.dailyTokenBudget',
      'cognition.learning.taskTtlHours',
      'cognition.learning.retry',
      'cognition.learning.minConfidence',
      'cognition.learning.sources.web',
      'cognition.learning.sources.wikipedia',
      'cognition.learning.sources.openalex',
      'cognition.learning.sources.github',
      'cognition.learning.sources.rss',
      'cognition.learning.sources.local',
    ]],
  ['module', 'system', 'extensions', 'module', 'builtin-proactivity', 'cog-proactivity',
    [
      'cognition.proactivity.enabled',
      'cognition.proactivity.quietStart',
      'cognition.proactivity.quietEnd',
      'cognition.proactivity.maxPrivatePerDay',
      'cognition.proactivity.maxGroupPerDay',
      'cognition.proactivity.minFamiliarity',
      'cognition.proactivity.backoffHours',
    ]],
  ['system', 'system', 'data', 'privacy', null, 'cog-privacy',
    [
      'cognition.privacy.privateIsolation',
      'cognition.privacy.learnFromPrivate',
      'cognition.privacy.rawRetentionDays',
      'cognition.privacy.traceRetentionDays',
      'cognition.privacy.decisionRetentionDays',
      'cognition.privacy.metricsRetentionDays',
      'cognition.privacy.exportSecret',
    ]],
  ['system', 'system', 'system', 'diagnostics', null, 'cog-core',
    [
      'cognition.debug.trace',
      'cognition.debug.keepPrompt',
    ]],
]

const INTERNAL_PATHS = new Set(['version', 'cognition.delivery.engine', 'cognition.turn.addressedOnlyGroups'])
const PROFILE_EDITOR_PATHS = new Set([
  ...['displayName', 'tagline', 'identity', 'background', 'personality', 'speakingStyle', 'likes', 'dislikes', 'boundaries', 'examples']
    .map(key => `cognition.persona.profile.${key}`),
])
const NON_PANEL_PATHS = new Set([
  ...INTERNAL_PATHS, ...PROFILE_EDITOR_PATHS, 'logging.redact', 'cognition.llm.cache', 'cognition.policy.groupAmbient',
  'cognition.persona.style.punctuation', 'cognition.persona.min', 'cognition.persona.max',
])
const RECONNECT_PATHS = new Set([
  'enabled', 'gateway', 'botQQ', 'accountCheck', 'verification.enabled',
  'onebot.wsUrl', 'onebot.httpUrl', 'onebot.wsToken', 'onebot.httpToken', 'onebot.httpAuth',
  'snowluma.dir', 'snowluma.uin', 'snowluma.autoDetect',
])

function sensitivity(path) {
  if (['onebot.wsToken', 'onebot.httpToken'].includes(path)) return 'secret'
  if (path.endsWith('ApiKeyEnv') || path.endsWith('.apiKeyEnv')) return 'secret-reference'
  if (/baseUrl$/i.test(path) || /^(access\.|botQQ$|snowluma\.(dir|uin)$|onebot\..*Url$|runtime\.workspaceDir$|media\.dir$|events\.ignore|cognition\.(persona|modelRouting|privacy|debug)\.)/.test(path)) return 'private'
  return 'public'
}

export const SETTINGS_FIELDS = freeze([...FIELD_SETS.flatMap(([ownerClass, scope, area, section, moduleId, legacyGroup, paths]) =>
  paths.map(path => ({
    path, ownerClass, scope, canonical: destination(area, section, moduleId ? { moduleId, anchor: 'ob-module-config' } : {}),
    sensitivity: sensitivity(path),
    apply: INTERNAL_PATHS.has(path) ? 'read-only' : RECONNECT_PATHS.has(path) ? 'gateway-reconnect'
      : path === 'cognition.reminders.tickMs' ? 'module-restart' : 'next-use',
    exposure: INTERNAL_PATHS.has(path) ? 'internal' : PROFILE_EDITOR_PATHS.has(path) ? 'profile-editor'
      : NON_PANEL_PATHS.has(path) ? 'config-file' : 'panel',
    storage: 'config.json', legacyGroup,
    aliases: [path, ...(legacyGroup ? [`group:${legacyGroup}/${path}`] : [])],
  })),
), {
  path: 'modules.builtin-sample.message', ownerClass: 'module', scope: 'module',
  canonical: moduleTarget('builtin-sample'), sensitivity: 'private', apply: 'next-use',
  exposure: 'module-schema', storage: 'module-file', legacyGroup: null,
  aliases: ['modules.builtin-sample.message', 'module:builtin-sample/message'],
}])

// Operation ownership is intentionally separate from persistent settings. These
// describe navigation to existing explicit actions; normalization never runs one.
export const OPERATION_CONTRACTS = freeze([
  { id: 'module.lifecycle', ownerClass: 'operation', scope: 'request', canonical: destination('extensions', 'module'), apply: 'explicit-action' },
  { id: 'backup.restore', ownerClass: 'operation', scope: 'request', canonical: destination('data', 'backup'), apply: 'explicit-action' },
  { id: 'learning.task', ownerClass: 'operation', scope: 'request', canonical: destination('profiles', 'learning'), apply: 'explicit-action' },
])

// The canonical groups partition fields, including mixed legacy groups. No field
// is copied into a second system/profile/module group for discovery.
function partition(fields) {
  const groups = new Map()
  for (const field of fields) {
    const { area, section, moduleId } = field.canonical
    const id = [field.ownerClass, area, section, moduleId].filter(Boolean).join(':')
    if (!groups.has(id)) groups.set(id, { id, ownerClass: field.ownerClass, scope: field.scope, canonical: field.canonical, fields: [] })
    groups.get(id).fields.push(field.path)
  }
  return [...groups.values()]
}
export const SETTINGS_GROUPS = freeze(partition(SETTINGS_FIELDS))

/** Throws on duplicate ownership/aliases, invalid metadata, or incomplete groups. */
export function validateSettingsSchema(fields = SETTINGS_FIELDS, groups = SETTINGS_GROUPS) {
  const byPath = new Map(), aliases = new Set(), grouped = new Set(), groupIds = new Set()
  for (const field of fields) {
    if (!field || typeof field.path !== 'string' || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(field.path)
      || byPath.has(field.path)) throw new Error(`Duplicate/invalid field owner: ${field?.path}`)
    if (!['system', 'profile', 'module'].includes(field.ownerClass)
      || !['system', 'profile', 'module'].includes(field.scope)
      || !isCanonicalDestination(field.canonical) || !APPLY_BEHAVIORS.includes(field.apply)
      || !['public', 'private', 'secret', 'secret-reference'].includes(field.sensitivity)
      || (field.ownerClass === 'module') !== Boolean(field.canonical.moduleId)
      || (field.ownerClass === 'module' && (field.canonical.area !== 'extensions' || field.canonical.section !== 'module'
        || !LEGACY_MODULE_IDS.includes(field.canonical.moduleId)))
      || (field.ownerClass === 'profile' && (field.scope !== 'profile' || field.canonical.area !== 'profiles'))
      || (field.ownerClass === 'system' && (field.scope !== 'system' || !['system', 'data'].includes(field.canonical.area)))
      || Object.keys(field).some(key => !['path', 'ownerClass', 'scope', 'canonical', 'sensitivity', 'apply', 'exposure', 'storage', 'legacyGroup', 'aliases'].includes(key))) {
      throw new Error(`Invalid field metadata: ${field.path}`)
    }
    byPath.set(field.path, field)
    if (!Array.isArray(field.aliases) || !field.aliases.includes(field.path)) throw new Error(`Missing field alias: ${field.path}`)
    for (const alias of field.aliases) {
      if (typeof alias !== 'string' || !alias || aliases.has(alias)) throw new Error(`Duplicate/invalid field alias: ${alias}`)
      aliases.add(alias)
    }
  }
  for (const group of groups) {
    if (groupIds.has(group.id) || !group.fields.length) throw new Error(`Duplicate/empty owner group: ${group.id}`)
    groupIds.add(group.id)
    for (const path of group.fields) {
      const field = byPath.get(path)
      if (!field || grouped.has(path) || field.ownerClass !== group.ownerClass || field.scope !== group.scope
        || JSON.stringify(field.canonical) !== JSON.stringify(group.canonical)) throw new Error(`Duplicate/mismatched group owner: ${path}`)
      grouped.add(path)
    }
  }
  if (grouped.size !== byPath.size) throw new Error('Fields missing canonical owner groups')
  for (const target of Object.values(LEGACY_ALIASES)) {
    if (!isCanonicalDestination(target)) throw new Error('Invalid legacy destination')
  }
  return { fields: byPath.size, groups: groups.length, aliases: aliases.size }
}

validateSettingsSchema()
