# 闭环 v2 最终验收（C08）

本页保留 C08 原始验收记录；末节补充 `feat/closed-loop-gaps` 基于 main `e0e0d06` / 0.11.14 的未发布缺口收敛与验证，版本未变，原 live 快照不改写。

验收日期：2026-11-07。分支：`feat/closed-loop-v2`，生产实现基线 C07 `6cf5637`。C08 仅补文档、包断言与缺失集成验收；不新增生产功能。版本保持 `0.11.12`，无依赖或数据迁移，无 push、部署、版本升级、tag 或 release。

## C01–C07 提交链

以下按父子顺序连续提交，C08 接在 C07 后：

| 阶段 | commit | 内容 |
| --- | --- | --- |
| C01 | `5e0c6c4` | 拆分表情包库与发送授权 |
| C02 | `467f1d0` | 定义模块与系统闭环契约，ADR-018/019 |
| C03 | `e444574` | 模块健康与 Provider 所有权 |
| C04 | `5f638bb` | 受控动作与手动恢复 |
| C05 | `11d5a96` | 执行闭环与交付回执 |
| C06 | `0436442` | 闭环反馈与学习关联 |
| C07 | `6cf5637` | 模块健康动作与闭环导航 |

规范见 [ADR-018](ADR-018-module-closed-loop.md)、[ADR-019](ADR-019-system-closed-loop.md)；操作见[模块文档](../MODULES.md)、[用户手册](../USER-MANUAL.md)及[故障排查](../TROUBLESHOOTING.md)。此前模块验收保留在 [MODULE-ACCEPTANCE](MODULE-ACCEPTANCE.md)，不能替代本次证据。

## 表情包库与发送矩阵

下表假定库、media 和 delivery 服务均存在；`*` 表示任意布尔值。五行覆盖四个开关的全部 16 种组合。拒绝原因按 module → media → stickers → images 顺序判断。

| 媒体模块启用 | media.enabled | media.stickers.enabled | media.images.enabled | 库管理/文件预览 | 发送 | 原因 |
| --- | --- | --- | --- | --- | --- | --- |
| false | * | * | * | 拒绝 | 拒绝 | MODULE_DISABLED |
| true | false | * | * | 拒绝 | 拒绝 | MEDIA_DISABLED |
| true | true | false | * | 拒绝 | 拒绝 | STICKERS_DISABLED |
| true | true | true | false | 允许 | 拒绝 | 发送 IMAGES_DISABLED，库无拒绝原因 |
| true | true | true | true | 允许 | 允许进入发送闸门 | 库和发送授权通过 |

库管理包含列表、上传、改标签、删除及文件预览；`available` 是 `libraryAvailable` 的兼容别名，`sendAvailable` 独立。库服务缺失关闭两者；media 或 delivery 缺失仅关闭发送，不能因 images 关闭禁止管理库。服务异步返回后仍检查当前授权。发送还要求主人命令授权的一次性、目标/runtime 绑定令牌，并经过 access/rate/leak/dryRun；授权通过不保证实际送达。不改配置键、默认值或贴纸数据。

## 模块健康、Provider 与人工动作

`lifecycle:loaded` 只表示 setup 完成；health 区分 unknown/healthy/degraded/unhealthy/stopped。受信任内置 setup 成功默认 healthy idle，外部未埋点仍 unknown；未观察/不适用计数为 null，不能推断为 0/false。GET 仅复制缓存，不 import、扫描目录、读业务正文、调用 provider 探针或触发恢复。每次实际 setup 换 `runtimeGeneration`，与 UI generation 独立；旧报告无效，停用保留带 `telemetryGeneration` 的历史快照。

Provider 注册与实际 owner 分开。提醒由宿主串行协调：停止并排空旧 owner 后才能接管；只有核心真正启动才显示 fallback.active。停止失败保留 failed owner，不能假装已释放或另起调度器。mediaFeatures/proactivity/learning 停用没有核心 fallback。健康 GET 不接管业务 timer，也不更改所有权。

核心动作固定六项：`module.enable`、`module.disable`、`module.restart`、`module.reload`、`proactivity.runOnce`、`learning.runPending`。外部仅允许原启停/重载，不得声明 manifest actions、获得健康报告 API、restart 或运行内置引擎。HTTP 只接受固定数据字段；资格、expectedGeneration、人格/代次在接纳及执行边界检查。

POST 成功仅表示接纳，必须读取同一 operation。仅 succeeded 且 result.ok 才是成功；busy/skip/NO_TASK/failed 不算成功。requestId 同输入返回原操作，不同输入冲突；注册表最多 128 条，终态保留一小时，active 不驱逐，`modules/operations.json` 审计使相同 requestId/输入在重启后的保留期仍返回原记录；未完成项终结为 interrupted，不续跑。

