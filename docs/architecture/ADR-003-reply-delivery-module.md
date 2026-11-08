# ADR-003：内置回复交付规划模块（Phase 4）

状态：按已批准架构计划实现 Phase 4；承接 [ADR-001](ADR-001-delivery-seam.md) 的 DeliveryPlan seam 和 Phase 3 内置配置能力。仅本地实现与验证，不升级版本、不推送/发布/部署。

## 背景与边界

回复正文由认知生成，分条、首条引用、群聊 @ 与条间等待属于交付布局。将其作为默认启用的内置模块交付，同时保留 core 兼容路径、既有 cognition.reply.* 配置及 outbound 安全闸门。命令、入站 coordinator、分析/策略、公共事件和全局 /config 字段不变。

## 选择

宿主在 cognition 之前创建 deliveryRegistry，同时注入 createCognition/createModuleKernel；cognition 把它传给 pipeline（含人格切换后的重建）。modules.start 仍先于 host.ready 完成。registry 不判断模块来源；内核检查运行状态、delivery:plan 权限与真实 builtin 来源，外部调用即使声明权限也抛错，不暴露 registry 本体。

`createDeliveryRegistry()` 返回 register/resolve/remove/list。register 接受 `{id,stage:'format',order,plan}`，非空唯一 id、有限 order（默认 0）、同步 plan 函数；只容纳一个 format，重复 stage/id 与未知 stage 拒绝。记录冻结，list 返回新数组，register 返回幂等 disposer，旧 disposer 不会删除同 id 的新注册。没有多阶段链、外部 planner 或排序调度。

内核 API 为 `api.delivery.registerPlanner(descriptor)`。返回 disposer 并纳入 runtime 清理：停用、宿主 dispose、setup 失败、事件失败隔离、依赖重载都会移除。已停止 API 无法再注册。builtin 无直接重载，依赖协调重启使用缓存代码。现有权限机制仍是稳定 API 约束，不是 Node.js 沙箱。

生产静态 registry 新增 builtin-reply-delivery，defaultEnabled:true、permissions:['delivery:plan']、requires:[]；builtin-sample 仍默认关闭且可配置。回复模块不声明 config，不读写独立 config.json，也没有 api.config 或配置按钮。

模块 setup 注册唯一 format planner。核心每次发送提供 `{text,turn,replyCfg,replyTo,source,decisionId}`，replyCfg 为 cognition.reply 的副本，noReplySegment 映射到 quote:false。模块使用的共享核心纯 builder 不读配置、不做 I/O：现由 `<bubble>文本</bubble>` 协议决定分条，标签不发送；split:false 去标签后合为单条，无标签保持单泡。maxChars 仅在无标签/损坏标签且单泡超过 2000 字时作为安全切分目标，有效标签超长按 2000 字兜底；maxParts 超限余文合并最后一条；只首条引用（显式 replyTo 优先）和群聊 @；仅非末条有 delayAfterMs。

纯布局实现在共享核心工具 `src/delivery/reply-plan.js`；`src/delivery/plan.js` 从该核心文件兼容重导出 buildReplyPlan，继续持有 validateDeliveryPlan/buildFallbackPlan。`src/modules/builtin/reply-delivery-plan.js` 同样重导出该纯函数，模块入口仅注册它。依赖方向为内置模块依赖核心纯契约，核心不依赖 `src/modules/**` 实现；core 直接使用该纯函数，不调用模块 setup 或 registry，停用不影响 core 回退。将 splitter 原样迁至 `src/delivery/text-split.js`，旧 cognition 路径兼容重导出。保留 Phase 1 元数据 `{planner:'core',fallback:false}` 以维持计划兼容；该字段不是注册项来源标识，实际注册项 id 为 builtin-reply-delivery。

## 路由与失败

| engine | format 存在 | format 缺失 |
|---|---|---|
| auto（默认） | 模块 planner | core 兼容布局 |
| core | core 兼容布局 | core 兼容布局 |
| planner | 模块 planner | 单条纯文本回退 |

配置仅内部使用，非法值规范化为 auto，无面板字段。旧测试/调用方不注入 registry 时默认行为等同 core。生产默认模块启用即走 planner；停用后下一次 auto 发送回到 core，显式 planner 则回退。

core 与 planner 共享执行器；pipeline 不再自行构造消息段或安排分条/等待。模块 plan 抛错或校验不通过时，执行器在任何 I/O 之前使用可信 text/turn/source/decisionId 构建单条纯文本回退，无引用/@/等待；仅记录固定安全警告，不输出异常或正文。fallback 不绕过 outbound，也不对访问拒绝/限频/发送失败重试。

空正文仍标记原决策 dryRun 并成功返回；split 开启的纯空白仍 SEND_FAILED 且不发送。第一条失败整轮失败，后续失败保留已发条数和最后成功结果；首条 dryRun 不产生 sent/pending/轮次记录，后续 dryRun 保留先前真实发送。逐条重读 dryRun、首条 decisionId、首个非空消息 ID、stats/pending/noteGroupReply/turnAggregator/ctxEmit 均保持 Phase 1 语义。

## 验证与限制

覆盖核心 planner 文件不依赖模块实现的源码架构断言、registry 描述符/唯一 stage/id/disposer、builtin 权限与外部拒绝、setup 失败和依赖生命周期清理、Phase 1 计划形状、split:false、引用/@、delay/maxParts、auto/core/planner 有无 registry 与异常/无效回退、真实宿主 HTTP 启停与 mock OneBot 分条、面板无配置按钮，以及独立 tgz/zip 加载默认模块。运行 npm test、check:docs、check:parity、pack:release、check:package 和 git diff --check。

没有外部 planner、模块配置迁移、多阶段规划或入口变化。core 回退复用同一纯布局函数，因此它提供注册/模块故障恢复，不是独立的旧代码副本。未做真实 QQ、真实浏览器或 live 验收，parity 矩阵保持原状。

气泡协议与场景化提示的依据、上下文边界及本地验证范围见[群聊节奏研究](../research/GROUP-CHAT-PACING.md)。原有 Phase 4 的长度切分已由模型气泡协议取代，模块注册/权限与交付安全闸门沿用本 ADR。
