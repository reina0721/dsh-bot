# dsh-bot × Aurabot 全量对标报告

> 快照：2026-11-06（Asia/Shanghai）。
> Aurabot：`aureth-labs/dsh-aurabot-qq`，`dd1911f`，v1.2.0，MIT。
> dsh-bot：`reina0721/dsh-bot`，`d2da394`，v0.11.18，MIT。
> 本文是差距清单 + 里程碑计划；**不把设计当成已实现**。状态以「代码 + 测试 + 受控真机验证」为准。

## 0. 一句话结论

Aurabot 领先的是**产品外壳 + DSH 原生运行时**；dsh-bot 领先的是**认知内核 + 模型协议广度**。最大的结构性差距不是少几个功能，而是：

1. **DSH Agent 运行时仍是受限接入**——已有可选的每聊天 Session、oneshot 回退和仅主人私聊的 3 个当前会话 QQ 工具，但没有媒体工具、子智能体、后台任务、定时任务执行面；
2. **没有访问控制**——没有主人、白名单、权限档位与统一出站闸门，不能安全地放进真实群；
3. **媒体/内容仍是受限层**——已有 M4-b 媒体与默认关闭的 B站公开搜索/热门/详情，已有 M7-c 受限生图/兼容 edits 与普通图片发送，但没有自动收集/语境选图或 RVC，M7-m 新增受限公开评论/离线分享；QQ空间因授权/ToS 未实现，已有 M6-a 本地目录备份/默认暂存恢复，已有 M6-b 安全页、上线清单与默认关闭的手动升级检查；模块市场、自动更新与迁移仍未实现。

因此本项目的路线不是「按功能数量抄 Aurabot」，而是：**保留认知内核与模型协议的优势，补齐 DSH 原生运行时、安全底座、媒体与产品壳**，以 `parity matrix` 逐项验收。

## 1. 量化对照

| 项 | Aurabot v1.2.0 | dsh-bot v0.11.0（候选） |
|---|---|---|
| 宿主源码 | 24,721 行 / 220 个 js 文件 | 10,806 行 / 44 个 js 文件 |
| 面板 | 5,102 行，约 25 个功能页 + 设置子页 | 单文件面板，15 个顶层标签（含媒体/内容/模块/备份/安全） |
| 测试 | 117 个测试文件 / 20,024 行 | 22 个测试文件 / 5,471 行 / 157 项（153 通过、4 项 live 跳过） |
| 关键模块 | `chat/hub.js` 2,448；`features/memory.js` 2,629；`purpose/engine.js` 2,287；`core/modules.js` 865 | `cognition/index.js` 546；`cognition/pipeline.js` 523；`core/config.js` 1,115 |
| 运行时 | 每聊天 DSH Session + 4 个 preset + 按会话挂工具 | 一次性 LLM；无 Session/工具 |
| 内置模块目录 | 17 个（voice / song / stickers / imagegen / memory / mood / diary / bili / qzone-social / purpose / pet / qq-api / qq-tools / video / contacts / profile / speakup） | 无模块内核 |
| 面板页面 | 概览/连接/人格/权限/聊天/模型/语音/表情包/生图/空间/主动/桌宠/心情与记忆/人物记忆/翻唱/B站/抖音/小黑盒/本地接口/安全/市场/已安装/备份/关于/日志 | 概览/连接/消息/媒体/内容/模块/备份/安全/配置/人格/模型/系统设置/认知/日志/关于 |
| 社区 | 425★ / 65 fork | 新仓库 |

计数口径：GitHub API + 浅克隆源码 + `node --test` 实跑；页面按 `client/client.js` 的 page id；模块按 `src/modules/` 目录。

## 2. 三层差距

| 层 | Aurabot | dsh-bot | 性质 |
|---|---|---|---|
| 运行时 | `sessionController.create({workspaceId, agentPreset})`；每聊天一个 Session；`agent.ctx.tools.register` 按会话挂工具；`agent.followup/steer` 驱动回合 | `llm.stream()` 一次性调用；回复由本地 pipeline 拼 prompt | 结构性 |
| 产品壳 | 权限页、媒体页、空间/B站页、模块市场、备份升级、25 页面板 | 只有连接/消息/人格/模型/认知/日志/设置 | P0–P4 |
| 生态 | 模块内核（热重载/替换/隔离）+ 市场 + API/类型/教程 + 117 测试文件 | 单体；只有 `ctx.provide` 服务接缝 | P4 |

## 3. 能力矩阵

状态：**有**、**部分**、**无**、**领先**（dsh-bot 相对 Aurabot 更强）。
目标：`M1` 运行时+权限、`M2` 群聊交互、`M3` 记忆/心情/目的、`M4` 媒体、`M5` 社交内容+模块、`M6` 运维/UI/安全、`M7` 审计发布。

### 3.1 连接与感知

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 1 | OneBot v11 正向 WS + HTTP | 有 | 有；三种鉴权、握手超时、重连退避、账号核验缓冲 | **有** | — |
| 2 | SnowLuma 检测/读取 | 检测、启停、只注入机器人号 | 只读 `detectInstall`/`readOneBotEndpoint` | 部分（受限是许可要求） | M7：许可边界复核（维持只读） |
| 3 | QQ 事件面 | 撤回/禁言/进退群/管理员/精华/名片/头衔/群名/加好友/拍一拍/表态/请求 | M7-j 十种已知通知校验/去重写人格时间轴（含群名/头衔/离线文件）；好友/群请求只存待办，主人确认处理；原撤回/拍一拍/表态保留 | 部分（M7-j） | M2：真实 QQ 兼容性、未知/扩展通知与 meta 认知未验证或未覆盖 |
| 4 | 消息段与富媒体解析 | 合并转发展开、临时会话、群文件、待办、相册、骰子/猜拳、位置/名片、分享/音乐 | 文本/图片/表情/引用/forward 元数据；合并转发可展开；其余未解析 | 部分（M2-b） | M4 |
| 5 | 原始事件落盘与脱敏 | 有 | 有（JSONL + SQLite + redact） | **有** | — |

### 3.2 会话运行时

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 6 | 每聊天 DSH Session | `sessionController` + preset + 映射文件 | `src/runtime/agent.js`：Session 映射、preset、followup、超时、oneshot 回退 | 部分（M1-b） | M1 剩余：真机验证/工具面 |
| 7 | 工具/MCP/子智能体 | 按会话挂载；`aurabot-subagent` | private preset 内置 fs/fs-search/web；full/主人私聊另挂 3 个当前会话 QQ 工具；无 MCP/子智能体 | 部分（M5-b） | M1/M2 |
| 8 | 后台任务/定时任务 | jobs + schedule + 长任务 preset | M7-l 默认关闭的主人本地固定文本提醒；一次/重复、人格与聊天隔离、统一 outbound、延迟安全重试；离线测试 | 部分（M7-l） | M1：无 DSH jobs/长任务/LLM 任务执行/提醒面板，真实定时器与 QQ 未验证 |
| 9 | 会话内插话/steer/typing | `agent.steer` + `set_input_status` | M7-o 主人显式 steer；M7-q 默认关闭的私聊/C2C 输入状态，轮次前 1/finally 2、失败隔离与配置开关；仅离线测试 | 部分（M7-o/M7-q，steer + 私聊 typing） | M1 剩余：无群聊 typing/群 set_input_status、输入状态限频或专用状态面板，真实 DSH/QQ 未验证 |
| 10 | 按聊天选模型 | `chatModels`（私聊/群/单聊） | `cognition.modelRouting`：私聊/群默认 + 会话覆盖；`/model` 写回 | 部分（M1-c，仅认知 LLM） | M1 剩余：agent Session 模型 |
| 11 | QQ 内命令 | `/silent` `/active` `/quiet` `/chatty` `/model` `/sing` `/remember` `/status` | `/status` `/quiet` `/active` `/model` `/remember` `/forget` `/help`；M7-r 操作员固定只读集，其余非主人静默（公开模块命令例外） | 部分（M1-c） | M1 剩余：`/sing` 等媒体命令 |

