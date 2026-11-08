# 响应式导航与模块 UI 验收契约

UI phase 5，仅补齐最终回归契约、验收说明和文档入口。实现基线为导航 `e897798`、模块布局 `4ac3557`、显式保存栏 `a4b3d88`；版本保持 0.11.20。使用入口见[用户手册](../USER-MANUAL.md#4-面板六区导航)，设置所有权与旧入口见 [ADR-020](../architecture/ADR-020-settings-ownership-navigation.md)。

## 桌面导航与正文宽度

- 视口 >900px：内部导航展开宽 240px，折叠为 72px 图标栏，正文列始终为 `minmax(0,1fr)`。折叠改变网格列宽，正文收回 168px；不切换目的地、不重新挂载正文、不丢失草稿。DSH 外层侧栏独立于此内部导航。
- 首次渲染前读取 `localStorage['dsh-bot:navigation:desktop:v1']`，只接受 `collapsed`，其余值默认 `expanded`；写入仅来自桌面切换。存储被禁用时本次会话仍能切换。移动抽屉、窗口缩放不会覆盖桌面偏好。
- 折叠态保留展开、搜索及六区图标，当前区域高亮；隐藏分区不参与 Tab。图标有可访问名称，悬停/键盘焦点显示提示，Esc 关闭提示。搜索先展开再聚焦。
- 导航与正文是同级元素，加载/错误时导航仍可用；URL/history、旧别名和返回/前进保持。DSH 仍恰好注册 `main` 与 `sidebar.panellist` 两项，ID 均为 `onebot-qq`。

## 移动导航、焦点与滚动

- 视口 ≤900px：正文单列，顶部导航 `position:sticky;top:0`，显示当前位置和分区选择器，导航宿主层级高于底部保存栏。桌面导航和抽屉共用一个 nav 实例。
- “导航与搜索”通过 `aria-haspopup="dialog"`、`aria-expanded`、`aria-controls` 关联唯一原生 dialog，使用 `showModal()`；宽 `min(320px,85vw)`，高度提供 100vh/100dvh 回退，导航内容独立纵向滚动并限制滚动链。
- 打开聚焦搜索；Tab/Shift+Tab 在可见、可用、非 inert、非负 tabindex 控件内循环，无控件时聚焦 dialog。关闭按钮、Esc、背景点击、原生关闭、选择目的地、断点切换和卸载均清理状态。
- 关闭恢复触发器焦点；选择目的地后聚焦正文目的地。切回桌面时可回退到桌面切换按钮。关闭抽屉不改变桌面偏好。
- 打开期间锁定 document/body/面板根滚动，补偿滚动条宽度；关闭或卸载恢复原样式、根滚动位置及窗口位置。不得累积 padding 或遗留 body fixed。
- 顶栏考虑顶部 safe-area，抽屉考虑四边 safe-area，正文考虑左右和底部 safe-area。移动按钮至少 44×44px，常规输入/select 高度至少 44px、字体 16px；导航与模块动作也显式约束触控尺寸。真实命中区域仍需浏览器测量。

## 模块目录与详情

- `.ob-module-list` 是 `inline-size` 容器，专用 `.ob-module-grid` 默认单列；仅在视口 >900px **且容器 ≥760px** 时两列。DSH 外层侧栏或内部导航占用宽度后，按目录实际宽度回落；不支持容器查询时保留单列。
- 卡片同行拉伸等高，Panel/body 使用 flex，footer 用自动上边距贴底。标题区只放标题/说明；详情、配置、重载、启停位于唯一 footer。≤900px 卡片动作全宽单列。卡片点击忽略按钮/链接/输入，保留按钮原有动作与禁用状态。
- 详情工具栏、摘要、健康、核心动作、功能链接、提醒和声明的 surfaces 为同级区块；保留 `ob-module-detail`、`ob-module-config`、`ob-module-panel`、`ob-module-reminders` 及 surface 锚点、React keys 和字段 ID。MediaFeaturesPanel 自带 Panel，不再包一层 Panel。
- 元数据采用语义 dl/dt/dd，桌面标签/值两列，≤900px 单列；标题、描述、版本、权限、依赖、generation、错误及禁用原因允许长字符串换行，不裁掉数据。禁用原因位于按钮外，通过 `aria-describedby` 关联。
- 预览为有间距的纵向段落，段落默认 margin 清零；模块 iframe 宽度 100%、最小宽度 0、最大宽度 100%，保留既有隔离与消息校验。数字输入和单位可换行，≤900px 纵向堆叠；保留 label/id、min/max/step、数值转换和空值语义。

## 显式保存栏

- 模块文件配置使用唯一 `.ob-module-savebar`（保存配置/重新加载配置/取消）；OwnerSettings 使用唯一 `.ob-owner-savebar`（保存设置/重新读取），均在 Panel 外。错误提示、footer 或桌面/移动视图不复制控件。
- 桌面沿用原位 flex 工具栏；≤900px 使用 `position:sticky;bottom:0;z-index:20`、不透明 surface、顶部分隔线，底部 padding 加 safe-area。按钮可换行、至少 44px 高。
- 根滚动区为保存栏预留 `12rem + safe-area-inset-bottom` 的 scroll-padding，字段/错误提示提供 scroll-margin。需实测长标签、缩放、最后一个字段、错误提示和软键盘下可见性。
- 保存仍为显式操作：模块 revision、保存后重读、冲突时保留草稿、只读/忙碌禁用；profile 使用原 CAS 与应用状态。legacy-core 模块继续即时保存和 PreferenceSaveStatus，浏览器偏好继续本地持久化。

## 自动化证据及边界

`test/panel.test.js` 的导航 harness、UI phase 3/4/5 覆盖 storage、matchMedia、dialog、焦点循环/恢复、滚动锁/恢复、正文保持挂载、模块结构、元数据、数字控件、CSS 断点/尺寸、安全区、唯一控件及保存/冲突行为。`test/navigation.test.js` 保持全部旧入口、URL/history 回归；`test/module-webui.test.js` 保持长公开值、surfaces 与 component keys 契约。

`npm test` 执行 Node shim/静态 CSS 与服务测试，不执行浏览器布局。`npm run check:docs` 检查文档链接；`npm run check:parity` 检查现有能力矩阵；`npm run pack:release` 仅生成本地归档，`npm run check:package` 检查双格式文档逐字节一致、链接、客户端加载、恰好两项 DSH 注册及私有数据排除。测试文件不进入发行包。

## 浏览器验收矩阵（全部 pending）

2026-11-08 环境复核：Chromium 二进制启动失败，缺少 `libnspr4.so`（libnspr）。以下均为 **pending / 待真实浏览器验收**；Node shim 与 CSS 契约不构成截图、尺寸、吸附、原生模态顶层或读屏通过证据。

每行分别在 DSH 外层侧栏展开/收起、dark/light、100%/125%/200% zoom 下重复，并进行纯键盘 Tab/Shift+Tab/Enter/Space/Esc 操作。记录 CSS 实际视口及目录容器宽度；缩放导致跨过 900px 时按实际 CSS 视口切换。移动行另测设备安全区及软键盘。

| 初始 CSS 视口宽度 | 导航与模块预期 | DSH 外层侧栏展开/收起 | dark/light | zoom 100/125/200% | 键盘 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1440px | 内部 240/72、正文回收；目录 ≥760px 两列，否则单列 | pending | pending | pending | pending | pending：libnspr 缺失 |
| 1024px | 内部 240/72；外层侧栏影响目录宽度，验证两列阈值回落 | pending | pending | pending | pending | pending：libnspr 缺失 |
| 768px | 顶栏/分区/dialog、模块/元数据单列、底部保存栏 | pending | pending | pending | pending | pending | pending：libnspr 缺失 |
| 390px | 同移动布局，长文本/单位/动作不溢出，安全区及软键盘 | pending | pending | pending | pending | pending | pending：libnspr 缺失 |

恢复浏览器环境后的逐项验收：

1. 桌面折叠/展开并刷新，测量 240/72 和正文回收；保留未保存草稿，检查搜索聚焦、提示与隐藏分区 Tab 排除；禁用 localStorage 后重测。
2. 移动滚动长页，检查顶栏持续可达；打开抽屉，测试首尾焦点循环、Esc/关闭/背景、选择结果后目的地焦点、无背景滚动和关闭后的精确位置恢复。反复跨断点并在打开态离页，确认无残留锁定、无重复 nav/ID。
3. 模块目录混合长短标题、描述、依赖和错误；测试容器 759/760px 及视口 900/901px 边界、同行 footer 对齐、唯一动作、禁用原因及详情各区块。检查 metadata/预览/iframe/数字单位无横向溢出。
4. System、Profiles、模块文件配置分别编辑、保存、重新读取并制造 revision 冲突；确认唯一保存栏、禁用/忙碌状态、草稿保留；legacy-core 即时保存正常。聚焦末字段并打开软键盘，检查保存栏、错误和字段不互相遮挡。
5. 每种主题、缩放及 DSH 外层侧栏状态重复关键路径，检查可见焦点、触控命中、安全区、浏览器返回/前进和旧入口。补充读屏名称与模态导航检查后，才可将对应 pending 改为实测结果并附环境证据。
