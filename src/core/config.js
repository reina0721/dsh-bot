// 插件配置：默认值 + 规范化/校验 + 持久化 + 面板字段表。
//
// 设计原则（见 docs/ARCHITECTURE.md）：
// 1. 所有算法参数（重连退避、超时、重试、缓冲容量、过滤规则…）都必须是配置项；
// 2. 默认值集中在 DEFAULTS，面板字段表由 CONFIG_GROUPS 数据驱动（UI 不写死表单）；
// 3. 配置写在数据目录 config.json，原子写；损坏时回退默认值并记录问题。

import { dataDir, readJson, writeJson, existsSync } from './store.js'
import { registerSecret, clearSecrets, redact } from './redact.js'
import { normalizeAccess } from './access.js'

export const CONFIG_VERSION = 2
export const CONFIG_FILE = 'config.json'

export const DEFAULTS = {
  version: CONFIG_VERSION,
  // 总开关：插件启动后是否自动连接（面板上随时可以手动连接）
  enabled: true,
  // 网关类型：onebot = 直接连你填的 OneBot v11 地址；snowluma = 从 SnowLuma 配置里自动读地址
  gateway: 'onebot',
  // 机器人 QQ 号（用于登录核验；留空则不核验账号，只展示）
  botQQ: '',
  // 账号不一致时的策略：off 不检查；warn 只警告；enforce 断开并暂停自动重连
  accountCheck: 'warn',
  onebot: {
    wsUrl: '',
    httpUrl: '',
    wsToken: '',
    httpToken: '',
    // HTTP 调用时 token 的携带方式：bearer = Authorization: Bearer；header-token = X-Access-Token；
    // query = ?access_token=（部分网关只认这种）
    httpAuth: 'bearer',
  },
  snowluma: {
    // SnowLuma 安装目录（含 index.mjs 与 config/）；留空 = 尝试从默认位置探测
    dir: '',
    // 指定读取哪个账号的 OneBot 配置（onebot_<uin>.json）；留空 = 自动扫描
    uin: '',
    autoDetect: true,
  },
  reconnect: {
    enabled: true,
    minDelayMs: 2000,
    maxDelayMs: 30000,
    factor: 2,
    jitterRatio: 0.2,
  },
  timeouts: {
    callMs: 30000,
    connectMs: 10000,
    verifyMs: 10000,
    probeMs: 3000,
    maxRetries: 3,
    retryDelaysMs: [1000, 3000, 5000],
  },
  verification: {
    enabled: true,
    // 核验期间暂存的事件上限，核验通过后按序补发
    bufferSize: 100,
  },
  events: {
    enabled: true,
    bufferSize: 200,
    includeSelfMessages: true,
    kinds: { message: true, notice: true, request: true, meta_event: true },
    messageSubTypes: { private: true, group: true },
    ignoreUsers: [],
    ignoreGroups: [],
    // 原始事件落盘/展示时的截断上限，防止一条超大消息撑爆内存
    rawMaxBytes: 16384,
    persist: { enabled: false, file: 'events.jsonl', maxMB: 32 },
  },
  logging: {
    level: 'info',
    bufferSize: 500,
    persist: { enabled: false },
    redact: true,
  },
  ui: {
    refreshMs: 2000,
    eventPageSize: 50,
    logPageSize: 100,
    // 以下外观/动效偏好全部由面板「系统设置」页读写并持久化；client.js 不写死这些值。
    // 取值与 console-web 的 appearance preferences 对齐（accent/density/fontScale/motion/pageTransition/contrast）。
    // 主题（浅色/深色/跟随系统）不在这里：它由 DSH 自己的 theme 偏好持有，面板只提供快捷入口。
    accent: 'purple', // purple | blue | green | orange | inherit
    density: 'standard', // compact | standard | comfortable
    fontScale: 'standard', // small | standard | large
    contentWidth: 'wide', // standard(72rem) | wide(100rem) | auto
    motion: 'system', // system | full | reduced | off
    pageTransition: 'default', // default | fade | fade-slide | fade-up | fade-down | none
    contrast: 'system', // system | standard | high
  },
  security: {
    // 面板「高级」里透传任意 OneBot action（调试用，默认关）
    allowRawAction: false,
    leakGuard: { enabled: true, action: 'redact' },
  },
  ops: {
    upgrade: { enabled: false, channel: 'stable', repo: 'reina0721/dsh-bot', timeoutMs: 10000, cacheMinutes: 60 },
    backup: { enabled: true, includeMedia: false, maxSnapshots: 10, maxBytes: 209715200, maxFiles: 5000, prune: true, allowRestore: false },
  },
  // 媒体能力总开关；provider 均默认关闭，默认配置不会产生任何媒体网络请求。
  media: {
    enabled: false,
    maxBytes: 10 * 1024 * 1024,
    dir: '',
    stickers: { enabled: true, maxCount: 200, maxBytes: 5 * 1024 * 1024 },
    tts: { maxChars: 300 },
    images: {
      enabled: false,
      visionEnabled: false,
      visionBaseUrl: '',
      visionModel: '',
      visionApiKeyEnv: '',
      generateEnabled: false,
      generateBaseUrl: '',
      generateModel: 'gpt-image-1',
      generateApiKeyEnv: '',
      generateSize: '1024x1024',
      editEnabled: false,
      editBaseUrl: '',
      editModel: '',
      editApiKeyEnv: '',
      editSize: '1024x1024',
    },
    audio: {
      asrEnabled: false,
      asrBaseUrl: '',
      asrModel: 'whisper-1',
      asrApiKeyEnv: '',
      ttsEnabled: false,
      ttsBaseUrl: '',
      ttsModel: 'tts-1',
      ttsVoice: 'alloy',
      ttsApiKeyEnv: '',
    },
    files: { enabled: false },
  },
  // 公共内容源；默认关闭，默认配置不会访问 Bilibili。
  content: {
    bilibili: { enabled: false, timeoutMs: 15000, maxResults: 5 },
  },
  // 访问控制：open 保持现状；allowlist 只允许主人 + 只读操作员 + 白名单触发回复/主动行为。
  access: {
    mode: 'open',
    ownerQQ: '',
    ownerName: '主人',
    operators: [],
    private: [],
    groups: [],
    auditSize: 100,
  },
  // DSH Session 运行时：oneshot = 现有一次性 LLM；agent = 每聊天 DSH Session（默认先不切换）。
  runtime: {
    engine: 'oneshot',
    workspaceDir: '',
    replyTimeoutMs: 120000,
  },
  cognition: {
    enabled: true,
    paused: false,
    dryRun: false,
    locale: 'zh-CN',
    timezone: '',
    typing: { enabled: false },
    delivery: { engine: 'auto' }, // Internal rollback switch; not a panel field.
    turn: {
      privateBaseMs: 1800,
      privateMaxMs: 10000,
      groupMaxMs: 9000,
      fastPathMs: 300,
      shortMsgMs: 1200,
      incompleteFactorMs: 4500,
      habitAdjMaxMs: 1500,
      maxAggregateMessages: 20,
      groupReplyMode: 'addressed', // addressed | probability | all
      groupReplyProbability: 0.2,
      groupRelevance: { enabled: false, minScore: 0.15 },
      groupCooldownMs: 3000,
      groupMaxRepliesPerMinute: 6,
      maxConsecutiveGroupReplies: 3,
      addressedOnlyGroups: true, // 兼容旧配置；新代码以 groupReplyMode 为准
      wakeWords: [],
    },
    reply: {
      split: true,
      maxChars: 300,
      maxParts: 3,
      delayMs: 600,
      quote: true,
      atSender: false,
    },
    notices: { enabled: true },
    requests: { enabled: true },
    permissions: { deniedCommands: [] },
    reminders: { enabled: false, maxActive: 50, minIntervalSeconds: 60, maxIntervalSeconds: 2592000, tickMs: 30000 },
    qqAdmin: { enabled: false, requireApproval: false, requireConfirm: true, maxText: 100 },
    notice: {
      patReply: true,
      patCooldownMs: 60000,
    },
    purpose: {
      enabled: true,
      maxActive: 5,
      injectPrompt: true,
      promptLimit: 3,
    },
    import: { enabled: true, maxBytes: 5242880, maxItems: 5000 },
    consolidation: {
      enabled: true,
      hour: 4,
      reflect: true,
      reflectMinEpisodes: 10,
    },
    llm: {
      mode: 'auto', // auto | dsh | fixed | direct | chain
      fallbackToDsh: true,
      provider: '',
      model: '',
      reasoningEffort: '',
      temperature: 0.7,
      analysisMaxTokens: 1800,
      composeMaxTokens: 800,
      timeoutMs: 20000,
      dailyTokenBudget: 300000,
      budgetScope: 'global',
      personaDailyTokenBudget: 300000,
      maxConcurrency: 2,
      retry: 1,
      cache: true,
    },
    // 按聊天选模型：provider/model；routes 形如 "10001=opencode-go/deepseek-v4.1-flash"
    modelRouting: {
      privateDefault: '',
      groupDefault: '',
      routes: [],
    },
    persona: {
      traits: {
        extraversion: 0.55,
        openness: 0.7,
        agreeableness: 0.6,
        conscientiousness: 0.55,
        emotionalSensitivity: 0.55,
        humor: 0.6,
        socialInitiative: 0.55,
        caution: 0.6,
        expressiveness: 0.55,
        conflictApproach: 0.45,
        riskTolerance: 0.4,
        consistency: 0.7,
      },
      style: {
        formality: 0.45,
        verbosity: 0.5,
        emojiRate: 0.25,
        punctuation: 0.55,
        teasingBound: 0.45,
        warmth: 0.6,
      },
      values: ['诚实', '尊重边界', '不假装感知', '承认不确定', '关心具体的人'],
      profile: {
        displayName: '',
        tagline: '',
        identity: '',
        background: '',
        personality: '',
        speakingStyle: '',
        likes: [],
        dislikes: [],
        boundaries: [],
        examples: '',
      },
      evolutionPerDay: 0.005,
      evolutionEnabled: true,
      min: 0.1,
      max: 0.9,
    },
    emotion: {
      sensitivity: 0.55,
      regulation: 0.4,
      valenceHalfLifeMin: 120,
      arousalHalfLifeMin: 30,
      stressHalfLifeMin: 360,
      moodHalfLifeMin: 480,
      effectsEnabled: true,
    },
    relationship: {
      learningRate: 0.15,
      trustRate: 0.07,
      intimacyRate: 0.05,
      conflictRise: 0.2,
      conflictDecay: 0.03,
      inertia: 0.85,
      repairThreshold: 0.65,
    },
    memory: {
      retrievalTopK: 8,
      maxContextChars: 4000,
      recencyWeight: 0.3,
      importanceWeight: 0.25,
      relevanceWeight: 0.25,
      emotionWeight: 0.1,
      relationshipWeight: 0.05,
      associationWeight: 0.05,
      recencyHalfLifeDays: 30,
      forgetHalfLifeDays: 60,
      consolidateEvery: 25,
      semanticIndex: 'lexical', // 兼容旧配置；可选向量重排由 embedding.enabled 控制
      embedding: { enabled: false, baseUrl: '', model: 'text-embedding-3-small', apiKeyEnv: '', weight: 0.35 },
    },
    policy: {
      replyThreshold: 0.52,
      waitThreshold: 0.38,
      silenceThreshold: 0.3,
      addressedBoost: 0.15,
      groupPenalty: 0.1,
      epsilon: 0.04,
      dailyGlobalLimit: 120,
      perChatPrivate: 30,
      perChatGroup: 10,
      maxConsecutiveBotMessages: 2,
      proactive: false,
      groupAmbient: false,
      analyzeWithLlm: true,
    },
    learning: {
      enabled: true,
      autoResearch: false,
      detectUnknowns: true,
      maxTasksPerHour: 3,
      maxQueries: 2,
      maxSources: 5,
      dailyTokenBudget: 20000,
      taskTtlHours: 24,
      retry: 1,
      minConfidence: 0.45,
      sources: { web: true, wikipedia: true, openalex: true, github: true, rss: false, local: false },
    },
    proactivity: {
      enabled: false,
      quietStart: 23,
      quietEnd: 8,
      maxPrivatePerDay: 1,
      maxGroupPerDay: 0,
      minFamiliarity: 0.5,
      backoffHours: 24,
    },
    privacy: {
      privateIsolation: true,
      learnFromPrivate: false,
      rawRetentionDays: 180,
      traceRetentionDays: 30,
      decisionRetentionDays: 90,
      metricsRetentionDays: 365,
      exportSecret: false,
    },
    debug: { trace: true, keepPrompt: false },
  },
}

/**
 * 面板字段表：数据驱动渲染，新增配置项只要在这里加一条。
 * type: switch | text | secret | number | select | string-list | number-list | textarea
 */
