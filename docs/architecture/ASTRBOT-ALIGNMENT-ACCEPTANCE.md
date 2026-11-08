# AstrBot 对齐最终验收（C09）

验收日期：2026-11-08。分支 `feat/astrbot-alignment`，生产实现基线 C08 `81304d2`，版本保持 `0.11.15`。C09 只补验收文档、包断言及剩余集成测试，不新增生产功能、依赖或迁移，不推送、部署、改版本、打 tag 或发布。`cordis.patch.yml` 与 `.archify/` 不修改。本页是本轮 AstrBot alignment 的证据；此前[闭环 v2 验收](CLOSED-LOOP-ACCEPTANCE.md)属于另一条阶段链。

## C01–C08 连续提交链

| 阶段 | commit | 已实现范围 |
| --- | --- | --- |
| C01 | `6ef078d` | 设置唯一所有权、完整字段/旧导航库存，ADR-020 |
| C02 | `c95c411` | profile 存储、事务迁移、revision API；运行门控仍为 legacy |
| C03 | `2aaaa7c` | 六区 WebUI、所有者编辑器、搜索与内部 URL 导航 |
| C04 | `ae80c37` | 共享服务装配、独立模拟服务图/会话/捕获 transport，ADR-021 |
| C05 | `c5ab0e3` | 离线 Chat/event API 与 Chat & Sandbox UI |
| C06 | `b90f731` | 执行 broker、作用域工作区、审计、Linux driver，ADR-022 |
| C07 | `a6740fd` | 六个 Agent sandbox 工具、人格/策略/会话隔离与撤销 |
| C08 | `81304d2` | P1 seam：macOS discovery、egress 拒绝、真实模型 preview 契约 |

以上从基线 `b3d07a0` 连续衔接，C09 直接接在 C08 之后。契约见 [ADR-020](ADR-020-settings-ownership-navigation.md)、[ADR-021](ADR-021-simulation-service.md)、[ADR-022](ADR-022-agent-execution-broker.md)。

## IA 六区与完整旧别名覆盖

| area | 入口与唯一职责 |
| --- | --- |
| `overview` / Overview | 连接、人格与运行概览 |
| `chat` / Chat & Sandbox | 消息管理与离线 Chat/event 模拟 |
| `profiles` / Profiles | 人格库、认知业务数据/动作、staged 人格设置 |
| `extensions` / Extensions | 模块目录/详情/健康/动作、模块设置唯一编辑器 |
| `data` / Data & Logs | 媒体/内容操作、事件、日志、备份、隐私与导入 |
| `system` / System | 连接、凭据、访问、运行基础设施、模型全局资源与外观 |

当前库存为 **311 字段、32 个所有者组、620 个字段别名**；system/profile/module 分别为 **146/123/42**。42 个 module 字段包含 41 个 legacy-core 字段和 sample 的一个 module-file 字段。C01 原始 298 字段/30 旧配置组是历史基线；C06 增加 13 个 system sandbox 字段及 `sandbox` 组后，现有旧配置组为 **31**。

完整兼容库存包括 15 个旧 tab（裸名、`tab:`、`ob-tab-*`、`ob-panel-*`）、15 个 cognition section、全部 31 个 config group（含 17 个 `cog-*`）、七个内置 module ID、五个 `settings:` 外观分类、八个登记 anchor/template，以及每个字段的原路径/组路径别名。静态 `LEGACY_ALIASES` 共 **111** 项，另覆盖动态 decision/task ID、模块 detail/config/panel/reminders、短/完整 anchor 和前导 `#`。模块 anchor 必须绑定 moduleId，不能凭空授予模块能力。

`config` → System General；`cognition` → Profiles Overview。混合旧组只提供导航落点，每个字段仍指向唯一 owner，模块字段不复制到 System/Profile 编辑器。非法/未知/冲突目标回到 Overview 并清除旧 ID。URL 的 `ob-nav` 保留外层 DSH path/hash、其它 query/history state；Node history adapter 覆盖刷新、前进/后退及同区更新，opaque module/decision/task ID 不截断。

证据：`test/settings-schema.test.js` 对照真实 DEFAULTS/CONFIG_GROUPS/registry；`test/navigation.test.js` 穷举纯函数库存；`test/panel.test.js` 对照客户端内嵌副本、全部字段/静态别名和 C09 补齐的旧对象形式/动态 ID；双格式包重复检查全部静态别名和字段搜索。这些均为 Node/shim 检查，不能证明浏览器交互。

## 设置所有权与迁移：staged，尚未切换运行解析

`PROFILE_RUNTIME_MODE = 'legacy'` 是代码门控。123 个 profile 字段迁入既有 records store 中每人格的 profile_settings 行，带 migrationVersion/revision/sourceHash；初始 snapshot 和全局 marker 不可被重启重写。事务迁移覆盖 inactive persona，SQLite/JSON fallback 均有重启/回滚/重试测试；不复制 system 凭据、宿主路径或全局 LLM 资源设置。失败时 editingAvailable:false / SETTINGS_MIGRATION_UNAVAILABLE，legacy 运行继续。

