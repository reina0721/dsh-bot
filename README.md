# dsh-bot

认知设置的 `cog-llm` 组提供全局/人格双计数、`global|persona|both` 三种预算模式（默认全局 300000），卡片支持分别确认重置全局或当前人格的 UTC 今日用量；[使用说明](docs/USER-MANUAL.md#33-按聊天选模型与-qq-命令主人只读操作员)。

![dsh-bot 宣传插画：会话、人格与记忆的连接](https://raw.githubusercontent.com/reina0721/dsh-bot/main/docs/assets/promo/dsh-bot-hero.png)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供 QQ 接入、人格与认知服务的插件。通过 OneBot v11 连接 NapCat、SnowLuma、Lagrange.OneBot 或 LLOneBot，提供网页管理面板和本地持久化。

## 实机演示

下面是在真实 DSH `0.2.1-rc.3` 中运行 `dsh-bot v0.10.0` 的历史演示截图（当前工作区为 v0.11.11）。账号、人格和消息为合成演示数据，QQ 链路使用仓库自带的模拟 OneBot 网关；不代表真实 QQ 登录或外部模型调用。

![真实 DSH 面板：模拟网关已连接、账号核验通过、事件计数和人格概览](https://raw.githubusercontent.com/reina0721/dsh-bot/main/docs/assets/screenshots/overview-desktop.jpg)

[查看演示环境、验证结果与复现步骤](docs/DEMO.md)。顶部横幅为 AI 宣传插画，实际界面以实机截图为准。

## 能力与要求

- 手动跨平台身份登记（M7-v，未发布）：默认空的全局 registry；主人 `/identity` 列表、`/identity link platform externalId personId [label]` 登记/重链、`/identity unlink platform externalId` 移除。只存人工对应关系，不创建/修改/合并人物；无新配置/依赖、网络调用、API/面板、Telegram/Discord adapter、自动验证或消息路由，QQ 行为不变。#32 为 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变；见[身份登记用法](docs/USER-MANUAL.md#手动跨平台身份登记m7-v)。

- QQ 管理审批（M7-s，未发布）：`cognition.qqAdmin.requireApproval=false` 默认保留直接执行；开启后管理/文件动作写入持久化主人待办（10 分钟、最多 50 条），`/approvals` 查看，`/approve apr_ID confirm` 批准后在原聊天执行，`/reject apr_ID confirm` 拒绝。既有 `req_` 请求处理和原动作 confirm 保留。无审批 HTTP/面板、全服务/工具统一审批或 PII/媒体扫描；#15 与 #14 操作员/deny-list 仍 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt、remaining 47。仅 fake QQ 离线测试，见[配置](docs/CONFIG.md#qq-管理审批m7-s)。

- QQ 连接、账号核验、事件接收、群聊与私聊消息发送。
- 访问控制：`open`/`allowlist`、主人 QQ、默认空的只读操作员列表、私聊/群白名单、统一出站闸门与审计。
- 可选 DSH Session 运行时：`runtime.engine=agent` 时每聊天一个 DSH Session；仅主人私聊在运行时挂载 3 个当前会话 QQ 工具，失败自动回退 oneshot。
- 只读操作员（M7-r，未发布）：`access.operators=[]` 默认保持行为；仅 `/help`、`/status`、无参数 `/model`、`/bili`、`/groupinfo`、`/memberinfo`。allowlist 放行其私聊，群仍须白名单；主人优先，模块 ownerOnly 与命令禁用列表保持约束。无完整 per-tool/per-action RBAC 或 admin/approval 档位；#13 partial、#14 仍 partial，矩阵 6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47。见[访问配置](docs/CONFIG.md#310-访问控制access)。
- QQ 命令（主人）：`/status` `/steer` `/quiet` `/active` `/model` `/remember` `/forget` `/identity` `/tts` `/say` `/sticker` `/bili` `/help`；支持按聊天覆盖模型。
- 主人会话插话（M7-o）：`/steer 文本` 将 1–1000 Unicode 字符注入当前 agent Session，复用或创建会话；oneshot 不可用。仅显式主人命令，不自动 steer、不写配置；无插话面板/API，真实 DSH/QQ 未验证，#9 为 partial，remaining 47；见[用户手册](docs/USER-MANUAL.md#32-会话运行时实验默认关闭)。
- 私聊输入状态（M7-q）：`cognition.typing={enabled:false}`，默认关闭；开启后私聊/C2C 轮次前后调用 `set_input_status`（1 输入中、2 暂停），失败不影响回复。依赖网关支持，无群聊输入状态/群 `set_input_status`、输入状态限频或专用状态面板；仅离线测试，真实 QQ 未验证。#9 仍 partial，remaining 47，#31/#42/#49/#50 不变；见[配置](docs/CONFIG.md#私聊输入状态m7-q)。
- 命令禁用列表（M7-n）：`cognition.permissions.deniedCommands=[]` 默认保持原行为；本机面板维护者可按小写命令名禁用内置或模块命令，派发前拦截且不调用处理服务或写配置。仅覆盖命令入口，没有所有服务/工具的逐项权限矩阵或统一审批，#14 仍 partial，remaining 47；见[配置](docs/CONFIG.md#命令禁用列表m7-n)。
- M7-l 新增默认关闭的主人本地提醒：`/remind <秒|ISO时间> <文本>`、`/reminders`、`/forgetreminder <id>`。只发送固定文本，按人格和当前聊天隔离，统一经过访问控制、限频与文本防泄漏；没有 DSH jobs、长任务、LLM 任务执行或提醒管理面板/API。真实定时器/QQ 未验证，#8/#40 仅 partial，remaining 47。使用方法见 [用户手册](docs/USER-MANUAL.md#本地主人提醒m7-l)。
- 回复分条、可配引用/@、连续未点名接话上限，避免长文刷屏与自说自话。
- 群聊词法相关度（M7-p）：`cognition.turn.groupRelevance={enabled:false,minScore:0.15}`，默认保持原行为；开启后未点名消息按已检索记忆词法相关度门控，无记忆/低分只写记忆、不分析，点名绕过，异常放行，无新增外部调用。无 LLM 话题理解/接梗/语义打分，#20 仍 partial、remaining 47；见[配置](docs/CONFIG.md#群聊词法相关度门控m7-p)。
- 合并转发展开、拍一拍回应、表情表态归因；主人命令 `/like` `/poke` `/groupinfo` `/memberinfo`。
- 可选媒体：图片下载/视觉描述、语音 ASR/TTS、图片/语音发送、群/私聊文件上传，以及本地表情包库与媒体面板；M7-c 增加 OpenAI 兼容生图/改图和 `/draw` `/redraw` `/image`；外部 provider 默认关闭。
- 本地文件面板（M7-k/M7-u，M7-u 未发布）：媒体页上传、列出、下载、确认删除并刷新 `files/` 文件，显示相对路径/大小/时间；下载用 base64 JSON 转 Blob，上传/下载/删除共用忙碌锁并显示错误。要求媒体与文件双开关，仅安全存储 basename≤120、白名单扩展名、普通非符号链接文件，无任意本地路径；默认行为不变。发送仍用主人 `/file 相对路径`，无发送按钮，真实 QQ 文件兼容性未验证，#45 仍 partial。矩阵 6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 不变。
- 统一模块目录：内置 media-features、reply delivery、typing、reminders 默认启用，sample 默认关闭；内置可启停，外部本地 JS 可重载（清单关闭不能强开）。外部稳定 API 不开放服务所有权或内置特权，模块仍是同进程可信代码。Bilibili/贴纸策略与命令由 builtin-media-features 独占，停用无核心回退；媒体传输、凭据和贴纸存储仍属核心，配置/数据不迁移。见[模块契约](docs/MODULES.md)与[媒体功能决策](docs/architecture/ADR-015-builtin-media-features.md)。
- 可选 B站公共内容（M7-m）：搜索、热门、BV 视频信息与公开评论、离线分享链接，提供 `/bili comments BV号`、`/bili share BV号`、REST API 与「模块 → 媒体功能」操作面板。默认关闭，不使用 Cookie/WBI/登录态，不含字幕或发布评论；真实接口未验证，#48 仍 partial，remaining 47。QQ空间因登录授权与服务条款边界未实现。
- 本地目录备份与「备份」面板：默认 200 MiB / 5000 文件 / 保留 10 份；恢复默认暂存，应用需显式开启并先创建恢复前备份。快照含密钥与认知隐私，请按秘密保护；复制 SQLite 前停止写入，恢复后重启。无 zip、云端传输、自动恢复或工作区迁移，见[备份说明](docs/USER-MANUAL.md#备份)。
- 「安全」页：只读访问审计与危险面、上线检查清单；默认关闭的手动 GitHub Release 版本检查，stable/beta 仅改变发布过滤，不自动更新、下载或安装。保持 DSH 本机信任边界，不改变 API 鉴权；不提供工作区迁移或离峰省钱，见[安全与上线检查](docs/USER-MANUAL.md#安全与上线检查)。
- 目的系统（目标/计划/意图，面板与 `/purpose` 管理）；M7-t（未发布）新增主人 `/purpose plan ID` 生成并保存最多 8 步，`/purpose step ID N [done|undo]` 手动标记、`/purpose steps ID` 查看进度。无新配置，仅显式 plan 调用现有 JSON LLM，不执行步骤/绑定动作/接入审批；#38 仍 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt、remaining 47。见[目的用法](docs/USER-MANUAL.md#36-目的与记忆整理)。每日记忆整理与按作用域反思；时间轴只读回忆日志。
- 可选语义检索（M7-f）：默认关闭的 OpenAI 兼容 embeddings 重排词法候选，出错回退词法；仅 fake provider 离线测试，真实 provider 未验证。无本地模型、独立 reranker 或向量数据库，见[配置](docs/CONFIG.md#可选语义检索cognitionmemoryembeddingm7-f)。
- 多人格管理，按人格隔离记忆、人物、关系、情绪及策略数据。
- QQ 通知与请求（M7-j）：十种已知通知写入当前人格时间轴，好友/群申请只存待办；主人 `/requests` 查看、`/approve ID confirm` 或 `/reject ID confirm` 显式处理。无自动审批/审批面板，真实 QQ 未验证，#3/#15 仍 partial；见[用户手册](docs/USER-MANUAL.md#33-按聊天选模型与-qq-命令主人)及[配置](docs/CONFIG.md#qq-通知与请求m7-j)。
- 出站文本防泄漏（M7-i）：默认启用 + 脱敏，可选阻止；仅统一认知出站 text 段，安全页只读开关/策略。无 PII/熵或媒体/文件扫描，可能误报/漏报；#15 仍 partial（缺统一审批/逐项权限）。见[安全配置](docs/CONFIG.md#38-安全security)。
- 人物/群印象与关系编辑（M7-g）：当前人格 facet 内容/置信度/状态、原作用域内的关系维度手动调整，显式保存并记录人工来源；见[认知面板用法与边界](docs/USER-MANUAL.md#认知)。
- 旧档案导入：认知记忆页/API 将通用 JSON/JSONL 导入当前人格，支持记忆（默认）或时间轴事件，默认最多 5 MiB/5000 项，按作用域/人物/正文（事件还含时间）幂等去重，本地处理。
- OpenAI Chat/Responses、Anthropic、Gemini、Ollama 等模型协议与路由配置。
- 连接、消息、人格、模型、认知、日志及系统设置面板。

需要 DSH >=0.2.0 <0.3.0、Node.js >=22.13.0，以及已登录的 OneBot v11 网关。运行时无额外第三方依赖。能力边界见[实现状态](docs/cognitive/IMPLEMENTATION-STATUS.md)，长期目标见[项目愿景](docs/research/VISION.md)。

## 安装与下载

`v0.11.11` 已发布，可通过以下 GitHub 直链安装或下载；真实 QQ/媒体验收仅完成部分，见[发布检查表](docs/RELEASE.md)。

| 入口 | 下载 |
| --- | --- |
| 最新稳定版 | [安装包 tgz](https://github.com/reina0721/dsh-bot/releases/latest/download/dsh-bot.tgz) · [解压包 zip](https://github.com/reina0721/dsh-bot/releases/latest/download/dsh-bot.zip) |
| 固定版本 0.11.11 | [安装包 tgz](https://github.com/reina0721/dsh-bot/releases/download/v0.11.11/dsh-bot.tgz) |
| 完整版本与校验文件 | [GitHub Releases](https://github.com/reina0721/dsh-bot/releases) |
| 开发源码 | [main.zip](https://github.com/reina0721/dsh-bot/archive/refs/heads/main.zip) |

将 desktop 换成实际使用的 DSH profile：

```sh
dsh plugin --profile desktop add https://github.com/reina0721/dsh-bot/releases/download/v0.11.11/dsh-bot.tgz
```

也可下载并查看安装脚本后执行：

```powershell
Invoke-WebRequest https://raw.githubusercontent.com/reina0721/dsh-bot/main/scripts/install.ps1 -OutFile install.ps1
.\install.ps1 -Profile desktop -Version 0.11.0
```

```sh
curl -fL https://raw.githubusercontent.com/reina0721/dsh-bot/main/scripts/install.sh -o install.sh
sh install.sh --profile desktop --version 0.11.0
```

脚本验证发布包 SHA-256，支持自定义 DSH 路径；不会自动重启 DSH。源码安装在仓库根目录执行 `dsh plugin --profile desktop add .`。详见[安装、升级与回退](docs/INSTALLATION.md)。旧版用户先阅读[迁移说明](docs/MIGRATION.md)。

M7-c 生图/改图与普通图片发送已接入服务、主人命令和媒体面板。生成/改图默认关闭，仅接收受大小/尺寸限制的 PNG base64，不抓取返回 URL；源图限媒体根内相对路径，realpath 防符号链接逃逸。改图只支持 OpenAI 兼容 edits；面板/API 只落盘，QQ 命令先检查 access。自动化使用 fake provider，真实 provider/QQ 生图改图未验证，#44/#46 仍保留差距。配置和限制见 [CONFIG 媒体](docs/CONFIG.md#39-媒体media) 与 [用户手册](docs/USER-MANUAL.md#37-媒体与表情包m4-am4-bm7-c)。

M7-b 新增默认关闭的主人 QQ 管理命令：资料、当前群管理、精华/撤回与媒体根内文件上传。需启用 `cognition.qqAdmin.enabled`，踢人始终 `confirm`、撤回默认确认；群管需机器人具备权限，无任意 action 透传或新增 Agent 工具，真实 QQ 管理/资料/文件动作尚未验证。用法见 [用户手册](docs/USER-MANUAL.md#33-按聊天选模型与-qq-命令主人)，配置见 [CONFIG](docs/CONFIG.md)。2026-11-06 用户批准的发布门槛豁免见 [GAP §8.1](docs/research/GAP-AURABOT.md#81-用户批准豁免)，其他差距继续跟踪。

M7-h 扩展通用 JSON/JSONL 旧档案导入：记忆页选择「记忆」（默认）或「时间轴」，或调用 `POST /cognition/import` 并指定 `kind: "memory"或"timeline"`，内容写入当前人格并幂等去重。时间轴事件要求提供时间，在时间轴的「事件」筛选中查看；本地处理、不自动发送 QQ。无 Aurabot 专用迁移或向量导入，尚无真实旧档案样本验证，#30 仍 partial。格式与用法见 [用户手册](docs/USER-MANUAL.md#36-目的与记忆整理)，开关和限额见 [CONFIG](docs/CONFIG.md#导入旧档案cognitionimportm7-d)。

M7 发布候选的强制检查、回滚与声明边界见 [发布检查表](docs/RELEASE.md)；当前未达全量 parity，不得宣称与 Aurabot 完全一致。

## 首次连接

1. 在 QQ 网关启用正向 WebSocket 与 HTTP 服务，设置 access token。
2. 重启目标 DSH profile，从侧栏 bot 名称入口填写网关地址、token 和机器人 QQ 号；入口与概览页标题优先使用当前人格 `profile.displayName`，为空时依次回退 QQ 登录昵称、`dsh-bot`，改名或切换人格后刷新网页更新入口。
3. 保存并连接，确认「已连接」「核验通过」，再到消息页测试收发。
4. 打开「安全」页检查白名单/主人、备份、raw action、媒体 provider 与本地模块审核状态。

配置默认存放于 `$DSH_HOME/plugins-data/dsh-bot/`，可用 DSH_BOT_DATA_DIR 覆盖。不要公开含密钥的配置文件。

## 文档与开发

[文档首页](docs/README.md) · [用户手册](docs/USER-MANUAL.md) · [配置参考](docs/CONFIG.md) · [本地模块](docs/MODULES.md) · [模型网关](docs/MODEL-GATEWAY.md) · [Aurabot 对标](docs/research/GAP-AURABOT.md) · [视觉基线](docs/visuals/README.md) · [故障排查](docs/TROUBLESHOOTING.md) · [贡献指南](CONTRIBUTING.md) · [变更记录](CHANGELOG.md)

```sh
npm test
npm run check:docs
npm run check:parity
npm run smoke:temp # 需要本机 DSH；仅临时 profile，不连接 QQ/外部服务
npm run pack:release
npm run check:package
```

[对标审计与临时 profile smoke](docs/PARITY-AUDIT.md)记录当前计数、剩余项与证据边界；审计会因矩阵结构错误返回 1，剩余差距本身不会导致失败。`smoke:temp` 可用 `DSH_BIN=/path/to/dsh` 指定 DSH，始终新建并清理临时 `DSH_HOME`。

目录：src/ 为宿主实现，client.js 为网页面板，test/ 为测试，scripts/ 为开发与安装工具，docs/ 为用户、开发与研究文档。

## 许可

[MIT](LICENSE)。复用来源及版权声明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
