# ADR-021：隔离模拟服务图（AstrBot alignment C04–C05）

- 状态：C04 隔离服务与 C05 离线 Chat/event WebUI 已实现；C05 基线 C04 `ae80c37`。
- 范围：离线 Chat/event 服务、HTTP API 和六区内 WebUI；执行沙箱仍属于 C06，未实现。

## 决策与共享边界

`src/services/assembly.js` 的 `assembleServices()` 组装 access、event store、provider/delivery registry、turn hooks、cognition、module kernel 与 ingress。`host.apply()` 调用一次装配，并继续独占配置加载/密钥登记、真实模型网关、媒体、QQ gateway、prompt variables、DSH provider/HTTP 注册、branding、backup/upgrade 和提醒 provider 动态所有权交接。模拟服务直接调用同一装配，不再调用 `apply()`。

装配参数包含显式 dataRoot、configSnapshot（或 live getConfig/setConfig）、store、clock、scheduler、modelAdapter、actionTransport、eventBus/runtimeContext、runtimeAdapter、sourceRegistry、embeddingAdapter 与 deliverySleep。live 保留既有实现和默认值。runtime 的数据目录由根目录派生，不再越过注入的 cognition 目录回到全局 pluginDataDir；host 显式保持原 `<data>/runtime`。event store 可注入目录/时钟，host 的旧 persist.file 行为不变。模块 timer driver 可注入，live 继续使用原生单调时钟分段等待；内置提醒通过只读 api.clock 使用图内时钟。

模拟复用真实 normalize/access/ingress/event filtering/aggregation/command/cognition/policy/outbound/delivery executor、人格 scoped store、approval/request/reminder 服务与 module kernel。只装配受信包内 typing、reply-delivery、reminders、sample（默认停用）模块；禁止外部模块发现。媒体、学习、主动行为 provider、动态提醒所有权恢复流程和宿主注册不在模拟图中。知识注册表使用 fixture search/fetch，模型采用 fixture analysis/compose，runtime 采用独立 session namespace；没有 DSH agent、本机工具或媒体网络适配器。

## 隔离保证

- 每次 create 使用新临时子目录、新 SQLite/store、新人格 ID、新 config snapshot、私有 EventEmitter、registry、模块目录/状态、approval/request/reminder/loop 命名空间和 runtime 会话前缀。没有复制 live 人格、记忆、配置、模型 provider、密钥或 ctx 服务。
- 不读取/切换 process.env，不替换 globalThis.fetch，不调用 loadConfig/saveConfig/refreshSecrets，不修改进程级密钥登记。配置命令只写图内 snapshot；落盘使用显式目录。UUID、文件原子写临时名可使用系统随机数/时间，不是虚拟业务时间。
- 捕获 transport 复用真实 OneBot action 参数封装，send/upload/like/poke/typing/moderation/request 等已知动作只记 capture，永不打开网络或读取上传路径。raw 即使名称已知也拒绝；未知 wire action/方法记录 blocked 并抛错，没有 live fallback。关闭 transport 后所有动作拒绝。
- 所有业务聚合、提醒、回复条间等待与模块调度使用手动虚拟时间；submit 不自动推进时间。advance 按截止时间执行，包括异步回调创建的后续虚拟任务；最多推进一天、一次最多 10000 个回调。仅用 setImmediate 排空本地 Promise 队列。
- 管理方法串行，reset/delete 排空模块、关闭捕获 transport、取消 timer/等待、等待认知工作结束，再关闭 store/删除目录。reset 重新生成全部状态和 namespace generation；旧 requestId 可以在新 generation 重用。delete 后读写均 not found；host 卸载调用异步清理。
- 捕获结果和业务交付 receipt 分开返回。业务 receipt 沿用真实 executor 的 sent/parts 语义，但整个响应标记 environment:simulation，capture 明确 realSend:false；这不证明 QQ 送达。

## C05 HTTP API 与人格绑定

当前前缀 `/onebot-qq/api/sandbox/chat/`，沿用宿主管理访问边界及 opaque frame 拒绝。C04 的未绑定 `/simulations/*` HTTP 路由已移除，避免绕过人格隔离；底层 `host.simulations` 仍是受信任内部服务，不是 HTTP 入口。所有路径独立于 live `/send`、`/action`、`/events`。

| 方法/路径 | 严格输入 | 输出 |
| --- | --- | --- |
| POST create | requestId，可选 typing/reminders 布尔值 | 完整 detail，新 id、generation |
| POST event | requestId、id、event | 完整 detail，单次 admission receipt |
| POST advance | requestId、id、ms | 完整 detail，timer 的 now/pending/errors |
| GET detail?id=… | 单一 id 查询参数 | 完整 detail |
| POST reset | requestId、id | 完整 detail，新 generation，恢复初始 fixture |
| POST delete | requestId、id | 删除确认，空观测集合 |
| GET list | 无参数 | 当前人格的 id 列表，空观测集合 |

每个响应包含 `environment:'simulation'`、`realSends:0`、requestId，以及 transcript、captures/capturedActions、receipts、deliveryReceipts、loops、stages 集合。detail 还包含 boundPersonaId、模拟 persona、只读 configSnapshot、虚拟 now、sessions/notices/requests/stats/counts/access。stage 带 loopId；业务 receipt 的 sent/parts 是捕获 executor 的结果，不是 QQ 送达证据。GET 与输入读取失败响应使用服务生成的 requestId。method/opaque guard 沿用公共 HTTP 边界，错误也带 simulation envelope 与服务生成的 requestId。

