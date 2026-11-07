# 实现状态（v0.11.15 发布后，M7-v 工作区）

闭环 v2 当前基线（C01–C07 已实现，C08 离线验收，I/T/L）：七个内置模块（sample 默认关闭），贴纸库/发送授权分离；模块 health、实际 Provider owner、固定动作与人工 restart/operation；人格隔离 loop/receipt、反馈事务/provenance 与研究 attempt；核心 UI 健康动作、导航与闭环。提交链和测试/双格式包证据见 [C08 最终验收](../architecture/CLOSED-LOOP-ACCEPTANCE.md)。C08 仅文档/测试/包断言，保持 0.11.12，无新生产功能、自动 restart、exactly-once、外部同源 UI 或权限扩展。环境无浏览器二进制，未作 live/浏览器验证（不标 V），无 push/部署/tag/release。以下各阶段及计数为历史记录，不代表 C08 当前全套结果。

one-shot 模块 1（未发布，I/T）：新增第五个默认启用的 builtin-media-features，独占 Bilibili 解释/命令和贴纸策略/命令。核心固定窄 transport 与一次性发送令牌，媒体凭据/文件/存储保留核心；模块停用关闭相关命令与 HTTP，无功能回退。六个配置字段与 Bilibili 面板移入模块详情，贴纸控件留核心并咨询 provider，配置/数据无迁移。详见 [ADR-015](../architecture/ADR-015-builtin-media-features.md)。以下 Phase 14 等段落保留历史阶段记录。

模块架构 Phase 14（未发布，I/T）：在 Phase 13 基线上只补边界测试、最终文档与包验收；四个生产内置为 reply delivery、typing、reminders、sample，前三个默认启用，sample 默认关闭。外部稳定 API 的 11 项内置特权与 source/builtin 伪造逐项拒绝；provider 仅 builtin-reminders，宿主排空旧所有者再交接/失败回退核心；提醒仓库固定当前人格，capture 固定在途原人格，只读配置只含全局五字段，无路径/秘密泄漏。媒体传输/存储/provider/HTTP/文件约束保留核心，不提取 builtin-media 服务，无数据迁移。没有生产行为、配置/UI/依赖/版本变化；仅离线验证，无 live/浏览器，本阶段无推送/部署/发布。证据与限制见[最终验收](../architecture/MODULE-ACCEPTANCE.md)和[ADR-013](../architecture/ADR-013-media-boundary.md)。

Bot 名称面板（未发布，I/T）：侧栏入口、概览页头与导航 aria 使用当前人格 `profile.displayName`，空值回退到 QQ 登录昵称 / `dsh-bot`；名称去控制字符/首尾空白，最多 40 个 Unicode 字符。index 安全注入初始名称，`/status.brand` 驱动页头更新，侧栏改名需刷新网页；保留 `onebot-qq` ID 与「关于 dsh-bot」。离线覆盖解析、注入转义/清理、缺少 tapIndex 的宿主和 React shim；未做 live / 真实浏览器验证，parity 矩阵与计数不变。

M7 双预算可视化/重置（未发布，I/T）：始终跟踪全局 `llm_usage` 与当前人格 `llm_usage_persona`；`budgetScope=global|persona|both`，默认 global，两个限额默认各 300000，both 有效剩余取最小。恢复全局存储并移除中间迁移，不自动重建已迁移历史。`cog-llm` 双行卡片提供模式/有效剩余、80%/耗尽、加载/错误/重试，分别确认重置全局或当前人格今日用量；GET/需 `confirm:true` 和有效 scope 的 POST 只访问本地计数，不改配置、不调用模型。在途调用归起始人格；计数不复制，删除人格仅清除人格用量。仅离线测试，未做 live/真实浏览器验收；parity 矩阵不变，remaining 47。见[设计](../design/llm-budget-card.md)。

0.11.3 已发布并 live，M7-v 为尚未发布的工作区改动；以下功能基线以当前工作区代码与测试为准，真实 QQ 验收另记，不代表全量验收。与 Aurabot 的全量差距与里程碑见 [GAP-AURABOT](../research/GAP-AURABOT.md)。

