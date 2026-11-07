# 变更记录

## 未发布

- 成功 setup 的内置模块默认健康空闲；输入状态、回复、示例和调度引擎启动报告空闲，媒体操作记录成功/失败；外部未埋点模块仍为 unknown，停止仍为 stopped。新增真实七个内置模块激活与媒体遥测回归。

## 0.11.14（2026-11-08，Windows 闭环测试修复）

- 修复 Windows 上 system-loop 测试先删临时 SQLite 再 close 导致的 EBUSY；改为先 close 再清理。
- v0.11.13 因 Windows 验证失败未生成 Release 资产；0.11.14 为修复后的发布。
- 1090 项测试：1086 通过、4 跳过。

## 0.11.13（2026-11-08，系统与模块闭环 v2）

- 模块健康/Provider 所有权、受控动作/手动恢复、执行 loop/交付回执、反馈/策略/研究关联、WebUI 闭环导航；修复表情包库被图片开关误伤。
- 1090 项测试：1086 通过、4 跳过。

- C08：完成 C01–C07 最终离线验收文档，记录提交链、贴纸库/发送矩阵、健康/实际所有权、动作/restart、loop/receipt/反馈/研究与 UI 目的地及两项 DSH 注册；同步架构/模块/手册/排障/实现状态。补 unhealthy 只读观察不自动恢复、人工 restart 后旧代次隔离与沙箱管理 API 拒绝集成测试，复用现有白名单、人格、贴纸和 UI 回归。
- 双格式包检查强制包含健康/动作/观测源码、ADR-018/019 与验收文档，校验包内 web 客户端闭环入口及恰好两项注册，拒绝私有模块状态/路径。证据与限制见 [C08 最终验收](docs/architecture/CLOSED-LOOP-ACCEPTANCE.md)。无新生产功能/依赖/版本或权限变化；没有浏览器二进制，未做 live/浏览器验收，无推送/部署/标签/发布。

- C07：模块详情接入核心 health/actions/operation，显示 lifecycle/health/reasons/lastError、Provider 注册/实际 owner/fallback、依赖与调度/引擎遥测；动作携带 expectedGeneration/人格凭证并确认模型/发送影响，轮询同一操作至终态，展示 STOP_PENDING/错误，busy/skip/NO_TASK/fail 不报成功，丢失接纳响应按原 requestId 查询。
- 新增核心 typed goTo 与 go 兼容导航，已挂载组件响应同页目标；B站唯一模块 panel、表情包库/主动/学习/提醒数据/配置入口和返回模块链接。认知增加「主动行为」「闭环」，闭环摘要/运行分页/详情显示阶段、交付 parts、反馈来源/观测/策略提交与研究关联，限当前人格、无正文或 QQ/事件 ID；学习移除逐任务“运行”，保留队列运行与任务重试/取消。预览/配置编辑器及外部 UI 隔离保持，无新增 DSH 注册。
- 扩展 panel/module-webui/E2E 离线测试并更新手册/排障/模块文档；提醒仅现有汇总，学习目标受最近列表限制；operation 观察不跨页面持久保存，闭环按需刷新。无浏览器或真实 QQ/模型验收；不改版本/依赖/后端契约，不推送/部署/打标签/发布。

- C06：新增 `/system/loop/summary`、`/system/loop/runs?limit=&before=&kind=&state=`、`/system/loop/detail?id=` 或 `?decisionId=` 管理只读 API（`/onebot-qq/api` 前缀）。默认 50/最多 200，按 createdAt/id 稳定分页，cursor 绑定当前人格/代次/过滤；跨人格、过期与不存在同 not-found。summary 分离进程计数、保留观测与当前业务记录，覆盖入口拒绝/过滤、readiness、模块/provider、阶段/回执、attempted/sent parts、反馈/策略与研究状态；无目标/正文/URL 标签，沿用 sandbox 拒绝与管理边界。
- Feedback 增加 incoming/reaction/manual/unknown 来源、持久事件去重、bounded sentiment/归因和 Beta before/after/trials；manual 必须携带 requestId。只凭有效 parent/实际发送 receipt 学习，outcome/decision/policy/feedback receipt 同步事务全成全败；缺少原子能力拒绝，JSON 只在事务提交发布快照。unobserved/窗口到期不产生负或中性 trial；历史来源/提交状态未知保留 unknown/null。保留原 reward/Beta 算法、rate ledger 和既有自动路径，不新增 auto-feedback。
- 新 unknown 记录真实 firstDetectedTurnId，重复/旧数据不覆盖或回填；研究每次实际 claim 单独 loop，取消/retry/中断保留各 attempt，通过真实 unknown/task/evidence/claim 引用只返回 ID/计数/状态，内容留在 learning 面。扩展事务/去重/人格/隐私/保留/首次轮次/取消重试/E2E 回归并更新 ADR-019；C06 当时未含 C07 UI，无版本/依赖变更、推送/部署/发布。

- C05：新增无正文 LoopRun/DeliveryReceipt 人格观测，显式 handle 贯穿 admitted turn、决策/生成/交付/观察、命令与主动 port；入站/受控 action 增加聚合计数/时间/拒绝计数，访问仍先于存储。executor 单独拥有 multipart 回执，DeliveryService 无 wrapper 回执，直接 outbound 仅建独立 attempt，模块发送记录核心 module/runtime 归因。
- 保留 ADR-006 的 partial+ok、真实 parts、从零开始的 failedPart、dry_run 与异常传播，无重试/补发。wait/silence/learn-only/compose skip 等未发送路径不建 receipt；异常/重启的未完成观测标 interrupted、结果未知，不推断历史。observer 失败不影响业务发送返回或异常。
- 新 kind 无 SQL migration、不随人格复制、随人格删除；16 阶段/16 回执引用/4 unknown 引用/8 KiB，按人格 loop+receipt 合计最多 5000、最长 7 天，启动/写入增量清理，无后台 timer。补充系统闭环与各边界回归、ADR-019 实现状态；不含 C06/C07 反馈/研究关联、API/UI，不改版本/依赖/传输，不推送/部署/发布，未作真实 QQ/模型在线验收。

- C04：固定 allowlist 的 module.enable/disable/restart/reload、proactivity.runOnce、learning.runPending；新增 `/modules/actions?id=`、`POST /modules/action`、`/modules/operation?id=` 或 `?requestId=`。严格字段、代次/可选人格凭证、全局 requestId 去重/冲突、每模块/依赖闭包互斥；128 条进程内记录，terminal 保留 1 小时，active 永不驱逐，满额拒绝，无自动重试。
- 内置 restart 复用缓存导入和唯一 setup 路径，逆序停止/排空、正序恢复原运行闭包，保留 enabled/config/storage/grants；新 generation 隔离旧引用。提醒分离新接纳与已捕获仓库排空，宿主参与交接冻结；主动 token/学习 lease 先撤销。10 秒 STOP_PENDING 仅观察同一 drain，保留 runtime/owner/闭包，不取消清理、不提前启动替换或 fallback。停止不确定时保留 failed owner，禁止双调度器；失败不报恢复成功。
- 既有 toggle/reload/run HTTP 共用动作 helper 并保留响应形状；外部仅 toggle/reload，manifest 不得声明 actions。补充 action/module/provider/reminder/token/lease/E2E 回归和 ADR-018 实现状态；无 C05 系统闭环、C07 UI、版本/依赖/数据迁移。操作幂等仅限当前进程保留期；永久 drain 可阻塞生命周期队列，失败 owner 可能需宿主运维处理；真实 QQ/网络/模型/浏览器未验证。

