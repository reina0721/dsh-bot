// 配置规范化 / 字段表一致性 / 日志脱敏开关的单元测试。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { DEFAULTS, CONFIG_GROUPS, normalizeConfig, getPath, publicConfig, refreshSecrets } from '../src/core/config.js'
import { createLogger } from '../src/core/logger.js'

test('public config DTO masks credentials and embedded URL authentication without mutating storage', () => {
  const config = normalizeConfig({ onebot: { wsToken: 'C02_CONFIG_SECRET', httpToken: 'C02_HTTP_SECRET', wsUrl: 'wss://user:password@example.org/ws?token=query-secret&other=ok' } }).config
  config.cognition.persona.profile.identity = 'copy C02_CONFIG_SECRET'
  const before = structuredClone(config)
  refreshSecrets(config)
  const dto = publicConfig(config)
  assert.equal(dto.onebot.wsToken, '***')
  assert.equal(dto.onebot.httpToken, '***')
  assert.doesNotMatch(JSON.stringify(dto), /C02_CONFIG_SECRET|C02_HTTP_SECRET|query-secret|user:password/)
  assert.equal(dto.cognition.persona.profile.identity, 'copy ***')
  assert.match(dto.onebot.wsUrl, /other=ok/)
  assert.deepEqual(config, before)
  refreshSecrets(DEFAULTS)
})

test('delivery engine: internal auto default, core rollback and planner and strict normalization', () => {
  assert.deepEqual(DEFAULTS.cognition.delivery, { engine: 'auto' })
  assert.deepEqual(normalizeConfig({}).config.cognition.delivery, { engine: 'auto' })
  for (const engine of ['auto', 'core', 'planner']) assert.equal(normalizeConfig({ cognition: { delivery: { engine } } }).config.cognition.delivery.engine, engine)
  for (const engine of ['', 'Planner', 'module', true, 1, null, {}, []]) assert.equal(normalizeConfig({ cognition: { delivery: { engine } } }).config.cognition.delivery.engine, 'auto')
  for (const delivery of [null, true, 'planner', []]) assert.deepEqual(normalizeConfig({ cognition: { delivery } }).config.cognition.delivery, { engine: 'auto' })
  assert.equal(CONFIG_GROUPS.flatMap((group) => group.fields).some((field) => field.path.startsWith('cognition.delivery')), false)
  assert.deepEqual(normalizeConfig({ cognition: { delivery: { engine: 'planner' } } }).config.cognition.reply, DEFAULTS.cognition.reply)
})

test('typing config: default off, strict boolean and private-only turn panel switch', () => {
  assert.deepEqual(DEFAULTS.cognition.typing, { enabled: false })
  assert.deepEqual(normalizeConfig({}).config.cognition.typing, { enabled: false })
  for (const enabled of [true, false, 'true', 'false', 1, null]) {
    assert.deepEqual(normalizeConfig({ cognition: { typing: { enabled } } }).config.cognition.typing, { enabled: enabled === true })
  }
  const field = CONFIG_GROUPS.find((group) => group.id === 'cog-turn').fields.find((item) => item.path === 'cognition.typing.enabled')
  assert.equal(field.type, 'switch')
  assert.equal(field.default, false)
  assert.match(field.help, /私聊\/C2C/)
  assert.match(field.help, /不发送群聊输入状态/)
  assert.match(field.help, /默认关闭/)
})

test('command permissions config: empty defaults and string-list panel field', () => {
  const { config, issues } = normalizeConfig({})
  assert.deepEqual(DEFAULTS.cognition.permissions, { deniedCommands: [] })
  assert.deepEqual(config.cognition.permissions, { deniedCommands: [] })
  assert.equal(issues.some((issue) => issue.includes('deniedCommands')), false)
  const field = CONFIG_GROUPS.find((group) => group.id === 'cog-permissions').fields
    .find((item) => item.path === 'cognition.permissions.deniedCommands')
  assert.equal(field.type, 'string-list')
  assert.equal(field.label, '禁用命令')
  assert.deepEqual(field.default, [])
  assert.ok(field.help)
})

