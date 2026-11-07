# dsh-bot · 架构与实现契约

> 本文件描述当前模块边界与接口契约。接口变更需同步更新本文、测试及用户文档。

WebUI Phase 1–2、Phase 3A/3B、Phase 4 已实现 [ADR-014](architecture/ADR-014-module-webui.md)：`src/modules/webui.js` 校验内置 ui / 外部 manifest webui.version:1，内核只读 UI 目录暴露 generation、uiRevision 与元数据，`GET /onebot-qq/api/modules/ui` 不扫描目录、导入代码或读取配置值。信任分为核心、受信内置、外部声明式、未来外部沙箱；禁止外部同源 React。五个内部 module.* hook 每模块各一个、总数最多五个，order -100～100；外部仅接受 status/schema renderer，内置额外允许 builtin-react 与四个冻结编译期 componentKey，无 UI capability 授予。

核心 ModulesPage 并行读取模块列表和 UI 目录，按来源/信任/generation/uiRevision/status 与 config/surface 契约核对。卡片或详情按钮进入独立核心详情，返回恢复列表；标题、来源/信任、启用/运行状态与错误始终由核心显示。module.card/detail 的 status surface 仅渲染说明与状态纯文本；可用 module-file 的 module.config/schema surface 在详情复用通用配置编辑器（sample 及声明有效 config schema 的外部模块），停用或未 loaded 时只读。actions/panel 与不可用组合为禁用占位，未知/无效/过期描述安全回退为核心状态信息。reply-delivery/typing/reminders 的 legacy-core（available:true、schemaVersion:1）在 module.config/schema surface 按全局字段表的有界 module 字符串归属渲染 FieldRow，使用全局 draft/getByPath、saveUiPatch 与 prefStatus；停用/未 loaded 时只读，不调用 `/modules/config`。系统设置过滤 module 字段并移除空分组：cog-reply 保留 notices/requests/notice，cog-turn 保留其余字段，cog-reminders 不再显示。存储键 cognition.reply.*、cognition.typing.enabled、cognition.reminders.*、默认值、规范化与运行行为不变，无数据迁移或新增后端配置端点。现有 DSH sidebar.panellist/main 两个注册保持，四个内置 module.detail 使用冻结 BUILTIN_MODULE_UI 的纯 React 只读预览，仅接收有界模块元数据、各自配置草稿字段与只读摘要；先经 uiFor 校验，未知 key 安全回退，外部 builtin-react 拒绝。module.config/schema 与保存链路保持。无模块级 DSH 注册、配置存储迁移、动态代码导入、sandbox 执行、iframe、外部沙箱或新增依赖。

## 媒体功能提取（one-shot 模块 1，当前边界）

默认启用 `builtin-media-features` 成为第五个内置模块，独占 `mediaFeatures` provider、Bilibili 业务解释和 `/bili`、贴纸资格策略和 `/sticker`；模块在 setup 注册并自行启动，停用无 core 功能回退。host provider 订阅仅对 `reminders` 做所有权协调，媒体启停不重启提醒。原 Bilibili 服务移至 `src/modules/builtin/media-features/`；核心通过 `src/modules/media-features-port.js` 固定四个 Bilibili transport 操作、origin/headers/timeout/2 MiB 流式响应上限并拒绝重定向。模块不能传任意 URL/headers/Cookie。

贴纸 storage/index/files 与媒体 transport/provider/credentials/文件检查继续由核心持有。核心在命令受众、deniedCommands/access 检查后发放单次、绑定聊天/生命周期的 commandToken；模块仅 pick ID，再提交 send，文件解析和一次 delivery/outbound 发送均在 core，不外传路径或字节。HTTP 全部 Bilibili/贴纸入口咨询当前 provider，缺失或策略关闭即拒绝；`/media/status` 仍可用。详情显示纯预览、原六字段设置和 Bilibili 操作面板；核心媒体页保留经 provider 授权的贴纸管理。配置和贴纸数据不迁移，无新 DSH slot。完整切换、端口与在途操作限制见 [ADR-015](architecture/ADR-015-builtin-media-features.md)。以下 Phase 记录描述各历史阶段。

## 主动行为提取（one-shot 模块 2，当前边界）

第六个内置模块 `builtin-proactivity` 默认启用，但原业务 enabled 默认关闭。引擎位于 `src/modules/builtin/proactivity/engine.js`，独占策略、提示词、排序、退避、计数与单 timer（5 分钟首次/完成后 10 分钟）；核心不再构造/启动主动服务，删除 `src/cognition/proactivity.js`。固定 proactivity provider 只允许此 ID；停用无回退，认知统计/手动运行和原 HTTP 路由通过 facade，缺失返回安全空统计/MODULE_DISABLED。提醒所有权订阅保持隔离。

核心 `src/modules/proactivity-port.js` 向固定模块 runtime 提供 snapshot/begin/candidates/context/complete/send/release；run token 捕获人格和切换代次，候选仅有效私聊/扁平维度/最多 1000，最多四条 160 字符记忆和三项风格。核心保留 cognition 状态、人格仓库、LLM 路由/预算（固定 proactive、220 tokens、0.8）和 delivery/outbound access/rate/leak/dryRun；每 token 一次发送，decision/proactive_intent 原地保存。memory/LLM 等待前后和发送前校验，迟到结果不发送；已接纳发送使用捕获的内部 decisionPolicy 写回原人格回执。七个旧字段归属模块详情 legacy-core，纯 preview，无 panel/新 DSH slot。/quiet、/active 保持配置行为但不能启用停用模块。详见 [ADR-016](architecture/ADR-016-builtin-proactivity.md)。

## 1. 目标

为 DSH 构造一个 QQ 接入插件：通过 **OneBot v11** 协议连接 **NapCat / SnowLuma / Lagrange /
LLOneBot** 等 QQ 网关地址，提供：

- 连接管理（WS 收事件 + HTTP 调接口、自动重连、账号核验）；
- 事件规范化与缓冲（消息/通知/请求/元事件）；
- 消息与查询动作（发私聊/群聊、好友/群列表、登录信息等）；
- **完整的网页 UI 面板**（DSH Web 客户端插件）与**持久化配置**；
- 不写死任何算法参数：所有可调参数进入 `config.json`，带默认值，可在面板修改/重置。

本插件同时提供「QQ 感知与执行接入层」与内置认知内核（v0.4+）：接入层保持无状态边界，长期人格/人物/关系/记忆/
策略/学习状态由 `src/cognition/**` 管理，UI 通过认知服务查询/命令。

## 2. 代码位置

```
dsh-bot/
├── package.json          # bundle + dsh.client 清单
├── cordis.patch.yml      # 插入 onebot-qq 行
├── client.js             # 浏览器半边：侧栏入口 + 整页面板
├── icon.svg / locale/*   # 展示元数据
├── src/
│   ├── host.js           # 插件入口 apply(ctx, rowConfig)
│   ├── core/store.js     # 数据目录 / 原子 JSON 读写（移植自 aurabot MIT）
│   ├── core/redact.js    # 密文脱敏（移植自 aurabot MIT）
│   ├── core/logger.js    # 分级日志 + 环形缓冲（移植自 aurabot MIT）
│   ├── core/config.js    # DEFAULTS / 读取 / 校验 / 保存
│   ├── core/events.js    # 规范化事件环形缓冲 + 统计
│   ├── ingress/coordinator.js # 原始事件入站顺序与异常隔离
│   ├── onebot/client.js  # OneBot v11 客户端：HTTP+WS、重连、echo（移植自 aurabot MIT）
│   ├── gateway/
│   │   ├── normalize.js  # 原始事件 → 规范化事件
│   │   ├── manager.js    # 连接生命周期 / 账号核验 / 热应用配置
│   │   ├── actions.js    # OneBot action 包装
│   │   └── snowluma.js   # SnowLuma 安装检测 + 读 its OneBot 配置
│   └── http/routes.js    # /onebot-qq/api/* REST 路由
├── test/
│   ├── helpers/mock-onebot.js  # 假 OneBot v11 网关（移植自 aurabot MIT）
│   ├── helpers/fake-dsh.js     # 最小假 DSH ctx
│   ├── e2e.test.js             # 宿主插件端到端
│   └── *.test.js               # 单元测试（各模块 owner）
├── scripts/verify-plugin.ps1   # 安装到临时 profile + 无头启动 + 探活
└── docs/…                      # 用户指南、开发契约、研究与历史归档
```

## 3. 关键契约

Phase 14 完成模块边界验收，生产目录保持 reply delivery、typing、reminders 与 sample 四个内置模块。外部模块不能通过稳定 API 获得 provider/服务所有权、交付规划、turn 生命周期、status 写入、scheduler、persona store、提醒仓库、旧配置、受保护命令覆盖及内部 delivery/access 端口；伪造 source/builtin 无效。媒体传输、存储、provider/HTTP 与文件约束明确保留核心，不在本程序提取 builtin-media，无数据迁移。权限不构成同进程 Node.js 沙箱。最终拒绝阶段、单所有者交接和离线包验收证据见 [MODULE-ACCEPTANCE](architecture/MODULE-ACCEPTANCE.md)，媒体原因与未来宿主窄端口见 [ADR-013](architecture/ADR-013-media-boundary.md)。本阶段无生产行为、配置/UI/依赖或版本变化，部署/发布另行授权。

内部交付 seam（Phase 1 + Phase 4 + Phase 5）：`src/delivery/registry.js` 是宿主在 cognition/modules 之前创建的共享 registry，模块在宿主 ready 前完成启动。默认启用的 `builtin-reply-delivery` 通过仅内置可用的 `delivery:plan` API 注册唯一 format 规划器，布局纯函数位于 `src/delivery/reply-plan.js`，模块入口仅注册它；`src/delivery/plan.js` 保留兼容导出、校验和单条纯文本回退，`src/delivery/executor.js` 顺序执行。outbound 继续持有访问/限频/leak guard，pipeline 保留统计、pending、归因与轮次记录。内部 engine 默认 auto：有 planner 用模块，无 planner 用 core 兼容布局；core 始终绕过注册表，显式 planner 缺失或规划抛错/无效时单条纯文本回退。core 与模块复用纯布局函数和执行器，pipeline 不再构建消息段或计算分条/等待；所有 `cognition.reply.*` 保留。无配置迁移或模块配置 UI，详见 [ADR-001](architecture/ADR-001-delivery-seam.md) 与 [ADR-003](architecture/ADR-003-reply-delivery-module.md)。Phase 2 的入站编排保持不变，详见 [ADR-002](architecture/ADR-002-ingress-coordinator.md)。

### 3.1 配置（src/core/config.js）