profile API 保存只更新 staged override；检查/保存 inactive persona 不激活它。`/config` 展示 staged 候选，`/status.config` 仍是 legacy。System 与 module 按现有存储热应用/模块重启规则运行；revision 冲突、跨 owner 修改、secret keep/set/clear 均有明确拒绝边界。C03 已适配六区表单，不再是“UI 尚未适配”；未修改的旧客户端仍须携带 personaId/revision 才能保存。

social handleTurn 捕获冻结/脱敏的 effective/candidate 快照供核验，实际运行仍读 legacy；聚合、recall/poke/reaction、后台服务和人格旧编辑器尚未统一到 profile 运行上下文。不能把 staged 保存或 capture 当作完成运行迁移。证据：`test/profile-settings.test.js`、`test/persona-profile.test.js`、`test/e2e.test.js` 中 C02 staging/secret/restart/unsafe migration 测试，以及 panel owner/profile 编辑测试。

## Chat sandbox：零真实发送

simulation 调用真实共享 assembly/ingress/aggregation/commands/cognition/delivery，并使用独立 dataRoot/store/config/persona/event bus/runtime namespace。模型与知识源是 fixture，时钟/scheduler 是虚拟的，OneBot transport 只捕获动作；raw/未知 action fail closed。真实网关、模型凭据、外部模块发现及执行 broker 不注入模拟图。

`test/simulation.test.js` 同时启动一个 fake-DSH live apply 与模拟，验证模拟回复确实被捕获，而 live send 计数、诊断通道网络请求、live event bus/store/persona 变化均为 **0**；env/fetch 引用和秘密登记不变。这里的 live apply 是测试宿主，不是真实 DSH/QQ 验收。`test/sandbox-api.test.js` 用抛错的 live capability proxy 覆盖 Chat API 的消息/命令/通知/请求/计时/重置/删除，`realSends:0`，所有 captures 的 realSend:false。`test/sandbox-ui.test.js` 为 React shim，验证固定 SIMULATION 标识、失败保留草稿/只读刷新和管理 API 限制。

这证明指定测试中的 capture-only 接线与零 live 副作用，不是对任意恶意同进程模块的 OS 隔离保证。模拟无真实模型、外网、媒体、shell/执行工具；重启不恢复模拟。

## 执行 broker：readiness 与 fail closed

readiness 包含 disabled/checking/ready/unavailable/draining/failed；默认 disabled。启用后需真实 probe 才 ready。执行必须再次核对策略代次、服务端 persona/principal/chat/session 作用域及审计持久化；无 host shell 降级。工作区路径/链接/配额、并发、幂等、取消、审计失败/恢复、artifact 界限由 `test/agent-sandbox.test.js` 验证；fake driver 仅证明 broker 逻辑。

真实 `test/agent-sandbox-linux.test.js` 本机结果为 **unavailable / BWRAP_MISSING**；cgroup 委派创建失败 **EROFS**。执行请求拒绝 SANDBOX_UNAVAILABLE。真实 namespace/rootfs/network/env、输出上限、内存上限、进程数/进程树回收、超时、取消、只读快照/tmpfs 配额 **七项均 skip**，没有以 fake 测试代替。**本次未认证任何真实 Linux containment。**

`test/runtime-sandbox-tools.test.js` 验证六工具、真实 broker 文件操作、角色矩阵、人格/策略变化、迟到 admission/artifact/QQ action/event 和 timeout/dispose 撤销。C09 补齐所有非 ready 状态、过时代次、空/异常 status 的 owner/group 集成矩阵：不挂 sandbox 工具，只选择安全 preset；ready fake broker 挂载的完整白名单仅原三个 QQ 工具与六个 sandbox 工具，没有通用 DSH fs/search/web/shell/exec 注册。独立管理文件 API 在 driver unavailable 时仍可经其自身授权/审计检查使用，Agent 不能绕过 ready 条件。

安全 preset `dsh-bot-sandbox-private` / `dsh-bot-sandbox-social` **尚需宿主另行提供**，必须排除 `@deepseek-ai/dsh-tool-fs`、`@deepseek-ai/dsh-tool-fs-search`、`@deepseek-ai/dsh-tool-web` 及通用执行插件/继承。缺失时 RUNTIME_FAILED，可回退为 oneshot 文本，不能回退旧 preset/通用工具。测试宿主的白名单断言不能证明真实宿主 preset 无插件；旧 disabled legacy 路径仍声明 fs/web，不能作为沙盒证明。受保护 patch 本次不修补。

## P1 精确不可用能力

