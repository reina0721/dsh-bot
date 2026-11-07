# ADR-016：内置主动行为提取（one-shot 模块 2）

- 状态：已接受并实现；仅模块 2
- 日期：2026-11-07
- 基线：媒体提交 `0d49b8a`，分支 `feat/builtin-features`
- 前置：[ADR-010](ADR-010-provider-composition.md)、[ADR-014](ADR-014-module-webui.md)、[ADR-015](ADR-015-builtin-media-features.md)

## 所有权切换

默认启用的 `builtin-proactivity` 是主动行为策略、候选排序、退避、提示词、tick 计数和调度的唯一所有者。`src/cognition/proactivity.js` 删除，行为移到 `src/modules/builtin/proactivity/engine.js`。核心 `cognition/index.js` 不再构造或启动主动引擎，也没有主动 timer。固定 `proactivity` provider 槽位只接受此模块 ID，要求 start/stop/tick/stats；setup 注册并自行 start，start/stop 幂等。宿主 provider 订阅仍只处理 reminders，主动模块启停不改变提醒所有权。

模块拥有单个递归 timeout：初次 5 分钟，tick 完成后 10 分钟；手动与 timer 共用 single-flight。stop 同步清 timer、失效代次和 run token；旧回调/迟到结果不能重排或再次发送。模块停用不启动 fallback。核心 `proactivityStats()` / `runProactivity()` 每次查询当前 provider，缺失时返回安全空统计或 `{ok:false,reason:'MODULE_DISABLED'}`。现有 GET `/cognition/proactivity`、POST `/cognition/proactivity/run` 通过 facade 保持可用。

保留 cognition.enabled/paused、默认关闭的 cognition.proactivity.enabled、安静时段的本地小时（含跨午夜）、滚动 24 小时主动 decision 数量（包括 pending、dry_run、failed）、熟悉度门槛、initiative+affinity 排序、首候选近期互动退避和仅私聊行为。maxGroupPerDay 继续保留配置但不发群聊。旧关系 list 在只指定 scopeType 时还匹配空 scopeId，旧主动服务又混用 dimensions 与扁平维度；端口现在直接按 private scope 查询并投影扁平维度，修正有效私聊候选无法被选中的缺陷。

## 固定端口与人格安全

模块只申请 `providers:register`、`scheduler`、`config:read`、`proactivity:service`。后者仅 builtin-proactivity 可声明/获得，外部在 import 前拒绝；无 generic storage、cognition、LLM、delivery 权限。核心模块内核只向该 ID 的当前 runtime 暴露冻结 `api.proactivity`：

- `snapshot()`：当前 ready/enabled/paused、时间和当前人格滚动计数；无原始配置。
- `begin()`：不透明 run token，捕获当前人格、人格切换代次和当前 runtime 身份。每端口只接纳一个 run。
- `candidates(token)`：最多 1000 条有效私聊目标与对应存在的人物，字段仅 id/personId/scopeId/lastInteractionAt 和 familiarity/affinity/trust/intimacy/initiative；不返回原始记录或其它 scope。
- `context(token,candidateId)`：只能选本 run 已列出的候选；返回显示名、最多 4 条各最多 160 字符的 memory summary，以及 formality/warmth/verbosity。记忆服务使用捕获的人格仓库，读写前检查 token，输出再次校验 person/private scope（允许同人格 global 记忆）。
- `complete(token,{system,user})`：只调用核心 LLM，固定 purpose=proactive、maxTokens=220、temperature=0.8，并按选中私聊目标路由；保持核心模型选择与预算。每 run 一次调用，只返回安全状态，模型文本保留在端口。
- `send(token)`：不能指定聊天、文本、source 或任意 decision 字段。发送目标和文本来自本 run，token 在 await 前消费，失败也不重试。核心创建规范 decision，固定 source=proactivity，经 delivery/outbound 的 access → rate → leak → dryRun → gateway。安全回执仅包含状态、decisionId、dryRun 和白名单失败码，无 raw error、模型路由或网关对象。成功时核心写 proactive_intent。
- `release(token)`：幂等撤销，不需要运行中权限，供停止/finally 清理。

开始、异步 memory/LLM 前后及发送前校验当前人格、切换代次、runtime 和开关；切出再切回同人格也取消旧 run。核心 persona 服务只增加切换代次，无学习行为变化。记忆强化固定仓库，核心 LLM 既有调用前捕获的人格用量记账保持。发送已被核心接纳后可在停止/切换后完成；delivery/outbound 仅内部接收捕获的 decisionPolicy，访问/频率闸门继续使用核心 policy，成功/失败归因和 proactive_intent 始终写原人格，避免迟到归因写入新人格。端口不暴露仓库、URL、凭据、provider 选择或跨人格参数。

## 配置、UI 与数据

七个原字段 cognition.proactivity.enabled/quietStart/quietEnd/maxPrivatePerDay/maxGroupPerDay/minFamiliarity/backoffHours 标记 `module:'builtin-proactivity'`。模块通过 legacyConfig.section('cognition.proactivity') 仅获得规范化七字段；其它模块仍只能读取原 reminders section。存储键、默认值、normalizer、全局保存与 decision/proactive_intent 的人格数据位置不变，无迁移或 module_store 副本。

描述提供 `module.detail` 的纯 `proactivity.preview` 和 `module.config/schema` 的 legacy-core 绑定，无可选 panel。preview 只接收冻结、有界的字段投影，无请求或写入。模块详情复用全局配置编辑，停用/未 loaded 只读；系统设置去重。`/quiet`、`/active` 的核心配置行为保持，修改 enabled 不会启用已停用模块。无新 DSH sidebar/main。

## 验证与限制

引擎/端口/模块测试覆盖 quiet、预算/退避、排序与作用域、上下文边界、一次 decision/send、dry-run、真实 outbound access/rate/leak、失败脱敏、single-flight、timer 幂等、无 stop 后重排、memory/LLM 等待中停止/切换、切回人格、已接纳发送回执、模块禁用/失败/代次和 facade/HTTP。现有宿主测试增加主动模块启停不影响提醒，面板测试验证纯预览和七字段归属/只读；包检查验证两个归档的模块文件、ADR 和独立加载/停用 provider。

这是同进程内置 API 边界，不是进程沙箱。已接纳网络发送不能撤回；进程退出、关闭存储或网关超时不提供跨进程 exactly-once/崩溃恢复保证。没有群聊主动行为、额外引擎、发送重试或其它模块提取。只做本地测试与打包校验，未验证真实 QQ、模型 provider 或浏览器；没有版本、依赖、学习策略变化、推送、部署、标签或发布。