> M7-b：2026-11-06 用户批准 #16（仅远端 API 鉴权）、#47 QQ空间、#52 模块市场/远程安装、#55 25 页级面板、#59 迁移/离峰为发布门槛豁免；保留本机-only/CSRF 行为。豁免是明确用户决定，不是实现证据；#42/#44/#49/#50 及其他差距不豁免。精确范围见 [GAP §8.1](../research/GAP-AURABOT.md#81-用户批准豁免)。

> 本文按「真实代码 + 真实测试」核对，不用设计文档冒充完成。
> 状态：**I** 已实现、**T** 有自动化测试、**V** 真实 DSH/浏览器验证、**L** 受限实现、**N** 尚未实现。
> 基线：`dsh-bot@0.11.3` 发布后工作区，M7-v 实跑 584 个测试（580 通过、0 失败、4 项既有 live 模型测试跳过），详情见 [审计记录](../PARITY-AUDIT.md)；认知 + 模型协议 + 人格工作台/群聊参与 + 多人格库 + 人格级认知数据 + 人格导入/模型自检 + M4-a/M4-b 媒体与表情包 + M5-a 本地模块 + M5-b QQ Agent 工具/B站公共内容 + M6-a 本地目录备份/恢复 + M6-b 安全页/上线清单/手动升级检查 + M7-a 对标审计/临时 profile smoke + M7-b 用户豁免/主人 QQ 管理命令 + M7-c 受限生图/改图/普通图片发送 + M7-d 通用 JSON/JSONL 旧档案导入 + M7-f 默认关闭的 embedding 重排（真实 provider 未验证）+ M7-g 人物/群印象及关系维度内联编辑（仅离线面板测试）+ M7-h 通用时间轴事件导入（合成数据/离线测试）+ M7-i 默认开启的出站文本防泄漏与只读安全状态（离线测试）+ M7-j 已知 QQ 通知时间轴与主人确认请求处理（fake 网关，真实 QQ 未验证）+ M7-k 本地文件上传/列表面板（离线服务/API/mock UI，真实 QQ 未验证）+ M7-l 默认关闭的主人本地提醒（fake timer/QQ，#8/#40 partial）+ M7-m B站公开评论/离线分享（fake fetch/API/UI，#48 partial，真实接口未验证）+ M7-n 操作员命令禁用列表（默认空、离线配置/命令测试，#14 partial）+ M7-o 主人显式会话 steer（fake agent，#9 partial）+ M7-p 默认关闭的群聊词法记忆相关度门控（离线配置/集成测试，#20 partial）+ M7-q 默认关闭的私聊/C2C 输入状态（离线 fake 网关，#9 仍 partial，真实 QQ 未验证） + M7-r 默认空的固定只读操作员档位（#13 partial、#14 仍 partial，无完整 RBAC/admin/approval 档位）+ M7-s 默认关闭的持久化主人管理审批（#15 仍 partial，fake QQ/重启持久化验证）+ M7-t 主人显式目的规划与手动步骤标记（fake LLM、#38 仍 partial）；真实 DSH 探针 + 认知/模型/人格 UI 证据见
> [历史验证报告](https://github.com/reina0721/dsh-bot/blob/main/docs/archive/VERIFICATION.md) §4.2/§4.3/§4.4/§4.5/§4.6/§4.7。

| 领域 | 状态 | 实际模块 | 已做到 | 边界/未覆盖 |
|---|---|---|---|---|
| 手动跨平台身份登记（M7-v） | I/T/L | `cognition/identities.js`、`index.js`、`commands.js` | 默认空的全局 manual_identity；五平台/严格 ID/干净标签/已知密钥校验，随机 idn_24hex、唯一链接/重链/解析/删除/计数、5000 条/筛选最新 100 条；主人命令列表最多 20，owner/禁用/访问闸门，固定安全错误；离线服务/命令/重启与人格切换验证 | 不改人物或既有 persona identity，不创建/合并人物、自动验证/关联或路由消息；无 Telegram/Discord adapter、API/面板、新配置/依赖/外部调用，真实跨平台未验证；#32 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 不变 |
| 目的规划/步骤标记（M7-t） | I/T/L | `cognition/commands.js`、`purpose.js` | 主人 plan/step/steps；活跃 goal 标题/描述、唯一 ID 与严格参数校验；显式 JSON LLM 生成 1–8 条未完成步骤，去控制字符/长度/去重校验，变化检测、安全错误；指定步骤 done/undo、现有进度重算；离线 fake LLM/目的服务测试 | 无新配置/依赖或后台 LLM/步骤执行、自主执行器、动作绑定、审批集成；undo 不自动 resume，真实模型/QQ 未验证；#38 仍 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47 |
| QQ 管理审批（M7-s） | I/T/L | `core/approvals.js`、`core/config.js`、`cognition/index.js`、`cognition/commands.js` | 默认关闭，固定十种管理动作；全局持久化 apr_ 随机 ID、10 分钟/50 pending、参数校验/已知密钥拒绝；主人列表/confirm 批准拒绝，原聊天 handleAdmin 重校验/单次重放、executed/failed；原 req_ 保留；离线服务/命令/重启集成测试 | 无全服务/工具统一审批、审批 HTTP/面板、PII/媒体扫描；失败/批准后中断不自动重试，真实 QQ 未验证；#15/#14 仍 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47 |
| 只读操作员（M7-r） | I/T/L | `core/access.js`、`core/config.js`、`cognition/commands.js`、`cognition/qq-actions.js` | access.operators 默认空、同 private 规范化/去重/最多500；主人优先，allowlist 操作员私聊入站/出站 operator；固定 help/status/model（无参数）/bili/groupinfo/memberinfo，禁用时静默，模块 ownerOnly 保留；离线测试 | 群仍须白名单，无主人特权、完整 per-tool/per-action RBAC、admin/approval 档位或统一审批，真实 QQ 未验证；6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47，#31/#42/#49/#50 不变 |
| 私聊输入状态（M7-q） | I/T/L | `gateway/actions.js`、`core/config.js`、`cognition/pipeline.js` | 默认关闭，`cog-turn` 开关；严格字符串安全整数 ID/整数 1、2；私聊/C2C 轮次前 await 输入中、finally await 暂停；同步/异步错误隔离，不改回复/原处理异常，不记录原始错误或聊天 ID；关闭/群聊/缺方法旁路、命令早退与异常也清理；离线 action/配置/集成测试 | 依赖网关，等待沿用既有超时/重试；入站 input_status 仍忽略；没有群聊 typing/群 set_input_status、输入状态限频或专用状态面板（仅配置开关）；真实 QQ 未验证、未全量验收，#9 为 steer + 私聊 typing，仍 partial、remaining 47，#31/#42/#49/#50 不变 |
| 群聊词法相关度（M7-p） | I/T/L | `core/config.js`、`cognition/pipeline.js` | 默认关闭；`cog-turn` 开关/0–1 阈值；概率/频率/连续/冷却后复用已检索记忆最高词法信号，缺信号则有界摘要重合；无记忆/低分仍编码 ambient 记忆，记录 low_relevance 且不分析；点名/私聊绕过、异常放行；离线配置与集成测试 | 无新增依赖/外部调用，不用综合分数/embedding；没有 LLM 话题判断/接梗/语义分数，真实 QQ/浏览器未验证；#20 partial、remaining 47，#31/#42/#49/#50 不变 |
| 感知与轮次 | I/T/V | `src/cognition/turn.js` | 每 `(chatType,chatId,senderId)` 聚合；完整度评分；软/硬截止；命令/超时快路径；撤回通知；跨重启恢复；消息去重；`selfId` 防循环 | 多用户同时插话的「注意力分配」只做了点名/回复门控，没有独立打分模块；编辑事件未完整接入 |
| 注意力 | L/T | `turn.js` + `pipeline` | 群聊仅点名/回复/唤醒词/命令；群 ambient 默认不决策；回复/情绪/关系/记忆参与候选效用 | 没有独立 `attention.js` 的 salience 评分、话题切换/多人优先级队列；后续版本目标 |
| 人格编辑/群聊参与/多人格 | I/T/V | `persona.js`、`analysis.js`、`pipeline.js`、`77-persona.js` | 多份独立 persona 记录 + activeId；create/duplicate/switch/delete；文本 profile 与数值人格同源持久化并注入 prompt；顶层人格库 + Prompt 预览；群聊 addressed/probability/all；冷却/分钟上限；lastTurn/groupSkipped 诊断；名字唤醒 | 当前是全局 active 人格，未做按群绑定；群聊 all 的 token 成本随群活跃度增长；文本人设不能覆盖安全硬边界；未做关键词/欢迎/管理命令插件 |
| 人格级认知数据 | I/T/V | `persona-scope.js`、`cognition/index.js`、`77-persona.js` | 非全局 kind 存到 `persona_<id>:` 命名空间；旧数据迁移到 self；人格页查看 11 组条数（含时间轴事件、请求与提醒）；按组单向复制到当前人格；删除人格清理数据 | 复制是覆盖式、非实时共享；全局 setting/turn/raw_event 不隔离；LLM 用量按人格隔离但不参与数据组复制；跨人格合并需要逐组复制 |
| 人格导入/模型自检 | I/T/V | `persona.js`、`llm.js`、`routes.js`、`scripts/import-aoi-persona.mjs` | `persona-import@1` JSON 一次性导入并激活；Aoi 转换脚本；DSH 一次性调用修复；`/cognition/llm/test` 返回真实 route/错误/延迟；真实 probe 私聊+群聊各一条 Aoi 回复 | 未移植 Aoi 的完整五层 CRDE/brain 适配器；外部包无 LICENSE，不转载原文；DSH route 需宿主有对应 API key |
| 工作记忆 | I/T | `memory.workingSet` | 每个 chat 的当前 turn/人物/意图/决策 | 容量与时间淘汰是简单裁剪，不是完整 Baddeley 模型 |
| 人格 | I/T/V | `persona.js`、`pipeline.maybeEvolvePersona` | 12 维特质 + 表达风格 + 价值边界；锁定项；单次/短期证据不剧变；24h 门控慢演化（≥5 结果样本、受每日上限） | 演化证据仍较粗（平均结果/未知量），未做完整长期模拟 |
| 情绪 | I/T/V | `emotion.js` | OCC 评价→PAD/离散；惯性、衰减、调节、外显阈值；疲劳/压力影响有效技能 | 评价主要来自 LLM 分析或本地启发式，无真实生理信号；不声称主观体验 |
| 人物画像 | I/T/V | `person.js` | Person/identity/facet；fact/self_report/observation/inference/hypothesis；scope/confidence/status/outdated/disputed；修正/删除/导出；M7-g 当前人格面板编辑内容/置信度/可选 active 或 disputed（含 group-scope 群印象），保留原作用域 | M7-g 仅离线面板测试，无本轮浏览器 V；无独立人物说话方式编辑器/Aurabot 专用人物档案导入；后端保留 UTF-16 slice(0,2000) 截断。身份合并/拆分是规则+scope，没有强实体消歧；群成员网络未单独建模 |
| 关系 | I/T/V | `relationships.js` | 10 维有向关系；全局/群/私聊作用域；惯性、冲突升快降慢、修复、单轮上限；历史事件；M7-g 面板逐卡调整 API 返回维度（-1–1），仅提交变化项和原作用域，source=ui 历史 | M7-g 仅离线面板测试，无本轮浏览器 V；不改人物/作用域，不批量/自动应用。长期衰减未在每次读取时强制应用；群体氛围/多人关系网络为 v0.5 |
| 记忆 | I/T/V | `memory.js` | 工作/情景/语义/情绪/社会/程序；重要性/显著性；FTS 中文+英文检索；关联 2 跳；检索公式；巩固；遗忘（降权）≠删除；隐私隔离；时间/访问衰减 | 默认词法+图关联；M7-f 可选 OpenAI 兼容 embedding 重排（默认关、失败词法回退、fake 测试）；无本地模型/独立 reranker/向量数据库/全库向量召回，真实 provider 未验证，#31 仍 partial；长期巩固为阈值启发式 |
| 信念/未知 | I/T | `beliefs.js`、`knowledge.js` | 概率化信念、证据 logit 更新、冲突 `disputed`、用户纠正；未知检测/学习任务/claims | 信念候选依赖 LLM 返回；本地无法可靠抽命题；未知到信念的自动桥接有限 |
| 策略/行为 | I/T/V | `policy.js`、`pipeline.js` | 候选动作效用；关系/情绪/人格/技能约束；沉默/等待是一等动作；上下文 Beta 后验 + 探索；限频；结果归因（用户继续/纠正/情绪）；撤回专项（未看见内容不假装看见）；主动行为默认关且有安静时段/日预算/退避 | 没有显式目标树/规划器；复杂多步任务规划仍交给 DSH agent 层；proactive 的实际模型调用未在真实探针验证（无凭据） |
| 学习 | I/T/L | `knowledge.js`、`sources` | 未知→任务→多来源→带引用 claim；来源可注册；预算/暂停/重试/取消；默认只检测，自动外部检索显式开启 | 未做 real-world 多源冲突自动裁决的完整回归；Wikipedia/OpenAlex/GitHub 网络调用在测试中用 fake source；真实网络未逐源验证 |
| 技能 | I/T/V | `skills.js` | 13 项初始技能；成功/失败/不用/压力/迁移；有效熟练度独立于人格/情绪/关系 | 技能参数是手工先验，未从长期真实成功数据拟合 |
| 元认知 | I/T | `meta.js` | 决策/结果/校准 Brier/沉默率/能力缺口/有限 insight | 反思只记录 bounded insight，不自动改代码/权限；无完整自我模型 |
| 主动行为 | I/T/L | `proactivity.js` | 默认关闭；安静时段、日预算、关系门槛、退避、dryRun、决策记录 | 真实 LLM/发送路径未在带凭据的探针上验证；群主动默认关闭 |
| 目的系统 | I/T | `cognition/purpose.js`、pipeline、面板「目的」 | goal/plan/intent；优先级/进度/步骤/作用域；少量注入 compose；`/purpose` 增删改、M7-t 显式规划/手动标记；面板 CRUD | 不执行工具/不自动发消息；无自主执行器/动作绑定/审批集成 | M3 剩余 |
| 时间轴 | I/T | `cognition/timeline.js`、认知「时间轴」页 | 轮次/记忆/决策/导入事件合并、倒序、before 分页、type/scope 过滤；event 独立筛选；只读 | 无编辑/真实样本验证 | M3 剩余 |
| QQ 通知/请求审批（M7-j） | I/T/L | `cognition/notices.js`、commands、gateway actions、persona-scope | 十种通知校验/去重写时间轴（含名片/群名/头衔）；好友/群请求 pending、flag 去重、公共投影；主人列表与 approve/reject 强制 confirm；服务复核 owner/开关、并发防重、固定原人格完成写入；请求人格数据组 | 无自动审批/队列面板/新增 API/Agent 工具；无通用审批/逐项权限或 PII 检测；fake 网关验证，真实 QQ 未验证；#3/#15 仍 partial |
| 旧档案导入（M7-d/M7-h） | I/T/L | `cognition/archive-import.js`、`index.js`、REST、`CogMemories` | 通用 JSON/JSONL 导入当前人格记忆或时间轴事件（kind=memory 默认/timeline）；事件时间必填、独立 ID/人格数据组；默认 5 MiB/5000 项；作用域/字段/时间戳规范化；稳定 ID 幂等去重；本地面板、API 与仅计数日志；离线测试 | 无 Aurabot 专用迁移或向量导入；无真实旧档案样本验证；#30 仍 partial |
| 每日整理/反思 | I/T | `cognition/consolidation.js`、记忆页按钮 | 04:00 调度、按作用域巩固、可选 LLM 反思、只压缩已有记忆、私聊隔离 | 无批次/重试/保留策略；无时间轴；反思最多 2 个作用域/次 | M3 剩余 |
| 合并转发/拍一拍/表态/QQ 动作 | I/T | `gateway/forward.js`、`commands.js`、`cognition/qq-actions.js`、`runtime/qq-tools.js` | 合并转发展开、拍一拍回应+冷却、表情表态归因、4 个主人命令；主人私聊 Session 运行时挂 3 个固定当前会话 QQ 工具，发送仍走 outbound | social/group 不挂工具；新增 M7-b 默认关闭的主人资料/群管/文件/精华/撤回命令；新动作不挂 Agent，无任意 action 透传；真实 QQ 管理/资料/文件未验证 | M5-b 受限完成 |
| 回复分条/引用/@/防刷屏 | I/T | `cognition/reply-split.js`、`pipeline.sendDecision` | 长回复分条、段落/句末优先、最多条数合并、分条间隔；引用与群聊 @ 可配；连续未点名接话上限 | 分条失败不回滚；QQ 工具边界见动作行 | M2-b |
| DSH Session 运行时 | I/T | `runtime/agent.js`、`runtime/qq-tools.js`、`cordis.patch.yml` | 每聊天 Session、private/social preset、followup/event、超时/串行、oneshot 回退；仅 full/主人私聊挂 3 个 QQ 工具，注册失败隔离并可 dispose | 默认 oneshot；social/group 0 个 QQ 工具；未真机 V | M1/M5-b 受限完成 |
| QQ 命令/按聊天模型 | I/T | `cognition/commands.js`、`cognition/llm.js` | `/status` `/quiet` `/active` `/model` `/remember` `/forget` `/help`（主人）；`modelRouting` 按会话覆盖；/model 写回配置 | 操作员固定只读集，其余非主人静默（公开模块例外）；无 `/sing`；只影响认知 LLM，不改变 agent Session 模型 | M1 剩余：agent 真机 smoke |
| 访问控制/统一出站 | I/T | `core/access.js`、`cognition/outbound.js` | `open`/`allowlist`、主人/只读操作员 + 私聊/群白名单、入口闸门（不落 raw/不聚合）、统一出站（访问→限频→leak guard→dryRun→发送）、审计/计数、概览卡片与 `/access/*` | 无全服务/工具逐项权限及统一审批（QQ 管理队列见 M7-s）；allowlist 未做真机 V 验证；默认 open 以兼容升级 | M1 剩余：DSH Session 运行时 |
| 主人会话插话（M7-o） | I/T/L | `runtime/agent.js`、`cognition/commands.js` | 主人 `/steer 文本`；active/当前私聊或群聊数字 ID/1–1000 Unicode 校验；复用或创建 Session、固定 UserMessage payload、缺方法/安全失败、steers/lastAt；解析串行且可在 compose 等待期间送达；owner/禁用/访问闸门与非主人静默，离线测试 | 无自动 steer/插话面板/API/新配置；私聊 typing 见 M7-q；不写配置或直接调用模型；真实 DSH/QQ 未验证，#9 partial，remaining 47，#31/#42/#49/#50 不变 |
| 操作员命令禁用（M7-n） | I/T/L | `core/config.js`、`cognition/commands.js` | 默认空 `cognition.permissions.deniedCommands`；严格数组/小写名/去重/最多100/issue 与 string-list 配置；身份检查后、内置/模块派发前拦截；大小写一致、无处理服务调用或配置写入；主人固定提示、非主人静默、未知命令/帮助保持原样；离线配置/命令测试 | 仅命令入口，不覆盖 API/直接服务/Agent 工具/模块同进程代码；无所有服务/工具逐项 allow/deny 矩阵或统一审批；#14 仍 partial，remaining 47，#31/#42/#49/#50 不变 |
| 出站文本防泄漏（M7-i） | I/T/L | `core/leak-guard.js`、`cognition/outbound.js`、`SecurityPage` | 默认启用 + redact，可选 block；高置信度密钥规则、100k UTF-16 上限、只输出脱敏文本及类别/次数；dry-run 也检查、leakBlocked 计数、固定网关错误；安全页只读开关/策略，没有扫描内容/密钥 | 无统一审批/逐项权限，无 PII/熵检测或媒体/文件扫描；可能误报/漏报，不重组跨段/跨消息；媒体/手动发送等独立路径不覆盖；仅离线/fake 网关与 mock 面板测试，#15 仍 partial，remaining 47 |
| 隐私/删除 | I/T/V | `memory.js`、`person.js`、`index.deletePerson` | 私聊/群聊作用域隔离；secret 不进 LLM（平台层）；导出；删除人物级联画像/关系/记忆；原始事件镜像可关 | 没有多用户权限模型；DSH 本地单用户认证 |
| 存储 | I/T/V | `store.js` | `node:sqlite` WAL + FTS5 + 事务/回滚/备份；JSON fallback；schema version；原始 JSONL；WAL checkpoint | 迁移只有 v1；跨大版本升级需补迁移脚本 |
| 模型协议 | I/T/V | `src/model/**` | OpenAI Chat/Responses、Anthropic、Gemini、Ollama 统一适配；OpenCode Go/Command Code/OpenRouter 预设；自定义 base/header/auth；流式/发现/重试/安全；真实 OpenCode OpenAI+Anthropic 通过；真实认知直连 analysis+compose 成功 | 工具调用/多模态未实现；Azure/Bedrock/Vertex/OAuth 未纳入；Command Code/OpenRouter 无 live chat key；Gemini/Ollama 仅 mock |
| 可观测 | I/T/V | `pipeline` traces、`overview`、UI | 每阶段 trace、决策候选、计数、API/UI、暂停/演练 | 没有完整分布式追踪/指标导出 |
| 多模态/媒体（M4-a/M4-b/M7-c） | I/T/L | `src/media/index.js`、`src/media/stickers.js`、`commands.js`、媒体面板、`gateway/actions.js` | 默认关闭外部媒体；Vision/ASR/TTS 与图片/语音/文件收发；表情包限 PNG/JPG/JPEG/GIF/WebP、默认 5 MiB/张和 200 张、SHA-256 去重/人工标签；安全按 ID 取图；`/tts` `/say` `/sticker` 与媒体面板；默认关闭的生图/兼容 edits、`/draw` `/redraw` `/image`、本地生图改图 API/面板（只落盘）；prompt≤1000、五档尺寸、PNG b64_json/媒体大小/头尺寸上限、根内相对路径/realpath 防逃逸、超时、env 密钥 | 不自动收集/语境选图/缩放转码，无商城、Agent 媒体工具、自动语音策略、RVC；只支持 OpenAI 兼容 edits，无 mask/其他编辑后端；不抓取返回 URL、无任意本地路径；QQ 文件发送依赖网关；尚无真实 QQ/provider V |
| 主人本地提醒（M7-l） | I/T/L | `cognition/reminders.js`、`commands.js`、`persona-scope.js` | 默认关闭；owner/当前聊天/时间/Unicode/限额/防重；一次或重复固定文本，最多 20 条/tick，统一 outbound；安全失败延迟重试、自调度/不重叠/dispose、原人格写入；reminders 数据统计/复制/删除；离线服务/命令/持久化集成测试 | 无提醒 HTTP/管理面板、DSH jobs/长任务/LLM 任务执行/任意命令或外部任务调用；真实定时器/QQ 未验证；#8/#40 partial，remaining 47，#31/#42/#49/#50 不变 |
| 本地文件面板（M7-k/M7-u） | I/T/L | `src/media/index.js`、REST、`MediaPage` | 上传/列表/刷新、本地下载/确认删除；安全存储 basename≤120、扩展名/严格 base64/大小、15 MiB 上传体、固定 files 目录/realpath/普通非符号链接文件/wx；有界读取、MIME/base64 JSON 转 Blob；共享忙碌锁/错误 toast/删除后刷新；长名称保留扩展名缩短存储名 | 无任意本地路径或发送面板，发送沿用主人 `/file`；旧存储 basename>120 安全拒绝新操作；仅本地临时文件/fake 宿主/mock UI，真实 QQ 文件兼容性/本轮真实浏览器未验证；#45 仍 partial，6 has / 40 partial / 0 none / 1 limited / 6 leading / 8 exempt，remaining 47；#31/#42/#49/#50 不变 |
| 模块架构 v2（Phase 14 收束，未发布） | I/T | `src/modules/`、`src/extensions/providers.js`、`commands.js`、模块面板 | 统一清单/API/依赖/生命周期/原子状态/隔离存储；四个内置 reply delivery、typing、reminders、sample；11 项外部特权及来源伪造拒绝，provider 单所有者交接/失败回退，提醒人格仓库及五字段只读配置，tgz/zip 独立加载 | 同进程任意代码，非沙箱；媒体基础设施留核心，不提取 builtin-media，无数据迁移；无远程安装/上传/移除、依赖下载/版本解析、签名、watcher、marketplace 或 `.d.ts`；仅离线，未发布/部署或 live/浏览器/真实第三方模块 V |
| B站公共内容（M5-b / M7-m） | I/T | `src/modules/builtin/media-features/`、核心 transport、模块详情面板 | 默认关闭；公开搜索/热门/BV 详情（aid/shareUrl）/公开评论（置顶优先、rpid 去重、最多20条、纯文本500字符）；离线分享；主人/操作员命令、4 个 REST 路由与模块详情 BV 查询面板，离线服务/API/mock UI 测试 | 无 Cookie/WBI/登录/字幕/发布评论/缓存/新 Agent 工具；分享不验证视频存在，真实 B站/QQ/浏览器未验证；#48 partial、remaining 47，#31/#42/#49/#50 不变；QQ空间未实现 |
| 本地备份/恢复（M6-a） | I/T/L | `src/ops/backup.js`、REST、备份面板 | 目录快照（无 zip）；默认配置/模型/认知/模块/表情包，可选根内全部媒体；200 MiB/5000 文件/10 份，原子发布/可选清理、路径/符号链接/hash 校验、默认暂存、allowRestore 门控与恢复前备份 | 含密钥需保护；复制 SQLite 前必须停写，恢复后重启；不保证在线一致性或整目录事务；不删除未列出的文件；无加密/云端/自动恢复/迁移（版本检查见 M6-b），未做真实数据恢复 V |
| 主人 QQ 管理命令（M7-b） | I/T/L | `commands.js`、`qq-actions.js`、`gateway/actions.js`、`media/index.js` | 默认关/主人/当前会话/access 闸门；昵称、名片/群名、管理员、禁言/全禁、踢人、精华/撤回、媒体根内相对路径文件；踢人始终 confirm、撤回默认确认；破坏动作简短审计；ID/文本/归属/realpath 校验 | 无逐项权限矩阵/任意 action 透传/新 Agent 工具；get_msg 缺归属则拒绝；机器人需群管权限；profile/精华/文件依赖网关扩展；真实 QQ 管理/资料/文件动作未验证 | M7-b 受限完成 |
| 对标审计/临时 profile smoke（M7-a） | I/T/V | `scripts/parity-audit.mjs`、`scripts/smoke-temp-profile.sh`、`docs/PARITY-AUDIT.md` | 矩阵结构审计/JSON 输出/源码与测试静态计数；临时 DSH profile 启动、关闭 QQ、查询健康/状态/配置/模块/媒体/备份/升级并创建一次备份、清理；实际 smoke 通过 | 不是全量对齐；不替代真实 QQ/媒体/GitHub 验证；矩阵剩余 47 项（排除 6 has + 8 exempt，仍含 6 leading） | M7 剩余 |
| 安全页/上线清单/升级检查（M6-b） | I/T/L | `src/ops/upgrade.js`、REST、`SecurityPage` | 15 个顶层标签；只读访问/危险面、最近 5 条审计、6 项上线清单；默认关闭的手动 GitHub 检查，最近 10 条内 stable/beta 过滤、版本比较、内存缓存/force、超时/真实错误；GET 状态零网络 | beta 仅放宽预发布过滤；模块审核始终人工提醒，媒体只检查字段；无后台/自动更新、下载/安装、token、云端、工作区迁移或离峰省钱；API 鉴权不变，依赖 DSH 本机信任边界；未做真实 GitHub/浏览器 V |
| 群体网络 | N | — | 关系有 group scope | 成员角色/群体氛围/多人冲突/群体规范是 v0.5 |
| 显式目标与规划 | N | — | 策略按候选效用选择动作 | 没有长期目标树、计划执行、失败重规划；当前由 DSH agent 层提供规划，认知内核不假装拥有 |
| 生产 Web 学习 | L | `knowledge.js` | DSH web 搜索/抓取优先，公共 API 兜底 | 真实网络与来源条款/限速只做了接口与假源测试 |

## 与「完整认知架构」的差距

v0.4 完成的是**可运行的认知核心 + 可验证的长期状态 + 管理 UI**，v0.5 补上**统一模型协议与直连**，v0.6 补上**人格工作台、群聊参与与诊断**；不是终点：

1. **独立注意力/显著性模块**、群体网络、显式目标规划、真实向量记忆、真实图像理解属于 v0.5；
2. **真实长期模拟**（数周/数月）尚未跑；人格/情绪/关系/记忆的长期稳定性只有单元/短场景证据；
3. **真实有凭据的 LLM 端到端**：探针 profile 无模型凭据，验证了降级不伪造；桌面 profile 的
   `agentDefaultModel` 路由在有凭据时可用，但未在自动化里消耗真实 token 做回归；
4. **真实 QQ 网关**未接入（本机无账号）；协议用 mock 覆盖；
5. 文档中的设计矩阵（`COVERAGE-MATRIX.md`）部分模块名是目标态，实际合并/命名以本表与代码为准。

这些边界不会用「已实现」掩盖；下一阶段按 `CAPABILITY-MAP.md` 的清单推进。
