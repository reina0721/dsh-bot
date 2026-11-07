# ADR-013：媒体基础设施保留核心所有权

- 状态：已接受（Phase 14，架构程序最终边界）
- 日期：2026-11-07
- 前置：[ADR-004](ADR-004-unified-egress.md)、[ADR-010](ADR-010-provider-composition.md)、[ADR-012](ADR-012-builtin-reminders.md)

后续：[ADR-015](ADR-015-builtin-media-features.md) 已实现宿主持有的窄端口和功能策略/命令提取；下文为 Phase 14 历史决定。传输、存储、凭据和文件边界继续留核心。

## 决定与原因

媒体服务继续作为核心基础设施，由 host 构造和持有。媒体传输、下载与上传、文件及表情包存储、媒体 provider 调用与凭据解析、HTTP 路由、文件路径及 realpath/符号链接约束全部留在核心。本架构程序不提取 `builtin-media` 服务，不新增媒体模块或 provider 槽位，不迁移数据。

现有媒体服务同时供认知入站识别、核心命令与本机 HTTP 管理使用，并衔接 QQ 网关传输。它管理 provider 网络调用、二进制内容、网关上传和本地文件约束，资源生命周期跨越单个功能模块。把整个服务放入可启停模块会让多个核心调用者依赖模块状态，并把凭据、传输和文件权限带入模块 API；仅移动文件不足以建立可审计边界。提醒已有固定仓库和单所有者交接契约，媒体目前没有对应的宿主窄端口，因此本次明确保留核心所有权。

## 当前边界

- `src/host.js` 持有 `src/media/index.js` 和 `src/media/stickers.js` 的服务；`src/http/routes.js` 持有既有媒体 HTTP 路由。
- 模块 API 不暴露 media/stickers、媒体存储路径、provider 凭据、原始 gateway、HTTP 上下文或路由注册能力；外部模块不能通过声明权限或伪造 source/builtin 获得这些资源。
- provider 注册表白名单仍只有 reminders，拒绝 media；不存在可声明的媒体权限，也没有外部媒体资源或路由授权。
- 现有媒体命令、路由、配置、文件格式、存储位置、备份和访问行为保持；本阶段没有数据迁移、配置/UI/依赖或版本变化。

这些限制约束宿主提供的稳定 API。外部模块仍是同进程的任意 Node.js 本地代码，不能将权限检查解释为文件系统、网络或 HTTP 的进程沙箱。既有本机 HTTP 信任边界不因本决定改变。

## 未来可选边界

未来可另立项目评估 `builtin-media`，范围仅限功能策略和命令编排。前提是先设计由宿主持有的 media port：操作和目标需明确授权，资源使用不透明句柄与受限结果，保持既有访问规则、出站约束、文件包含关系和生命周期撤销；不得传出原始服务、绝对路径、凭据、任意 provider/HTTP/文件操作或路由注册能力。

即使未来采用该功能模块，传输、存储、provider/HTTP 和文件安全仍由核心承担；外部模块不获得媒体资源或路由。端口及功能策略提取均不在本架构程序内，也不预先承诺数据迁移。

## 验收

`test/module-boundary.test.js` 固定外部 API 无媒体资源/路由、未知媒体权限导入前拒绝、media provider 槽位拒绝，以及四个生产内置模块不变。`scripts/check-package.mjs` 验证 tgz/zip 均包含本 ADR、最终验收说明和原四个内置模块，并在解包目录独立加载。媒体既有测试随完整离线测试运行；没有真实 provider/QQ 或浏览器验收。

最终范围与验证记录见 [MODULE-ACCEPTANCE](MODULE-ACCEPTANCE.md)。推送、部署、发布和版本变更独立授权。