### 3.3 权限与安全

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 12 | 主人/私聊白名单/群白名单 | `ownerQQ` + `allow.private/groups` | `access.mode=open/allowlist`、主人/只读操作员 + 私聊/群白名单、入口闸门、审计/计数 | 部分（M1-a） | M1 剩余：工具级权限 |
| 13 | 权限档位 | full / social / chat；preset 按档位 | M7-r 默认空 access.operators：主人全量、操作员固定 help/status/model（无参数）/bili/groupinfo/memberinfo；allowlist 放行操作员私聊，群仍需白名单，禁用命令静默 | 部分（M7-r） | M1 剩余：无完整 per-tool/per-action RBAC，无 admin/approval 档位 |
| 14 | 逐项权限 | 改资料/文件/群管/点歌/生图/抖音/小黑盒；执行前复核 | M7-b 管理/文件默认关、主人/当前会话/确认/access/realpath；M7-n 默认空 deniedCommands，身份检查后拦截内置/模块命令，小写匹配、最多100、非法项 issue，无处理服务调用或配置写入；M7-r 固定只读操作员档位（见 #13），仍受 deny-list 约束；M7-s 受限管理审批见 #15 | 部分（M7-n/M7-r） | M2 剩余/M5：仅命令 deny-list + 固定只读操作员集，无所有服务/工具逐项 action allow/deny 矩阵或统一审批；新动作不挂 Agent |
| 15 | 审批/危险确认/leak guard | `security/approval`、`danger`、`leak-guard` | M7-b 固定主人命令确认；M7-i 统一认知出站 text 密钥规则（默认 redact/可选 block、100k、dry-run）；M7-j req_ 请求显式 confirm；M7-s 默认关闭的持久化管理审批 apr_（固定十动作、10 分钟/50 pending），主人列表/批准/拒绝，原聊天单次重放及结果状态，参数已知密钥拒绝 | 部分（M7-s） | M2：无全服务/工具统一审批或审批面板/HTTP，无完整逐项权限；无 PII/熵或媒体/文件扫描，可能误报/漏报；独立发送路径不覆盖 |
| 16 | 本机-only/CSRF/可信反代/远端访问 | 默认只许回环 + CSRF + 反代配置 | 依赖 DSH 本机服务，无显式防护 | 豁免（用户批准） | 2026-11-06 用户批准：仅远端 API 鉴权；保留本机-only/CSRF 行为（见 §8.1） |
| 17 | dryRun/试运行 | 有 | 有（`cognition.dryRun`） | **有** | 统一到 outbound |
| 18 | 统一出站闸门 | 执行层兜底 | `cognition/outbound.js`：访问 → 限频 → leak guard → dryRun → 发送；pipeline/proactivity 统一 | **有**（M1-a） | — |

### 3.4 群聊与表达

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 19 | 轮次聚合/防抖/硬截止 | 有 | 有（完整度、软/硬截止、命令快路径） | **有** | — |
| 20 | 群 admission | 点名必回、话题相关度、概率插话、防刷屏、连续发言自知 | addressed/probability/all + 冷却/分钟上限 + 连续未点名接话上限；M7-p 默认关闭的词法记忆相关度门控，低分/无记忆仍编码并跳过分析，点名绕过、异常放行 | 部分（M7-p，仅词法） | M2-b：LLM 话题判断/接梗/语义相关度未实现 |
| 21 | 分条回复/引用/@/表情 | 有 | 分条 + 引用 + 群聊 @ 可配；表情/语音未接 | 部分（M2-a） | M2-b/M4 |
| 22 | 合并转发展开/拍一拍/表情回应/通知 | 有 | 合并转发展开、拍一拍回应、表情表态归因；其他通知类型未处理 | 部分（M2-b） | M2 剩余 |
| 23 | QQ 动作工具 | 改资料/群管/文件/点赞/撤回/精华等 | 原 4 个主人命令 + M7-b 默认关的资料/群管/文件/精华/撤回命令；仅主人私聊 Session 保留原 3 个工具，social/group 仍 0 个 | 部分（M7-b） | 新增仅命令：昵称、名片/群名、管理员、禁言（0–30 天）/全禁、踢人、当前会话精华/撤回、媒体根内文件；无逐项权限矩阵/任意 action 透传/Agent 新工具；get_msg 缺归属则拒绝；真实 QQ 管理/资料/文件动作未验证 |

### 3.5 人格与情绪

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 24 | 人格编辑/切换 | 人格卡 Markdown（可多份、按节编辑、面板切换） | 多人格库、切换/复制/删除/导入；**人格级认知数据隔离** | 领先（隔离深度） | 已领先（无缺口） |
| 25 | 心情/情绪 | 关键词或模型判心情；影响语气/表情/语音/回复速度 | OCC 评价 → PAD/离散；惯性/衰减/调节/外显阈值 | 领先（但未影响媒体） | M4 |
| 26 | 人格注入 | `@deepseek-ai/dsh-persona` + `{{aurabot_persona}}` | `{{dshbot_persona}}` / rules 变量 + private/social preset | **有**（M1-b） | — |

### 3.6 记忆、人物与关系

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 27 | 记忆类型 | 本地索引 + 原话/梗概/事实分层 + 人物/群档案 | 工作/情景/语义/情绪/社会/程序 + FTS5 | 部分 | M3 |
| 28 | 每日整理/空闲提炼 | 有；预算/批次/重试/保留 | 每日 04:00 巩固 + 按作用域 LLM 反思；手动触发；私聊隔离 | 部分（M3-b） | M3 剩余：批次/重试/保留 |
| 29 | 人物档案/群印象/相处经验/说话方式 | 有页面、可编辑、按聊天隔离 | M7-g 当前人格人物页可编辑 facet 内容/置信度/active 或 disputed（含 group-scope 群印象）；关系页按原作用域手动调整 API 返回的 10 维，仅保存变化项，source=ui 历史 | 部分（M7-g） | M3 剩余：无独立人物说话方式编辑器、无 Aurabot 专用人物/群档案导入；未做本轮真实浏览器验证 |
| 30 | 时间轴/回忆日志/导入旧档案 | 有 | 轮次/记忆/决策/事件只读时间轴；M7-h 通用 JSON/JSONL 经面板/API 导入当前人格记忆或时间轴事件，默认 5 MiB/5000 项、作用域校验、必填事件时间、幂等去重、本地处理 | 部分（M3-c/M7-d/M7-h） | M7：无 Aurabot 专用档案迁移或向量导入；无真实旧档案样本验证 |
| 31 | 语义检索/embedding | 可选，默认关 | M7-f 默认关闭的 OpenAI 兼容 embeddings 重排词法候选；同步词法不变，异常回退；32 条/4000 字符/8–4096 维/2000 项内存 LRU，fake 离线测试 | 部分（M7-f） | M7：仅兼容 embeddings；无本地模型/独立 reranker/向量数据库/全库向量召回；真实 provider 未验证 |
| 32 | 跨平台身份 | 有 | M7-v 默认空的全局手动链接 registry；主人 /identity 列表/登记重链/移除，严格字段/已知密钥校验、唯一键/5000 条/解析筛选计数，独立存储且不改人物 | 部分（M7-v） | M3：仅人工登记基础；无 Telegram/Discord adapter、自动合并、账号验证或消息路由；无人物创建/修改，真实跨平台未验证 |