- C03：新增 generation-bound 模块健康缓存与只读 `/modules/health`（含 `?id=`，统一返回 `items/summary/collectedAt/revision`），runtimeGeneration 独立于 UI generation；旧报告与迟到调度结果不能污染新实例，停用后保留带 telemetryGeneration 的快照。
- 保留 lifecycle 原语义；健康区分未观察、正常/合法空闲、降级、业务故障与停止。原因码来自固定白名单，最多 8 条；错误仅投影固定码/宿主时间/代次。未接入或不适用遥测为 null，不猜测为零；调度与已接入的引擎/命令/事件/配置/输入状态/回复规划回调分别记录有界计数。
- Provider 注册与实际所有权分离；提醒宿主发布交接/排空/失败及 core fallback，另三个 provider 仅报告模块激活，无核心回退。健康 GET 只复制内存元数据，不运行模块/provider 探针、不读文件/配置、不排队等待 stop、不触发恢复。现有提醒尽力停止失败保留 failed owner，不能视为已证实排空；本阶段不改变其兼容回退行为。
- C03 不含 restart/actions、operation registry、系统闭环或 UI；计数为当前 runtime 中已接入工作入口的聚合，不覆盖媒体远程操作、学习来源/模型内部每个步骤，也不追溯历史。未验证真实 QQ/模型/网络故障与浏览器。

- C01：拆分表情包库与发送授权，修复关闭 `media.images.enabled` 时列表、上传、标签、删除及文件预览被误禁用的问题；模块、媒体或表情包开关关闭仍关闭库，发送继续要求图片开关及媒体/delivery 服务可用。
- `/media/status.stickers.available` 保留为库可用性别名，新增库/发送可用性及拒绝原因；媒体页按库状态开放管理并说明图片关闭导致发送禁用，模块草稿预览区分库和发送，配置帮助同步修正。
- 补充 16 种开关组合、库管理/预览、服务缺失、异步复查、一次性/过期令牌与 access/rate/leak/dryRun 回归。配置键、数据、依赖及版本不变。

## 0.11.12（2026-11-08，媒体/主动/学习内置模块）

- 新增默认启用的 `builtin-media-features`、`builtin-proactivity`、`builtin-learning`；三个模块各自独占行为/timer/命令，核心保留资源、状态、LLM/预算、delivery 与安全边界。
- 模块关闭后功能停止，无核心回退所有者；配置键、默认值和既有数据保持不变。
- 947 项测试：943 通过、4 跳过、0 失败。

### 模块 3：builtin-learning

- 默认启用 builtin-learning，独占固定 learning provider、自动 unknown→task 规划/入队、pending/run、来源迭代与 timer；核心删除自动入队/学习 runner/timer，无 fallback。默认 enabled:true/autoResearch:false 保持，手动运行/取消/重试经过当前 provider，停用返回 MODULE_DISABLED；知识读取与未知检测保留，无追溯建任务。
- 内置固定 learning:service 窄端口、一次 attempt 的人格/代次/runtime/版本 lease；核心保留来源/页面、LLM/预算、同步事务与数据，证据去重/complete 幂等，私聊/开关/取消/停止阻止迟到发布。首次约 30 秒、完成后 60 秒，每 tick 最多一个到期 pending，suggested 不自动运行。
- 16 个原配置归模块详情 legacy-core 与纯 learning.preview；原认知页操作经 provider，无可选模块 panel 或 DSH 新入口。保留 ID/数据/配置和既有未完整执行字段语义，补充 ADR-017、生命周期/port/UI/归档检查。无版本/依赖变化、推送、部署、tag 或发布；未验证真实来源/模型/QQ/浏览器。

### 模块 2：builtin-proactivity

- 默认启用 builtin-proactivity，独占主动策略/提示词/排序/退避与单递归 timer；新增仅固定模块可注册的 proactivity 槽位和 proactivity:service 窄端口。删除 core 主动引擎与 timer；统计/手动运行及原 HTTP 通过 facade，停用返回 MODULE_DISABLED，无 fallback，提醒所有权不变。
- run token 捕获人格/切换代次/runtime，投影有效私聊候选、有限记忆/风格；固定核心 proactive/220 tokens/0.8 调用与一次 delivery/outbound 发送，保留预算和 access/rate/leak/dryRun。修正旧私聊 scope/关系维度混用；迟到 memory/LLM 不发送，已接纳发送以原人格写规范 decision/proactive_intent 回执，无 raw error/通用存储/凭据/provider 选择。
- 七个原配置字段归属模块详情 legacy-core 与纯预览，键/默认关闭/数据及 /quiet、/active 保持，无 panel/新 DSH slot。补充 engine/port/provider/生命周期/出站/UI/包验证和 ADR-016。无学习策略、依赖、版本变化，无推送、部署、标签或发布；真实 QQ/模型 provider/浏览器未验。

### 模块 1：builtin-media-features

- 默认启用 builtin-media-features，独占 Bilibili 解释/命令和贴纸策略/命令；新增固定 mediaFeatures 槽位和内置专用 media:features 窄端口，提醒订阅隔离。删除核心 Bilibili 服务与两个功能命令实现，模块停用后命令静默、相关 HTTP fail closed，无核心回退。
- 核心固定 Bilibili 四操作的 origin/端点/headers/超时/2 MiB 流式响应上限并拒绝重定向；贴纸用一次性、绑定授权聊天和生命周期的 commandToken，核心解析/校验文件并经 delivery/outbound 发送一次，不暴露路径、字节或凭据。媒体 transport/provider/存储继续留核心。
- 六个原配置字段移入模块详情，沿用键/默认值/保存；新增纯预览及 Bilibili 操作 panel，原内容页保留入口指引。贴纸控件留核心媒体页并通过 provider 授权，status 在禁用后仍可读。补充行为对等、受众/访问、令牌/生命周期、路由关闭、UI/包验证及 ADR-015。无数据迁移、版本/依赖变化、新 DSH slot、推送、部署、标签或发布；未做真实 provider/QQ/浏览器验收。

## 0.11.11（2026-11-07，模块 WebUI v1）

- 模块 WebUI Phase 5：外部仅可通过 ui:sandbox 权限、sandbox 描述和显式绑定授权运行不透明源 iframe；state.json 追加 uiGrants，绑定 id/UI revision/entry/公开资源 SHA-256，停用保留授权、撤销保留配置。独立 generation 资源路由实施公开路径/扩展名/MIME/realpath/符号链接/大小检查与强制 CSP、no-store/nosniff，变更或无授权关闭。详情增加确认授权/撤销与禁用说明，iframe 固定 allow-scripts/no-referrer；v1 nonce 桥仅 ready/有界 resize/纯文本 notify，验证 source/生命周期/字段并清理。宿主 API 拒绝 opaque origin 与 frame/子资源请求。补充安全测试、作者示例与威胁模型；真实浏览器 sandbox/CSP 未验证，不支持外部同源 React/宿主配置或 API/DSH slots。无依赖、版本、推送、部署、tag 或发布。

- 模块 WebUI Phase 4：外部 module.json 可声明有界 config schema，复用内置验证器、64 KiB 限制、原子 config.json、revision 与 MODULE_CONFIG_*；setup 前恢复，api.config.get/onChange 仅暴露本模块值，不授予内置特权，拒绝外部配置符号链接/目录逃逸。外部有效 schema 可 opt-in module-file 配置元数据与 module.config/schema，详情由核心通用编辑器渲染，enabled 且 loaded 时可编辑，其余只读，保留「外部声明式」徽章。无 schema 配置不可用，无效 UI 安全回退，目录无配置值/路径。补充清单、存储/权限、HTTP 与面板回归及作者示例；无外部 React、componentKey、可执行 WebUI、新 DSH slot 或依赖，沙箱/iframe/能力消息桥/执行器尚未实现。无版本升级、推送、部署、tag 或发布。