- 配置文件：`$DSH_HOME/plugins-data/dsh-bot/config.json`（可用 `DSH_BOT_DATA_DIR` 覆盖，测试用）。
- `DEFAULTS` 必须包含**所有**可调参数（重连退避、超时、重试、事件过滤、缓冲容量、日志级别等）。
- 读取时与 DEFAULTS 深合并；未知字段保留（向前兼容）；类型/取值非法时回退默认值并记录 warning。
- `loadConfig()` / `saveConfig(next)` / `resetConfig()` / `normalizeConfig(raw)` / `publicConfig(cfg)`。
- 保存用原子写（临时文件 + rename）。

### 3.2 Gateway Manager（src/gateway/manager.js）

```js
export function createGatewayManager({ getConfig, log, onEvent }) {
  // onEvent(rawOneBotEvent) —— WS 收到 OneBot 事件时回调（由 host 负责 normalize + 入缓冲）
  return {
    ready,                    // Promise，初次启动完成（未启用时立即 resolve）
    start(), stop(), restart(),
    applyConfig(prev, next),  // 热应用：端点/enabled/账号等变化时内部重启；过滤器变化只更新
    call(action, params, opts), // OneBot action 透传（失败抛 Error，带可读 message）
    probe(overrideEndpoint),  // 只走 HTTP 探测 get_login_info，不改连接状态
    detectGateway(),          // { snowluma: {...}, endpoint: { httpUrl, wsUrl, ... } }（只读）
    snapshot(),               // 同步状态快照，形状见 §3.4
    actions,                  // createActions() 的产物
    dispose(),
  }
}
```

- WS 优先收事件；`wsUrl` 未配置时仍可用 HTTP（轮询不做，仅状态提示）。
- 连上后（若 `verification.enabled`）调用 `get_login_info` 核验：与 `botQQ` 一致 → `loginCheck:'ok'`；
  不一致按 `accountCheck` 策略 `warn`（只警告）/ `enforce`（断开并暂停自动重连，等待用户处理）/ `off`。
- 核验期间的原始事件先暂存（上限可配），核验通过后按序补发；失败则丢弃。
- 重连参数全部来自配置：`reconnect.minDelayMs/maxDelayMs/factor/jitterRatio/enabled`。
- 所有日志走注入的 `log`，token 必须脱敏。

### 3.3 入站协调与事件规范化（src/ingress/coordinator.js、src/gateway/normalize.js）

`host.js` 在 access/cognition/events/modules 就绪后、创建 gateway 前构造 `createIngressCoordinator({ access, cognition, events, modules, ctx, normalizeEvent, getConfig, logger })`，网关的 `onEvent(raw)` 委托其同步 `handleRaw(raw)`。模块启动与 `ready` 等待顺序保持原样。协调器仅拥有调用顺序和异常隔离，不拥有访问规则、规范化、过滤、认知、模块执行或广播实现；无定时器、全局状态、新配置或公开 hook。

每条入站严格保持以下顺序：

1. `access.decideRaw(raw)`；拒绝则 debug 日志并返回，禁止落 raw 或执行后续步骤。
2. `cognition.ingestRaw(raw)`；同步异常记录 warning，继续。
3. `normalizeEvent(raw, getConfig())`；返回 null 则停止。
4. `events.push(normalized)`；过滤、缓冲与统计仍由 event store 拥有。
5. `cognition.observe(pushed.record || normalized, { accepted: pushed.accepted, reason: pushed.reason || '' })`；同步异常记录 warning，继续。
6. 未接受则 debug 记录原过滤原因并返回。
7. 调用 `modules.dispatch(pushed.record).catch(...)`，不等待 Promise；拒绝记录 warning。
8. `ctx.emit?.('onebot-qq/event', pushed.record)`；保留同一 record 引用，同步异常记录 warning。
9. 外层同步异常记录 warning 并结束本条处理，不抛入 gateway。dispatch 同步抛错也沿用此路径，跳过广播。

每次调用的内部 envelope 为 `{ version: 1, platform: 'onebot', raw, normalized, accepted, reason, correlationId }`。raw/normalized 只保存引用，不附加到公共事件或 hook。correlationId 仅取现有 `normalized.message.id`、`notice.messageId`、`notice.flag` 或 `request.flag`（按此优先顺序，空值回退），保留字符串/数字原值；无标识时为空，不用时间、seq 或随机值生成。envelope 不持久化、不广播、不记录日志。

`handleRaw` 的内部返回值为 `{ accepted, reason, correlationId }`，host 忽略该值。accepted 表示 event store 是否接受，不代表模块执行完成或广播成功；拒绝/过滤沿用原 reason，无法规范化为 `unrecognized`，接受前外层异常为 `error`。返回值不包含 raw、normalized 或配置；请求 flag 用作内部关联值时不追加到公共事件或日志。原规范化事件的 `raw` 字段仍遵循下方既有契约，本阶段不增加或改变脱敏策略。

```js
export function normalizeEvent(raw, cfg) -> null | {
  seqless: true,
  kind: 'message'|'notice'|'request'|'meta_event'|'unknown',
  time, selfId, postType, subType,
  message?: { id, chatType:'private'|'group', chatId, sender:{userId,nickname,card,role}, text,
              segments:[…], mentions:[{userId,name}], images:[{url,file,summary}],
              replyId, rawMessage, messageFormat },
  notice?: { type, subType, ...关键字段 },
  request?: { type, subType, ... },
  meta?: { type, subType, ... },
  raw,  // 原始事件（可截断，见 cfg.events.rawMaxBytes）
}
```
- 过滤（events.filters）在 **events.push** 前完成：`ignoreUsers`、`ignoreGroups`、消息子类型开关、kind 开关、`includeSelfMessages`。
- 访问控制（`core/access.js`）在 `events.push` **之前**：`allowlist` 下非主人/非白名单消息直接丢弃，不落 raw、不聚合、不回复；审计只存元数据。
- 不伪造字段：平台没给的信息留空，不使用「推测」值。

### 3.4 状态快照（snapshot()，REST `GET /status` 的主体）

```js
{
  state: 'stopped'|'connecting'|'connected'|'disconnected'|'unconfigured'|'paused',
  configured: boolean,
  endpoint: { mode:'onebot'|'snowluma', wsConfigured, httpConfigured, wsUrlSafe, httpUrlSafe },
  connectedAt, lastDisconnectAt, lastError, reconnects, loginAttempts,
  login: { userId, nickname } | null,
  loginCheck: 'pending'|'ok'|'mismatch'|'error'|'off'|'unknown',
  expectedBotQQ, accountCheck,
  snowluma: { installed, dir, endpointFound } | null,
}
```

### 3.5 REST API（src/http/routes.js，前缀 `/onebot-qq/api`）

所有响应 JSON：成功 `{ ok:true, ... }`；失败 `{ ok:false, message }`（HTTP 200，面板统一处理）。

| Method | Path | 说明 |
|---|---|---|
| GET | `/status` | 状态快照 + 统计 + 最近事件(条数可配) + `access`、`upgrade` 内存摘要（不联网） |
| GET | `/upgrade` | `{ok:true,...upgrade.status()}`，不联网 |
| POST | `/upgrade/check` | `{force?:false}`，显式启用后手动查询 GitHub Releases |
| GET | `/access/stats` | 访问控制模式、名单数量、计数与最近审计 |
| POST | `/access/check` | body `{ chatType, chatId, senderId }`，返回判定与中文原因 |
| GET | `/config` | `{ config, defaults, groups, dataDir, version }`（含面板字段表） |
| POST | `/config/save` | body `{ config }` 全量保存，返回规范化后的 config 与 issues |
| POST | `/config/reset` | 恢复默认值 |
| POST | `/connect` / `/disconnect` / `/reconnect` | 连接控制 |
| POST | `/probe` | body 可选覆盖端点；只测试 HTTP `get_login_info` |
| GET | `/gateway/detect` | SnowLuma 检测 + 端点解析结果 |
| GET | `/login-info` | 实时 `get_login_info` |
| GET | `/friends` / `/groups` | 列表 |
| POST | `/send` | `{ chatType:'private'\|'group', chatId, message }`（string 或段数组） |
| POST | `/action` | `{ action, params }` 透传（受 `security.allowRawAction` 限制） |
| GET | `/events?since=&limit=` | 事件缓冲 |
| POST | `/events/clear` | 清空事件缓冲 |
| GET | `/logs?since=&limit=` | 日志环形缓冲 |
| POST | `/logs/clear` | 清空日志 |
| GET | `/health` | 轻量探活 |

### 3.6 客户端面板（client.js）

- 形式：`window.__ModuleLoader__.load({ id: 'dsh-bot', factory(require) {...} })`，
  工厂返回 `{ inject:['slots','theme'], apply(ctx) }`；`id` 必须等于包名。`theme` 是客户端 ui-theme
  公开服务（`getTheme/setTheme` + `theme/change`），用于系统设置页切换 DSH 全局主题；`package.json`
  的 `dsh.client.inject` 必须与之一致。
- 注册：
  - `ctx.slots.register({ name:'sidebar.panellist', id:'onebot-qq', order: 20, label: () => 'QQ 连接' }, Icon)`
  - `ctx.slots.register({ name:'main', key:'onebot-qq' }, Panel)`
  - 通过 `ctx.slots.inject(...)` 注册（参考 aurabot `client/client.js` 末尾写法）。
- 只经 `/onebot-qq/api/*` 读写宿主，不直接碰 QQ。
- 样式/动效分为三层，均由**同一个** `<style>` 注入（`STYLE_ID = dsh-bot-panel-style`）：
  - `TOKEN_CSS`：唯一允许十六进制色值的区块。显式声明 console-web 的浅色/暗色调色板、4 套强调色 +
    `inherit`（跟随 DSH 主题）、密度/字号/内容宽度/对比度映射、圆角/阴影/字重/动效时长变量；暗色通过
    `body[data-ds-dark-theme] .ob-root` 覆盖，强调色通过 `data-accent`、对比度通过 `data-contrast` 覆盖。
  - `MOTION_CSS`：唯一允许 `@keyframes` 与 `animation:` 的区块。实现语义配方 `content.enter` /
    `content.swap`（设置分类切换仅淡入） / `viewport.reveal` / `feedback.enter+exit` / `progress.trickle` /
    状态脉冲；`data-motion="reduced|off"` 与 `prefers-reduced-motion` 统一降级为 0.01ms。
  - `PANEL_CSS`：布局/组件类，只消费 `--ob-*` 变量；不写裸色值、不写裸字重（字重走
    `--ob-weight-*` 令牌）、不声明动画。
- 外观偏好全部来自 `ui.*` 配置（`accent/contrast/density/fontScale/contentWidth/motion/pageTransition`），
  根节点以 `data-*` 属性声明语义；客户端不写死默认值。**主题不进入 `ui.*`**：它由 DSH `theme` 偏好持有，
  设置页只调用 `setTheme` 并订阅 `theme/change`，避免两份主题源。