### 3.7 学习、信念与知识

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 33 | 未知检测/学习任务/claims | 无显式 | 有（unknowns/tasks/claims/预算/暂停） | **领先** | 已领先（无缺口） |
| 34 | 信念修正 | 无显式 | logit 证据更新、冲突 disputed、用户纠正 | **领先** | 已领先（无缺口） |
| 35 | 技能/习惯/元认知 | 无显式 | 13 技能、熟练度/迁移/退化；Brier/校准/insight | **领先** | 已领先（无缺口） |
| 36 | 真实外部知识源 | B站/空间等真实网络 | Wikipedia/OpenAlex/GitHub/RSS 接口 + fake 测试 | 部分 | M3 |

### 3.8 策略、主动与目的

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 37 | 候选效用/bandit/结果归因 | 模块化 hooks + 群聊策略 | Beta 后验、效用、限频、沉默、撤回专项 | **领先** | 已领先（无缺口） |
| 38 | 目的引擎/计划 | `purpose/engine.js` 2,287 行，目标/计划/执行 | goal/plan/intent CRUD、优先级/进度/步骤、少量注入、面板；M7-t 主人 `/purpose plan ID` 显式 JSON LLM 规划（1–8步、控制字符/长度/唯一校验），step done/undo 手动标记与 steps 查看；仅保存和当前聊天回复，无自主执行器/动作绑定/审批集成 | 部分（M3-a/M7-t） | M3 剩余/M5 |
| 39 | 主动搭话 | 醒着时间/频率/白名单/晚安心情 | 安静时段/日预算/关系门槛/退避/dryRun | 部分 | M3 |
| 40 | 定时/后台任务 | 有 | M7-l 主人 /remind /reminders /forgetreminder；本地一次/重复提醒经 outbound 访问/限频/leak guard，默认关闭 | 部分（M7-l） | M1/M3：仅本地主人提醒；无 DSH jobs/长任务/LLM 执行/提醒 HTTP 或面板；真实定时器/QQ 未验证 |

### 3.9 媒体

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 41 | TTS/语音条/ASR | edge-tts / CosyVoice / GPT-SoVITS / HTTP；QQ PTT 文本/DSH STT | OpenAI 兼容 ASR/TTS；record 转写；TTS 落 MP3/base64 发送；`/tts` 默认 300 字；面板只落盘测试；默认关闭 | 部分（M4-b） | 无自动语音策略、多音色编排、RVC/翻唱或 Agent 工具；待真机 |
| 42 | 翻唱/RVC | 网易云→分离→RVC→混音 | 无 | 豁免（用户批准） | 2026-11-06 用户批准：依赖外部 RVC 模型/客户端，退出发布门槛 |
| 43 | 表情包 | 收集/尺寸/去重/打标/按语境发/商城 | 面板手动上传；PNG/JPG/JPEG/GIF/WebP；默认 5 MiB/张、200 张；SHA-256 去重；人工标签；`/sticker [标签]` 随机发 | 部分（M4-b） | 不自动收集、缩放转码、语境/情绪选择或接商城 |
| 44 | 图片收发/视觉/生图/改图 | 有 | M7-c：入站/Vision/base64 出站；主人 /image 普通图片、/draw 生图、/redraw 兼容 edits；媒体页生图/改图只落盘，状态 flags；默认关闭、env 密钥、prompt 1–1000、五档尺寸、限大小 PNG b64_json、PNG 头边长≤1792/像素≤1792×1024；根内相对路径/realpath/扩展名/大小与 access 闸门 | 部分（M7-c） | M7：真实 provider/QQ 生图改图未验证；不获取返回 URL，只支持 OpenAI 兼容 edits，无 mask/其他编辑后端；无普通图片发送面板/任意本地路径 |
| 45 | 文件发送/接收 | 有 | 白名单扩展名下载；OneBot 群/私聊上传服务；主人 /file 根内相对路径；M7-k 上传/列表/刷新，M7-u 本地下载/确认删除及 API；安全存储 basename≤120/严格 base64/大小限制、固定 files 目录/realpath/非符号链接普通文件/wx、最新 500 项与总字节数 | 部分（M7-u） | 本地上传/列表/下载/删除需 media.enabled/files.enabled，无任意本地路径；无发送面板，主人 /file 另需 qqAdmin.enabled/access；真实 QQ 文件兼容性未验证 |
| 46 | 本地接口（TTS/生图/识别脚本） | 有 | M7-c：`/media/status|test|tts`、`POST /media/image/generate {prompt,size?}` / `edit {path,prompt,size?}` 返回根内生成路径；表情包按 ID 取图；默认零网络；超时/大小/五档尺寸限制，只接受 PNG b64_json | 部分（M7-c） | M7：无本地识别脚本桥/任意本地路径/新图片上传下载接口；不抓 provider 返回 URL，只支持兼容 edits；真实 provider/QQ 未验证，面板/API 不自动发送 |

### 3.10 社交内容

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 47 | QQ 空间日记/评论/好友动态 | 有 | **未实现**：需要 QQ 登录授权，且需单独审查平台授权与 ToS；面板明确提示 | 豁免（用户批准） | 2026-11-06 用户批准：QQ空间：需 QQ 登录授权与 ToS 审查（见 §8.1） |
| 48 | B 站浏览/评论/分享 | 有（WBI/字幕/热评） | 默认关闭的公开搜索/热门/BV 详情与公开评论、离线分享链接；主人命令/REST/内容页，置顶优先/rpid 去重/最多20条；无 Cookie/WBI | 部分（M7-m） | 仅公开评论/离线分享；无登录/WBI/字幕/发布评论，真实接口未验证 |
| 49 | 抖音/小黑盒 | 社区模块 | 无 | 豁免（用户批准） | 2026-11-06 用户批准：依赖外部账号/接口，退出发布门槛 |
| 50 | 桌宠 | 有（Electron 客户端） | 无 | 豁免（用户批准） | 2026-11-06 用户批准：桌面客户端形态，退出发布门槛 |

### 3.11 模块与扩展

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 51 | 模块内核/热重载/替换/隔离 | `core/modules.js` + 快照 + 出错隔离 | M5-a 本地 kernel：manifest、权限、启停/重载、cleanup、错误隔离 | **受限实现** | M5-a：无进程/VM 沙箱、依赖解析或文件监视 |
| 52 | 模块市场/社区库 | 有 | 无 | 豁免（用户批准） | 2026-11-06 用户批准：模块市场/远程安装（见 §8.1） |
| 53 | 扩展 API/类型/教程/模拟测试 | API.md + `.d.ts` + MODULE-TUTORIAL | M5-a 稳定 JS API + `docs/MODULES.md` + real dynamic-module tests；无 `.d.ts` | 部分 | M5-a：本地 JS only，无 SDK/类型包 |
| 54 | 外部知识源/动作注册 | 模块 API | 权限门控 knowledge/capability 注册 + command/event/sendText/storage；无通用动作总线 | 部分 | M5-a：仅明确 API，发送仍强制走 outbound |

### 3.12 运维、UI、文档与测试

| # | 能力 | Aurabot | dsh-bot | 状态 | 目标 |
|---|---|---|---|---|---|
| 55 | 面板页数 | 约 25 个功能页 | 15 个标签（含媒体、内容、模块、备份、安全） | 豁免（用户批准） | 2026-11-06 用户批准：25 页级面板规模（见 §8.1） |
| 56 | 设置向导 | 有 | M6-b 安全页上线清单：连接、allowlist+owner、备份、raw action、媒体配置、人工模块审核；链接至连接/配置/备份 | 部分（受限实现） | 无独立向导/自动修复；模块始终人工待检查，媒体只检查字段，不验密钥/服务；无 API 鉴权变更，仍依赖 DSH 本机信任边界；未做真实浏览器 V |
| 57 | 备份/恢复 | zip 备份 + 恢复 + 迁移 | M6-a 本地目录快照（无 zip），默认配置/模型/认知/模块/表情包，可选根内全部媒体；200 MiB/5000 文件/10 份可配；原子发布/可选清理；默认暂存、显式 allowRestore + 恢复前备份 | 部分（受限实现） | 复制 SQLite 前停写，恢复后重启；无在线一致性/整目录事务、云端上传下载、自动恢复或迁移 |
| 58 | 升级检查/beta 通道 | 有 | M6-b 默认关闭的手动 GitHub Releases 检查；最近 10 条内按 stable/beta 过滤并比较版本；内存缓存/force/超时/真实错误；安全页版本卡 | 部分（受限实现） | beta 仅放宽预发布过滤；无后台/自动更新、下载/安装、token；未认证每 IP 60 req/h；无真实 GitHub V |
| 59 | 工作区迁移/离峰省钱 | 有 | 未实现；M6-b 安全页与版本检查不迁移工作区/格式、不调度离峰策略；备份暂存只作用于同一数据根 | 豁免（用户批准） | 2026-11-06 用户批准：工作区迁移/离峰省钱（见 §8.1） |
| 60 | 用户手册/模块教程/测试覆盖 | 用户手册 + 模块教程 + 117 测试文件 | 正式文档更全但用户手册浅；22 测试文件 | 部分 | M6/M7 |
| 61 | 真机 QQ/媒体验证 | 有用户群与实机路径 | mock + 探针；真实媒体未验 | 部分 | M7 |

