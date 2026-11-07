# ADR-019：系统闭环 v2 关联、回执与反馈契约

- 状态：C05 执行观测、C06 反馈/研究关联及只读 API、C07 核心 UI 已实现；见 [C08 最终验收](CLOSED-LOOP-ACCEPTANCE.md)
- 日期：2026-11-07
- 基线：分支 `feat/closed-loop-v2`，C01 `5e0c6c4`
- 前置：[ADR-006](ADR-006-delivery-result-status.md)、[ADR-016](ADR-016-builtin-proactivity.md)、[ADR-017](ADR-017-builtin-learning.md)、[ADR-018](ADR-018-module-closed-loop.md)

## 决定与边界

为社交回复、主动行为与研究提供统一、无正文的关联视图：已观察到什么、在哪一步停止、真实发送了多少、反馈从哪里来、是否完成策略更新。loop 是管理投影，不接管 pipeline、DeliveryService、policy 或 learning provider，也不建立第二套业务执行器。loop 完成、decision 状态、发送回执、研究发布和用户反馈分别表达不同事实。

C05/C06 已增加记录与只读 API，C07 已接入核心管理 UI；下文各阶段实现说明保留当时范围。本 ADR 不改变 C01 的贴纸授权区分、ADR-006 的执行器行为、出站闸门、主动/学习停用无 fallback、人格租约或原研究数据。没有自动重发、自动恢复任务或跨进程 exactly-once 承诺。

## Loop / receipt v1 schema

以下为公共投影与逻辑存储契约；由核心仓库按人格隔离，物理布局另随实现决定，不能借此暴露任意 store 查询。所有时间为 UTC epoch ms；ID 为不透明内部标识，不允许将正文拼接进 ID。

```text
Loop = {
  version: 1,
  id: string,
  personaId: string,
  kind: 'social' | 'proactivity' | 'research',
  status: 'running' | 'completed' | 'failed' | 'interrupted',
  stage: 'detected' | 'decided' | 'generating' | 'delivering' |
         'observing' | 'researching' | 'closed',
  turnId: string | null,
  decisionId: string | null,
  unknownId: string | null,
  taskId: string | null,
  firstDetectedTurnId: string | null,
  moduleId: string | null,
  runtimeGeneration: string | null,
  startedAt: number,
  updatedAt: number,
  completedAt: number | null,
  reasonCode: string | null
}

Receipt = {
  version: 1,
  id: string,
  loopId: string,
  personaId: string,
  kind: 'delivery' | 'no_send' | 'feedback' | 'research',
  turnId: string | null,
  decisionId: string | null,
  taskId: string | null,
  runtimeGeneration: string | null,
  attemptId: string | null,
  eventId: string,
  occurredAt: number,
  recordedAt: number,
  data: DeliveryData | NoSendData | FeedbackData | ResearchData
}
```

每个 kind 只允许对应 data 白名单，拒绝额外字段/嵌套业务对象；`null` 是未知或不适用，不能补成空字符串、0、当前轮次或推断历史。`occurredAt` 是原事件发生时间，`recordedAt` 是写入时间，两者不能互相伪装。计数为非负安全整数；反馈置信度限定 0–1，reward 为有限的 -1–1 或 null。错误/原因只能是核心固定枚举码，不复制原异常。loop 与 receipts 的人格和关联 ID 必须一致；关联不存在时保留 null，不能新建虚构 decision/turn。

一个社交 loop 对应一个实际接纳的 turn 决策过程；一个主动 loop 对应一次接纳的 run；一个研究 loop 对应一个实际 task attempt。attemptId 在接纳时固定；新人工 retry 是新 attempt，不改写旧回执。receipt 按 `(persona,loop,kind,attemptId,eventId)` 的适用身份去重；同一实际事件不能因 UI 刷新、回调重提或多层服务而重复生成。eventId 使用核心在事件接纳点生成并贯穿该次执行的不透明标识，不能每次写入重新生成以绕过去重；feedback 的 sourceEventId 同样绑定该实际来源事件。

