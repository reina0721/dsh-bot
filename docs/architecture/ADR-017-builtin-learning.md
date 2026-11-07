# ADR-017：内置学习编排提取（one-shot 模块 3）

- 状态：已接受并实现；仅模块 3
- 日期：2026-11-07
- 基线：主动行为提交 `aed8745`，分支 `feat/builtin-features`
- 前置：[ADR-010](ADR-010-provider-composition.md)、[ADR-014](ADR-014-module-webui.md)、[ADR-016](ADR-016-builtin-proactivity.md)

## 唯一所有权

默认启用的 `builtin-learning` 独占 learning 固定 provider、scheduler/background timer、新 unknown → 自动任务规划/入队、pending/run 编排、来源迭代和 claim 完成顺序。只有该内置 ID 可以声明 learning:service 或注册 learning；setup 注册 provider 并自行 start，start/stop 幂等。权限只有 providers:register、scheduler、config:read、learning:service，无通用 cognition、storage、LLM 或网络源注册能力。reminders/mediaFeatures/proactivity 的 provider 订阅保持隔离。

核心 cognition/index.js 删除 startBackgroundJobs 和学习 timer；knowledge.detectFromTurn 仅持久化 unknown、发布新检测事件，不规划或创建任务；knowledge.runTask/runPending/createTask 删除。核心保留未知/知识查询、来源注册表/读取、统计、task/unknown/evidence/claim 持久化、记忆、LLM 路由/预算和存储。研究内容提炼在核心 cognition/research.js；模块选择执行顺序，核心只对被授权 lease 执行固定来源收集、提炼和原子发布操作。无 fallback 或双重所有者。

模块单个递归 timeout 首次约 30 秒，完成后 60 秒，每 tick 最多一个 due pending 任务。autoResearch:false 不入队/不自动运行/不访问来源；手动 pending 运行无需 autoResearch，但要求模块、cognition、learning 启用且未暂停。suggested 不自动执行；nextRunAt 未到不执行。新检测订阅不回放，模块停用期间的 unknown 保留，重新启用不追溯创建任务。

## 窄端口与单写

`src/modules/learning-port.js` 由宿主为固定 runtime 创建并冻结，仅暴露：

| 方法 | 有界契约 |
|---|---|
| onUnknownDetected(handler) | 只订阅新 unknown；提供最多 120 字符 surface 和仅在同步事件回调有效的不透明 unknownRef；返回 unsubscribe |
| enqueueAuto({unknownRef,plan}) | 当前人格/代次、开关、autoResearch 和私聊策略校验；最多三条、各 256 字符计划；核心去重并写原 learning_task |
| pending({limit}) | 最多 50 个到期 pending taskId/expectedVersion，不返回完整记录 |
| claim({taskId,expectedVersion,mode}) | manual/auto 接纳到期任务并同步增加一次 attempts/version，发不透明 lease 和最多 256 字符固定 query；auto 不能运行 suggested；cancel 模式仅做原取消转换，无 attempt/lease，可取消未来或 suggested 任务；取消可省略 expectedVersion，以保持旧取消 API；取消/重试是数据操作，允许在认知暂停或学习开关关闭时使用，但要求模块 runtime 活跃 |
| sources({lease}) | 当前来源最多 32 个不透明 sourceRef；不传原始来源对象/URL |
| collectFromSource({lease,sourceRef,query,maxResults}) | query 必须等于已签发查询；每 sourceRef 一次搜索、最多三结果且受 maxSources 约束；核心抓取、截断和持久化，整个 attempt 最多八条 evidence，仅返回 refs |
| extractClaim({lease,evidenceRefs}) | 仅本 attempt 的最多八个、不可重复 evidence refs；一次固定 learning LLM 提炼，原置信度/争议/引用规则；只返回不透明 claimRef 或 null |
| complete({lease,claimRef}) | 核心同步事务写 claim/task/unknown，重复调用返回相同安全回执；没有模型完成前不能发布 |
| fail({lease,error}) | 核心只存白名单错误码，失败保持 unknown 未解决 |
| release({lease}) | 幂等、无需活动权限；先撤销，原人格 running 任务恢复 pending 并增加 version，保留 attempts/evidence |
| retry({taskId}) | 原重试语义：pending、清 error、nextRunAt=now，增加 version；只返回有界任务回执 |

租约捕获人格、人格切换代次、任务版本和 runtime；宿主跨 runtime 的 owner 表只允许一个 live attempt。来源引用仅在当前租约内有效，不能指定任意 URL/路径/凭据、原页面、store、模型参数或注册来源。证据按 task/source/URL/contentHash 去重；claim 只能由此 attempt 的 evidence 生成，complete 幂等避免重复 claim；显式 retry 成功任务时，同 task/概念/文本/状态/证据集合的已有 claim 复用原 ID。所有事务回调均同步，网络/模型等待在事务外。

claim、入队和外部步骤前后检查私聊 learnFromPrivate；配置关闭、暂停、切出再切回人格、取消/重试版本变化和 runtime 停止都使旧 lease 不能发布。stop 同步 unsubscribe、清 timer、失效代次、release lease 并解除引擎 flight，然后返回，不等待不可控网络/模型。迟到结果不能写证据、claim、解决 unknown 或重排 timer；已有证据保留在原人格，可由后续 attempt 复用。核心 runLearning/retryTask/cancelTask 每次查询当前 provider；缺失返回 MODULE_DISABLED，原 HTTP 包装字段与知识读取 API 保持。

## 配置、UI、数据与限制

16 个现有 cognition.learning 字段均增加 module:'builtin-learning'，模块通过 legacyConfig.section('cognition.learning') 读取规范化白名单快照；仍沿用全局 config.json 和默认 enabled:true、autoResearch:false。module.config/schema 绑定 legacy-core；learning.preview 只接收冻结的四字段有界草稿投影，不请求、不运行任务。可选模块操作 panel 本次不添加，现有认知页任务/手动运行路由保留且经过 provider。无新 DSH sidebar/main。

原 task/unknown/evidence/claim ID、命名空间、已有数据、取消/重试入口保留；无需迁移。maxTasksPerHour 保留原严格大于上限才延后一小时的语义；maxSources 保持每源结果限制，最多八证据；retry/taskTtlHours/maxQueries 保留值和既有未完整执行语义，不新增自动重试/TTL/多查询策略。minConfidence、distinctDomains、争议与引用语义沿用核心提炼。

验证覆盖默认关闭无活动、新事件/私聊/开关、pending/due/suggested、single-flight、lease/版本/attempt、幂等发布/证据去重、取消/迟到结果、人格切换、停止重启、手动运行、固定权限/provider/UI 元数据和独立归档加载。未验证真实来源、模型、QQ 或浏览器。同进程 API 边界不是进程沙箱；已接纳外部请求无法撤回。正常停用恢复 interrupted pending；硬崩溃遗留 running 沿用显式 retry 恢复，不引入跨进程自动恢复/exactly-once 保证。没有其它模块提取、版本/依赖变更、推送、部署、tag 或发布。