test('command permissions config: strict names, deduplication and invalid-entry issues', () => {
  const deniedCommands = ['kick', 'draw', 'kick', 'a', 'a'.repeat(32), 'module_cmd-1', 'DRAW', '/kick', ' kick', 'kick ', '', '1cmd', 'a.b', 'a'.repeat(33), 42, null, {}, ['draw'], 'draw\n']
  const original = structuredClone(deniedCommands)
  const { config, issues } = normalizeConfig({ cognition: { permissions: { deniedCommands } } })
  assert.deepEqual(config.cognition.permissions.deniedCommands, ['kick', 'draw', 'a', 'a'.repeat(32), 'module_cmd-1'])
  assert.ok(issues.some((issue) => issue.includes('deniedCommands') && issue.includes('非法项')))
  assert.deepEqual(deniedCommands, original)
  for (const value of ['kick', null, 1, {}, true]) {
    const result = normalizeConfig({ cognition: { permissions: { deniedCommands: value } } })
    assert.deepEqual(result.config.cognition.permissions.deniedCommands, [])
    assert.ok(result.issues.some((issue) => issue.includes('deniedCommands') && issue.includes('数组')))
  }
})

test('command permissions config: retains at most 100 unique valid names', () => {
  const names = Array.from({ length: 101 }, (_, index) => `cmd${index}`)
  const normalize = (deniedCommands) => normalizeConfig({ cognition: { permissions: { deniedCommands } } })
  const full = normalize(names.slice(0, 100).flatMap((name) => [name, name]))
  assert.deepEqual(full.config.cognition.permissions.deniedCommands, names.slice(0, 100))
  assert.equal(full.issues.some((issue) => issue.includes('deniedCommands')), false)
  const overflow = normalize(['invalid.name', ...names.flatMap((name) => [name, name])])
  assert.deepEqual(overflow.config.cognition.permissions.deniedCommands, names.slice(0, 100))
  assert.ok(overflow.issues.some((issue) => issue.includes('deniedCommands') && issue.includes('100')))
  assert.ok(overflow.issues.some((issue) => issue.includes('deniedCommands') && issue.includes('非法项')))
})

test('字段表与 DEFAULTS 不漂移：每个面板字段的 default 都等于 DEFAULTS 里的值', () => {
  const drift = []
  for (const group of CONFIG_GROUPS) {
    for (const field of group.fields) {
      const actual = getPath(DEFAULTS, field.path)
      const expected = field.default
      const same = JSON.stringify(actual) === JSON.stringify(expected)
      if (!same) drift.push(`${field.path}: DEFAULTS=${JSON.stringify(actual)} group.default=${JSON.stringify(expected)}`)
    }
  }
  assert.deepEqual(drift, [], 'DEFAULTS 与 CONFIG_GROUPS 必须一致（面板与后端共用同一份默认值）')
})

test('group relevance config: default off, threshold clamping and turn panel fields', () => {
  assert.deepEqual(normalizeConfig({}).config.cognition.turn.groupRelevance, { enabled: false, minScore: 0.15 })
  for (const [minScore, expected] of [[-1, 0], [2, 1], [0, 0], [1, 1], ['0.4', 0.4], ['bad', 0.15], [Infinity, 0.15], [NaN, 0.15], [null, 0.15]]) {
    const { config } = normalizeConfig({ cognition: { turn: { groupRelevance: { enabled: true, minScore } } } })
    assert.deepEqual(config.cognition.turn.groupRelevance, { enabled: true, minScore: expected })
  }
  assert.equal(normalizeConfig({ cognition: { turn: { groupRelevance: { enabled: 'true' } } } }).config.cognition.turn.groupRelevance.enabled, false)
  const fields = CONFIG_GROUPS.find((group) => group.id === 'cog-turn').fields
  assert.equal(fields.find((field) => field.path === 'cognition.turn.groupRelevance.enabled').type, 'switch')
  const threshold = fields.find((field) => field.path === 'cognition.turn.groupRelevance.minScore')
  assert.deepEqual([threshold.type, threshold.min, threshold.max, threshold.default], ['number', 0, 1, 0.15])
})