- **持久设置壳（config/settings）**：页头、全局标签栏、左侧分类导航不在被替换的内容容器内；
  分类切换只替换右侧 `.ob-settings-pane`（`key=active` + `ob-swap-in` 淡入），不重挂载壳、不滚动整页。
  `配置`/`系统设置` 顶层进入时强制 `ob-enter-fade`（不受 `ui.pageTransition` slide 配方影响）。
- **系统设置即时保存**：`saveUiPatch(patch)` 以 `applyConfigPatch` 乐观更新 draft，随即进入串行队列
  `POST /config/save`；成功时用服务端规范化结果回写（仅在没有更新改动时覆盖 draft），设置页显示
  「保存中/已保存/失败重试」，不显示吸底 Savebar；`配置` 页仍保持显式保存 + dirty 提示。
- 无障碍与响应式：统一 `:focus-visible` 焦点环、tab 方向键/Home/End 导航、toast `aria-live`、
  reduced-motion 合规；190–390px 单列、tab/设置分类可横向滚动、无横向溢出；动效只使用
  opacity/transform/width，不动画高度或滚动容器。
- 15 个顶层标签：**概览 / 连接 / 消息 / 媒体 / 内容 / 模块 / 备份 / 安全 / 配置 / 人格 / 模型 / 系统设置 / 认知 / 日志 / 关于**。
- 配置页字段按分组渲染（左侧分组导航 + 右侧仅当前分组），支持保存、撤销、恢复默认、Ctrl+S；
  所有配置来自 `GET /config`，不得在客户端写死默认值。`ui` 分组只由系统设置页消费，配置页过滤掉。
- 未保存改动要有 dirty 提示（页头徽标 + 吸底保存条，仅配置页）；保存失败要有可读错误。

### 3.7 实现补充（gateway 实际形状，集成后核对）

- `probe(override?)`（`POST /probe`，body 可传 `{ httpUrl, httpToken, httpAuth, wsUrl, wsToken }` 覆盖端点）：
  只走 HTTP 调 `get_login_info`，返回
  `{ ok:boolean, url, httpStatus?, elapsedMs, login?:{userId,nickname}, message?, httpConfigured? }`。
  网络失败不抛异常，以 `ok:false` + 可读 `message` 返回；不改变连接状态。
- `detectGateway()`（`GET /gateway/detect`）返回
  `{ mode:'onebot'|'snowluma', source, endpoint:{mode,httpConfigured,wsConfigured,wsUrlSafe,httpUrlSafe,source},
     snowluma:{installed,dir,version,reason,read:{found,uin,files,sources,reason,httpConfigured,wsConfigured,httpUrlSafe,wsUrlSafe}|null},
     reason, candidates:[{dir,installed,reason}], downloadPage }`；两处 URL 均已脱敏，token 不回传。
- `snapshot()` 在 §3.4 之外还包含：
  `paused, desiredRunning, verification:{enabled,buffered,dropped},
   snowluma:{installed,dir,version,reason}|null, stats:{connects,disconnects,calls,failures,pending,wsState}`。
- 只配 HTTP（`wsUrl` 为空）时：`start()` 不建立 WS，`state='disconnected'` 且 `lastError` 说明无法实时收事件；
  HTTP 调用照常可用。两个地址都空时 `state='unconfigured'`。
- 账号核验：仅当 `verification.enabled && botQQ && accountCheck!=='off'` 时核验；
  `accountCheck='enforce'` 且不一致 → manager 内部 `client.stop()` 并置 `state='paused'`（不会自动重连，用户点「连接」恢复）；
  `warn` 只置 `loginCheck='mismatch'` 并补发缓冲事件；核验异常置 `loginCheck='error'` 同样补发事件。
- 事件交付顺序：WS 原始事件 → 核验缓冲（pending 时）→ `onEvent(raw)` → host 规范化 → `events.push`（过滤）
  → `ctx.emit('onebot-qq/event', record)`。

### 3.8 认知内核契约（v0.4+）

- 代码边界：`src/cognition/**` 不 import `src/gateway/**` 或 `src/http/**`；只接收规范化事件、raw 事件和发送回调。
  平台层不 import 认知内部模块，只通过 `createCognition()` 返回的服务接口交互。
- 宿主服务：`ctx.provide('onebotCognition', service)`；接口：
  `ready`、`ingestRaw(raw,meta)`、`observe(normalized,accepted)`、`snapshot()`、`overview()`、
  `persons/personDetail/memories/decisions/...`、`registerKnowledgeSource(src)`、`registerCapability(name,impl)`、
  `pause(reason)`、`resume()`、`dispose()`。
- 单一写者：认知状态只由 cognition service 写；UI/API 通过 service 命令；平台事件不得直接改表。
- 存储：`node:sqlite` WAL + FTS5；原始事件 JSONL；无 sqlite 时 JSON fallback。schema/migration 见
  `docs/cognitive/DATA-MODEL.md`。
- LLM：DSH 路由仍用 `ctx.get('llm').stream()`；直连路由走 `src/model` 模型网关（OpenAI/Responses/Anthropic/Gemini/Ollama），
  路由继承 `agentDefaultModel`、固定配置或模型页 selected；无可用模型时社交回复进入 degraded，不伪造认知。
  DSH 一次性调用使用顶层 `system` + identity-free user `messages`，并带稳定 `sessionId`
  （OpenCode Go 的 `x-opencode-session`）；默认不发送 temperature；失败保留 provider
  message 并通过 `/cognition/llm/test` 自检。
  persona 记录含 12 维特质 + 6 维风格 + 文本 `profile`；可保存多份，`setting.persona.activeId` 指向当前激活项。
  文本 profile 进入 analysis/compose prompt（约 2000 字符上限），
  空字段不注入。每次只投影选中状态，禁止把全量人格/记忆塞入系统提示词。
- 群聊参与：`cognition.turn.groupReplyMode = addressed|probability|all`；`addressed` 默认只处理 @/回复/唤醒词/人设名；
  `probability` 未点名按概率采样；`all` 全部进入策略但仍可沉默。发送前有同群冷却与每分钟上限；跳过写记忆、trace 与
  `lastTurn` 诊断字段，不调用 LLM。旧 `addressedOnlyGroups=false` / `policy.groupAmbient=true` 非破坏性映射为 `all`。
- 人格编辑/人格库：`POST /cognition/persona/edit` 接受 `profile` 和可选 `personaId`，清洗/截断后写对应 persona 记录并追加
  history/version；`create/switch/delete` 管理人格库，至少保留一份；`import` 接受 `persona-import@1` 一次性创建并激活。
  旧 `self` 自动成为默认。UI 顶层「人格」工作台与「认知 → 人格」共享同一数据源。
- 人格级认知数据：`createPersonaScopedStore` 在 store facade 层把非全局 kind 自动加 `persona_<id>:` 前缀，服务层无需
  知道人格；全局 kind（setting/persona/state/raw_event/turn/llm_usage/audit_log）不隔离。启动时把旧无前缀数据迁到
  默认人格（幂等标记）；删除人格会清理其数据。`copyPersonaData` 按数据组从一家格单向复制到另一人格，复制后继续独立。
- Web/知识源：`ctx.get('web')` 可用时优先；否则内建合法公共 API/RSS；外部内容一律不可信，不执行其指令。
- 配置：`cognition.*` 默认值与 `cog-*` 字段组在 `src/core/config.js`；`CONFIG_VERSION=2`；旧配置自动补默认。
  面板「配置」页过滤 `cog-*`；「认知 → 设置」页使用同一字段表即时保存。
- 状态机：turn `observed→aggregating→ready→attending→thinking→composing→sending→awaiting_outcome→closed`；
  失败/取消/降级都持久化，重启按硬截止关闭 open turn，发送使用幂等键防重复。
- 可观测：每个阶段写脱敏 `traces`/`metrics`；关键状态变化写 `state_transitions`/`audit_log`；UI 可查。
- 隐私：scope/sensitivity 在写入与检索双层校验；私聊记忆不得进入群聊检索；secret 不进 LLM；删除/导出/保留可配。
- 安全默认：群聊默认仅点名/回复/唤醒词/人设名；可显式切换概率/所有消息，并受策略沉默、冷却、频率上限约束；
  主动行为默认关闭；外部学习仅公共概念、预算受限、可暂停；运行时不自安装插件/不改代码/不扩权。

### 3.9 认知 REST 与 UI

- 路由前缀仍为 `/onebot-qq/api/cognition/*`，响应 `{ok:true,...}` / `{ok:false,message}`；GET 无副作用。
- 面板「人格」标签是文本人设 + 群聊参与工作台；「认知」标签仍提供状态/人物/关系/记忆/情绪/策略/学习/技能/元认知/设置，
  以及同源的数值人格编辑入口。概览和认知状态页显示最近 turn 的 outcome/reason 诊断。
- 认知 API 不可用时页面显示 degraded/空态，不影响平台连接与配置页。

### 3.10 模型协议契约（v0.5+）

- 代码边界：`src/model/**` 不 import `gateway/**`、`http/**`、`cognition/**`；只接收 provider 配置与请求，
  返回统一 `text-delta/reasoning-delta/usage/finish`。认知通过注入的 `models` 调用，平台不直接拼协议。
- 协议：`openai-completions`、`openai-responses`、`anthropic-messages`、`gemini-generate-content`、`ollama-chat`；
  厂商只是 preset，不是硬编码分支。
- 注册表：`<dataDir>/models.json`（原子写、`.bak`、0600 尽力）；API 只返回 `hasApiKey`/来源/后四位；
  `/config` 永不包含模型 key。
- 认证：bearer / x-api-key / 自定义 header / none；禁止跨源重定向转发认证头；错误/日志/trace 脱敏。
- 路由：`cognition.llm.mode = auto|dsh|fixed|direct|chain`；直连 selected + fallback，最后可回退 DSH；
  空文本、只有 reasoning、bad JSON 都不算成功。
- REST：`/onebot-qq/api/models/*`；UI「模型」标签；详细矩阵见
  `docs/MODEL-GATEWAY.md`。

### 3.11 访问控制与统一出站

