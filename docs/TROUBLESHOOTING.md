# 故障排查

- **下载 404**：确认仓库已改名、目标标签已发布且包含安装资源。首次 Release 前使用源码安装。
- **找不到 dsh**：先确认 DSH 已安装，脚本通过 `-DshPath` 或 `--dsh` 指定可执行路径；路径含空格时加引号。
- **校验失败**：停止安装，重新下载同版本安装包和 SHA256SUMS；不要跳过校验。
- **侧栏没有面板**：确认安装到正在使用的 profile，重启该 profile，检查插件注册与启动日志；旧版升级时移除旧插件注册。
- **配置或人格消失**：检查 DSH_HOME 和 DSH_BOT_DATA_DIR，按[迁移指南](MIGRATION.md)复制旧数据。新版不自动搜索旧目录。
- **只能发消息、收不到事件**：检查正向 WebSocket 服务与地址。只有 HTTP 地址不能实时收事件。
- **账号核验失败**：检查机器人 QQ 号、网关当前账号和 access token。
- **模型不可用**：在模型面板执行连通测试，检查协议、URL、密钥与模型 ID，参考[模型网关](MODEL-GATEWAY.md)。

报告问题请附版本、系统、DSH 版本、复现步骤及脱敏日志，不要附密钥、token 或完整私人聊天记录。

## 模块健康、动作与闭环（C07）

[C08 最终验收](architecture/CLOSED-LOOP-ACCEPTANCE.md)集中列出闭环语义、测试和包证据。故障排查不会自动重启/重放；刷新只读，操作幂等仅限当前进程保留期，不承诺 exactly-once。

- **图片关闭后表情包库是否可用**：媒体模块、media.enabled、media.stickers.enabled 及库服务可用时，关闭 media.images.enabled 只禁发送；库仍可列表/上传/标签/删除/预览。模块或媒体/贴纸关闭才关闭库；看 libraryAvailable/sendAvailable 及各自 reason，不用单一 available 推断送达。
- **loaded 但不工作**：到「模块 → 详情 → 核心健康」分别检查 health/reasons/lastError、业务开关、Provider registeredModuleId 与实际 owner/fallback、依赖和 scheduler/engine。loaded 只表示 setup 完成；null 是未观察，接口失败为不可用，零表示已观测计数为零。
- **动作不可用或代次冲突**：点「刷新动作」重新读取可用性与 expectedGeneration；MODULE_RUNTIME_CONFLICT/MODULE_PERSONA_CONFLICT 表示运行实例或人格已变化，先刷新检查目标，再由操作员决定新动作。外部只有核心允许的启停/重载，不支持 restart 或主动/学习执行器。
- **STOP_PENDING**：同一操作仍在排空，不是成功也不是取消；继续观察，不反复重启或启动第二 owner。长时间排空可能需要宿主运维处理，UI 不强制停止。网络异常保留原 requestId/operation 查询，可「继续观察操作」；如果服务端记录已丢失，先核实健康/所有权，不自动重发。页面离开会停止 UI 轮询，服务端操作继续；UI 不跨页面保存观察记录。
- **手动执行没显示成功**：BUSY、NO_TASK、MODULE_RUN_FAILED 或 skip 都不是成功；检查业务开关、安静时段、候选、预算、暂停及任务到期状态。「学习 → 运行待处理」作用于队列；逐任务只有重试/取消，不指定执行单个 pending。
- **闭环为空/详情缺失**：「认知 → 闭环」只读取当前人格和 7 天/5000 条保留观测；切换人格、保留期淘汰或未执行过时可能没有记录。未观察不等于负反馈，不适用不等于失败，不可用表示接口读取失败，interrupted 不会触发补发/补跑。先刷新闭环，再从策略决策进入；尝试/已发送 parts 分开看，policy committed 仅显示真实提交状态。
- **研究链接未定位任务**：学习 API 读取最近 100 条、界面最多显示 20 条，目标任务在读取范围内优先显示；超出时提示当前列表未包含，不新建任务、不补跑。提醒详情只显示当前人格记录数，逐条管理继续使用 QQ 命令。

验证使用 Node React shim、fake DSH/网关与实际管理 API；环境没有浏览器二进制，布局、焦点/滚动、iframe/CSP 的真实浏览器行为未验证，也未执行真实 QQ/远程模型验收。

## 左侧「QQ 连接」入口消失

**症状**：Host 侧 `/onebot-qq/api/health` 正常、QQ 网关 connected，但网页左侧没有「QQ 连接」，`client Slots` 的 `sidebar.panellist` 只剩 core 插件、没有 `onebot-qq`。

**原因**：升级/热重载 dsh-bot 时，Host 半边被替换，浏览器侧 `client.js` 的 Slot 注册被清掉；单纯刷新页面不一定会重新挂载。

**恢复**：

1. 先硬刷新页面（`Ctrl+Shift+R` / `Cmd+Shift+R`）。
2. 若仍未出现，在 DSH 的插件管理里把 `dsh-bot` bundle **停用再启用**，或重启 DSH Host；确认 `sidebar.panellist` 重新出现 `onebot-qq`。
3. 再刷新页面。

2026-11-06 本次真实故障即通过 bundle 停用/启用恢复；不影响 dsh-bot 配置、QQ 网关或数据。