test('normalizeConfig：非法 wsUrl 也会产生可读 issue（不再静默清空）', () => {
  const { config, issues } = normalizeConfig({
    onebot: { wsUrl: 'ftp://127.0.0.1:3001', httpUrl: 'http://127.0.0.1:3000' },
  })
  assert.equal(config.onebot.wsUrl, '', '非法协议应回退为空')
  assert.equal(config.onebot.httpUrl, 'http://127.0.0.1:3000')
  assert.ok(issues.some((issue) => issue.includes('ws:') || issue.includes('协议')), '应记录 wsUrl 的 issue：' + JSON.stringify(issues))
})

test('normalizeConfig：probeMs 下限与字段表一致（1000）', () => {
  const field = CONFIG_GROUPS.flatMap((group) => group.fields).find((item) => item.path === 'timeouts.probeMs')
  const { config } = normalizeConfig({ timeouts: { probeMs: 500 } })
  assert.equal(field.min, 1000)
  assert.equal(config.timeouts.probeMs, 1000, '500 应被 clamp 到下限 1000')
})

test('normalizeConfig：非法枚举/类型回退默认值', () => {
  const { config } = normalizeConfig({
    gateway: 'unknown',
    accountCheck: 'boom',
    onebot: { httpAuth: 'magic' },
    logging: { level: 'verbose' },
    reconnect: { factor: 99, jitterRatio: -1 },
  })
  assert.equal(config.gateway, DEFAULTS.gateway)
  assert.equal(config.accountCheck, DEFAULTS.accountCheck)
  assert.equal(config.onebot.httpAuth, DEFAULTS.onebot.httpAuth)
  assert.equal(config.logging.level, DEFAULTS.logging.level)
  assert.equal(config.reconnect.factor, 5)
  assert.equal(config.reconnect.jitterRatio, 0)
})

test('normalizeConfig：ui 外观/动效偏好合法值保留、非法枚举回退默认', () => {
  const ok = normalizeConfig({
    ui: { accent: 'blue', density: 'comfortable', fontScale: 'large', contentWidth: 'auto', motion: 'reduced', pageTransition: 'fade-up', contrast: 'high' },
  })
  assert.deepEqual(ok.config.ui, {
    refreshMs: DEFAULTS.ui.refreshMs,
    eventPageSize: DEFAULTS.ui.eventPageSize,
    logPageSize: DEFAULTS.ui.logPageSize,
    accent: 'blue',
    density: 'comfortable',
    fontScale: 'large',
    contentWidth: 'auto',
    motion: 'reduced',
    pageTransition: 'fade-up',
    contrast: 'high',
  })

  const bad = normalizeConfig({
    ui: { accent: 'magenta', density: 'huge', fontScale: 'xl', contentWidth: 'full', motion: 'sometimes', pageTransition: 'zoom', contrast: 'ultra' },
  })
  assert.equal(bad.config.ui.accent, DEFAULTS.ui.accent)
  assert.equal(bad.config.ui.density, DEFAULTS.ui.density)
  assert.equal(bad.config.ui.fontScale, DEFAULTS.ui.fontScale)
  assert.equal(bad.config.ui.contentWidth, DEFAULTS.ui.contentWidth)
  assert.equal(bad.config.ui.motion, DEFAULTS.ui.motion)
  assert.equal(bad.config.ui.pageTransition, DEFAULTS.ui.pageTransition)
  assert.equal(bad.config.ui.contrast, DEFAULTS.ui.contrast)
})

test('logger：logging.redact=true 脱敏，redact=false 时按原样记录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ob-log-'))
  process.env.DSH_BOT_DATA_DIR = dir
  try {
    const raw = 'Authorization: Bearer abcdefgh12345678'
    const redacting = createLogger({ getConfig: () => ({ logging: { level: 'debug', bufferSize: 50, redact: true } }) })
    redacting.child('t').info(raw)
    assert.equal(redacting.recent({ limit: 10 }).items.at(-1).text.includes('abcdefgh12345678'), false)

    const plain = createLogger({ getConfig: () => ({ logging: { level: 'debug', bufferSize: 50, redact: false } }) })
    plain.child('t').info(raw)
    assert.equal(plain.recent({ limit: 10 }).items.at(-1).text, raw)
  } finally {
    delete process.env.DSH_BOT_DATA_DIR
    rmSync(dir, { recursive: true, force: true })
  }
})

