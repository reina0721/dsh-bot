# ADR-018：模块闭环 v2 健康、所有权与人工恢复契约

- 状态：C04 已实现固定动作、操作注册表与人工恢复；C03 健康/遥测/Provider 所有权保持；系统闭环（C05）与 UI（C07）未实现
- 日期：2026-11-07
- 基线：分支 `feat/closed-loop-v2`，C03 `e444574`
- C03 实现状态：健康 GET（含 `?id=`）统一返回 `{ok,collectedAt,revision,items,summary}`；增加有界 reasons、lastError、dependencies、phase、scheduler/engine 聚合计数与停用后 telemetryGeneration 标签。未接入遥测保留 null。
- C04 实现状态：固定六项动作、异步操作查询与人工内置 restart 已实现；下文动作字段/128 条与 1 小时保留策略取代 C02 初稿。提醒停止失败保留 owner 并阻止 fallback/替换；同步宿主 dispose 仍维持既有最终撤销边界。
- 前置：[ADR-010](ADR-010-provider-composition.md)、[ADR-012](ADR-012-builtin-reminders.md)、[ADR-014](ADR-014-module-webui.md)、[ADR-015](ADR-015-builtin-media-features.md)、[ADR-016](ADR-016-builtin-proactivity.md)、[ADR-017](ADR-017-builtin-learning.md)

## 决定与范围

核心管理面提供只读健康快照与受限人工恢复。生命周期、业务健康、provider 所有权分别建模；任何一项都不能替代另外两项。C02 先批准契约；C03 实现只读健康，C04 实现受限人工动作。C04 不增加业务配置、存储迁移、权限、版本、系统闭环 timer 或 UI。

| 维度 | 唯一事实来源 | 表达什么 |
| --- | --- | --- |
| lifecycle | module kernel 的公开 `status` | `disabled/loading/loaded/error/blocked`；setup 与依赖状态，`loaded` 不等于业务正在工作 |
| health | 核心聚合的 `ModuleHealth` 缓存 | 当前 runtime 已观察到的业务状态、timer、在途工作与固定故障码；未观察不能猜测正常 |
| provider ownership | 宿主所有权协调器及受信内置端口 | 槽位实际由谁启动、是否已停止/排空；registry 中存在对象只证明注册 |

模块已加载但业务开关关闭可以健康地空闲；提醒模块停用时核心 fallback 可以继续持有提醒服务。模块 lifecycle 不随 fallback 改写成 loaded；健康也不能把其它 owner 的活动记在该模块名下。

## ModuleHealth v1 形状、枚举与空值

以下为 JSON 投影契约，时间均为 UTC epoch ms，计数为非负安全整数。对象只包含列出的字段，不透传模块任意对象。

```text
ModuleHealth = {
  version: 1,
  moduleId: string,
  lifecycle: 'disabled' | 'loading' | 'loaded' | 'error' | 'blocked',
  runtimeGeneration: string | null,
  health: 'unknown' | 'healthy' | 'degraded' | 'unhealthy' | 'stopped',
  reasonCode: string | null,
  observedAt: number | null,
  telemetry: {
    lastStartedAt: number | null,
    lastStoppedAt: number | null,
    lastSuccessAt: number | null,
    lastFailureAt: number | null,
    nextRunAt: number | null,
    inFlight: number | null,
    timerScheduled: boolean | null
  },
  providers: ProviderOwnership[],
  actions: [{ action: 'restart', available: boolean, reasonCode: string | null }]
}

ProviderOwnership = {
  name: 'reminders' | 'mediaFeatures' | 'proactivity' | 'learning',
  registeredModuleId: string | null,
  owner: 'module' | 'core' | null,
  ownerModuleId: string | null,
  ownerRuntimeGeneration: string | null,
  state: 'unknown' | 'unowned' | 'starting' | 'active' | 'draining' | 'failed',
  fallback: { active: boolean, reasonCode: string | null },
  observedAt: number | null
}
```

`health` 含义固定：`unknown` 为尚无足够遥测；`healthy` 为已观察正常或合法空闲；`degraded` 为部分能力受限（如预期 provider 未接管）；`unhealthy` 为已观察业务故障；`stopped` 为确认没有活动 runtime。`error/blocked` 可以没有 runtime，界面仍必须展示 lifecycle 故障，不能只显示 stopped。不能根据一段时间无成功、业务关闭或一个 timer 存在就推断失败或正常；健康阈值只能来自各受信适配器的固定规则。