`completed` 表示此过程已结束，可包含 no_send、dry_run 或研究结束；不表示送达或用户满意。`failed` 为已观察终止故障，`interrupted` 为中断且没有完整结果证据。真实的 delivery status 与 parts 只取 delivery receipt；closed stage 不能覆盖既有投递/反馈事实。

## 无正文隐私、保留与人格隔离

只存必要内部关联 ID、模块/代次、固定枚举、时间、布尔值、计数、reward/置信度及内部去重 ID。不存消息/模型输入输出、prompt、摘要、rationale、unknown surface/context、查询词、网页标题/URL/摘录、证据正文、附件、文件路径、QQ/群/聊天/发送者 ID、凭据、headers、raw gateway/exception 对象。不能通过标签、错误信息、动态 reasonCode 或日志夹带内容；不增加正文 hash 形成可逆猜测或跨人格关联。平台 messageId 如需关联反馈，由原人格私有业务映射持有，不进入此公共闭环投影。内部 ID 本身仍是敏感关联元数据，不能当匿名数据公开。

每个人格对 loop 与 receipt **合计**保留最多 5000 条记录，最长 7 天（`7 * 24h`，按各自 created/recorded 时间，loop 以 startedAt 计）。任一上限先到就清理，更新不延长历史寿命。按最旧 loop 淘汰时连同其 receipts 清理，禁止悬空回执；单 loop 也受总数约束，容量不足可整组淘汰，不能为活跃流程无限豁免。写入/后台维护负责清理，GET 不清理或变更状态；查询即使面对未清理缓存也不能返回超期记录。清理观测记录不删除原 decision/outcome/unknown/task/evidence/claim 或回退已经提交的 policy。

loop 被淘汰后不再为其追加 receipt 或重新创建历史，剩余业务仍按原 owner 契约结束；查询不能返回已失去有效父 loop 的回执。短期观测淘汰不能重置业务反馈去重：已提交 outcome 必须保存来源事件的去重身份，不能只依赖可能已清理的 receipt 判断是否学习过。

人格仓库、查询、去重、保留上限与反馈更新分别隔离；入口捕获人格与切换代次，await 后不得把旧 receipt 写入当前人格。已被核心接纳的发送允许按原捕获上下文写回原人格；被撤销的研究 lease 不得借 loop 记录权限发布业务结果。人格删除必须删除这些记录；不将此短期运行观测历史复制到另一个人格。备份仍遵循已有本地隐私边界，不因 content-free 而放宽访问。

## Delivery receipt 的唯一所有者与 ADR-006

delivery receipt 的唯一写入者是核心交付边界的统一回执适配器。pipeline、DeliveryService、主动/提醒/模块调用方只向它提交本次投递关联上下文与结果，不能各自再写一份。适配器覆盖现有直接 executor 和 DeliveryService 路径，同一 attempt 只产生一份最终 delivery receipt；不搬迁发送 I/O，不增加第二个 outbound 或重试层。无关联 loop 的既有投递不虚构社交轮次或研究任务。逐条回调用于既有业务归因，不额外形成多份最终回执。

```text
DeliveryData = {
  status: 'sent' | 'partial' | 'failed' | 'dry_run' | 'empty',
  parts: number,
  failedPart: number | null,
  errorCode: string | null
}
```

严格保留 ADR-006：`parts` 是实际成功条数，`failedPart` 从 0 开始；sent 为完整执行成功，partial 保留已发送条数且兼容 `ok:true`，failed 通常零条，empty 是无效/空计划，dry_run 不新增真实发送。首条 dry-run 为 0；已发送后遇到 dry-run 时 parts 保留此前真实条数，不能全改成零或伪装 sent。不把 `ok` 或 messageId 当作完整成功，也不把计划总数当作 parts。