- `src/core/access.js`：`normalizeAccess` / `decideInbound` / `canSend` 纯函数；`createAccess` 负责配置读取、审计环形缓冲与计数。
- `src/delivery/service.js`：认知命令、模块 `api.sendText`、proactivity、Agent `qq_send_text` 在生产中共享 `services.delivery`；单条 DeliveryPlan → `executeDeliveryPlan` → `outbound.deliver`。segments 优先于 text，无分条/引用/@/等待；保留 outbound 结果字段，透传执行器的状态与实际条数，单条真实成功 `parts:1`，失败/dry-run `parts:0`。详见 [ADR-004](architecture/ADR-004-unified-egress.md) 与 [ADR-006](architecture/ADR-006-delivery-result-status.md)。
- `src/cognition/outbound.js`：`deliver({ chatType, chatId, segments, decisionId, source, dryRun })` 保持自动文本发送的安全闸门；
  顺序为访问控制 → 频率上限 → leak guard → dryRun → 发送 → `policy.markSent/markFailed`；只发一次，不自动重试。
- pipeline 回复仍经原 planner/executor/outbound；Phase 5 的四类入口由 cognition 创建服务并注入，runtime 转给 tools、host 转给 kernel。未注入的旧调用方保留 outbound 兼容路径，proactivity 提取后仅经核心 delivery/outbound 端口，缺失即安全失败，无 legacy gateway 回退。DeliveryService 自身没有 gateway 回退，outbound 不可用时安全失败，拒绝后不绕过或重试。
- 面板人工 `POST /send` 保留 direct gateway 路径；媒体/文件命令与提醒服务不在本阶段迁移范围内。planner/分条、限频/重试/部分成功/leak guard 语义不变。
- 默认 `access.mode='open'`，升级后行为不变；`allowlist` 才启用主人 + 白名单规则。

`src/core/leak-guard.js`（M7-i）提供纯函数 `scanText`（clean 为脱敏文本）、`redactText`、`guardSegments`，以及动态读 `security.leakGuard` 的 `createLeakGuard`。默认启用 + redact；文本规则限 OpenAI/GitHub/AWS AKIA/Bearer/PEM 私钥/至少 16 字符的 api_key/apiKey 值；私钥块通过单向游标查找 END，其他模式无嵌套量词，重叠区间合并。每次扫描及一次消息 text 总长度最多 100,000 UTF-16 单元；超限整体脱敏或阻止，畸形 text 段 fail closed。非文本段原样保留，不读取 base64。

outbound 在限频检查后调用 guard；block 返回 `{ok:false,error:'LEAK_BLOCKED'}` 并累加 `leakBlocked`，成功脱敏只增加 `leakGuard:'redacted'`。dry-run 也检查，block 优先；不实际发送。每次尝试仍经过既有访问/限频，block 不记 sent 配额。摘要仅类别/次数；网关异常用固定 `send_failed` 供调用者、policy 与日志，避免异常回显密钥。无新依赖/外部调用/自动审批；不检测 PII/熵，可能误报/漏报，不重组跨段/跨消息密钥；媒体/文件及面板手动 `/send`、raw action 等独立路径不覆盖。#15 仍 partial（缺统一审批/逐项权限）。

### 3.12 DSH Session 运行时（`src/runtime/agent.js`）

```js
createAgentRuntime({ ctx, getConfig, access, gateway, outbound, delivery, logger, dataRoot }) -> {
  available(), active(), engine(),
  levelFor(turn), presetFor(level),
  compose({ turn, system, user }),  // -> { ok, text, sessionId } | { ok:false, error }
  steer(turn, text),               // -> { ok:true, sessionId } | { ok:false, error }
  summary(), sessions(), dispose(),
}
```

- 服务探测：`ctx.get('sessionController')`、`workspaceRegistry`、`agents`、`systemPrompt`；缺一个则 `available=false`。
- `runtime.engine` 默认 `oneshot`；只有 `agent` 且服务齐全时 `active=true`，否则 `compose` 返回 `RUNTIME_INACTIVE`，调用方回退一次性 LLM。
- 会话映射：`<dataDir>/runtime/sessions.json`，key 为 `chatType:chatId`；preset/level 变化或恢复失败时新建。
- preset：主人私聊 `dsh-bot-private`（fs/fs-search/web 工具），群聊/他人私聊 `dsh-bot-social`（无本机工具）。
- QQ 工具：仅 `level=full` 的主人私聊 session 通过 `agent.ctx.tools.register()` 挂载 `qq_send_text`、`qq_like_user`、`qq_poke_user`；定义固定当前聊天/发送者，文本经 DeliveryService/executor 走 outbound 的访问控制与限频。social/group session 注册 0 个；注册失败只记安全日志，dispose 逐项移除。
- 上下文：`agent.ctx.systemPrompt.context({ name, order, text })` 挂认知 system 文本；没有该 API 时退回把 system 前置到 user 消息。
- 回合：`agent.followup(UserMessage)`；监听 `session/event`，`assistant/message` 取无 tool-call 的文本，`turn/end` 结算；每聊天串行，超时返回 `TIMEOUT` 不强杀。
- 显式插话（M7-o）：主人 `/steer 文本` 经命令身份/禁用列表/访问闸门调用 `runtime.steer(turn,text)`；要求 active、private/group 正整数安全数字 ID、非空 1–1000 Unicode 字符。通过 `sessionFor(turn)` 复用或创建 Session，调用 `agent.steer({content:[{type:'text',text}],source:{kind:'user'}})`，不写配置或直接调用模型。Session 解析单独串行以避免与 compose 并发创建；steer 不等待 compose 的 turn/end。
- 插话结果：缺方法返回 `STEER_UNAVAILABLE`，异常只返回/记录固定 `STEER_FAILED`，不回显原始异常/文本；成功累加 `summary().stats.steers` 并更新 lastAt。普通回合仍只用 followup，不自动 steer，无非主人插话、typing/`set_input_status` 或插话面板/API；fake agent 离线测试，真实 DSH/QQ 未验证，#9 partial。
- 人格/规则：插件在 `host.apply` 注册 `dshbot_persona` / `dshbot_rules_private` / `dshbot_rules_social` 提示词变量，preset 只引用变量。
- 边界：analysis/policy/记忆仍由认知内核负责；没有通用 action bus，也不提供资料编辑、群管理、精华、撤回或文件 Agent 工具；真实 QQ 工具调用仍待真机验证。

### 3.13 QQ 命令与按聊天模型

- `src/cognition/commands.js`：`parseCommand(text)` + `createCommandService()`；只处理 `/name args`，非主人静默忽略。
- 命令在 `pipeline.handleTurn` 的自循环检查之后、分析/策略之前处理；回复走 `delivery.deliver({ source:'command' })` → executor → outbound，
  因此同样受访问控制与频率上限约束。
- Phase 10：命令服务 `registerCommand(name,handler,{ownerOnly=true,allowProtected=false})` 仅在 allowProtected 严格为 true 时接受受保护名称，始终拒绝同名模块注册。分发优先选模块覆盖，再走核心分支；覆盖保留 ownerOnly/deniedCommands，handler 前另检查当前会话 canSend（缺失/异常/拒绝均安全失败），回复沿用上述命令交付路径。disposer 仅删除自身注册，无注册时恢复原核心命令；handler 错误或发送拒绝不会触发核心重试。详见 [ADR-009](architecture/ADR-009-command-override.md)。
- `/quiet` `/active` 写回 `cognition.turn.groupReplyMode` 与 `cognition.proactivity.enabled`；`/model` 写
  `cognition.modelRouting.routes`（`chatId=provider/model`）；`/remember` `/forget` 调用记忆服务的 `remember` /
  `forgetMatching`，作用域是当前私聊或群。
- `src/cognition/llm.js`：`chatOverride(chat)` 解析 `modelRouting`，`buildAttempts(chat)` 把会话覆盖放在最前；
  provider 在直连注册表里 → `kind:'direct'`，否则 `kind:'dsh'`。`currentRoute(chat)` 供 `/model` 与面板诊断。
- 限制：只影响认知 LLM 路由；`agent` 引擎的 DSH Session 模型仍由 preset/DSH 选择，后续再通过 sessionController 选模型。

### 3.14 回复分条、引用/@ 与群聊防刷屏

- `src/delivery/text-split.js`（`src/cognition/reply-split.js` 兼容重导出）：`splitReply(text, { maxChars, maxParts })` 纯函数；优先段落/换行/句末标点，找不到才硬切；超过 `maxParts` 的剩余内容并入最后一条。
- `builtin-reply-delivery` 按核心传入的 `cognition.reply` 配置产生 DeliveryPlan，`pipeline.sendDecision` 选择模块或 core 兼容布局交给 executor；第一条可带 `reply`（引用）与 `at`（群聊 @）；每条都经过 `outbound.deliver`，因此访问控制/限频对每条生效；分条间隔 `delayMs`。
- DeliveryResult（Phase 7）：执行器正常返回显式 `status:sent|dry_run|partial|failed|empty`，`parts` 为实际成功发送条数。全部成功为 `sent`；首条失败为 `failed`、`ok:false`、`parts:0`，保留原 error/blocked/reason；后续失败保留 `ok:true`、此前 messageId/result 与 parts，同时返回 `status:'partial', partial:true, sentParts, failedPart, error:'PARTIAL_SEND'`，failedPart 从 0 开始。不回滚、不重发、不重试。
- dry-run 为 `status:'dry_run'`：首条仍返回 `dryRun:true`、空 messageId，新增 `parts:0`；后续 dry-run 保留此前实际条数与结果，不新增 dryRun 标记，统计/pending/群聊记账保持原状。无效计划且回退仍无效为 `status:'empty', error:'EMPTY_MESSAGE', parts:0`。pipeline 自身空正文/纯空白提前返回不变；抛出的传输/回调异常仍传播。完整状态矩阵与兼容边界见 [ADR-006](architecture/ADR-006-delivery-result-status.md)；频率账本、传输重试、leak guard 顺序及 shutdown 留待后续阶段。
- 防刷屏：`cognition.turn.maxConsecutiveGroupReplies` 限制连续**未点名**接话；`noteGroupReply` 按是否点名维护计数（点名回复清零），`groupReplyAllowed` 超限返回 `consecutive_limit`，与冷却/每分钟上限并存。
- 边界：合并转发展开、拍一拍/表态、QQ 动作工具仍在 M2-b。

### 3.15 合并转发、拍一拍/表态与 QQ 动作

- `src/gateway/normalize.js`：`forward` 段写入 `message.forwards`，不混进 `text`。
- `src/gateway/forward.js`：`flattenForward()` 兼容 `messages` / `data.messages`，节点内容压平成
  `发送者：文本`（图片/语音/表情/文件等占位）；`actions.getForwardMsg()` 先 `id` 后 `message_id` 兼容两类网关。
- `pipeline.expandForwardTurn()`：在命令处理之后、分析之前展开最多 3 条，写入 `turn.text`/`turn.forwardText`，
  并标记不可信；`buildComposePrompt` 明确要求不执行转发内容。