`null` 表示未知、未观察或不适用，不能转换为 `0`、`false`、空字符串或当前时间。`inFlight:0` 表示明确观察到零；`timerScheduled:false` 表示确认无 timer；`nextRunAt:null` 不证明调度已停。未运行时 `runtimeGeneration:null`；已确认停止为 `health:stopped`，但没有 telemetry 来源的字段仍为 null。无 provider 的模块为 `providers:[]`，不虚构槽位。时间戳只在实际事件时更新，GET 不刷新 `observedAt`。公共故障码来自核心固定白名单（例如 `MODULE_DISABLED`、`DEPENDENCY_BLOCKED`、`PROVIDER_UNAVAILABLE`、`BUSINESS_DISABLED`、`STOP_PENDING`），未知错误归一为固定 `MODULE_HEALTH_UNKNOWN`；不返回原异常文本/堆栈、路径或内容。

`runtimeGeneration` 是核心为每次 setup 的 runtime 创建的不透明唯一标识，包含 draining 尚未清理完成的实例；只有实际创建新 runtime 才换值。遥测、owner、操作及迟到回调必须绑定该标识，旧实例不能修改新实例健康。它不等于 UI 目录的 `generation`：后者也可能因 UI 授权/资源变化而轮换；`uiRevision` 只描述 UI 内容。UI 授权变更不能让正在运行的实例失效，runtime 重启则必须使旧执行引用失效。三者不得复用作彼此的并发凭证。

## Provider owner 与提醒 fallback

未观察到所有权时为 `unknown/owner:null`，不能直接记成已确认无人持有的 unowned。所有权状态机由实际 start/stop 完成事件驱动：`unowned → starting → active → draining → unowned`；启动/停止失败记为 `failed`，保留未证实释放的 owner 身份与故障码。`starting` 不承诺服务可用，`draining/failed` 不代表所有权已经释放。只有已证明没有旧 owner 才能启动新 owner。`ownerModuleId` 与 `ownerRuntimeGeneration` 仅在 owner 为 module 时非 null；core 不冒用内置模块 runtime。

提醒必须同时显示以下三件事：

1. **注册**：`registeredModuleId` 来自 registry。注册可以早于 start；移除也不证明 stop 已完成。
2. **实际 owner**：来自宿主串行协调状态。模块注册仍在但启动失败时，实际 owner 可以是 core；交接途中应显示 starting/draining。
3. **fallback**：只有核心兼容提醒服务实际接管时才 `fallback.active:true`，原因区分 `NO_PROVIDER` 与 `PROVIDER_START_FAILED`。不是“未注册”的别名，也不是启动失败即已回退成功。

沿用 ADR-012 的单所有者与排空语义，先停旧 owner，再启动新 owner；业务 `reminders.enabled:false` 不删除 owner，只令 tick 合法空闲。同一次失败注册不循环重试；健康轮询不重试、不触发 fallback。无法确认旧服务已停止时不得启动第二调度器，展示未完成交接。mediaFeatures/proactivity/learning 停用仍没有核心 fallback；不得为了健康恢复复制其引擎。C01 的贴纸库注册/管理资格与发送资格继续分离，健康或恢复动作不绕过任何业务开关/发送闸门。

## 只读健康与缓存遥测

已实现 `GET /onebot-qq/api/modules/health?id=<moduleId>`，指定或省略 id 均返回 `{ok:true,collectedAt,revision,items,summary}`。未知 id 返回固定 `MODULE_NOT_FOUND`。快照由核心在 setup/stop、调度、固定端口接纳/完成工作、provider 交接时维护；外部缺遥测时显示 unknown/null，不增加外部健康执行权限。

GET 必须无副作用：只复制有界缓存与 kernel/owner 元数据，不扫描目录、不 import、不调用模块/provider 的 `status/stats/start/stop` 或任意 getter/探针，不访问网络/LLM/网关，不读取配置秘密或业务正文，不排 timer、不写存储、不补偿旧状态。缓存缺失直接 unknown；需要更新的事件由其原 owner 主动报告，不能为健康建立另一套业务 timer。只读刷新和 UI 轮询永不触发恢复。

## 固定动作、操作注册表与 requestId

`src/modules/actions.js` 固定 allowlist 为 `module.enable`、`module.disable`、`module.restart`、`module.reload`、`proactivity.runOnce`、`learning.runPending`。执行器在内核编译期绑定；HTTP 只提供下面列出的数据字段，不接受 payload、URL、路径、provider 名称/方法或任意参数。manifest 不得声明 `actions`；外部仅能启停/重载，不能 restart 或 run。

管理 API 沿用 HTTP 200 + JSON `ok/code/message`：