- 模块 WebUI Phase 3B：仅受信内置可声明 builtin-react 与冻结编译期白名单 reply-delivery.preview、typing.preview、reminders.preview、sample.preview；四个 module.detail 替换为纯 React 只读预览，保留 module.config/schema 与全部编辑/保存流程。组件只接收冻结的有界模块元数据、各自配置草稿与只读摘要，无 DOM 注入、请求或副作用。服务端拒绝外部 builtin-react、未知 key、非 builtin-react 的 componentKey、重复 hook 与可执行值；客户端经 uiFor 查冻结表，未知 key 安全回退，外部从不执行。/modules/ui 仍无配置值、函数或路径。补充契约、目录/E2E 与面板测试；同步 ADR-014、MODULES、架构说明。无配置值、版本、依赖、DSH 注册变化，无推送、部署、tag 或 release；外部声明式扩展/沙箱/iframe/能力消息桥留待后续。

- 模块 WebUI Phase 3A：reply-delivery/typing/reminders 的 12 个既有核心字段新增有界 module 归属元数据，内置 legacy-core 描述改为 available:true、schemaVersion:1。模块详情复用 FieldRow、全局 draft/saveUiPatch/prefStatus；停用或未 loaded 时只读，系统设置去除重复字段与空 cog-reminders 组，保留通知/请求及其余轮次设置。sample 保持 module-file 编辑与 revision 流程；`/modules/ui` 无配置值，无新增后端配置端点。存储键 cognition.reply.*、cognition.typing.enabled、cognition.reminders.*、默认值、规范化及运行行为不变，无数据迁移。补充字段归属、详情/系统去重、精确保存路径、只读与 sample 回归；同步 MODULES、ARCHITECTURE、ADR-014。受信 React、自定义组件与外部 UI/沙箱/iframe/能力消息桥仍待后续，无版本、依赖或 DSH 注册变化，仅本地验证与提交。

- 模块 WebUI Phase 2：核心模块页提供卡片/详情 → 独立详情 → 返回列表，显示来源/信任、启用/运行状态与错误；status surfaces 仅显示安全文本，未来 hooks 为禁用占位。builtin-sample 的通用配置移入详情，移除列表行内表单，沿用 `/modules/config`、revision、保存重读、取消与 MODULE_CONFIG_* 错误语义；停用/未 loaded 模块配置只读。三个 legacy-core 模块仅显示 Phase 3 迁移说明并链接原认知设置分组；未知/无效/过期 UI 回退为核心状态信息。补充面板导航、只读、配置/错误、安全回退与两项 DSH 注册回归；更新 MODULES、架构及 ADR-014 状态。无后端配置/所有权迁移、内置自定义 React、外部执行/沙箱、新 DSH 入口、依赖或版本变化；仅本地验证与提交。

- 模块 WebUI Phase 1：新增 ADR-014、严格 v1 UI 描述契约与只读 `/modules/ui` 目录（信任/生命周期 generation/UI revision/配置归属元数据），四内置声明 detail/config 占位；外部显式 opt-in 仅允许 status/schema，未知/超限描述固定告警且不阻止有效后端。现有模块页增加核心详情/信任/状态/surface 占位与安全回退，保留启停、重载和 sample 行内配置。补充契约、HTTP/E2E、面板回归；无配置迁移、外部 UI 执行、沙箱、新 DSH 入口、依赖或版本变化，仅本地验证与提交，无推送/部署/tag/release。

## 0.11.10（2026-11-07，Windows 原子替换测试修复）

- 修复 Windows CI 的模块配置并发测试：不再在写入期间保持配置文件只读句柄；Windows 不允许 rename 覆盖仍打开的文件，导致测试误报两次写入失败。
- v0.11.8/v0.11.9 因 Windows 验证失败未生成 Release 资产；0.11.10 为修复后的发布候选。

## 0.11.9（2026-11-07，模块架构 v3 发布修复）

- 修复 Windows CI 的模块配置 revision 并发测试：不再假设两个并发 Promise 的完成顺序，按 fulfilled/rejected 查找并验证恰好一成一冲突；生产代码无变化。
- v0.11.8 标签因 Windows 验证失败未生成 Release 资产；0.11.9 为通过 Windows/Linux 验证后的发布。

## 0.11.8（2026-11-07，模块架构 v3）

- 架构优化 Phase 15（仅文档）：新增模块架构发布就绪与授权边界，记录 Phase 11–14 精确提交链、离线验收证据、四内置/外部及媒体边界、待授权的推送合并/版本标签 Release/live 安装与 smoke/回滚方案。0.11.8 仅为后续版本提议；本阶段不改生产代码、配置、依赖或版本，未推送、合并、发布或部署，live 操作须用户明确授权。

- 架构优化 Phase 14（最终验收）：固定 11 项外部特权的普通/伪造 builtin 清单双组拒绝测试，验证无注册或宿主副作用；补充无权限调用、媒体资源/路由缺失与媒体权限/provider 槽位拒绝、provider 来源/权限/撤销及生产四内置目录验收。补验 SQLite/JSON 的提醒 all/capture 人格隔离、生命周期撤销与全局五字段配置/无路径秘密；沿用单所有者排空交接/失败回退证据。ADR-013 明确媒体传输/存储/provider/HTTP/文件约束继续属于核心，本程序不提取 builtin-media 服务；未来仅可经宿主 media port 提取功能策略/命令，无数据迁移。增加最终验收说明，更新架构/模块/状态/README，包检查确保文档与四内置独立加载。无生产行为、新模块、配置/UI/依赖/版本变化；仅离线验证，无 live/浏览器，不推送/部署/发布，部署与版本另行授权。

- 架构优化 Phase 13：新增默认启用的 builtin-reminders（内置共四个），沿用 cognition.reminders 只读配置与原 persona-scoped reminder 数据；共用核心/模块规则和精确命令文案，通过 reminders provider、scheduler、仓库与窄 access/delivery API 接管三个提醒命令及单 timer 调度，停用恢复核心。provider subscribe 以安全元数据通知，宿主串行等待旧所有者排空再接管，启动失败清理后回退；核心增加幂等 stopReminders。仓库 capture 固定在途原人格，all 支持完整防重/额度与按聊天限量；取消/删除/替换不被旧结果覆盖，最终同步卸载禁止迟到写库。新 API 仅内置权限开放，外部不可注册 provider。补充注册表、切换/失败/异步清理、命令/数据对等、调度/人格/出站闸门、e2e 与独立包测试及 ADR-012。无数据迁移、配置/UI/媒体/依赖/版本变化；仅本地验证，不推送/部署/发布，未做真实 QQ 验收。

- 架构优化 Phase 12（仅前置端口）：新增仅内置 reminders:service / api.reminderRepository，同步 get/list/findDue/countActive/put/update/remove 固定访问当前人格核心 reminder kind，无迁移或 module_store 副本；严格 ID/目标/状态/时间/行字段验证，list 最多 50、到期先排序后取最多 20，写入/输出复制，补丁仅限投递状态，不暴露 base store/SQL/路径/跨人格参数。独立 config:read / api.legacyConfig.section 仅开放 cognition.reminders 当前规范化五字段深拷贝，无秘密、其它配置、写入或通知。外部声明在导入前拒绝，缺权限无属性，停止/失败/依赖清理/dispose 撤销旧端口；补充双后端、隔离/权限/生命周期/配置与核心互通测试和 ADR-011。现有提醒服务与测试保持，不提取提醒/媒体、无新增生产模块或 provider、配置/UI/REST/依赖或版本变化，仅本地验证，不推送/部署/发布。

