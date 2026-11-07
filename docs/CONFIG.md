# 配置说明（CONFIG）

本文列出 `dsh-bot` 的**全部配置项**：路径、类型、默认值、取值范围、作用，以及配置文件位置、
保存/热应用规则和环境变量。配置项来源是 `src/core/config.js` 的 `DEFAULTS`（默认值）与
`CONFIG_GROUPS`（面板字段表）；面板表单完全按 `CONFIG_GROUPS` 数据驱动渲染。

模块 WebUI Phase 1 只增加配置归属元数据（[ADR-014](architecture/ADR-014-module-webui.md)），不新增配置值或迁移编辑器。reply-delivery、typing、reminders 的 UI binding 为 `legacy-core`、available:false，继续使用原 cognition.reply/typing/reminders 存储 key 与配置页；sample 为 `module-file`、available:true，仍用原模块行内编辑与独立配置文件。UI schemaVersion:1 是描述契约元数据，不改变全局配置版本或配置值 revision。`GET /onebot-qq/api/modules/ui` 不读取或返回配置值、字段表、默认值或路径；外部声明无法开启配置编辑。未来配置 UI 归属模块页时仍须保留现有存储 key。

> 结论先行：**没有任何写死的算法参数**。重连退避、超时、重试、核验缓冲、事件过滤、缓冲容量、
> 日志级别、面板刷新间隔……都可以在 `config.json` 或面板「配置」页修改；保存即热应用。

### 手动身份登记（M7-v，无新增配置字段）