适配器只取真实正常返回结果，白名单化错误码（如 `SEND_FAILED`、`PARTIAL_SEND`、`EMPTY_MESSAGE`、`INVALID_TARGET`、`OUTBOUND_UNAVAILABLE`）；不复制 result/raw error/reason 文本。执行器/回调抛错继续沿原边界传播，不把异常伪造为完整的 ADR-006 返回或重发。只有已证实的回执才写 delivery；异常留下 loop failed/interrupted 与固定故障码，UI 表示投递结果未知。已发部分但最终回执缺失时不能声称零条或未发。

receipt 存储失败不能触发网络重发；发送已发生而落盘失败时允许留下未知观测。此处的“唯一 owner”是写入责任与单次去重，不是网络/数据库跨系统原子提交。

## No-send 路径与 decision.status

```text
NoSendData = {
  reason: 'WAIT' | 'SILENCE' | 'GATED' | 'EMPTY_OUTPUT' |
          'CANCELLED' | 'MODULE_DISABLED' | 'STALE_CONTEXT',
  gateCode: string | null
}
```

未进入交付边界的 wait/silence、前置访问/限频/业务 gate、空生成、取消/代次失效或模块关闭使用 no_send receipt，不制造 failed delivery、parts:0 的假发送或负反馈。到达 executor/DeliveryService 后返回的 empty、failed、dry_run 使用真实 delivery receipt，不能重复记同一 attempt 的 no_send。已经接纳但结果未知的发送不能记 no_send。gateCode 仅固定代码，无目标/拒绝原文。

`decision.status` 是既有策略流程兼容字段，可能 pending/sent/dry_run/failed/observed/skipped；后续 outcome 可把 sent 改为 observed。因此它既不是持久送达真相，也不能用来反推 receipt。无历史 delivery receipt 时必须显示“未观察”，不根据旧 status 补造历史发送条数。闭环查询的真实发送统计来自 receipt.status/parts；这不授权本阶段顺带修改原限频账本、预算或 decision 状态机。

## Feedback provenance 与事务性策略更新

```text
FeedbackData = {
  source: 'incoming' | 'reaction' | 'manual' | 'unknown',
  sourceEventId: string,
  attribution: 'direct' | 'heuristic' | 'unobserved',
  attributionConfidence: number,
  observation: 'positive' | 'negative' | 'neutral' | 'unobserved',
  reward: number | null,
  outcomeId: string | null,
  policyUpdated: boolean
}
```

核心 feedback/policy 服务是 feedback receipt、outcome 与 policy 更新的唯一 owner。sourceEventId 是原人格内不透明观察 ID，映射到实际后续消息/表态/撤回/超时事件；反馈种类不能冒充来源。direct 必须由原业务映射精确关联同人格同目标消息；“同一会话下一条”只可记 heuristic，必须保留实际置信度，不能改称明确纠正或直接引用。文本启发式只输出有界枚举与数值，不把匹配文本复制进 receipt。

事务前校验捕获人格、decision、适用的真实发送证据、来源事件与去重身份。以 `(persona,decisionId,sourceEventId)` 保证重复事件不重复学习。写入 feedback receipt、带来源去重身份的 outcome、decision 的 outcome 关联以及 alpha/beta/trials/rewardSum 更新必须在同一同步 store 事务中全成或全败；不在事务内 await 网络/模型。并发校验在事务内完成，失败不能留下 `policyUpdated:true` 或部分累计。存储不支持该原子性时应拒绝策略更新，不能宣称事务已提交。关联 loop/发送证据已过期或删除时，不再接纳新的反馈学习，也不靠旧 decision.status 补造证据。

只有可归因的实际观察才进入现有 reward 规则；不在此引入新 reward 权重或自动把启发式升级为事实。dry_run、no_send、未知投递不能产生“用户收到后”的正负学习。partial 仅对已确认发送部分的可关联事件归因，不把未发送部分算成用户拒绝。