人工内置 restart 复用缓存代码；仅对满足资格的 enabled/loaded 当前 runtime 执行，依赖逆序停止排空，正序 setup 原运行闭包，保留配置、数据与授权。10 秒未完成为非终态 STOP_PENDING：继续等待同一个 drain，保留 owner/闭包预留，不强制释放、不重复 stop、不提前启动替换/fallback。挂死 drain 可能持续占据生命周期队列，须在宿主运维边界处置。失败不自动重试。

## Loop、receipt、反馈与研究

loop 是核心管理投影，不是第二套执行器。社交/主动/研究通过显式 handle 关联 turn/decision/module/runtime 或 unknown/task；人格在接纳时捕获，跨人格详情与不存在均为 LOOP_NOT_FOUND。接口拒绝人格查询参数，分页 cursor 绑定人格、切换代次及过滤；默认 50/最多 200。只返回有界 ID、状态、阶段、计数，不返回正文、QQ/消息/事件标识、URL、路径或任意 JSON。

executor 独占 multipart 最终交付回执；DeliveryService 不重复包一层，直接 outbound 可有 loopId:null 的独立 attempt，不虚构关联。receipt.loopId 与父 loop.receiptRefs 双向关联，decision/turn 引用保持原值。sent/partial/failed/dry_run/empty 与实际 parts 沿用 ADR-006；partial 仍可能 ok:true，failedPart 从零开始。attempted parts 与 sent parts 分开，异常未知为 interrupted/data:null，不猜成零次发送。decision.status 或 loop completed 都不能证明送达。

wait/silence/learn-only/gate/compose skip 等只有 loop 终结码，不生成 no_send receipt；未接入路径保持未知。重启遗留 running 观测标 interrupted，不补发/重放。observer 写入失败隔离于业务结果与原异常。每人格 loop+receipt 合计最多 5000 条、最长 7 天，最多 16 阶段/16 回执引用/4 unknown 引用、每条 8 KiB；启动/写入清理无新 timer，整组淘汰不留悬空回执，删除人格不重建记录。

反馈来源为 incoming/reaction/manual/unknown；manual 要求 requestId，业务 outcome 持久去重。只有同人格有效 parent 与保留的实际发送 parts>0 回执允许新策略学习；outcome、decision、Beta policy before/after/trials 与 feedback receipt 在同一同步事务中全成全败。未观察/窗口到期不写负或中性 trial，历史 provenance/policyUpdated 缺失保留 unknown/null；不改奖励算法、不新增自动反馈入口。

unknown 首次真实检测记录 firstDetectedTurnId，重复或历史记录不回填。每次实际 research claim 独立 loop/attempt，cancel/retry/interrupted 不改写旧 attempt。关联 unknown/task/evidence/claim 的 ID/计数/状态，内容留在学习面；发布仍受原人格/runtime/任务版本 lease 和事务限制，loop 不授予发布权。

## 核心 UI 目的地与注册边界

| 入口 | 唯一目的地/行为 |
| --- | --- |
| 模块卡片/详情 | 核心详情：lifecycle/health、注册与实际 owner/fallback、依赖、遥测、动作及 operation |
| B站公共内容 | builtin-media-features 的 panel，原内容页提供导航 |
| 表情包库 | 核心媒体页 stickers 锚点，按库授权管理 |
| 主动行为 / 学习 | 认知 proactivity / learning 分区，可返回模块详情 |
| 提醒数据 | builtin-reminders 详情内当前人格记录数；逐条管理仍用 QQ 命令 |
| 模块配置 | 详情既有唯一配置编辑器，停用/未 loaded 时只读 |
| 策略决策 / 闭环 | 认知闭环摘要、运行分页及 decisionId 详情；研究链接定位学习任务 |

typed goTo 兼容 go，已挂载同页响应新目标。学习运行是队列动作，任务只有重试/取消；目标受最近 100 条读取/20 条显示范围限制。动作影响模型/发送时 UI 确认；响应丢失用原 requestId 查询，不生成新动作。operation 观察不跨页面持久保存，离开停止 UI 轮询，服务端操作继续；闭环按需刷新。

`client.js` 保持 DSH web 客户端，恰好 **两项注册**：`main` 与 `sidebar.panellist`，均使用既有 onebot-qq 面板入口。核心负责导航和动作；builtin React preview 纯只读，外部声明式配置/opaque iframe 不获得同源 React、宿主 API、健康或 action bridge；iframe 仍仅 ready/resize/notify。

## 自动化测试证据

复用 C01–C07 已有测试，只补缺失的串联边界，不重写相同用例：