## 4. dsh-bot 的相对优势（不要为了对标丢掉）

1. **认知状态是一等公民**：情绪、人格、关系、信念、技能、策略、元认知都有独立表与演化规则；Aurabot 是心情 + 记忆 + 群策略。
2. **人格级认知数据隔离**：多人格库 Aurabot 也有，但 dsh-bot 把记忆/人物/关系/情绪/策略按 `persona_<id>:` 命名空间隔离，并支持按组复制/导入/导出。
3. **模型协议广度**：OpenAI Chat/Responses、Anthropic、Gemini、Ollama + OpenCode Go/Command Code/OpenRouter 预设 + 自定义 base/header/auth。
4. **OneBot 细节与网络健壮性**：3 种鉴权、握手超时、指数退避、账号核验缓冲、FTS5 降级。
5. **工程可审计性**：实现状态、覆盖矩阵、决策记录、历史验证。

## 5. 结构性差距：为什么必须先做 DSH Session 运行时

### 5.1 现状数据流

```
QQ → OneBot 网关 → host.onEvent → normalize → events → cognition.observe
  → pipeline：turn → 人物/关系/情绪 → 记忆检索 → 分析 → 策略 → compose（llm.stream）
  → gateway.actions.sendMessage
```

问题：
- 每次分析/生成都是独立一次性调用，无法使用 DSH 的工具、MCP、附件、子智能体、后台任务、定时任务。
- 没有 Session，就没有「同一聊天的长上下文/工具轨迹/插话/审批」这些 Aurabot 已经产品化的能力。
- 回复只能靠本地拼 prompt，人格/记忆注入与 DSH 的原生 Persona 体系重复。

### 5.2 目标数据流（M1）

```
QQ → 网关 → events → access（主人/白名单/档位）
  → turn 聚合 → runtime.sessionFor(chat)
  → agent.followup(message) / agent.steer(message)
  → DSH Agent（preset：private 带工具 / social 无本机工具）
  → session 事件 → 清洗/分条/引用 → outbound（access → 限频 → dryRun）→ 网关
  → 回合后：cognition 用 transcript 做结果归因/记忆写入
```

### 5.3 可用服务（DSH 0.2.2 已核实）

`ctx.agents`、`ctx.sessionController`、`ctx.workspaceRegistry`、`ctx.attachments`、`ctx.systemPrompt`、`ctx.speechToText`、`ctx.jobs`、`ctx.schedule`、`ctx.tools`（按 Agent scope）。

关键 API：
- `sessionController.create({ workspaceId, agentPreset })`
- `sessionController.resolveAgent(sessionId)` / `rename`
- `agent.followup(message)` / `agent.steer(message)`
- `agent.ctx.tools.register(...)` / `agent.ctx.systemPrompt.context(...)`
- `ctx.systemPrompt.variable(name, fn)`（人格/规则变量）

### 5.4 迁移路径

- **A（推荐）**：认知内核做「回合前状态提供者 + 回合后分析器」，回复由 Agent 生成；避免重复 compose 调用。
- **B（过渡）**：保留现有 analysis/policy，只用 Agent 做 compose；工具能力有限，但迁移风险小。

`runtime.engine: 'oneshot' | 'agent'` 默认 `oneshot`；没有 `sessionController` 时自动回退；用 fake 宿主单测 + 临时 profile 真机 smoke 通过后再翻默认。

### 5.5 风险

- DSH 0.2.x 内部 API 可能变：feature-detect + 回退 + 版本锁 `>=0.2 <0.3`。
- 每聊天一个 Session 的会话膨胀、备份/迁移、上下文成本。
- 自循环/重复回复：保留 turn 层 self 防护 + outbound 单一出口。
- 提示词缓存：状态注入放对话末尾，不破坏前缀。

## 6. 里程碑

| 里程碑 | 主题 | 关键交付 | 验收 |
|---|---|---|---|
| **M0（已完成）** | 视觉与矩阵 | Archify 装入 `web`；5 张视觉基线；本报告 | 见 §7 |
| **M1** | 运行时 + 权限 | Session/preset/映射/工具挂载/prompt 变量；access；outbound；命令；按聊天模型；回退 | 主人私聊有工具、群聊无本机工具、无重复回复、回退可用 |
| **M2** | 群聊交互 | 分条/引用/@/合并转发/拍一拍/表态/通知；群 admission/防刷屏；QQ 动作权限 | 群聊场景套件全绿 |
| **M3** | 记忆/心情/目的 | 每日整理、原话→梗概→印象、人物/群档案、时间轴、导入导出、容量、向量 seam；心情升级；目的引擎/主动 | 30 天模拟 + 面板可查改删 |
| **M4** | 媒体 | TTS/ASR/语音条、表情包、图片收发/视觉/生图、文件、本地接口 | 真机发出语音/表情/图；看图回答 |
| **M5** | 社交内容 + 模块 | 空间/B站/抖音/小黑盒/桌宠/翻唱（可豁免）；模块内核/市场/API/热重载/模拟 | 模块可装/换/热更新 |
| **M6** | 运维/UI/安全 | 备份恢复、升级提示、工作区迁移、离峰省钱、本机-only/CSRF/反代、审批/危险确认、向导、25 页 | 安全评审 + 向导 + 备份恢复 |
| **M7** | 审计发布 | parity matrix 关闭、性能/成本、真机验收、发布 | 所有行「实现」或「豁免」 |

## 7. M0–M3 交付（已完成部分）

**M0（视觉与矩阵）**
- Archify 安装与验证：见 [ARCHIFY.md](../ARCHIFY.md)。
- 视觉基线：见 [docs/visuals/README.md](../visuals/README.md)。
  - `current-architecture.html`、`target-architecture.html`
  - `message-lifecycle.html`、`turn-lifecycle.html`
  - `parity-roadmap.html`
- 全部 5 张图通过 `validate` + `deliver` + `check` + `browser-check`（Archify 3.0.1，Chrome for Testing 157）。
- 本文 + 文档校正。

**M1-a（访问控制 + 统一出站）**
- `src/core/access.js`：open/allowlist、主人/私聊/群白名单、入口判定、审计环形缓冲、计数。
- `src/cognition/outbound.js`：回复/撤回/主动行为统一出站；访问 → 频率 → leak guard → dryRun → 发送；失败不重试。
- 配置 `access.*` 与「配置 → 访问控制」分组；概览访问控制卡片；`/access/stats`、`/access/check`。
- 测试：`test/access.test.js`、`test/outbound.test.js`、e2e allowlist 用例；默认 open 回归不变。
- 边界：逐项工具权限/审批、真机 allowlist 验证留到 M1 剩余 / M2。

