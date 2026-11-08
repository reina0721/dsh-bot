# 响应式顶部命令栏与模块 UI 验收契约

UI rework phase A/B；phase A 基线 main `3d2eeb2`，phase B 在 `feat/ui-shell-rework` 的 `f1238a2` 后实现，版本保持 0.11.21。DSH 的全局侧栏和会话列表已经承担外层导航；插件使用顶部命令栏，正文不再被内部第三列占宽。使用入口见[用户手册](../USER-MANUAL.md#4-面板六区导航)，设置所有权与旧入口见 [ADR-020](../architecture/ADR-020-settings-ownership-navigation.md)。

## 顶部壳层与正文宽度

- `.ob-shell` 为单列，`width:100%;min-width:0;max-width:none`，正文填满 DSH 分配的面板宽度。已移除 240px 内部侧栏、72px 图标轨道、折叠开关和导航 localStorage 偏好。
- `.ob-commandbar` 使用 `position:sticky;top:0` 和不透明背景。首行包含品牌「小葵」（沿用宿主注入名称）、带可访问状态名称的圆点、版本、六区按钮、搜索和刷新图标；`.ob-area-tabs` 空间不足时横向滚动。
- 第二行 `.ob-sectionbar` 只显示当前区域的可见分区，保持单行横向滚动、当前分区高亮。Profiles/settings 兼容入口和模块详情不额外生成导航项；模块详情沿用 Extensions 的「模块目录」高亮。
- 导航位于 loading/error 正文分支之外；六区 registry、所有者过滤、旧别名、URL/history 不变。DSH 仍恰好注册 `main` 与 `sidebar.panellist` 两项，ID 均为 `onebot-qq`。

## 移动与命令搜索

- ≤900px 使用相同命令栏和分区行；区域按钮和分区按钮至少 44×44px、文字不换行、横向溢出仅在各自导航行内滚动。正文紧接分区行。没有 hamburger、移动专属顶栏、分区 select 或导航 drawer。
- 搜索按钮及 Ctrl/Cmd+K 打开 `.ob-palette-overlay` 固定遮罩；`.ob-palette` 为带 `aria-modal` 和标题标签的 dialog 角色，输入为 combobox，结果为 listbox/options。使用普通固定 overlay，不依赖原生 dialog。
- 打开时聚焦输入，↑↓循环选择结果，Enter 经现有 `goTo` 导航，Escape、关闭按钮或遮罩关闭并恢复原焦点。Tab/Shift+Tab 在输入与关闭按钮间循环；结果通过 active descendant 和方向键选择。浏览器历史切换也会关闭搜索，清理时由新页头保留焦点；卸载移除快捷键监听。
- 默认列出页面/分区；搜索仅使用页面、分区、旧别名、模块和设置路径的元数据，不索引当前值、默认值或密钥。空结果可安全使用方向键/Enter。
- 已移除旧 drawer 的 focus trap、document/body/root scroll lock 及断点状态。搜索不修改宿主或面板的滚动样式。
- 命令栏考虑顶部 safe-area，遮罩考虑左右和底部 safe-area；正文保留左右/底部 safe-area。移动输入/select 至少 16px，常规控件至少 44px。

## 紧凑页头、导航滚动与焦点

- `PageHeader` 只呈现 eyebrow、紧凑标题和单行描述；描述长时省略显示，完整内容保留在 title。全局连接状态、版本和刷新集中在命令栏；概览不再重复全局刷新，模块目录/详情/健康保留自身读取动作。
- `.ob-root` 是插件滚动容器。`go`、`goTo`、URL/hash 变化及前进/后退改变目的地后，将 `scrollTop` 设为 0 并以 `preventScroll` 聚焦 `#ob-page-title`（h1、tabIndex=-1）。初始 loading 时推迟到标题挂载；轮询/数据重渲染或完全相同的目的地不复位、不抢焦点。
- 历史导航统一回到页首，不维护历史滚动快照。设置路径、任务及显式配置/功能锚点仍在内容加载后定位；默认 `ob-module-detail` 作为详情页入口，避免自动把新页头滚走。
- `ResizeObserver` 测量命令栏两行总高度并更新 `--ob-commandbar-height`；不支持时使用含 safe-area 的保守回退。正文锚点和移动表单的 scroll-margin-top 为命令栏高度加 12px，底部保留显式保存栏留白。

## 模块目录与详情

- `.ob-module-list` 是 `inline-size` 容器，专用 `.ob-module-grid` 默认单列；仅在视口 >900px **且容器 ≥760px** 时两列。DSH 外层侧栏占用宽度后，按目录实际宽度回落；不支持容器查询时保留单列。
- 卡片同行拉伸等高，Panel/body 使用 flex，footer 用自动上边距贴底。标题区放名称/两行简短说明/状态圆点；正文为状态/版本芯片、最多三项权限和 `+N`，完整依赖与权限移至详情。详情（primary）、配置（secondary）、启停位于唯一 footer，按钮等高、可换行；≤900px 卡片动作最多两列，重载保留在详情。配置不可用时禁用并关联说明。卡片点击忽略按钮/链接/输入，保留按钮原有动作与禁用状态。
- 详情页由 ModulesPage 渲染唯一 h1（模块名称、`#ob-page-title`），壳层不再重复通用「模块详情」页头。返回/刷新工具栏先于 h1，ID 以次要 code 呈现，状态芯片、配置与启停紧随其后。详情工具栏、摘要、健康、操作、功能链接、提醒和声明的 surfaces 为同级区块；保留 `ob-module-detail`、`ob-module-config`、`ob-module-panel`、`ob-module-reminders` 及 surface 锚点、React keys 和字段 ID。MediaFeaturesPanel 自带 Panel，不再包一层 Panel。
- 摘要只显示说明、来源、版本和状态；默认关闭的原生 `<details>`「技术信息」白名单展示 id/generation/uiRevision/runtimeGeneration/telemetryGeneration/observedAt/requires/permissions。运行代次与观测时间由 CoreModuleHealth 的同一快照回传，无第二次健康请求，不枚举配置或密钥。长值为可选择的 code，空数组为「无」，null 为「未观察」。
- 健康卡提供「运行正常 / 加载中 / 需要注意 / 已停止 / 错误」结论与短说明；未知不推断健康，blocked/draining 为需要注意。四项主要指标为 lifecycle/phase/health/reasonCode（中文标签）；lastError、代次、Provider/fallback、依赖、调度/引擎/遥测收进第二个默认关闭的 `<details>`「健康技术详情」，历史错误不改变当前观测结论。
- 动作按「运行管理 / 手动任务」分组并提供影响说明。顶部启停沿用目录动作接纳/轮询，维护区保留重启/外部重载/手动任务；已启用但 error/blocked 时仍可用 enable 恢复。每项操作通过 `aria-describedby` 关联影响说明及服务端/忙碌禁用原因；确认、代次/人格凭证、requestId 恢复与终态判断不变。
- 元数据采用 dl > div > dt/dd：每条为标签/值同行网格，桌面标签最多 12rem、≤900px 最多 7rem；移动条目只有一列，但内部仍为标签/值行，避免把 dt 和 dd 拆成连续两行。标题、描述、版本、权限、依赖、generation、错误及禁用原因允许长字符串换行。移动主要操作最多两列，技术详情默认关闭。
- ModulesPage 的 layout effect 在局部详情 ID/列表目的地变化、异步初始内容就绪时复位最近 `.ob-root` 的 scrollTop 并以 preventScroll 聚焦 h1；刷新、快照更新和配置草稿重渲染不复位。默认 detail 锚点无条件跳过自动 scrollIntoView；显式 config/panel/reminders/字段锚点继续定位并保留命令栏留白。
- 预览为有间距的纵向段落，段落默认 margin 清零；模块 iframe 宽度 100%、最小宽度 0、最大宽度 100%，保留既有隔离与消息校验。数字输入和单位可换行，≤900px 纵向堆叠；保留 label/id、min/max/step、数值转换和空值语义。

## 显式保存栏

- 模块文件配置使用唯一 `.ob-module-savebar`（保存配置/重新加载配置/取消）；OwnerSettings 使用唯一 `.ob-owner-savebar`（保存设置/重新读取），均在 Panel 外。错误提示、footer 或桌面/移动视图不复制控件。
- 桌面沿用原位 flex 工具栏；≤900px 使用 `position:sticky;bottom:0;z-index:20`、不透明 surface、顶部分隔线，底部 padding 加 safe-area。按钮可换行、至少 44px 高。
- 根滚动区为保存栏预留 `12rem + safe-area-inset-bottom` 的 scroll-padding，字段/错误提示提供 scroll-margin。需实测长标签、缩放、最后一个字段、错误提示和软键盘下可见性。
- 保存仍为显式操作：模块 revision、保存后重读、冲突时保留草稿、只读/忙碌禁用；profile 使用原 CAS 与应用状态。legacy-core 模块继续即时保存和 PreferenceSaveStatus，外观偏好继续按既有机制保存。

## 自动化证据及边界

`test/panel.test.js` 的 command bar harness 覆盖六区/当前分区、别名搜索、快捷键、方向键/Enter/Escape、模态标签、焦点恢复、监听清理、草稿与 URL 保持、go/goTo/历史滚动复位、loading 后标题聚焦、命令栏测量和显式锚点，以及单列/横向滚动/44px/安全区 CSS 契约。新增 phase B 权限上限/+N、三项 footer、默认可见摘要/技术白名单、健康结论/折叠诊断、分组动作/忙碌原因、异步与局部导航复位及移动标签/值行回归；保留模块结构、数字控件及保存/冲突回归。`test/navigation.test.js` 保持全量旧入口、设置路径及 URL/history 回归；`test/module-webui.test.js` 保持公开值、surfaces 与 component keys 契约。

`npm test` 执行 Node shim/静态 CSS 与服务测试，不执行浏览器布局。`npm run check:docs` 检查文档链接；`npm run check:parity` 检查能力矩阵；`npm run pack:release` 仅生成本地归档，`npm run check:package` 检查双格式文档逐字节一致、链接、客户端加载、恰好两项 DSH 注册及私有数据排除。测试文件不进入发行包。

## 浏览器验收矩阵（phase A/B 全部 pending）

DSH 已用真实 Chromium 提供旧版截图，确认第三列侧栏、图标轨道、移动导航占高，以及 phase B 的详情顶部裁切、原始技术字段铺开和列表权限/按钮墙问题。本次 Node shim/CSS 验证不构成真实布局、吸附、软键盘或读屏通过证据；phase A/B 的真实 DSH 截图由 DSH 后续捕获。历史环境的 libnspr 缺失记录不代表 DSH 当前浏览器状态。

每行在 DSH 外层侧栏展开/收起、dark/light、100%/125%/200% zoom 下重复，执行 Tab/Shift+Tab/Enter/Space/Escape、Ctrl/Cmd+K 及前进/后退。记录实际 CSS 视口及目录容器宽度；移动行另测安全区及软键盘。

| CSS 视口宽度 | 顶部壳层与模块预期 | 状态 |
| --- | --- | --- |
| 1440px | 单列填满宿主面板，无第三列；区域/分区横向滚动；目录 ≥760px 两列，否则单列 | pending：DSH 截图 |
| 1024px | 相同顶部壳层，受宿主实际宽度约束；目录按容器阈值回落 | pending：DSH 截图 |
| 768px | 相同命令栏、单行分区；模块单列、元数据标签/值行、折叠技术详情、底部保存栏 | pending：DSH 截图 |
| 390px | 44px 横向区域/分区；正文立即开始；长文本/单位/动作无横向溢出 | pending：DSH 截图 |

后续真实浏览器逐项验收：

1. 测量宿主可用宽度与正文宽度；滚动长页检查命令栏可达、当前区域/分区高亮及横向滚动，保留未保存草稿。
2. 检查搜索聚焦、↑↓/Enter/Escape、Tab/Shift+Tab、快捷键与关闭恢复；搜索设置路径、旧名称及模块。重复打开/关闭、离页，确认无重复 ID 或快捷键监听残留。
3. 模块目录测试容器 759/760px 及视口 900/901px 边界、同行 footer、权限最多三项与 +N、两列动作、禁用原因、metadata 标签/值同行、两个默认关闭的技术详情、预览/iframe/数字单位。
4. System、Profiles、模块文件配置分别编辑/保存/重读并制造 revision 冲突；检查唯一保存栏、禁用/忙碌、草稿保留及 legacy-core 即时保存。聚焦末字段并打开软键盘，检查控件互不遮挡。
5. 从长页切换区域/分区/模块详情，确认插件回到页首、标题获焦；显式设置/配置锚点定位不被吸附命令栏遮挡。返回/前进统一复位。主题、缩放及宿主侧栏状态下重复关键路径；补充读屏、焦点、触控、安全区、浏览器返回/前进及旧入口证据后，才将对应 pending 改为实测结果。