export const CONFIG_GROUPS = [
  {
    id: 'ops', title: '备份与运维',
    description: '本地目录快照，含密钥与认知隐私；默认只暂存恢复。应用前停止写入，完成后重启。',
    fields: [
      { path: 'ops.upgrade.enabled', label: '启用手动升级检查', type: 'switch', default: false },
      { path: 'ops.upgrade.channel', label: 'Release 通道', type: 'select', default: 'stable', options: [{ value: 'stable', label: '稳定版' }, { value: 'beta', label: '含预发布版' }] },
      { path: 'ops.upgrade.repo', label: 'GitHub 仓库（owner/repo）', type: 'text', default: 'reina0721/dsh-bot' },
      { path: 'ops.upgrade.timeoutMs', label: '升级检查超时', type: 'number', default: 10000, min: 1000, max: 120000, step: 1000, unit: 'ms' },
      { path: 'ops.upgrade.cacheMinutes', label: '检查缓存分钟数', type: 'number', default: 60, min: 0, max: 10080, step: 1 },
      { path: 'ops.backup.enabled', label: '启用本地备份', type: 'switch', default: true },
      { path: 'ops.backup.includeMedia', label: '面板默认包含全部媒体', type: 'switch', default: false },
      { path: 'ops.backup.maxSnapshots', label: '最多保留快照', type: 'number', default: 10, min: 1, max: 1000, step: 1 },
      { path: 'ops.backup.maxBytes', label: '单次备份字节上限', type: 'number', default: 209715200, min: 1, max: 10737418240, step: 1 },
      { path: 'ops.backup.maxFiles', label: '单次备份文件上限', type: 'number', default: 5000, min: 1, max: 100000, step: 1 },
      { path: 'ops.backup.prune', label: '自动清理最旧快照', type: 'switch', default: true },
      { path: 'ops.backup.allowRestore', label: '允许应用恢复（需停止写入并重启）', type: 'switch', default: false },
    ],
  },
  {
    id: 'media',
    title: '媒体',
    description: '图片、语音与文件基础能力。默认全部关闭；API Key 只填写环境变量名，不填写密钥本身。',
    fields: [
      { path: 'media.enabled', label: '启用媒体基础能力', type: 'switch', default: false },
      { path: 'media.maxBytes', label: '单个媒体大小上限', type: 'number', default: 10485760, min: 1024, max: 104857600, step: 1048576, unit: 'bytes' },
      { path: 'media.dir', label: '媒体目录', type: 'text', default: '', placeholder: '留空使用数据目录 media/' },
      { path: 'media.stickers.enabled', module: 'builtin-media-features', label: '启用表情包库', type: 'switch', default: true, help: '库管理需要模块与媒体总开关开启；QQ 发送还需要图片开关开启。' },
      { path: 'media.stickers.maxCount', module: 'builtin-media-features', label: '表情包数量上限', type: 'number', default: 200, min: 1, max: 5000, step: 1 },
      { path: 'media.stickers.maxBytes', module: 'builtin-media-features', label: '单个表情包大小上限', type: 'number', default: 5242880, min: 1024, max: 52428800, step: 1048576, unit: 'bytes' },
      { path: 'media.tts.maxChars', label: 'TTS 文本字符上限', type: 'number', default: 300, min: 1, max: 5000, step: 10 },
      { path: 'media.images.enabled', label: '接收/发送图片', type: 'switch', default: false },
      { path: 'media.images.visionEnabled', label: '图片理解', type: 'switch', default: false, help: '调用 OpenAI 兼容 chat/completions；默认关闭。' },
      { path: 'media.images.visionBaseUrl', label: 'Vision Base URL', type: 'text', default: '', placeholder: 'https://api.example.com/v1' },
      { path: 'media.images.visionModel', label: 'Vision 模型', type: 'text', default: '' },
      { path: 'media.images.visionApiKeyEnv', label: 'Vision API Key 环境变量名', type: 'text', default: '', placeholder: 'OPENAI_API_KEY' },
      { path: 'media.images.generateEnabled', label: '生图', type: 'switch', default: false },
      { path: 'media.images.generateBaseUrl', label: '生图 Base URL', type: 'text', default: '' },
      { path: 'media.images.generateModel', label: '生图模型', type: 'text', default: 'gpt-image-1' },
      { path: 'media.images.generateApiKeyEnv', label: '生图 API Key 环境变量名', type: 'text', default: '' },
      { path: 'media.images.generateSize', label: '生图尺寸', type: 'select', default: '1024x1024', options: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'].map((value) => ({ value, label: value })) },
      { path: 'media.images.editEnabled', label: '改图', type: 'switch', default: false },
      { path: 'media.images.editBaseUrl', label: '改图 Base URL', type: 'text', default: '', help: '留空沿用生图配置。' },
      { path: 'media.images.editModel', label: '改图模型', type: 'text', default: '', help: '留空沿用生图配置。' },
      { path: 'media.images.editApiKeyEnv', label: '改图 API Key 环境变量名', type: 'text', default: '', help: '留空沿用生图配置。' },
      { path: 'media.images.editSize', label: '改图尺寸', type: 'select', default: '1024x1024', options: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'].map((value) => ({ value, label: value })) },
      { path: 'media.audio.asrEnabled', label: '语音转写 ASR', type: 'switch', default: false },
      { path: 'media.audio.asrBaseUrl', label: 'ASR Base URL', type: 'text', default: '', placeholder: 'https://api.example.com/v1' },
      { path: 'media.audio.asrModel', label: 'ASR 模型', type: 'text', default: 'whisper-1' },
      { path: 'media.audio.asrApiKeyEnv', label: 'ASR API Key 环境变量名', type: 'text', default: '', placeholder: 'OPENAI_API_KEY' },
      { path: 'media.audio.ttsEnabled', label: '语音合成 TTS', type: 'switch', default: false },
      { path: 'media.audio.ttsBaseUrl', label: 'TTS Base URL', type: 'text', default: '', placeholder: 'https://api.example.com/v1' },
      { path: 'media.audio.ttsModel', label: 'TTS 模型', type: 'text', default: 'tts-1' },
      { path: 'media.audio.ttsVoice', label: 'TTS 音色', type: 'text', default: 'alloy' },
      { path: 'media.audio.ttsApiKeyEnv', label: 'TTS API Key 环境变量名', type: 'text', default: '', placeholder: 'OPENAI_API_KEY' },
      { path: 'media.files.enabled', label: '接收/上传文件', type: 'switch', default: false },
    ],
  },
  {
    id: 'content',
    title: '内容',
    description: '公共内容源；默认关闭，不使用 Cookie 或登录态。',
    fields: [
      { path: 'content.bilibili.enabled', module: 'builtin-media-features', label: '启用 B站公共内容', type: 'switch', default: false, help: '仅搜索、热门和视频基本信息；不使用 Cookie/WBI。' },
      { path: 'content.bilibili.timeoutMs', module: 'builtin-media-features', label: 'B站请求超时', type: 'number', default: 15000, min: 1000, max: 60000, step: 1000, unit: 'ms' },
      { path: 'content.bilibili.maxResults', module: 'builtin-media-features', label: 'B站结果数量', type: 'number', default: 5, min: 1, max: 20, step: 1 },
    ],
  },
  {
    id: 'basic',
    title: '基本',
    description: '插件开关、网关类型与机器人账号。',
    fields: [
      { path: 'enabled', label: '启用并自动连接', type: 'switch', default: true, help: '插件加载后按当前配置自动连接 QQ 网关。' },
      {
        path: 'gateway', label: '网关类型', type: 'select', default: 'onebot',
        options: [
          { value: 'onebot', label: '连接已有 OneBot v11 地址（NapCat / SnowLuma / Lagrange / LLOneBot）' },
          { value: 'snowluma', label: '从 SnowLuma 安装目录自动读取地址' },
        ],
        help: '「连接已有地址」只连接你填的地址，不启动、不注入任何进程；SnowLuma 模式只读取它自己的配置。',
      },
      { path: 'botQQ', label: '机器人 QQ 号', type: 'text', default: '', placeholder: '例如 123456789', help: '连上后用 get_login_info 核验登录账号；留空则只提示、不拦截。' },
      {
        path: 'accountCheck', label: '账号不一致时', type: 'select', default: 'warn',
        options: [
          { value: 'off', label: '不检查' },
          { value: 'warn', label: '只警告（推荐）' },
          { value: 'enforce', label: '断开并暂停自动重连' },
        ],
      },
    ],
  },
  {
    id: 'endpoint',
    title: '连接地址',
    description: 'OneBot v11 的正向 WebSocket 与 HTTP 地址。HTTP 留空时所有调用走 WS。',
    fields: [
      { path: 'onebot.wsUrl', label: 'WebSocket 地址', type: 'text', default: '', placeholder: 'ws://127.0.0.1:3001', help: '用于实时接收事件；NapCat 的「正向 WebSocket」、SnowLuma 的 wsServers。' },
      { path: 'onebot.httpUrl', label: 'HTTP 地址', type: 'text', default: '', placeholder: 'http://127.0.0.1:3000', help: '用于调用发送消息等接口；留空则全部走 WS。' },
      { path: 'onebot.wsToken', label: 'WS access token', type: 'secret', default: '', placeholder: '没有就留空' },
      { path: 'onebot.httpToken', label: 'HTTP access token', type: 'secret', default: '', placeholder: '没有就留空' },
      {
        path: 'onebot.httpAuth', label: 'HTTP token 携带方式', type: 'select', default: 'bearer',
        options: [
          { value: 'bearer', label: 'Authorization: Bearer <token>（NapCat / SnowLuma 标准做法）' },
          { value: 'header-token', label: 'X-Access-Token: <token>（非标准，仅特定网关）' },
          { value: 'query', label: 'URL 参数 ?access_token=<token>' },
        ],
        help: 'OneBot v11 规范没有定义鉴权头；NapCat 与 SnowLuma 优先认 Authorization: Bearer，也支持 ?access_token=。',
      },
      { path: 'reconnect.enabled', label: '断线自动重连', type: 'switch', default: true },
      { path: 'reconnect.minDelayMs', label: '首次重连等待', type: 'number', default: 2000, min: 500, max: 60000, step: 500, unit: 'ms' },
      { path: 'reconnect.maxDelayMs', label: '最大重连等待', type: 'number', default: 30000, min: 1000, max: 300000, step: 1000, unit: 'ms' },
      { path: 'reconnect.factor', label: '退避倍数', type: 'number', default: 2, min: 1.1, max: 5, step: 0.1, help: '每次重连失败后等待时间乘以这个系数。' },
      { path: 'reconnect.jitterRatio', label: '重连抖动比例', type: 'number', default: 0.2, min: 0, max: 1, step: 0.05, help: '0.2 = 等待时间上下浮动 20%，避免同时重连。' },
    ],
  },
  {
    id: 'snowluma',
    title: 'SnowLuma 地址读取',
    description: 'SnowLuma 模式下从它自己的 config/onebot*.json 读取端口与 token。本插件不下载、不启动、不注入 SnowLuma。',
    fields: [
      { path: 'snowluma.autoDetect', label: '自动探测安装目录', type: 'switch', default: true, help: '在常见路径与 PATH 中寻找 SnowLuma。' },
      { path: 'snowluma.dir', label: 'SnowLuma 安装目录', type: 'text', default: '', placeholder: 'C:\\SnowLuma（含 index.mjs）' },
      { path: 'snowluma.uin', label: '账号 UIN', type: 'text', default: '', placeholder: '留空自动扫描', help: '对应 config/onebot_<uin>.json；多账号时指定更稳。' },
    ],
  },
  {
    id: 'timeouts',
    title: '超时与重试',
    description: '所有网络调用的超时与重试策略。',
    fields: [
      { path: 'timeouts.callMs', label: '接口调用超时', type: 'number', default: 30000, min: 1000, max: 120000, step: 1000, unit: 'ms' },
      { path: 'timeouts.connectMs', label: '连接超时', type: 'number', default: 10000, min: 1000, max: 120000, step: 1000, unit: 'ms' },
      { path: 'timeouts.verifyMs', label: '账号核验超时', type: 'number', default: 10000, min: 1000, max: 120000, step: 1000, unit: 'ms' },
      { path: 'timeouts.probeMs', label: '探测超时', type: 'number', default: 3000, min: 1000, max: 60000, step: 500, unit: 'ms' },
      { path: 'timeouts.maxRetries', label: '网络错误重试次数', type: 'number', default: 3, min: 0, max: 10, step: 1 },
      { path: 'timeouts.retryDelaysMs', label: '每次重试等待（毫秒）', type: 'number-list', default: [1000, 3000, 5000] },
      { path: 'verification.enabled', label: '连上后核验登录账号', type: 'switch', default: true },
      { path: 'verification.bufferSize', label: '核验期间暂存事件上限', type: 'number', default: 100, min: 10, max: 1000, step: 10 },
    ],
  },
  {
    id: 'events',
    title: '事件',
    description: '事件接收、过滤与缓冲。事件是后续认知/记忆插件的输入。',
    fields: [
      { path: 'events.enabled', label: '接收并缓存事件', type: 'switch', default: true },
      { path: 'events.bufferSize', label: '内存缓冲条数', type: 'number', default: 200, min: 10, max: 2000, step: 10 },
      { path: 'events.includeSelfMessages', label: '包含机器人自己发的消息', type: 'switch', default: true },
      { path: 'events.kinds.message', label: '消息事件', type: 'switch', default: true },
      { path: 'events.kinds.notice', label: '通知事件（撤回/戳一戳/群成员变化等）', type: 'switch', default: true },
      { path: 'events.kinds.request', label: '请求事件（加好友/加群）', type: 'switch', default: true },
      { path: 'events.kinds.meta_event', label: '元事件（心跳/生命周期）', type: 'switch', default: true },
      { path: 'events.messageSubTypes.private', label: '私聊消息', type: 'switch', default: true },
      { path: 'events.messageSubTypes.group', label: '群聊消息', type: 'switch', default: true },
      { path: 'events.ignoreUsers', label: '忽略这些 QQ 号', type: 'string-list', default: [], placeholder: '输入 QQ 号后回车' },
      { path: 'events.ignoreGroups', label: '忽略这些群号', type: 'string-list', default: [], placeholder: '输入群号后回车' },
      { path: 'events.rawMaxBytes', label: '原始事件截断上限', type: 'number', default: 16384, min: 1024, max: 262144, step: 1024, unit: 'bytes' },
      { path: 'events.persist.enabled', label: '事件落盘（JSONL）', type: 'switch', default: false },
      { path: 'events.persist.file', label: '事件文件名', type: 'text', default: 'events.jsonl' },
      { path: 'events.persist.maxMB', label: '事件文件上限', type: 'number', default: 32, min: 1, max: 512, step: 1, unit: 'MB' },
    ],
  },
  {
    id: 'logging',
    title: '日志',
    description: '日志级别、缓冲容量与落盘。',
    fields: [
      { path: 'logging.level', label: '日志级别', type: 'select', default: 'info', options: [
        { value: 'debug', label: 'debug（最详细）' },
        { value: 'info', label: 'info' },
        { value: 'warn', label: 'warn' },
        { value: 'error', label: 'error' },
      ] },
      { path: 'logging.bufferSize', label: '日志缓冲条数', type: 'number', default: 500, min: 50, max: 2000, step: 50 },
      { path: 'logging.persist.enabled', label: '日志落盘', type: 'switch', default: false },
    ],
  },
  {
    id: 'ui',
    title: '界面偏好',
    description: '状态轮询、列表分页与面板外观/动效偏好。外观偏好由「系统设置」页展示，保存后立即生效，不需要重连。',
    fields: [
      { path: 'ui.refreshMs', label: '状态刷新间隔', type: 'number', default: 2000, min: 500, max: 60000, step: 250, unit: 'ms' },
      { path: 'ui.eventPageSize', label: '事件列表每页条数', type: 'number', default: 50, min: 10, max: 500, step: 10 },
      { path: 'ui.logPageSize', label: '日志列表每页条数', type: 'number', default: 100, min: 10, max: 500, step: 10 },
      {
        path: 'ui.accent', label: '强调色', type: 'select', default: 'purple',
        options: [
          { value: 'purple', label: '紫（console-web 默认）' },
          { value: 'blue', label: '蓝' },
          { value: 'green', label: '绿' },
          { value: 'orange', label: '橙' },
          { value: 'inherit', label: '跟随 DSH 主题（黑白）' },
        ],
        help: '只影响本面板的品牌色/选中态/焦点环；不改变 DSH 其它界面。',
      },
      {
        path: 'ui.contrast', label: '对比度', type: 'select', default: 'system',
        options: [
          { value: 'system', label: '跟随系统' },
          { value: 'standard', label: '标准' },
          { value: 'high', label: '高对比度' },
        ],
        help: '提高本面板的边框与文字对比度；「跟随系统」读取 prefers-contrast。',
      },
      {
        path: 'ui.density', label: '界面密度', type: 'select', default: 'standard',
        options: [
          { value: 'compact', label: '紧凑' },
          { value: 'standard', label: '标准' },
          { value: 'comfortable', label: '舒适' },
        ],
        help: '调整控件高度与面板内距；紧凑密度不缩小可点击区域到 32px 以下。',
      },
      {
        path: 'ui.fontScale', label: '界面字号', type: 'select', default: 'standard',
        options: [
          { value: 'small', label: '小（93.75%）' },
          { value: 'standard', label: '标准（100%）' },
          { value: 'large', label: '大（112.5%）' },
        ],
      },
      {
        path: 'ui.contentWidth', label: '内容宽度', type: 'select', default: 'wide',
        options: [
          { value: 'standard', label: '标准（72rem）' },
          { value: 'wide', label: '宽（100rem）' },
          { value: 'auto', label: '自动铺满' },
        ],
      },
      {
        path: 'ui.motion', label: '动效模式', type: 'select', default: 'system',
        options: [
          { value: 'system', label: '跟随系统（推荐）' },
          { value: 'full', label: '始终开启' },
          { value: 'reduced', label: '减少动效' },
          { value: 'off', label: '关闭动效' },
        ],
        help: '减少/关闭会停用进场、切换、数字滚动等动画；页面内容仍然可用。',
      },
      {
        path: 'ui.pageTransition', label: '页面切换动画', type: 'select', default: 'default',
        options: [
          { value: 'default', label: '默认（轻抬升 + 淡入）' },
          { value: 'fade', label: '淡入（无位移）' },
          { value: 'fade-slide', label: '自右轻移入' },
          { value: 'fade-up', label: '自下轻移入' },
          { value: 'fade-down', label: '自上轻移入' },
          { value: 'none', label: '关闭切换动画' },
        ],
        help: '只控制标签页内容切换；关闭后其它动效（悬停、状态脉冲等）仍保留。',
      },
    ],
  },
  {
    id: 'security',
    title: '安全',
    description: '出站文本密钥防泄漏、调试与危险操作开关。',
    fields: [
      { path: 'security.leakGuard.enabled', label: '启用出站文本防泄漏', type: 'switch', default: true },
      { path: 'security.leakGuard.action', label: '检测到密钥时', type: 'select', default: 'redact', options: [{ value: 'redact', label: '脱敏后发送' }, { value: 'block', label: '阻止发送' }] },
      { path: 'security.allowRawAction', label: '允许面板透传任意 OneBot action', type: 'switch', default: false, help: '仅调试用；开启后面板可以向网关发送任意 v11 接口调用。' },
    ],
  },
  {
    id: 'access',
    title: '访问控制',
    description: '谁能触发回复与主动行为。默认 open 保持现有行为；切换 allowlist 后按主人、只读操作员与私聊/群白名单放行。',
    fields: [
      {
        path: 'access.mode', label: '模式', type: 'select', default: 'open',
        options: [
          { value: 'open', label: 'open：任何私聊/群都能触发（当前行为）' },
          { value: 'allowlist', label: 'allowlist：仅主人、操作员与白名单' },
        ],
        help: 'allowlist 下：主人、只读操作员私聊与私聊白名单可触发；群聊只有群白名单可触发；被拒绝的消息不落库、不回复。',
      },
      { path: 'access.ownerQQ', label: '主人 QQ', type: 'text', default: '', placeholder: '例如 123456789', help: 'allowlist 下用于识别主人；留空则没有主人特权，操作员与白名单仍生效。' },
      { path: 'access.ownerName', label: '主人称呼', type: 'text', default: '主人', placeholder: '主人', help: '面板/提示词/审计里显示的主人称呼。' },
      { path: 'access.operators', label: '只读操作员 QQ', type: 'string-list', default: [], placeholder: '输入 QQ 号后回车', help: '最多 500 个；仅开放 help/status/model（只读）/bili/groupinfo/memberinfo。allowlist 放行操作员私聊，群聊仍需群白名单；不授予主人权限。' },
      { path: 'access.private', label: '私聊白名单', type: 'string-list', default: [], placeholder: '输入 QQ 号后回车' },
      { path: 'access.groups', label: '群白名单', type: 'string-list', default: [], placeholder: '输入群号后回车' },
      { path: 'access.auditSize', label: '审计条数', type: 'number', default: 100, min: 0, max: 1000, step: 1, help: '内存环形缓冲；只存会话/发送者/原因/时间，不存消息正文，重启清空。' },
    ],
  },
  {
    id: 'runtime',
    title: '会话运行时',
    description: '回复由一次性 LLM 生成，还是交给 DSH Agent（每聊天一个 Session，可用工具）。默认保持 oneshot。',
    fields: [
      {
        path: 'runtime.engine', label: '引擎', type: 'select', default: 'oneshot',
        options: [
          { value: 'oneshot', label: 'oneshot：一次性 LLM（当前行为）' },
          { value: 'agent', label: 'agent：DSH Session + Agent' },
        ],
        help: 'agent 需要宿主提供 sessionController / workspaceRegistry / agents；缺失或失败时自动回退 oneshot。',
      },
      { path: 'runtime.workspaceDir', label: '工作区目录', type: 'text', default: '', placeholder: '留空使用数据目录/runtime/workspace', help: 'DSH Session 的 workspace 路径；留空自动创建。' },
      { path: 'runtime.replyTimeoutMs', label: '单轮回复超时', type: 'number', default: 120000, min: 5000, max: 600000, step: 1000, unit: 'ms', help: '等 DSH Agent 完成一轮的上限；超时只放弃等待，不强杀会话。' },
    ],
  },
  {
    id: 'cog-core',
    title: '认知内核',
    description: '总开关、测试模式与可观测性。认知关闭时 OneBot 接入与面板仍正常工作。',
    fields: [
      { path: 'cognition.enabled', label: '启用认知内核', type: 'switch', default: true, help: '关闭后不聚合、不记忆、不回复生成；平台接入不受影响。' },
      { path: 'cognition.paused', label: '暂停认知（保留状态）', type: 'switch', default: false, help: '暂停期间事件仍落原始日志，但不做决策/回复。' },
      { path: 'cognition.dryRun', label: '演练模式（不实际发送）', type: 'switch', default: false, help: '用于验证：完整跑认知与决策，但不通过 QQ 发送。' },
      { path: 'cognition.locale', label: '认知语言', type: 'select', default: 'zh-CN', options: [{ value: 'zh-CN', label: '简体中文' }] },
      { path: 'cognition.timezone', label: '时区覆盖', type: 'text', default: '', placeholder: '留空使用 DSH/主机时区' },
      { path: 'cognition.debug.trace', label: '记录逐阶段 trace', type: 'switch', default: true },
      { path: 'cognition.debug.keepPrompt', label: 'trace 保存完整 Prompt（隐私风险）', type: 'switch', default: false, help: '默认只保存摘要/hash；开启后可能包含敏感文本。' },
    ],
  },
  {
    id: 'cog-permissions',
    title: '命令权限',
    description: '操作员按命令名禁用内置或模块命令；空列表保持原有行为。',
    fields: [
      { path: 'cognition.permissions.deniedCommands', label: '禁用命令', type: 'string-list', default: [], placeholder: 'kick 或 draw 后回车，不带 /', help: '最多 100 个不带 / 的小写命令名，匹配 ^[a-z][a-z0-9_-]{0,31}$；去重，非法项忽略并报告。仅拦截命令入口，不覆盖服务/API/Agent 工具。' },
    ],
  },
  {
    id: 'cog-reminders',
    title: '主人本地提醒',
    description: '默认关闭；固定文本经统一出站发送，无任务代码或 LLM 执行；无提醒面板/API。',
    fields: [
      { path: 'cognition.reminders.enabled', module: 'builtin-reminders', label: '启用主人提醒', type: 'switch', default: false },
      { path: 'cognition.reminders.maxActive', module: 'builtin-reminders', label: '每人格活跃提醒上限', type: 'number', default: 50, min: 1, max: 1000, step: 1 },
      { path: 'cognition.reminders.minIntervalSeconds', module: 'builtin-reminders', label: '最短重复间隔', type: 'number', default: 60, min: 60, max: 2592000, step: 1, unit: 's' },
      { path: 'cognition.reminders.maxIntervalSeconds', module: 'builtin-reminders', label: '最长重复间隔', type: 'number', default: 2592000, min: 60, max: 2592000, step: 1, unit: 's' },
      { path: 'cognition.reminders.tickMs', module: 'builtin-reminders', label: '到期检查间隔', type: 'number', default: 30000, min: 1000, max: 3600000, step: 1000, unit: 'ms' },
    ],
  },
  {
    id: 'cog-llm',
    title: '模型路由与预算',
    description: 'LLM 只做语义分析与生成，不持有长期状态。auto 继承 DSH 默认模型。',
    fields: [
      { path: 'cognition.llm.mode', label: '路由模式', type: 'select', default: 'auto', help: 'auto=DSH 优先、直连兜底；direct=只用「模型」页直连；chain=直连链后 DSH；fixed=DSH 固定 provider/model。', options: [{ value: 'auto', label: '自动（DSH 优先，直连兜底）' }, { value: 'dsh', label: '仅 DSH' }, { value: 'fixed', label: 'DSH 固定 provider/model' }, { value: 'direct', label: '仅直连（模型页）' }, { value: 'chain', label: '直连 → DSH 链式' }] },
      { path: 'cognition.llm.fallbackToDsh', label: '直连失败回退 DSH', type: 'switch', default: true, help: '仅 direct/chain 有意义；DSH 也不可用时返回 degraded。' },
      { path: 'cognition.llm.provider', label: '固定 provider', type: 'text', default: '', placeholder: '例如 deepseek-official' },
      { path: 'cognition.llm.model', label: '固定 model', type: 'text', default: '', placeholder: '例如 deepseek-chat' },
      { path: 'cognition.llm.reasoningEffort', label: '推理强度（可选）', type: 'text', default: '', placeholder: '例如 low / medium / high' },
      { path: 'cognition.llm.temperature', label: '生成温度', type: 'number', default: 0.7, min: 0, max: 1.5, step: 0.05 },
      { path: 'cognition.llm.analysisMaxTokens', label: '分析输出上限', type: 'number', default: 1800, min: 128, max: 8192, step: 64, unit: 'tokens' },
      { path: 'cognition.llm.composeMaxTokens', label: '回复输出上限', type: 'number', default: 800, min: 128, max: 4096, step: 64, unit: 'tokens' },
      { path: 'cognition.llm.timeoutMs', label: '单次调用超时', type: 'number', default: 20000, min: 1000, max: 120000, step: 1000, unit: 'ms' },
      { path: 'cognition.llm.dailyTokenBudget', label: '全局每日 token 预算', type: 'number', default: 300000, min: 1000, max: 5000000, step: 1000 },
      { path: 'cognition.llm.budgetScope', label: '预算作用域', type: 'select', default: 'global', options: [{ value: 'global', label: '全局' }, { value: 'persona', label: '按人格' }, { value: 'both', label: '两者取最小' }] },
      { path: 'cognition.llm.personaDailyTokenBudget', label: '人格每日 token 预算', type: 'number', default: 300000, min: 1000, max: 5000000, step: 1000 },
      { path: 'cognition.llm.maxConcurrency', label: '并发上限', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { path: 'cognition.llm.retry', label: '解析/瞬时错误重试', type: 'number', default: 1, min: 0, max: 3, step: 1 },
      { path: 'cognition.modelRouting.privateDefault', label: '私聊默认模型', type: 'text', default: '', placeholder: 'provider/model，留空用全局路由', help: '只影响认知分析/生成，不改变 DSH 面板默认模型。' },
      { path: 'cognition.modelRouting.groupDefault', label: '群聊默认模型', type: 'text', default: '', placeholder: 'provider/model，留空用全局路由' },
      { path: 'cognition.modelRouting.routes', label: '按会话覆盖', type: 'string-list', default: [], placeholder: '10001=provider/model 后回车', help: 'QQ 号或群号=provider/model；私聊优先于群号。也可用 QQ 命令 /model 设置当前会话。' },
    ],
  },
  {
    id: 'cog-turn',
    title: '轮次与防抖',
    description: '消息不等于完整发言。等待窗口全部可配置，且始终有硬截止。',
    fields: [
      { path: 'cognition.typing.enabled', module: 'builtin-typing', label: '私聊输入状态', type: 'switch', default: false, help: '仅私聊/C2C，依赖网关支持；不发送群聊输入状态，默认关闭。' },
      { path: 'cognition.turn.privateBaseMs', label: '私聊基础等待', type: 'number', default: 1800, min: 500, max: 5000, step: 100, unit: 'ms' },
      { path: 'cognition.turn.privateMaxMs', label: '私聊硬截止', type: 'number', default: 10000, min: 3000, max: 20000, step: 500, unit: 'ms' },
      { path: 'cognition.turn.groupMaxMs', label: '群聊硬截止', type: 'number', default: 9000, min: 3000, max: 20000, step: 500, unit: 'ms' },
      { path: 'cognition.turn.fastPathMs', label: '命令快速路径', type: 'number', default: 300, min: 0, max: 2000, step: 50, unit: 'ms' },
      { path: 'cognition.turn.shortMsgMs', label: '短消息额外等待', type: 'number', default: 1200, min: 0, max: 4000, step: 100, unit: 'ms' },
      { path: 'cognition.turn.incompleteFactorMs', label: '未完成表达等待系数', type: 'number', default: 4500, min: 0, max: 8000, step: 100, unit: 'ms' },
      { path: 'cognition.turn.habitAdjMaxMs', label: '个人节奏修正上限', type: 'number', default: 1500, min: 0, max: 3000, step: 100, unit: 'ms' },
      { path: 'cognition.turn.maxAggregateMessages', label: '单轮最多聚合消息数', type: 'number', default: 20, min: 1, max: 50, step: 1 },
      { path: 'cognition.turn.groupReplyMode', label: '群聊参与方式', type: 'select', default: 'addressed', options: [
        { value: 'addressed', label: '仅 @/回复/唤醒词' },
        { value: 'probability', label: '点名必回，未点名按概率' },
        { value: 'all', label: '所有消息都分析（仍可沉默）' },
      ], help: '概率/所有消息模式仍受策略沉默与频率限制；私聊始终处理。' },
      { path: 'cognition.turn.groupReplyProbability', label: '未点名参与概率', type: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.turn.groupCooldownMs', label: '同群回复冷却', type: 'number', default: 3000, min: 0, max: 60000, step: 500, unit: 'ms' },
      { path: 'cognition.turn.groupMaxRepliesPerMinute', label: '群聊每分钟上限', type: 'number', default: 6, min: 1, max: 60, step: 1 },
      { path: 'cognition.turn.maxConsecutiveGroupReplies', label: '连续接话上限', type: 'number', default: 3, min: 1, max: 20, step: 1, help: '连续多少次未点名接话后暂停主动接话；点名/唤醒仍会回复。' },
      { path: 'cognition.turn.groupRelevance.enabled', label: '群聊词法相关度门控', type: 'switch', default: false, help: '仅未点名群消息：复用已检索记忆的词法相关度，无记忆或低于阈值时只写记忆、不分析；默认关闭，无新增外部调用。' },
      { path: 'cognition.turn.groupRelevance.minScore', label: '群聊最低词法相关度', type: 'number', default: 0.15, min: 0, max: 1, step: 0.05, help: '0–1；点名消息绕过相关度检查，仍受既有分钟上限约束。' },
      { path: 'cognition.turn.wakeWords', label: '唤醒词', type: 'string-list', default: [], placeholder: '输入昵称后回车' },
    ],
  },
  {
    id: 'cog-reply',
    title: '回复与出站',
    description: '长回复分条、引用、@ 与分条间隔；只影响认知侧自动发送，不影响面板手动发送。',
    fields: [
      { path: 'cognition.reply.split', module: 'builtin-reply-delivery', label: '长回复分条', type: 'switch', default: true, help: '超过字数上限时拆成多条，优先按段落/句末标点切。' },
      { path: 'cognition.reply.maxChars', module: 'builtin-reply-delivery', label: '单条字数上限', type: 'number', default: 300, min: 80, max: 2000, step: 10 },
      { path: 'cognition.reply.maxParts', module: 'builtin-reply-delivery', label: '最多分条', type: 'number', default: 3, min: 1, max: 10, step: 1, help: '超过上限的剩余内容并入最后一条，不截断。' },
      { path: 'cognition.reply.delayMs', module: 'builtin-reply-delivery', label: '分条间隔', type: 'number', default: 600, min: 0, max: 5000, step: 100, unit: 'ms' },
      { path: 'cognition.reply.quote', module: 'builtin-reply-delivery', label: '回复时引用原消息', type: 'switch', default: true },
      { path: 'cognition.reply.atSender', module: 'builtin-reply-delivery', label: '群聊回复时 @ 对方', type: 'switch', default: false, help: '默认关闭，避免每条回复都带 @；与引用同时开启时可能显得重叠。' },
      { path: 'cognition.notices.enabled', label: '记录 QQ 通知到时间轴', type: 'switch', default: true },
      { path: 'cognition.requests.enabled', label: '接收请求与主人确认处理', type: 'switch', default: true, help: '只存待办；/approve 或 /reject 始终需要 confirm，不自动审批。' },
      { path: 'cognition.notice.patReply', label: '被拍一拍时回应', type: 'switch', default: true, help: '别人拍机器人时回一句短话；每个用户有冷却。' },
      { path: 'cognition.notice.patCooldownMs', label: '拍一拍回应冷却', type: 'number', default: 60000, min: 0, max: 600000, step: 1000, unit: 'ms' },
    ],
  },
  {
    id: 'cog-admin',
    title: 'QQ 管理命令',
    description: '默认关闭，仅主人、当前会话；群管需要机器人具备相应权限。',
    fields: [
      { path: 'cognition.qqAdmin.enabled', label: '启用 QQ 管理命令', type: 'switch', default: false },
      { path: 'cognition.qqAdmin.requireApproval', label: 'QQ 管理动作需要主人审批', type: 'switch', default: false, help: '校验后存入 10 分钟待办（最多 50 条）；/approvals 查看，/approve apr_ID confirm 批准并执行，/reject apr_ID confirm 拒绝。' },
      { path: 'cognition.qqAdmin.requireConfirm', label: '撤回需要 confirm', type: 'switch', default: true, help: '踢人始终需要字面量 confirm；不受此开关影响。' },
      { path: 'cognition.qqAdmin.maxText', label: '资料/群名片/群名长度上限', type: 'number', default: 100, min: 1, max: 100, step: 1 },
    ],
  },
  {
    id: 'cog-purpose',
    title: '目的',
    description: '长期目标 / 计划 / 近期意图；只注入 prompt 与面板管理，不自动执行工具。',
    fields: [
      { path: 'cognition.purpose.enabled', label: '启用目的系统', type: 'switch', default: true },
      { path: 'cognition.purpose.injectPrompt', label: '注入回复上下文', type: 'switch', default: true, help: '把少量高优先级目的作为上下文；不会让机器人机械汇报目标。' },
      { path: 'cognition.purpose.promptLimit', label: '注入条数', type: 'number', default: 3, min: 0, max: 10, step: 1 },
      { path: 'cognition.purpose.maxActive', label: '活跃目的上限', type: 'number', default: 5, min: 1, max: 20, step: 1, help: '目前用于容量提示，不强制删除。' },
    ],
  },
  {
    id: 'cog-persona',
    title: '人格',
    description: '相对稳定的长期行为倾向；单次互动不应剧烈改变。人格与情绪/关系/技能分开存储。',
    fields: [
      { path: 'cognition.persona.traits.extraversion', label: '外向', type: 'number', default: 0.55, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.openness', label: '开放/好奇', type: 'number', default: 0.7, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.agreeableness', label: '宜人', type: 'number', default: 0.6, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.conscientiousness', label: '尽责', type: 'number', default: 0.55, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.emotionalSensitivity', label: '情绪敏感', type: 'number', default: 0.55, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.humor', label: '幽默倾向', type: 'number', default: 0.6, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.socialInitiative', label: '社交主动', type: 'number', default: 0.55, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.caution', label: '谨慎', type: 'number', default: 0.6, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.expressiveness', label: '表达欲', type: 'number', default: 0.55, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.conflictApproach', label: '冲突倾向', type: 'number', default: 0.45, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.riskTolerance', label: '风险偏好', type: 'number', default: 0.4, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.traits.consistency', label: '行为一致性', type: 'number', default: 0.7, min: 0.1, max: 0.9, step: 0.05 },
      { path: 'cognition.persona.style.formality', label: '正式度', type: 'number', default: 0.45, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.persona.style.verbosity', label: '话痨度', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.persona.style.emojiRate', label: 'emoji 倾向', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.persona.style.teasingBound', label: '调侃边界', type: 'number', default: 0.45, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.persona.style.warmth', label: '温暖度', type: 'number', default: 0.6, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.persona.values', label: '价值边界', type: 'string-list', default: ['诚实', '尊重边界', '不假装感知', '承认不确定', '关心具体的人'] },
      { path: 'cognition.persona.evolutionEnabled', label: '允许长期缓慢演化', type: 'switch', default: true },
      { path: 'cognition.persona.evolutionPerDay', label: '演化速率/日', type: 'number', default: 0.005, min: 0, max: 0.02, step: 0.001 },
    ],
  },
  {
    id: 'cog-emotion',
    title: '情绪',
    description: '模拟情绪状态：评价 → PAD/离散情绪；具有惯性、衰减和调节。不是主观体验声明。',
    fields: [
      { path: 'cognition.emotion.sensitivity', label: '情绪敏感度', type: 'number', default: 0.55, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.emotion.regulation', label: '表达调节', type: 'number', default: 0.4, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.emotion.valenceHalfLifeMin', label: '效价半衰期', type: 'number', default: 120, min: 5, max: 1440, step: 5, unit: 'min' },
      { path: 'cognition.emotion.arousalHalfLifeMin', label: '唤醒半衰期', type: 'number', default: 30, min: 1, max: 720, step: 1, unit: 'min' },
      { path: 'cognition.emotion.stressHalfLifeMin', label: '压力半衰期', type: 'number', default: 360, min: 10, max: 2880, step: 10, unit: 'min' },
      { path: 'cognition.emotion.moodHalfLifeMin', label: '心境半衰期', type: 'number', default: 480, min: 30, max: 4320, step: 30, unit: 'min' },
      { path: 'cognition.emotion.effectsEnabled', label: '情绪影响决策/表达', type: 'switch', default: true },
    ],
  },
  {
    id: 'cog-relationship',
    title: '关系',
    description: '多维、有向、情境化关系；不是单一好感度。',
    fields: [
      { path: 'cognition.relationship.learningRate', label: '关系学习率', type: 'number', default: 0.15, min: 0.01, max: 0.5, step: 0.01 },
      { path: 'cognition.relationship.trustRate', label: '信任变化率', type: 'number', default: 0.07, min: 0.01, max: 0.3, step: 0.01 },
      { path: 'cognition.relationship.intimacyRate', label: '亲密变化率', type: 'number', default: 0.05, min: 0.01, max: 0.2, step: 0.01 },
      { path: 'cognition.relationship.conflictRise', label: '冲突上升率', type: 'number', default: 0.2, min: 0.01, max: 0.5, step: 0.01 },
      { path: 'cognition.relationship.conflictDecay', label: '冲突自然衰减', type: 'number', default: 0.03, min: 0, max: 0.2, step: 0.005 },
      { path: 'cognition.relationship.inertia', label: '关系惯性', type: 'number', default: 0.85, min: 0.1, max: 0.99, step: 0.01 },
      { path: 'cognition.relationship.repairThreshold', label: '修复所需证据阈值', type: 'number', default: 0.65, min: 0.3, max: 0.95, step: 0.05 },
    ],
  },
  {
    id: 'cog-memory',
    title: '记忆',
    description: '工作/情景/语义/程序/情绪/人物记忆；检索、巩固、遗忘与隐私隔离。',
    fields: [
      { path: 'cognition.memory.retrievalTopK', label: '检索条数', type: 'number', default: 8, min: 1, max: 30, step: 1 },
      { path: 'cognition.memory.maxContextChars', label: '注入上下文上限', type: 'number', default: 4000, min: 500, max: 20000, step: 500, unit: '字符' },
      { path: 'cognition.memory.recencyWeight', label: '新近性权重', type: 'number', default: 0.3, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.importanceWeight', label: '重要性权重', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.relevanceWeight', label: '相关性权重', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.emotionWeight', label: '情绪一致性权重', type: 'number', default: 0.1, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.relationshipWeight', label: '关系权重', type: 'number', default: 0.05, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.associationWeight', label: '关联激活权重', type: 'number', default: 0.05, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.memory.recencyHalfLifeDays', label: '新近性半衰期', type: 'number', default: 30, min: 1, max: 365, step: 1, unit: '天' },
      { path: 'cognition.memory.forgetHalfLifeDays', label: '遗忘半衰期', type: 'number', default: 60, min: 5, max: 730, step: 5, unit: '天' },
      { path: 'cognition.memory.consolidateEvery', label: '每 N 条记忆尝试巩固', type: 'number', default: 25, min: 5, max: 200, step: 5 },
      { path: 'cognition.memory.semanticIndex', label: '语义索引', type: 'select', default: 'lexical', options: [{ value: 'lexical', label: '词法 + 关联图（默认）' }, { value: 'embedding', label: '兼容旧值（启用请用 Embedding 重排）' }] },
      { path: 'cognition.memory.embedding.enabled', label: 'Embedding 重排', type: 'switch', default: false, help: '开启后将查询和候选记忆发送到配置的 provider；失败回退词法检索。' },
      { path: 'cognition.memory.embedding.baseUrl', label: 'Embedding Base URL', type: 'text', default: '' },
      { path: 'cognition.memory.embedding.model', label: 'Embedding 模型', type: 'text', default: 'text-embedding-3-small' },
      { path: 'cognition.memory.embedding.apiKeyEnv', label: 'Embedding 密钥环境变量名', type: 'text', default: '' },
      { path: 'cognition.memory.embedding.weight', label: 'Embedding 权重', type: 'number', default: 0.35, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.consolidation.enabled', label: '每日整理', type: 'switch', default: true, help: '每日定时把情景记忆巩固为语义记忆，并按作用域生成阶段小结。' },
      { path: 'cognition.consolidation.hour', label: '整理时间', type: 'number', default: 4, min: 0, max: 23, step: 1, unit: '点', help: '本地时间；服务重启后会重新计算下一次。' },
      { path: 'cognition.consolidation.reflect', label: 'LLM 阶段反思', type: 'switch', default: true, help: '只压缩已有记忆，不新增事实；预算不足时自动跳过。' },
      { path: 'cognition.consolidation.reflectMinEpisodes', label: '反思最低条数', type: 'number', default: 10, min: 3, max: 100, step: 1 },
    ],
  },
  {
    id: 'cog-import',
    title: '导入旧档案',
    description: '将通用 JSON/JSONL 记忆导入当前人格；本地处理，重复内容跳过。',
    fields: [
      { path: 'cognition.import.enabled', label: '导入旧档案', type: 'switch', default: true },
      { path: 'cognition.import.maxBytes', label: '导入大小上限', type: 'number', default: 5242880, min: 1, max: 5242880, step: 1, unit: '字节' },
      { path: 'cognition.import.maxItems', label: '导入条数上限', type: 'number', default: 5000, min: 1, max: 5000, step: 1, unit: '条' },
    ],
  },
  {
    id: 'cog-policy',
    title: '行为策略',
    description: '候选行为、效用、风险、沉默/等待与反馈学习。',
    fields: [
      { path: 'cognition.policy.replyThreshold', label: '回复概率阈值', type: 'number', default: 0.52, min: 0, max: 1, step: 0.01 },
      { path: 'cognition.policy.waitThreshold', label: '等待概率阈值', type: 'number', default: 0.38, min: 0, max: 1, step: 0.01 },
      { path: 'cognition.policy.silenceThreshold', label: '沉默概率阈值', type: 'number', default: 0.3, min: 0, max: 1, step: 0.01 },
      { path: 'cognition.policy.addressedBoost', label: '点名/私聊加成', type: 'number', default: 0.15, min: 0, max: 0.5, step: 0.01 },
      { path: 'cognition.policy.groupPenalty', label: '群聊额外门槛', type: 'number', default: 0.1, min: 0, max: 0.5, step: 0.01 },
      { path: 'cognition.policy.epsilon', label: '低风险探索率', type: 'number', default: 0.04, min: 0, max: 0.2, step: 0.01 },
      { path: 'cognition.policy.dailyGlobalLimit', label: '全局每日回复上限', type: 'number', default: 120, min: 1, max: 2000, step: 1 },
      { path: 'cognition.policy.perChatPrivate', label: '私聊每小时上限', type: 'number', default: 30, min: 1, max: 200, step: 1 },
      { path: 'cognition.policy.perChatGroup', label: '群聊每小时上限', type: 'number', default: 10, min: 0, max: 100, step: 1 },
      { path: 'cognition.policy.maxConsecutiveBotMessages', label: '连续 Bot 发言上限', type: 'number', default: 2, min: 1, max: 5, step: 1 },
      { path: 'cognition.policy.proactive', label: '允许主动发起', type: 'switch', default: false },
      { path: 'cognition.policy.analyzeWithLlm', label: '使用 LLM 做语义分析', type: 'switch', default: true },
    ],
  },
  {
    id: 'cog-learning',
    title: '学习与知识',
    description: '未知检测、知识源、证据与预算。默认只检测未知，自动外部检索需显式开启。',
    fields: [
      { path: 'cognition.learning.enabled', module: 'builtin-learning', label: '启用学习系统', type: 'switch', default: true },
      { path: 'cognition.learning.autoResearch', module: 'builtin-learning', label: '自动外部检索', type: 'switch', default: false, help: '开启后会向配置的知识源发起网络请求；默认关闭以保护隐私/配额。' },
      { path: 'cognition.learning.detectUnknowns', module: 'builtin-learning', label: '检测未知/知识缺口', type: 'switch', default: true },
      { path: 'cognition.learning.maxTasksPerHour', module: 'builtin-learning', label: '每小时任务上限', type: 'number', default: 3, min: 0, max: 30, step: 1 },
      { path: 'cognition.learning.maxQueries', module: 'builtin-learning', label: '每任务查询数', type: 'number', default: 2, min: 1, max: 5, step: 1 },
      { path: 'cognition.learning.maxSources', module: 'builtin-learning', label: '每任务来源数', type: 'number', default: 5, min: 1, max: 10, step: 1 },
      { path: 'cognition.learning.dailyTokenBudget', module: 'builtin-learning', label: '学习每日 token 预算', type: 'number', default: 20000, min: 1000, max: 500000, step: 1000 },
      { path: 'cognition.learning.taskTtlHours', module: 'builtin-learning', label: '任务有效期', type: 'number', default: 24, min: 1, max: 720, step: 1, unit: '小时' },
      { path: 'cognition.learning.retry', module: 'builtin-learning', label: '失败重试次数', type: 'number', default: 1, min: 0, max: 5, step: 1 },
      { path: 'cognition.learning.minConfidence', module: 'builtin-learning', label: 'claim 最低置信度', type: 'number', default: 0.45, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.learning.sources.web', module: 'builtin-learning', label: '使用 DSH web 服务', type: 'switch', default: true },
      { path: 'cognition.learning.sources.wikipedia', module: 'builtin-learning', label: 'Wikipedia/MediaWiki', type: 'switch', default: true },
      { path: 'cognition.learning.sources.openalex', module: 'builtin-learning', label: 'OpenAlex 学术', type: 'switch', default: true },
      { path: 'cognition.learning.sources.github', module: 'builtin-learning', label: 'GitHub 公共 API', type: 'switch', default: true },
      { path: 'cognition.learning.sources.rss', module: 'builtin-learning', label: 'RSS/Atom', type: 'switch', default: false },
      { path: 'cognition.learning.sources.local', module: 'builtin-learning', label: '本地文档', type: 'switch', default: false },
    ],
  },
  {
    id: 'cog-proactivity',
    title: '主动与节奏',
    description: '主动行为默认关闭；开启后受安静时段、日预算、关系与退避限制。',
    fields: [
      { path: 'cognition.proactivity.enabled', module: 'builtin-proactivity', label: '启用主动行为', type: 'switch', default: false },
      { path: 'cognition.proactivity.quietStart', module: 'builtin-proactivity', label: '安静开始（小时）', type: 'number', default: 23, min: 0, max: 23, step: 1 },
      { path: 'cognition.proactivity.quietEnd', module: 'builtin-proactivity', label: '安静结束（小时）', type: 'number', default: 8, min: 0, max: 23, step: 1 },
      { path: 'cognition.proactivity.maxPrivatePerDay', module: 'builtin-proactivity', label: '私聊每日上限', type: 'number', default: 1, min: 0, max: 10, step: 1 },
      { path: 'cognition.proactivity.maxGroupPerDay', module: 'builtin-proactivity', label: '群聊每日上限', type: 'number', default: 0, min: 0, max: 10, step: 1 },
      { path: 'cognition.proactivity.minFamiliarity', module: 'builtin-proactivity', label: '最低熟悉度', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
      { path: 'cognition.proactivity.backoffHours', module: 'builtin-proactivity', label: '无回应退避', type: 'number', default: 24, min: 1, max: 720, step: 1, unit: '小时' },
    ],
  },
  {
    id: 'cog-privacy',
    title: '隐私与数据治理',
    description: '私聊/群聊隔离、保留期、学习范围、导出与删除。',
    fields: [
      { path: 'cognition.privacy.privateIsolation', label: '私聊内容与群聊隔离', type: 'switch', default: true, help: '开启后群聊检索不会读取私聊记忆。' },
      { path: 'cognition.privacy.learnFromPrivate', label: '允许从私聊提取学习任务', type: 'switch', default: false },
      { path: 'cognition.privacy.rawRetentionDays', label: '原始事件保留', type: 'number', default: 180, min: 0, max: 3650, step: 1, unit: '天' },
      { path: 'cognition.privacy.traceRetentionDays', label: 'trace 保留', type: 'number', default: 30, min: 0, max: 3650, step: 1, unit: '天' },
      { path: 'cognition.privacy.decisionRetentionDays', label: '决策保留', type: 'number', default: 90, min: 0, max: 3650, step: 1, unit: '天' },
      { path: 'cognition.privacy.metricsRetentionDays', label: '指标保留', type: 'number', default: 365, min: 1, max: 3650, step: 1, unit: '天' },
      { path: 'cognition.privacy.exportSecret', label: '导出包含 secret 字段', type: 'switch', default: false },
    ],
  },
]

// ---------------------------------------------------------------------------
// 路径与深合并
// ---------------------------------------------------------------------------

export function getPath(obj, path) {
  return String(path).split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj)
}

export function setPath(obj, path, value) {
  const keys = String(path).split('.')
  let cur = obj
  for (let i = 0; i < keys.length - 1; i += 1) {
    if (cur[keys[i]] == null || typeof cur[keys[i]] !== 'object') cur[keys[i]] = {}
    cur = cur[keys[i]]
  }
  cur[keys[keys.length - 1]] = value
  return obj
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** 深合并：patch 覆盖 base；两边都是对象时递归；数组整体替换。 */
export function deepMerge(base, patch) {
  if (Array.isArray(base)) return Array.isArray(patch) ? [...patch] : clone(base)
  if (!isPlainObject(base)) return patch === undefined ? base : clone(patch)
  const out = {}
  for (const [key, value] of Object.entries(base)) out[key] = clone(value)
  if (isPlainObject(patch)) {
    for (const [key, value] of Object.entries(patch)) {
      out[key] = key in out && (isPlainObject(out[key]) || Array.isArray(out[key])) ? deepMerge(out[key], value) : clone(value)
    }
  }
  return out
}

export function clone(value) {
  if (value === undefined) return undefined
  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return value
  }
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

function pickBool(value, def) {
  return typeof value === 'boolean' ? value : def
}

function pickNumber(value, def, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return def
  const clamped = Math.min(max, Math.max(min, n))
  return integer ? Math.round(clamped) : Number(clamped.toFixed(6))
}

function pickEnum(value, def, allowed) {
  return allowed.includes(value) ? value : def
}

function pickString(value, def, { max = 4096 } = {}) {
  if (typeof value !== 'string') return def
  const s = value.trim()
  return s.length > max ? s.slice(0, max) : s
}

function pickStringArray(value, def, { maxItems = 500 } = {}) {
  if (!Array.isArray(value)) return clone(def)
  const out = []
  for (const item of value) {
    const s = String(item ?? '').trim()
    if (!s) continue
    if (!out.includes(s)) out.push(s.slice(0, 64))
    if (out.length >= maxItems) break
  }
  return out
}

function pickNumberArray(value, def, { min = 0, max = 600000, maxItems = 20 } = {}) {
  if (!Array.isArray(value)) return clone(def)
  const out = value
    .map((item) => Number(item))
    .filter((n) => Number.isFinite(n))
    .slice(0, maxItems)
    .map((n) => Math.min(max, Math.max(min, Math.round(n))))
  return out.length ? out : clone(def)
}

function normalizeDeniedCommands(value, issues) {
  const path = 'cognition.permissions.deniedCommands'
  if (!Array.isArray(value)) {
    issues.push(`${path} 必须为数组，已使用空列表`)
    return []
  }
  const out = []
  let invalid = false, overflow = false
  for (const item of value) {
    if (typeof item !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(item)) {
      invalid = true
      continue
    }
    if (out.includes(item)) continue
    if (out.length >= 100) { overflow = true; continue }
    out.push(item)
  }
  if (invalid) issues.push(`${path} 含非法项，已忽略；命令名必须匹配 ^[a-z][a-z0-9_-]{0,31}$`)
  if (overflow) issues.push(`${path} 最多保留 100 个不同命令名，超出项已忽略`)
  return out
}

/**
 * 规范化配置：与 DEFAULTS 深合并 + 逐字段校验；返回 { config, issues }。
 * 非法值回退默认值，issues 里记录可读说明（面板/日志可见）。
 */
export function normalizeConfig(raw) {
  const issues = []
  const src = isPlainObject(raw) ? raw : {}
  const merged = deepMerge(DEFAULTS, src)

  if (isPlainObject(raw) && raw.version !== undefined && raw.version !== CONFIG_VERSION) {
    issues.push(`配置版本 ${raw.version} 与当前版本 ${CONFIG_VERSION} 不一致，已按当前版本补齐默认值`)
  }
  if (isPlainObject(raw) === false && raw != null) {
    issues.push('配置文件不是 JSON 对象，已使用默认值')
  }

  const cfg = {
    version: CONFIG_VERSION,
    enabled: pickBool(merged.enabled, DEFAULTS.enabled),
    gateway: pickEnum(merged.gateway, DEFAULTS.gateway, ['onebot', 'snowluma']),
    botQQ: pickString(merged.botQQ, DEFAULTS.botQQ, { max: 32 }).replace(/\s+/g, ''),
    accountCheck: pickEnum(merged.accountCheck, DEFAULTS.accountCheck, ['off', 'warn', 'enforce']),
    onebot: {
      wsUrl: normalizeUrl(merged.onebot?.wsUrl, DEFAULTS.onebot.wsUrl, ['ws:', 'wss:'], (msg) => issues.push(msg)),
      httpUrl: normalizeUrl(merged.onebot?.httpUrl, DEFAULTS.onebot.httpUrl, ['http:', 'https:'], (msg) => issues.push(msg)),
      wsToken: pickString(merged.onebot?.wsToken, '', { max: 1024 }),
      httpToken: pickString(merged.onebot?.httpToken, '', { max: 1024 }),
      httpAuth: pickEnum(merged.onebot?.httpAuth, DEFAULTS.onebot.httpAuth, ['bearer', 'header-token', 'query']),
    },
    snowluma: {
      autoDetect: pickBool(merged.snowluma?.autoDetect, DEFAULTS.snowluma.autoDetect),
      dir: pickString(merged.snowluma?.dir, '', { max: 1024 }),
      uin: pickString(merged.snowluma?.uin, '', { max: 32 }).replace(/\D/g, ''),
    },
    reconnect: {
      enabled: pickBool(merged.reconnect?.enabled, DEFAULTS.reconnect.enabled),
      minDelayMs: pickNumber(merged.reconnect?.minDelayMs, DEFAULTS.reconnect.minDelayMs, { min: 500, max: 60000 }),
      maxDelayMs: pickNumber(merged.reconnect?.maxDelayMs, DEFAULTS.reconnect.maxDelayMs, { min: 1000, max: 300000 }),
      factor: pickNumber(merged.reconnect?.factor, DEFAULTS.reconnect.factor, { min: 1.1, max: 5 }),
      jitterRatio: pickNumber(merged.reconnect?.jitterRatio, DEFAULTS.reconnect.jitterRatio, { min: 0, max: 1 }),
    },
    timeouts: {
      callMs: pickNumber(merged.timeouts?.callMs, DEFAULTS.timeouts.callMs, { min: 1000, max: 120000 }),
      connectMs: pickNumber(merged.timeouts?.connectMs, DEFAULTS.timeouts.connectMs, { min: 1000, max: 120000 }),
      verifyMs: pickNumber(merged.timeouts?.verifyMs, DEFAULTS.timeouts.verifyMs, { min: 1000, max: 120000 }),
      probeMs: pickNumber(merged.timeouts?.probeMs, DEFAULTS.timeouts.probeMs, { min: 1000, max: 60000 }),
      maxRetries: pickNumber(merged.timeouts?.maxRetries, DEFAULTS.timeouts.maxRetries, { min: 0, max: 10, integer: true }),
      retryDelaysMs: pickNumberArray(merged.timeouts?.retryDelaysMs, DEFAULTS.timeouts.retryDelaysMs, { min: 0, max: 600000 }),
    },
    verification: {
      enabled: pickBool(merged.verification?.enabled, DEFAULTS.verification.enabled),
      bufferSize: pickNumber(merged.verification?.bufferSize, DEFAULTS.verification.bufferSize, { min: 10, max: 1000, integer: true }),
    },
    events: {
      enabled: pickBool(merged.events?.enabled, DEFAULTS.events.enabled),
      bufferSize: pickNumber(merged.events?.bufferSize, DEFAULTS.events.bufferSize, { min: 10, max: 2000, integer: true }),
      includeSelfMessages: pickBool(merged.events?.includeSelfMessages, DEFAULTS.events.includeSelfMessages),
      kinds: {
        message: pickBool(merged.events?.kinds?.message, DEFAULTS.events.kinds.message),
        notice: pickBool(merged.events?.kinds?.notice, DEFAULTS.events.kinds.notice),
        request: pickBool(merged.events?.kinds?.request, DEFAULTS.events.kinds.request),
        meta_event: pickBool(merged.events?.kinds?.meta_event, DEFAULTS.events.kinds.meta_event),
      },
      messageSubTypes: {
        private: pickBool(merged.events?.messageSubTypes?.private, DEFAULTS.events.messageSubTypes.private),
        group: pickBool(merged.events?.messageSubTypes?.group, DEFAULTS.events.messageSubTypes.group),
      },
      ignoreUsers: pickStringArray(merged.events?.ignoreUsers, DEFAULTS.events.ignoreUsers),
      ignoreGroups: pickStringArray(merged.events?.ignoreGroups, DEFAULTS.events.ignoreGroups),
      rawMaxBytes: pickNumber(merged.events?.rawMaxBytes, DEFAULTS.events.rawMaxBytes, { min: 1024, max: 262144, integer: true }),
      persist: {
        enabled: pickBool(merged.events?.persist?.enabled, DEFAULTS.events.persist.enabled),
        file: normalizeFileName(merged.events?.persist?.file, DEFAULTS.events.persist.file),
        maxMB: pickNumber(merged.events?.persist?.maxMB, DEFAULTS.events.persist.maxMB, { min: 1, max: 512, integer: true }),
      },
    },
    logging: {
      level: pickEnum(merged.logging?.level, DEFAULTS.logging.level, ['debug', 'info', 'warn', 'error']),
      bufferSize: pickNumber(merged.logging?.bufferSize, DEFAULTS.logging.bufferSize, { min: 50, max: 2000, integer: true }),
      persist: { enabled: pickBool(merged.logging?.persist?.enabled, DEFAULTS.logging.persist.enabled) },
      redact: pickBool(merged.logging?.redact, DEFAULTS.logging.redact),
    },
    ui: {
      refreshMs: pickNumber(merged.ui?.refreshMs, DEFAULTS.ui.refreshMs, { min: 500, max: 60000 }),
      eventPageSize: pickNumber(merged.ui?.eventPageSize, DEFAULTS.ui.eventPageSize, { min: 10, max: 500, integer: true }),
      logPageSize: pickNumber(merged.ui?.logPageSize, DEFAULTS.ui.logPageSize, { min: 10, max: 500, integer: true }),
      // 外观/动效偏好：枚举非法时回退默认值，与 console-web 的 preference 校验语义一致。
      accent: pickEnum(merged.ui?.accent, DEFAULTS.ui.accent, ['purple', 'blue', 'green', 'orange', 'inherit']),
      density: pickEnum(merged.ui?.density, DEFAULTS.ui.density, ['compact', 'standard', 'comfortable']),
      fontScale: pickEnum(merged.ui?.fontScale, DEFAULTS.ui.fontScale, ['small', 'standard', 'large']),
      contentWidth: pickEnum(merged.ui?.contentWidth, DEFAULTS.ui.contentWidth, ['standard', 'wide', 'auto']),
      motion: pickEnum(merged.ui?.motion, DEFAULTS.ui.motion, ['system', 'full', 'reduced', 'off']),
      pageTransition: pickEnum(merged.ui?.pageTransition, DEFAULTS.ui.pageTransition, ['default', 'fade', 'fade-slide', 'fade-up', 'fade-down', 'none']),
      contrast: pickEnum(merged.ui?.contrast, DEFAULTS.ui.contrast, ['system', 'standard', 'high']),
    },
    cognition: normalizeCognition(merged.cognition, isPlainObject(raw.cognition) ? raw.cognition : {}, issues),
    security: {
      allowRawAction: pickBool(merged.security?.allowRawAction, DEFAULTS.security.allowRawAction),
      leakGuard: {
        enabled: pickBool(merged.security?.leakGuard?.enabled, DEFAULTS.security.leakGuard.enabled),
        action: pickEnum(merged.security?.leakGuard?.action, DEFAULTS.security.leakGuard.action, ['redact', 'block']),
      },
    },
    ops: {
      upgrade: {
        enabled: pickBool(merged.ops?.upgrade?.enabled, DEFAULTS.ops.upgrade.enabled),
        channel: pickEnum(merged.ops?.upgrade?.channel, DEFAULTS.ops.upgrade.channel, ['stable', 'beta']),
        repo: typeof merged.ops?.upgrade?.repo === 'string' && !merged.ops.upgrade.repo.includes('..') && /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(merged.ops.upgrade.repo) ? merged.ops.upgrade.repo : DEFAULTS.ops.upgrade.repo,
        timeoutMs: pickNumber(merged.ops?.upgrade?.timeoutMs, DEFAULTS.ops.upgrade.timeoutMs, { min: 1000, max: 120000, integer: true }),
        cacheMinutes: pickNumber(merged.ops?.upgrade?.cacheMinutes, DEFAULTS.ops.upgrade.cacheMinutes, { min: 0, max: 10080, integer: true }),
      },
      backup: {
        enabled: pickBool(merged.ops?.backup?.enabled, DEFAULTS.ops.backup.enabled),
        includeMedia: pickBool(merged.ops?.backup?.includeMedia, DEFAULTS.ops.backup.includeMedia),
        maxSnapshots: pickNumber(merged.ops?.backup?.maxSnapshots, DEFAULTS.ops.backup.maxSnapshots, { min: 1, max: 1000, integer: true }),
        maxBytes: pickNumber(merged.ops?.backup?.maxBytes, DEFAULTS.ops.backup.maxBytes, { min: 1, max: 10737418240, integer: true }),
        maxFiles: pickNumber(merged.ops?.backup?.maxFiles, DEFAULTS.ops.backup.maxFiles, { min: 1, max: 100000, integer: true }),
        prune: pickBool(merged.ops?.backup?.prune, DEFAULTS.ops.backup.prune),
        allowRestore: pickBool(merged.ops?.backup?.allowRestore, DEFAULTS.ops.backup.allowRestore),
      },
    },
    media: {
      enabled: pickBool(merged.media?.enabled, DEFAULTS.media.enabled),
      maxBytes: pickNumber(merged.media?.maxBytes, DEFAULTS.media.maxBytes, { min: 1024, max: 104857600, integer: true }),
      dir: pickString(merged.media?.dir, DEFAULTS.media.dir, { max: 1024 }),
      stickers: {
        enabled: pickBool(merged.media?.stickers?.enabled, DEFAULTS.media.stickers.enabled),
        maxCount: pickNumber(merged.media?.stickers?.maxCount, DEFAULTS.media.stickers.maxCount, { min: 1, max: 5000, integer: true }),
        maxBytes: pickNumber(merged.media?.stickers?.maxBytes, DEFAULTS.media.stickers.maxBytes, { min: 1024, max: 52428800, integer: true }),
      },
      tts: { maxChars: pickNumber(merged.media?.tts?.maxChars, DEFAULTS.media.tts.maxChars, { min: 1, max: 5000, integer: true }) },
      images: {
        enabled: pickBool(merged.media?.images?.enabled, DEFAULTS.media.images.enabled),
        visionEnabled: pickBool(merged.media?.images?.visionEnabled, DEFAULTS.media.images.visionEnabled),
        visionBaseUrl: normalizeUrl(merged.media?.images?.visionBaseUrl, DEFAULTS.media.images.visionBaseUrl, ['http:', 'https:'], (msg) => issues.push(`Vision: ${msg}`)),
        visionModel: pickString(merged.media?.images?.visionModel, DEFAULTS.media.images.visionModel, { max: 200 }),
        visionApiKeyEnv: pickString(merged.media?.images?.visionApiKeyEnv, DEFAULTS.media.images.visionApiKeyEnv, { max: 128 }).replace(/[^A-Za-z0-9_]/g, ''),
        generateEnabled: pickBool(merged.media?.images?.generateEnabled, DEFAULTS.media.images.generateEnabled),
        generateBaseUrl: normalizeUrl(merged.media?.images?.generateBaseUrl, DEFAULTS.media.images.generateBaseUrl, ['http:', 'https:'], (msg) => issues.push(`生图: ${msg}`)),
        generateModel: pickString(merged.media?.images?.generateModel, DEFAULTS.media.images.generateModel, { max: 200 }),
        generateApiKeyEnv: pickString(merged.media?.images?.generateApiKeyEnv, DEFAULTS.media.images.generateApiKeyEnv, { max: 128 }).replace(/[^A-Za-z0-9_]/g, ''),
        generateSize: pickEnum(merged.media?.images?.generateSize, DEFAULTS.media.images.generateSize, ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']),
        editEnabled: pickBool(merged.media?.images?.editEnabled, DEFAULTS.media.images.editEnabled),
        editBaseUrl: normalizeUrl(merged.media?.images?.editBaseUrl, DEFAULTS.media.images.editBaseUrl, ['http:', 'https:'], (msg) => issues.push(`改图: ${msg}`)),
        editModel: pickString(merged.media?.images?.editModel, DEFAULTS.media.images.editModel, { max: 200 }),
        editApiKeyEnv: pickString(merged.media?.images?.editApiKeyEnv, DEFAULTS.media.images.editApiKeyEnv, { max: 128 }).replace(/[^A-Za-z0-9_]/g, ''),
        editSize: pickEnum(merged.media?.images?.editSize, DEFAULTS.media.images.editSize, ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792']),
      },
      audio: {
        asrEnabled: pickBool(merged.media?.audio?.asrEnabled, DEFAULTS.media.audio.asrEnabled),
        asrBaseUrl: normalizeUrl(merged.media?.audio?.asrBaseUrl, DEFAULTS.media.audio.asrBaseUrl, ['http:', 'https:'], (msg) => issues.push(`ASR: ${msg}`)),
        asrModel: pickString(merged.media?.audio?.asrModel, DEFAULTS.media.audio.asrModel, { max: 200 }),
        asrApiKeyEnv: pickString(merged.media?.audio?.asrApiKeyEnv, DEFAULTS.media.audio.asrApiKeyEnv, { max: 128 }).replace(/[^A-Za-z0-9_]/g, ''),
        ttsEnabled: pickBool(merged.media?.audio?.ttsEnabled, DEFAULTS.media.audio.ttsEnabled),
        ttsBaseUrl: normalizeUrl(merged.media?.audio?.ttsBaseUrl, DEFAULTS.media.audio.ttsBaseUrl, ['http:', 'https:'], (msg) => issues.push(`TTS: ${msg}`)),
        ttsModel: pickString(merged.media?.audio?.ttsModel, DEFAULTS.media.audio.ttsModel, { max: 200 }),
        ttsVoice: pickString(merged.media?.audio?.ttsVoice, DEFAULTS.media.audio.ttsVoice, { max: 100 }),
        ttsApiKeyEnv: pickString(merged.media?.audio?.ttsApiKeyEnv, DEFAULTS.media.audio.ttsApiKeyEnv, { max: 128 }).replace(/[^A-Za-z0-9_]/g, ''),
      },
      files: { enabled: pickBool(merged.media?.files?.enabled, DEFAULTS.media.files.enabled) },
    },
    content: {
      bilibili: {
        enabled: pickBool(merged.content?.bilibili?.enabled, DEFAULTS.content.bilibili.enabled),
        timeoutMs: pickNumber(merged.content?.bilibili?.timeoutMs, DEFAULTS.content.bilibili.timeoutMs, { min: 1000, max: 60000, integer: true }),
        maxResults: pickNumber(merged.content?.bilibili?.maxResults, DEFAULTS.content.bilibili.maxResults, { min: 1, max: 20, integer: true }),
      },
    },
    access: normalizeAccess(merged.access, issues),
    runtime: {
      engine: pickEnum(merged.runtime?.engine, DEFAULTS.runtime.engine, ['oneshot', 'agent']),
      workspaceDir: pickString(merged.runtime?.workspaceDir, DEFAULTS.runtime.workspaceDir, { max: 1024 }),
      replyTimeoutMs: pickNumber(merged.runtime?.replyTimeoutMs, DEFAULTS.runtime.replyTimeoutMs, { min: 5000, max: 600000 }),
    },
  }

  if (cfg.reconnect.minDelayMs > cfg.reconnect.maxDelayMs) {
    cfg.reconnect.minDelayMs = cfg.reconnect.maxDelayMs
    issues.push('reconnect.minDelayMs 大于 maxDelayMs，已按 maxDelayMs 收敛')
  }
  if (cfg.gateway === 'onebot' && !cfg.onebot.wsUrl && !cfg.onebot.httpUrl) {
    issues.push('尚未填写 OneBot WebSocket / HTTP 地址，插件不会自动建立连接')
  }
  return { config: cfg, issues }
}

function normalizeCognition(raw, rawCognition = {}, issues = []) {
  const src = isPlainObject(raw) ? raw : {}
  const d = DEFAULTS.cognition
  const budgetScope = rawCognition.llm?.budgetScope
  if (budgetScope !== undefined && !['global', 'persona', 'both'].includes(budgetScope)) {
    issues.push('cognition.llm.budgetScope 必须为 global、persona 或 both，已回退默认值')
  }
  const personaBudget = rawCognition.llm?.personaDailyTokenBudget
  const validPersonaBudget = personaBudget === undefined || ((typeof personaBudget === 'number' || typeof personaBudget === 'string')
    && String(personaBudget).trim() !== '' && Number.isFinite(Number(personaBudget)) && Number(personaBudget) >= 1000 && Number(personaBudget) <= 5000000)
  if (!validPersonaBudget) issues.push('cognition.llm.personaDailyTokenBudget 必须为 1000–5000000，已回退默认值')
  const traits = {}
  for (const [key, def] of Object.entries(d.persona.traits)) {
    traits[key] = pickNumber(src.persona?.traits?.[key], def, { min: 0.1, max: 0.9 })
  }
  const style = {}
  for (const [key, def] of Object.entries(d.persona.style)) {
    style[key] = pickNumber(src.persona?.style?.[key], def, { min: 0, max: 1 })
  }
  const profile = {
    displayName: pickString(src.persona?.profile?.displayName, d.persona.profile.displayName, { max: 40 }),
    tagline: pickString(src.persona?.profile?.tagline, d.persona.profile.tagline, { max: 120 }),
    identity: pickString(src.persona?.profile?.identity, d.persona.profile.identity, { max: 300 }),
    background: pickString(src.persona?.profile?.background, d.persona.profile.background, { max: 1500 }),
    personality: pickString(src.persona?.profile?.personality, d.persona.profile.personality, { max: 1000 }),
    speakingStyle: pickString(src.persona?.profile?.speakingStyle, d.persona.profile.speakingStyle, { max: 800 }),
    likes: pickStringArray(src.persona?.profile?.likes, d.persona.profile.likes, { maxItems: 20 }),
    dislikes: pickStringArray(src.persona?.profile?.dislikes, d.persona.profile.dislikes, { maxItems: 20 }),
    boundaries: pickStringArray(src.persona?.profile?.boundaries, d.persona.profile.boundaries, { maxItems: 20 }),
    examples: pickString(src.persona?.profile?.examples, d.persona.profile.examples, { max: 1500 }),
  }
  const legacyGroupMode = (rawCognition.turn?.addressedOnlyGroups === false || rawCognition.policy?.groupAmbient === true) ? 'all' : d.turn.groupReplyMode
  const explicitGroupMode = rawCognition.turn && Object.prototype.hasOwnProperty.call(rawCognition.turn, 'groupReplyMode')
    ? rawCognition.turn.groupReplyMode
    : undefined
  const groupReplyMode = pickEnum(explicitGroupMode, legacyGroupMode, ['addressed', 'probability', 'all'])
  return {
    enabled: pickBool(src.enabled, d.enabled),
    paused: pickBool(src.paused, d.paused),
    dryRun: pickBool(src.dryRun, d.dryRun),
    locale: pickEnum(src.locale, d.locale, ['zh-CN']),
    timezone: pickString(src.timezone, '', { max: 64 }),
    typing: { enabled: pickBool(src.typing?.enabled, d.typing.enabled) },
    delivery: { engine: pickEnum(src.delivery?.engine, d.delivery.engine, ['auto', 'core', 'planner']) },
    notices: { enabled: pickBool(src.notices?.enabled, d.notices.enabled) },
    requests: { enabled: pickBool(src.requests?.enabled, d.requests.enabled) },
    permissions: {
      // deepMerge replaces non-array patches with defaults; inspect the raw field to report invalid types.
      deniedCommands: normalizeDeniedCommands(Object.hasOwn(rawCognition.permissions || {}, 'deniedCommands')
        ? rawCognition.permissions.deniedCommands : d.permissions.deniedCommands, issues),
    },
    reminders: {
      enabled: pickBool(src.reminders?.enabled, d.reminders.enabled),
      maxActive: pickNumber(src.reminders?.maxActive, d.reminders.maxActive, { min: 1, max: 1000, integer: true }),
      minIntervalSeconds: pickNumber(src.reminders?.minIntervalSeconds, d.reminders.minIntervalSeconds, { min: 60, max: 2592000, integer: true }),
      maxIntervalSeconds: pickNumber(src.reminders?.maxIntervalSeconds, d.reminders.maxIntervalSeconds, { min: pickNumber(src.reminders?.minIntervalSeconds, d.reminders.minIntervalSeconds, { min: 60, max: 2592000, integer: true }), max: 2592000, integer: true }),
      tickMs: pickNumber(src.reminders?.tickMs, d.reminders.tickMs, { min: 1000, max: 3600000, integer: true }),
    },
    qqAdmin: {
      enabled: pickBool(src.qqAdmin?.enabled, d.qqAdmin.enabled),
      requireApproval: pickBool(src.qqAdmin?.requireApproval, d.qqAdmin.requireApproval),
      requireConfirm: pickBool(src.qqAdmin?.requireConfirm, d.qqAdmin.requireConfirm),
      maxText: pickNumber(src.qqAdmin?.maxText, d.qqAdmin.maxText, { min: 1, max: 100, integer: true }),
    },
    turn: {
      privateBaseMs: pickNumber(src.turn?.privateBaseMs, d.turn.privateBaseMs, { min: 500, max: 5000, integer: true }),
      privateMaxMs: pickNumber(src.turn?.privateMaxMs, d.turn.privateMaxMs, { min: 3000, max: 20000, integer: true }),
      groupMaxMs: pickNumber(src.turn?.groupMaxMs, d.turn.groupMaxMs, { min: 3000, max: 20000, integer: true }),
      fastPathMs: pickNumber(src.turn?.fastPathMs, d.turn.fastPathMs, { min: 0, max: 2000, integer: true }),
      shortMsgMs: pickNumber(src.turn?.shortMsgMs, d.turn.shortMsgMs, { min: 0, max: 4000, integer: true }),
      incompleteFactorMs: pickNumber(src.turn?.incompleteFactorMs, d.turn.incompleteFactorMs, { min: 0, max: 8000, integer: true }),
      habitAdjMaxMs: pickNumber(src.turn?.habitAdjMaxMs, d.turn.habitAdjMaxMs, { min: 0, max: 3000, integer: true }),
      maxAggregateMessages: pickNumber(src.turn?.maxAggregateMessages, d.turn.maxAggregateMessages, { min: 1, max: 50, integer: true }),
      groupReplyMode,
      groupReplyProbability: pickNumber(src.turn?.groupReplyProbability, d.turn.groupReplyProbability, { min: 0, max: 1 }),
      groupRelevance: {
        enabled: pickBool(src.turn?.groupRelevance?.enabled, d.turn.groupRelevance.enabled),
        // Inspect raw input: JSON cloning during deepMerge turns NaN/Infinity into null.
        minScore: pickNumber(rawCognition.turn?.groupRelevance?.minScore ?? d.turn.groupRelevance.minScore, d.turn.groupRelevance.minScore, { min: 0, max: 1 }),
      },
      groupCooldownMs: pickNumber(src.turn?.groupCooldownMs, d.turn.groupCooldownMs, { min: 0, max: 60000, integer: true }),
      groupMaxRepliesPerMinute: pickNumber(src.turn?.groupMaxRepliesPerMinute, d.turn.groupMaxRepliesPerMinute, { min: 1, max: 60, integer: true }),
      maxConsecutiveGroupReplies: pickNumber(src.turn?.maxConsecutiveGroupReplies, d.turn.maxConsecutiveGroupReplies, { min: 1, max: 20, integer: true }),
      addressedOnlyGroups: pickBool(src.turn?.addressedOnlyGroups, d.turn.addressedOnlyGroups),
      wakeWords: pickStringArray(src.turn?.wakeWords, d.turn.wakeWords, { maxItems: 20 }),
    },
    reply: {
      split: pickBool(src.reply?.split, d.reply.split),
      maxChars: pickNumber(src.reply?.maxChars, d.reply.maxChars, { min: 80, max: 2000, integer: true }),
      maxParts: pickNumber(src.reply?.maxParts, d.reply.maxParts, { min: 1, max: 10, integer: true }),
      delayMs: pickNumber(src.reply?.delayMs, d.reply.delayMs, { min: 0, max: 5000, integer: true }),
      quote: pickBool(src.reply?.quote, d.reply.quote),
      atSender: pickBool(src.reply?.atSender, d.reply.atSender),
    },
    notice: {
      patReply: pickBool(src.notice?.patReply, d.notice.patReply),
      patCooldownMs: pickNumber(src.notice?.patCooldownMs, d.notice.patCooldownMs, { min: 0, max: 600000, integer: true }),
    },
    purpose: {
      enabled: pickBool(src.purpose?.enabled, d.purpose.enabled),
      maxActive: pickNumber(src.purpose?.maxActive, d.purpose.maxActive, { min: 1, max: 20, integer: true }),
      injectPrompt: pickBool(src.purpose?.injectPrompt, d.purpose.injectPrompt),
      promptLimit: pickNumber(src.purpose?.promptLimit, d.purpose.promptLimit, { min: 0, max: 10, integer: true }),
    },
    import: {
      enabled: pickBool(src.import?.enabled, d.import.enabled),
      maxBytes: pickNumber(src.import?.maxBytes, d.import.maxBytes, { min: 1, max: 5242880, integer: true }),
      maxItems: pickNumber(src.import?.maxItems, d.import.maxItems, { min: 1, max: 5000, integer: true }),
    },
    consolidation: {
      enabled: pickBool(src.consolidation?.enabled, d.consolidation.enabled),
      hour: pickNumber(src.consolidation?.hour, d.consolidation.hour, { min: 0, max: 23, integer: true }),
      reflect: pickBool(src.consolidation?.reflect, d.consolidation.reflect),
      reflectMinEpisodes: pickNumber(src.consolidation?.reflectMinEpisodes, d.consolidation.reflectMinEpisodes, { min: 3, max: 100, integer: true }),
    },
    llm: {
      mode: pickEnum(src.llm?.mode, d.llm.mode, ['auto', 'dsh', 'fixed', 'direct', 'chain']),
      fallbackToDsh: pickBool(src.llm?.fallbackToDsh, d.llm.fallbackToDsh),
      provider: pickString(src.llm?.provider, '', { max: 128 }),
      model: pickString(src.llm?.model, '', { max: 128 }),
      reasoningEffort: pickString(src.llm?.reasoningEffort, '', { max: 32 }),
      temperature: pickNumber(src.llm?.temperature, d.llm.temperature, { min: 0, max: 1.5 }),
      analysisMaxTokens: pickNumber(src.llm?.analysisMaxTokens, d.llm.analysisMaxTokens, { min: 128, max: 8192, integer: true }),
      composeMaxTokens: pickNumber(src.llm?.composeMaxTokens, d.llm.composeMaxTokens, { min: 128, max: 4096, integer: true }),
      timeoutMs: pickNumber(src.llm?.timeoutMs, d.llm.timeoutMs, { min: 1000, max: 120000, integer: true }),
      dailyTokenBudget: pickNumber(src.llm?.dailyTokenBudget, d.llm.dailyTokenBudget, { min: 1000, max: 5000000, integer: true }),
      budgetScope: pickEnum(src.llm?.budgetScope, d.llm.budgetScope, ['global', 'persona', 'both']),
      personaDailyTokenBudget: pickNumber(validPersonaBudget ? src.llm?.personaDailyTokenBudget : undefined, d.llm.personaDailyTokenBudget, { min: 1000, max: 5000000, integer: true }),
      maxConcurrency: pickNumber(src.llm?.maxConcurrency, d.llm.maxConcurrency, { min: 1, max: 8, integer: true }),
      retry: pickNumber(src.llm?.retry, d.llm.retry, { min: 0, max: 3, integer: true }),
      cache: pickBool(src.llm?.cache, d.llm.cache),
    },
    modelRouting: {
      privateDefault: pickString(src.modelRouting?.privateDefault, '', { max: 200 }),
      groupDefault: pickString(src.modelRouting?.groupDefault, '', { max: 200 }),
      routes: pickStringArray(src.modelRouting?.routes, [], { maxItems: 200 }),
    },
    persona: {
      traits,
      style,
      profile,
      values: pickStringArray(src.persona?.values, d.persona.values, { maxItems: 20 }),
      evolutionPerDay: pickNumber(src.persona?.evolutionPerDay, d.persona.evolutionPerDay, { min: 0, max: 0.02 }),
      evolutionEnabled: pickBool(src.persona?.evolutionEnabled, d.persona.evolutionEnabled),
      min: pickNumber(src.persona?.min, d.persona.min, { min: 0, max: 0.5 }),
      max: pickNumber(src.persona?.max, d.persona.max, { min: 0.5, max: 1 }),
    },
    emotion: {
      sensitivity: pickNumber(src.emotion?.sensitivity, d.emotion.sensitivity, { min: 0, max: 1 }),
      regulation: pickNumber(src.emotion?.regulation, d.emotion.regulation, { min: 0, max: 1 }),
      valenceHalfLifeMin: pickNumber(src.emotion?.valenceHalfLifeMin, d.emotion.valenceHalfLifeMin, { min: 5, max: 1440, integer: true }),
      arousalHalfLifeMin: pickNumber(src.emotion?.arousalHalfLifeMin, d.emotion.arousalHalfLifeMin, { min: 1, max: 720, integer: true }),
      stressHalfLifeMin: pickNumber(src.emotion?.stressHalfLifeMin, d.emotion.stressHalfLifeMin, { min: 10, max: 2880, integer: true }),
      moodHalfLifeMin: pickNumber(src.emotion?.moodHalfLifeMin, d.emotion.moodHalfLifeMin, { min: 30, max: 4320, integer: true }),
      effectsEnabled: pickBool(src.emotion?.effectsEnabled, d.emotion.effectsEnabled),
    },
    relationship: {
      learningRate: pickNumber(src.relationship?.learningRate, d.relationship.learningRate, { min: 0.01, max: 0.5 }),
      trustRate: pickNumber(src.relationship?.trustRate, d.relationship.trustRate, { min: 0.01, max: 0.3 }),
      intimacyRate: pickNumber(src.relationship?.intimacyRate, d.relationship.intimacyRate, { min: 0.01, max: 0.2 }),
      conflictRise: pickNumber(src.relationship?.conflictRise, d.relationship.conflictRise, { min: 0.01, max: 0.5 }),
      conflictDecay: pickNumber(src.relationship?.conflictDecay, d.relationship.conflictDecay, { min: 0, max: 0.2 }),
      inertia: pickNumber(src.relationship?.inertia, d.relationship.inertia, { min: 0.1, max: 0.99 }),
      repairThreshold: pickNumber(src.relationship?.repairThreshold, d.relationship.repairThreshold, { min: 0.3, max: 0.95 }),
    },
    memory: {
      retrievalTopK: pickNumber(src.memory?.retrievalTopK, d.memory.retrievalTopK, { min: 1, max: 30, integer: true }),
      maxContextChars: pickNumber(src.memory?.maxContextChars, d.memory.maxContextChars, { min: 500, max: 20000, integer: true }),
      recencyWeight: pickNumber(src.memory?.recencyWeight, d.memory.recencyWeight, { min: 0, max: 1 }),
      importanceWeight: pickNumber(src.memory?.importanceWeight, d.memory.importanceWeight, { min: 0, max: 1 }),
      relevanceWeight: pickNumber(src.memory?.relevanceWeight, d.memory.relevanceWeight, { min: 0, max: 1 }),
      emotionWeight: pickNumber(src.memory?.emotionWeight, d.memory.emotionWeight, { min: 0, max: 1 }),
      relationshipWeight: pickNumber(src.memory?.relationshipWeight, d.memory.relationshipWeight, { min: 0, max: 1 }),
      associationWeight: pickNumber(src.memory?.associationWeight, d.memory.associationWeight, { min: 0, max: 1 }),
      recencyHalfLifeDays: pickNumber(src.memory?.recencyHalfLifeDays, d.memory.recencyHalfLifeDays, { min: 1, max: 365, integer: true }),
      forgetHalfLifeDays: pickNumber(src.memory?.forgetHalfLifeDays, d.memory.forgetHalfLifeDays, { min: 5, max: 730, integer: true }),
      consolidateEvery: pickNumber(src.memory?.consolidateEvery, d.memory.consolidateEvery, { min: 5, max: 200, integer: true }),
      semanticIndex: pickEnum(src.memory?.semanticIndex, d.memory.semanticIndex, ['lexical', 'embedding']),
      embedding: {
        enabled: pickBool(src.memory?.embedding?.enabled, d.memory.embedding.enabled),
        baseUrl: normalizeUrl(src.memory?.embedding?.baseUrl, d.memory.embedding.baseUrl, ['http:', 'https:']),
        model: pickString(src.memory?.embedding?.model, d.memory.embedding.model, { max: 200 }),
        apiKeyEnv: pickString(src.memory?.embedding?.apiKeyEnv, d.memory.embedding.apiKeyEnv, { max: 128 }),
        weight: pickNumber(src.memory?.embedding?.weight, d.memory.embedding.weight, { min: 0, max: 1 }),
      },
    },
    policy: {
      replyThreshold: pickNumber(src.policy?.replyThreshold, d.policy.replyThreshold, { min: 0, max: 1 }),
      waitThreshold: pickNumber(src.policy?.waitThreshold, d.policy.waitThreshold, { min: 0, max: 1 }),
      silenceThreshold: pickNumber(src.policy?.silenceThreshold, d.policy.silenceThreshold, { min: 0, max: 1 }),
      addressedBoost: pickNumber(src.policy?.addressedBoost, d.policy.addressedBoost, { min: 0, max: 0.5 }),
      groupPenalty: pickNumber(src.policy?.groupPenalty, d.policy.groupPenalty, { min: 0, max: 0.5 }),
      epsilon: pickNumber(src.policy?.epsilon, d.policy.epsilon, { min: 0, max: 0.2 }),
      dailyGlobalLimit: pickNumber(src.policy?.dailyGlobalLimit, d.policy.dailyGlobalLimit, { min: 1, max: 2000, integer: true }),
      perChatPrivate: pickNumber(src.policy?.perChatPrivate, d.policy.perChatPrivate, { min: 1, max: 200, integer: true }),
      perChatGroup: pickNumber(src.policy?.perChatGroup, d.policy.perChatGroup, { min: 0, max: 100, integer: true }),
      maxConsecutiveBotMessages: pickNumber(src.policy?.maxConsecutiveBotMessages, d.policy.maxConsecutiveBotMessages, { min: 1, max: 5, integer: true }),
      proactive: pickBool(src.policy?.proactive, d.policy.proactive),
      groupAmbient: pickBool(src.policy?.groupAmbient, d.policy.groupAmbient),
      analyzeWithLlm: pickBool(src.policy?.analyzeWithLlm, d.policy.analyzeWithLlm),
    },
    learning: {
      enabled: pickBool(src.learning?.enabled, d.learning.enabled),
      autoResearch: pickBool(src.learning?.autoResearch, d.learning.autoResearch),
      detectUnknowns: pickBool(src.learning?.detectUnknowns, d.learning.detectUnknowns),
      maxTasksPerHour: pickNumber(src.learning?.maxTasksPerHour, d.learning.maxTasksPerHour, { min: 0, max: 30, integer: true }),
      maxQueries: pickNumber(src.learning?.maxQueries, d.learning.maxQueries, { min: 1, max: 5, integer: true }),
      maxSources: pickNumber(src.learning?.maxSources, d.learning.maxSources, { min: 1, max: 10, integer: true }),
      dailyTokenBudget: pickNumber(src.learning?.dailyTokenBudget, d.learning.dailyTokenBudget, { min: 1000, max: 500000, integer: true }),
      taskTtlHours: pickNumber(src.learning?.taskTtlHours, d.learning.taskTtlHours, { min: 1, max: 720, integer: true }),
      retry: pickNumber(src.learning?.retry, d.learning.retry, { min: 0, max: 5, integer: true }),
      minConfidence: pickNumber(src.learning?.minConfidence, d.learning.minConfidence, { min: 0, max: 1 }),
      sources: {
        web: pickBool(src.learning?.sources?.web, d.learning.sources.web),
        wikipedia: pickBool(src.learning?.sources?.wikipedia, d.learning.sources.wikipedia),
        openalex: pickBool(src.learning?.sources?.openalex, d.learning.sources.openalex),
        github: pickBool(src.learning?.sources?.github, d.learning.sources.github),
        rss: pickBool(src.learning?.sources?.rss, d.learning.sources.rss),
        local: pickBool(src.learning?.sources?.local, d.learning.sources.local),
      },
    },
    proactivity: {
      enabled: pickBool(src.proactivity?.enabled, d.proactivity.enabled),
      quietStart: pickNumber(src.proactivity?.quietStart, d.proactivity.quietStart, { min: 0, max: 23, integer: true }),
      quietEnd: pickNumber(src.proactivity?.quietEnd, d.proactivity.quietEnd, { min: 0, max: 23, integer: true }),
      maxPrivatePerDay: pickNumber(src.proactivity?.maxPrivatePerDay, d.proactivity.maxPrivatePerDay, { min: 0, max: 10, integer: true }),
      maxGroupPerDay: pickNumber(src.proactivity?.maxGroupPerDay, d.proactivity.maxGroupPerDay, { min: 0, max: 10, integer: true }),
      minFamiliarity: pickNumber(src.proactivity?.minFamiliarity, d.proactivity.minFamiliarity, { min: 0, max: 1 }),
      backoffHours: pickNumber(src.proactivity?.backoffHours, d.proactivity.backoffHours, { min: 1, max: 720, integer: true }),
    },
    privacy: {
      privateIsolation: pickBool(src.privacy?.privateIsolation, d.privacy.privateIsolation),
      learnFromPrivate: pickBool(src.privacy?.learnFromPrivate, d.privacy.learnFromPrivate),
      rawRetentionDays: pickNumber(src.privacy?.rawRetentionDays, d.privacy.rawRetentionDays, { min: 0, max: 3650, integer: true }),
      traceRetentionDays: pickNumber(src.privacy?.traceRetentionDays, d.privacy.traceRetentionDays, { min: 0, max: 3650, integer: true }),
      decisionRetentionDays: pickNumber(src.privacy?.decisionRetentionDays, d.privacy.decisionRetentionDays, { min: 0, max: 3650, integer: true }),
      metricsRetentionDays: pickNumber(src.privacy?.metricsRetentionDays, d.privacy.metricsRetentionDays, { min: 1, max: 3650, integer: true }),
      exportSecret: pickBool(src.privacy?.exportSecret, d.privacy.exportSecret),
    },
    debug: {
      trace: pickBool(src.debug?.trace, d.debug.trace),
      keepPrompt: pickBool(src.debug?.keepPrompt, d.debug.keepPrompt),
    },
  }
}

function normalizeUrl(value, def, allowedProtocols, report) {
  const raw = pickString(value, def, { max: 2048 })
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (!allowedProtocols.includes(url.protocol)) {
      report?.(`地址协议 ${url.protocol} 不受支持（需要 ${allowedProtocols.join(' / ')}）：${raw}`)
      return ''
    }
    return raw
  } catch (error) {
    report?.(`地址格式不正确：${raw}`)
    return ''
  }
}

function normalizeFileName(value, def) {
  const name = pickString(value, def, { max: 128 })
  const safe = name.replace(/[\\/:*?"<>|]/g, '_').replace(/^\.+/, '')
  return safe || def
}

// ---------------------------------------------------------------------------
// 读写
// ---------------------------------------------------------------------------

export function configFile() {
  return dataDir(CONFIG_FILE)
}

/** 读取配置；文件不存在时用默认值并写出一份（让用户知道文件在哪）。 */
export function loadConfig({ rowConfig } = {}) {
  const file = configFile()
  let raw = readJson(file, null)
  if (raw == null) {
    raw = isPlainObject(rowConfig) ? deepMerge(DEFAULTS, rowConfig) : clone(DEFAULTS)
    const { config } = normalizeConfig(raw)
    try {
      writeJson(file, config)
    } catch (error) {}
    refreshSecrets(config)
    return config
  }
  const { config, issues } = normalizeConfig(raw)
  const normalized = { config, issues }
  refreshSecrets(config)
  return normalized.config
}

/** 保存配置（先规范化再原子写），返回 { config, issues }。 */
export function saveConfig(next) {
  const { config, issues } = normalizeConfig(next)
  writeJson(configFile(), config)
  refreshSecrets(config)
  return { config, issues }
}

/** 恢复默认值并写盘。 */
export function resetConfig() {
  return saveConfig(clone(DEFAULTS))
}

/** 面板/接口展示用：不含任何运行时状态。 */
export function publicConfig(config) {
  const walk = (value, key = '') => {
    if (['wsToken', 'httpToken'].includes(key)) return value ? '***' : ''
    if (Array.isArray(value)) return value.map(item => walk(item))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [name, walk(child, name)]))
    if (typeof value !== 'string') return value
    if (/url$/i.test(key) && value) {
      try {
        const url = new URL(value)
        let changed = false
        if (url.username || url.password) { url.username = ''; url.password = ''; changed = true }
        for (const name of [...url.searchParams.keys()]) {
          if (/token|key|secret|password|auth/i.test(name)) { url.searchParams.set(name, '***'); changed = true }
        }
        return redact(changed ? url.href : value)
      } catch { return '' }
    }
    return redact(value)
  }
  return walk(config)
}

/** 把当前配置里的 token 登记进脱敏器。 */
export function refreshSecrets(config) {
  clearSecrets()
  try {
    registerSecret(config?.onebot?.wsToken)
    registerSecret(config?.onebot?.httpToken)
  } catch (error) {}
}

export function defaultConfig() {
  return clone(DEFAULTS)
}

export function configExists() {
  return existsSync(configFile())
}