test('cognition 配置：默认值、字段分组、非法枚举/数值回退与边界', () => {
  const { config } = normalizeConfig({})
  assert.equal(config.cognition.enabled, true)
  assert.equal(config.cognition.paused, false)
  assert.equal(config.cognition.llm.mode, 'auto')
  assert.equal(config.cognition.llm.fallbackToDsh, true)
  const direct = normalizeConfig({ cognition: { llm: { mode: 'direct' } } }).config
  assert.equal(direct.cognition.llm.mode, 'direct')
  const badMode = normalizeConfig({ cognition: { llm: { mode: 'magic' } } }).config
  assert.equal(badMode.cognition.llm.mode, 'auto')
  assert.equal(config.cognition.memory.semanticIndex, 'lexical')
  assert.equal(config.cognition.privacy.privateIsolation, true)
  assert.equal(config.cognition.turn.addressedOnlyGroups, true)
  assert.equal(config.cognition.turn.groupReplyMode, 'addressed')
  assert.equal(config.cognition.turn.groupReplyProbability, 0.2)
  assert.equal(config.cognition.turn.groupCooldownMs, 3000)
  const legacyAll = normalizeConfig({ cognition: { turn: { addressedOnlyGroups: false } } }).config
  assert.equal(legacyAll.cognition.turn.groupReplyMode, 'all')
  const legacyAmbient = normalizeConfig({ cognition: { policy: { groupAmbient: true } } }).config
  assert.equal(legacyAmbient.cognition.turn.groupReplyMode, 'all')
  const badGroupMode = normalizeConfig({ cognition: { turn: { groupReplyMode: 'wild' } } }).config
  assert.equal(badGroupMode.cognition.turn.groupReplyMode, 'addressed')
  assert.equal(config.cognition.policy.proactive, false)
  assert.equal(config.cognition.learning.autoResearch, false)
  assert.equal(config.cognition.persona.traits.openness, DEFAULTS.cognition.persona.traits.openness)
  assert.ok(Array.isArray(config.cognition.persona.values))

  const cognitionGroups = CONFIG_GROUPS.filter((group) => group.id.startsWith('cog-'))
  assert.ok(cognitionGroups.length >= 8, 'cognition 配置应拆成多个字段组')
  const paths = cognitionGroups.flatMap((group) => group.fields.map((field) => field.path))
  assert.ok(paths.includes('cognition.llm.mode'))
  assert.ok(paths.includes('cognition.turn.privateMaxMs'))
  assert.ok(paths.includes('cognition.turn.groupReplyMode'))
  assert.ok(paths.includes('cognition.memory.retrievalTopK'))
  assert.ok(paths.includes('cognition.privacy.rawRetentionDays'))

  const bad = normalizeConfig({
    cognition: {
      enabled: 'yes',
      dryRun: 1,
      llm: { mode: 'magic', temperature: 9, analysisMaxTokens: 1, maxConcurrency: 99 },
      turn: { privateMaxMs: 10, maxAggregateMessages: 999 },
      persona: { traits: { openness: 2, humor: -1 } },
      memory: { semanticIndex: 'vectors', retrievalTopK: 999 },
      privacy: { privateIsolation: 'no', rawRetentionDays: -5 },
    },
  }).config.cognition
  assert.equal(bad.enabled, DEFAULTS.cognition.enabled)
  assert.equal(bad.dryRun, DEFAULTS.cognition.dryRun)
  assert.equal(bad.llm.mode, 'auto')
  assert.equal(bad.llm.temperature, 1.5)
  assert.equal(bad.llm.analysisMaxTokens, 128)
  assert.equal(bad.llm.maxConcurrency, 8)
  assert.equal(bad.turn.privateMaxMs, 3000)
  assert.equal(bad.turn.maxAggregateMessages, 50)
  assert.equal(bad.persona.traits.openness, 0.9)
  assert.equal(bad.persona.traits.humor, 0.1)
  assert.equal(bad.memory.semanticIndex, 'lexical')
  assert.equal(bad.memory.retrievalTopK, 30)
  assert.equal(bad.privacy.privateIsolation, DEFAULTS.cognition.privacy.privateIsolation)
  assert.equal(bad.privacy.rawRetentionDays, 0)
})