- `pipeline.handlePoke()`：只回应 `target_id == botQQ` 的 `notify/poke`，按用户冷却，走 outbound（source=`poke`）。
- `pipeline.handleReaction()`：按 `message_id` 找回 pending，记录正向 outcome 并更新技能；重复/非本人忽略。
- `src/cognition/qq-actions.js`：点赞、拍回去、群信息、成员信息；校验主人与当前会话，返回可展示字段；
  `/like` `/poke` `/groupinfo` `/memberinfo` 命令复用。`src/runtime/qq-tools.js` 提供独立的 DSH ToolDefinition，仍固定当前会话。

### 3.16 目的与每日整理

- `src/cognition/purpose.js`：`goal/plan/intent` 三类型，`active/paused/done/abandoned` 四状态；按 persona 作用域存储；
  `promptContext()` 只返回少量高优先级目的，`tick()` 给「优先级+紧迫度+停滞度」建议，不执行。
- pipeline 在分析前取 `purpose.promptContext()`，随 `composeReply` 注入 compose system；完成/放弃后不再注入。
- `src/cognition/consolidation.js`：每日 04:00 调度 `memory.consolidateAll()`；可选按作用域调用 LLM 反思，
  只压缩已有记忆，结果写回同一 scope 的 semantic 记忆（source=`reflection`）；私聊不跨聊、不写 global。
- 面板：认知 → 目的（增删改/进度/状态）；记忆页「整理/反思」手动触发；API `GET /cognition/purpose`、
  `POST /cognition/purpose/create|update|delete`、`POST /cognition/consolidation/run`。
- `src/cognition/timeline.js`：只读聚合 turn/memory/decision，支持 `before` 分页、types 与 scope 过滤；面板「时间轴」按类型筛选。
- 边界：目的不执行工具、不自动发消息；人物档案编辑与全库向量召回仍在 M3 剩余；导入旧档案见 M7-d，可选 embedding 重排见 M7-f。

### 3.17 媒体基础（M4-a）

- `src/media/index.js` 的 `createMediaService()` 是媒体唯一入口。`media.enabled=false`，且 Vision/生图/改图/ASR/TTS 各自默认关闭，因此默认配置不发起媒体网络请求。
- `pipeline.handleTurn()` 在主人命令之后、合并转发展开之前调用 `ingestTurn(turn)`；下载后的附件写入 `turn.media`，ASR/视觉文本用「媒体识别内容」分隔后追加到 `turn.text`，因此进入检索、分析、回复 prompt 与记忆。下载/provider 失败只记 debug，不中断轮次。
- 入站仅下载 `http/https` 的 `image`/`record`/`file` 段及 `message.images`，按 `media.maxBytes` 限制单文件并校验扩展名；默认目录为 `<dataDir>/media/inbound/`。Vision 调 OpenAI 兼容 `/chat/completions`（base64 data URL），ASR 调 `/audio/transcriptions`（multipart）。
- TTS 调 OpenAI 兼容 `/audio/speech`，MP3 保存到 `<dataDir>/media/outbound/`。API Key 配置只保存环境变量名，密钥从进程环境读取，不进入状态或日志。
- `sendMedia()` 对图片/语音使用 `base64://` OneBot 消息段，避免网关不能读取 DSH 本地 `file://`；文件使用 `upload_group_file` / `upload_private_file`。发送同样检查总开关、能力开关、大小与扩展名。
- REST：`GET /media/status`、`POST /media/test {kind:tts|asr|vision}`、`POST /media/tts {text}`；测试接口使用内置最小样本，不接受任意文件路径，TTS 只生成文件、不向 QQ 发送。
- 边界：M4-a 不含管理 UI、QQ 媒体命令或表情包；这些由 §3.19 的 M4-b 补充。Agent 媒体工具、RVC 仍未实现；受限图片生成/编辑见 §3.19；真实网关/provider 兼容性仍需 M7 实机验证。

### 轮次生命周期（Phase 6）

`src/cognition/turn-hooks.js` 提供内部 `createTurnHooks({logger})`，仅有 `register({id,onStart,onEnd})`、`start(context)`、`end(context)`、`list()`。非空唯一 id、至少一个函数 handler；返回幂等 disposer。start 按注册顺序串行等待，end 逆序等待；单项同步/异步失败隔离，仅固定安全日志，不输出聊天 ID/注册描述符/原始异常；logger 失败也不进入宿主。

host 在 createCognition 前创建 registry，传入 cognition → pipeline，并与 gateway 一起注入模块内核。内核 `turn:lifecycle` / `api.turn.register` 和 `status:write` / `api.status.setInputStatus` 仅内置运行中的模块可用；外部声明权限也拒绝。status 只调用注入的 `gateway.actions.setInputStatus(String(userId),eventType)`，保留其校验/错误，不开放通用 gateway。hook 随 runtime 停用、失败、依赖清理和 dispose 自动注销。

默认启用的 `builtin-typing` 无配置 schema/API/UI，唯一开关仍为默认关闭的 `cognition.typing.enabled`，UI/normalizer/路径不变。pipeline 构造 `{turn,settings:{typingEnabled:cfg().typing?.enabled===true}}`，await start → try await processTurn → finally await end。模块只在开关严格为 true 且 turn.chatType 为 private 时，分别尽力 await 状态 1/2，吞掉状态异常。保留正常结果、命令提前返回与处理异常，不发送群输入状态。

生产注入 registry 后禁止内联 typing：模块关闭/注册失败/空 registry 都不提示。仅 `turnHooks=null` 的旧 harness/单测保留原内联逻辑；核心不导入 typing 模块。已开始的异步 handler 不强制取消，没有新超时/重试。详见 [ADR-005](architecture/ADR-005-typing-module.md)。

### Provider 与内置提醒（Phase 11–13）

内部 `src/extensions/providers.js` 只开放 reminders 槽位，register/get/list/remove 保持身份绑定、固定白名单和内置来源检查。新增 subscribe(listener) 返回 disposer；成功添加/移除通知冻结的 `{name,moduleId}`，不含服务对象，隔离同步/异步监听异常。模块只获 providers:register 的注册入口，外部不可注册，runtime 自动清理。

默认启用的 builtin-reminders 接管提醒调度与三个受保护命令，无模块配置。宿主等待 modulesReady，通过串行 syncReminderOwnership 和 provider 订阅处理启停、失败和依赖重载：先停止并排空旧所有者，再启动当前 provider；无 provider 则启动核心，provider 启动失败清理后回退核心。失败注册不因重复协调反复启动，重新注册可重试。等待中选择变化则重新协调。核心构造与兼容服务/命令保留，startReminders/stopReminders 幂等；默认空 registry 的安装启动核心一次。认知其它后台任务不变。

`src/reminders/service.js` 和 `commands.js` 共用核心与模块的提醒规则、解析、精确文案与错误映射。模块命令由 command service 保持主人/禁用/访问检查、统一 source:command 回复；模块副作用前再调用 api.access.canSend。停用注销覆盖恢复核心，帮助不重复展示覆盖的核心命令。api.access.canSend 需 access:check，仅内置，既有 access 缺失/异常时拒绝。api.delivery.send 需 delivery:send，仅内置，固定一条 text part 走 DeliveryService/outbound，source 默认 module:<id>，只有 builtin-reminders 允许 reminder，不回退直接网关。外部声明两项新权限在导入前拒绝。

提醒仓库固定核心 persona-scoped reminder kind，get/list/findDue/countActive/put/update/remove 保持验证、投影和安全错误。list 仍最多 50；Phase 13 增加 all(status) 供防重/额度及按聊天过滤，capture() 在端口内绑定当前 scope，返回仓库和 isCurrent，无 kind、persona 或 base 暴露。捕获句柄随 runtime 撤销；tick 在 await 后写回原人格，切换后不继续剩余发送。发送前后比较完整业务快照，取消/删除/替换不被完成结果覆盖。全部数据原地使用 SQLite/JSON、既有备份及人格统计/复制/删除，无 module_store 副本或迁移。

配置仍通过 config:read / legacyConfig.section('cognition.reminders') 只读五个规范化字段；没有其它路径/秘密/写入/订阅。默认 enabled:false 和原 UI 不变。单个自调度 timeout、最早到期 20 条、no overlap、完成后重复推进、至少一分钟失败退避和 dry-run 成功语义保持。

正常生命周期清理在撤销 API 前先 await provider.stop，使在途发送完成写回；stop 同步清 timer、阻止旧回调重排和下一条发送，宿主等待排空后交接。最终同步 dispose 先调用 provider.stop({dispose:true})，内置实现禁止迟到写库；异步 start 在卸载后结束再次停止。停止异常使用固定日志尽力清理，错误 provider 的遗留资源无法保证；已有网络发送不能撤回，进程崩溃/网关超时仍可能重复，无跨进程 exactly-once 保证。生产目录四个内置模块（提醒、回复交付、输入状态默认启用，示例默认关闭），无媒体迁移、配置/UI/REST/依赖/版本变化。详见 [模块契约](MODULES.md)、[ADR-010](architecture/ADR-010-provider-composition.md)、[ADR-011](architecture/ADR-011-reminder-repository.md) 与 [ADR-012](architecture/ADR-012-builtin-reminders.md)。

### 3.18 统一模块内核（模块架构 v2）

