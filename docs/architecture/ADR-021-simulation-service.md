# ADR-021：隔离模拟服务图（AstrBot alignment C04）

- 状态：已实现；基线 C03 `2aaaa7c`。
- 范围：后端离线 Chat/event 模拟服务；Chat UI 属于 C05，执行沙箱属于 C06。

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

## 后端 API

前缀 `/onebot-qq/api/simulations/`，沿用宿主管理访问边界及 opaque frame 拒绝。只接受以下独立路径，均不借用 live `/send`、`/action`、`/events`：

| 方法/路径 | 输入 | 输出 |
| --- | --- | --- |
| POST create | 可选 persona、model、knowledge、access、typing、reminders | id、generation |
| POST events | id、event | requestId、admission receipt |
| POST advance | id、ms | now、pending、errors |
| GET state?id=… | 单一 id 查询参数 | transcript、captures、receipts、deliveryReceipts、loops、persona、sessions、notices、requests、stats、counts、access |
| POST reset | id | 新 generation，恢复创建时 fixture |
| POST delete | id | 删除确认 |

create 不接收任意 config。persona 只接受 displayName/identity/background/speakingStyle 文本；model 只接受 reply 和有界 analysis（intent/confidence/risk/replyGoal）；knowledge 最多 20 个 fixture: URL/title/text；access 只接受 private/group 布尔放行，typing/reminders 为布尔值。默认最多 16 个活动会话。

event 必须包含 requestId、kind（message/notice/request）、chatType（private/group）。message 额外包含 text 与可选 addressed；notice 的 type 仅 private:friend_add 或 group:group_increase；request 的 type 仅 private:friend 或 group:group。服务生成 bot/member/group/message ID、sender role 和 request flag。模拟参与者是本图固定的合成 owner，群 sender.role 仍为 member；调用者不能提交 owner/operator/admin、QQ ID、personaId、raw frame、路径或凭据。access.private:false 会撤销该合成身份的入站许可。真实权限仍由服务中的 access/command 检查执行，没有 live 身份继承。

同 generation 的 event requestId 在接纳前幂等，相同输入返回原 receipt，不同输入报冲突。receipt 表示入站结果，聚合后的执行结果需要 advance 后读 state。transcript 包含输入事件及由 capture 派生的输出消息，输出关联 captureId；非消息动作仅在 captures。读结果复制，调用者不能修改内部 store/状态。reset/delete/advance 是独立串行管理动作，不提供跨进程 exactly-once。

## 验证与限制

`test/simulation.test.js` 覆盖两个图、真实命令/私群、访问拒绝早于 raw、notice/request 审批捕获、transport 分类和 raw/unknown 拒绝、虚拟聚合/提醒、fixture source、人格/session 隔离、幂等/冲突、reset/delete、opaque API/身份注入拒绝；子进程仅一次 live apply 与模拟共存，验证 live bus/store/persona/transport/env/fetch/secret 登记不变。子进程配置在启动时注入，不切换运行进程的全局环境。

这是服务依赖隔离，不是任意 Node.js 代码的安全执行边界。没有外部代码、shell、网络模型、媒体识别或真实 DSH agent；没有 UI、持久恢复、自动清理崩溃遗留目录、跨进程锁或全事件录制重放。请求和返回受现有 HTTP/fixture/session/timer 上限限制；长会话 transcript/captures 仅驻内存，调用方应 reset/delete。管理 API 继续依赖宿主身份验证，没有另建用户或租户授权体系。fixture 输出可配置但不代表真实模型质量；UUID 等非业务标识不保证逐字节可复现。C02 profile runtime 仍遵守 legacy 门控。