**M1-b（DSH Session 运行时）**
- `src/runtime/agent.js`：`sessionController` + `workspaceRegistry` + `agents` 探测；`sessions.json` 映射；`dsh-bot-private` / `dsh-bot-social` preset；`agent.followup` + `session/event` 取最终 assistant 文本；每聊天串行、超时、失败回退 `oneshot`。
- `cordis.patch.yml` 增加两个 agent preset；`host.apply` 注册 `{{dshbot_persona}}` / `{{dshbot_rules_private}}` / `{{dshbot_rules_social}}`。
- 配置 `runtime.*`；概览「运行诊断」显示 engine/active/会话数；`/runtime/stats`、`/runtime/sessions`。
- 测试：`test/runtime.test.js`（Session 复用、preset 选择、工具中间文本丢弃、空回复/超时、并发串行、oneshot 回退）。
- 边界：默认 `oneshot`；未在真实 DSH Session 上做 live smoke；QQ 动作工具/命令/按聊天模型留到 M1 剩余。

**M1-c（QQ 命令 + 按聊天模型）**
- `src/cognition/commands.js`：`/status` `/quiet` `/active` `/model` `/remember` `/forget` `/help`；只处理 `/name args`，非主人静默；命令回复走 outbound。
- `cognition.modelRouting`：私聊/群默认 + `QQ号或群号=provider/model` 会话覆盖；`/model` 写回；provider 在直连列表则 direct，否则 DSH。
- 命令在 pipeline 的分析/策略前处理；`/quiet` `/active` 写回群聊参与/主动开关；`/remember` `/forget` 使用记忆服务。
- 测试：`test/commands.test.js`、`test/model-llm.test.js` 的按聊天覆盖用例。
- 边界：仅认知 LLM；agent Session 模型、`/sing` 等媒体命令留到后续。

**M3-c（时间轴）**
- `cognition/timeline.js`：turn/memory/decision 合并、倒序、before 分页、types/scope 过滤；API `/cognition/timeline`；认知「时间轴」页。
- 测试：`test/timeline.test.js`（排序/before/type/scope/空输入）。
- 边界：只读；无导入旧档案、无编辑。

**M3-a（目的系统）**
- `cognition/purpose.js`：goal/plan/intent，active/paused/done/abandoned；优先级/进度/步骤/截止/作用域；`promptContext` 限量注入 compose；`tick` 给建议不执行。
- `/purpose` 列表/新建/完成/放弃/暂停/恢复/进度；认知面板「目的」页 CRUD；API `/cognition/purpose*`。
- 测试：`test/purpose.test.js`、commands 用例、cognition 集成（目的注入/完成停止注入）。
- M7-t：主人 plan/step/steps 规划与手动标记；标题和描述必填，active goal/唯一 ID/参数/owner/禁用/访问闸门；LLM 仅显式调用，严格 JSON 校验，等待期间目标变化不覆盖。离线 fake LLM/真实目的进度测试；无新配置/依赖、后台执行、自主执行器、动作绑定或审批集成；#38 仍 partial，矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47。

**M3-b（每日整理/反思）**
- `cognition/consolidation.js`：每日 04:00 调度 `memory.consolidateAll()`；按作用域 LLM 反思，只压缩已有记忆，写回同 scope（source=reflection）；私聊不跨聊/不写 global。
- 面板记忆页「整理/反思」；API `/cognition/consolidation*`；配置 `consolidation.*`。
- 测试：`test/consolidation.test.js`（scope 隔离、条数门槛、LLM 失败不写、调度时间、状态）。
- 边界：无时间轴、批次/重试/保留策略、人物档案编辑页、向量检索。

**M2-b（合并转发/拍一拍/表态/QQ 动作）**
- `gateway/forward.js` + `actions.getForwardMsg`：兼容 `id`/`message_id`，节点压平成 `发送者：内容`；pipeline 展开进 `turn.text` 并标记不可信。
- 拍一拍：只回应 `target_id==botQQ` 的 notify/poke，按用户冷却，走 outbound；表情回应按 messageId 归因为正向 outcome。
- `cognition/qq-actions.js`：点赞/拍回去/群信息/成员信息；`/like` `/poke` `/groupinfo` `/memberinfo` 仅主人、仅当前会话。
- 测试：`test/forward.test.js`、`test/qq-actions.test.js` + cognition 集成（展开进记忆、拍一拍冷却、表态 outcome）。
- 边界：改资料/群管/文件/精华/撤回等动作、agent 工具化仍未做。

**M2-a（回复分条/引用/@/防刷屏）**
- `src/cognition/reply-split.js` + `pipeline.sendDecision`：长回复按段落/句末切分，最多 `maxParts` 条，剩余内容并入最后一条；每条走 outbound，支持分条间隔。
- `cognition.reply.quote` / `atSender`：首条引用原消息、群聊 @ 发送者；配置默认引用开、@ 关。
- `cognition.turn.maxConsecutiveGroupReplies`：连续未点名接话上限，点名回复清零，与冷却/每分钟上限并存。
- 测试：`test/reply-split.test.js` + cognition 集成（分条内容不丢、reply/at 段、连续接话后点名仍回）。

## 8. 完成定义与豁免

**完成**：矩阵每一行满足其一：
1. dsh-bot 有等价实现，且有自动化测试或受控真机 smoke 证据；
2. 经用户明确同意列为非目标，并在本文件记录理由。

**豁免流程**：提出行号 → 说明为什么不做（定位/许可/成本）→ 用户确认 → 标记「豁免」并保留原因。
默认建议豁免：桌宠、RVC 翻唱、抖音/小黑盒；除非定位从「认知内核」转为「全功能陪伴产品」。

**验收纪律**：
- 没有证据不标「有」；`部分` 必须写清缺哪一半。
- 每个里程碑结束更新本文件与 `docs/visuals/`。
- 真机验证只在临时 profile、dryRun/白名单下进行，不打扰现有 `web` 机器人。

### 8.1 用户批准豁免

批准日期：**2026-11-06**。这些是 M7 发布门槛的明确用户决定，不是实现证据（exemptions are explicit user decisions, not implementation evidence）。仅以下范围退出 remaining；保留当前实现及限制说明：

| 矩阵行 | 精确豁免范围 | 原因与保留边界 |
|---|---|---|
| 16 | 远端 API 鉴权 | 用户不将远端 API auth 作为发布门槛；继续依赖 DSH 本机信任边界，保留现有 local-only/CSRF 行为；不批准远端暴露，不声称新增本机/反代防护已实现 |
| 47 | QQ空间日记/评论/好友动态 | 需 QQ 登录授权并审查平台授权/ToS；用户批准暂不作为发布门槛，仍未实现 |
| 52 | 模块市场/社区库与远程安装 | 用户批准不作为发布门槛；本地模块内核的隔离、类型等其他差距仍在原行跟踪 |
| 55 | 25 页级面板 | 用户批准页面规模不作为发布门槛；不豁免其他行的功能/向导/验证差距 |
| 59 | 工作区迁移/离峰省钱 | 用户批准不作为发布门槛；备份/恢复本身的其他限制仍在 #57 跟踪 |
| 42 | 翻唱/RVC | 用户批准不作为发布门槛；依赖外部 RVC 模型/客户端，未实现 |
| 49 | 抖音/小黑盒 | 用户批准不作为发布门槛；依赖外部账号/接口，未实现 |
| 50 | 桌宠 | 用户批准不作为发布门槛；桌面客户端形态，不做 |

**未批准豁免**：#44 生图/改图及其他所有行继续保留差距；#42/#49/#50 已于 2026-11-06 后续批准豁免。上文“建议/可豁免”仅是建议，不构成批准。#16 的行级 exempt 用于审计计数，仅代表上述远端鉴权范围；不能据此关闭或削弱本机-only/CSRF 行为。批准记录不改变运行时代码或部署边界。

### 8.2 用户接受当前 parity（2026-11-06）

用户明确选择「接受当前 parity 并收束」。当前矩阵为 6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47；8 项豁免见 §8.1。