- Phase 10：新增已知权限 `commands:override`，`api.registerCommand(name,handler,{ownerOnly=true,overrideBuiltin=false})` 仅对加载器认定为 builtin 且同时声明 commands/commands:override 的模块开放严格 true 的覆盖选项。外部声明权限/伪造来源无效，外部或缺权限调用在 setup 中抛错进入 error；默认仍拒绝受保护名称，普通外部命令行为不变。内核验证后传 allowProtected:true，disposer 进入 runtime.disposers，在停用、setup/事件失败、依赖禁用/重载及 dispose 时注销；旧 API 不能重新注册，已开始的异步 handler 不强制取消。下一次命令无覆盖即回到核心；Phase 13 已用于提醒接管，目录为四个内置模块，无配置/UI/REST/依赖或版本变化。详见 [模块契约](MODULES.md) 和 [ADR-009](architecture/ADR-009-command-override.md)。
- `src/modules/registry.js` 为冻结的包内静态注册表，lazy import；内置 ID 保留 `builtin-` 前缀。外部扫描 `<dataDir>/modules/<id>/module.json`，拒绝此前缀并跳过 `.builtin`；entry 词法路径与 realpath 都必须留在模块目录内。
- `manifest.js` 共享 id/name/version/description/entry/permissions/enabled 校验，apiVersion 默认且仅支持 1，requires 默认 []、最多 16、合法 ID、无重复/自身。来源与 canReload/canToggle 由加载器赋值。
- `dependencies.js` 先校验完整依赖图再导入：稳定拓扑排序，就绪内置优先再按 ID；缺失/环节点 error，下游 blocked，禁用/失败依赖也阻塞下游，无关模块继续。不会自动启用或下载依赖。
- 生命周期操作串行；setup 可异步返回 cleanup，按下游到依赖逆序清理命令/事件/知识源/capability。外部 reload 会停止并恢复符合条件的下游；内置禁止直接 reload，协调时只用缓存代码重新 setup。旧 runtime 的迟到事件错误不能污染新状态。
- `modules/state.json` 原子保存 `{disabled,enabled}`，兼容旧 `{disabled}` 与缺失/损坏状态。外部 `manifestEnabled && !disabled`，清单 false 不能 API/UI 启用；内置 disabled 优先，再 enabled，再 defaultEnabled。先成功写状态再改变 live，失败保持原状。
- 权限 API 保持 commands/events/send:text/cognition:read/knowledge/capabilities/storage；新增只读 source/builtin。sendText 经 DeliveryService/executor 走统一 outbound，命令默认 ownerOnly、不能覆盖已有命令。api.dir 对外部为模块目录，对内置为可写数据目录。
- 外部 `<id>/data.json`，内置 `.builtin/<id>/data.json`；均为原子串行写、最多 1 MiB、校验 realpath 包含关系，不写包内源码。默认关闭的 builtin-sample 不 import/setup，开启后提供主人 `/module-sample`，从 api.config.get().message 读取回复（默认「内置示例模块已启用。」）。
- Phase 4：`delivery:plan` 仅内置模块可调用 `api.delivery.registerPlanner`，外部声明权限也不能注册；注册项随停用、setup 失败、依赖重载和 dispose 清理。生产 registry 包含默认关闭可配置的 builtin-sample、默认启用无配置的 builtin-reply-delivery，以及 Phase 6 默认启用无配置的 builtin-typing，加上 Phase 13 的 builtin-reminders，共四个内置模块。只有单一 format 阶段，没有外部 planner API。
- Phase 8：只有 builtin 且声明 `scheduler` 权限才暴露 `api.scheduler`；`setTimeout(fn,delayMs)` 返回冻结的 `{id,dispose}`，`clearTimeout(id)` 存在时返回 true，否则 false。延迟为 0–2,592,000,000 ms 的数字整数，每 runtime 最多 64 个活跃 timer，非法/超限/停止后注册同步拒绝。随机不透明 id 仅本模块/runtime 有效，不是网关/用户 ID。runtime Map 管理全局原生 timer；performance.now() 单调截止时间分段等待，避免 Node 32 位上限溢出。触发前检查 runtime generation 身份与注册存在，先移除再调用；同步/异步异常只记录固定安全警告，不含异常/聊天 ID/payload，logger 失败也隔离。停用、setup/事件失败、依赖重载/禁用或 dispose 先清空 timer，再执行 cleanup；旧回调不执行、不重新调度，已开始异步工作不等待或强制取消。无 interval/cron/持久化，不提取提醒/媒体、不新增生产模块/配置/UI。详见 [ADR-007](architecture/ADR-007-module-scheduler.md)。
- Phase 9：host 将 `cognition.services.personaStore`（既有 createPersonaScopedStore facade）作为 personaStore 选项注入 kernel；仅声明 `persona:store` 的内置模块得到冻结的 `api.personaStore`，外部声明权限在导入前拒绝。同步 get/put/remove/list/count，安全 key 为 `^[a-z0-9][a-z0-9_-]{0,63}$`；固定内部集合 module_store、记录 ID `module:<moduleId>:<key>`，由 facade 添加当前 `persona_<id>:` 前缀，模块间与核心 kind 均隔离。API 无 raw kind/SQL/原始 store/路径/人格 ID 或跨人格参数；每次调用使用当前人格。所有值进出 structuredClone，仅接受 JSON 值，JSON UTF-8 每值最多 64 KiB、每模块每人格最多 1000 条，put 事务检查额度、满额可覆盖；list 默认 100、上限 1000，仅返回 key/value。停止/失败/依赖清理/dispose 撤销旧 runtime 的全部仓库操作，已提交数据保留；dropPersonaData 额外清理此固定集合，不加入 UI 人格复制/统计组。完全复用 cognition store 的 SQLite/JSON fallback 与事务，没有独立持久层；不是通用 DB 或提醒功能，不迁移提醒/媒体，不新增生产模块/依赖/配置/UI/REST。详见 [模块契约](MODULES.md) 和 [ADR-008](architecture/ADR-008-module-persona-store.md)。
- 内核 Phase 3 / WebUI Phase 4：内置 registry 描述符和外部 module.json 顶层可声明 `config:{version:1,fields}`；`config.js` 无依赖验证平面唯一键（最多 32）、label、默认值、switch/text/textarea/number/select/string-list/number-list 及边界，拒绝 secret 与未知 values 键，缺失字段填默认值。外部 schema 同样限制 64 KiB，无效/超限时导入前拒绝；未声明 schema 的模块无配置 API/runtime config，外部 UI 配置还须有效 webui opt-in。
- 配置在发现阶段加载，先于 setup；内置 `.builtin/<id>/config.json`、外部已验证模块目录的 config.json 与 data.json 分离，最多 64 KiB、realpath containment、原子替换；外部配置额外拒绝符号链接及目录逃逸。缺失/损坏按默认值与 revision 0 安全警告，不阻止模块运行。`setModuleConfig` 与生命周期串行，revision 匹配后持久化递增（首次为 1），再更新内存/通知；过期为 MODULE_CONFIG_CONFLICT。`getModuleConfig` 深拷贝 schema/values/revision/source，不公开路径。
- `api.config.get()` 返回已验证值的深拷贝，`onChange(handler)` 返回 disposer；通知独立复制值并隔离同步/异步异常，生命周期结束自动清理。异步 handler 不阻塞操作队列。GET/POST `/modules/config` 返回 `{ok:true,id,schema,values,revision}` 或安全 `{ok:false,code,message}`。ModulesPage 按有效 UI 描述、hasConfig 与 available/module-file 绑定，仅在核心详情中提供 FieldRow/FieldControl 草稿、保存重读、取消和冲突提示；停用/未 loaded 时禁用字段和保存。保存后重读失败保留新的 revision，MODULE_CONFIG_* 语义不变；列表无重复表单。module-file 不改全局配置存储、入站或交付路径；legacy-core 的 Phase 3A 详情通过原全局配置链路保存，精确字段归属见 [模块文档](MODULES.md)。
- host 显式传入生产 registry，保持 modulesReady/startup 顺序与规范化事件 dispatch。GET /modules 返回 items 和 summary；记录新增来源、API 版本、requires、操作能力及 blocked，不返回绝对路径。面板按能力提供启停/外部重载与刷新。
- 模块仍与宿主同进程，permissions 不是沙箱；回复交付规划和私聊输入状态已迁入内置模块，无远程安装、上传、marketplace、依赖下载、自动更新、文件监视或移除接口。详见 [模块契约](MODULES.md)。

### 旧档案导入（M7-d）

`src/cognition/archive-import.js` 的 `createArchiveImportService({store,getConfig,clock,logger})` 在 memory 服务之后组装，store 使用 `state.scopedStore`。同步导入期间不切换人格；确定性 SHA-256 ID 由作用域类型/ID、personId、正文的 JSON 元组生成，按当前人格检查已有记录和批内重复，不覆盖旧值。

`POST /cognition/import` 用 6 MiB 请求体限制接收 format/content/scopeType/scopeId，入口检查 `cognition.import.enabled` 和存储就绪状态；服务按 UTF-8 大小（默认 5 MiB）与项数（默认 5000）验证。先解析/规范化整批，再在 store 事务中写入 memory，并把规范化后的 createdAt/updatedAt 传给 `put` 的时间戳选项，保留 SQLite 排序和 FTS/词法检索。JSONL 非空坏行计 invalid，整份 JSON 解析失败或零有效项报错。正文最多 4000 Unicode 字符、私聊/群作用域数字 ID、人物 64 字符、类型白名单和安全时间戳；source/status 与记忆默认值固定，不透传任意字段。

面板 `CogMemories` 在列表后提供文件选择、作用域/ID 与导入结果，成功刷新检索。服务只记录计数，错误不包含档案正文；不读取任意路径、不调用网络/模型、不自动发送 QQ，不新增命令/鉴权/依赖。范围是通用 JSON/JSONL 记忆，导入后的记忆可被既有时间轴聚合，但不是时间轴事件导入；不提供 Aurabot 专用转换或向量工作，无真实旧档案样本验证，#30 仍 partial。

### 3.19 表情包、媒体命令与面板（M4-b/M7-c/M7-k）

- `src/media/stickers.js` 在 `<dataDir>/media/stickers/` 保存图片，以 `<dataDir>/media/stickers.json` 原子维护索引。只接受 PNG/JPG/JPEG/GIF/WebP，默认单图 5 MiB、最多 200 个；SHA-256 去重，索引缺失或损坏按空库容错。HTTP/JSON 只公开 ID、名称、MIME、大小、hash、标签和时间，不公开绝对路径。
- REST 提供表情包列表、base64 上传、标签编辑、删除和按 ID 取图。取图只由库内 ID 解析，不能传任意路径；媒体状态合并表情包数量/上限。媒体页展示总开关与 Vision/生图/改图/ASR/TTS 配置状态、执行只落盘的 TTS 测试，并提供表情包上传、预览、标签与删除。
- 主人命令 `/tts <文本>`、`/say <文本>`、`/sticker [标签]` 只作用于当前聊天。`/tts` 默认最多 300 字符；`/sticker` 在匹配标签中随机选择。媒体发送前显式检查 `access.canSend`，之后仍由媒体/出站服务执行能力开关和路径边界。
- 精确边界：表情包只支持面板手动上传、SHA-256 去重、人工标签和随机按标签发送；不会自动收集聊天图片、按语境/情绪选择、缩放转码或连接商城。无 `/sing`、自动语音策略、RVC、兼容 edits 之外的图片编辑、任意本地脚本/路径接口或 Agent 媒体工具；真实 QQ/provider 兼容性仍待 M7。

M7-c 增加 `generateImage(prompt,{size})` 与 `editImage(prompt,sourceRelativePath,{size})`；默认关闭，生成 POST `/images/generations` JSON，改图 POST `/images/edits` multipart；API Key 只从指定环境变量读取，改图地址/模型/env 留空沿用生成配置。提示词 1–1000 字符，尺寸白名单 256×256 / 512×512 / 1024×1024 / 1792×1024 / 1024×1792。源图复用发送服务的相对路径/realpath/普通文件/扩展名/大小校验；不接受任意本地路径。