此功能默认空，不增加 `DEFAULTS`、`CONFIG_GROUPS` 或环境变量字段。仅主人通过 `/identity` 命令手动维护，受既有访问控制和 `cognition.permissions.deniedCommands` 约束。记录独立保存在 `cognition/cognition.sqlite` 的全局 `manual_identity` kind（存储 fallback 时为对应 JSON），不随人格切换/复制/删除，也不进入既有人物 identity 迁移/查询。没有新增 HTTP/API 或面板；不创建、修改或合并人物、不自动验证/关联或路由消息，无 Telegram/Discord adapter。用法与校验规则见[用户手册](USER-MANUAL.md#手动跨平台身份登记m7-v)。

媒体功能现归默认启用的 `builtin-media-features`；六个原键 `content.bilibili.enabled/timeoutMs/maxResults`、`media.stickers.enabled/maxCount/maxBytes` 在「模块 → 媒体功能」详情编辑，元数据 `module:'builtin-media-features'`，仍使用原全局 config.json 和默认值，无迁移。模块停用则 `/bili`、`/sticker` 与相关 HTTP 操作关闭，无 core 回退；`/media/status` 继续报告可用性。媒体/图片父开关留核心，只以布尔状态投影给模块；贴纸还需两个父开关开启。Bilibili 操作 UI 位于模块详情，贴纸管理保留媒体页并按 provider 授权。详见 [ADR-015](architecture/ADR-015-builtin-media-features.md)。

## 1. 配置文件位置

| 用途 | 路径 |
|---|---|
| 默认数据目录 | `$DSH_HOME/plugins-data/dsh-bot/`（`$DSH_HOME` 默认 `~/.dsh`） |
| 配置文件 | `<数据目录>/config.json` |
| 事件落盘（可选） | `<数据目录>/events.jsonl`（`events.persist.enabled=true` 时） |
| 日志落盘（可选） | `<数据目录>/logs/<area>-<day>.log`（`logging.persist.enabled=true` 时） |
| 本地备份 | `<数据目录>/backups/<id>/manifest.json` + `files/`（目录快照，无 zip） |
| 恢复暂存 | `<数据目录>/restore-<id>/`，相对路径由 API 返回 |
| 模块 | 外部 `<数据目录>/modules/<id>/`，内置数据 `modules/.builtin/<id>/`；启停覆盖 `modules/state.json` |

在 Windows 上默认就是：

```
C:\Users\<你>\.dsh\plugins-data\dsh-bot\config.json
```

### 环境变量覆盖

| 变量 | 作用 |
|---|---|
| `DSH_HOME` | DSH 主目录，默认 `~/.dsh`；数据目录默认是 `<DSH_HOME>/plugins-data/dsh-bot` |
| `DSH_BOT_DATA_DIR` | **直接覆盖本插件的数据目录**（测试、便携部署、隔离验证用；设置后 `DSH_HOME` 不再参与拼路径） |
| `SNOWLUMA_DIR` | `snowluma.autoDetect` 探测安装目录时的候选之一（等价于额外填了一个 `snowluma.dir`） |

`scripts/verify-plugin.ps1` 就是靠 `DSH_BOT_DATA_DIR` 把验证用的配置写到 `verify-out/plugin-data/`，
不污染你的真实数据。

### 本地模块目录与状态

模块不是 `config.json` 配置项。内置使用包内静态注册表（builtin- 保留前缀），外部启动扫描 `<数据目录>/modules/<id>/module.json`，跳过 `.builtin`。默认关闭的 builtin-sample 可启停但不可直接重载；外部可重载，清单 enabled:false 是不可越过的启停上限。`modules/state.json` 原子保存 `{disabled,enabled}`，兼容旧 `{disabled}`；缺失/损坏按空状态，disabled 优先，enabled 只用于内置主动开启。状态写入失败不会改变运行状态。外部 data.json 在模块目录，内置在 `modules/.builtin/<id>/data.json`，均最大 1 MiB、包含在本地备份中。apiVersion 默认/仅支持 1，requires 为最多 16 项的本机模块依赖，不自动启用或下载。完整清单、依赖与安全边界见 [模块文档](MODULES.md)。

## 2. 读取、校验与保存规则

- **读取**：`config.json` 不存在时用 `DEFAULTS` 生成一份并写盘（让你能找到文件在哪）；
  存在时与 `DEFAULTS` 深合并后逐字段校验，缺失字段补默认值。
- **校验**：每个字段都有类型/取值校验。非法值**回退默认值**，并在保存/读取结果里给出可读的
  `issues`（面板会展示）。例如地址协议不合法会被清空并提示；数字会 clamp 到范围内；枚举值不认识
  会回退默认；数组会去重、去空、限制条数。
- **保存**：面板保存时按**全量配置**写回（`GET /config` 拿到当前配置 → 改几项 → `POST /config/save`）。
  宿主会重新规范化，然后原子写盘（先写临时文件再 rename），读方永远不会看到半个文件。
- **版本**：`version` 是内部字段（当前为 `1`）；配置版本与当前版本不一致时会补齐默认值并给出提示。
- **未识别字段**：不会进入持久化配置（以 `DEFAULTS` / `CONFIG_GROUPS` 为准）；升级插件后新增字段
  会自动补默认值。
- **热应用**：保存后立即生效，不需要重启 DSH。不同配置项的影响见 §5。

## 3. 配置项总表

「面板」列表示是否在 Web 面板的「配置」页出现（全部字段都可以直接写 `config.json`）。

### 3.1 基本（`basic`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `enabled` | switch | `true` | `true`/`false` | 插件加载后是否按当前配置自动连接；关闭后也可在面板手动「连接」 | ✅ |
| `gateway` | select | `"onebot"` | `onebot` / `snowluma` | 网关类型：`onebot` = 直接连你填的地址；`snowluma` = 只读 SnowLuma 安装目录的配置取地址 | ✅ |
| `botQQ` | text | `""` | 最长 32，自动去空白 | 机器人 QQ 号；非空时连上后调 `get_login_info` 核验账号，留空只展示不拦截 | ✅ |
| `accountCheck` | select | `"warn"` | `off` / `warn` / `enforce` | 核验不一致时的策略：不检查 / 只警告继续用 / 断开并暂停自动重连（`paused`） | ✅ |

### 3.2 连接地址（`endpoint`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `onebot.wsUrl` | text | `""` | `ws://` 或 `wss://` URL | 正向 WebSocket 地址，用于实时收事件（WS 也承载 action 的 echo 回包）；不合法会被清空 | ✅ |
| `onebot.httpUrl` | text | `""` | `http://` 或 `https://` URL | OneBot HTTP 服务端地址，用于调用发送/查询接口；留空则所有调用走 WS；不合法会清空并给 issue | ✅ |
| `onebot.wsToken` | secret | `""` | 最长 1024 | WS 的 access token；连接时以 `?access_token=` 附加到 wsUrl（规范认可的降级方式） | ✅ |
| `onebot.httpToken` | secret | `""` | 最长 1024 | HTTP 的 access token；携带方式见 `onebot.httpAuth` | ✅ |
| `onebot.httpAuth` | select | `"bearer"` | `bearer` / `header-token` / `query` | HTTP token 携带方式：`Authorization: Bearer`（标准、推荐）/ `X-Access-Token`（非标准）/ `?access_token=`（URL 参数） | ✅ |
| `reconnect.enabled` | switch | `true` | `true`/`false` | 断线后是否自动重连；关闭后断线停在 `disconnected` | ✅ |
| `reconnect.minDelayMs` | number | `2000` | 500–60000 ms | 首次重连等待时间 | ✅ |
| `reconnect.maxDelayMs` | number | `30000` | 1000–300000 ms | 重连等待上限 | ✅ |
| `reconnect.factor` | number | `2` | 1.1–5 | 每次重连失败后等待时间乘以该系数（指数退避） | ✅ |
| `reconnect.jitterRatio` | number | `0.2` | 0–1 | 等待时间抖动比例（0.2 = ±20%，避免多实例同时重连） | ✅ |

重连等待的实际值是 `clamp(minDelay × factor^失败次数, …, maxDelay)` 再叠加 ±`jitterRatio` 的随机抖动，
由 `src/onebot/client.js` 计算，全部取自以上配置。

### 3.3 SnowLuma 地址读取（`snowluma`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `snowluma.autoDetect` | switch | `true` | `true`/`false` | 自动在常见目录（`C:\SnowLuma`、`~/SnowLuma`、`%LOCALAPPDATA%\SnowLuma`、`Program Files` 等）与 `SNOWLUMA_DIR` 环境变量里找 SnowLuma | ✅ |
| `snowluma.dir` | text | `""` | 最长 1024 | SnowLuma 安装目录（含 `index.mjs` 与 `config/`）；含中文路径会提示不可用 | ✅ |
| `snowluma.uin` | text | `""` | 纯数字，最长 32 | 指定读取哪个账号的 `config/onebot_<uin>.json`；留空自动扫描所有 `onebot_*.json` | ✅ |

SnowLuma 模式只做**只读**解析：从 `config/onebot.json` 与 `config/onebot_<uin>.json` 的
`networks.httpServers[]` / `networks.wsServers[]` 读取 `enabled` / `host` / `port` / `path` / `accessToken`
（`0.0.0.0`/`::` 归一化为回环地址）。不下载、不启动、不注入、不修改 SnowLuma（其 EULA 限制自动化部署）。

### 3.4 超时与重试（`timeouts`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `timeouts.callMs` | number | `30000` | 1000–120000 ms | 单个 OneBot action 调用超时；大群/上传等慢接口可调大 | ✅ |
| `timeouts.connectMs` | number | `10000` | 1000–120000 ms | WS 握手超时；超时会主动关闭并按重连策略重试 | ✅ |
| `timeouts.verifyMs` | number | `10000` | 1000–120000 ms | 账号核验 `get_login_info` 的超时（不重试） | ✅ |
| `timeouts.probeMs` | number | `3000` | 1000–60000 ms（面板步进 500） | 面板「探测」按钮 HTTP 调用的超时 | ✅ |
| `timeouts.maxRetries` | number | `3` | 0–10 | 网络层错误的重试次数（业务错误/超时不重试，避免重复发消息） | ✅ |
| `timeouts.retryDelaysMs` | number-list | `[1000,3000,5000]` | 每个 0–600000 ms，最多 20 项 | 第 1/2/3… 次重试前的等待；实际次数取 `maxRetries` 与该列表长度的较小值 | ✅ |
| `verification.enabled` | switch | `true` | `true`/`false` | 连上后是否用 `get_login_info` 核验登录账号 | ✅ |
| `verification.bufferSize` | number | `100` | 10–1000（整数） | 核验期间暂存事件的条数上限，核验通过后按序补发；溢出丢弃最早的并计数 | ✅ |

### 3.5 事件（`events`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `events.enabled` | switch | `true` | `true`/`false` | 是否接收并缓存事件；关闭后事件被丢弃（原因 `disabled`） | ✅ |
| `events.bufferSize` | number | `200` | 10–2000（整数） | 内存事件环形缓冲条数 | ✅ |
| `events.includeSelfMessages` | switch | `true` | `true`/`false` | 是否包含机器人自己发的消息（网关需开启自身上报才会收到） | ✅ |
| `events.kinds.message` | switch | `true` | `true`/`false` | 消息事件开关 | ✅ |
| `events.kinds.notice` | switch | `true` | `true`/`false` | 通知事件开关（撤回/戳一戳/群成员变化等） | ✅ |
| `events.kinds.request` | switch | `true` | `true`/`false` | 请求事件开关（加好友/加群） | ✅ |
| `events.kinds.meta_event` | switch | `true` | `true`/`false` | 元事件开关（心跳/生命周期；噪声大时可关） | ✅ |
| `events.messageSubTypes.private` | switch | `true` | `true`/`false` | 私聊消息开关 | ✅ |
| `events.messageSubTypes.group` | switch | `true` | `true`/`false` | 群聊消息开关 | ✅ |
| `events.ignoreUsers` | string-list | `[]` | 字符串数组，每项最长 64，最多 500，自动去重 | 忽略这些 QQ 号的消息/通知 | ✅ |
| `events.ignoreGroups` | string-list | `[]` | 同上 | 忽略这些群的消息 | ✅ |
| `events.rawMaxBytes` | number | `16384` | 1024–262144 bytes | 原始事件 `raw` 字段的截断上限（超出转成 `{__truncated,bytes,preview}`），防止超大消息撑爆内存 | ✅ |
| `events.persist.enabled` | switch | `false` | `true`/`false` | 事件是否追加写入 `events.jsonl` | ✅ |
| `events.persist.file` | text | `"events.jsonl"` | 文件名（非法字符替换为 `_`） | 事件落盘文件名 | ✅ |
| `events.persist.maxMB` | number | `32` | 1–512 MB | JSONL 文件超过该大小时轮转成 `.1`（只保留一份旧档） | ✅ |

过滤顺序（`src/core/events.js`）：`events.enabled` → 事件 kind 开关 → 消息子类型开关 →
`includeSelfMessages` → `ignoreUsers` → `ignoreGroups`。被丢弃的事件会按原因累计到
`GET /status` 的 `events.droppedReasons`（`disabled/kind/subType/self/ignoreUser/ignoreGroup/invalid`）。

### 3.6 日志（`logging`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `logging.level` | select | `"info"` | `debug` / `info` / `warn` / `error` | 日志级别；低于该级别的日志不进缓冲/不落盘 | ✅ |
| `logging.bufferSize` | number | `500` | 50–2000（整数） | 日志环形缓冲条数（面板「日志」增量拉取的数据源） | ✅ |
| `logging.persist.enabled` | switch | `false` | `true`/`false` | 是否按天写 `<数据目录>/logs/<area>-<day>.log` | ✅ |
| `logging.redact` | switch | `true` | `true`/`false` | 日志/错误文本脱敏开关；默认开启，关闭仅建议本机排障 | ✅ |

### 3.7 界面偏好（`ui`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `ui.refreshMs` | number | `2000` | 500–60000 ms | 面板状态轮询间隔（客户端还会 clamp 到 500–60000） | ✅ 系统设置 → 数据与刷新 |
| `ui.eventPageSize` | number | `50` | 10–500 | 「消息」页事件列表每页条数 | ✅ 系统设置 → 数据与刷新 |
| `ui.logPageSize` | number | `100` | 10–500 | 「日志」页每页条数 | ✅ 系统设置 → 数据与刷新 |
| `ui.accent` | select | `"purple"` | `purple` / `blue` / `green` / `orange` / `inherit` | 面板强调色（品牌色/选中态/焦点环）；`inherit` 跟随 DSH 主题黑白 | ✅ 外观 |
| `ui.contrast` | select | `"system"` | `system` / `standard` / `high` | 面板对比度；`system` 跟随 `prefers-contrast`，`high` 加强边框/文字对比 | ✅ 外观 |
| `ui.density` | select | `"standard"` | `compact` / `standard` / `comfortable` | 控件高度与面板内距 | ✅ 布局与字号 |
| `ui.fontScale` | select | `"standard"` | `small` / `standard` / `large` | 面板字号缩放（93.75% / 100% / 112.5%） | ✅ 布局与字号 |
| `ui.contentWidth` | select | `"wide"` | `standard` / `wide` / `auto` | 内容最大宽度：72rem / 100rem / 铺满 | ✅ 布局与字号 |
| `ui.motion` | select | `"system"` | `system` / `full` / `reduced` / `off` | 动效策略；`system` 跟随 `prefers-reduced-motion`，`reduced`/`off` 将动画时长降为 0.01ms | ✅ 动效 |
| `ui.pageTransition` | select | `"default"` | `default` / `fade` / `fade-slide` / `fade-up` / `fade-down` / `none` | 顶层标签内容切换动画；`配置`/`系统设置` 恒为淡入，分类切换恒为 `content.swap` | ✅ 动效 |

外观偏好全部由客户端消费、在「系统设置」页按分类展示并**每次修改即时保存**（不需要重连，也不会改变连接行为）；
后端只负责枚举校验与持久化。`ui.motion` 与系统 `prefers-reduced-motion` 是双重约束：`system` 跟随系统，
`full` 显式覆盖系统偏好，`reduced` / `off` 始终降级。默认值、选项与帮助文案都来自服务端 `CONFIG_GROUPS`，
客户端不写死。

> **主题不在此表**：浅色 / 深色 / 跟随系统由 DSH 自己的 `theme` 偏好持有；「系统设置 → 外观」只是调用
> 客户端公开的 `theme.setTheme()` 并订阅 `theme/change`，因此与 DSH 自带外观设置双向同步，不会产生第二份主题配置。

### 3.8 安全（`security`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `security.allowRawAction` | switch | `false` | `true`/`false` | 允许面板通过 `POST /onebot-qq/api/action` 透传任意 OneBot action；仅调试用，默认关闭 | ✅ |
| `security.leakGuard.enabled` | switch | `true` | `true`/`false` | 认知统一出站文本密钥检查（M7-i）；关闭后原样通过 | ✅ |
| `security.leakGuard.action` | select | `redact` | `redact` / `block` | 命中后用 `[REDACTED]` 替换或拒绝整条消息（`LEAK_BLOCKED`） | ✅ |

M7-i：只在 `outbound.deliver` 的访问控制、限频检查通过后扫描 text 段；dry-run 也扫描但不发送，block 命中优先返回失败。检查本地执行，无外部调用；配置每次读取，非法/缺失值回退启用 + redact。识别 OpenAI `sk-`（后缀至少 20 字符）、GitHub `gh[pousr]_`（后缀至少 20 字符）、AWS AKIA、Bearer（至少 16 字符）、PEM 私钥（含截断块）、`api_key=` / `apiKey:`（值至少 16 字符）。重叠匹配合并为一次替换；不提供匹配值或位置，日志只有类别/次数。

单次文本扫描与一次消息所有 text 段总长度上限均为 100,000 个 UTF-16 单元；超限时全部 text 段整体脱敏或整条阻止，不能只扫描前缀。成功脱敏返回 `leakGuard: "redacted"`，阻止计入 outbound `leakBlocked`；限频检查仍执行，阻止不记为成功发送（既有配额按 sent 统计）。网关异常对调用者、policy 与日志统一使用固定 `send_failed`，不转发原始错误。

安全页只读展示开关/策略，没有扫描内容/密钥。此检查不是统一审批或逐项权限；无 PII/熵检测，可能误报/漏报，逐段扫描不重组跨段或跨消息的密钥。非文本段原样保留，不扫描媒体 base64 或文件；媒体服务及面板手动 `/send`、raw action 等独立路径不经此 guard。

### 3.9 媒体（`media`）

媒体和全部外部 provider 默认关闭；只有总开关及对应子开关同时开启才会下载或调用网络。API Key 字段填写的是环境变量名（如 `OPENAI_API_KEY`），不是密钥。

| 路径 | 默认值 | 作用 |
|---|---|---|
| `media.enabled` | `false` | 媒体总开关 |
| `media.maxBytes` | `10485760` | 单文件上限，1024–104857600 bytes；入站下载、本地文件上传/列表/下载、TTS/生图/改图输出、改图源和发送均检查；本地删除不受大小限制 |
| `media.dir` | `""` | 留空为 `<数据目录>/media`；可指定自定义目录 |
| `media.stickers.enabled` | `true` | 启用本地表情包库；QQ 发送仍要求 `media.enabled` 与 `media.images.enabled` 同时开启 |
| `media.stickers.maxCount` | `200` | 表情包最多 1–5000 个；默认 200 |
| `media.stickers.maxBytes` | `5242880` | 单个表情包 1024–52428800 bytes；默认 5 MiB |
| `media.tts.maxChars` | `300` | 面板和 `/tts` 单次文本上限，1–5000 字符 |
| `media.images.enabled` | `false` | 允许图片入站下载与 `sendMedia` 发送 |
| `media.images.visionEnabled` | `false` | 调用 OpenAI 兼容 `/chat/completions` 生成简短图片描述 |
| `media.images.visionBaseUrl/visionModel/visionApiKeyEnv` | `""` | Vision 根地址、模型、API Key 环境变量名 |
| `media.images.generateEnabled` | `false` | 独立开启生图，仍要求 media.enabled |
| `media.images.generateBaseUrl` | `""` | 生图 OpenAI 兼容 API 根地址 |
| `media.images.generateModel` | `"gpt-image-1"` | 生图模型；仅在启用时使用 |
| `media.images.generateApiKeyEnv` | `""` | 生图 API Key 环境变量名，不保存密钥 |
| `media.images.generateSize` | `"1024x1024"` | 默认请求尺寸，限下列五种 |
| `media.images.editEnabled` | `false` | 独立开启改图，仍要求 media.enabled |
| `media.images.editBaseUrl` | `""` | 改图 OpenAI 兼容 API 根地址；留空沿用 generate 对应配置 |
| `media.images.editModel` | `""` | 改图模型；仅在启用时使用；留空沿用 generate 对应配置 |
| `media.images.editApiKeyEnv` | `""` | 改图 API Key 环境变量名，不保存密钥；留空沿用 generate 对应配置 |
| `media.images.editSize` | `"1024x1024"` | 默认请求尺寸，限下列五种 |
| `media.audio.asrEnabled` | `false` | 下载 record 并调用 `/audio/transcriptions`；默认模型 `whisper-1` |
| `media.audio.asrBaseUrl/asrModel/asrApiKeyEnv` | `""` / `"whisper-1"` / `""` | ASR 根地址、模型、API Key 环境变量名 |
| `media.audio.ttsEnabled` | `false` | 调用 `/audio/speech`，输出 MP3；不自动发送 |
| `media.audio.ttsBaseUrl/ttsModel/ttsVoice/ttsApiKeyEnv` | `""` / `"tts-1"` / `"alloy"` / `""` | TTS 根地址、模型、音色、API Key 环境变量名 |
| `media.files.enabled` | `false` | 允许白名单扩展名的文件入站下载、本地上传/列表/下载/删除和 OneBot 文件上传 |

允许扩展名：图片 `jpg/jpeg/png/gif/webp/bmp`；语音 `mp3/wav/ogg/m4a/aac/amr/silk`；文件 `txt/md/json/csv/pdf/doc/docx/xls/xlsx/ppt/pptx/zip/7z/rar`。网络超时沿用 `timeouts.callMs`。

本地文件（M7-k）：上传和列表均要求 `media.enabled=true` 与 `media.files.enabled=true`，关闭时返回 `文件功能未启用`。`POST /onebot-qq/api/media/file/upload` 接受 `{name,dataBase64}`，JSON 请求体固定上限 15 MiB（含 base64 展开和元数据）；所以即使调高 `media.maxBytes`，面板/API 仍受此请求体上限约束。名称必须是 1–120 字符的安全 basename（字母、数字、点、下划线、空格、连字符），扩展名使用上述文件白名单。只接受非空、规范的严格 base64，不接受 data URL；解码后受 `media.maxBytes` 限制。文件写入 `<media root>/files/<timestamp>-<uuid8>-<safeName>`，M7-u 起长名称保留扩展名、缩短名称主体，使存储 basename 含前缀不超过 120 字符；独占创建，不覆盖；校验根/目录 realpath，拒绝 files 目录符号链接。

`GET /onebot-qq/api/media/files` 只列固定 `files/` 目录内符合扩展名/大小限制的普通文件，不递归、不跟随符号链接；目录尚未创建时返回空列表。返回 `{ok:true,items:[{path,name,size,at}],totalBytes}`，path 为 `files/...` 相对路径、at 为修改时间毫秒数，最新优先最多 500 项；totalBytes 统计全部合格文件，包含未显示项。上传返回 `{ok:true,path,name,size}`。M7-u 面板增加本地下载和确认删除，操作期间禁用文件按钮/上传/刷新，失败显示错误 toast；发送仍由主人 `/file 相对路径` 完成，另需 `cognition.qqAdmin.enabled` 与访问许可，无发送按钮，真实 QQ 文件兼容性未验证。

本地下载/删除（M7-u，未发布）：`GET /onebot-qq/api/media/file/download?name=<存储basename>` 返回 `{ok:true,name,size,mime,dataBase64}`，dataBase64 为规范严格 base64，浏览器转 Blob 并以列表显示名称保存；不返回二进制流。`POST /onebot-qq/api/media/file/delete` 接受 `{name}`，返回 `{ok:true,name,removed:true}`。name 必须是列表 path 去掉 `files/` 后的完整存储 basename，≤120 字符，与上传同字符/扩展名白名单；拒绝路径分隔符、绝对/Windows 路径、控制字符及目录/符号链接，仅访问 real files 目录中的普通文件，不接受任意本地路径。两者均要求 media.enabled/files.enabled；下载还受 media.maxBytes 约束，使用不跟随符号链接的句柄与有界读取；超大普通文件仍可删除。缺失文件返回 `{ok:false,message:"文件不存在"}`，不回显本机绝对路径；读取和删除不会创建目录。旧存储 basename 超过 120 字符时安全拒绝新操作，不自动迁移或重命名。无新配置/依赖、外部调用或自动发送，默认关闭不变。#45 仍 partial，矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变。

生图/改图（M7-c）：`generateImage(prompt,{size?})` POST `/images/generations` JSON（model/prompt/size/n=1/response_format=b64_json）；`editImage(prompt,path,{size?})` POST `/images/edits` multipart（image/prompt/model/size/response_format=b64_json）。提示词 trim 后 1–1000 字符；size 仅 `256x256`、`512x512`、`1024x1024`、`1792x1024`、`1024x1792`。仅接收 `data[0].b64_json` PNG，不获取 provider 返回 URL，也不跟随 provider HTTP 重定向；生成结果受 `media.maxBytes` 限制，PNG 头尺寸每边最多 1792、总像素最多 1792×1024；JSON 响应另限 base64 上限加 64 KiB 元数据。输出为媒体根内 `generated/<uuid>.png` 相对路径。

改图源只接受媒体根内相对路径、允许的图片扩展名和大小内普通文件，realpath 同时约束源文件及生成目录，拒绝绝对/Windows/控制字符/`..` 路径与符号链接逃逸。不会做图片转码、mask 或本地编辑，只提交 OpenAI 兼容 edits。`timeouts.callMs` 在媒体调用中限制到 1000–120000ms；密钥只从环境读取，provider 请求/响应错误不回显原始内容。`status().images.generate/edit` 分别给出 enabled/configured；configured 只判断字段完整性，不读取密钥或验证连通性。面板和 REST 只落盘；QQ `/draw`、`/redraw`、`/image` 发送还需 `images.enabled`，并先通过主人身份及 access.canSend。真实 provider/QQ 生图改图未验证，各 provider 的模型、尺寸和字段兼容性需自行受控验证。

### 3.9.1 公共内容（`content.bilibili`）

B站公共内容默认关闭，因此默认配置不会发起网络请求。支持公开搜索、热门、视频基本信息与公开评论，以及离线分享链接；不使用 Cookie/WBI 或登录态，不含字幕或发布评论。评论若要求登录或受风控限制会明确报错，真实 B站接口未验证。

| 路径 | 默认值 | 取值 / 范围 | 作用 |
|---|---|---|---|
| `content.bilibili.enabled` | `false` | `true`/`false` | 启用 `/bili`、模块详情 B站面板和 B站 REST 查询（还需模块启用） |
| `content.bilibili.timeoutMs` | `15000` | 1000–60000 ms | 单次公开接口超时 |
| `content.bilibili.maxResults` | `5` | 1–20 | 搜索/热门最多返回条数 |

评论使用 `GET /content/bilibili/comments?bvid=&limit=`（API 前缀 `/onebot-qq/api`），`limit` 默认 10、取整并限制为 1–20，与 `maxResults` 独立；先读取视频详情中的有效 aid，再请求第一页公开评论，置顶优先、按 rpid 去重、保留 API 顺序，正文最多 500 Unicode 字符。`GET /content/bilibili/share?bvid=` 仅校验完整 BV 格式并生成固定域名链接，不联网、不验证视频存在；也受 enabled 开关控制。评论无缓存、无翻页，只含接口自带的一层楼中楼样本。

QQ空间没有配置项：它需要 QQ 登录授权并涉及平台授权/服务条款，本版本明确未实现。

### 3.10 访问控制（`access`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `access.mode` | select | `open` | `open` / `allowlist` | `open` 保持现有行为；`allowlist` 只放行主人、操作员与白名单 | ✅ |
| `access.ownerQQ` | text | `''` | 数字 QQ 号 | 主人 QQ；`allowlist` 下识别主人私聊/主动目标 | ✅ |
| `access.ownerName` | text | `主人` | ≤32 字 | 面板/审计显示的主人称呼 | ✅ |
| `access.operators` | string-list | `[]` | QQ 号列表，最多 500 项 | 固定只读操作员；主人优先，allowlist 放行其私聊，群仍需白名单 | ✅ |
| `access.private` | string-list | `[]` | QQ 号列表 | 非主人私聊白名单 | ✅ |
| `access.groups` | string-list | `[]` | 群号列表 | 群白名单；群内任何人可触发 | ✅ |
| `access.auditSize` | number | `100` | 0–1000 | 内存审计环形缓冲条数；只存元数据，不存正文 | ✅ |

`access` 是增量字段，老配置由 `deepMerge` 自动补齐，不需要迁移脚本；默认 `open` 保证升级后行为不变。
`allowlist` 但 `ownerQQ` 为空时不会出现「人人可私聊」：私聊只按操作员与白名单放行，且 `normalizeConfig` 会给出 issue。

**只读操作员（M7-r）**：在「配置 → 访问控制」设置 `access.operators`，默认空列表不改变升级行为。规范化与 `access.private` 一致：必须是数组，转字符串、去空白/去重、单项最多 32 字符、最多 500 项；非法非数组忽略。主人即使列在其中也仍为主人，`isOperator` 返回 false。allowlist 的操作员私聊入站与出站原因均为 `operator`；不赋予群白名单或主人权限。

操作员内置命令固定为 `/help`、`/status`、`/model`（无参数，只读）、`/bili`、`/groupinfo`、`/memberinfo`。模型设置/清除、管理/请求/提醒/steer/记忆/目的/点赞/戳/媒体/文件等其他命令及未知命令均静默；群/成员查询只作用于当前允许群。公开模块命令仍按模块 `ownerOnly:false` 开放，默认 `ownerOnly:true` 不因操作员身份放行。`deniedCommands` 同样约束操作员，命中静默；`/help` 只展示操作员集与公开模块。仅 QQ 命令入口与两个只读 QQ 查询服务的受限档位，无完整 per-tool/per-action RBAC、admin/approval 档位或统一审批；面板/API/Agent 工具保留原有边界。#13 partial，#14 仍 partial，remaining 47。


### 3.11 会话运行时（`runtime`）

| 路径 | 类型 | 默认值 | 取值 / 范围 | 作用 | 面板 |
|---|---|---|---|---|---|
| `runtime.engine` | select | `oneshot` | `oneshot` / `agent` | 回复由一次性 LLM 还是 DSH Session 生成 | ✅ |
| `runtime.workspaceDir` | text | `''` | 路径；空 = 数据目录/runtime/workspace | DSH Session 工作区 | ✅ |
| `runtime.replyTimeoutMs` | number | `120000` | 5000–600000 | 等 Agent 完成一轮的上限；超时只放弃等待 | ✅ |

`agent` 需要宿主提供 `sessionController` / `workspaceRegistry` / `agents`；缺失或失败自动回退 `oneshot`。
`oneshot` 下配置不影响现有回复链路。

M7-o 主人 `/steer 文本` 沿用上述 `runtime.engine=agent` 和已有 Session 服务，不新增配置字段，也不写配置。文本 1–1000 Unicode 字符，注入当前私聊/群聊 Session；oneshot/服务缺失时不可用，宿主必须提供 `agent.steer`。可用现有 `cognition.permissions.deniedCommands` 的 `steer` 禁用此命令。没有自动插话或插话面板/API；M7-q 私聊输入状态独立配置，见下文。真实 DSH/QQ 未验证，#9 仅 partial。

### 3.12 内部字段

| 路径 | 类型 | 默认值 | 作用 | 面板 |
|---|---|---|---|---|
| `version` | number | `2` | 配置版本号，用于升级时补齐默认值；不要手改 | — |

### 3.13 认知（`cognition`）

认知字段按功能分为 11 个面板组（`GET /config` 的 `groups` 中 id 为 `cog-*`），全部持久化、可恢复默认、
即时生效，不需要重连。完整字段/类型/范围/默认值以 `GET /onebot-qq/api/config` 的 `groups[].fields` 为准；
下表列出负责行为的核心项。

| 组 | 代表字段 | 默认值 | 作用 |
|---|---|---|---|
| `cog-core` | `cognition.enabled` / `dryRun` / `paused` | `true` / `false` / `false` | 总开关、演练（完整决策但不发送）、暂停（保留状态） |
| `cog-llm` | `llm.mode` / `fallbackToDsh` / `provider` / `model` / `dailyTokenBudget` / `budgetScope` / `personaDailyTokenBudget` / `analysisMaxTokens` / `composeMaxTokens` / `modelRouting.*` | `auto` / `true` / `""` / `""` / `300000` / `global` / `300000` / `1800` / `800` / 空 | LLM 只做分析与表达；`auto` 继承 DSH 失败兜底，`direct`/`chain` 使用「模型」页直连；`modelRouting` 按聊天覆盖 provider/model，优先级：会话覆盖 > 私聊/群默认 > 全局路由 |
| `cog-turn` | `turn.privateBaseMs` / `privateMaxMs` / `groupMaxMs` / `groupReplyMode` / `groupReplyProbability` / `groupCooldownMs` / `groupMaxRepliesPerMinute` / `maxConsecutiveGroupReplies` | `1800` / `10000` / `9000` / `addressed` / `0.2` / `3000` / `6` / `3` | 碎片聚合软/硬等待；群聊参与方式（仅@/概率/所有消息）及冷却/频率上限；旧 `addressedOnlyGroups` 仍兼容映射 |
| `cog-reply` | `reply.split` / `maxChars` / `maxParts` / `delayMs` / `quote` / `atSender` / `notice.patReply` / `patCooldownMs` | `true` / `300` / `3` / `600` / `true` / `false` / `true` / `60000` | 长回复分条、引用与群聊 @；拍一拍回应与冷却；分条中途失败不回滚 |
| `cog-purpose` | `purpose.enabled` / `injectPrompt` / `promptLimit` / `maxActive` | `true` / `true` / `3` / `5` | 长期目标/计划/意图；注入少量高优先级目的；面板与 `/purpose` 管理 |
| `cog-persona` | `persona.traits` / `style` / `values` / `evolutionEnabled` / `evolutionPerDay` | 见默认值 | 12 维稳定人格、6 维表达风格、价值边界；最长每日小步慢演化。**文本人设（名字/背景/性格/风格/喜好/边界）存在认知 persona 记录，不在此表** |
| `cog-emotion` | `emotion.halfLifeMinutes` / `regulation` / `expressiveness` | `–` | 情绪惯性/衰减/调节、外显阈值；模拟状态 |
| `cog-relationship` | `relationship.inertia` / `conflictGain` / `repairRate` / `maxDeltaPerTurn` | `–` | 多维有向关系；冲突升快降慢、单轮变化有上限 |
| `cog-memory` | `memory.retrievalTopK` / `maxContextChars` / 权重项 / `consolidateEvery` / `embedding.*` / `consolidation.enabled` / `hour` / `reflect` / `reflectMinEpisodes` | `8` / `4000` / `0.3` 等 / `25` / `true` / `4` / `true` / `10` | 工作/情景/语义/关联检索、遗忘≠删除、私聊隔离；每日整理与按作用域反思 |
| `cog-policy` | `policy.proactive` / `silenceThreshold` / `replyThreshold` / `groupPenalty` / `dailyGlobalLimit` / `perChatGroup` | `false` / `0.3` / `0.52` / `0.1` / `120` / `10` | 候选动作效用 + Beta 后验 + 结果归因；沉默/等待是一等动作；旧 `policy.groupAmbient` 只作兼容映射，不再显示 |
| `cog-learning` | `learning.enabled` / `autoResearch` / `minConfidence` / `maxSources` / `dailyTokenBudget` / `sources` | `true` / `false` / `0.3` / `5` / `20000` / built-in off | 未知检测、学习任务、多来源证据、claims；默认只检测，外部检索需显式开启与许可 |
| `cog-privacy` | `privacy.privateIsolation` / `retentionDays` / `redactSecrets` / `deleteCascade` | `true` / `–` / `true` / `true` | 私聊隔离、保留期、密钥脱敏、删除人物级联清理画像/关系/记忆 |
| `cog-proactivity` | `proactivity.enabled` / `maxPrivatePerDay` / `quietStart` / `quietEnd` / `backoffHours` / `minFamiliarity` | `false` / `1` / `23` / `8` / `24` / `0.5` | 主动私聊；默认关闭，开启后仍受安静时段、日预算、关系门槛、退避限制 |

### LLM 每日预算与今日用量

两项用量始终独立记录：全局 `llm_usage` 由所有人格共享，人格 `llm_usage_persona` 只属于请求开始时的当前人格。分析（analysis）与回复（reply/compose）计入两项用量；学习预算另在 `cog-learning`（`cognition.learning.dailyTokenBudget`）配置。

| 配置 | 默认 | 含义 |
| --- | --- | --- |
| `cognition.llm.dailyTokenBudget` | `300000` | 全局每日 token 预算，保留原有默认值和语义 |
| `cognition.llm.personaDailyTokenBudget` | `300000` | 人格每日 token 预算，1000–5000000，各人格使用同一个限额配置 |
| `cognition.llm.budgetScope` | `global` | `global` 仅约束全局；`persona` 仅约束人格；`both` 两项均约束，有效剩余取最小 |

三项字段均在「认知 → 设置 → 模型路由与预算（cog-llm）」编辑。省略新字段保持原来的全局约束行为；人格计数仍持续记录，因此切换模式不会重置用量。非法新字段回退默认并产生 issue。面板配置限额范围为 1000–5000000；服务层遇到预算 0 视为耗尽，不表示无限制。

「今日 LLM 预算」卡片显示当前模式、UTC 日期、全局与当前人格的已用/预算/剩余和各自进度，以及当前模式有效剩余。达到 80% 提醒，受约束的预算耗尽时返回 `BUDGET_EXHAUSTED`；未参与约束的行标为「仅跟踪」。超额用量保留真实数值，进度最多 100%，剩余最少 0。刷新读取最新已保存配置和计数，不调用模型。

- `GET /onebot-qq/api/cognition/llm/usage` 返回 `{ok,date,scope,global,persona,effectiveLeft,exhausted,binding,personaId}`；`global` / `persona` 含 `{usageToday,budget,budgetLeft,exhausted}`，`persona` 另含 `personaScoped:true`。`binding` 是决定有效剩余的约束（`both` 模式相等时为 `both`）。
- `POST /onebot-qq/api/cognition/llm/usage/reset` 必须携带 `{confirm:true,scope:'global'|'persona'|'both'}`；只删除服务器当前 UTC 日期的相应记录。人格范围始终为当前人格，客户端日期/人格/token 字段均忽略。返回 `{ok,reset:true,removed:{global,persona},...用量状态}`，未删除的项为 false，重复重置安全。
- 卡片提供「重置全局今日」「重置当前人格今日」两个确认按钮；取消不发请求。重置不修改限额、模式、人格或配置，其他日期不变，重置人格用量不影响其他人格。重置不调用模型，不撤销供应商费用；执行中的请求仍可能稍后记账，归属请求开始时的人格。当前实现按完成记账时的 UTC 日期记录，未提供并发请求的预算预留。

恢复全局 `llm_usage` 的存储语义，移除中间实现的 `migrateLlmUsage` 及启动调用，不再搬走旧全局数据；新增人格计数从首次记录开始。已运行过中间实现而留下的 `persona_*:llm_usage` / 迁移标记保留原样，不读取、不自动合并或重建历史计数，避免重复记账。两项预算计数都不参与人格数据组复制；删除人格仅清除其 `llm_usage_persona`，全局用量保留。布局与状态见[卡片设计](design/llm-budget-card.md)。

### 私聊输入状态（M7-q）

`cognition.typing` 默认 `{enabled:false}`，`enabled` 仅接受布尔值；关闭时零输入状态调用，保持原行为。在「认知 → 设置 → 轮次与防抖」（`cog-turn`）打开「私聊输入状态」，仅对私聊/C2C 生效，不依赖 agent 运行时，群聊不发送。

网关提供 `actions.setInputStatus` 时，在处理轮次前等待 `set_input_status` 的 `{user_id: String(chatId), event_type: 1}`，并在 `finally` 等待 `event_type: 2`（暂停）；命令提前返回或处理异常也会尝试暂停。两次调用均捕获所有异常，不改变回复/原处理异常，也不记录原始网关异常或聊天 ID；不支持此 action 的网关继续原流程。等待受既有网关超时/重试配置约束，可能增加轮次耗时。

仅使用网关私聊扩展：`user_id` 必须是无前导零、无空白/非数字的正安全整数字符串，最多 20 字符；`event_type` 必须为整数 1（输入中）或 2（暂停）。不加入统一 outbound、sendMedia 或手动发送 API。现有入站 `input_status` 通知仍忽略；没有群聊 typing/群 `set_input_status`、输入状态限频或专用状态面板（只有配置开关）。仅离线 fake 网关测试，真实 QQ 未验证。GAP #9 为 steer + 私聊 typing，仍 partial、remaining 47，#31/#42/#49/#50 不变，未完成全量验收。

### 群聊词法相关度门控（M7-p）

在「认知 → 设置 → 轮次与防抖」（`cog-turn`）配置 `cognition.turn.groupRelevance`，默认 `{enabled:false, minScore:0.15}`，关闭时保持原行为。`enabled` 只接受布尔值；`minScore` 为 0–1，超界夹取，非有限/非法数值回退 0.15。

仅检查群聊未点名消息，顺序固定为：仅点名模式 → 概率命中 → 每分钟上限 → 连续接话上限 → 同群冷却 → 可选词法相关度 → 分析。点名/回复/唤醒词绕过相关度检查，仍受既有每分钟上限约束；私聊不受影响。

分数取已检索记忆 `signals.relevance` 的最大值并夹取 0–1；缺失/非有限信号时，用当前文本与记忆摘要（无摘要则正文）的词法重合比例，中文单字/二元组、英文忽略大小写。最多检查 32 条，每段文本最多 4000 UTF-16 单元。无记忆（即使阈值为 0）或分数低于阈值时，调用既有 `skipGroup`，仍编码 ambient 记忆，`lastTurn.reason` / `groupSkippedByReason` 记录 `low_relevance`，不进入分析/回复 LLM；计算异常放行。

门控不新增外部调用，不使用综合检索分数、embedding 或 LLM 语义分数；既有检索仍先运行，单独启用的 embedding 重排行为不变。词法重合可能误判，尚无 LLM 话题判断或接梗，GAP #20 仍 partial，remaining 47。

### 可选语义检索（`cognition.memory.embedding`，M7-f）

在「认知 → 设置 → 记忆」配置；默认关闭，无 embedding 网络请求。启用后会把查询及当前人格、可见作用域的候选记忆文本发送到所配 provider，失败回退原词法检索。只支持 OpenAI 兼容 `/embeddings`；无本地模型、独立 reranker 或向量数据库。自动化只用 fake provider，真实 provider 未验证，GAP #31 仍 partial。

| 字段（前缀 `cognition.memory.embedding.`） | 类型 | 默认 | 约束/含义 |
|---|---|---|---|
| `enabled` | boolean | `false` | 是否开启异步检索的 embedding 重排 |
| `baseUrl` | string | `""` | HTTP(S) API base，如 `https://embedding.example/v1`，追加 `/embeddings`；不允许 URL 凭据、查询或 fragment，不跟随重定向 |
| `model` | string | `text-embedding-3-small` | 模型名，最多 200 字符 |
| `apiKeyEnv` | string | `""` | Bearer 密钥的环境变量名，最多 128 字符；密钥不写入配置 |
| `weight` | number | `0.35` | 规范化到 0–1；最终分数 `(1-weight)*词法基础分 + weight*cosine` |

`enabled()/status()` 不联网；configured 仅判断 base/model/环境变量名字段完整性，不验证密钥存在或连通性。调用时读取环境密钥，超时沿用 `timeouts.callMs`。每批 1–32 条、每条 1–4000 Unicode 字符；返回向量须为 8–4096 维有限数且维度一致。内存 LRU 最多 2000 项，按模型/文本缓存，端点或密钥切换后清空，不持久化向量、不记录正文/密钥。

同步 `retrieve()`、面板查询保持原词法行为。pipeline 和主动任务使用 `retrieveAsync()`；空查询/无候选不调用 provider（主动任务当前查询为空）。词法候选限额为 `max(3*请求条数,24)`，仍受既有作用域、人物、300 行扫描及字符预算限制；每批最多 query+31 候选。仅重排这些候选，不是全库向量召回；最终不超过请求条数和字符预算，调用失败按原词法行为回退，不重复强化记忆。旧 `memory.semanticIndex` 保留兼容，不控制此开关。

### 导入旧档案（cognition.import，M7-d）

「配置 / 认知设置 → 导入旧档案」（`cog-import`）提供以下字段：

| 字段 | 默认值 | 范围/作用 |
|---|---|---|
| `cognition.import.enabled` | `true` | 允许面板/API 导入；关闭后返回明确错误 |
| `cognition.import.maxBytes` | `5242880` | 1–5242880 字节，按档案字符串 UTF-8 大小计算；面板固定最多 5 MiB |
| `cognition.import.maxItems` | `5000` | 1–5000 项；包括无效项与重复项；JSONL 按非空行计数 |

`POST /onebot-qq/api/cognition/import` 接收 `{kind?:"memory"或"timeline", format?:"auto"或"json"或"jsonl", content:字符串, scopeType?:"global"或"private"或"group", scopeId?:字符串}`；HTTP 请求体上限 6 MiB。默认全局作用域，但始终属于**当前人格**；各项可覆盖作用域，私聊/群 ID 必须是非空 ASCII 数字字符串。接口沿用现有本机 API 信任边界，不新增鉴权或 QQ 命令。

默认 `kind=memory`，原记忆导入规则不变：JSON 数组、`memories/items/data/records` 包装或单个记忆对象，JSONL 每个非空行一个对象。正文依次读取 `text/content/summary/memory` 中第一个字符串，去除首尾空白后限 1–4000 Unicode 字符；`personId` 可选字符串，最多 64 字符。类型限 `episodic/semantic/emotional/social/procedural/self`，未知类型用 episodic；数值 importance 限制到 0–1，默认 0.5。createdAt/updatedAt 支持毫秒时间戳或 ISO 日期，非正数/无效/未来时间回退，updatedAt 不早于 createdAt。固定 source=import、status=active、stability/salience=0.5、confidence=1，不保留其他字段。旧档案格式与操作示例见 [用户手册](USER-MANUAL.md#36-目的与记忆整理)。

M7-h 新增 `kind=timeline`：JSON 数组、`events/timeline/items/data/records` 数组包装或单个事件对象，及 JSONL；带 `kind:"timeline"` 的单项仅在时间轴模式接收。正文取 `text/detail/summary/content/title` 中第一个字符串，trim 后限 1–2000 Unicode 字符；可选 title 为 1–200 字符，personId 为最多 64 字符的字符串。时间按 `at/timestamp/time/createdAt` 取首个非 null 值，必须提供；支持毫秒数或 ISO 日期，无效/非正/未来时间回退为本次导入时间。type/kind 统一规范为 event，记录存储为 timeline_event；固定 source=import、status=active、createdAt/updatedAt=at，只保留规范字段。事件以作用域/personId/at/正文生成独立 `tle_` ID，重复导入跳过而不覆盖；无效时间回退后再参与 ID 计算，跨时刻重导此类数据可能产生新事件，建议修正原时间。

成功响应为 `{ok,kind,format,bytes,total,imported,skipped,invalid,scope}`。两种导入共用上述配置及限额；无有效项则报错，无效项计入 invalid。时间轴支持 `types=turn,memory,decision,event`，默认全部，事件随当前人格隔离并纳入「时间轴事件」数据组。

导入服务不联网、不调用模型、不自动发送 QQ；错误不回显内容，日志仅计数。只支持通用 JSON/JSONL，无 Aurabot 专用迁移或向量导入；尚无真实旧档案样本验证，#30 仍 partial。

按聊天选模型：`cognition.modelRouting.privateDefault` / `groupDefault` 为 `provider/model`；`routes` 是
`QQ号或群号=provider/model` 的字符串数组，优先于默认项。只影响认知分析与回复生成（oneshot / agent compose），
不修改 DSH 面板默认模型；`/model` 命令会写这个数组。provider 在直连 provider 列表里时走直连，否则走 DSH。

认知数据位置（与平台配置分离）：

```text
<dataDir>/cognition/cognition.sqlite       # 长期状态（WAL + FTS5 + 事务；JSON fallback）
<dataDir>/cognition/raw-events.jsonl       # 可选原始事件镜像（过滤前）
<dataDir>/cognition/cognition.sqlite.bak   # 备份目标
```

支持 Node.js 22.13+ 的 `node:sqlite`；不可用时自动回退为 `cognition.json`，接口保持同一套。
升级不会重置认知状态。

**DSH 模型一次性调用**：`system` 走 `GenerateOptions.system`，`messages` 只放 identity-free user input；
必须带稳定 `sessionId`（OpenCode Go 需要 `x-opencode-session`）；默认不向 DSH route 发送
`temperature`（`cognition.llm.dshTemperature` 才显式发送）。
`POST /cognition/llm/test` 返回真实 route、延迟、失败 attempts 与 provider message，用于区分
“没有 API key / 模型不可用 / 参数不支持”。

**文本人设 / 多人格**：每条 `persona` 记录的 `profile` 字段（`displayName/tagline/identity/background/personality/speakingStyle/likes/dislikes/boundaries/examples`）
由「人格」页编辑，存在认知 SQLite；旧记录读取时补空 profile。多份人格用 `persona.activeId` setting 记录当前激活项，
切换后下一轮消息生效；旧 `self` 自动成为默认人格。文本 profile 优先于数值 style，但不能覆盖安全/隐私边界。

当前人格的 `profile.displayName` 同时用作侧栏入口与概览页标题；为空时回退到 QQ 登录昵称，再回退到 `dsh-bot`。显示名称去控制字符、去首尾空白，最多 40 个 Unicode 字符；改名或切换人格后页头随 `/status.brand` 更新，侧栏需刷新网页。

**人格级认知数据**：存储层会用 `persona_<id>:` 前缀隔离记忆/人物/关系/情绪/策略/学习/技能/诊断记录；
`setting/persona/state/raw_event/turn/audit_log` 保持全局；LLM 用量按人格隔离（迁移说明见上文）。旧数据在启动时迁移到默认人格，
迁移标记为 `setting.persona.dataMigration.v08`；人格页的「复制数据」调用 `POST /cognition/persona/data/copy`，
按数据组单向替换目标人格。

**人格导入**：`POST /cognition/persona/import` 接受 `persona-import@1`：
`{name, profile, traits, style, values, locked, source, activate}`；服务端重新 sanitize/截断，
设置为 active；不覆盖 `self`。`scripts/import-aoi-persona.mjs` 用于把外部蒸馏包转换成该格式。

### 3.14 模型网关（`models.json`）

模型 provider 与密钥**不放在 `config.json`**，避免 `/config` 回传；它们存在单独的文件，由「模型」页
和 `/onebot-qq/api/models/*` 管理：

```text
<dataDir>/models.json       # provider/selected/fallback；原子写；密钥字段不通过 API 返回
<dataDir>/models.json.bak   # 写入备份
```

支持的协议：`openai-completions`、`openai-responses`、`anthropic-messages`、
`gemini-generate-content`、`ollama-chat`。预设：OpenAI、OpenAI Responses、Anthropic、DeepSeek、
OpenRouter、OpenCode Go（OpenAI/Anthropic）、Command Code（OpenAI/Anthropic）、Gemini、Ollama、Custom。
完整字段、端点、认证、安全与实测见 [MODEL-GATEWAY.md](MODEL-GATEWAY.md)。

- 密钥优先级：环境变量（`apiKeyEnv`/fallback）> 本地保存的 `apiKey`；API 只返回后四位/来源。
- 修改 `models.json`/provider 不需要重连 QQ；即时影响下一次 LLM 调用。
- 删除 provider 会清除 selected；不会自动删除已产生的认知状态。
- 恢复默认 config 不会删除模型 provider；需要在模型页显式删除。

## 4. 默认 `config.json` 全文

首次启动/恢复默认后写出的内容（也是 `GET /onebot-qq/api/config` 的 `defaults` 字段）：

```json
{
  "version": 2,
  "enabled": true,
  "gateway": "onebot",
  "botQQ": "",
  "accountCheck": "warn",
  "onebot": {
    "wsUrl": "",
    "httpUrl": "",
    "wsToken": "",
    "httpToken": "",
    "httpAuth": "bearer"
  },
  "snowluma": {
    "autoDetect": true,
    "dir": "",
    "uin": ""
  },
  "reconnect": {
    "enabled": true,
    "minDelayMs": 2000,
    "maxDelayMs": 30000,
    "factor": 2,
    "jitterRatio": 0.2
  },
  "timeouts": {
    "callMs": 30000,
    "connectMs": 10000,
    "verifyMs": 10000,
    "probeMs": 3000,
    "maxRetries": 3,
    "retryDelaysMs": [1000, 3000, 5000]
  },
  "verification": {
    "enabled": true,
    "bufferSize": 100
  },
  "events": {
    "enabled": true,
    "bufferSize": 200,
    "includeSelfMessages": true,
    "kinds": { "message": true, "notice": true, "request": true, "meta_event": true },
    "messageSubTypes": { "private": true, "group": true },
    "ignoreUsers": [],
    "ignoreGroups": [],
    "rawMaxBytes": 16384,
    "persist": { "enabled": false, "file": "events.jsonl", "maxMB": 32 }
  },
  "logging": {
    "level": "info",
    "bufferSize": 500,
    "persist": { "enabled": false },
    "redact": true
  },
  "ui": {
    "refreshMs": 2000,
    "eventPageSize": 50,
    "logPageSize": 100,
    "accent": "purple",
    "contrast": "system",
    "density": "standard",
    "fontScale": "standard",
    "contentWidth": "wide",
    "motion": "system",
    "pageTransition": "default"
  },
  "security": {
    "allowRawAction": false,
    "leakGuard": { "enabled": true, "action": "redact" }
  },
  "media": {
    "enabled": false,
    "maxBytes": 10485760,
    "dir": "",
    "images": { "enabled": false, "visionEnabled": false, "visionBaseUrl": "", "visionModel": "", "visionApiKeyEnv": "" },
    "audio": { "asrEnabled": false, "asrBaseUrl": "", "asrModel": "whisper-1", "asrApiKeyEnv": "", "ttsEnabled": false, "ttsBaseUrl": "", "ttsModel": "tts-1", "ttsVoice": "alloy", "ttsApiKeyEnv": "" },
    "files": { "enabled": false }
  },
  "content": {
    "bilibili": { "enabled": false, "timeoutMs": 15000, "maxResults": 5 }
  }
}
```

> 认知 `cognition` 字段较长（约 100 项，按 `cog-*` 分组），在此不完整展开；`GET /onebot-qq/api/config`
> 返回的 `defaults.cognition` 是唯一权威默认值，`groups` 里带类型/范围/说明，面板按同一份规范渲染。

## 5. 保存后哪些改动会触发重连

`src/gateway/manager.js` 的 `applyConfig(prev, next)` 会比较一个「需要重建连接」的键集合：

| 配置 | 保存后的行为 |
|---|---|
| `enabled`、`gateway`、`botQQ`、`accountCheck`、`verification.enabled` | 需要重建连接（正在运行时自动重连） |
| `onebot.*`（wsUrl/httpUrl/wsToken/httpToken/httpAuth） | 需要重建连接 |
| `snowluma.*`（autoDetect/dir/uin） | 需要重建连接 |
| `reconnect.*`、`timeouts.*`、`events.*`、`logging.*`、`ui.*`、`security.*`、`media.*`、`content.*`、`ops.*`、`verification.bufferSize`、`cognition.*` | **不重连**，各模块每次使用时现取配置，立即生效；`ui.*` 由「系统设置」页即时保存并立即重渲染面板；`cognition.*` 由「认知 → 设置」即时保存 |
| `enabled: false` → `true`（保存时） | 自动建立连接（与「启用并自动连接」字段语义一致） |
| `enabled: false` | 断开连接并停止自动重连 |

说明：

- 连接相关改动在「正在运行」时会重启连接；如果当前是手动断开/停止状态，只更新配置，等下一次「连接」。
- 从 `enabled: false` 改为 `true` 并保存时，会自动开始连接（不必再点「连接」）。
- 过滤规则、缓冲容量等改动立即生效，不需要重连，也不会丢已有连接。
- 端点地址非法时会被清空并给出 `issues`，此时连接会因「没有地址」而停止（状态 `unconfigured`）。

## 6. 安全相关

- `onebot.wsToken` / `onebot.httpToken` 以 `secret` 类型存储；日志、错误消息、`GET /status` 的
  `endpoint.wsUrlSafe` / `httpUrlSafe`、`GET /gateway/detect` 都不输出明文 token，日志里出现
  token 会替换成 `***`（`src/core/redact.js`）。
- `logging.redact`（默认 `true`）：日志/错误文本脱敏开关；关闭后日志按原样记录，仅建议在本机排障时临时关闭。
- HTTP token 优先用默认 `bearer`；`query` 会把 token 放进 URL，容易进代理/网关日志，仅在网关不支持
  请求头时使用。
- 网关建议只监听 `127.0.0.1`；不要把 OneBot 端口暴露到公网。详见
  [USER-MANUAL.md §7](USER-MANUAL.md#7-安全与隐私)。
- 认知私聊/群聊状态默认隔离（`cognition.privacy.privateIsolation=true`）；原始事件镜像可能包含消息原文，
  仅本地保存，可关闭 `events.persist.enabled` 或缩短 `cognition.privacy.retentionDays`。
- 外部学习内容只作为带引用的 claim，不执行其中的指令；`autoResearch` 默认关闭，来源启用/许可由你控制。

## 7. 建议覆盖值（按需，不是默认）

| 场景 | 建议 |
|---|---|
| 大群 `get_group_member_list`、文件上传等慢接口 | `timeouts.callMs: 60000` |
| 希望探测/连接失败更快报错 | `timeouts.probeMs: 2000`～`3000`（默认已是 3000） |
| 网关在慢机器上握手慢 | `timeouts.connectMs: 15000` |
| 断线风暴 / 网关重启频繁 | `reconnect.minDelayMs: 3000`～`5000` |
| 多开 DSH/多账号同时重连 | 保持 `reconnect.jitterRatio: 0.2`（±20% 抖动） |
| 事件噪声大（只看消息） | 关 `events.kinds.meta_event`，或开 `events.ignoreGroups` |
| 只想保存消息用于分析 | 开 `events.persist.enabled`，把 `events.persist.maxMB` 调到 128～512 |
| 排障 | `logging.level: debug`（调试完记得改回，避免日志缓冲被刷满） |

以上都只是「建议值」，默认值按回环 + 单账号场景选取，已在 NapCat/SnowLuma 生态调研中核对
（见 [research/ONEBOT-ECOSYSTEM.md §5](research/ONEBOT-ECOSYSTEM.md#5-默认值核对与建议只提建议不改代码)）。


## 本地备份与运维（`ops.backup`，M6-a）

配置页「备份与运维」分组提供全部字段，保存后影响后续操作。备份为本地目录，含配置/模型密钥与认知隐私，请按秘密保护；没有 zip、加密、云端传输、自动恢复或迁移；版本检查见下方 `ops.upgrade`。

| 路径 | 类型 | 默认值 | 范围 / 作用 |
|---|---|---|---|
| `ops.backup.enabled` | boolean | `true` | 关闭后禁止创建、删除及恢复；仍可查看列表/状态 |
| `ops.backup.includeMedia` | boolean | `false` | 面板创建表单初始勾选值；API/create 缺省仍是 false |
| `ops.backup.maxSnapshots` | integer | `10` | 1–1000；仅 prune=true 时清理最旧的有效快照 |
| `ops.backup.maxBytes` | integer | `209715200` | 1–10737418240 bytes；默认 200 MiB，单份文件内容总量上限（不含 manifest）；恢复也校验当前上限 |
| `ops.backup.maxFiles` | integer | `5000` | 1–100000；单份普通文件数量上限；恢复也校验 |
| `ops.backup.prune` | boolean | `true` | 创建成功后清理旧快照；应用恢复成功后清理并保护恢复前快照；失败时保留安全快照，可能暂超保留数 |
| `ops.backup.allowRestore` | boolean | `false` | 只有严格 true 允许 apply=true；默认只暂存到 restore-<id>/ |

默认内容：`config.json`、`models.json`、全部 `cognition/` 普通文件、`modules/`（清单/代码/状态/数据）、`media/stickers.json` 和 `media/stickers/`。`includeMedia=true` 只额外包含数据根内全部 `media/`，不会跟随外部 `media.dir`。任意层级日志目录、backups、restore-*、临时文件、符号链接、特殊文件和根外文件始终排除。临时文件包括 .tmp/.temp/.swp/.swo/.part/.partial（及带后缀版本）、~ 开头/结尾、编辑器 # 文件和 .staging-*。

复制 SQLite 前必须停止所有写入，在线快照不保证数据库一致性。恢复不热应用配置；推荐暂存后停 DSH、手动复制、再启动。应用需先在停写维护环境开启 allowRestore，服务先创建恢复前备份；覆盖中途失败可能只恢复部分文件，需用安全快照离线处理。详见[用户手册](USER-MANUAL.md#备份)。


## 手动升级检查（`ops.upgrade`，M6-b）

配置页「备份与运维」分组提供全部字段；默认关闭，不安排轮询，不下载/安装。`GET /onebot-qq/api/upgrade` 与 `/status` 中的 `upgrade` 只读内存状态，即使启用也不联网。仅 `POST /onebot-qq/api/upgrade/check` 发起检查，body 可为 `{ "force": true }` 绕过缓存；禁用时返回 `ok:false` / `升级检查未启用`。

| 路径 | 类型 | 默认值 | 说明 / 范围 |
|---|---|---|---|
| `ops.upgrade.enabled` | boolean | `false` | 允许手动检查；默认零升级网络请求 |
| `ops.upgrade.channel` | enum | `stable` | stable 排除 draft/prerelease；beta 仅允许预发布 release，不改变运行行为 |
| `ops.upgrade.repo` | string | `reina0721/dsh-bot` | GitHub `owner/repo`，只允许仓库名字符；非法值回退默认仓库 |
| `ops.upgrade.timeoutMs` | integer | `10000` | 1000–120000 ms；Node fetch + AbortSignal.timeout |
| `ops.upgrade.cacheMinutes` | integer | `60` | 0–10080 分钟，0 不复用；只缓存成功结果，重启丢失 |

请求固定 GitHub API `/repos/<repo>/releases?per_page=10`，在返回的最近 10 条里按通道过滤，再按版本取最大值；没有分页扫描全部历史。只接受 `v?x.y.z(-pre)?`，比较数字主/次/补丁与预发布标识（预发布低于同版本稳定版）；不支持 build metadata。notes 最多 2000 字符，不执行内容。无 token 支持，未认证 GitHub API 通常每 IP 每小时 60 次请求，手动强制检查也计入。HTTP、超时、空列表、非法版本均返回真实错误，不产生伪造结果；失败后仍保留上次成功结果及其时间，不刷新缓存有效期。更换 repo/channel 后旧结果不显示，按当前缓存分钟数判断是否复用。

状态形状为 `{enabled,channel,repo,current,cached,checkedAt}`；初始 cached/checkedAt 为 null，checkedAt 是最近成功检查的 ISO 时间。cached 为检查结果 `{ok:true,enabled:true,channel,current,latest,updateAvailable,publishedAt,url,notes?}`，latest 保留 release tag 的 v 前缀。安全页只展示媒体 provider 环境变量名；配置完整性不验证密钥是否存在或 provider 能否连通。面板/API 保持 DSH 本机信任边界，不新增 API 鉴权或远端访问防护，不提供自动更新、工作区迁移或离峰省钱策略。

## 命令禁用列表（M7-n）

| 路径 | 类型 | 默认值 | 规范化 |
|---|---|---|---|
| `cognition.permissions.deniedCommands` | string[] | `[]` | 只接受数组；每项必须为匹配 `^[a-z][a-z0-9_-]{0,31}$` 的字符串，去重后按输入顺序最多保留 100 个 |

本机面板的配置页「命令权限」（`cog-permissions`）的「禁用命令」为 `string-list`。例如填 `kick`、`draw` 或模块命令名，不带 `/`；大写、空白、非字符串、过长等非法项忽略并报告 issue，非数组回退空列表并报告，超过 100 个不同有效名也报告。默认空列表不改变行为，保存后后续命令读取当前策略。

现有身份检查后、派发前，内置与已注册模块命令按解析后的小写名称检查；命中时主人收到「该命令已被操作员禁用。」，回复仍走统一 outbound，不调用命令服务/模块 handler 或写配置。非主人命中时静默，包括模块显式开放的命令；未禁用的公开模块命令保留原行为。未知/未注册命令保持原有提示，`/help` 按主人/只读操作员档位显示帮助，不标记禁用状态；操作员档位见[访问控制](#310-访问控制access)。整个命令名被禁用，不能按子命令或参数区分；`tts` 与 `say` 等独立注册名需要分别列出。

仅覆盖 QQ 文本命令入口，不约束 REST API、直接服务调用、Agent 工具或模块同进程代码；与 M7-r 固定只读操作员档位（#13）共同构成受限入口控制，仍不是所有服务/工具的逐项 allow/deny 矩阵或统一审批。#14 仍 partial，remaining 47；#31/#42/#49/#50 不变。

## QQ 管理命令（M7-b）

配置页「QQ 管理命令」（`cog-admin`），保存后热应用：

| 路径 | 类型 | 默认 | 范围/作用 |
|---|---|---|---|
| `cognition.qqAdmin.enabled` | boolean | `false` | 主人资料、群管、精华、撤回、文件命令总开关；不影响原点赞/戳/查询命令 |
| `cognition.qqAdmin.requireApproval` | boolean | `false` | 校验后将十种 QQ 管理/文件命令写入主人审批队列；关闭时直接执行，既有 confirm 要求保留 |
| `cognition.qqAdmin.requireConfirm` | boolean | `true` | `/recall 消息ID confirm` 的确认要求；关闭后撤回可省 confirm；踢人始终要求字面量 confirm |
| `cognition.qqAdmin.maxText` | integer | `100` | 1–100 Unicode 字符；昵称/名片/群名不能为空，不接受控制字符；网关可有更严限制 |

仅主人命令，不挂新增 Agent 工具，不接受任意 action。群管仅当前群，机器人须有相应管理员/群主权限；`/profile` 仅主人私聊，网关拒绝 `set_qq_profile` 时返回 `UNSUPPORTED_SET_QQ_PROFILE`。精华/撤回先查询消息所属会话，缺少归属字段则拒绝。禁言为整数分钟 0–43200（0 解除）。`/file` 还要求 `media.enabled` 和 `media.files.enabled`，仅媒体根内相对路径，拒绝绝对路径、`..` 和符号链接逃逸；沿用扩展名/大小限制。真实 QQ 管理、资料和文件动作尚未验证。


## QQ 管理审批（M7-s）

在「配置 → QQ 管理命令」开启 `cognition.qqAdmin.requireApproval=true`（严格布尔值，默认 `false`）。开启后，`profile/card/groupname/admin/mute/wholemute/kick/essence/recall/file` 在当前命令参数校验通过后只写入待办，不执行 QQ 动作；踢人和默认撤回仍须先提供原命令的 `confirm`。关闭此开关保留原直接执行行为，点赞/戳/查询及其他非管理命令不受影响。

主人 `/approvals` 查看最新最多 10 条 pending（完整 ID、动作、脱敏单行参数摘要、原聊天及已等待秒数）。用 `/approve apr_完整ID confirm` 批准并向原聊天重放固定管理命令，或 `/reject apr_完整ID confirm` 拒绝；字面量小写 `confirm` 始终必需。`apr_` 后为 32 位随机十六进制；`req_` 仍走既有好友/群请求处理，与 `cognition.requests.enabled` 独立。非主人（含只读操作员）静默。

审批保存于认知数据库全局 `qq_admin_approval`，跨重启/人格切换保留，不随人格复制；只保存固定动作、0–300 Unicode 字符参数、聊天/发起者数字 ID、状态与时间元数据，不复制原事件/凭据等额外字段。控制字符和既有 leak guard 识别的疑似密钥会拒绝，避免持久化密钥或改写待执行参数。最多 50 条 pending，满额拒绝新建；创建后 10 分钟失效，读取/列出/处理及创建时将过期 pending 持久化为 expired。列表、拒绝和已批准记录不触发自动执行。

批准先持久化 approved，再通过 `handleAdmin` 向原聊天重放；重新检查当前主人、原聊天访问、总开关、命令禁用列表、参数与既有 QQ/媒体限制。结果发往原聊天，审批状态回给批准者；完成记为 executed/failed，拒绝记为 rejected，附处理人/处理时间。未知、过期、重复处理均安全报错；同 ID 并发也只执行一次。失败或批准后进程中断不会自动重试，超时/中断须人工核实实际 QQ 状态，必要时重新发起命令。外部 turn 的 approvalBypass 字段会移除，仅内部批准重放能旁路再次排队。

仅离线 fake QQ 测试，没有审批 HTTP 路由、审批面板或新增 Agent 工具；不是所有服务/工具的统一审批，无 PII/媒体/文件内容扫描。#15 为持久化管理审批 + 原请求确认 + 文本 leak guard，仍 partial；#14 操作员档位/命令 deny-list 仍 partial。矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47，真实 QQ 未验证。

## QQ 通知与请求（M7-j）

配置页「回复与出站」中保存后热应用（与原 `cognition.notice.patReply` 独立）：

| 路径 | 类型 | 默认 | 范围/作用 |
|---|---|---|---|
| `cognition.notices.enabled` | boolean | `true` | 接受的已知通知记录到当前人格时间轴；关闭不影响原撤回/拍一拍/表态管线 |
| `cognition.requests.enabled` | boolean | `true` | 接收好友/群请求为待办，允许主人列出及显式确认处理；关闭后不接收/列出/处理，不删除已有记录 |

通知覆盖 `group_increase/group_decrease/group_admin/group_ban/group_card/group_name/group_title/essence/friend_add/offline_file`，只保留已验证 ID、子类型、时长、名片/群名/头衔和文件名等白名单字段；不保存通知 comment/flag、文件 URL 或 raw。标题最多 200、正文最多 500 Unicode 字符，控制字符移除、已知密钥模式脱敏；不下载离线文件。`nte_` ID 由上游时间、selfId 与规范字段生成，重复跳过；缺少时间时同字段通知会合并。未知通知/meta 不进入时间轴；仍受 cognition enabled、暂停和 accepted 门控。

请求只接受 friend（缺省子类型按 add）、group add/invite；userId 必填，群请求必须有 groupId。flag 为非空字符串，最多 256 UTF-16 单元，无控制字符，作为私密网关凭据留在 `qq_request` 中，不进入列表/回复/日志。comment 先替换其中的 flag、按既有密钥规则脱敏并去控制字符，再限 500 Unicode 字符；列表不提供 flag。无 PII/熵检测，QQ ID/备注仍属于本地隐私数据；原事件日志/缓冲的保留策略不变。

`/requests` 仅主人查看当前人格待办，最多 10 条；`/approve ID confirm`、`/reject ID confirm` 均始终要求小写字面量 confirm，不受 qqAdmin.requireConfirm 控制。身份与 access.canSend 先行，服务再次核对 owner/开关/pending/boolean；仅调用固定 `set_friend_add_request` 或 `set_group_add_request`，不挂 Agent 工具、不自动审批、不调用模型。服务 reason/remark 可为空，最多 100 Unicode 字符且无控制字符，命令暂不提供此参数。成功更新 approved/rejected、resolvedAt/resolvedBy；网关失败保留 pending，返回静态错误，不回显原始错误。请求按 flag 去重；当前进程同 ID 并发只调用一次。超时可能意味着网关已执行但未确认，人工核实后再重试。

请求纳入人格数据组「请求」，支持统计/复制/删除；复制待办不会自动处理，跨人格副本也不代表新的真实请求。没有审批队列面板或新增请求 REST API，没有统一审批/逐项权限。只用 fake 网关离线验证，真实 QQ 事件/审批兼容性未验证，#3/#15 保持 partial。

## 主人本地提醒（M7-l）

`cognition.reminders` 默认关闭。默认启用的 `builtin-reminders` 通过只读绑定沿用此配置，无独立模块配置；停用模块自动回退核心，提醒行与命令保持兼容，启用时交回模块，交接先停止旧调度器。模块 loaded 不代表提醒业务已开启。需配置 `access.ownerQQ`；只有主人能在当前聊天创建、列出或取消提醒。这里的配置字段沿用通用配置编辑器，没有提醒管理面板或提醒 REST API。

| 字段 | 默认值 | 范围/含义 |
|---|---|---|
| `enabled` | `false` | 只有严格 true 才启用创建与发送；关闭保留记录 |
| `maxActive` | `50` | 每人格活跃总数，1–1000，跨当前人格的私聊/群聊累计 |
| `minIntervalSeconds` | `60` | 重复间隔下限，60–2592000 秒 |
| `maxIntervalSeconds` | `2592000` | 重复间隔上限，至少为配置下限，最多 30 天 |
| `tickMs` | `30000` | 检查间隔，1000–3600000 ms，非精确到时保证 |

`/remind 3600 喝水` 表示每小时重复，`/remind 2099-01-01T09:00:00+08:00 新年提醒` 表示未来一次提醒；建议 ISO 时间明确带 `Z` 或时区偏移。服务也接受未来毫秒时间戳。必须且只能选择一种时间，文本为 1–500 个 Unicode 字符。群聊/私聊 ID 必须为正安全整数；相同作用域/原文/一次时间或重复间隔的活跃提醒拒绝重复。

数据为当前人格 `reminder`，含 scopeType/scopeId、text、at/everySeconds/nextAt、active/sent/cancelled、createdBy/createdAt、sentCount、lastError。人格切换只检查当前人格；切回后过期活跃提醒会在下次 tick 处理；复制提醒数据组会复制活跃状态，目标人格激活后也会发送，需自行取消不需要的副本。关闭时 tick 不读写提醒、不发送，调度器保留轻量配置检查以支持热启用；服务支持关闭后直接取消，但 QQ 提醒命令均要求 enabled。

每次最多发送 20 条到期记录，全部经 outbound 的 access/rate/leak guard/dry-run；dry-run 成功也记 sent/推进时间。重复成功后按完成时刻 `now + everySeconds` 排下次，跳过错过的次数；失败仍 active、只存固定错误码，至少等 `max(60,minIntervalSeconds)` 秒重试。网关发送非幂等，超时/进程崩溃后的重试可能重复；无跨进程 exactly-once 保证。无 DSH jobs/长任务/LLM 任务执行/任意命令/外部任务调用，真实定时器和 QQ 未验证，#8/#40 为 partial。


## 目的规划助手（M7-t）

无新增配置字段，沿用现有目的服务与认知 LLM 路由/预算；默认行为不变。主人显式 `/purpose plan ID` 才调用 `llm.completeJson`，要求活跃 goal 有标题和描述，生成并替换 1–8 条未完成步骤（每条最多 200 UTF-16 单元、去控制字符、非空且唯一）。无效结果/缺少服务/目标变化时不写入；命令经 owner、`deniedCommands` 与当前聊天访问闸门。`/purpose step ID N [done|undo]` 仅手动更新步骤标记，N 为 1–20；`/purpose steps ID` 查看进度。步骤更新沿用服务既有进度/完成规则，undo 不自动恢复已完成目标，恢复用 `/purpose resume ID`。用法见[用户手册](USER-MANUAL.md#36-目的与记忆整理)。

仅当前聊天命令回复，无步骤执行、动作绑定、审批集成或后台 LLM/自主执行器；离线 fake LLM 测试，真实模型/QQ 未验证。GAP #38 仍 partial；矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47。