| 验收点 | 自动化证据 |
| --- | --- |
| 库/发送 16 种开关、服务缺失、异步复查、一次性令牌及发送闸门 | test/builtin-media-features.test.js |
| 外部/伪造 builtin 无 health/actions/操作注册表权限；拒绝特权及清单 actions | test/module-boundary.test.js、test/modules.test.js、test/e2e.test.js |
| 固定动作白名单、代次/人格过期、幂等/冲突/容量、失败不重试 | test/module-actions.test.js、test/e2e.test.js |
| 健康读无副作用、旧代次报告拒绝、实际 owner 与排空/fallback/STOP_PENDING | test/module-health.test.js、test/host-providers.test.js、test/modules.test.js |
| 新增：unhealthy → HTTP 只读观察不重启 → 人工 restart → 旧报告/新请求过期拒绝 | test/closed-loop-acceptance.test.js |
| 新增：opaque origin/frame/subresource 不能读 health/actions/operation 或提交有效 restart，管理方法零调用 | test/closed-loop-acceptance.test.js |
| 实际执行器回执/loop 双向引用、partial/dry-run/异常、人格删除/切换、保留 | test/system-loop.test.js、test/pipeline-delivery.test.js |
| 跨人格同 not-found、分页/过滤/隐私、反馈事务/去重/未知、research cancel/retry | test/loop-api.test.js、test/cognition-feedback.test.js、test/module-learning-port.test.js |
| UI 目的地、动作观察、闭环投影、外部隔离及恰好两项 DSH 注册 | test/panel.test.js、test/module-webui.test.js、test/e2e.test.js |

本次运行环境为 Linux、Node v24.18.0、npm 11.16.0。实际结果：

| 检查 | 结果 |
| --- | --- |
| npm test | 1090 项，1086 通过、4 项既有 live 模型测试跳过、0 失败 |
| 下列聚焦闭环套件 | 332 项全部通过，0 跳过/失败 |
| 最终边界复核（closed-loop-acceptance/system-loop/module-boundary） | 50 项全部通过，包含新增双向回执断言 |
| check:docs / check:parity | 通过；parity 仍为 61 项矩阵、remaining 47，无全量对齐声明 |
| pack:release / check:package | 通过；TGZ/ZIP 校验和、文件/链接、独立加载及客户端断言均通过 |
| git diff --check | 通过 |

复现命令：

```sh
node --test test/closed-loop-acceptance.test.js test/module-boundary.test.js test/module-actions.test.js test/module-health.test.js test/modules.test.js test/host-providers.test.js test/system-loop.test.js test/loop-api.test.js test/cognition-feedback.test.js test/module-learning-port.test.js test/builtin-media-features.test.js test/module-webui.test.js test/panel.test.js test/e2e.test.js
node --test test/closed-loop-acceptance.test.js test/system-loop.test.js test/module-boundary.test.js
npm test
npm run check:docs
npm run check:parity
npm run pack:release
npm run check:package
git diff --check
```

## 包证据与验证限制

本地 pack:release 只构建 `dist/dsh-bot.tgz`、`dist/dsh-bot.zip` 与 `dist/SHA256SUMS`。check:package 分别校验两包 SHA-256、链接、独立导入 host/七内置模块；新增强制 health.js、actions.js、loop.js、loop-query.js、ADR-018/019 与本验收文档存在。Node VM 加载包内 client.js，断言核心健康/动作/闭环/导航入口仍在 web 客户端且恰好两项 DSH 注册。

两包递归拒绝运行时 .builtin/plugins-data、模块 state/config/data.json、数据库/日志等私有数据；包内临时启动模块后验证 health/actions/UI 投影不包含实际模块数据根或 moduleDir/entryPath/configValues/dbFile。文档中的接口字段和示例路径不是实际私有模块路径；历史离线/工具证据不代表 C08 live 验收。构建产物不提交、不上传、不安装。

所有证据为 Node、React shim、临时数据、fake DSH/网关与 mock 模型/来源。没有浏览器二进制，未运行真实浏览器，无法证明布局、滚动焦点、iframe opaque origin/CSP 和浏览器网络策略的实际行为。HTTP 拒绝及 iframe 契约只有离线证据。未连接真实 QQ、DSH profile、远程模型或研究来源，不作 live 成功声明。全套既有 live 模型测试保持跳过。

## 明确非目标

- 无自动 restart、健康触发恢复、自动重试/补发/历史研究补跑。
- 无跨进程或跨保留期 exactly-once；操作和观测可能因中断、I/O 故障或淘汰而未知。
- 无外部 same-origin UI/React 或宿主 API 代理；同进程本地模块 permissions 仍不是 OS 沙箱。
- 无 UI 权限扩展、新 DSH 注册、Agent 工具或聊天恢复命令。
- 无新生产功能、业务配置、依赖/版本变化、数据迁移、推送、部署、标签或发布；不修改 cordis.patch.yml 与 .archify/。