- 架构优化 Phase 11（基础设施范围）：新增仅内置可用的 provider 注册表，固定白名单 reminders、单槽唯一注册、身份绑定幂等注销及纯元数据列表；模块 providers:register 权限随 runtime 清理，外部来源或缺权限拒绝。认知保留提醒服务构造/命令/存储/清理，移除 init 自动启动，改为幂等 startReminders；宿主等待 modulesReady 后选择 provider 或核心，provider 启动失败先尽力停止再核心回退，卸载先调用 provider.stop 并防迟到启动。默认没有生产 provider，仍只启动一次原核心提醒调度器，原业务开关与行为保持。新增注册表/权限/生命周期/宿主选择及卸载竞态测试，提醒集成测试显式激活，补充 ADR-010 与模块/架构文档；不提取提醒/媒体、不新增生产模块、配置/UI/REST/依赖或版本，仅本地校验，不推送/部署/发布。

- 架构优化 Phase 10（有限范围）：新增 commands:override 权限与 api.registerCommand 的 overrideBuiltin:false 默认选项，仅同时声明 commands/commands:override 的受信任内置模块可显式覆盖受保护命令；外部伪造来源或缺权限在 setup 中失败。核心 allowProtected 严格 true 才放行，重复模块注册始终拒绝；覆盖优先分发，保留 ownerOnly/deniedCommands，handler 前检查会话访问，回复沿用统一 command 交付路径。身份绑定 disposer 与 runtime 清理在停用、setup/事件失败、依赖禁用/重载、dispose 后恢复原核心分支，旧 API 不可注册；执行/发送失败不重试核心。新增权限/访问/交付/重复/生命周期回归测试、模块/架构文档与 ADR-009；仅为提醒迁移前置 API，不提取提醒/媒体，生产内置仍三个，无新配置/UI/REST/依赖或版本，仅本地校验，不推送/部署/发布。

- 架构优化 Phase 9（有限范围）：新增 persona:store 权限，仅内置模块获得同步 api.personaStore.get/put/remove/list/count；外部声明在导入前拒绝。安全 key、module:<id>:<key> 命名空间与当前人格 facade 隔离，JSON 值进出 structuredClone、每值 UTF-8 JSON 最多 64 KiB、每模块每人格最多 1000 条；事务检查额度、支持满额覆盖，无 raw kind/SQL/底层 store/跨人格参数。生命周期结束撤销旧 API 且保留数据，人格删除清理所有模块记录；复用 cognition SQLite/JSON，无独立持久层。新增仓库/生产接线/重启/清理测试、模块/架构文档与 ADR-008；不是通用 DB，不提取提醒/媒体，不新增生产模块、依赖、配置/UI/REST 或版本，仅本地校验，不推送/部署/发布。

- 架构优化 Phase 8（有限范围）：仅向声明 scheduler 权限的内置模块暴露 api.scheduler.setTimeout(fn,delayMs) → {id,dispose} 与 clearTimeout(id) → boolean；数字整数延迟 0–2,592,000,000 ms、每 runtime 最多 64 个活跃 timer，不透明 ID 按模块/生命周期隔离。按单调截止时间分段避免 Node 32 位 timeout 溢出；停用、失败、依赖重载和 dispose 清空 timer，generation/注册检查阻止迟到回调。同步/异步异常及 logger 错误隔离，固定日志不含聊天 ID/payload。新增调度器测试、模块/架构文档和 ADR-007；不提取提醒/媒体，无 interval/cron/持久化、新生产模块、配置/UI/依赖或版本变更，仅本地校验，不推送/部署/发布。

- 架构优化 Phase 7（有限范围）：DeliveryResult 新增 sent/dry_run/partial/failed/empty 状态；后续分条失败保留 ok:true 和已发消息，显式返回 partial、sentParts、零基 failedPart 与 PARTIAL_SEND，不重试、不回滚。DeliveryService 移除 parts:1 固定覆盖，单条真实成功为 1、失败/dry-run 为 0，保留 outbound 结果字段；pipeline 统计/pending/群聊记账与调用方 ok 分支保持不变。补充执行器、pipeline、服务精确结果测试及 ADR-006；频率账本、传输重试、leak guard 顺序和 shutdown 留待后续，不改 typing/媒体/提醒/模块 API/规划器，无新依赖/配置/UI、版本变更或 live 操作。

- 架构优化 Phase 6：私聊 typing 迁入默认启用的 builtin-typing，通过仅内置可用的 turn:lifecycle/status:write 窄 API 执行轮次开始/结束状态；保留默认关闭的 cognition.typing.enabled 及原 UI/normalizer，无模块配置。核心 turn hooks 顺序开始、逆序结束、逐项错误隔离和固定安全日志；生产空 registry/模块停用不 typing，旧未注入 harness 保留原内联路径。覆盖模块权限/清理、原处理异常、私聊/群聊/配置/错误、宿主目录 builtin=3、面板和独立包加载，新增 ADR-005。无媒体/提醒改造、新依赖、版本变更或 live 操作。

- 架构优化 Phase 5：新增单条 DeliveryService，经既有 DeliveryPlan 执行器与 outbound 闸门统一认知命令、模块 sendText、proactivity 和 Agent qq_send_text；生产共享注入，旧 harness 保留 outbound 兼容。保留 source/decisionId/dryRun 与结果字段，补充 parts:1，无 direct gateway 回退或拒绝后重试。新增服务、生产接线与四类入口回归及 ADR-004；面板人工 /send、媒体/文件、提醒保持原路径，不改 planner/分条或限频/重试/部分成功/leak guard，不新增依赖/配置、不升级版本。

- 架构优化 Phase 4：默认启用 builtin-reply-delivery，通过仅内置可用的 delivery:plan 权限与生命周期 registry 规划回复分条、首条引用/群聊 @、条间等待和末条余文合并；保留 cognition.reply.*，纯 splitter 移至 delivery 并兼容旧导入。内部 engine 默认 auto（无规划器走 core），core 可显式回退，planner 缺失或规划抛错/无效时经原 outbound 安全闸门单条纯文本回退，安全日志不回显异常。pipeline 复用 DeliveryPlan 执行器并保留空白/dryRun/部分成功、统计/pending/归因；补充 registry、权限/生命周期、模块、引擎矩阵、宿主/面板与独立包验证及 ADR-003。回复模块没有独立配置/API/UI，不改全局配置字段、命令、入站、版本或 parity；未推送、发布、部署，未做真实 QQ/浏览器验收。

- 架构优化 Phase 3：仅内置 registry 支持声明式配置 schema（7 种非秘密字段），服务端验证、默认值、独立 64 KiB 原子 config.json 与 revision 冲突控制；setup 前加载，提供深拷贝 api.config.get 和生命周期 onChange，损坏配置安全回退。模块面板复用 FieldRow/FieldControl 行内编辑、保存重读、取消与错误提示；默认关闭的 builtin-sample 回复改读 message 配置。新增模块/HTTP/面板回归测试与配置契约文档；外部模块不开放配置 API/UI，不改全局 /config、入站、交付或回复分条，不升级版本、不推送/发布/部署，未做真实 QQ/浏览器验收。