**unobserved ≠ negative**：超时、无后续消息、窗口到期、人格切换、观察器停用、历史清理或重启均不证明用户忽略/不满。需要记录时使用 `source:unknown/attribution:unobserved/observation:unobserved/reward:null/outcomeId:null/policyUpdated:false`，不调用负奖励，也不以 reward=0 的“中性样本”增加 trials 或 alpha/beta。超时后的实际反馈只有仍有合法归因证据时才接纳，并按原事件去重，不能补写想象中的负反馈。

## Research 关联与 firstDetectedTurnId

```text
ResearchData = {
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted',
  unknownId: string,
  firstDetectedTurnId: string | null,
  evidenceCount: number,
  claimId: string | null,
  errorCode: string | null
}
```

核心 unknown 检测首次持久化时，仅从实际 `turn.id` 记录 `firstDetectedTurnId`；同一 unknown 再次出现不得覆盖其首次关联。新检测事件、自动入队、task/attempt、evidence/claim 完成与 research loop 贯穿此引用；task 的当前触发轮次不等于首次发现轮次。没有实际 turn（如人工来源）则为 null。任务直接关联既有 unknownId/taskId，不把查询、surface、证据、计划或 LLM 正文带进 loop。

旧 unknown/task 缺少首次轮次时保持 null，不根据 createdAt、最近消息、当前 turn 或字符串相似性回填；手动 retry 也不能发明原始历史。模块停用期间的 unknown 不追溯入队，重新启用不回放旧检测事件。发布 claim/task/unknown 仍由 ADR-017 核心 lease 与同步事务单写；研究 receipt 各阶段只在对应真实入队/接纳/完成/失败/取消/中断事件之后记录，不能因为提炼有输出就声称已发布。中断不是失败研究证据，也不自动产生新任务。

## 管理 API/UI 与重启语义

C06 只读 API 沿用 `/onebot-qq/api` 管理前缀、当前人格和 HTTP 200 JSON 约定；以下路径均相对该前缀：

| 方法与路径 | 返回 |
| --- | --- |
| `GET /system/loop/summary` | `{ok:true,personaId,collectedAt,processLifetime,retained,businessRecords,readiness,modules,providers}` |
| `GET /system/loop/runs?limit=&before=&kind=&state=` | `{ok:true,items,nextBefore}`；limit 默认 50、最大 200；kind 为 social/proactivity/research，state 为 running/completed/failed/interrupted |
| `GET /system/loop/detail?id=<loopId>` | `{ok:true,item,receipts,feedback,feedbackCount,research}` |
| `GET /system/loop/detail?decisionId=<decisionId>` | 同上；只按当前人格实际保留的 loop 关联查找，不补造历史 |

列表按 `(createdAt,id)` 降序稳定分页，before 是带进程签名、绑定人格/切换代次/kind/state 的不透明 cursor；切换人格或进程重启后旧 cursor 无效，更新不改变排序键。拒绝重复参数、未知字段、非法 kind/state/limit/cursor；非法查询为固定 `LOOP_QUERY_INVALID`。详情 id 与 decisionId 必须二选一；跨人格、已过期和不存在统一 `LOOP_NOT_FOUND`。读取失败为 `LOOP_READ_UNAVAILABLE`，不返回异常正文。

每次详情最多 200 条 outcome、200 个 task、200 个 evidence 和 200 个 claim；receipt 受每 loop 最多 16 条约束。`feedbackCount`、research 的 `taskCount/evidenceCount/claimCount` 提供仓库计数，`linksLimited` 表示关联列表截断；evidence/claim 计数的范围是本次选择的最多 200 个 task。只沿真实 unknownId/taskId/claimId/evidenceIds 关联，不做时间/文本近似；返回内部 ID、固定状态、计数和 policy 数值快照，正文仍在既有 learning 面。

summary 明确区分：`processLifetime` 为当前进程入站/拒绝/过滤原因和 observationFailures，`retained` 为 7 天/5000 联合上限内的 loop/receipt 状态、阶段、真实发送 parts、反馈来源/reward/归因/策略提交与覆盖率，`businessRecords` 为当前人格仍存储的业务记录状态统计（保留规则独立，绝非 all-time）。模块健康/降级和 provider 实际所有权复用 C03 缓存，只投影必要字段；readiness 不暴露网关地址/账号/错误正文。没有目标、人物、prompt 或 URL 标签。

