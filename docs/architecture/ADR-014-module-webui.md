# ADR-014：模块 WebUI 描述契约与模块中心骨架

- 状态：已批准；WebUI Phase 1 实现（独立于此前模块内核的 Phase 编号）
- 日期：2026-11-07
- 范围：UI 元数据、信任边界、只读目录、核心模块详情占位；后续阶段单独实施。

## 信任与宿主边界

| 层级 | 权限与当前状态 |
|---|---|
| core | 核心客户端拥有页面布局、导航、HTTP 请求、现有配置编辑器与 DSH 注册 |
| builtin trusted | 静态注册表认证的包内模块；Phase 1 只声明元数据，无 React 组件执行 |
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

| 内部 hook | 预定用途；Phase 1 均仅列出占位 |
|---|---|
| `module.card` | 模块目录卡片补充 |
| `module.detail` | 模块详情说明/状态 |
| `module.config` | 模块配置入口 |
| `module.actions` | 模块动作入口 |
| `module.panel` | 模块页内部面板 |

每模块每 hook 最多一个贡献；surface 总数最多 5，id 不重复且匹配 `[a-z0-9][a-z0-9_-]{0,63}`。order 默认 0，必须为 -100～100 的整数；模块内按 order 升序、id 次序排列。hook 是内部契约，不是 DSH slot，不包含任意挂载位置或代码入口。

内置与外部 Phase 1 都只接受 `status` / `schema` renderer；两者当前都只是安全的元数据占位，不渲染表单、调用动作或执行模块 UI。`builtin-react` / `sandbox` renderer、`componentKey` / `sandbox` 字段均拒绝；未来执行器必须另行演进版本和授权，v1 不通过保留字段暗中开启执行。UI capabilities 当前白名单为空，requestedCapabilities 只能为空数组，grantedCapabilities 始终为空；不继承后端 permissions。

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

ModulesPage 并行读取 `/modules` 与 `/modules/ui`。用户展开详情后，核心显示标题、状态和信任 badge，再列出 surface 的 hook/renderer/id 占位。只有模块 ID、来源、generation、uiRevision 和 status 匹配，且 surface 合法时采用 UI 条目；跨请求发生重载/状态切换、未知版本、无效 UI、未 opt-in 或 UI 请求失败均显示核心 fallback。关闭模块仍可查看。原启停、重载与 sample 行内配置逻辑保留。

## 配置归属与后续阶段

reply-delivery、typing、reminders 声明 detail/status 与 config/schema 占位，config binding 为 legacy-core、schemaVersion:1、available:false；只表达未来归属，现有 cognition.reply/typing/reminders 配置路径、值、编辑位置与行为保持。sample 同样声明两个占位，binding 为 module-file、schemaVersion:1、available:true，仍使用既有行内编辑器。

未来配置的用户入口归属模块页；存储 key、数据位置与兼容契约保留，不能因 UI 迁入就迁移或复制配置值。配置编辑器迁移、内置 React 组件、外部沙箱、能力消息桥、外部 UI 执行、额外 DSH 入口均不属于 Phase 1。本阶段无版本升级、推送、部署、tag 或 release。