| 方法与路径 | 请求/响应契约 |
| --- | --- |
| `GET /onebot-qq/api/modules/actions?id=<moduleId>` | `{ok,moduleId,expectedGeneration,expectedPersonaId,expectedPersonaGeneration,items:[{actionId,available,reasonCode}]}`；只查询资格，不执行动作 |
| `POST /onebot-qq/api/modules/action` | 精确 `{moduleId,actionId,expectedGeneration,requestId,expectedPersonaId?,expectedPersonaGeneration?}`；接纳返回 `{ok:true,operation}`，只表示已登记 |
| `GET /onebot-qq/api/modules/operation?id=<operationId>` | `{ok:true,operation}`；也可仅用 `?requestId=` 查询；读取不驱动执行 |

`requestId` 为 1–128 字符 ASCII 字母/数字/`_`/`-`。`expectedGeneration` 使用 actions GET 返回的凭证：存在 runtime 时为 runtimeGeneration，否则为目录 generation；UI grant 单独改变目录 generation 不会让已运行实例的动作失效。新动作必须匹配当前凭证。可选人格 ID 与非负整数 scopeGeneration 在接纳和进入队列后检查；run 即使未显式携带也捕获当前人格范围，排队时切换即取消，业务端口继续约束执行中的迟到结果。未运行目标的 null 凭证不能用于绕过检查。

未知字段/动作/无效输入在副作用前返回 `MODULE_ACTION_INVALID`；未知目标为 `MODULE_NOT_FOUND`，资格不符为 `MODULE_ACTION_UNAVAILABLE`，代次过期为 `MODULE_RUNTIME_CONFLICT`，人格过期为 `MODULE_PERSONA_CONFLICT`，闭包冲突为 `MODULE_ACTION_BUSY`。资格遵循 enabled/disabled、loaded/error/blocked、外部清单上限、认知/业务开关与暂停；run 仍经过引擎的候选、任务、预算、quiet/backoff、access/delivery 等既有闸门。

operation 只包含固定输入、`id/status/phase/code/createdAt/updatedAt/completedAt/result/resultRuntimeGeneration`；`result` 为 `{ok,code}`，不包含业务结果、异常正文、配置或秘密。状态为 `queued/running/succeeded/failed/cancelled/STOP_PENDING`，phase 为 `queued/running/draining/starting/done`。忙碌、跳过、无任务、任一失败与不可用均不能记为成功；代次/人格在队列中失效为 cancelled。终态不可由迟到回调反转。

登记、全局 requestId 去重及闭包预留在同一同步步骤完成。相同输入重提返回原 operation（包括失败/完成），先去重再检查当前代次；同 requestId 不同字段返回 `MODULE_REQUEST_CONFLICT`。每模块只有一个活动 operation；生命周期预留完整传递下游，和内核串行队列共用执行路径，进入队列时重新检查代次/资格/闭包。run 的网络等待不占内核生命周期队列，但其模块预留持续到 operation 终结。

注册表最多保留 **128** 条，包括 active 与 terminal；terminal 完成后保留 **1 小时**，到期查询/接纳时删除，不设清理 timer，不提前驱逐。容量已满返回 `MODULE_OPERATION_LIMIT`，原查询/重复请求仍可用。active 包括 STOP_PENDING 永不驱逐。幂等期为当前进程内保留期，不跨进程、不跨保留期，也不承诺 exactly-once；过期后 requestId 可复用。手动重试需要新 requestId，进程中断不续跑。

既有 toggle/reload/run HTTP 共用动作 helper 并保留 `{ok,item}`、`{ok,result}`、`{ok,results}` 响应形状；run 的业务 busy/skip/failed 原结果仍原样返回，而 operation 记为非成功。新 learning action 固定最多运行一个 pending，旧 learning run 仍支持有界 max 1–50。首次发现尚未进入目录的外部模块仍走既有 reload/安装 helper；已有目标的 HTTP 操作进入注册表。重复同状态 toggle 直接返回当前模块。底层内核的内部启停/重载方法保留既有串行语义，并拒绝侵入已预留闭包。

## 人工 restart 与 10 秒 STOP_PENDING

restart 使用已加载的内置代码重新 setup，不重新 import 或改变持久化 enabled。只接受 enabled、loaded、具有当前 runtime、无依赖错误且核心静态策略允许的内置模块；不是安装、代码更新、修复 error/blocked 或启用 disabled 的快捷方式。停止/启动过程中再次检查状态与代次。error 恢复可用人工 enable；无法证实提醒旧 owner 停止时继续 fail closed，需在宿主运维边界处理。受影响范围为目标及其运行中的传递下游；不得自动启用原先关闭的模块或依赖。

顺序必须为：