结果仅接收受媒体大小限制的 PNG `data[0].b64_json`，JSON 另有 base64 展开加 64 KiB 上限；不获取任意返回 URL、不跟随 HTTP 重定向，不回显 provider 原始错误/字节/密钥。PNG 头尺寸每边≤1792、总像素≤1792×1024；沿用媒体 1–120 秒超时。生成目录也做 realpath 防逃逸，写入 `generated/<uuid>.png`，返回 `{ok:true,path,size}`；`path` 是媒体根内相对路径。

REST `POST /media/image/generate {prompt,size?}` 与 `/media/image/edit {path,prompt,size?}`、媒体页「生图/改图」只落盘并显示路径/错误，不自动发送 QQ，不新增任意图片上传/下载路由。`status.images.generate/edit` 只报 enabled/configured，字段完整不代表真实连接成功。主人命令 `/draw`、`/redraw`、`/image` 先过 access.canSend；前两者生成后调用 sendMedia，后者直接发送已有图片，三者均要求媒体/图片开关，成功不重复回复文本。不挂 Agent 工具。验证使用 fake fetch/FormData/临时文件，无真实 provider 或 QQ 验证；只支持 OpenAI 兼容 edits，无 mask 或其他图片编辑后端。

M7-k 在同一媒体服务新增 `saveFile({name,dataBase64})` / `listFiles()`。两者同时要求媒体总开关和 files 开关，禁用时抛出 `文件功能未启用`。上传校验安全 basename（1–120 字符）、FILE_EXTENSIONS、严格且规范的非空 base64 和解码大小；固定写入 `files/<timestamp>-<uuid8>-<safeName>`，mkdir + 根/目录 realpath 限定，拒绝 files 目录符号链接，`wx` 独占写入避免覆盖。列表只扫描 files 目录的普通文件，不递归、不跟随文件/目录符号链接，过滤扩展名和当前大小上限；按 mtimeMs 降序最多 500 项，totalBytes 统计全部合格文件。未创建目录返回空列表，不自动建目录。

REST 新增 `GET /media/files` → `{ok:true,items:[{path,name,size,at}],totalBytes}` 与 `POST /media/file/upload {name,dataBase64}` → `{ok:true,path,name,size}`；上传入口 `readBody(req,15*1024*1024)` 固定限制 JSON 体积，包含 base64 展开。path 只返回 `files/...` 相对路径，at 为 mtimeMs。MediaPage 文件区做客户端大小/扩展名预检、FileReader 去除 data URL 前缀、上传期间防重、成功刷新和独立错误显示，保留原媒体区。没有文件发送/删除/下载面板；发送继续走已有主人 `/file` 与身份/access/qqAdmin/媒体路径闸门。不新增外部调用、依赖或 QQ 发送；只验证离线临时文件、mock 面板及 fake 宿主，真实 QQ 未验证，#45 仍 partial。

### 3.20 B站公共内容（M5-b / M7-m）

- `src/modules/builtin/media-features/bilibili.js` 经核心窄 transport 调用 `api.bilibili.com` 的公开搜索、热门、视频详情与评论端点；规范化标题、作者、播放量、时长、完整 BV 号、数字 aid 与固定域名 url/shareUrl；标题移除搜索高亮 HTML，无效 BV 结果不生成链接。
- `comments(bvid, {limit=10})` 每次先查 view 取得有效 aid，缺失即报错；再以 type=1、oid=aid、sort=2、ps=1–20、pn=1 请求 `/x/v2/reply`。合并 top_replies/replies，置顶优先，按 rpid 去重并保留 API 顺序；规范化 author/content/like/at（ctime Unix 秒），去标签/控制字符、正文限 500 Unicode 字符，可附带一层楼中楼样本。无缓存或翻页。
- `share(bvid)` 受原有 enabled 开关控制，离线返回 `{url,bvid}`，不查询标题或确认视频存在；完整 BV 格式校验防止路径/查询拼接。
- `content.bilibili.enabled=false`，所以默认配置零网络；单次请求超时默认 15000ms（1000–60000ms），搜索/热门默认最多返回 5 条。请求只带 User-Agent/Referer，不携带 Cookie、不做 WBI 签名。HTTP、非零 code、登录要求或风控都返回明确错误，绝不伪造结果。
- 主人命令 `/bili hot|关键词|BV号`、`/bili comments BV号`、`/bili share BV号`；REST 为 `GET /content/bilibili?q=`、`GET /content/bilibili/hot`、`GET /content/bilibili/comments?bvid=&limit=`、`GET /content/bilibili/share?bvid=`；「模块 → 媒体功能」详情提供搜索、热门、结果卡、BV 评论查询及分享链接，原内容页保留入口指引。新增查询不注册 Agent 工具。
- B站接口与 §3.19 媒体 provider 独立；内容查询不会触发生图/改图或自动发送图片。
- 精确边界：仅公开评论与离线分享，不提供 B站字幕、登录态、WBI 或发布评论能力。QQ空间需要 QQ 登录授权且涉及平台授权/ToS，本里程碑明确未实现。没有通用动作总线；真实 B站与 QQ 行为仍待受控真机验证。

## 4. 数据目录

```
~/.dsh/plugins-data/dsh-bot/
├── config.json          # 配置（version 2，含 cognition.*）
├── models.json          # 模型 provider/selected/fallback（密钥不通过 API 回传）
├── events.jsonl         # 可选：事件持久化（events.persist=true 时）
├── logs/                # 可选：日志文件（logging.persist=true 时）
├── media/               # 可选：inbound/、outbound/、generated/、files/、stickers/ 与 stickers.json
├── modules/             # 外部模块、state.json、各模块 data.json 与 .builtin/<id>/{data,config}.json
└── cognition/
    ├── cognition.sqlite # 认知长期状态（WAL + FTS5；JSON fallback 为 cognition.json）
    └── raw-events.jsonl # 过滤前原始事件镜像（可关/可限制保留）
```

## 5. 复用与许可

- `src/onebot/client.js`、`src/core/store.js`、`src/core/redact.js`、`src/core/logger.js`、
  `test/helpers/mock-onebot.js` 移植/改写自 **aureth-labs/dsh-aurabot-qq**（MIT）；
  在 `THIRD_PARTY_NOTICES.md` 中保留版权与许可声明，并在文件头注明来源。
- OneBot v11 协议规范：<https://github.com/botuniverse/onebot-11>。
- SnowLuma / NapCat 只作为「外部网关地址」接入，不内置、不分发、不自动部署。


### 3.21 本地备份与恢复（M6-a）

`src/ops/backup.js` 提供 `createBackupService({dataDir,getConfig,logger})`，由 host 创建并注入 routes，卸载时 `dispose()` 为 no-op。全部操作只在插件数据根内进行，不需要新依赖或外部网络。

快照是**目录，不是 zip**：`<dataDir>/backups/<id>/manifest.json` 与 `files/<原相对路径>`。ID 为 UTC 时间戳加 8 位随机十六进制，例如 `20261106T120000000Z-deadbeef`。manifest v1 保存 id、createdAt、note、includeMedia、files（path/bytes/SHA-256）、总 bytes 与 excluded（相对路径及原因）。创建先写隐藏 staging 目录，全部复制成功后 rename 发布；超出字节/文件上限则清理 staging，不发布、不触发清理旧快照。

默认复制 `config.json`、`models.json`、`cognition/` 全部普通文件、`modules/`（包含清单、代码、状态、数据）和 `media/stickers.json`、`media/stickers/`；`includeMedia=true` 扩展为数据根内全部 `media/`。自定义 `media.dir` 位于根外时不会备份。任意层级的 logs/backups/restore-*、临时文件、符号链接及特殊文件排除；其余根级文件也不在白名单中。相对路径及每个既存源/目标路径分量都检查，恢复目标硬链接拒绝。使用同步 readdir 和有界文件描述符复制，在进程内串行执行；大快照会短暂阻塞事件循环，建议维护窗口操作。该检查不是针对恶意本地进程并发替换目录的系统级沙箱。

`ops.backup` 默认启用；200 MiB、5000 文件、10 份；仅 `prune=true` 才按 manifest 时间从旧到新清理有效快照。损坏/不完整快照不列入清单，不自动删除。列表只返回 `{id,createdAt,note,bytes,files,includeMedia}`，files 为数量，不公开绝对路径。

API 均位于 `/onebot-qq/api`：

| 方法与路径 | 请求 / 响应 |
|---|---|
| `GET /backup` | `{ok,status,items}`；status 为 enabled/maxSnapshots/maxBytes/allowRestore/snapshotCount |
| `POST /backup/create` | `{includeMedia?:false,note?:''}` → `{ok,item}`；note 最多 1000 字符 |
| `POST /backup/restore` | `{id,apply?:false}` → 默认 `{ok:true,requiresRestart:true,stagedPath:'restore-<id>'}` |
| `POST /backup/delete` | `{id}` → `{ok:true}` |

恢复先校验 manifest 版本/白名单路径/重复项/总大小、当前 maxFiles/maxBytes、源/目标及每份文件 hash，并复制到隔离暂存目录。默认 rename 成 `<dataDir>/restore-<id>/`，不会修改运行数据；已有同名暂存目录时拒绝覆盖。`apply=true` 仅在 `allowRestore===true` 时允许；先创建 `pre-restore:<id>` 备注的安全快照，失败则不应用，成功后再逐文件覆盖。应用成功才清理旧快照，并保护此次安全快照；应用失败保留安全快照。应用只覆盖列出的文件，不删除其它文件，不热加载配置或重启服务；不是全目录事务，途中 I/O 失败可能留下部分覆盖。

**SQLite 与运维边界**：服务不 checkpoint、不锁库，也不协调认知/模块等写入；在线文件复制不保证 SQLite/WAL 一致性。应先停止所有写入，再创建快照。推荐在面板暂存和检查，停止目标 DSH profile 后手动复制回原数据根，再启动；`apply=true` 仅适用于已停写的维护环境，应用后必须立即重启。自动化只用临时根和离线文件，未覆盖正在运行的 SQLite。

备份保留原始配置/模型密钥和认知隐私，必须按秘密保护；新建目录/文件尽可能使用 0700/0600（受平台权限语义影响），不做加密。面板继续使用 DSH 本地访问边界，本里程碑不新增 API 鉴权。备份无 zip、云端上传/下载、自动恢复、工作区迁移或离峰省钱策略；手动版本检查由 M6-b 独立服务提供。


### 3.22 安全页、上线清单与升级检查（M6-b）

`src/ops/upgrade.js` 的 `createUpgradeService({getConfig,logger,currentVersion,fetchImpl=globalThis.fetch})` 由 host 用 package.json 的 VERSION 创建、注入 routes 并暴露句柄；dispose 为 no-op。服务无启动请求、定时器、文件写入、下载或安装。`status()` 同步返回 `{enabled,channel,repo,current,cached,checkedAt}`，初始 cached/checkedAt 为 null；`GET /upgrade` 和 `/status.upgrade` 只读取它。