`attemptedParts` 计核心交付边界逐 part 的实际求值次数（包括 gate/dry-run），不等于网络发送次数或计划 parts；preflight 未进入 part 为 0。独立 outbound 入口每次为 1。旧/缺失观测值为 null，summary 的 attemptedParts 任一未知即 null，同时提供 attemptedPartsKnown。sentParts 仅汇总确认成功的 parts；sentPartsComplete=false 表示仍存在完整投递结果未知的 attempt，不能把汇总解释成总共只发了这些。delivery 的 data 四字段与 ADR-006 返回保持不变，attemptedParts 是 receipt 的独立字段。

GET 不开始/继续 loop、不执行任务、更新 policy、发送消息、修复关联、初始化恢复或清理历史；即使物理缓存未清理，也隐藏超期与失去有效父 loop 的 receipt。继续使用管理 route 和 rejectSandboxApi，不增加 CORS、公开接口或 sandbox 能力。

核心认知管理页显示阶段、真实 delivery status/parts、no-send 原因、反馈 provenance/置信度/policyUpdated、研究关联与 null/未知。没有数据展示空态；不从 decision.status 推断送达、不把 interrupted 显示为成功或负反馈。模块详情的健康/人工 restart 使用 ADR-018；loop 不是 restart 的命令通道。保持既有 DSH 管理访问边界，不把回执暴露到聊天、Agent 工具、公开模块 API 或外部 iframe；不增加同源 React/action bridge、新 DSH slot 或通用执行入口。

正常结束只记录实际事件；进程重启时，由初始化恢复步骤把该人格持久化遗留 running loop 标为 `interrupted/stage:closed/reasonCode:PROCESS_RESTART`，保留已有 receipts。其它人格在各自仓库初始化、对外读取前完成同样处理，不在 GET 内改写。该转换只影响闭环观测，不将旧消息重发、不重跑 task、不把业务 running 改成 completed，也不恢复已丢失的发送结果。学习硬崩溃的业务任务继续按 ADR-017 由显式 retry 恢复。

发送与 receipt 落盘、网络超时、崩溃、最终同步卸载之间存在不可消除的未知窗口；运行期幂等/单 owner 不等于跨进程 exactly-once。重启后不推断未知窗口里发生的 I/O，不用自动补偿掩盖它，也不承诺所有历史均有完整回执。

## 后续实现验收约束

后续阶段应覆盖单一 delivery 写入/去重、ADR-006 全状态与实际 parts、异常未知窗口、各 no-send 路径、observed decision 的既有发送事实、反馈来源与事务回滚/去重、unobserved 不更新 policy、首次研究轮次不覆盖/不回填、7 天/5000 联合上限、人格切换/删除及重启 interrupted。C02 只冻结这些契约，不新增实现、测试或历史回执。

## C05 实现状态（2026-11-07）

C05 已实现无正文执行观测，不代表 C06/C07 的反馈/研究关联、查询 API 或管理 UI 已实现。