test('qqAdmin config: opt-in defaults, bounded maxText and confirmation normalization', () => {
  assert.deepEqual(normalizeConfig({}).config.cognition.qqAdmin, { enabled: false, requireApproval: false, requireConfirm: true, maxText: 100 })
  assert.deepEqual(normalizeConfig({ cognition: { qqAdmin: { enabled: true, requireConfirm: false, maxText: 500 } } }).config.cognition.qqAdmin, { enabled: true, requireApproval: false, requireConfirm: false, maxText: 100 })
  assert.equal(normalizeConfig({ cognition: { qqAdmin: { maxText: -10 } } }).config.cognition.qqAdmin.maxText, 1)
})

test('embedding config: opt-in defaults, memory fields and normalized bounds', () => {
  const embedding = normalizeConfig({}).config.cognition.memory.embedding
  assert.deepEqual(embedding, { enabled: false, baseUrl: '', model: 'text-embedding-3-small', apiKeyEnv: '', weight: 0.35 })
  const fields = CONFIG_GROUPS.find((group) => group.id === 'cog-memory').fields.map((field) => field.path)
  for (const name of Object.keys(embedding)) assert.ok(fields.includes(`cognition.memory.embedding.${name}`))
  const normalize = (input) => normalizeConfig({ cognition: { memory: { embedding: input } } }).config.cognition.memory.embedding
  assert.equal(normalize({ enabled: 'yes', baseUrl: 'file:///tmp/private', model: 1, weight: 'bad' }).enabled, false)
  assert.equal(normalize({ baseUrl: 'file:///tmp/private' }).baseUrl, '')
  assert.equal(normalize({ weight: 2 }).weight, 1)
  assert.equal(normalize({ weight: -1 }).weight, 0)
  assert.equal(normalize({ weight: 'bad' }).weight, 0.35)
  assert.deepEqual(normalize({ enabled: true, baseUrl: 'https://embedding.invalid/v1', model: 'custom', apiKeyEnv: 'EMBED_KEY', weight: 0.5 }),
    { enabled: true, baseUrl: 'https://embedding.invalid/v1', model: 'custom', apiKeyEnv: 'EMBED_KEY', weight: 0.5 })
})

test('operator config: empty upgrade default, normalized QQ list and access string-list field', () => {
  assert.deepEqual(DEFAULTS.access.operators, [])
  assert.deepEqual(normalizeConfig({ access: { ownerQQ: '10001' } }).config.access.operators, [])
  assert.deepEqual(normalizeConfig({ access: { operators: [' 10002 ', 10003, '10002', ''] } }).config.access.operators, ['10002', '10003'])
  const field = CONFIG_GROUPS.find((group) => group.id === 'access').fields.find((item) => item.path === 'access.operators')
  assert.equal(field.type, 'string-list')
  assert.deepEqual(field.default, [])
  assert.match(field.help, /500/)
})


test('qqAdmin approval config: strict opt-in and switch/help in QQ admin group', () => {
  const normalize = (requireApproval) => normalizeConfig({ cognition: { qqAdmin: { requireApproval } } }).config.cognition.qqAdmin.requireApproval
  assert.equal(DEFAULTS.cognition.qqAdmin.requireApproval, false)
  assert.equal(normalize(true), true)
  for (const value of [false, 'true', 1, null]) assert.equal(normalize(value), false)
  const field = CONFIG_GROUPS.flatMap((group) => group.fields).find((item) => item.path === 'cognition.qqAdmin.requireApproval')
  assert.equal(field.type, 'switch')
  assert.equal(field.default, false)
  assert.match(field.help, /approvals.*approve.*reject/)
})