- 架构优化 Phase 2：将 `host.onEvent` 原始事件编排抽到注入依赖的 ingress coordinator，保持访问闸门 → raw 归档 → 规范化 → 缓冲/过滤 → observe → 非阻塞模块分发 → 同 record 广播的顺序、错误隔离与日志。新增仅内部使用的 v1 OneBot envelope 和既有标识关联值，不扩展公共事件/hook；补充入站行为测试与 ADR-002。无新配置/依赖，不改 UI、认知、模块内核、交付或分条，不升级版本、不发布、不部署，未做真实 QQ/浏览器验收，parity 矩阵不变。

- 架构优化 Phase 0 + Phase 1：刻画既有回复投递语义，新增纯 DeliveryPlan builder、校验/单条纯文本回退与 DeliveryExecutor，pipeline 保留原 core 路径并增加显式启用的 planner 路径。内部 `cognition.delivery.engine=core|planner` 默认 core，可切回；原 `cognition.reply.*`、outbound 安全闸门、统计/pending/逐条归因保持。补充 core/planner 离线行为对等测试与 ADR-001；不新增模块/schema/ingress 改造，不升级版本、不发布、不部署，未做 live/浏览器验证，parity 矩阵不变。

## 0.11.7（2026-11-06，内置与外部模块架构）

- 模块架构 v2：统一内置/外部目录，静态冻结 registry 与默认关闭的 builtin-sample（主人 `/module-sample` 固定回复）；保留 builtin- 命名空间，关闭时不导入/运行。共享 apiVersion=1、requires 校验和依赖图，拓扑加载、逆序清理、error/blocked 隔离、外部重载级联与内置代码缓存。
- 状态兼容旧 disabled 并新增 enabled，先原子持久化再改变运行状态；外部 manifest enabled:false 保持硬上限。内置数据写 modules/.builtin/<id>/data.json（1 MiB、包含关系检查），不写包内源码；API 新增来源/能力/依赖/summary，面板显示数量/来源/阻塞、刷新和状态提示。
- 增补离线内核/API/面板/备份/独立包加载验证与模块契约文档。无核心迁移、远程安装、上传、依赖下载、沙箱、watcher 或移除接口；未改版本、未发布/部署，parity 矩阵与 remaining 47 不变。

## 0.11.6（2026-11-06，双预算与 bot 名称）

- 面板入口、概览页标题与导航 aria 名称使用 bot 自身名称：当前人格 `profile.displayName` → QQ 登录昵称 → `dsh-bot`，清理控制字符与首尾空白、最多 40 个 Unicode 字符。index 安全注入初始名称，`/status.brand` 更新页头；改名或切换人格后侧栏需刷新网页。面板 ID、其他标签和「关于 dsh-bot」保持不变；补充离线注入/回退/面板测试，未做 live 或真实浏览器验证。
- LLM 预算支持 `global|persona|both` 三模式，默认 `global`，保留全局 `dailyTokenBudget=300000`；新增 `personaDailyTokenBudget=300000`（1000–5000000）。始终记录全局 `llm_usage` 和人格 `llm_usage_persona`，`both` 的有效剩余取最小；在途调用记入开始时的人格。恢复全局存储语义，移除中间实现的人格迁移，不自动合并已迁移的历史数据；预算计数不复制，删除人格仅清除人格计数。
- `cog-llm` 字段上方双预算卡片展示模式、两行已用/预算/剩余、UTC 日期、有效剩余、80% 提示与耗尽警告，支持刷新、加载/错误重试及独立确认重置。GET 返回双状态；POST 需 `confirm:true` 与有效 `scope`，只重置服务器当日选定计数，不改配置、不调用模型。补充离线服务/API/React shim 测试及[设计说明](docs/design/llm-budget-card.md)。未部署，未做真实浏览器或 live 验证；parity 矩阵不变，remaining 47。

## 0.11.5（2026-11-06，修复 Agent preset）

- 修复 `dsh-bot-private` 预设 compaction 组缺少 `compaction`/`toolResultPruner` isolate realm，导致真实 Agent 生成失败 `Preset services require isolate realms`；补上与 DSH 标准预设一致的 isolate 映射。

## 0.11.4（2026-11-06，用户接受当前 parity）

- 用户于 2026-11-06 明确接受当前 parity 并收束；remaining 47、8 项豁免，不宣称全量对齐。

- M7-v：新增默认空的全局手动身份链接 registry（独立 `manual_identity` 存储），主人 `/identity` 最多列 20 条，`/identity link platform externalId personId [label]` 登记/重链，`/identity unlink platform externalId` 移除。随机 `idn_` + 24 hex、五种平台白名单、严格 ID/干净标签/已知密钥拒绝、platform+externalId 唯一、最多 5000 条；服务支持解析、筛选/最新 100 条与计数，重链保留 ID/创建时间并更新 personId/标签。owner/禁用/访问闸门，操作员和陌生人静默，失败固定安全提示；离线服务/命令/重启及人格切换测试。无人物创建/修改/合并、自动验证/关联或消息路由，无 Telegram/Discord/Matrix adapter、新配置、依赖、外部调用、HTTP/API 或面板；默认不改变消息行为。#32 none → partial（手动登记基础），6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变。v0.11.3 已发布/live，本改动未发布或部署，真实跨平台未验证。

## 0.11.3（2026-11-06，live 文件面板已验证）

- live 0.11.3 上传/列表/下载/删除 `smoke.txt` 成功，随后恢复 media/files 关闭；真实 QQ 文件发送仍未验证。

- M7-u：媒体页文件列表新增本地「下载」「删除」，删除需确认，上传/下载/删除共用忙碌锁，错误 toast，删除后刷新。新增 `readFile(name)` / `removeFile(name)`、`GET /media/file/download?name=`（base64 JSON）和 `POST /media/file/delete {name}`；只接受固定 files 目录中的存储 basename（≤120），沿用媒体/文件双开关及扩展名白名单，拒绝路径、控制字符、目录和符号链接，校验 realpath/普通文件。读取受 maxBytes 限制并以不跟随符号链接的句柄有界读取，缺失文件安全报错；新上传的长名称保留扩展名、缩短存储名以满足 120 字符上限，wx 不覆盖。无新依赖/配置或外部调用，默认仍关闭；面板不发送，发送沿用主人 `/file`，真实 QQ 文件兼容性未验证。#45 仍 partial；矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变。

## 0.11.2（2026-11-06，已发布；live 部分验收）

- live `web` 已升级到 0.11.2，`connected`；0.11.1 的主人 `/status` 与私聊 typing 证据保留，0.11.2 未重跑；`/approvals` 验收请求未观察到回复。

- M7-t：新增主人 `/purpose plan ID`，仅活跃 goal 且标题/描述非空时调用现有 JSON LLM；去控制字符，严格校验 1–8 条非空唯一、每条最多 200 UTF-16 单元的步骤，仅更新 steps 并回复当前聊天。无效 JSON/步骤、缺服务和目标在等待期间变化均安全失败；完整 ID/唯一前缀、owner/禁用/访问闸门。`/purpose step ID N [done|undo]`（1–20，默认 done）只改指定步骤完成标记，`/purpose steps ID` 查看步骤/进度；沿用目的服务进度与完成规则，undo 不自动 resume。无新配置/依赖或默认行为变化，未使用 plan 无新增 LLM 调用；没有自主执行器、动作绑定或审批集成。离线 fake LLM/目的服务测试，真实模型/QQ 未验证、未部署；#38 仍 partial，矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47。