1. 在串行队列内冻结受影响依赖闭包，标记恢复中，关闭新业务接纳；按依赖逆序先下游后目标。
2. 请求 provider stop，同步清 timer、取消订阅并失效新任务/run token；提醒保留已提交发送写回所需的捕获仓库，等待现有 tick 排空。主动/学习仍遵循 ADR-016/017 的 token/lease 撤销与迟到结果隔离，不等待不可控网络来允许它们重新发布。
3. provider 确认排空后才撤销其余 runtime API、清理命令/hooks/disposers、排空存储并移除注册；旧 owner 未释放前不交给 fallback 或新实例。
4. 全部必要停止完成后按依赖正序 setup 目标与原先运行且仍可运行的下游。新实例换 runtimeGeneration；失败按既有 error/blocked 规则隔离，重新读取健康和所有权后才能报告恢复结果。

提醒协调器必须参与同一恢复操作；拆卸时的临时注销通知不能在步骤 3/4 之间抢先启动 core fallback。只有恢复选定的 owner 或失败后的正常回退可以接管，且仍须先确认旧 owner 已释放。C04 通过宿主提醒协调器的恢复保护参与同一操作，等待已在进行的交接，再冻结通知驱动的交接；停止失败保留 failed owner，任何后续所有权同步都不会自动重试或启动第二调度器。setup 完成还需确认受影响 provider 实际 active/代次一致才能报成功。任意本地外部代码不能被进程内 API 彻底隔离；错误第三方 stop 的拒绝仍不能证明其已排空。

从进入 draining 起计时，10 秒仍有未完成 drain，operation 进入非终态 `STOP_PENDING/phase:draining/code:STOP_PENDING`，供管理查询与 UI 显示“停止尚未完成”；POST 已返回登记结果，不必保持 HTTP 等待。此状态不是 succeeded、failed 或已取消。超时不等于停止：不强行撤销提醒写回仓库、不提前启动新实例/fallback、不释放该闭包的串行保护，也不重复 stop。后台仅等待同一 drain；最终完成后继续原 operation，拒绝则固定失败并保持故障/所有权事实。相同 requestId 查询同一 pending 操作；冲突的新恢复请求不得并发进入。挂死的 drain 可能一直 pending，最终人工处置在原宿主运维边界完成。

没有自动 restart、定时重启、退避重启、失败计数触发循环或健康读取触发修复。restart 不保证收回已接纳的外部请求、不重发消息、不补跑提醒/主动/学习历史。同步宿主 dispose 继续遵循既有最终撤销/禁止写回约定，不为 Web 操作把关库无限延迟；进程中断也不自动续跑 operation。

## 外部恢复与 UI 边界

外部模块通过固定 toggle/reload helper，保留清单上限、依赖图、配置 revision 和授权绑定；不增加外部 restart、provider 权限、健康探针导入或特殊自动修复。原错误恢复能力及信任层级不变。

后续 C07 核心模块详情应分别展示 lifecycle、health、实际 owner/fallback 和 operation。C04 未修改客户端，也未新增 UI action bridge。核心 action 按 allowlist/服务端可用性呈现，接纳后轮询 operation 再刷新健康；禁止把 POST `ok:true` 当作已恢复。未知/null 显示“未观察/不适用”，不得显示成零故障。新请求超时先按相同 requestId 确认，不能自动生成新 id 重启。

沿用 ADR-014：只有核心客户端调用管理 API；受信编译期 React preview 保持纯只读，不获得请求/操作执行权；外部没有同源 React、宿主 exports 或 action bridge。隔离 iframe 的 ready/resize/notify 桥不新增健康查询、restart、配置保存或任意 HTTP 代理。管理面继续使用既有 DSH 访问边界，不新增 DSH slot、Agent 工具或聊天恢复命令。

## C04 验证与后续边界

已覆盖固定动作/输入拒绝、外部清单不能声明动作、代次/人格拒绝、requestId 去重/冲突、128 条容量与一小时 terminal 清理、active 保留、闭包逆序 drain/正序 setup、导入一次、配置/存储保留、失败隔离、提醒接纳与捕获写回分离、STOP_PENDING 后无双 owner、主动 token/学习 lease 撤销、既有 HTTP 形状和动作 E2E。

没有 C05 系统闭环、自动 restart/retry、恢复 timer 或健康触发补偿；没有 C07 UI、外部 provider/执行权限、重放发送或历史补跑。registry 为进程内有界记录；超长 drain 可永久占据闭包和生命周期队列，10 秒不是取消或强制释放。停止失败后不伪装成功；未验证真实 QQ、远程模型/来源或浏览器。C03 健康快照的 actions 字段仍为空，C04 资格由独立 actions API 提供。