`ops.upgrade` 默认 `{enabled:false,channel:'stable',repo:'reina0721/dsh-bot',timeoutMs:10000,cacheMinutes:60}`，全部纳入默认值、规范化及面板字段表。`POST /upgrade/check` 调用 check({force=false})；禁用抛出「升级检查未启用」。启用后以 Node fetch、User-Agent/Referer 和 AbortSignal.timeout 请求固定 `https://api.github.com/repos/<repo>/releases?per_page=10`。stable 只接受 draft=false/prerelease=false，beta 仅放宽 prerelease 过滤；在这 10 条里选择版本最大项，无历史分页。tag/current 需满足 `v?x.y.z(-pre)?`，数字主/次/补丁比较、预发布标识排序、同版本预发布低于稳定版；不支持 build metadata。结果含 ok/enabled/channel/current/latest/updateAvailable/publishedAt/url 与可选 notes（最多 2000 字符）。

只缓存成功结果和 ISO checkedAt，内存缓存按 repo/channel/current 隔离，force 绕过，重启丢失；配置缓存分钟数对下一次请求生效。失败抛出真实 HTTP/超时/响应/版本错误，保留上次成功结果及时间，不延长有效期。状态读取不会触发刷新。无 token 支持，未认证 GitHub API 通常每 IP 每小时 60 次请求。

`SecurityPage` 进入页面或手动刷新时只读 `/status`、`/access/stats`、`/backup`、`/upgrade`，分别处理失败；唯一 POST 是手动升级检查（force=true）。五张卡为出站文本防泄漏（M7-i，只读 enabled/action，没有扫描内容/密钥）、访问控制（名单数量/拦截计数/最近 5 条审计）、危险面（raw action、allowRestore、同进程模块警告、媒体环境变量名）、上线检查（连接、allowlist+owner、备份、raw 关闭、媒体配置、人工模块审核）和版本信息。只按已保存配置检查媒体字段，不读取密钥或探测连通性；模块审核恒为人工待检查，不写入“已审核”状态。清单内按钮只导航 connect/config/backup，复用原有视觉组件，无独立向导。

精确边界：无自动检查/更新、下载/安装、云服务、工作区/格式迁移或离峰省钱；beta 仅改变 release 过滤。保留 DSH 本机信任边界，不改变 API 鉴权，也不新增本机-only/CSRF/可信反代机制。测试均使用注入 fetch 或禁网替身，没有真实 GitHub/QQ/浏览器验证。

### 3.23 主人 QQ 管理命令（M7-b）

`commands → qq-actions → gateway.actions` 显式映射资料/群管/精华/撤回动作；`/file` 走 `media.sendMedia(kind=file, relativePath)`。新增命令共享 `cognition.qqAdmin.enabled=false`；命令先核对 owner、当前会话类型与 `access.canSend`，服务再次检查 owner/config/类型/ID/长度。群号从当前 turn 取得；昵称仅主人私聊；不存在任意 action 名或参数透传入口，原 Agent 工具列表保持 3 项且群聊 0 项。

OneBot 参数按 [OneBot v11 公开 API](https://github.com/botuniverse/onebot-11/blob/master/api/public.md) 显式封装；`set_qq_profile`、`set_essence_msg` 与文件上传为网关扩展，支持情况取决于实现。昵称拒绝返回明确 unsupported。踢人强制字面量 confirm；撤回默认确认（可配置）；破坏性动作在调用前仅记录动作/操作者/会话/目标 ID，不记录文本或网关原始错误。精华/撤回先 get_msg 检查 message_type 与 group_id 或私聊目标；标准响应可能不提供归属字段，此时拒绝，不尝试跨聊推断。

媒体服务统一验证相对路径/根内 realpath、普通文件、扩展名和大小；不允许通过文件或目录符号链接访问媒体根外。上传路径由网关进程读取。自动化使用 fake 网关与本地临时文件，无网络；真实 QQ 管理/资料/文件动作未验证。逐项权限矩阵与通用审批仍未实现。2026-11-06 用户豁免范围见 [GAP §8.1](research/GAP-AURABOT.md#81-用户批准豁免)，不修改本机-only/CSRF 行为。

### 3.24 可选 embedding 检索（M7-f）

`cognition/index.js` 构造 `createEmbeddingService({getConfig,logger,fetchImpl})` 并仅注入 memory。`embeddings.js` 默认关闭，enabled/status 不联网；开启后只 POST 配置 base 下的 `/embeddings`，Bearer 密钥从环境读取，redirect=error，超时覆盖请求及 JSON 读取（`timeouts.callMs`）。输入每批 1–32 条、每条 1–4000 Unicode 字符；响应条数对应输入、每条 8–4096 维有限数、维度一致，标准 index 乱序会还原，错误不返回伪向量、不记录文本/秘密。模型+文本摘要键的内存 LRU 上限 2000，端点/密钥切换清空。

memory 保留同步 retrieve 的词法/FTS/关联与强化行为；retrieveAsync 先只读取 `max(3*limit,24)` 个词法候选（仍受现有 scope/person/300 行扫描/字符预算约束），按 query+31 候选分批求 cosine，零范数为 0。按 `(1-weight)*baseScore + weight*cosine` 重排并添加 `signals.embedding`，保留 memory 与原 signals，按 limit/字符预算选取，仅强化最终选中项一次。异常只记录固定 debug 文案，回退原 retrieve，不重复写入；等待中切换人格或候选已删除/编辑/强化则重新词法检索，避免恢复已删除记录或覆盖并发更新。pipeline handleTurn 与 proactivity tick 均 await retrieveAsync；主动任务当前空查询直接词法，UI/同步调用不变。

只支持 OpenAI 兼容 embeddings 重排，不含本地模型、独立 reranker、持久化向量或向量数据库，也不是全库向量召回。fake fetch/假 embedder 的离线服务及集成测试通过，真实 provider 未验证，GAP #31 保持 partial。


### 3.25 QQ 通知与主人请求审批（M7-j）

`index.observe` 在 enabled/ready、暂停和 accepted 门控后，优先分流已有 recall/poke/reaction，再同步交给 `createNoticeService`。十种已知通知经 ID/子类型/时长校验、字段白名单与安全文本处理写入当前人格 `timeline_event`；`nte_` hash 使用上游 time/selfId/规范字段，不用 clock.now 参与身份，clock.now 只记录接收时间。标题/正文限 200/500 Unicode 字符，正文同时写 text 以复用既有时间轴聚合；不复制 notice comment/flag/raw、文件 URL，不下载文件。normalize 额外保留 cardOld/cardNew/name/title 供通知服务使用。未知/meta 不进入认知，已有三条专项路径保持独立。

好友/群 add/invite 请求按 flag 的 SHA-256 截断 hash 生成 `req_`，在 scopedStore 写 `qq_request(status=pending,source=request)`；标准 friend 缺省子类型映射 add，群号仅群请求必填。flag 最多 256 UTF-16 单元且无控制字符，仅本地存储/固定网关 action 使用；comment 替换其中 flag、复用静态 redactText、去控制字符后限 500 Unicode 字符。公共投影只含业务字段与完成元数据，不返回 flag/raw；没有日志正文或原始网关异常。原事件缓冲/落盘边界不变，没有新增 PII 检测。

commands 注入 requests 服务，三个内置命令不能被模块覆盖；命令先检查 owner/access/requests.enabled，`/requests` 只列最多 10 条单行摘要，`/approve`、`/reject` 始终校验完整 ID + 字面量 confirm，服务再次校验 owner/pending/boolean/文本。成功固定调用 `gateway.actions.setFriendAddRequest(flag,approve,remark)` 或 `setGroupAddRequest(flag,subType,approve,reason)`，写 approved/rejected 与 resolvedAt/resolvedBy；网关失败只返回静态错误，仍 pending。同 ID 进程内 inFlight 防重；await 前固定 persona kind，切换人格不把完成状态写入新人格。不是分布式 exactly-once：网关超时应人工核实，跨人格复制也不产生新真实请求。

`cognition.notices.enabled`、`cognition.requests.enabled` 默认 true，经 DEFAULTS/normalize/配置字段保持热应用；关闭只停对应服务入口，不删除历史。PERSONA_DATA_GROUPS 和客户端增加 requests/请求（qq_request），支持统计/复制/删除。没有自动审批、通用审批/逐项权限、审批队列面板、新增请求 REST API 或 Agent 工具，真实 QQ 未验证；#3/#15 仍 partial。

### 3.26 主人本地提醒（M7-l）

`cognition/reminders.js` 的 `createReminderService({store,getConfig,access,clock,scheduler,outbound,logger})` 在 outbound 之后、commands 之前构建，由宿主在模块就绪后选择所有者并 start，默认使用 builtin-reminders，核心保留回退；dispose 在关闭 store 前清理定时器。只接收当前私聊/群聊、正安全整数 ID、主人、1–500 Unicode 字符和唯一的一次/重复时间；默认关闭。`add/list/cancel` 使用当前人格 store；`reminder` 归入 reminders/提醒数据组，支持统计/复制/删除。公开投影只含提醒字段，不暴露存储 kind。

`start()` 用注入 scheduler 的单次 setTimeout 自调度，await tick 完成后才排下一次；tick 的进程内 running 标记也阻止手动重叠。禁用时不读写提醒或发送，只保留配置轮询，便于热启用。每次按 nextAt 排序取最早到期的 20 条；模块将固定 text 交给 `api.delivery.send(...,source:'reminder')` → DeliveryService → outbound（核心回退保留 outbound 入口），复用 access → rate → leak guard → dryRun → gateway。服务没有任意代码、命令、LLM 或额外文件/网络执行入口；持久化只经 store，发送只经 outbound。

成功把一次提醒标 sent、重复提醒设 `nextAt=完成时刻+everySeconds`、计数加一并清空错误；错过的次数不回补。失败保持 active，仅允许固定公共错误码，其余归为 SEND_FAILED，`nextAt=now+max(60,minIntervalSeconds)`，避免紧循环。dryRun 视作成功。dispose 后不再写 store；await 前固定原人格 kind，完成时重读记录，已取消/删除不覆盖；切换人格后停止旧批次余项。不是分布式 exactly-once，网关超时或进程在发送/记账之间崩溃可能重复。

主人 `/remind`、`/reminders`、`/forgetreminder` 先检查 owner/access/开关；服务对创建和取消再校验 owner 与 scope。命令与提醒都走 outbound。没有提醒 REST API/管理面板、新 Agent 工具、自动审批、DSH jobs/长任务/LLM 任务执行；仅 fake clock/scheduler/gateway 与本地持久化测试，真实 timer/QQ 未验证，#8/#40 为 partial。
