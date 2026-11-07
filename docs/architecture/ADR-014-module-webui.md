# ADR-014：模块 WebUI 描述契约与核心详情/通用配置

- 状态：已批准；WebUI Phase 1、Phase 2 已实现；Phase 3 配置归属迁移及自定义 UI 待实施（独立于此前模块内核的 Phase 编号）
- 日期：2026-11-07
- 范围：UI 元数据、信任边界、只读目录、核心模块详情与通用模块配置；配置所有权、内置自定义 React 与外部沙箱留待后续阶段。

## 信任与宿主边界

| 层级 | 权限与当前状态 |
|---|---|
| core | 核心客户端拥有页面布局、导航、HTTP 请求、现有配置编辑器与 DSH 注册 |
| builtin trusted | 静态注册表认证的包内模块；声明元数据，由核心解释 status/schema，无内置自定义 React 组件执行 |
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
  "config": { "binding": "module-file", "schemaVersion": 1, "available": false },
  "surfaces": [
    { "id": "detail", "hook": "module.detail", "renderer": "status", "order": 0 },
    { "id": "config", "hook": "module.config", "renderer": "schema", "order": 10 }
  ],
  "requestedCapabilities": []
}
```

严格允许的根字段只有 version/config/surfaces/requestedCapabilities；surface 字段只有 id/hook/renderer/order，config 字段只有 binding/schemaVersion/available。拒绝未知字段、可执行值、getter、toJSON、非 JSON 对象和深度超过 8 的嵌套。描述符 `JSON.stringify` 的 UTF-8 大小最多 65,536 字节（不计算整个 module.json 的其它字段或源文件空白）。config 可省略，归一化为 `{binding:'none',schemaVersion:null,available:false}`；surfaces、requestedCapabilities 可省略，默认空数组。

| 内部 hook | Phase 2 核心渲染 |
|---|---|
| `module.card` | status 为纯文本说明/状态，在卡片及详情中展示 |
| `module.detail` | status 为纯文本说明/状态 |
| `module.config` | schema + 内置可用 module-file 为通用编辑器；其余为不可用占位 |
| `module.actions` | 禁用占位，无模块动作执行 |
| `module.panel` | 禁用占位 |

每模块每 hook 最多一个贡献；surface 总数最多 5，id 不重复且匹配 `[a-z0-9][a-z0-9_-]{0,63}`。order 默认 0，必须为 -100～100 的整数；模块内按 order 升序、id 次序排列。hook 是内部契约，不是 DSH slot，不包含任意挂载位置或代码入口。

内置与外部都只接受 `status` / `schema` renderer。Phase 1 只显示元数据占位；Phase 2 的核心渲染器解释 status 纯文本与可用内置 module-file 的 schema 表单，其它组合显示禁用占位，不执行模块提供的代码或动作。`builtin-react` / `sandbox` renderer、`componentKey` / `sandbox` 字段均拒绝；未来执行器必须另行演进版本和授权，v1 不通过保留字段暗中开启执行。UI capabilities 当前白名单为空，requestedCapabilities 只能为空数组，grantedCapabilities 始终为空；不继承后端 permissions。

config.binding 只允许 none/legacy-core/module-file；schemaVersion 为 null 或正安全整数，available 必须为布尔值。none 要求 null/false；legacy-core 仅内置且 available:false；外部不能声明 available:true。schemaVersion 是模块 UI 配置契约的版本元数据，与全局配置文件版本、配置值 revision 无关。描述符与目录没有 schema 字段表、默认值、实际值、文件路径、URL、HTML 或可执行宿主 exports。

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

ModulesPage 并行读取 `/modules` 与 `/modules/ui`。点击模块卡片背景、「详情」或可用的「配置」按钮，进入核心拥有的独立详情视图，「返回模块列表」恢复列表并丢弃草稿。核心显示名称、来源/信任 badge、启用状态、运行状态与错误。只有模块 ID、来源/信任、generation、uiRevision 和 status 匹配，且 config/surfaces/capabilities 合法时采用 UI 条目；跨请求发生重载/状态切换、未知版本、无效 UI、未 opt-in 或 UI 请求失败均显示核心状态 fallback，不加载配置。status surface 只以文本节点显示模块说明与状态，不解析 HTML；不会导入 componentKey、执行 sandbox 或新增 DSH 注册。原启停与重载动作保持。

详情中的通用编辑器仅适用于 hasConfig 的受信内置模块、`config.available:true`、`binding:module-file` 及 `module.config` / schema surface。沿用 GET/POST `/modules/config` 与 FieldRow/FieldControl；没有新增后端端点。进入详情加载草稿，保存携带 revision，成功后重读并刷新目录；重读失败仍保留保存返回的 revision。取消丢弃草稿，可再次加载；冲突/保存错误保留草稿并提示，MODULE_CONFIG_* 语义保持。保存/加载期间禁用编辑、返回与相关操作。关闭或未 loaded 的模块仍可查看详情、读取配置，但字段与保存禁用；启用且 loaded 后可编辑。列表没有行内配置编辑器。

## 配置归属与后续阶段

reply-delivery、typing、reminders 声明 detail/status 与 config/schema，config binding 为 legacy-core、schemaVersion:1、available:false；详情只显示「配置仍在系统设置，Phase 3 迁移」与前往现有认知设置分组的按钮（cog-reply/cog-turn/cog-reminders），不复制或写字段。即使 UI 目录不可用，已知内置 legacy 模块仍保留说明。现有 cognition.reply/typing/reminders 配置路径、值、编辑所有权与行为保持。sample 的 binding 为 module-file、schemaVersion:1、available:true，现有通用编辑器迁入详情。

Phase 3 再将 legacy 配置编辑入口归属模块页；存储 key、数据位置与兼容契约保留，不能因 UI 迁入就迁移或复制配置值。Phase 2 只移动 sample 的既有通用编辑器，不改变配置所有权。内置自定义 React 组件、外部沙箱、能力消息桥、外部 UI 执行与额外 DSH 入口均未实施；未来执行器须独立设计与验证。本阶段无版本升级、推送、部署、tag 或 release。
