# ADR-014：模块 WebUI 描述契约与核心详情/通用配置

- 状态：已批准；WebUI Phase 1、Phase 2、Phase 3A、Phase 3B、Phase 4 已实现；沙箱 UI 待实施（独立于此前模块内核的 Phase 编号）
- 日期：2026-11-07
- 范围：UI 元数据、信任边界、只读目录、核心模块详情与通用模块配置；Phase 3A 调整内置旧配置的呈现归属；Phase 3B 增加受信编译期 React 只读预览；Phase 4 开放外部声明式 config schema 与核心通用编辑；沙箱留待后续阶段。

## 信任与宿主边界

| 层级 | 权限与当前状态 |
|---|---|
| core | 核心客户端拥有页面布局、导航、HTTP 请求、现有配置编辑器与 DSH 注册 |
| builtin trusted | 静态注册表认证的包内模块；声明元数据，由核心解释 status/schema；builtin-react 仅选择冻结编译期注册表中的纯 React 预览 |
| external declarative | 外部清单显式 webui.version:1 opt-in；只允许核心解释的 status/schema 描述，无执行权限 |
| external sandbox | 未来阶段；尚无 iframe、消息桥、能力授权或执行器 |
| external same-origin React | 禁止；不能导入外部 React、注册组件或取得宿主可执行 exports |

UI 信任分层不改变后端外部 JS 仍是操作员安装的同进程代码这一事实；它不是后端沙箱。source/trust 由加载器决定，外部清单伪造 builtin/source 不会升级权限。

只有核心 `client.js` 注册 DSH `sidebar.panellist` 和 `main`，总计两个注册，沿用现有 onebot-qq 入口。本阶段没有按模块注册 DSH slot、侧栏或主页面，也不允许任意 DSH slot 名称出现在描述符中。模块详情是现有「模块」页内部的核心 section。

## v1 描述符

内置注册表使用描述符的 `ui` 字段；外部只读取 `module.json` 的可选 `webui` 字段。未声明表示未 opt-in；声明 null/未知版本/无效数据表示无效 UI。二者都保留核心模块卡片。

```json
{
  "version": 1,
  "config": { "binding": "module-file", "schemaVersion": 1, "available": true },
  "surfaces": [
    { "id": "detail", "hook": "module.detail", "renderer": "status", "order": 0 },
    { "id": "config", "hook": "module.config", "renderer": "schema", "order": 10 }
  ],
  "requestedCapabilities": []
}
```