- 核心 `src/observability/loop.js` 是唯一观测仓库，显式传递不透明人格绑定 handle，无全局 current trace；新增 `loop_run` / `delivery_receipt` 人格 kind，复用现有 records，无 SQL migration。物理存储保留 `kind` 为仓库类型，逻辑 kind 分别为 `loopKind` / `receiptKind`。
- LoopRun 使用上文 Loop v1 字段并增加 `stages:[{stage,at}]`、`receiptRefs`、`unknownRefs`；分别最多 16/16/4 项，内部引用最多 96 个 ASCII 字符，单记录最多 8 KiB。unknown 只记实际检测 ID，不实现研究或 firstDetectedTurnId 的传播/历史回填。原因与错误只取固定代码，入参按白名单拒绝额外字段，发送结果先投影后进入 observer。
- DeliveryReceipt 使用 delivery Receipt v1 字段，增加 `status:running|completed|interrupted`、`completedAt`、`reasonCode` 和 `moduleId` 归因；`data:null` 表示尚无完整结果。无 parent 的既有直接 outbound/模块发送只建 attempt，`loopId:null`，不虚构社交轮次。attemptId/eventId 在接纳时生成，原 handle 只允许一次终结；多层调用显式传递 owner/attempt，不能生成分条或 wrapper 回执。
- executor 唯一拥有 multipart 最终回执，outbound 的原 gate/part 返回仍贡献真实执行结果；DeliveryService 的正常与 preflight 拒绝都交给同一 executor 观测，不再创建外层回执。严格保留 ADR-006 的 partial+ok、实际 parts、从零开始的 failedPart、首条/后续 dry_run、fallback 和不重试；transport/业务回调异常终结为 `interrupted/data:null/EXECUTION_THROW` 并继续传播原异常。outbound 原来捕获的网关错误仍按原 SEND_FAILED 返回。
- 社交 admitted turn、决策/生成/交付/观察阶段与主动 port 接纳 run 接入；命令回复、模块 sendText/delivery 带核心 module/runtime 归因。入站与受控 action 仅增加进程内聚合计数/首末时间和拒绝计数，访问检查仍先于原始事件持久化，拒绝不生成 loop。
- 本阶段 wait/silence/learn-only、群聊 gate、compose skip/空生成只结束 loop，**不生成任何 receipt**；上文 no_send Receipt 留待后续阶段。命令媒体直送、Agent 工具内部/模型内部步骤、recall/poke 的完整动作阶段未搬迁执行；走现有 outbound/executor 的发送仍有独立 attempt，不推断缺失关联。未增加第二套 pipeline、反馈学习、研究 attempt 或 API/UI。
- 保留按人格执行 ADR 的更严格 **loop+receipt 合计 5000** 上限（同时满足每种最多 5000），最长 7 天，loop 按 startedAt、attempt 按首次 createdAt 原始寿命，不因更新延长；正常结果的 occurredAt/recordedAt 为实际完成/写入时间，未知结果不补造发送事件。启动一次扫描、之后维护增量索引并在写入时清理，无后台 timer；按 loop 整组淘汰，无悬空回执，已淘汰 handle 不再追加或重建历史。观测 kind 不参与人格数据复制，删除人格清除两种记录；已接纳发送可在切换后完成原人格记录，删除后不重建。
- 启动在接纳业务前为所有已持久化人格初始化，遗留 running loop 与 attempt 标 interrupted，保留真实完成回执；不 resume/resend、不从 decision.status 补造回执。落盘失败、崩溃和过期淘汰仍可能留下未知观测；observer 的失败被隔离，不改变发送返回/异常或触发网络重发。没有跨进程 exactly-once 保证。

C05 验证包括新的 `test/system-loop.test.js` 及 ingress/delivery/outbound/pipeline/persona/commands/module/proactivity 回归；执行全套 npm tests、文档/对等/本地打包/包检查和 diff whitespace 检查。真实 QQ、模型与网络故障窗口未作在线验收，版本与发布状态不变。

## C06 实现状态（2026-11-07）

C06 已实现反馈/策略/研究关联及上述只读 API，C07 UI 尚未实现。