- M7-s：新增默认关闭的 `cognition.qqAdmin.requireApproval=false` 与 QQ 管理配置开关；十种管理/文件命令校验后可进入持久化全局审批队列（`apr_` + 32 随机 hex，10 分钟、最多 50 pending），拒绝控制字符/已知密钥，固定字段无额外凭据。主人 `/approvals` 最多列 10 条脱敏单行摘要；`/approve apr_ID confirm` 先持久化批准再经 `handleAdmin` 向原聊天重放，复核身份/访问/禁用/配置/参数并记录 executed/failed；`/reject` 拒绝不执行，未知/过期/重复 ID 安全失败，外部 bypass 无效。同 ID 一次处理，失败/中断无自动重试；原 `req_`、踢人/撤回 confirm 与默认直接执行行为保留。无审批 HTTP/面板、全服务/工具统一审批或 PII/媒体扫描；#15 仍 partial，#14 操作员档位/deny-list 仍 partial。离线 fake QQ/持久化测试，无新增依赖或外部调用、未部署；矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47。

- M7-r：新增默认空的 `access.operators`（string-list、同私聊列表规范化、去重最多 500 项）。主人优先；操作员可在 allowlist 私聊入站/出站（原因 `operator`），群仍需白名单。固定只读命令为 help/status/model（无参数）/bili/groupinfo/memberinfo，其他内置、模型设置/清除和未知命令静默；查询服务仅开放允许群的只读操作。模块默认 ownerOnly 保留，显式公开命令不变；deniedCommands 仍优先拦截且操作员静默。新增离线访问/配置/命令/查询服务测试，无新依赖。#13 从 none 改为 partial，#14 交叉引用并保持 partial；无完整 per-tool/per-action RBAC、admin/approval 档位或统一审批。矩阵 6 has / 39 partial / 1 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 不变，真实 QQ 未验证。

## 0.11.1（2026-11-06，部分真机验收）

- live `web` 已升级到 0.11.1；健康 `connected`，新增 API 200、真实入站/回复、`/send`、备份已验证。typing 已开启但验收窗口内无私聊入站，未观察到 input_status；主人命令 `/status` 已真实往返（message_id 770603012 / 回复 890788338）；私聊 typing 经主人确认看到输入状态；真实 GitHub upgrade check 成功，B站公开接口被 412/-352 风控，离线分享可用。

- M7-q：新增 `setInputStatus(userId,eventType)`，严格正安全整数字符串 ID（无前导零/非数字、最多 20 字符）与整数 1/2 校验，固定 `set_input_status` payload；新增默认关闭的 `cognition.typing={enabled:false}` 和轮次面板开关。仅私聊/C2C 的 `handleTurn` 在原 `processTurn` 前等待输入中、`finally` 等待暂停；两次异常均捕获，不改变回复/原异常、不记录原始网关错误或聊天 ID。默认零调用，群聊/缺方法旁路，命令早退与处理异常也清理；不改 outbound/sendMedia/发送 API，入站 `input_status` 仍忽略。新增离线 action/配置/集成测试，无新依赖。没有群聊 typing/群 `set_input_status`、输入状态限频或专用状态面板；真实 QQ 未验证，尚未部署/全量验收。#9 为 steer + 私聊 typing，仍 partial，remaining 47，#31/#42/#49/#50 不变。

## 0.11.0（2026-11-06，部分真机验收）

- live `web` 已升级到本地 0.11.0 构建并完成部分真实 QQ smoke：健康/新增 API 200、真实私聊入站与回复、`/send` message_id、本地备份；主人命令/媒体/审批/typing/提醒投递等仍未验收。详见 [验收证据](docs/assets/live-acceptance-2026-11-06.json)。

- M7-p：新增默认关闭的 `cognition.turn.groupRelevance={enabled:false,minScore:0.15}` 与 `cog-turn` 面板开关/阈值。仅群聊未点名消息，保留点名模式/概率/分钟上限/连续上限/冷却的优先顺序，再按已检索记忆最高 `signals.relevance`（缺失则有界词法重合）检查；阈值夹取 0–1，无记忆或低分走既有 `skipGroup`，仍写 ambient 记忆、记录 `low_relevance`，不进入分析/回复 LLM。点名与私聊绕过相关度、异常放行；关闭时无行为变化，无新增依赖或外部调用。仅词法记忆相关度，无 LLM 话题理解/接梗/语义打分；#20 仍 partial、remaining 47，#31/#42/#49/#50 不变。
- M7-o：新增主人 `/steer 文本` 与 `runtime.steer(turn,text)`，active agent/当前 private 或 group 正整数安全数字 ID/非空 1–1000 Unicode 字符校验；复用或创建 Session，按 DSH UserMessage 交给 `agent.steer`，成功计入 stats.steers/lastAt。Session 解析串行防并发新建，插话不等待 compose 结束；缺方法 STEER_UNAVAILABLE，异常固定 STEER_FAILED，不回显原始异常/文本。命令经 owner/禁用列表/访问闸门，非主人私聊/群聊静默；普通回合仍只用 followup，不自动 steer、不写配置或直接调用模型。无新配置/依赖、typing/set_input_status 或插话面板/API；fake agent 离线测试，真实 DSH/QQ 未验证。#9 从 none 改为 partial，remaining 47，#31/#42/#49/#50 不变。
- M7-n：新增操作员命令禁用列表 `cognition.permissions.deniedCommands`，默认 `[]` 保持原行为；仅数组、严格小写命令名 `^[a-z][a-z0-9_-]{0,31}$`、去重且最多保留 100 个，非法项/非数组/超限报告 issue。配置组 `cog-permissions` 提供「禁用命令」string-list 字段。身份检查后、派发前拦截内置与模块命令，主人收到固定提示，非主人静默；大小写命令不能绕过，不调用命令服务/handler 或写配置。未知命令与帮助保持原样，既有公开模块命令未列入时仍可用；新增离线配置/命令测试，无新依赖或外部调用。仅命令入口 deny-list，没有所有服务/工具的逐项 allow/deny 矩阵或统一审批；#14 保持 partial、remaining 47，#31/#42/#49/#50 不变。
- M7-m：B站公开评论与离线分享（#48 仍 partial）。视频新增数字 aid/shareUrl；评论先查 view，再读公开 reply 第一页，limit 默认 10/上限 20、置顶优先、rpid 去重、纯文本正文最多 500 Unicode 字符、一层楼中楼样本。新增主人 `/bili comments BV号`、`/bili share BV号`、两个 GET 路由与内容页 BV 查询；完整 BV 校验、缺 aid/HTTP/超时/风控明确报错，分享仅生成链接且不验证视频存在。沿用默认关闭开关，无 Cookie/WBI/登录态/字幕/发布评论/缓存/新增 Agent 工具或依赖；仅离线测试，真实 B站未验证。remaining 47，#31/#42/#49/#50 不变。
- M7-l：新增默认关闭的主人本地提醒服务与 `/remind <秒|ISO时间> <文本>`、`/reminders`、`/forgetreminder <id>`。固定 1–500 Unicode 字符文本，当前私聊/群聊数字 ID；未来一次时间或 60–2592000 秒重复间隔，每人格默认最多 50 条活跃提醒、同作用域/文本/时间防重。每 tick 最多 20 条，经统一 outbound 访问/限频/leak guard/dry-run；重复提醒跳过错过次数，失败至少 60 秒后重试，只存固定安全错误。自调度不重叠、dispose 清理；await 后写原人格，取消/删除不会复活。新增 reminders/提醒人格统计/复制/删除组和配置字段；离线服务/命令/集成测试，无依赖、自动审批、任意代码/外部任务调用或 LLM 执行，无提醒 HTTP/面板。真实定时器与 QQ 未验证；#8/#40 从 none 改为 partial，remaining 47，#31/#42/#49/#50 不变。