此例用于有有效顶层 config schema 的外部模块（完整 module.json 与后端 setup 作者示例见 [MODULES](../MODULES.md#外部模块作者示例webui-phase-4)）。

严格允许的根字段只有 version/config/surfaces/requestedCapabilities；surface 字段只有 id/hook/renderer/order，以及仅 builtin-react 可用的 componentKey，config 字段只有 binding/schemaVersion/available。拒绝未知字段、可执行值、getter、toJSON、非 JSON 对象和深度超过 8 的嵌套。描述符 `JSON.stringify` 的 UTF-8 大小最多 65,536 字节（不计算整个 module.json 的其它字段或源文件空白）。config 可省略，归一化为 `{binding:'none',schemaVersion:null,available:false}`；surfaces、requestedCapabilities 可省略，默认空数组。

| 内部 hook | Phase 4 核心渲染 |
|---|---|
| `module.card` | status 为纯文本说明/状态，在卡片及详情中展示 |
| `module.detail` | status 为纯文本说明/状态；内置 builtin-react 为受信只读预览 |
| `module.config` | schema + 内置/外部可用 module-file 为通用编辑器、legacy-core 为全局字段表单；其余为不可用占位 |
| `module.actions` | 禁用占位，无模块动作执行 |
| `module.panel` | 禁用占位 |

每模块每 hook 最多一个贡献；surface 总数最多 5，id 不重复且匹配 `[a-z0-9][a-z0-9_-]{0,63}`。order 默认 0，必须为 -100～100 的整数；模块内按 order 升序、id 次序排列。hook 是内部契约，不是 DSH slot，不包含任意挂载位置或代码入口。

内置与外部均接受 `status` / `schema` renderer。Phase 3B 仅对加载器认证的 builtin source 增加 `builtin-react`；必须包含 componentKey，匹配 `^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9-]{0,31}$` 且总长最多 64，并属于冻结 `BUILTIN_COMPONENT_KEYS` 白名单：`reply-delivery.preview`、`typing.preview`、`reminders.preview`、`sample.preview`。外部 builtin-react、未知 key、非 builtin-react 上的 componentKey 均拒绝。目录仅为 builtin-react 投影 componentKey，没有函数或路径。`sandbox` renderer/字段仍拒绝；UI capabilities 当前白名单为空，requestedCapabilities 只能为空数组，grantedCapabilities 始终为空；不继承后端 permissions。

config.binding 只允许 none/legacy-core/module-file；schemaVersion 为 null 或正安全整数，available 必须为布尔值。none 要求 null/false；legacy-core 仅内置，Phase 3A 允许 available:true；外部仅在加载器已验证顶层 config schema 时可声明 module-file/schemaVersion:1/available:true，module.config/schema surface 同样要求有效 schema；缺少 schema 时配置不可用，越权声明使 UI 安全回退。schemaVersion 是模块 UI 配置契约的版本元数据，与全局配置文件版本、配置值 revision 无关。描述符与目录没有 schema 字段表、默认值、实际值、文件路径、URL、HTML 或可执行宿主 exports。

## 加载、目录与生命周期

`src/modules/webui.js` 是纯元数据校验/投影模块，不导入模块代码、不扫描目录、不读取配置值。内核启动/外部重载时从已有注册表或已读取的 manifest 校验 UI；无效或超限 UI 返回固定 `uiWarning:'MODULE_UI_INVALID'`、无 surfaces 和空配置元数据，不回显输入或底层错误，不单独使有效后端模块失败。整个 manifest 无效时建立全新的错误记录，也不继承旧 UI。

`GET /onebot-qq/api/modules/ui` 返回：

```text
{ok:true, version:1, catalogRevision, items:[
  {moduleId,source,trust,generation,uiRevision,status,
   config:{binding,schemaVersion,available},surfaces,
   requestedCapabilities:[],grantedCapabilities:[],uiWarning}
]}
```

source/trust 均为 builtin 或 external（分别对应 builtin trusted / external declarative 层级）；不合法的目录名不投影到 UI 目录。每次调用从内存记录建立深拷贝的公开条目，按 moduleId 排序；不执行 import、rescan、配置读取，也不包含 name/description/error 等不受限文本、绝对路径或配置值。

generation 是不透明 UUID：新记录、每次激活/setup（含依赖恢复）和外部 reload 均获得新身份，初始关闭模块也有身份；停用保留最后身份并改变 status。旧 runtime/旧记录不能作为新激活或重载的身份。uiRevision 是规范化描述符 JSON 的 SHA-256；未声明为 `none`，无效为 `invalid`。同描述符重新激活/重载保持 uiRevision，配置值保存不改变它。catalogRevision 是整个有序公开 items JSON 的 SHA-256，状态、generation 或 UI 元数据变化会更新它；重复读取保持稳定。

ModulesPage 并行读取 `/modules` 与 `/modules/ui`。点击模块卡片背景、「详情」或可用的「配置」按钮，进入核心拥有的独立详情视图，「返回模块列表」恢复列表并丢弃草稿。核心显示名称、来源/信任 badge、启用状态、运行状态与错误。只有模块 ID、来源/信任、generation、uiRevision 和 status 匹配，且 config/surfaces/capabilities 合法时采用 UI 条目；跨请求发生重载/状态切换、未知版本、无效 UI、未 opt-in 或 UI 请求失败均显示核心状态 fallback，不加载配置。status surface 只以文本节点显示模块说明与状态，不解析 HTML；builtin-react 只在 module.detail 经冻结组件表查找；不会把 componentKey 当作导入路径、执行 sandbox 或新增 DSH 注册。原启停与重载动作保持。

详情中的通用编辑器适用于 hasConfig 的内置或外部模块、`config.available:true`、`binding:module-file` 及 `module.config` / schema surface。沿用 GET/POST `/modules/config` 与 FieldRow/FieldControl；没有新增后端端点。进入详情加载草稿，保存携带 revision，成功后重读并刷新目录；重读失败仍保留保存返回的 revision。取消丢弃草稿，可再次加载；冲突/保存错误保留草稿并提示，MODULE_CONFIG_* 语义保持。保存/加载期间禁用编辑、返回与相关操作。关闭或未 loaded 的模块仍可查看详情、读取配置，但字段与保存禁用；启用且 loaded 后可编辑。列表没有行内配置编辑器。

## 配置归属与后续阶段

Phase 3A：reply-delivery、typing、reminders 声明 detail/status 与 config/schema（Phase 3B 将 detail 改为 builtin-react），config binding 为 legacy-core、schemaVersion:1、available:true。现有核心字段表新增有界 `module` 字符串元数据（`[a-z0-9][a-z0-9_-]{0,63}`）；normalizeFieldSpec/buildFieldSpecs 保留合法归属。精确 12 个路径见 [模块文档](../MODULES.md#webui-phase-4-当前状态)：cognition.reply 的六字段归属 builtin-reply-delivery，cognition.typing.enabled 归属 builtin-typing，cognition.reminders 的五字段归属 builtin-reminders。

模块详情使用 `props.configInfo.groups` 中匹配当前模块的字段、既有 FieldRow、`getByPath(props.draft,path)`、`saveUiPatch({[path]:value})` 与 prefStatus；不进入 module-file 编辑器或请求 `/modules/config`。关闭或未 loaded 时字段与写入回调均禁用，启用且 loaded 后可编辑。详情注明设置归属当前模块、存储键保持不变。系统设置统一过滤 module 字段并丢弃空组；cog-reply 保留 notices/requests/notice，cog-turn 保留其余字段，cog-reminders 移除，无重复编辑路径。UI 无效/过期/不可用时保持核心安全回退，不呈现可编辑旧配置。

sample 的 binding 为 module-file、schemaVersion:1、available:true，继续既有详情通用编辑器、revision、保存重读、取消、冲突及只读语义。`/modules/ui` 无配置字段表或值，无新后端配置端点。Phase 3A 仅移动设置呈现与编辑入口；存储键、数据位置、默认值、规范化与运行行为保留，无数据迁移、复制或模块独立 config 文件。

## Phase 3B：受信编译期预览

四个内置模块各将原 module.detail/status 替换为 module.detail/builtin-react，使用上述对应 key；module.config/schema 保留，每 hook 仍只有一个贡献。客户端 `BUILTIN_MODULE_UI` 为 Object.freeze 的编译期组件表，测试验证与服务端白名单一致。仅经 uiFor 的来源、生命周期与描述校验后查表渲染；语法合法但客户端未知的 key 显示安全回退文本，外部 builtin-react 从不进入组件表。无动态 import/eval、DOM 注入、网络或副作用。

组件仅接收冻结的有界 module 元数据（id ≤64、name ≤128、有限 status、enabled）、各自配置字段与只读 summary，不传全局 draft、秘密、请求客户端、保存回调或宿主 exports。配置布尔值严格校验，整数沿用既有范围，无效/缺失显示未加载；sample message 最多 200 字符，仅作为文本节点。前三个预览选取全局 draft 的对应字段；sample 从匹配模块的既有 editor.values 取值，未加载/取消后显示未加载配置。没有新增请求或配置值修改，编辑器与保存链路保持。

reply-delivery 展示分条开关、字数/条数上限、引用/@ 与等待摘要；typing 展示模块启用、输入状态开关及 enabled + loaded + typing.enabled 的有效状态（仅私聊且依赖网关）；reminders 展示模块/提醒开关、活跃上限、最短/最长间隔与 tick，不创建或列出提醒；sample 只读展示配置消息。

Phase 4 在此基础上增加外部声明式配置，见下节。外部沙箱 UI 的 iframe、能力授权、消息桥与执行器尚未实施，外部同源 React 继续禁止。无任意 slots、依赖或配置值变化；本阶段无版本升级、推送、部署、tag 或 release。


## Phase 4：外部声明式配置

外部 module.json 的可选顶层 config 复用 validateConfigSchema：version:1、最多 32 个有界平面字段、七种非秘密类型、合法默认值、schema/值的 64 KiB 上限。schema 无效/超限使模块清单无效并在 import 前拒绝；未知 manifest 属性不透传。manifestFor 明确提取 configSchema 后交给 makeRecord，启动/重载均在 setup 前恢复配置；不改变内置配置或旧 API。

配置仅存于已验证模块目录的 config.json，复用原子替换、revision、默认值回退和 MODULE_CONFIG_* 错误。外部目录/文件符号链接（包括内部/悬空链接）和目录链接替换不允许读写配置。读取失败安全回退默认值与 revision 0；写入失败不更新当前值、revision 或通知。真实 source 随 get/set 快照返回；hasConfig 与 api.config.get/onChange 只依赖有效 schema，后者仅暴露本模块值，不授予 config:read、persona:store、provider 等内置特权。生命周期清理继续注销监听器。

WebUI 需另外声明 module-file/schemaVersion:1/available:true 和 module.config/schema surface；无 schema 不能获得此入口。没有 webui 的模块仍可通过现有配置 API 管理值。无效 webui 沿用 MODULE_UI_INVALID/空 surfaces/配置不可用回退，有效后端继续运行。目录仍只含元数据，没有 schema 字段、默认值、实际值或路径，配置保存不改变 UI revision。客户端沿用 FieldRow/FieldControl、GET/POST、revision、保存重读、取消、冲突保留草稿及只读规则；只在 enabled 且 loaded 时允许编辑，外部徽章仍为「外部声明式（无执行权限）」。服务端延续关闭时可读写配置的既有语义。

外部 componentKey、builtin-react、sandbox 继续拒绝，无外部 React、可执行 WebUI 或新 DSH slot。**沙箱尚未实现**，iframe、隔离加载、能力授权、消息桥、执行器和对应安全验证均属于后续工作；后端同进程 JS 及并发文件系统修改不是本契约的隔离保证。revision 仍限于同一内核，不提供跨进程锁或 schema 迁移。本阶段只本地验证与提交，不升级版本、推送、部署、tag 或发布。