- `recordOutcome(decisionId, observation, {source,dedupeKey})` 白名单化布尔观察、sentiment（-1–1）、归因枚举和置信度（0–1）；只沿现有 inferReward/Beta 规则更新，不改算法、权重、rate ledger 或预算。incoming 保持 heuristic（原置信度 0.5）；reaction 只有当前人格/切换代次、相同目标和私有 messageId 映射命中才 direct（保留原置信度 0.6）。manual 使用管理请求的 requestId 作为 dedupeKey；缺失/非法 requestId 拒绝，旧调用方需携带 requestId。unknown 明示来源未知。
- 来源事件的去重键保存在人格业务 outcome，按 decisionId+dedupeKey 去重，不依赖短期 receipt。incoming 使用实际 turn.id；既有 pending 设计每个 decision 消费第一次匹配 reaction，用其 decision 内部 ID 固定该观察槽位。receipt 的 sourceEventId 是在接纳时生成并保存到 outcome 的不透明观察 ID，平台映射/去重键不暴露到 loop API。
- 核心 feedback owner 先确认同人格、仍在保留期的 parent 和实际 parts>0 的完整 delivery receipt，再在同一同步 store 事务内完成 outcome、decision.outcomeId、policy alpha/beta/trials/rewardSum、feedback receipt 与 parent 引用；outcome 保存 policyBefore/policyAfter。后续 dry-run 前已确认的发送 parts 仍可归因，首条 dry-run、no-send、异常未知或过期/删除证据不能产生新 trial。容量/每 loop 16 回执耗尽也拒绝新反馈学习；业务去重返回先前 outcome，不重复提交。
- store 显式声明同步原子事务能力；缺少该能力/owner 时拒绝，不 fallback。SQLite 复用原事务；JSON 在外层事务提交时一次原子 rename 发布完整快照，写入中途不落部分 outcome/policy。任一写失败回滚，feedback 错误向调用方传播，自动路径不再继续技能反馈，失败计数可读。没有跨进程 exactly-once 承诺。
- unobserved 返回 reward:null/policyUpdated:false/outcomeId 不存在，不写 outcome/receipt、不调用奖励规则、不增加 trials；原 pending 到期仍只删除待观察槽位，不自动记录负/中性反馈。未添加新的自动反馈入口或 observer timer。旧 outcome 的 source 为 unknown，缺失 sourceEventId/归因/policyBefore/policyAfter/policyUpdated 保留 null，不推断旧策略是否提交。
- unknown 仅在实际 turn 首次创建时保存 firstDetectedTurnId；人工无 turn 为 null，重复检测不覆盖，旧记录不回填。learning port 为每次实际 claim 建独立 research loop，保存 task/unknown/首次轮次、module/runtime；真实 running/完成/失败/取消/release 后记研究 receipt，retry 建新 attempt，旧 attempt 不改写。claim 发布继续由原 lease 和同步事务控制，loop 权限不能发布业务结果。排队与尚未执行的任务通过业务引用/summary 表示，不虚构研究 attempt。
- 扩展 cognition-learning、learning-port、persona、feedback/policy、E2E 回归，新增 `test/loop-api.test.js`；覆盖分页/隔离/无正文、保留与只读、事务失败/去重、legacy unknown、首次轮次、取消/retry/中断。运行 npm test、check:docs、check:parity、pack:release、check:package、git diff --check；仅本地构建验证，无 UI、版本变更、推送、部署或发布，未连接真实 QQ/模型验收。

仍保留 C05 未接入路径的未知窗口：wait/silence/learn-only/gate/compose skip 等只有 loop 终结码，没有 no_send receipt；未观察到的历史送达、超时/无后续反馈、崩溃 I/O 不能补造为失败/负反馈。原研究内容与业务保留周期不受短期 loop 清理影响。


### Live 缺口补验：发送边界

`send_*` OneBot 调用一律不做网络重试或 HTTP → WS 回退（显式 retries 也不能覆盖），读取调用保留原重试/回退。`test/send-boundary.test.js` 在 mock 平台已接受后模拟应答丢失，验证只收到一次；主动 port 的 token 在 await 前同步 consumed，重复 send 同一 token 无 I/O。失败回执不等于平台未发送。没有 QQ 平台幂等键就不能承诺 exactly-once；operation 的 requestId 保留期去重不等于任意发送去重，新的人工意图仍可能重复。通用 multipart 无稳定意图键，不按文本/目标启发式建立 ledger；现有主动 token 和 operation registry 保持各自单 owner。