- M7-k：媒体服务新增本地 `saveFile/listFiles`、`GET /media/files`、`POST /media/file/upload` 和媒体页「文件」上传/列表/刷新。要求媒体与文件开关；安全 basename≤120、文件扩展名白名单、非空严格规范 base64、解码大小上限、15 MiB JSON 请求体限制；固定 files 目录、根/目录 realpath 检查、拒绝目录及文件符号链接、wx 防覆盖。列表最新优先最多 500 项，totalBytes 统计所有合格文件。客户端预检大小/扩展名、上传防重与独立错误提示，保留既有媒体 UI。无文件发送/删除/下载面板，发送仍用主人 `/file 相对路径`；新增离线服务/安全/API/面板测试，无新依赖/外部调用/真实 QQ 发送，未改 cordis.patch.yml。#45 仍 partial，真实 QQ 未验证；#31/#42/#49/#50 及 remaining 47 不变。

- M7-j：十种已知 QQ 通知（含名片/群名/头衔/精华/离线文件）校验后写入当前人格时间轴，确定性去重；好友/群 add/invite 请求按 flag 去重，只存 pending。新增主人 `/requests`（最多 10 条）、`/approve ID confirm`、`/reject ID confirm`，服务复核 owner/开关/状态，仅调用固定请求 action，成功记录处理元数据、失败安全报错；无自动审批。flag 不进入公共列表/回复/日志，备注和通知文本复用已知密钥脱敏/去控制字符与长度上限。同 ID 并发防重，完成写入固定原人格；请求纳入人格数据统计/复制/删除。两个新开关默认启用，配置可热关闭；离线 fake 网关测试，无新增依赖/外部调用/请求 API/审批面板/Agent 工具。#3/#15 仍 partial（真实 QQ 未验证、无统一审批/逐项权限或 PII 检测），#31/#42/#49/#50 不变，remaining 47。

- M7-i：新增本地出站文本 leak guard，默认启用 + redact，可选 block；识别高置信度 OpenAI/GitHub/AWS AKIA/Bearer/PEM 私钥和至少 16 字符的 api_key/apiKey 值，重叠合并、100k UTF-16 单元上限（超限整体脱敏/阻止）。访问/限频后、dry-run/网关前检查，block 返回 LEAK_BLOCKED 与 leakBlocked 计数，成功脱敏返回 leakGuard=redacted；日志只有类别/次数，网关异常不回显。配置安全组可改，安全页只读开关/策略，没有扫描内容/密钥；新增离线规则/出站/配置与 mock 面板测试。无新依赖/外部调用/自动审批，无 PII/熵或媒体/文件扫描，可能误报/漏报，不重组跨段/跨消息；人工发送/raw action 等独立路径不覆盖。#15 仍 partial（缺统一审批/逐项权限），#31/#42/#49/#50 不变，remaining 47。

- M7-h：通用旧档案导入新增 `kind=timeline`（默认仍为 memory），支持 events/timeline 等 JSON 数组包装与 JSONL；事件正文/标题/必填时间/作用域白名单规范化，独立 `timeline_event` 与确定性 `tle_` ID，幂等不覆盖。时间轴默认合并事件并支持 event 筛选，记忆页可选导入种类并显示结果种类；事件纳入人格数据统计/复制/删除。共用 cognition.import 限额，仅计数日志；新增离线服务、时间轴、面板与 API 回归。无新依赖、外部调用或 QQ 发送；#30 仍 partial（无 Aurabot 专用迁移、向量导入或真实旧档案样本），#31/#42/#49/#50 状态不变。
- M7-g：仅 UI 使用既有 API，人物页可内联编辑当前人格 facet 内容/置信度/active 或 disputed（含 group-scope 群印象，保留原作用域与删除）；关系页保留只读条，逐卡调整 API 返回的 10 维（-1–1），仅显式保存变化项，由后端记录 source=ui 历史。支持取消、保存期间禁用、防重复提交、失败 toast/草稿保留与刷新；新增 6 项 mock 面板测试。无后端/API/Agent 工具/自动审批变更，无新依赖、不发送 QQ；既有后端 UTF-16 截断仍保留。#29 仍 partial：无独立人物说话方式编辑器、无 Aurabot 专用人物/群档案导入，未做本轮真实浏览器验证。

- M7-f：新增默认关闭的 OpenAI 兼容 embeddings 与异步记忆重排；配置 Base URL/模型/密钥环境变量/0–1 权重，32 条批次、4000 字符、8–4096 维校验、超时/禁重定向及 2000 项内存 LRU。pipeline/主动任务 await，保留同步词法检索，失败词法回退且不重复强化。无新依赖、默认零 embedding 网络；离线 fake 测试，不含本地模型/独立 reranker/向量数据库或全库向量召回，真实 provider 未验证，#31 仍 partial。

- M7-e：更新 current-architecture / parity-roadmap 视觉（Archify 3.0.1，四门通过；不声称人工感知评审），新增发布检查表、回滚与声明边界。仍不宣称全量 parity。

- M7-d：新增 `archive-import.js`、`POST /cognition/import` 与认知记忆页「导入旧档案」。通用 JSON/JSONL 导入当前人格，默认 5 MiB/5000 项（可调低）；正文/作用域/人物/时间戳/类型白名单校验、确定性 ID 幂等去重、仅计数日志；新增 `cognition.import` 配置及离线服务/API/面板测试。不联网、不自动发送 QQ，无新依赖；无 Aurabot 专用迁移、向量或时间轴事件导入，无真实旧档案样本验证，#30 仍为部分实现。
- M7-c：默认关闭的 OpenAI 兼容生图/改图服务、`/draw` `/redraw` `/image` 主人命令、`/media/image/generate|edit` 和媒体页「生图/改图」。prompt 1–1000 字符、五档尺寸、限媒体大小的 PNG b64_json 落盘；不抓返回 URL，改图源限媒体根内相对路径/realpath/扩展名/大小；只支持兼容 edits。面板/API 不发送 QQ；命令先过 access，无新依赖，fake provider 自动化，真实 provider/QQ 未验证，#44/#46 仍为部分实现。
- M7-b：记录 2026-11-06 明确用户豁免（远端 API 鉴权、QQ空间、模块市场/远程安装、25 页级面板、迁移/离峰），审计新增 exempt 计数与目标校验；其他差距不变。豁免是用户决定，不是实现证据。
- 新增默认关闭、仅主人/当前会话的资料、群管、精华、撤回和媒体根内文件命令；独立 `cognition.qqAdmin` 配置，踢人强制 confirm、撤回默认确认，消息归属核实与根内 realpath 校验；破坏性动作记录简短元数据审计。仅命令、不新增 Agent 工具或任意 action 透传；真实 QQ 管理/资料/文件动作未验证。

- M7-a：新增 `check:parity` 矩阵审计、JSON 输出、源码/测试静态计数与结构检查；新增 `smoke:temp` 临时 DSH profile 冒烟脚本，启动前关闭 QQ 连接，仅请求本机状态 API 并创建一次本地备份，结束后清理。新增审计测试与当前差距/证据文档；不宣称全量对齐，不改变运行时行为。