test('LLM dual budgets: defaults preserve global semantics and panel exposes three modes and limits', () => {
  const { config } = normalizeConfig({})
  for (const llm of [DEFAULTS.cognition.llm, config.cognition.llm]) {
    assert.equal(llm.budgetScope, 'global')
    assert.equal(llm.dailyTokenBudget, 300000)
    assert.equal(llm.personaDailyTokenBudget, 300000)
  }
  const fields = CONFIG_GROUPS.find((group) => group.id === 'cog-llm').fields
  const scope = fields.find((field) => field.path === 'cognition.llm.budgetScope')
  assert.equal(scope.type, 'select')
  assert.equal(scope.default, 'global')
  assert.deepEqual(scope.options, [{ value: 'global', label: '全局' }, { value: 'persona', label: '按人格' }, { value: 'both', label: '两者取最小' }])
  for (const name of ['dailyTokenBudget', 'personaDailyTokenBudget']) {
    const field = fields.find((field) => field.path === 'cognition.llm.' + name)
    assert.equal(field.type, 'number')
    assert.equal(field.default, 300000)
    assert.equal(field.min, 1000)
    assert.equal(field.max, 5000000)
  }
  assert.equal(fields.find((field) => field.path === 'cognition.llm.dailyTokenBudget').label, '全局每日 token 预算')
})

test('LLM dual budgets: normalize scopes and persona limits; invalid input defaults with issue', () => {
  for (const budgetScope of ['global', 'persona', 'both']) {
    for (const personaDailyTokenBudget of [1000, 5000000, '12345']) {
      const { config } = normalizeConfig({ cognition: { llm: { budgetScope, personaDailyTokenBudget, dailyTokenBudget: 4321 } } })
      assert.equal(config.cognition.llm.budgetScope, budgetScope)
      assert.equal(config.cognition.llm.personaDailyTokenBudget, Number(personaDailyTokenBudget))
      assert.equal(config.cognition.llm.dailyTokenBudget, 4321)
    }
  }
  for (const budgetScope of ['', 'GLOBAL', 'invalid', null, 5, {}, ['persona']]) {
    const { config, issues } = normalizeConfig({ cognition: { llm: { budgetScope } } })
    assert.equal(config.cognition.llm.budgetScope, 'global')
    assert.ok(issues.some((issue) => issue.includes('llm.budgetScope')))
  }
  for (const personaDailyTokenBudget of [0, 999, 5000001, -1, '', 'bad', null, true, [], {}]) {
    const { config, issues } = normalizeConfig({ cognition: { llm: { personaDailyTokenBudget } } })
    assert.equal(config.cognition.llm.personaDailyTokenBudget, 300000)
    assert.ok(issues.some((issue) => issue.includes('llm.personaDailyTokenBudget')))
  }
})

test('module ownership is bounded metadata on exactly the existing legacy fields', () => {
  const expected = {
    'builtin-learning': ['enabled', 'autoResearch', 'detectUnknowns', 'maxTasksPerHour', 'maxQueries', 'maxSources', 'dailyTokenBudget', 'taskTtlHours', 'retry', 'minConfidence', 'sources.web', 'sources.wikipedia', 'sources.openalex', 'sources.github', 'sources.rss', 'sources.local'].map(key => 'cognition.learning.' + key),
    'builtin-reply-delivery': ['split', 'maxChars', 'maxParts', 'delayMs', 'quote', 'atSender'].map((key) => 'cognition.reply.' + key),
    'builtin-proactivity': ['enabled', 'quietStart', 'quietEnd', 'maxPrivatePerDay', 'maxGroupPerDay', 'minFamiliarity', 'backoffHours'].map((key) => 'cognition.proactivity.' + key),
    'builtin-typing': ['cognition.typing.enabled'],
    'builtin-media-features': ['media.stickers.enabled', 'media.stickers.maxCount', 'media.stickers.maxBytes', 'content.bilibili.enabled', 'content.bilibili.timeoutMs', 'content.bilibili.maxResults'],
    'builtin-reminders': ['enabled', 'maxActive', 'minIntervalSeconds', 'maxIntervalSeconds', 'tickMs'].map((key) => 'cognition.reminders.' + key),
  }
  const fields = CONFIG_GROUPS.flatMap((group) => group.fields)
  assert.equal(fields.filter((field) => field.module).length, 41)
  for (const [module, paths] of Object.entries(expected)) {
    assert.match(module, /^[a-z0-9][a-z0-9_-]{0,63}$/)
    assert.deepEqual(fields.filter((field) => field.module === module).map((field) => field.path), paths)
    for (const path of paths) {
      assert.deepEqual(fields.find((field) => field.path === path).default, getPath(DEFAULTS, path))
      assert.deepEqual(getPath(normalizeConfig({}).config, path), getPath(DEFAULTS, path))
    }
  }
})