## Live 缺口的离线补验（未发布，基于 e0e0d06 / 0.11.14）

`test/builtin-health.test.js` 激活包内真实七个模块（包括默认关闭的 sample），在没有业务运行时断言全部 loaded/healthy、观测时间已知、业务运行数仍为 null。外部未埋点 unknown、停止 stopped 和旧代次拒绝继续回归。媒体增加 setup、同步 share、远程成功/失败的健康埋点。

`node --test test/sandbox-integration.test.js test/send-boundary.test.js` 使用临时数据目录、fake DSH、回环 HTTP/WS mock OneBot、本地 mock 模型服务器和假知识源：

| 场景 | 实际断言 |
| --- | --- |
| OneBot 私聊和群聊 → `/bili share` | 每次一条真实 mock 网关发送、URL 正确、零 B站 fetch |
| 私聊和群聊 → `/sticker` | REST 种入 PNG 后每次一个 image 段，无额外文本发送 |
| `/bili hot` | 构造 transport 前注入固定 fake fetch，返回视频经命令发至 mock OneBot；没有真实 B站 HTTP |
| 主动行为手动 action | 假 eligible relationship → 本地 LLM HTTP → 一个私聊发送，decision sent、一个 proactive_intent、实际 delivery receipt；重复 requestId 无重发 |
| 学习自动入队 / 手动运行 | 实际 unknown 检测事件自动入队；action 执行假 source search/fetch、本地模型提炼；断言 task/evidence/claim/unknown 和首次 turn、research loop 真实引用 |
| 学习自动模式 | 第二个检测事件后直接调用原 engine `runPending({automatic:true})`，不等待真实 30 秒 timer；断言完成与独立 loop，timer 本身由既有 learning/scheduler 单测覆盖 |
| 管理只读 | health/actions/operation、loop runs/detail/summary 均走已注册 HTTP route；研究/读取不增加发送 |
| 应答丢失边界 | mock OneBot 已接受 HTTP send 后抛错，断言无 HTTP 重试/WS 补发；读取请求仍可 WS 回退。主动 token 在 I/O 前消费，同一运行不能再 send |

最终沙盒的 fetch 在宿主构造前安装拦截，只允许回环服务，B站直接 fake 响应，意外外网请求会失败并被记录。开发中曾因媒体测试在 transport 构造后才 mock fetch，意外请求公开 B站接口两次（失败断言与恢复断言各一次，均失败）；已修正顺序并重新验证，不作为验收成功证据。

以上是离线整合验收，不改写 2026-11-06 live 快照，也不证明真实 QQ/B站/付费模型、浏览器或 iframe/CSP 可用。发送只承诺同一运行/受控请求保留期内 at-most-once 尝试、无自动重试；真实 QQ 无平台幂等键，响应丢失无法判断是否送达，不能承诺 exactly-once。已有主动 token 的 consumed 标记是进程内发送意图闸门；通用消息/分条发送没有稳定的平台幂等 ID，不能用正文去重，否则会误吞合法重复内容。人工使用新 requestId 是新意图，可能重复。


操作审计由 `test/module-action-audit.test.js` 覆盖真实子进程在 queued/running/draining 退出、重启 interrupted 且零 executor/重放、终态代次/结果/时间保留、requestId 去重/冲突、128 条/一小时上限、active 不驱逐、STOP_PENDING owner 预留、接纳/执行前/终态写盘失败与损坏审计 fail closed。HTTP 查询跨内核重启保留原 ID；React shim 验证 interrupted 终态停止轮询且不报成功。

持久性边界：原子快照先 fsync 文件再 rename，不保证 OS 断电/目录元数据落盘；终态写盘失败可能在重启后仅能显示 interrupted。仍无活进程强制排空/force-recovery、多进程文件锁或自动恢复；挂死 drain 须在宿主运维边界处理，单目录只允许一个宿主进程。审计不是恢复队列，不推断中断前的发送结果；正常启动模块的既有调度策略保持。


本轮最终验证：`npm test` **1107 项 / 1103 通过 / 4 项既有 live 跳过 / 0 失败**；新增健康/媒体、审计、面板、沙盒与发送边界定向测试通过。`npm run check:docs`、`npm run check:parity`、`npm run pack:release`、`npm run check:package`、`git diff --check` 均通过。parity 矩阵状态未改变，不宣称全量对齐。打包仅生成本地校验产物，无 push/deploy/version/tag/release，未修改 cordis.patch.yml 或 .archify/。