这是**范围决定**，不是实现证据：不将剩余 47 项继续作为发布门槛，也不宣称全量 parity 或全量实机验收。发布版本为 v0.11.18，live 保留部分真机验收证据；M7-v 仅手动身份 registry，无跨平台 adapter/自动合并/路由。

## 9. 复现与维护

当前仓库静态计数、逐项差距与临时 profile smoke 命令见 [M7-a 对标审计](../PARITY-AUDIT.md)。该审计不代表全量对齐，也不替代真实 QQ/媒体验证。

```sh
# 计数（dsh-bot）
find src -name '*.js' | xargs wc -l | tail -1
ls test/*.test.js | wc -l
node --test "test/*.test.js"

# 计数（Aurabot，浅克隆）
git clone --depth 1 https://github.com/aureth-labs/dsh-aurabot-qq.git /tmp/aurabot
cd /tmp/aurabot && git rev-parse --short HEAD
find src -name '*.js' | xargs wc -l | tail -1

# 视觉重生成
bash scripts/archify-visuals.sh
```

Aurabot 证据入口：`README.md`（能力表/模块/安全/面板）、`docs/USER-MANUAL.md`（逐项用法）、`docs/DESIGN.md`（实现取舍）、`src/chat/access.js`（权限）、`src/chat/hub.js`（Session/工具）、`src/features/memory.js`（记忆）、`src/purpose/engine.js`（目的）、`cordis.patch.yml`（4 个 preset）。

dsh-bot 证据入口：`docs/cognitive/IMPLEMENTATION-STATUS.md`、`src/cognition/**`、`src/model/**`、`src/gateway/**`、`src/http/routes.js`、`client.js`、`test/**`。

### M7-f：可选语义检索证据与限制

`src/cognition/embeddings.js` 提供配置驱动、默认关闭的 OpenAI 兼容 `/embeddings` 客户端；`memory.retrieveAsync` 重排已可见的词法候选，pipeline/proactivity await，同步 retrieve 保持原行为。无候选/空查询/关闭时无外部调用；异常 debug 后词法回退，候选不写入、最终强化一次。权重默认 0.35、限制 0–1；每批 query+最多 31 候选，单条 1–4000 Unicode 字符，向量 8–4096 维有限数且一致，LRU 最多 2000 项，redirect=error、超时沿用 callMs，日志不含正文/密钥。

证据：[embeddings.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/embeddings.test.js)、[memory.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/memory.test.js)、[集成测试](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js) 均用 fake provider/假 embedder，不访问外部网络。只支持 OpenAI 兼容 embeddings，无本地模型、独立 reranker、持久化向量、向量数据库或全库向量召回；真实 provider 未验证。#31 仍 partial，#42/#49/#50 及其他行状态不变。

### M7-g：人物/群印象与关系编辑证据与限制

`client.js` 的 `CogPersons` 可展开单条 facet 编辑内容（面板按 1–2000 个 Unicode 字符校验）、置信度 0–1 与可选 active/disputed；其他既有状态可保留。群印象是当前人物的 group-scope facet，保留群号/私聊标签；不编辑人物 ID、facet ID 或作用域。保存调用既有 `/cognition/person/correct-facet`，`actor=ui`，刷新当前人物详情；保留单项删除。既有后端仍按 `String.slice(0,2000)` 截断值，含非 BMP 字符的长文本受其 UTF-16 上限约束，本轮不改后端。

`CogRelationships` 保留只读维度条，逐卡展开 API 返回的维度滑杆（当前 10 维，-1–1）。显式保存仅提交有变化的维度及原 `scopeType/scopeId`，使用既有 `/cognition/relationship/adjust`；后端记录 `source=ui` 人工调整历史。两处均支持取消、保存期间禁用控件、防重复提交、失败 toast 与草稿保留；不批量修改、不自动应用、不发送 QQ，不新增 API、Agent 工具或自动审批。

证据：[panel.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/panel.test.js) 新增 6 项离线测试，显式渲染人物/关系页及内联编辑组件，mock 所有请求，覆盖群/私聊/全局目标、Unicode 校验、置信度/状态、差量保存、取消/禁用/错误和刷新；不证明真实浏览器或既有后端的 Unicode 持久化。#29 仍 partial：无独立的按人物/聊天「说话方式」编辑器，无 Aurabot 专用人物/群档案导入；M7-h 通用旧档案导入支持记忆与时间轴事件。顶层人格工作台的 bot 说话风格编辑不算补齐此缺口。


### M7-h：通用时间轴事件导入证据与限制

`archive-import.js` 新增 kind=timeline，默认 memory 的既有格式、规范字段与 ID 保留。通用 JSON/JSONL 事件以独立 timeline_event 存入当前人格；正文/标题/时间/作用域校验，独立确定性 ID 幂等，共用 5 MiB/5000 项及 cognition.import 配置。缺时间拒绝，无效/未来时间回退为本次导入时间；因此回退时间的项跨时刻重导可能产生新 ID。面板选择记忆/时间轴并显示结果种类，时间轴默认包含 event，支持独立筛选及既有 scope 规则；事件纳入人格数据生命周期。

证据：[archive-import.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/archive-import.test.js)、[timeline.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/timeline.test.js)、[panel.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/panel.test.js)、[e2e.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/e2e.test.js)，均为合成数据/本地 fake 宿主与 mock 请求。无 Aurabot 专用档案迁移、向量导入、真实旧档案样本或本轮真实浏览器/QQ 验证，#30 仍 partial。#31 保持 partial，#42/#49/#50 保持 exempt；47 项 remaining 口径不变。

### M7-i 出站文本防泄漏与安全状态（#15 仍 partial）

`src/core/leak-guard.js` 的纯函数与 `createLeakGuard` 默认启用 + redact，可选 block；本地识别 OpenAI/GitHub/AWS AKIA/Bearer/PEM 私钥/至少 16 字符的 api_key/apiKey 值，只返回脱敏文本和类别/次数。单次及消息 text 合计超过 100,000 UTF-16 单元时整体脱敏/阻止；重叠合并、截断 PEM 防护、无匹配值错误或日志。outbound 在访问/限频后、dry-run/网关前检查；block 返回 LEAK_BLOCKED 并计 leakBlocked，脱敏成功仅带 leakGuard=redacted。dry-run 仍扫描且不发送；原始网关异常不传播。安全页只读展示开关/策略，没有扫描内容/密钥。

仅离线合成密钥、fake 网关、配置与 mock 面板证据，无真实 QQ/浏览器验证；无自动审批或外部调用。逐段扫描不重组跨段/跨消息密钥，无 PII/熵检测，可能误报/漏报；非文本段原样保留，不扫描媒体/base64/文件，媒体服务及面板手动发送/raw action 等独立路径不覆盖。缺统一审批/逐项权限，#15 保持 partial；#31/#42/#49/#50 行不变，remaining 仍 47。


### M7-j QQ 通知与主人请求审批（#3/#15 仍 partial）

十种已知通知写入当前人格 timeline_event：进退群、管理员、禁言、名片、群名、头衔、精华、好友添加和离线文件；只保留校验后的白名单字段，确定性去重、标题/正文 200/500 Unicode 上限，不下载文件。原撤回/拍一拍/表态继续走已有管线；接受/暂停/配置门控后才写入，未知通知与 meta 不进入认知。

好友请求缺省子类型映射 add，群 add/invite 按 flag 去重存 pending；flag 仅本地凭据存储/固定网关 action 使用，不进入公共列表、回复或日志。备注去控制字符、脱敏 flag/既有密钥模式、限 500 字符；主人 `/requests` 最多 10 条摘要，`/approve ID confirm`、`/reject ID confirm` 固定字面量确认且先检查 access，服务复核 owner/开关/pending/boolean。成功记录处理元数据，失败静态错误且 pending；进程内同 ID 并发防重、await 固定原人格写入。请求新增 requests 人格数据组，支持统计/复制/删除。无自动审批、审批队列面板、新请求 REST API 或新增 Agent 工具。