- M6-b：新增「安全」顶层标签（共 15 个），只读展示访问控制/最近 5 条审计、危险面与上线检查清单；模块审核始终为人工提醒，媒体只检查配置字段完整性。新增默认关闭的手动 GitHub Releases 检查及 `/upgrade`、`/upgrade/check`，状态查询不联网；支持内存缓存、强制检查、版本比较与 stable/beta 过滤（仅最近 10 条、排除 draft）。不自动检查、更新、下载或安装，无 token 支持；未认证 API 每 IP 每小时 60 次。保持 DSH 本机信任边界，无 API 鉴权变更、工作区迁移或离峰省钱策略。

- M6-a：新增本地目录快照服务、备份 REST API 与「备份」页；默认包含配置/模型/认知/模块/表情包，可选全部本地媒体；200 MiB、5000 文件、保留 10 份（可配置），原子发布与按需清理。校验路径/符号链接/文件 hash，默认只暂存恢复；应用需 `ops.backup.allowRestore=true` 并先创建恢复前备份。备份含秘密；SQLite 必须停写后复制，恢复后重启。无 zip、云端传输、自动恢复或迁移；版本检查由 M6-b 单独提供。

- M5-b：主人私聊 DSH Session 运行时挂载 3 个当前会话 QQ 工具（额外文本、点赞、戳一戳；群查询保留 /groupinfo /memberinfo 命令），注册失败隔离且卸载时清理；不含通用 action bus、资料编辑、群管、精华或文件工具。
- M5-b：新增默认关闭的 B站公共内容服务、主人 `/bili` 命令、搜索/热门 REST API 与「内容」页；仅使用无需 Cookie/WBI 的公开接口，不含评论/分享。QQ空间因需要 QQ 登录授权及服务条款审查明确不实现；真实 B站/QQ 验证待办。
- M5-a：新增仅限本地的模块内核：manifest 与权限门控、动态加载/热重载/启停、错误隔离、模块命令/规范化事件/1 MiB JSON 存储、只读认知接缝、统一 outbound 文本发送、REST API 与「模块」面板；模块需由操作员复制到数据目录，不含上传、远程下载、依赖安装、沙箱或 marketplace。
- M4-a：新增默认关闭的媒体基础层：受大小/扩展名限制的图片、语音、文件入站下载，OpenAI 兼容 Vision/ASR/TTS，base64 图片/语音发送、OneBot 群/私聊文件上传，以及 `/media/status|test|tts` API；不含媒体面板、表情包市场、RVC 或生图。
- M4-b：新增本地表情包库（PNG/JPG/JPEG/GIF/WebP、5 MiB/张、200 张、SHA-256 去重、人工标签）、安全的上传/列表/按 ID 取图 API、媒体面板，以及主人命令 `/tts` `/say` `/sticker`；仍不含自动收集/语境选图、商城、RVC、生图或 Agent 媒体工具。
- 安装 Archify 视觉层（`@tt-a1i/archify-dsh@1.0.0`，内含 Archify 3.0.1）到当前 `web` profile；新增 `docs/ARCHIFY.md` 记录版本、验证、限制与回滚。
- 新增 `docs/visuals/`：当前架构、目标架构、消息生命周期、轮次状态机、里程碑路线图 5 张可交互 HTML，附 candidate JSON 与 finalize/browser-check 证据。
- 新增 `docs/research/GAP-AURABOT.md`：与 Aurabot v1.2.0 的量化对照、14 域 parity matrix、M1–M7 路线图与完成定义。
- 校正 `IMPLEMENTATION-STATUS`（0.10.0 / 157 项）、`CAPABILITY-MAP`（目标态模块名）、`THIRD_PARTY_NOTICES`（Aurabot 复用范围 + Archify 声明）、文档导航与 README 入口。
- M3-c：时间轴只读聚合（轮次/记忆/决策，before/type/scope 过滤）+ 认知「时间轴」页。
- M3-a：目的系统（goal/plan/intent；CRUD/优先级/进度/步骤/作用域；少量注入 compose；`/purpose` 命令；认知「目的」页）。
- M3-b：每日记忆整理与按作用域 LLM 反思（04:00 调度；只压缩已有记忆；面板「整理/反思」；`/cognition/consolidation/run`）。
- M2-b：合并转发展开（`get_forward_msg` 兼容 id/message_id），展开内容进入轮次与记忆并标记不可信。
- M2-b：拍一拍回应（按用户冷却、只回应拍机器人）、表情回应记正向 outcome。
- M2-b：QQ 动作命令 `/like` `/poke` `/groupinfo` `/memberinfo`（仅主人、仅当前会话）。
- M2-a：长回复分条（`cognition.reply.split/maxChars/maxParts/delayMs`），优先段落/句末标点，内容不截断。
- M2-a：回复引用可配（`reply.quote`）、群聊 @ 发送者可配（`reply.atSender`）；每条分条都经过 outbound。
- M2-a：新增连续未点名接话上限（`turn.maxConsecutiveGroupReplies`），点名回复清零；与冷却/每分钟上限并存。
- M1-c：新增 QQ 命令（`/status` `/quiet` `/active` `/model` `/remember` `/forget` `/help`，仅主人；非主人静默）。
- M1-c：新增 `cognition.modelRouting`（私聊/群默认 + 会话覆盖）与 `/model` 写回；provider 在直连列表时走 direct，否则 DSH。
- M1-c：`/quiet` `/active` 写回群聊参与与主动开关；`/remember` `/forget` 使用记忆服务的 remember/forgetMatching。
- M1-b：新增可选 DSH Session 运行时（`runtime.engine=agent`）：每聊天 Session、`dsh-bot-private`/`dsh-bot-social` preset、`agent.followup` + `session/event` 取最终回复、超时/串行、oneshot 自动回退。
- M1-b：bundle patch 新增两个 agent preset；host 注册 `{{dshbot_persona}}` / `{{dshbot_rules_private}}` / `{{dshbot_rules_social}}` 提示词变量。
- M1-b：概览运行诊断显示 engine/active/会话数；新增 `/runtime/stats`、`/runtime/sessions`；默认仍为 oneshot。
- M1-a：新增访问控制（`access.mode=open|allowlist`、主人 QQ、私聊/群白名单、审计环形缓冲）与 `/access/stats`、`/access/check`。
- M1-a：认知侧自动消息统一走 `src/cognition/outbound.js`（访问 → 频率 → dryRun → 发送），pipeline 与主动行为不再各自直连发送。
- M1-a：概览页新增访问控制卡片；配置页新增「访问控制」分组；`allowlist` 下被拒消息不落 raw、不聚合、不回复。
- M0 仅为文档与环境变更，不改 dsh-bot 运行时代码；运行时/权限从 M1 开始。

- 添加真实 DSH 桌面概览截图、合成数据演示流程与脱敏验证摘要。
- 添加 image 模型生成的宣传横幅和方形分享图，记录素材来源及提示词。
- 更新 README、文档导航与已发布的 GitHub 下载入口说明。

## 0.10.0

- 项目、插件、界面和包统一为 dsh-bot，插件移至仓库根目录。
- 数据目录改为 plugins-data/dsh-bot，覆盖变量改为 DSH_BOT_DATA_DIR；旧数据需手动迁移。
- 保留 OneBot API 路径与事件契约。
- 建立分层文档、GitHub Release 安装包、校验文件和跨平台安装脚本。
- 新增离线测试、文档检查和发布产物检查流程。
- 兼容 Node 22.13 未编译 FTS5 的 SQLite：保留数据库与事务，检索使用词法匹配。

历史功能与验证材料见 [归档](docs/archive/README.md)。