create 仅使用默认模拟人格和固定 fixture 回复，不复制 live 配置、人设、记忆、provider 或凭据。typing/reminders 默认开启。configSnapshot 仅投影 fixture/offline、network/media/execution:false、typing/reminders/access；UI 不提供人格或配置写入口。内部命令可改本图状态，reset 恢复创建时 fixture。

HTTP adapter 只接收 isolated simulations 与当前人格 ID reader，不持有 live gateway/store/loop/config。服务端在 create 记录 opaque UUID → 当前激活人格绑定；list/detail/event/advance/reset/delete 只接受该人格会话，未知、格式错误与跨人格 id 统一 404 `SIMULATION_NOT_FOUND`。调用者不能指定 personaId 或所有者。队列执行前后重查人格；create 中途切人格会清理新会话并拒绝响应。绑定随进程驻内存，切回原人格可继续访问；这不是新增用户/租户授权系统。

所有 mutation 顶层 requestId 必填，限 1–100 个 ASCII 字母、数字、下划线或连字符；顶层和 event 均拒绝未知字段。event 仅接受 kind（message/notice/request）、chatType（private/group）：message 的 text 必填、最多 4000 UTF-16 code units，可选 addressed 布尔值；notice 的 type 仅 private:friend_add / group:group_increase；request 的 type 仅 private:friend / group:group。bot/member/group/message ID、sender role、request flag 由服务生成；不允许 raw frame、action、sender/owner/operator/admin、QQ ID、路径或凭据。固定合成参与者为本图 owner，群 sender.role 仍为 member，真实权限检查仍在 access/command 内执行。

请求体流式限制 16 KiB，重复/额外 query 拒绝；默认最多 16 个服务会话，每个 HTTP adapter 每分钟最多 120 个解析后请求（含无效字段），最多 8 个排队/执行请求。会话最多成功提交 1000 次 event/advance，达到后要求 reset/delete；单次 advance 为 0–86400000 整数毫秒，最多 10000 个 timer 回调。额度为进程内全局管理额度，不信任转发 IP 或 caller owner。错误使用固定 code：输入 400、not found 404、event 冲突 409、资源额度 429、内部不可用 503，不回传内部异常/路径。

同 generation 的 event requestId 在接纳前幂等，相同输入返回原 receipt，不同输入报冲突；重复提交仍占 HTTP 操作额度。create/advance/reset/delete 的 requestId 用于关联，不承诺幂等或跨进程 exactly-once，UI 不自动重试 mutation。命令与聚合结果需 advance，submit 仅排空当前虚拟时间。读结果复制，transcript 输入与捕获输出关联 captureId，非消息动作见 captures。

## C05 WebUI

Chat & Sandbox → 离线 Sandbox 使用 `SandboxChat`，metadata availability 为 existing，仍为六区与原 main/sidebar.panellist 两个 DSH 注册。支持创建/选择、私群文本/命令、通知/请求、显式推进毫秒、reset/delete、transcript、Captured actions、入站/交付 receipt、loop/stages 与模拟人格/配置只读快照；固定显示 **SIMULATION / zero real sends**。此页不挂 live send、媒体或配置 mutation 控件；原消息管理页保持原用途。

有 empty/error/loading 状态、重复点击 guard、失效异步响应丢弃和跨人格 not found 清理。API 错误保留草稿，重新读取只执行 GET；两栏布局在窄屏合为一栏，长文本/JSON 换行并限制滚动高度。输出只渲染文本，不加载媒体 URL/HTML。没有真实浏览器二进制验证。

## 验证与限制

`test/sandbox-api.test.js` 和 `test/sandbox-ui.test.js` 覆盖新 API、私群/命令、捕获、零网络、回执/阶段、人格隔离、计时、重置删除、输入/资源限制和 UI handler/loading/error/empty/异步清理；panel/nav/schema/package 检查覆盖六区挂载、元数据同步和原 slot。`test/simulation.test.js` 覆盖两个图、真实命令/私群、访问拒绝早于 raw、notice/request 审批捕获、transport 分类和 raw/unknown 拒绝、虚拟聚合/提醒、fixture source、人格/session 隔离、幂等/冲突、reset/delete、opaque API/身份注入拒绝；子进程仅一次 live apply 与模拟共存，验证 live bus/store/persona/transport/env/fetch/secret 登记不变。子进程配置在启动时注入，不切换运行进程的全局环境。

这是服务依赖隔离，不是任意 Node.js 代码的安全执行边界。没有外部代码、shell、网络模型、媒体识别或真实 DSH agent；没有持久恢复、自动清理崩溃遗留目录、跨进程锁或全事件录制重放。请求与会话受上述额度限制；transcript/captures 仅驻内存，长期会话需 reset/delete，没有分页/导出。HTTP adapter 生命周期绑定仍只在当前进程有效。管理 API 继续依赖宿主身份验证，没有另建用户或租户授权体系。fixture 输出可配置但不代表真实模型质量；UUID 等非业务标识不保证逐字节可复现。C02 profile runtime 仍遵守 legacy 门控。