证据：[notices.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/notices.test.js)、[commands.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/commands.test.js)、[actions.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/actions.test.js)、[集成测试](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js)，全部为离线合成事件/fake 网关；真实 QQ 事件字段/审批动作未验证。没有通用审批/逐项权限或 PII/熵/媒体文件检测；QQ ID/备注仍是隐私，原事件日志策略不变，网关超时需人工核实、跨人格副本不代表新真实请求。#3/#15 保持 partial；#31/#42/#49/#50 行逐字不变，remaining 仍 47。

### M7-k 本地文件上传/列表（#45 仍 partial）

媒体服务新增 `saveFile({name,dataBase64})` / `listFiles()`；媒体与文件开关均需开启，关闭时报错。上传只接受安全 basename≤120、FILE_EXTENSIONS、非空严格规范 base64 与大小内内容；固定 files 目录、根/目录 realpath、拒绝目录符号链接、wx 防覆盖。列表不递归、不跟随符号链接，仅白名单扩展名/大小内普通文件，mtime 最新优先最多 500 项，totalBytes 统计全部合格文件。新增本地 GET `/media/files` / POST `/media/file/upload`，POST 请求体固定 15 MiB；媒体页增加客户端预检、上传防重、路径/大小/时间列表、刷新与独立错误显示。

