# ADR-019：系统闭环 v2 关联、回执与反馈契约

- 状态：已批准，待实现（C02 仅文档，不代表已有 API/UI）
- 日期：2026-11-07
- 基线：分支 `feat/closed-loop-v2`，C01 `5e0c6c4`
- 前置：[ADR-006](ADR-006-delivery-result-status.md)、[ADR-016](ADR-016-builtin-proactivity.md)、[ADR-017](ADR-017-builtin-learning.md)、[ADR-018](ADR-018-module-closed-loop.md)

## 决定与边界

为社交回复、主动行为与研究提供统一、无正文的关联视图：已观察到什么、在哪一步停止、真实发送了多少、反馈从哪里来、是否完成策略更新。loop 是管理投影，不接管 pipeline、DeliveryService、policy 或 learning provider，也不建立第二套业务执行器。loop 完成、decision 状态、发送回执、研究发布和用户反馈分别表达不同事实。

后续实现才增加记录与 API/UI。本 ADR 不改变 C01 的贴纸授权区分、ADR-006 的执行器行为、出站闸门、主动/学习停用无 fallback、人格租约或原研究数据。没有自动重发、自动恢复任务或跨进程 exactly-once 承诺。

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
  source: 'followup' | 'reaction' | 'recall' | 'explicit_correction' | 'timeout',
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

**unobserved ≠ negative**：超时、无后续消息、窗口到期、人格切换、观察器停用、历史清理或重启均不证明用户忽略/不满。需要记录时使用 `source:timeout/attribution:unobserved/observation:unobserved/reward:null/outcomeId:null/policyUpdated:false`，不调用负奖励，也不以 reward=0 的“中性样本”增加 trials 或 alpha/beta。超时后的实际反馈只有仍有合法归因证据时才接纳，并按原事件去重，不能补写想象中的负反馈。

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

拟新增只读 API，沿用 `/onebot-qq/api`、当前人格和 HTTP 200 JSON 约定：

| 方法与路径 | 返回 |
| --- | --- |
| `GET /cognition/loops?limit=&cursor=&kind=&status=` | `{ok:true,items,nextCursor}`；limit 默认 50、最大 100，kind/status 只接受上述枚举 |
| `GET /cognition/loops/detail?id=<loopId>&cursor=` | `{ok:true,item,receipts,nextCursor}`；回执每页最多 100，续页携带 cursor；未知为 `LOOP_NOT_FOUND` |

cursor 是绑定当前人格与查询条件的不透明分页标识；拒绝任意 kind/store/predicate/跨人格参数，切换人格后旧 cursor 失效。详情 receipt 依 recordedAt/id 稳定分页，列表同样有界。GET 不开始/继续 loop、不执行任务、更新 policy、发送消息、修复关联或清理历史。无效参数为固定 `LOOP_QUERY_INVALID`，响应不包含正文或原始异常。

核心认知管理页显示阶段、真实 delivery status/parts、no-send 原因、反馈 provenance/置信度/policyUpdated、研究关联与 null/未知。没有数据展示空态；不从 decision.status 推断送达、不把 interrupted 显示为成功或负反馈。模块详情的健康/人工 restart 使用 ADR-018；loop 不是 restart 的命令通道。保持既有 DSH 管理访问边界，不把回执暴露到聊天、Agent 工具、公开模块 API 或外部 iframe；不增加同源 React/action bridge、新 DSH slot 或通用执行入口。

正常结束只记录实际事件；进程重启时，由初始化恢复步骤把该人格持久化遗留 running loop 标为 `interrupted/stage:closed/reasonCode:PROCESS_RESTART`，保留已有 receipts。其它人格在各自仓库初始化、对外读取前完成同样处理，不在 GET 内改写。该转换只影响闭环观测，不将旧消息重发、不重跑 task、不把业务 running 改成 completed，也不恢复已丢失的发送结果。学习硬崩溃的业务任务继续按 ADR-017 由显式 retry 恢复。

发送与 receipt 落盘、网络超时、崩溃、最终同步卸载之间存在不可消除的未知窗口；运行期幂等/单 owner 不等于跨进程 exactly-once。重启后不推断未知窗口里发生的 I/O，不用自动补偿掩盖它，也不承诺所有历史均有完整回执。

## 后续实现验收约束

后续阶段应覆盖单一 delivery 写入/去重、ADR-006 全状态与实际 parts、异常未知窗口、各 no-send 路径、observed decision 的既有发送事实、反馈来源与事务回滚/去重、unobserved 不更新 policy、首次研究轮次不覆盖/不回填、7 天/5000 联合上限、人格切换/删除及重启 interrupted。C02 只冻结这些契约，不新增实现、测试或历史回执。