| 能力 | 当前状态 / 原因 |
| --- | --- |
| 本机 Linux 任意脚本执行 | unavailable / BWRAP_MISSING；cgroup 委派 EROFS，真实 containment 未证明 |
| macOS Seatbelt 执行 | discovery only；Linux 上 UNSUPPORTED_PLATFORM；macOS 即使安全二进制可用仍 RESOURCE_LIMITS_UNPROVEN，execute 拒绝 DRIVER_UNAVAILABLE |
| macOS enforcement | filesystem/network/memory/processes/cpu/processTree 全 false；没有 profile runner、资源限制或进程树回收证明 |
| controlled egress | unsupported / NETWORK_POLICY_UNSUPPORTED；network 配置只接受 false，作业任何 network 字段均拒绝，无 allowlist/代理/host network fallback |
| real-model Chat preview | contract-only / REAL_MODEL_PREVIEW_UNAVAILABLE；无 live adapter、许可 gate、调用端点、独立预算/计费账本 |
| Python / 其它解释器 | sandbox_python 固定 SANDBOX_CAPABILITY_UNAVAILABLE；不安装 Python/Node/编译器或自定义 rootfs |
| Windows 执行 | UNSUPPORTED_PLATFORM，无 Windows driver/执行验收 |
| 普通用户新增 grant | 无新增授权 API；operator/other/group 默认无能力，沿用原服务端策略矩阵 |
| 真实 ready Agent/DSH preset 联调 | 环境与安全 preset 缺口未满足，仅 fake 宿主/ready broker 证据 |

`test/agent-sandbox-p1.test.js` 覆盖 macOS 文件系统 fake probe、真实平台 discovery、网络请求在 admission 前拒绝、preview 注入拒绝及零观测网络请求。真实 Seatbelt containment/resource enforcement 单独 skip，不宣称已执行。preview 类型只约束未来逐请求管理员许可、独立用量预算和 capture-only transport，不是实现。

## DSH 注册、测试与包证据

客户端仍恰好注册 **main / onebot-qq** 与 **sidebar.panellist / onebot-qq** 两项；六区为面板内部导航，不新增 DSH 页面或 slot。源 panel shim 和两个解包客户端均断言完整注册列表。

本次指定检查及实际结果如下；未运行浏览器或真实模型验收，未设置 live 凭据。

| 命令 | C09 结果 |
| --- | --- |
| `npm test` | 通过：1218 tests，1206 pass，0 fail，12 skipped；227320.971923 ms |
| `npm run check:docs` | 通过：本地文档链接与当前命名（历史 archive 排除） |
| `npm run check:parity` | 通过：61 项结构校验；has 6 / partial 40 / none 0 / limited 1 / leading 6 / exempt 8，remaining 47 不变 |
| `npm run pack:release` | 通过：本地构建 dsh-bot.tgz、dsh-bot.zip、SHA256SUMS，保持 0.11.15 |
| `npm run check:package` | 通过：两种格式 checksum、完整文件/字节、schema/别名/搜索/注册、隐私扫描、链接及独立加载 |
| `git diff --check` | 通过，无空白错误 |

12 项 skip 为七项真实 Linux containment、一项真实 Seatbelt containment/resource enforcement、四项既有 live 模型测试；没有把 skip 计作通过或真实能力证明。C09 定向 panel/runtime 测试另跑 124 项全部通过。

包检查校验本地 `dist/dsh-bot.tgz`、`dist/dsh-bot.zip` 的 SHA-256，并逐字节对照源码确认 services/assembly、simulation（含 preview contract）、Chat HTTP、core settings/schema/profile/navigation、runtime sandbox tools、全部 sandbox/broker/driver 文件、ADR-020/021/022 与本验收文档。解包后加载 host/profile/schema/navigation，Node 执行客户端 factory，检查全部旧别名/字段搜索和恰好两个注册；原模块独立启动检查保留。扫描排除私有状态、数据库、日志、环境/私钥文件、典型凭据材料、个人路径和构建工作区绝对路径；文档的合成路径/占位值不视为真实私密数据。这是具体规则扫描，不宣称任意自由文本秘密识别。既有 visuals evidence 中的仓库绝对路径已改为相对路径，工具安装/cache 根目录替换为 `<tool-home>`；历史状态、时间及图表 hash 保持，未重跑图表浏览器。它们不是本轮六区/Chat UI 的浏览器证据。产物只在本地 dist，不提交、不发布。

## 剩余浏览器缺口与验收结论边界

本轮 **没有真实浏览器验证**。rail/drawer 响应布局、Esc/焦点、滚动定位、搜索高亮、浏览器 URL/history 行为、真实 DSH slot 挂载、Chat 控件交互以及外部 iframe/CSP/资源加载仍需真实浏览器检查。Node React/history/loader shim 仅证明自动化契约，不能标记为 V。

C01–C08 在上述离线及 fail-closed 边界内验收；profile 运行切换、真实 Linux containment、macOS execution/enforcement、egress、真实模型 preview、Windows execution 和真实浏览器均保留缺口。没有真实 QQ 发送、远程模型或真实 ready Agent 联调证据。使用说明见[用户手册](../USER-MANUAL.md)、[配置](../CONFIG.md)、[模块](../MODULES.md)和[故障排查](../TROUBLESHOOTING.md)。