证据：[media.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/media.test.js)、[API](https://github.com/reina0721/dsh-bot/blob/main/test/e2e.test.js)、[面板](https://github.com/reina0721/dsh-bot/blob/main/test/panel.test.js)，全部离线临时文件/fake 宿主/mock UI，涵盖严格 base64、大小/文件名/扩展名、开关、文件及目录符号链接、固定目录、并发与强制重名不覆盖、500 项排序/总量及上传错误。M7-u 后续增加本地下载/确认删除面板（见下文）；发送仍使用主人 `/file 相对路径`，无发送面板。无新依赖、外部调用或真实 QQ 发送/浏览器验证，真实 QQ 文件兼容性未验证，#45 保持 partial；#31/#42/#49/#50 矩阵行逐字不变，remaining 47。

### M7-l 主人本地提醒（#8/#40 partial）

默认关闭的固定文本提醒基础：主人当前私聊/群聊，一次未来时间或 60–2592000 秒重复间隔，1–500 Unicode 字符，每人格默认最多 50 条；同 scope/text/time 防重。每 tick 最多 20 条，统一 outbound 访问/限频/leak guard/dry-run；重复跳过错过次数，安全失败至少 60 秒后重试，自调度不重叠且 dispose 清理。reminders/提醒人格数据组支持统计/复制/删除；异步完成固定原人格，取消/删除不复活。

仅本地主人提醒，不是 DSH jobs、长任务或 LLM 任务执行；无任意命令/外部任务调用、自动审批或提醒 HTTP/管理面板。离线 fake clock/scheduler/gateway 与本地持久化证据，真实定时器/QQ 未验证；发送超时/崩溃可能重复。#8/#40 从 none 变 partial，矩阵为 6 has / 37 partial / 3 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 行保持不变。

### M7-m B站公开评论与分享链接（#48 仍 partial）

沿用默认关闭的 content.bilibili.enabled。视频详情提供数字 aid 与固定域名 shareUrl；评论先查 view，取得有效 aid 后请求公开 reply 第一页，默认 10/限制 1–20，top_replies 优先、按 rpid 去重并保留 API 顺序。正文去标签/控制字符并限 500 Unicode 字符，只含接口自带的一层楼中楼样本，无缓存或翻页。分享离线校验完整 BV 后生成固定域名链接，不验证视频存在或查询标题。新增主人 comments/share 命令、两个 GET 路由与内容页 BV 查询；不增加 Agent 工具。

证据：[bilibili.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/bilibili.test.js)、[commands.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/commands.test.js)、[e2e.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/e2e.test.js)、[panel.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/panel.test.js)，全部为合成接口响应/fake 宿主/mock UI；覆盖去重/限额/纯文本、缺 aid 与无效 BV、默认关闭零网络、离线分享、HTTP/超时/登录与风控错误。无 Cookie/WBI/登录态/字幕/发布评论，无新增依赖；真实 B站接口、QQ 与浏览器未验证。#48 仍 partial，矩阵计数不变、remaining 47；#31/#42/#49/#50 行逐字不变。

### M7-n 操作员命令禁用列表（#14 仍 partial）

`cognition.permissions.deniedCommands=[]` 默认保持原行为。仅数组、每项严格小写命令名 `^[a-z][a-z0-9_-]{0,31}$`，去重后最多保留 100 个，非法项/非数组/超限报告 issue；`cog-permissions` 配置组提供「禁用命令」string-list。现有身份检查后、内置或模块命令派发前检查解析后的小写名，主人收到固定禁用提示、非主人静默，不调用处理服务/handler 或写配置。未知命令与帮助保持原样；未禁用的公开模块命令保留既有行为，动态策略后续命令即生效。

证据：[config.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/config.test.js)、[commands.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/commands.test.js)，全部为离线规范化与 fake 服务测试，覆盖默认/格式/边界/字段、内置与模块/大小写/静默/无副作用/未知命令/动态更新。无新增依赖或外部调用。仅命令入口 deny-list，不覆盖 API、直接服务、Agent 工具或模块同进程代码；仍无所有服务/工具逐项 allow/deny 矩阵和统一审批。#14 保持 partial、remaining 47，#31/#42/#49/#50 矩阵行逐字不变。


### M7-o 主人会话插话（#9 partial，仅 steer）

主人 `/steer 文本` 经命令身份/禁用列表/访问检查后调用 `runtime.steer(turn,text)`；active、private/group 正整数安全数字 ID、非空 1–1000 Unicode 字符。`sessionFor(turn)` 复用或创建当前 Session，向 `agent.steer` 传入 text content 与 user source；缺方法返回 STEER_UNAVAILABLE，异常返回固定 STEER_FAILED，不回显原始异常/文本；成功更新 steers/lastAt。Session 解析串行防并发新建，插话不等待普通 compose 的 turn/end。

普通回合仍走 followup，不自动 steer；非主人私聊/群聊静默，不允许群成员通过此命令注入插话。无新配置/依赖，不写配置或直接调用模型，无插话面板/API。M7-o 交付时未含 typing；M7-q 私聊输入状态见后文。steer 仅 fake agent 离线服务/命令测试，真实 DSH/QQ 未验证。#9 从 none 改为 partial（38 partial / 2 none），remaining 47；#31/#42/#49/#50 保持原状态与豁免。

### M7-p 可选群聊词法记忆相关度（#20 仍 partial）

`cognition.turn.groupRelevance={enabled:false,minScore:0.15}` 默认不改变行为，`cog-turn` 提供开关与 0–1 阈值（超界夹取、非法值回退）。仅群聊未点名消息，在既有点名模式/概率/分钟上限/连续上限/冷却之后、分析之前，复用已检索记忆最高 `signals.relevance`；缺信号时用有界文本/摘要词法重合。无记忆或低分走既有 `skipGroup`，仍编码 ambient 记忆，记录 `low_relevance`，不调用分析/回复 LLM；点名/私聊绕过相关度，计算异常放行。

证据：[配置测试](https://github.com/reina0721/dsh-bot/blob/main/test/config.test.js)、[集成测试](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js)，离线覆盖默认关闭、阈值夹取、低分/无记忆/等于或超过阈值、点名/私聊旁路、中文/英文摘要重合与边界、计算异常、实际检索复用、既有跳过优先级和跳过仍记忆。门控无新增依赖或外部调用，不用综合检索分数/embedding；既有检索仍先执行。仅词法记忆相关度，没有 LLM 话题判断/接梗/语义分数，真实 QQ/浏览器未验证。#20 保持 partial，矩阵 6 has / 38 partial / 2 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 行逐字不变。


### M7-q 可选私聊输入状态（#9 仍 partial）

`cognition.typing={enabled:false}` 默认零调用、不改变行为，`cog-turn` 提供私聊/C2C 开关及不支持群聊的帮助。`setInputStatus(userId,eventType)` 仅接受无前导零/空白/非数字、最多 20 字符的正安全整数字符串，整数 event_type 只允许 1/2，固定调用 `set_input_status` 并透传结果/错误。

pipeline 保留原处理为 `processTurn`；仅启用且 private、有 action 时，在处理前 await 输入中 1、finally await 暂停 2。两次异常全部捕获，不影响回复或覆盖原处理异常，不记录可能包含聊天 ID 的网关错误；命令提前返回也尝试暂停。关闭/群聊/缺方法旁路，outbound/sendMedia/发送 API 不增加 typing，入站 `input_status` 仍忽略。等待沿用网关超时/重试，可能增加轮次耗时。

证据：[actions.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/actions.test.js)、[config.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/config.test.js)、[cognition-integration.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js)，均为离线/fake 网关，覆盖 payload/边界/错误、默认与严格布尔/配置字段、私聊 1/2、群聊零调用、缺方法、同步/异步失败不改回复且无 ID 日志、命令早退、处理异常与等待清理。无新增依赖；真实 QQ 未验证，没有群聊 typing/群 `set_input_status`、输入状态限频或专用状态面板（仅配置开关），未完成全量验收。#9 为 steer + 私聊 typing，仍 partial；矩阵 6 has / 38 partial / 2 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 行逐字不变。

### M7-r 固定只读操作员（#13 partial，#14 仍 partial）

`access.operators=[]` 默认保持现有行为，在 `access` 配置组提供 string-list；按私聊白名单规则转字符串、去空白/去重、单项最多 32 字符、最多 500 项。主人优先且不属于操作员；`isOperator(cfg,userId)` 与 `createAccess().isOperator(turn|id)` 读取当前配置。allowlist 对操作员私聊入站与出站返回 `operator`，群白名单与主人权限不变。

操作员只能使用 `/help`、`/status`、无参数 `/model`、`/bili`、`/groupinfo`、`/memberinfo`。`/model clear`、模型设置及其他内置/未知命令均静默，不调用服务或写配置。查询仍受当前会话访问限制；模块命令保留 ownerOnly 默认 true 与显式公开规则；deniedCommands 仍先于派发，操作员命中静默。帮助只显示该档可用命令，不列出主人模块命令。

离线访问/配置/命令/QQ 查询服务测试；无新增依赖、网络调用或真实 QQ 验证。#13 从 none 改为 partial，#14 交叉引用此档位但仍 partial；没有完整 per-tool/per-action RBAC、admin/approval 档位或统一审批。矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 行逐字不变。


### M7-s 持久化主人 QQ 管理审批（#15 仍 partial）

`cognition.qqAdmin.requireApproval=false` 默认无行为变化；开启后固定 profile/card/groupname/admin/mute/wholemute/kick/essence/recall/file 在命令参数验证后只存全局认知数据库审批待办。0–300 Unicode 字符、无控制字符、既有密钥规则命中拒绝；只存白名单字段，不复制原事件/凭据。随机 apr_32hex，10 分钟、最多 50 pending，读取/创建时持久化过期。主人 `/approvals` 最新最多10条脱敏单行摘要，`/approve apr_ID confirm`、`/reject apr_ID confirm` 始终小写字面量确认，非主人静默。

批准先消耗 pending，再由 handleAdmin 重放固定动作到原聊天，重新检查身份/原聊天访问/开关/禁用列表/参数及原 QQ/媒体限制；外部 approvalBypass 无效。拒绝无动作，批准后 executed/failed；未知/过期/已处理不可重复，失败/批准后中断无自动重试。原 req_ 请求处理与踢人/撤回 confirm 保留，不影响非管理命令。审批跨重启/人格切换保留，不随人格复制。

证据：[approvals.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/approvals.test.js)、[commands.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/commands.test.js)、[config.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/config.test.js)、[cognition-integration.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js)，全部本地存储/fake QQ，无新依赖或外部调用。#15 为持久化管理审批 + 既有请求审批/leak guard，仍无所有服务/工具统一审批、审批面板/HTTP、PII/媒体扫描；#14 操作员档位/命令 deny-list 仍 partial。矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变；真实 QQ 未验证。


### M7-u 安全本地文件下载/删除（#45 仍 partial，未发布）

新增 `readFile(name)` / `removeFile(name)`，只接受 files 目录内存储 basename（≤120，与上传同字符/扩展名白名单）；媒体与文件双开关，拒绝路径/控制字符/目录/符号链接，realpath 限定普通文件。下载句柄不跟随符号链接、校验普通文件及 inode，并按 maxBytes 有界读取；返回规范 base64、名称、大小与 MIME；删除不要求文件小于 maxBytes。缺失文件静态安全错误，不创建目录或覆盖文件。新上传长名称保留扩展名并缩短存储名；旧超过 120 字符的存储 basename 不自动迁移，新操作安全拒绝。

本地 GET `/media/file/download?name=` 返回 base64 JSON；POST `/media/file/delete {name}` 删除。媒体页列表增加下载转 Blob/显示文件名保存、删除确认、共享上传/下载/删除忙碌锁、错误 toast 与删除后刷新。证据为 [media.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/media.test.js)、[API](https://github.com/reina0721/dsh-bot/blob/main/test/e2e.test.js)、[面板](https://github.com/reina0721/dsh-bot/blob/main/test/panel.test.js) 的临时文件/fake 宿主/mock UI；无新依赖、配置、外部调用、自动发送或任意本地路径。默认仍关闭，发送沿用主人 `/file`，无发送面板，真实 QQ 文件兼容性与本轮真实浏览器未验证。#45 保持 partial；6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变。

### M7-v 手动跨平台身份登记（#32 partial，未发布）

新增 `cognition/identities.js` 的默认空全局 registry，独立 `manual_identity` kind，与既有按人格隔离的 QQ 人物 identity、迁移/复制/删除分离。记录固定为随机 `idn_` + 24 hex、platform/externalId/personId/可选标签、createdAt/updatedAt/source=manual；平台仅 qq/telegram/discord/matrix/custom，严格 ASCII ID/Unicode 标签上限、拒绝控制/格式字符和已知密钥，不保留额外字段。platform+externalId 精确唯一，重链保留 ID/创建时间；最多 5000 条，列表先筛选再按创建时间倒序、最多 100，提供 resolve/unlink/counts。

主人 `/identity` 最多列 20 条，`/identity link platform externalId personId [label]` 登记/重链，`/identity unlink platform externalId` 删除；owner/禁用列表/出站访问先于服务调用，操作员和陌生人私聊/群聊静默。错误为固定安全提示，不回显原始服务异常。记录跨重启/人格切换保留，不检查 personId 存在、不创建/修改/合并人物，也不接入既有身份解析/自动关联或消息路由。没有新配置/依赖、网络调用、HTTP/API/面板或 Telegram/Discord/Matrix adapter，默认消息行为不变。

证据：[identities.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/identities.test.js)、[commands.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/commands.test.js)、[cognition-integration.test.js](https://github.com/reina0721/dsh-bot/blob/main/test/cognition-integration.test.js)，均为离线本地存储/fake QQ，涵盖校验/密钥/容量/唯一性/筛选/计数、权限/错误、无人物修改及重启/人格切换。#32 none → partial（手动 registry 基础），仍无跨平台 adapter、自动合并、账号所有权验证或消息路由，真实跨平台未验证；当前 6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 矩阵行逐字不变。v0.11.18 已发布/live，M7-v 未发布/部署。
