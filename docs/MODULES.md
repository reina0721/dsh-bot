# 模块：内置与外部

模块架构 v2 使用统一目录、清单、API 与生命周期：

| 来源 | 代码来源 | 启停 | 重载 | 可写目录（api.dir） |
|---|---|---|---|---|
| 内置（builtin） | 随 dsh-bot 发布的静态受信任注册表，不扫描包内目录 | 可以 | 不可以 | `<数据目录>/modules/.builtin/<id>/` |
| 外部（external） | 操作员安装到 `<数据目录>/modules/<id>/` 的本地 JS | 清单允许时可以 | 可以 | 模块目录 |

内置 ID 必须以 `builtin-` 开头，外部模块禁止使用此前缀。内核扫描外部目录时跳过 `.builtin`。Phase 4 已把回复交付规划迁入内置模块，Phase 6 把私聊输入状态迁入内置模块，Phase 13 把提醒调度与命令迁入 builtin-reminders；没有远程安装、上传、marketplace 或网络下载模块代码。

> **安全警告：模块是与 dsh-bot 同进程运行的任意本地代码。** `permissions` 只限制下面这套稳定 API，不是操作系统沙箱；模块仍可能直接使用 Node.js 能力。只安装你已经审查并信任的代码，模块目录的写权限也应只给受信任的操作员。

## 闭环 v2 管理与导航（C07）

C01–C07 的提交链、贴纸库/发送矩阵、恢复与系统闭环验收、包检查和离线限制统一见 [C08 最终验收](architecture/CLOSED-LOOP-ACCEPTANCE.md)。C08 不新增生产功能；main/sidebar.panellist 仍恰好两项 DSH 注册，无自动 restart、exactly-once 或 UI 权限扩展。

[ADR-018](architecture/ADR-018-module-closed-loop.md) 定义模块健康与人工恢复；C03/C04 已实现核心 API，C07 接入核心客户端详情。lifecycle 的 loaded 只证明 setup 完成；ModuleHealth 只呈现缓存遥测，实际 provider owner 由宿主协调状态确定。提醒注册不等于接管，核心 fallback 必须在实际启动后才显示 active；其它功能模块停用仍无 fallback。未知/不适用字段为 null，不能显示为 0/false；runtimeGeneration 绑定每次 setup，独立于 UI 授权可轮换的 generation。

健康 GET 不扫描、不 import、不调用 provider status/stats 或网络探针。详情独立显示 lifecycle/health/reasons/lastError、注册与实际 owner/fallback、依赖、scheduler/engine/telemetry，并保留 telemetryGeneration。核心 action allowlist 包含 enable/disable/restart/reload、proactivity.runOnce、learning.runPending，可用性来自 `/modules/actions?id=`，必须经过核心 operation registry、requestId 幂等与 expectedGeneration 校验；先下游后目标停止排空，再按依赖正序恢复。10 秒未排空显示 STOP_PENDING，保持同一操作并阻止第二 owner，不强行重启或自动循环恢复。外部模块继续原 toggle/reload 与授权规则；纯 React preview 和隔离 iframe 均不获得 action bridge 或宿主执行权。

[ADR-019](architecture/ADR-019-system-closed-loop.md) 的系统 loop/receipt 只供核心管理面关联，禁止正文与跨人格读取，每人格合计 7 天/5000 条；模块不自行写 delivery receipt、不把 decision.status 当发送事实，也不能借观测 API 更新 policy、发送或执行研究。未观察反馈不算负面，研究首次轮次缺失保持 null；重启中断只记录 interrupted，不重发/重跑。

核心动作区不读取 manifest 的动作声明；外部 `module.actions` surface 仍不能提供执行器或桥接。发送/模型等副作用先在 UI 确认，`POST /modules/action` 只表示接纳；客户端按同一 operation 轮询，只有 succeeded 且 result.ok 才提示完成。busy、skip、NO_TASK、失败均不提示成功；STOP_PENDING 继续观察。提交响应丢失按原 requestId 查询，查询失败可点「继续观察操作」，不自动生成新请求重试。动作终态刷新健康与目录；页面离开后停止轮询，服务端操作继续，UI 不跨页面持久保存 operation。

客户端使用 `goTo({tab,section,moduleId,anchor,decisionId,taskId})`，兼容 `go(id,group)`；同一已挂载页面也响应新目标。内置功能目的地由核心 `MODULE_DESTINATIONS` 定义：B站直达媒体模块 panel，表情包库到媒体页，主动/学习到认知分区，提醒到当前人格提醒记录数，配置锚点定位已有唯一编辑器。媒体/主动/学习提供返回模块详情。无新增 DSH slot/sidebar、配置键或后端契约；外部 schema/iframe 授权与隔离保持。

「认知 → 闭环」使用既有 `/system/loop/summary`、`runs`、`detail`，每页 50 条与服务端 cursor 翻页；可从决策直达详情。只显示核心投影的阶段、交付状态和 attempted/sent parts、反馈来源/归因/观测、policy committed 与 Beta before/after、研究 unknown/task/evidence/claim 允许 ID 和关联入口。不显示正文、QQ/消息/事件 ID、路径或任意 JSON；没有人格选择参数，跨读取人格变化丢弃结果。未观察、不适用、不可用、已中断分别呈现。学习页保留队列「运行待处理」及 taskId 精确重试/取消，移除逐任务“运行”；目标在最近 100 条内会优先显示，超出时提示定位限制。提醒仅复用人格数据汇总，逐条查看/取消沿用 QQ 命令。无浏览器或真实 QQ/模型验收。

## 内置媒体功能（one-shot 模块 1）

当前目录共七个内置模块：learning、proactivity、media-features、reminders、reply-delivery、typing 默认启用，sample 默认关闭。`builtin-media-features` 是 Bilibili 功能服务、`/bili`、表情包策略和 `/sticker` 的唯一所有者；停用不恢复核心实现。其 `mediaFeatures` 槽位仅允许此模块注册，模块 setup 自行 start，start/stop 幂等；宿主提醒订阅只处理 `reminders`，媒体启停不改变提醒所有权。

`media:features` 仅内置声明，端口仅向该模块 ID 暴露。`api.mediaFeatures` 提供固定 Bilibili search/popular/view/replies transport、贴纸 pick/send、固定配置投影和媒体/图片/贴纸开关布尔状态。无 URL/headers/Cookie、路径、字节、凭据或任意 HTTP/路由权限。`/sticker` 的 commandToken 由核心在主人/denied/access 检查后签发，固定聊天、单次使用且 handler 结束或 runtime 停止后失效；文件解析、校验和 delivery/outbound 发送留核心。`audience` 仅内置命令可声明，`/bili` 为 owner-or-operator，`/sticker` 为 owner。

详情包含纯 `media-features.preview`、legacy-core 配置和 `media-features.panel` 的 Bilibili 操作界面。`content.bilibili.enabled/timeoutMs/maxResults`、`media.stickers.enabled/maxCount/maxBytes` 六字段归属此模块，键/默认值/全局保存不变；父媒体/图片开关仍在核心设置。原「内容」页指引进入模块，表情包管理暂留媒体页且每个 HTTP 操作都必须获当前 provider 授权。停用后两个命令静默、Bilibili 和贴纸 API 关闭，`/media/status` 仍报告可用性与原数据计数。无迁移、新 DSH slot 或核心功能回退。完整边界和限制见 [ADR-015](architecture/ADR-015-builtin-media-features.md)。

## 内置主动行为（one-shot 模块 2）

`builtin-proactivity` 默认启用，独占固定 `proactivity` provider、策略、提示词和单一递归 timer（首次 5 分钟，完成后 10 分钟）。业务开关 `cognition.proactivity.enabled` 默认关闭。停用后无 timer、手动运行或核心 fallback；核心 `proactivityStats()` / `runProactivity()` 与原 HTTP 路由仅为当前 provider 的 facade，缺失返回安全空统计/`MODULE_DISABLED`。宿主提醒订阅不受影响。

仅申请 providers:register、scheduler、config:read、proactivity:service；最后一项只允许固定内置 ID。`api.proactivity` 的 snapshot/begin/candidates/context/complete/send/release 提供当前人格的不透明 run token、最多 1000 个有效私聊候选（扁平维度）、显示名/最多四条各 160 字符记忆/三项风格。模型调用固定 proactive/220 tokens/0.8，核心保留路由与预算；发送固定目标/文本/source，创建规范 decision/proactive_intent，经过原 delivery/outbound 闸门且每 token 最多一次，无通用存储、LLM、delivery、URL/凭据或跨人格访问。

memory/LLM 等待前后和发送前检查人格/切换代次/runtime；停止使 token 失效，迟到回复不发送，已接纳发送可完成并写回原人格。私聊、安静本地小时、滚动 24 小时 decision 计数（包括 dry/failed）、熟悉度/排序/退避和 single-flight 保持。七个原 cognition.proactivity 字段在模块详情 legacy-core 编辑，preview 纯只读，停用/未 loaded 配置只读；键/默认值/数据不迁移，/quiet 与 /active 保持核心配置行为但不能启用停用模块。无 panel 或新 DSH slot。完整切换与限制见 [ADR-016](architecture/ADR-016-builtin-proactivity.md)。

## 内置学习编排（one-shot 模块 3）

`builtin-learning` 默认启用，唯一拥有固定 learning provider、未知自动规划/入队、来源迭代、任务执行和后台 timer（首次约 30 秒，完成后 60 秒，每 tick 最多一个 due pending）。停用同步取消订阅/timer/lease；无核心自动入队、runner 或 fallback，迟到结果不能发布 claim/解决 unknown。unknown 检测、已有知识与任务读取保持，重新启用不追溯建任务。手动运行不要求 autoResearch，但要求模块/cognition/learning 开启且未暂停；suggested 不自动执行。

只申请 providers:register、scheduler、config:read、learning:service，最后一项仅 builtin-learning 可用。宿主 learning-port 提供 onUnknownDetected/enqueueAuto/pending/claim/sources/collectFromSource/extractClaim/complete/fail/release/retry，引用均绑定人格/代次/runtime/任务版本，每 lease 一次 attempt。核心保留数据、来源/页面/URL、LLM/预算和同步事务写入；无通用存储或任意网络/模型调用。取消通过 claim 的 cancel 模式作原仓库转换，retry 保留原语义，facade 缺 provider 返回 MODULE_DISABLED。详情有纯 learning.preview 和 16 字段 legacy-core 设置，无可选 panel/新 DSH slot；原认知页手动运行入口经 provider。完整边界及限制见 [ADR-017](architecture/ADR-017-builtin-learning.md)。

## WebUI Phase 5 当前状态

现有「模块」页提供核心拥有的列表 → 详情 → 返回列表导航；点击卡片背景、「详情」或可用的「配置」入口进入详情。详情显示名称、来源/信任、启用状态、运行状态与错误，完整契约见 [ADR-014](architecture/ADR-014-module-webui.md)。内置 registry 的 `ui` 与外部 manifest 显式 opt-in 的 `webui: {version:1,...}` 只声明元数据；允许 module.card/detail/config/actions/panel 五个内部 hook，每 hook 一个贡献、最多五个 surfaces、order 为 -100～100 的整数，外部允许 status/schema 与显式授权的 sandbox renderer，内置额外允许 builtin-react。拒绝未知字段/能力、重复 ID/hook、非法 componentKey、越权 sandbox、可执行值与超过 64 KiB 的描述。UI 请求不 import、不重扫模块目录、不读配置值；隔离 UI 读取会校验公开资源；无效 UI 只有固定 uiWarning 和空 surfaces，有效后端仍可运行。

核心将 `module.card` / `module.detail` 的 status surface 渲染为模块说明与状态纯文本，不解析 HTML。`module.config` 的 schema surface 在 `config.available:true` 时按绑定分流：内置及声明有效 config schema 的外部 `module-file` 使用通用编辑器，受信内置 `legacy-core` 使用现有全局字段表与保存链路。列表没有行内编辑器。module.panel/detail 的 sandbox 经授权后仅在详情 iframe 中执行；外部 actions surface、未支持的 hook/renderer 组合与不可用配置保留禁用占位；核心动作区独立于这些 surface；builtin-react 在 module.detail 查找编译期预览组件，媒体功能另有固定 module.panel。

reply-delivery、typing、reminders 使用 `legacy-core`（available:true），sample 使用 `module-file`（available:true）；均为 schemaVersion:1 并包含 module.config/schema surface。前三者从现有 `configInfo.groups` 按字段 `module` 归属读取表单，值来自全局 draft，以 `saveUiPatch({[path]:value})` 即时保存并显示既有保存状态，不访问 `/modules/config`。归属元数据只允许最多 64 字符的模块 ID 字符串，不包含配置值或新存储位置。

Phase 3A 精确归属：

| 模块 | 移入详情的原存储键 |
|---|---|
| builtin-reply-delivery | cognition.reply.split、cognition.reply.maxChars、cognition.reply.maxParts、cognition.reply.delayMs、cognition.reply.quote、cognition.reply.atSender |
| builtin-typing | cognition.typing.enabled |
| builtin-reminders | cognition.reminders.enabled、cognition.reminders.maxActive、cognition.reminders.minIntervalSeconds、cognition.reminders.maxIntervalSeconds、cognition.reminders.tickMs |

系统设置不再呈现这些字段；cog-reply 保留 notices/requests/notice，cog-turn 保留其余字段，空的 cog-reminders 分组移除。详情说明设置属于当前模块且存储键保持不变；默认值、规范化、运行行为与数据位置不变，无数据迁移。停用或未 loaded 时字段只读，启用且 loaded 后才可编辑。sample 继续独立 revision、保存重读和取消流程。UI 目录缺失/无效/跨 generation 或 revision 时仅显示核心状态详情，不打开配置；`/modules/ui` 仍只有元数据，无新增后端配置端点。只有核心客户端注册原有 sidebar.panellist/main 两个 DSH slot；Phase 4 已开放外部声明式配置；Phase 5 实现显式授权的 iframe 与最小消息桥，外部同源 React 继续禁止。


历史 Phase 3B 将四个内置 module.detail/status 替换为 builtin-react，保留 module.config/schema，无重复 hook。服务端冻结 `BUILTIN_COMPONENT_KEYS` 与客户端冻结 `BUILTIN_MODULE_UI` 编译期注册表一致：

| componentKey | 只读预览 |
|---|---|
| reply-delivery.preview | 分条开关、单条字数/最多条数、引用/@、分条等待 |
| typing.preview | 模块启用、typing 开关及 enabled + loaded + typing.enabled 有效状态 |
| learning.preview | 模块/学习/自动检索/未知检测开关与每小时上限；不请求或运行任务 |
| proactivity.preview | 模块/主动开关、安静时段、私聊/群聊额度、熟悉度与退避；不运行 tick 或请求数据 |
| reminders.preview | 模块/提醒开关、活跃上限、最短/最长间隔、tick；不创建或列出提醒 |
| sample.preview | 当前配置草稿的示例消息，最多 200 字符，纯文本 |

componentKey 必须匹配 `^[a-z][a-z0-9-]{0,31}\.[a-z][a-z0-9-]{0,31}$` 且长度 ≤64；服务端拒绝未知 key、外部 builtin-react 和非 builtin-react 上的 componentKey。客户端先经 uiFor 校验来源、generation、revision、status 与描述，再查冻结表；未知 key 显示安全回退，外部从不渲染预览。组件只接收冻结的有界模块元数据、各自配置字段与只读 summary；不接收全局 draft、秘密、请求/保存回调或宿主 API。前三者从全局 draft 选择字段，sample 使用匹配模块的既有 editor.values；缺失配置显示未加载。无 DOM 注入、网络、副作用、动态 import/eval 或任意 slot。配置编辑器、存储键、默认值、实际值与保存流程保持；`/modules/ui` 仍只有元数据，componentKey 仅见于 builtin-react surface，无函数或路径。

## 外部隔离 WebUI（Phase 5）

外部自定义 HTML/React 仅能在显式授权的、不透明源 iframe 中执行。声明式配置编辑器继续由核心渲染，不经过 iframe。完整清单示例（`index.mjs` 可仅导出 `export function setup() {}`）：

```json
{
  "id": "isolated-demo",
  "entry": "index.mjs",
  "permissions": ["ui:sandbox"],
  "webui": {
    "version": 1,
    "sandbox": { "entry": "webui/index.html" },
    "requestedCapabilities": ["ui.sandbox"],
    "surfaces": [
      { "id": "panel", "hook": "module.panel", "renderer": "sandbox" }
    ]
  }
}
```

每模块最多一个 sandbox surface，只允许 module.panel 或 module.detail，均在核心「模块详情」内展示；不能含 componentKey。sandbox 必须同时声明 entry 和 requestedCapabilities，内置 sandbox、外部 builtin-react/componentKey 均拒绝。`ui:sandbox` 仅外部可声明，不暴露任何后端或宿主 API；缺少权限保留禁用说明。entry 最长 256 字符，必须是 `webui/` 下相对 `.html` 文件；路径段只允许 ASCII 字母数字、下划线、连字符及非首位点，最多 8 层公开路径，拒绝绝对路径、遍历、空段、反斜线、NUL、编码路径和点文件。

`webui/index.html` 可使用内联经典脚本，自带 React 须预先打成公开静态资源；不能引用宿主 React 或在线 CDN。以下最小消息桥示例只在收到 init 后应答，`textContent` 保证通知文本不作为 HTML 解析：

```html
<!doctype html>
<meta charset="utf-8">
<title>隔离示例</title>
<p id="status">等待核心初始化</p>
<script>
let bridge;
addEventListener('message', (event) => {
  const m = event.data;
  if (event.source !== parent || !m || m.version !== 1 || m.type !== 'init' ||
      typeof m.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(m.nonce)) return;
  bridge = { version: 1, nonce: m.nonce };
  document.getElementById('status').textContent = m.module.id;
  parent.postMessage({ ...bridge, type: 'ready' }, '*');
  parent.postMessage({ ...bridge, type: 'resize', height: 240 }, '*');
  parent.postMessage({ ...bridge, type: 'notify', text: '隔离界面已就绪' }, '*');
});
</script>
```

进入详情点击「启用隔离 WebUI」，确认外部脚本警告后，核心调用 `POST /onebot-qq/api/modules/ui/grant {id,enabled:true}`。授权原子保存到 `data/modules/state.json` 的 uiGrants（键为模块 id，值含 id/uiRevision/entry/artifactHash）；原 disabled/enabled 保持兼容，写入失败不改变授权。仅有效外部 sandbox 描述及 ui:sandbox 权限可授权/撤销。授权绑定规范化描述的 SHA-256、entry 和全部公开 UI 文件的路径/长度/内容 SHA-256；修改描述、入口或公开文件后原授权失效。每次 HTTP UI 目录读取及资源请求重新检查公开文件；检测变化或不可读后在内存中关闭 UI，需重载；若资源或描述绑定已变化，还需重新授权。无 import、配置读取或整个模块重新扫描。未声明 UI/未授权/无效资源显示固定原因，目录仅在有效授权时返回 `grantedCapabilities:['ui.sandbox']`。

「撤销」确认后删除授权、移除当前详情的 iframe，配置与后端运行不变；停用模块保留授权，只禁止 UI 资源服务。重载/重新激活以及授权修改使用新的 generation，旧 URL 404；停用保留 generation，但资源请求被拒绝。授权不会因普通重载而消失，但描述或资源哈希改变时必须重新确认。配置保存不改变 UI 修订或授权。其它已打开页面在刷新/离开时卸载旧 frame；已下载的脚本无法由服务器追溯擦除，撤销立即阻断后续资源请求。

资源唯一入口为 `GET/HEAD /onebot-qq/module-ui/<id>/<generation>/<公开路径>`，只能读取当前 loaded、enabled、有有效授权的外部模块 `webui/`。允许 `.html .js .css .png .jpg .jpeg .webp`，按扩展名固定 MIME，并发送 nosniff、no-store、no-referrer。拒绝目录列表、点文件、config/data 路径段、JSON/配置文件、source map、任何符号链接（含指向目录内的链接）、编码遍历与路径逃逸；realpath 必须包含于模块公开目录。最多 128 个公开文件、单文件 2 MiB、总计 8 MiB、256 个树节点；校验后直接发送同一份有界读取的字节。失败均为无路径 404，非 GET/HEAD 同样 404。宿主 REST API 拒绝 Origin:null 和浏览器 iframe/脚本/图片等子资源目的地，避免隔离页通过这些请求使用宿主端点；普通核心 fetch、same-origin 图片预览与非浏览器调用保持。

每个资源响应都强制以下 CSP（直接打开 HTML 也受 sandbox 约束）：

```text
sandbox allow-scripts; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'
```

iframe 固定 `sandbox="allow-scripts" referrerpolicy="no-referrer"`，无 allow-same-origin/forms/popups/top-navigation/downloads。父到 frame 的 v1 init 使用每次 load 新生成的 128-bit nonce，只含 id/generation/uiRevision 等非秘密元数据；不传配置、Cookie、全局 draft、宿主对象或调用函数。父只接受来自当前 contentWindow、origin:null、相同 nonce/version 的 ready/resize/notify，拒绝额外字段、未知类型和旧 frame；ready 限时 10 秒，resize 仅整数 120–1000 px，notify 为 1–200 UTF-16 字符的纯文本、拒绝控制字符、每次 load 最多 20 次，固定字段使有效消息小于 1 KiB。不支持配置保存、fetch 代理、命令或 DSH slots。重载/卸载清理监听器与计时器。

**威胁模型与限制**：假设外部 HTML/脚本不可信，依靠浏览器 sandbox/CSP 和窄消息桥隔离宿主 DOM、Cookie、配置与 API；不允许外部同源 React，不新增 DSH 注册。后端仍是操作员安装的同进程 Node.js，不能防御恶意后端、管理员修改状态文件、并发恶意文件系统替换、浏览器漏洞或 iframe CPU/内存耗尽。公开目录只放适合展示的非秘密资源，不提供网络、持久化存储、worker、表单或下载能力。自身 frame 导航不是完整的网络隔离；不把这些约束描述成操作系统或网络沙箱。严格 CSP 下的 opaque-origin 外链脚本/ES module、字体等可能被浏览器阻止，建议内联经典脚本或自包含 bundle，不为兼容而放宽 connect-src 或 sandbox。Node 单测覆盖服务端头与客户端契约，**真实浏览器 sandbox/CSP/资源加载尚未验证**；本阶段无浏览器自动化、推送、部署、版本、tag 或发布。

## 历史边界（Phase 14，媒体功能后续见 ADR-015）

Phase 14 架构程序以四个既有内置模块收束：reply delivery、typing、reminders 默认启用，sample 默认关闭。外部模块不能获得 provider/服务所有权、交付规划、turn 生命周期、输入状态写入、scheduler、persona store、提醒仓库、旧配置、受保护命令覆盖或内部 delivery/access 端口；来源由加载器赋值，清单 source/builtin 无法授权。部分权限声明在导入前拒绝，其余在注册/调用时拒绝或不暴露属性；单独声明不会赋予能力，普通外部 API 保持。11 项权限的双组拒绝矩阵、提醒人格隔离/安全错误和单所有者交接证据见 [最终验收](architecture/MODULE-ACCEPTANCE.md)。

媒体传输、存储、provider/HTTP 与文件约束明确保留核心，本程序不提取 builtin-media 服务，无数据迁移。未来可选 builtin-media 仅限功能策略/命令，并须先建立宿主持有的窄 media port；外部模块不获得媒体资源、原始服务或路由注册入口，详见 [ADR-013](architecture/ADR-013-media-boundary.md)。本阶段只做离线测试/文档/包检查，无生产行为、配置/UI/依赖或版本变化，无 live/浏览器验收；推送、部署和发布另行授权。

## 安装与清单

把完整外部模块目录复制到 `<数据目录>/modules/<id>/`，然后重启插件，或调用重载 API 并指定 id。已发现的模块可以在面板「模块」页重载；面板刷新只读取当前目录列表，不重新扫描文件系统。仓库的 `examples/modules/echo/` 是最小示例，但示例目录本身不会被自动加载。

每个外部模块必须有 `module.json`；内置清单来自静态注册表，不读取清单文件：

```json
{
  "id": "echo",
  "name": "Echo",
  "version": "1.0.0",
  "description": "回显命令示例",
  "entry": "index.js",
  "apiVersion": 1,
  "requires": [],
  "permissions": ["commands", "events", "storage"],
  "enabled": true
}
```

- `id` 必填，匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`，外部需与目录名一致。
- `entry` 必填，只能是模块目录内的相对 `.js` 或 `.mjs` 文件；路径遍历和符号链接逃逸会被拒绝。
- `name`、`version`、`description` 可选。
- `permissions` 是权限字符串数组，默认空数组；未知权限会令模块进入 error。
- `apiVersion` 可选，默认 `1`，目前只支持数字 `1`。
- `requires` 可选，默认 `[]`，最多 16 个有效模块 ID；不能重复或依赖自身。可跨内置/外部来源依赖，只表示本机模块依赖，不解析版本或下载依赖。
- 外部 `enabled` 默认 `true`；`false` 是硬上限，面板/API 不能覆盖，`canToggle=false`。操作员必须编辑清单并重载。
- `source`、`builtin`、`canReload`、`canToggle` 是加载器输出，清单中的同名值无效。

## 内置示例与状态

随包提供 `builtin-sample`（内置示例，1.0.0），`permissions: ["commands","storage"]`、`requires: []`。默认关闭且不调用 import/setup，没有默认消息行为。启用后仅主人可用 `/module-sample`，读取 `api.config.get().message` 回复，默认「内置示例模块已启用。」；示例申请 storage 权限，但不主动写入 data.json。内置模块不能直接重载；依赖协调可以用缓存代码重新运行 setup，生命周期内不再次调用 lazy import。

另外随包提供默认启用的 `builtin-reply-delivery`（回复交付，1.0.0），仅申请 `delivery:plan`，没有模块配置 schema、`api.config` 或面板「配置」按钮。它通过核心传入的 `replyCfg` 读取现有 `cognition.reply.*`，保留分条、首条引用、群聊 @、条间等待与末条合并余文。

默认启用的 `builtin-typing`（私聊输入状态，1.0.0）仅申请 `turn:lifecycle`、`status:write`，没有模块配置 schema、`api.config` 或面板「配置」按钮。行为仍由默认关闭的 `cognition.typing.enabled` 控制，沿用原全局设置 UI/路径/规范化。Phase 13 时 `/modules` 有四个内置模块：提醒、私聊输入状态和回复交付 loaded，示例 disabled；模块启用不等于 typing 开启。

`<数据目录>/modules/state.json` 的原子持久化格式：

```json
{ "disabled": ["echo"], "enabled": ["builtin-sample"], "uiGrants": {} }
```

uiGrants 为独立 UI 授权，详见下文；启停写入保留授权。兼容旧的 `{disabled}`，文件缺失或损坏按空状态处理。外部有效状态为 `manifestEnabled && !disabled.has(id)`，enabled 列表不能越过清单上限。内置先看 disabled（关闭），再看 enabled（开启），否则使用静态描述符的 defaultEnabled。启停操作先成功持久化新状态，再变更内存与运行资源；写入失败返回安全错误，原运行状态保持。此状态在重启后保留。

## 入口导出

入口导出异步或同步的 `setup(api)`，可以是 named export 或 default export。`.mjs` 始终按 ESM 加载；`.js` 遵循 Node.js 最近的 `package.json` `type` 规则（数据目录中通常是 CommonJS，可用 `exports.setup = ...`）。`setup` 可返回 cleanup 函数：

```js
export async function setup(api) {
  const off = api.on('message', (event) => api.log.debug('message', event.message?.text))
  return () => off()
}
```

## 权限与 API

所有模块始终可读 `api.id`、`api.name`、`api.version`、`api.dir`、只读 `api.source`（builtin/external）、`api.builtin`、只读 `api.permissions` 和模块子 logger `api.log`。缺少权限时调用对应 API 会抛出明确错误；若发生在 setup，模块会进入 error，不会拖垮宿主。`scheduler`、`persona:store`、`reminders:service`、`proactivity:service` 和 `config:read` 采用按来源和权限条件暴露属性的方式，未授权时整个属性不存在。

| 权限 | API | 行为 |
|---|---|---|
| `events` | `api.on(name, handler)` | 监听 `message`、`notice`、`request`、`meta_event` 或 `any`；收到规范化事件记录 |
| `commands` | `api.registerCommand(name, handler, { ownerOnly=true, overrideBuiltin=false })` | 注册 `/name`，返回生命周期 disposer；handler 收到 `{turn, parsed, args}`，返回字符串或 `{reply}`；默认拒绝受保护命令，始终拒绝已有模块注册 |
| `commands:override` | 同上，显式 `overrideBuiltin:true` | 额外要求 `commands`；仅加载器认定的内置模块可以覆盖核心受保护命令；外部或缺权限调用抛错，setup 中调用则进入 error |
| `send:text` | `api.sendText({chatType, chatId, text})` | 通过 DeliveryService → executor → outbound 以 `source: module:<id>` 单条发送，仍受访问控制、频率限制和 leak guard 约束 |
| `cognition:read` | `api.cognition` | 只读暴露 `snapshot`、`overview`、`memories`、`personDetail`、`relationshipsList`、`timeline` |
| `knowledge` | `api.registerKnowledgeSource(source)` | 注册认知知识源，重载/停用时自动移除 |
| `capabilities` | `api.registerCapability(name, impl)` | 注册认知 capability，重载/停用时自动移除 |
| `access:check` | `api.access.canSend({chatType,chatId})` | 仅内置模块，使用宿主既有 access，返回 `{allowed}`；服务缺失/异常时拒绝；外部声明即拒绝 |
| `delivery:send` | `api.delivery.send({chatType,chatId,text,source?})` | 仅内置模块，一条原文 text part 经 DeliveryService；source 默认 module:<id>，只有 builtin-reminders 可使用 reminder；外部声明即拒绝 |
| `delivery:plan` | `api.delivery.registerPlanner(descriptor)` | 仅内置模块；注册唯一 format 规划器，返回生命周期 disposer；外部或缺权限调用抛错 |
| `turn:lifecycle` | `api.turn.register({id,onStart,onEnd})` | 仅内置模块；注册顺序开始、逆序结束，返回生命周期 disposer；外部、缺权限或已停止调用抛错 |
| `status:write` | `api.status.setInputStatus(userId,eventType)` | 仅内置且运行中的模块；仅转交注入的 `gateway.actions.setInputStatus(String(userId),eventType)`，保留网关校验、结果与异常 |
| `scheduler` | `api.scheduler.setTimeout(fn, delayMs)` / `clearTimeout(id)` | 仅向声明权限的内置模块暴露；一次性、当前 runtime 范围内的定时器，返回 `{id,dispose}` |
| `persona:store` | `api.personaStore` | 仅内置模块；同步 `get/put/remove/list/count`，当前人格与模块命名空间隔离；外部清单声明即拒绝 |
| `reminders:service` | `api.reminderRepository` | 仅内置模块；同步访问当前人格核心 reminder 行；外部清单声明即拒绝 |
| `config:read` | `api.legacyConfig.section(path)` | builtin-learning 只读 cognition.learning 16 字段，builtin-proactivity 只读 cognition.proactivity 七字段，其余内置只读 cognition.reminders 五字段；外部清单拒绝 |
| `learning:service` | `api.learning` | 仅 builtin-learning；有界任务/来源/证据/claim 引用和一次 attempt lease，见 ADR-017 |
| `proactivity:service` | `api.proactivity` | 仅 builtin-proactivity；固定人格 run token、私聊投影、固定模型调用和一次交付 |
| `providers:register` | `api.providers.register(name, provider)` | 仅内置且运行中的模块；固定白名单 reminders、mediaFeatures、proactivity，返回生命周期 disposer；外部或缺权限调用抛错 |
| `storage` | `api.storage` | `get(key,fallback)`、`set(key,value)`、`delete(key)`、`all()`；均为异步 |

外部存储写入模块目录的 `data.json`；内置存储写入 `<数据目录>/modules/.builtin/<id>/data.json`，从不写包内源码。两者都校验目录与文件的 realpath 包含关系，写操作串行且使用原子替换，序列化后最多 1 MiB。模块应 `await` 所有存储写入。备份包含 modules/state.json 与 .builtin 数据；恢复后应重启插件。

生产 host 向模块内核注入 `cognition.services.delivery`，`api.sendText` 将文本交给单条 DeliveryPlan 执行，不拆分、不添加引用/@、不等待。权限、输入修整和返回语义保持，结果保留 outbound 字段并补充 `parts:1`。旧 harness 未注入 delivery 时仍可使用 outbound；DeliveryService 本身缺少 outbound 则安全失败，不直连 gateway，也不对拒绝回退或重试。面板人工 `/send` 保留独立 gateway 路径，媒体/文件保持原路径，提醒从 Phase 13 起使用独立 delivery.send 窄入口，详见 [ADR-004](architecture/ADR-004-unified-egress.md)。

## Provider 与提醒所有权（Phase 13）

`api.providers.register('reminders', provider)` 要求 `providers:register` 权限和加载器确认的 builtin 来源。provider 是带 start/stop 函数的对象，可选 status 函数。名称白名单为 reminders、mediaFeatures、proactivity，后两者固定模块 ID；同名/同 moduleId 重复拒绝，无覆盖栈；内核填写身份，外部不能注册。注册只登记对象；幂等 disposer 绑定注册身份，停止、失败、依赖清理和 dispose 自动注销。模块拿不到注册表或其它 provider。

内部注册表新增 `subscribe(listener)` → disposer。每次成功添加/移除通知冻结的 `{name,moduleId}`，不含 source/provider/错误详情；同步异常与异步拒绝逐监听器隔离，未知 remove/重复 disposer 不通知。

宿主等待 modulesReady 后，通过串行 `syncReminderOwnership()` 以及注册表订阅协调运行期变化。有 provider 时先 await 核心 stopReminders，再 await provider.start；没有时先 await 旧 provider.stop，再 startReminders。启动失败先停止可能已分配资源的 provider，回退核心；同一次注册失败不会因重复协调无限重启，重新注册可再尝试。等待期间注册变化会重新读取当前选择，避免迟到启动取得所有权。核心 start/stop 均幂等，空注册表的安装仍只启动一次核心；独立 cognition 调用者需要显式启动提醒。

默认启用的 `builtin-reminders` 无模块配置 schema，申请 providers:register、scheduler、reminders:service、config:read、commands、commands:override、access:check、delivery:send，声明提供 reminders。它覆盖 `/remind`、`/reminders`、`/forgetreminder`，沿用核心命令的解析、文案、错误映射、ownerOnly、deniedCommands 与 command 回复交付；副作用前另调用 api.access.canSend。覆盖不在 `/help` 重复列为模块命令。停用注销覆盖，下一条命令回到核心，启用恢复覆盖。业务开关仍是默认 false 的 cognition.reminders.enabled；模块 loaded 不表示提醒功能开启。

模块和核心回退共用 `src/reminders/service.js` 的业务规则及 `commands.js` 的纯命令解析/文案。模块仅通过 reminderRepository 操作原人格 reminder 数据；发送一条固定 text，经 api.delivery.send → DeliveryService → outbound 的 access/rate/leak/dryRun，source 为 reminder。无直接网关、媒体、LLM 或独立提醒存储。最早到期最多 20 条，单一自调度 timeout，不重叠，完成时刻推进重复时间，失败安全错误/延迟，dry-run 计成功。

正常停用/依赖重载时，内核先调用 provider.stop 等待在途发送写回，再撤销 API/注销 provider；核心 stop 同样等待在途发送，交接完成前不启动新调度器。stop 同步清 timer、阻止下一条发送与旧回调重排，返回排空 Promise，可重新 start。最终卸载可传内部 `{dispose:true}`，内置实现立即封闭写回，宿主同步 dispose 不等待网络；迟到 start 完成后再 stop，关闭数据库后不写回。第三方内置 provider 的正确停止仍依赖其实现，停止异常仅固定日志尽力清理，不能证明错误 provider 无遗留资源。

同一进程内交接避免双调度器；不提供跨进程 exactly-once、外部网关幂等或崩溃恢复保证。正常交接等待当前发送，耗时取决于已有发送超时。无数据迁移、配置/UI/REST/依赖/版本变化。详见 [ADR-012](architecture/ADR-012-builtin-reminders.md)。

## 内置模块受保护命令覆盖（Phase 10）

Phase 10 建立此覆盖契约；Phase 13 的 builtin-reminders 已使用它接管提醒命令。没有新配置、UI、REST、依赖或版本变化。

```js
// 仅测试内置描述符：manifest.permissions: ['commands', 'commands:override']
export function setup(api) {
  const off = api.registerCommand('status', ({ args }) => `模块状态：${args}`, {
    overrideBuiltin: true,
    ownerOnly: true,
  })
  // off() 可提前注销；内核也会自动清理，无需模块返回 off。
}
```

`overrideBuiltin` 只有严格的 boolean true 才开启覆盖。模块必须来自受信任的静态内置 registry，并同时声明 `commands` 与 `commands:override`；外部即使声明新权限或伪造 source/builtin 也无法覆盖，调用在 setup 中抛错会令模块进入 error。单独声明权限不会改变默认注册行为；外部声明该权限仍可正常注册普通命令，但不能使用覆盖选项。permissions 只约束稳定 API，不是 Node.js 沙箱。

核心 `commands.registerCommand(name, handler, {ownerOnly=true,allowProtected=false})` 仅在 `allowProtected === true` 时允许受保护名称；这个内部选项不直接暴露给模块，内核验证来源/权限后才传入。名称继续小写规范化并验证；每个名称最多一个模块注册项，不允许覆盖另一个覆盖项或普通模块命令，无栈或优先级配置。

分发在核心分支前查找模块注册项，因此有效覆盖只执行模块 handler，不执行核心 handler。沿用默认 ownerOnly（操作员的核心只读权限不会绕过它）；显式 ownerOnly:false 才可向其他用户开放。覆盖仍先检查 `cognition.permissions.deniedCommands`（主人固定提示、其他人静默），并在调用 handler 前检查当前会话 canSend；访问服务缺失、抛错或拒绝都不会执行 handler。回复仍走 source:command 的 DeliveryService → executor → outbound，保留访问控制、限频和 leak guard。

返回的 disposer 幂等且只移除它自己的注册，不会删除后续同名注册。内核保存到当前 runtime.disposers，停用、setup 失败、事件隔离、依赖禁用/重载和内核 dispose 时自动注销；旧 runtime 不能再次注册。没有覆盖时，下一次命令直接回到原核心分支，核心配置开关和既有安全规则继续生效。已开始的异步 handler 不强制取消；handler 抛错或回复被拒绝时沿用模块命令失败路径，不重试、不执行核心 fallback，避免重复副作用。

未来迁移可由内置模块在 setup 中取得名称、在停用时释放名称，核心实现暂留作无注册时的回退。本阶段核心提醒/媒体实现和生产 registry 均保持原样，不提供提醒迁移、定时投递或持久化恢复。详见 [ADR-009](architecture/ADR-009-command-override.md)。

## 回复交付规划（Phase 4）

`delivery:plan` 是已知权限，但稳定 API 仅允许加载器标记为 builtin 的模块注册。外部模块即使声明该权限或在 manifest 伪造 source/builtin，调用也会抛错；setup 中调用则进入 error。权限不是 Node.js 沙箱。

```js
api.delivery.registerPlanner({
  id: 'builtin-reply-delivery', stage: 'format', order: 0,
  plan({ text, turn, replyCfg, replyTo, source, decisionId }) {
    // 同步返回 DeliveryPlan，核心负责校验和执行。
  },
})
```

内部 `createDeliveryRegistry()` 提供 register/resolve/remove/list；描述符 id 必须非空且唯一，stage 仅允许 format，最多一个注册项，order 为有限数（省略为 0）。当前没有多阶段排序或外部规划器。register 返回幂等 disposer，内核保存并在停用、dispose、setup 失败、事件隔离或依赖重载清理时移除；已停止的 API 不能重新注册。内置模块本身不直接重载，依赖重载会清理后用缓存代码重新 setup。

核心只传入 `{text,turn,replyCfg,replyTo,source,decisionId}`；replyCfg 是现有 `cognition.reply` 的副本，noReplySegment 已映射为 quote:false，不提供全局配置访问。规划器不发送消息，返回 Phase 1 DeliveryPlan（target、parts 中的 segments/delayAfterMs、source、decisionId、meta），所有发送仍经过 executor 和 outbound 的访问控制、频率上限及 leak guard。

内部开关 `cognition.delivery.engine` 接受 auto/core/planner，默认 auto，不增加全局配置 UI 字段：

| engine | 有 format planner | 无 planner（含模块停用/初始化失败） |
|---|---|---|
| auto | 使用模块规划 | 使用 core 兼容布局，保留分条/引用/@/等待 |
| core | 始终使用 core 兼容布局 | 同左 |
| planner | 使用模块规划 | 单条纯文本回退 |

已选中的规划器抛错或返回无效计划时也回退为单条纯文本（无引用/@/等待），仅记录固定安全警告；回退仍过 outbound，不重试发送拒绝。空正文、纯空白处理、dryRun、部分成功、统计与归因保持既有语义。配置不迁移，不新增模块配置文件；停用后下一次发送重新解析 registry。详见 [ADR-003](architecture/ADR-003-reply-delivery-module.md)。

## 轮次生命周期与私聊输入状态（Phase 6）

宿主创建核心 `createTurnHooks({logger})` 并同时注入 cognition/pipeline 和模块内核。注册仅通过内核的 builtin API 开放，外部即使声明新权限或伪造 source/builtin 也被拒绝。这些权限不是进程沙箱。

```js
api.turn.register({
  id: 'builtin-typing',
  async onStart({ turn, settings }) {
    if (settings.typingEnabled !== true || turn?.chatType !== 'private') return
    try { await api.status.setInputStatus(String(turn.chatId), 1) } catch {}
  },
  async onEnd({ turn, settings }) {
    if (settings.typingEnabled !== true || turn?.chatType !== 'private') return
    try { await api.status.setInputStatus(String(turn.chatId), 2) } catch {}
  },
})
```

核心 registry 只有 `register/start/end/list`：id 必须非空且唯一，至少一个 handler，提供的 handler 必须为函数；disposer 幂等。start 按注册顺序串行等待，end 逆序串行等待，每个同步/异步错误独立捕获，仅记录固定安全文案，不记录聊天 ID、描述符或原始网关异常，也不改变处理结果或异常。

pipeline 仅传入 `{turn,settings:{typingEnabled:cfg().typing?.enabled===true}}`，不暴露全局配置或 gateway；先 await start，再 await processTurn，finally await end（含命令提前返回和处理失败）。私聊/config 判断属于模块。typing 尽力提示，不影响回复；群聊不调用状态动作；status API 不提供通用 action 或其它 gateway 回退，也不自行记录异常。

注册项与模块命令/监听器一样，在停用、setup 失败、依赖清理或 dispose 时注销；停用后即使全局 typing 配置开启也不提示，不走旧内联回退。已经开始的异步 handler 不强制取消。仅旧 harness/调用者未注入 `turnHooks`（null）时保留原 pipeline 内联 typing；注入空 registry 也不会触发旧路径。详见 [ADR-005](architecture/ADR-005-typing-module.md)。

## 内置模块生命周期调度器（Phase 8）

`scheduler` 是已知权限；仅加载器认定为 builtin 且声明该权限的模块获得只读 `api.scheduler`。缺权限的内置模块和所有外部模块都没有这个属性；外部即使声明权限或伪造 source/builtin 也不能访问。此限制只针对稳定 API，permissions 不是 Node.js 沙箱。

```js
// 内置描述符 manifest.permissions 包含 'scheduler'，在 setup(api) 内使用：
const timer = api.scheduler.setTimeout(async () => {
  // 模块自己的工作；回调不接收上下文或聊天数据。
}, 1000)
api.scheduler.clearTimeout(timer.id) // 存在时取消并返回 true，否则 false
timer.dispose() // 同一取消操作，幂等；已取消/触发/停止后返回 false
```

- `setTimeout(fn, delayMs)` 同步返回冻结的 `{id,dispose}`；fn 必须为函数，delayMs 必须为数字整数，范围 **0–2,592,000,000 ms（含两端，30 天）**，不做类型转换。0 也异步执行；定时器只保证不早于截止时间，事件循环繁忙时可以延迟。
- 每个模块当前 runtime 最多 **64** 个活跃定时器；非法参数、超限或已停止 runtime 的注册同步抛错。回调开始前即移除注册、释放额度；已经开始但尚未完成的异步回调不占定时器额度。
- id 是随机生成的不透明字符串，仅在创建它的模块/runtime 内有效，不是 Node 原生 timer handle，也不包含网关/用户/聊天 ID。把另一模块或旧 runtime 的 id 传给 clearTimeout 返回 false。dispose 与 clearTimeout 在停止后仍可调用并返回 false。
- 定时器保存在 runtime Map 中，通过全局 setTimeout/clearTimeout 调度。超过 Node 单次安全上限（2,147,483,647 ms）时，按 performance.now() 单调截止时间分段等待，避免 30 天延迟溢出为 1 ms。
- 停用、setup 失败、事件错误隔离、依赖重载/禁用和内核 dispose 都先标记 runtime 无效并清空原生 timer 与注册，再执行模块 cleanup。回调同时检查当前 runtime 身份和注册仍存在；已取消或旧 generation 的迟到回调不会执行用户函数，也不会重新调度。内置仍不能直接 reload，依赖重载后的 setup 创建新 runtime。
- 同步抛错与异步拒绝都独立捕获，仅记录固定文案及模块 ID，不读取/输出异常、stack、聊天 ID 或 payload；logger 失败也隔离，不把模块置为 error。已开始的异步回调不会被强制取消或在停用时等待，模块须自行管理在途工作；停止后不能用旧 scheduler 注册新任务。

本阶段只建立未来提醒/媒体工作的前置 API 契约，**不提取或迁移现有提醒/媒体功能**；没有 interval、cron、持久化、重启恢复、重试、发送保证或新增内置模块，Phase 13 已用此调度器运行 builtin-reminders，生产目录共四个内置模块。没有新增配置、REST 或面板入口。详见 [ADR-007](architecture/ADR-007-module-scheduler.md)。

## 内置模块人格作用域仓库（Phase 9）

仅加载器认定为 builtin 且声明 `persona:store` 的模块获得冻结的 `api.personaStore`。缺权限时整个属性不存在；外部清单声明此权限会在导入前被拒绝，伪造 source/builtin 无效。permissions 约束稳定 API，不是同进程 Node.js 沙箱。

所有方法均为**同步**，沿用认知 store 的同步事务；不需要 await。key 严格匹配 `^[a-z0-9][a-z0-9_-]{0,63}$`（1–64 位，不转换类型），不能传原始 kind、路径、模块或人格标识。方法参数数量严格校验；put 没有 options，list 仅接受 limit，不接受 personaId/kind/where/offset 等其它选项。

| 方法 | 返回与行为 |
|---|---|
| `get(key)` | 值的 structuredClone；不存在返回 null，已存 null 也返回 null，可用 list/count 区分 |
| `put(key, value)` | 新建或完整覆盖，返回保存值的 structuredClone；无 merge、TTL 或时间戳选项 |
| `remove(key)` | 存在并删除返回 true，不存在返回 false |
| `list({limit} = {})` | 返回 `{key,value}[]`；最新创建优先，同时间顺序未定义，覆盖不改变创建时间；默认 100，limit 必须是 1–1000 的整数 |
| `count()` | 当前模块在当前人格的记录数 |

```js
// 仅测试描述符使用新权限；生产 registry 不新增模块。
// manifest.permissions: ['persona:store']
api.personaStore.put('draft_1', { text: '本地模块状态', flags: [true, null] })
const draft = api.personaStore.get('draft_1')
const items = api.personaStore.list({ limit: 20 })
const total = api.personaStore.count()
api.personaStore.remove('draft_1')
```

- 值限于可 structuredClone 的 JSON 值：null、boolean、字符串、有限数字、稠密数组及普通对象；按 JSON 持久化语义保存。拒绝 undefined、函数、Symbol、BigInt、非有限数字、循环引用、稀疏数组、Date/Map/Set/二进制视图等非 JSON 值。写入与读取（含 put 返回值、list 内嵌值）都复制，调用者修改不改变保存值。
- 每条值经 JSON.stringify 后 UTF-8 最多 **65,536 bytes（64 KiB，含 JSON 引号/转义）**；不含内部 key/元数据开销。每模块每人格最多 **1000 条**；同步事务中检查额度，满额可覆盖已有 key，remove 后释放额度。非法/超限同步抛错，旧值保持。底层故障只给固定错误，不回显数据库路径、SQL 或 payload。
- 宿主将 `cognition.services.personaStore`（现有 persona-scoped store）注入内核的 personaStore 选项。内部固定集合 `module_store` 使用 `module:<moduleId>:<key>` 记录 ID，再由既有 facade 添加 `persona_<id>:` kind 前缀；分隔符不能出现在模块 ID/key，模块前缀不会互相覆盖，也不会碰触核心 kinds。API 不暴露底层 store、SQL、路径、原始 kind 或当前人格 ID。
- 每次同步调用使用**当时的当前人格**；切换人格后同一 API 只访问新人格。没有跨人格参数或绑定原人格的句柄；未来异步提醒的归属与恢复须另行设计。
- API 属于当前 setup runtime；停用、setup/事件失败、依赖重载/禁用、dispose 后所有旧方法均拒绝调用，cleanup 中也不可读写。已提交数据保留，重新启用/重新 setup/重启后可读取；停用不删除数据。人格删除通过既有 dropPersonaData 清理该人格所有模块记录。模块记录不加入人格复制/统计数据组，无新 UI。

这不是通用数据库，也不是提醒功能；只提供未来提醒迁移的前置仓库契约。持久化完全复用认知 SQLite/JSON fallback、事务与备份目录，没有独立文件、数据库或调度/发送/重试/恢复逻辑。现有异步 `api.storage` 的模块级 data.json 契约保持；本阶段不提取提醒或媒体，不新增生产内置模块、依赖、配置、REST、面板或版本。详见 [ADR-008](architecture/ADR-008-module-persona-store.md)。

## 提醒仓库与只读旧配置（Phase 12）

仅加载器确认 builtin 且声明 `reminders:service` 的模块得到冻结的 `api.reminderRepository`；`config:read` 独立控制冻结的 `api.legacyConfig`。缺权限时对应属性不存在，外部清单声明任一权限在导入前拒绝，伪造 source/builtin 无效。权限约束稳定 API，不是 Node.js 沙箱。

提醒仓库由内核复用宿主已注入的 `cognition.services.personaStore`，通过其同步方法固定访问核心 `reminder` kind；Phase 13 的 capture 在端口内部绑定当前 scope，不向模块暴露底层 facade。没有原始 base store、SQL、路径、kind 或可指定的人格参数。所有方法检查参数数量；list 仅接受 status/limit，行和 patch 拒绝未知字段（包括 kind/personaId/path）。无 store 时所有方法报服务不可用，底层错误不回显原始路径、SQL 或正文。

| 方法 | 返回与限制 |
|---|---|
| `all(status='active')` | 指定状态的全部提醒（扫描上限 100 万），供防重/额度和过滤当前聊天后限量；不接受 predicate/kind/persona |
| `capture()` | 返回固定调用时人格的冻结仓库与 isCurrent()；同一 runtime 撤销规则，无人格标识或跨人格参数 |
| `get(id)` | 核心业务行的深拷贝，不存在返回 null |
| `list({status='active',limit=50}={})` | 当前人格指定状态的行；limit 为 1–50 整数，最新创建优先，同创建时间顺序未定义 |
| `findDue(now,limit=20)` | active 且 nextAt ≤ now；先按 nextAt 升序、同时间按 id 排序，再截取；limit 为 1–20 整数 |
| `countActive()` | 当前人格所有 active 行数，不受列表返回上限影响 |
| `put(row)` | 验证完整行后新建/完整覆盖；返回深拷贝，覆盖保留核心 store 的首次创建时间 |
| `update(id,patch)` | 仅合并 status/nextAt/sentCount/lastError；同步事务内读取现行行，不存在返回 null，不会重新创建；返回深拷贝 |
| `remove(id)` | 同步事务中删除，存在返回 true，不存在返回 false |

行只包含 `id/scopeType/scopeId/text/at/everySeconds/nextAt/status/createdBy/createdAt/sentCount/lastError`，不返回 kind/updatedAt。ID 严格为 `^rem_[0-9a-f]{24}$`，与核心生成格式一致；status 只接受 active/sent/cancelled。scopeType 为 private/group，scopeId/createdBy 为无前导零的正安全整数字符串；text 非空且最多 500 Unicode 字符。at 与 everySeconds 恰好一个非 null；重复间隔为 60–2592000 整数秒。at（非 null）、nextAt、createdAt 和 findDue 的 now 必须是非负、有限、有效 Date 范围的毫秒数字，不强制未来时间。sentCount 为非负安全整数；lastError 仅允许空串或 ACCESS_DENIED/RATE_LIMITED/LEAK_BLOCKED/GATEWAY_UNAVAILABLE/SEND_FAILED。输入与所有行输出复制，调用方修改不会影响存储。

put 是创建/完整替换入口，update 刻意只提供取消和投递结果所需字段，remove 用于显式删除；没有批量操作、任意 predicate/事务回调或通用数据库入口。业务开关、主人校验、防重、maxActive 和配置中的间隔策略仍由提醒服务负责，仓库不调度/发送或调用 LLM。findDue 目前在进程内读取当前人格全部到期候选后排序，返回上限不是扫描上限。

每次同步调用访问**调用当时的当前人格**；人格切换后同一主端口访问新人格。Phase 13 增加 capture()：仅内部捕获调用时的作用域，返回相同固定 reminder 方法与 isCurrent()，不暴露人格标识，也不能指定其它人格；tick 的等待后写回原人格，检测切换后停止处理剩余候选。两种 API 均绑定 setup runtime；停用、setup/事件失败、依赖禁用/重载及 dispose 撤销旧方法，cleanup 中也不能调用。提交数据和已返回快照保留。

`api.legacyConfig.section(path)` 对提醒内置只接受单个严格等于 `cognition.reminders` 的字符串（builtin-learning 仅接受 cognition.learning 16 字段，见 ADR-017；builtin-proactivity 仅接受 cognition.proactivity 七字段，见 ADR-016），每次调用重新获取当前配置并复用核心 normalizeConfig，只返回 enabled/maxActive/minIntervalSeconds/maxIntervalSeconds/tickMs 五个字段的深拷贝。拒绝父路径、子路径、其它路径和额外参数；未知字段、秘密和其它配置不会出现在结果。缺少配置使用现有默认值；没有写入、onChange 或订阅，已返回快照不会自动更新；不影响独立的 api.config 声明式模块配置。

数据继续留在核心人格作用域的 reminder kind，使用现有 SQLite/JSON、备份及人格复制/删除/统计语义，无迁移、无 module_store 副本。Phase 13 的 builtin-reminders 已使用此端口接管调度与命令，核心保留兼容回退；仓库读写前后快照比较防止取消、删除或替换被旧发送结果覆盖。本阶段无配置字段/UI/REST/依赖或版本变化。详见 [ADR-011](architecture/ADR-011-reminder-repository.md)。

## 模块声明式配置（内核 Phase 3 / WebUI Phase 4）

内置 registry 描述符和外部 `module.json` 顶层均可声明可选的 `config` schema，共用 `validateConfigSchema`。原始及归一化 schema 的紧凑 JSON UTF-8 大小均最多 64 KiB，超限或无效的外部 schema 使整个模块清单无效，在导入入口前拒绝。加载器只提取已知清单字段，不透传任意属性；未声明配置的模块没有配置 API 或运行时 `api.config`。面板编辑还需有效的 webui opt-in，见下方完整示例。不接受 `secret`，配置字段只适合非秘密值；不把令牌或密码放入配置。

```js
config: {
  version: 1,
  fields: [
    { path: 'message', type: 'text', label: '示例回复', default: '内置示例模块已启用。', maxChars: 200, help: '主人使用 /module-sample 时发送的回复。' },
  ],
}
```

`version` 目前只支持数字 1。最多 32 个字段；`path` 必须唯一并匹配平面键 `^[a-z][a-zA-Z0-9_]{0,63}$`，不能用点路径；`label` 必须是非空字符串。支持可选 `help`、`placeholder`、`unit` 文本元数据，数字可带正数 `step` 供控件显示。所有默认值也经过完整类型与边界校验。

| 类型 | 服务端验证 | 省略 default 时 |
|---|---|---|
| `switch` | 严格 boolean | `false` |
| `text` / `textarea` | 字符串，Unicode 码点数 ≤ maxChars | `""` |
| `number` | 有限数字，可选 min/max（含边界） | `0` |
| `select` | 值属于 options；1–100 项 `{value,label?}`，value 为唯一字符串 | 第一项 value |
| `string-list` | 字符串数组，每项受 maxChars 限制，长度受 minItems/maxItems 限制 | `[]` |
| `number-list` | 有限数字数组，每项受 min/max 限制，长度受 minItems/maxItems 限制 | `[]` |

字符串 `maxChars` 默认 2000，可设 0–65536；列表 `minItems` 默认 0、`maxItems` 默认 100，可设 0–1000 且 minItems ≤ maxItems。类型默认值若不符合字段边界，描述符无效，需显式提供合法 default（例如 min 为 1 的 number）。更新的 `values` 必须是对象，拒绝未知键、类型转换及非法值；缺失字段填 schema 默认值，属于完整替换而不是合并旧值。

内核在启动发现模块及外部重载时加载并验证配置，因此关闭时也可以读取/保存，且 `setup(api)` 一开始就能读到有效值；不会为此导入默认关闭模块的代码。内置文件为 `<数据目录>/modules/.builtin/<id>/config.json`，外部文件为已验证的 `<数据目录>/modules/<id>/config.json`，与模块 `data.json` 分离，从不写包内源码：

```json
{ "version": 1, "revision": 1, "values": { "message": "新的示例回复" } }
```

文件最多 64 KiB（包括 version/revision 和格式化 JSON），校验目录及文件 realpath 包含关系，外部配置额外拒绝符号链接目录/文件（包括内部和悬空链接）及目录被链接替换；在同目录写临时文件后原子替换，失败清理临时文件，保留当前内存值。缺失、损坏、超限或无法读取时使用全部默认值、revision 0，并通过安全日志和模块记录的 `configWarning` 提示，不因配置文件故障阻止 setup。回退不会自动改写文件，成功保存后清除警告。磁盘有效配置在重启时恢复；不监视手动文件修改，不提供 schema 迁移。

声明了有效配置的内置和外部模块获得只读的 `api.config` 对象，无需另增 permission；只暴露本模块值，不授予内置 `config:read` / `legacyConfig`、`persona:store`、provider 或其它特权：

- `api.config.get()` 同步返回当前已校验值的深拷贝，调用者修改不会影响内核。
- `api.config.onChange(handler)` 注册监听，返回幂等 disposer。保存成功后传入新值的独立深拷贝；同步/异步 handler 错误仅安全记录，不让模块进入 error。通知不等待异步 handler，避免 handler 调用生命周期操作时互锁。
- 监听属于当前 setup 生命周期，停用、依赖重载引发的重新 setup、失败清理及 dispose 都会自动注销；已开始的异步 handler 不会被强制取消。

内核 `getModuleConfig(id)` 返回 `{id,source,schema,values,revision}` 深拷贝，source 按真实来源为 builtin 或 external；`setModuleConfig(id,values,revision)` 与启停/重载/dispose 串行。POST 必须携带 GET 返回的非负整数 revision，过期返回 `MODULE_CONFIG_CONFLICT`；成功持久化后 revision 加 1、再更新内存和通知监听器，首次写入为 1。未知模块及无有效配置 schema 的模块统一返回 `MODULE_CONFIG_UNAVAILABLE`。revision 用于同一内核中的乐观并发控制，不是跨进程文件锁；缺失/损坏回退后从 0 开始。


### 外部模块作者示例（WebUI Phase 4）

将以下 `module.json` 与 `index.mjs` 安装到外部 `greeting` 目录；配置字段由核心编辑器渲染，无需前端代码：

```json
{
  "id": "greeting",
  "entry": "index.mjs",
  "permissions": ["commands"],
  "config": {
    "version": 1,
    "fields": [
      { "path": "message", "type": "text", "label": "问候语", "default": "你好", "maxChars": 200 }
    ]
  },
  "webui": {
    "version": 1,
    "config": { "binding": "module-file", "schemaVersion": 1, "available": true },
    "surfaces": [
      { "id": "detail", "hook": "module.detail", "renderer": "status", "order": 0 },
      { "id": "config", "hook": "module.config", "renderer": "schema", "order": 10 }
    ]
  }
}
```

```js
export function setup(api) {
  let values = api.config.get()
  api.config.onChange(next => { values = next })
  api.registerCommand('greeting', () => values.message)
}
```

外部 webui 的 `available:true` 必须同时具有有效顶层 config schema、`binding:'module-file'`、`schemaVersion:1`；`module.config` / schema surface 也必须有有效顶层 schema。否则整个 UI 描述符回退为不可用并给出固定 `MODULE_UI_INVALID`，有效后端仍可加载。仅有 config 而无 webui 时仍支持配置 API，但不自动开放 UI 编辑器。没有 schema 时 `hasConfig:false`，GET/POST `/modules/config` 返回 `MODULE_CONFIG_UNAVAILABLE`。字段只有 enabled 且 loaded 时可编辑，关闭、error、blocked 或 loading 时只读；服务端沿用原有关闭时也可读写的配置 API 语义。

未声明 sandbox 的外部徽章仍为「外部声明式（无执行权限）」，这里指 WebUI；声明合法 sandbox 时显示「外部隔离 WebUI」。外部 componentKey、builtin-react 继续拒绝；Phase 5 只允许下文显式授权的隔离 iframe，无外部同源 React 或新 DSH slot。后端 JS 仍是操作员安装的同进程代码；文件检查不是面对并发恶意文件系统修改的进程隔离，revision 也不是跨进程锁。


## 生命周期与故障隔离

- 启动先发现并校验全部目录，再分析 requires 图，最后导入有效且启用的模块。就绪节点中内置优先，其次按 ID 稳定排序。
- 缺失依赖或依赖环上的模块进入 `error`；下游进入 `blocked`。依赖被禁用、导入/setup/事件失败时，下游也会 blocked；无关模块继续工作。不会自动启用依赖，应先启用/修复依赖。
- 清理时先清理下游，再清理其依赖。外部重载会停止目标与所有间接依赖它的模块，重新读取目标清单并导入，按图恢复允许运行的下游；内置下游使用缓存代码。
- 停用清理 timer、cleanup、命令、事件、turn hooks、配置监听、知识源和 capability；重新启用按图恢复。操作串行执行，旧 runtime 的迟到事件错误不会覆盖新的状态。
- 事件 handler 异步执行；异常被隔离并记录，不向 OneBot 事件循环抛出。

## REST 与面板

以下路由均带 `/onebot-qq/api` 前缀，保留 HTTP 200 + JSON ok/message 约定：

| 路由 | 响应/行为 |
|---|---|
| `GET /modules` | `{ok:true,items,summary:{builtin,external}}`；summary 是目录数量，包含关闭/错误项 |
| `GET /modules/ui` | `{ok:true,version:1,catalogRevision,items}`；每项含 moduleId/source/trust/generation/uiRevision/status、config 绑定元数据、surfaces、requestedCapabilities/grantedCapabilities、可选 sandbox 的公开相对 entry/available/reason、uiWarning，不含配置值或私有文件路径 |
| `POST /modules/ui/grant {id,enabled}` | 仅有效外部 sandbox + ui:sandbox；原子保存绑定授权，失败 MODULE_UI_UNAVAILABLE / MODULE_UI_WRITE_FAILED |
| `POST /modules/reload {id}` | 外部返回 `{ok:true,item}`；内置返回 `{ok:false,code:"MODULE_BUILTIN_RELOAD",message}` |
| `POST /modules/toggle {id,enabled}` | 两种来源均支持；清单上限返回 `MODULE_MANIFEST_DISABLED`，状态保存失败返回 `MODULE_STATE_WRITE_FAILED` |
| `GET /modules/config?id=<id>` | 声明有效配置的内置/外部模块：`{ok:true,id,schema,values,revision}` |
| `POST /modules/config {id,values,revision}` | 校验、原子保存、通知后返回与 GET 相同形状；过期返回 `MODULE_CONFIG_CONFLICT` |

公开记录保留 id/name/version/description/permissions/enabled/status/error/loadedAt，新增 source/builtin/apiVersion/requires/canReload/canToggle/hasConfig/configWarning，以及用于匹配 UI 目录的 generation/uiRevision，不返回绝对路径。配置错误统一 `{ok:false,code,message}`：字段/revision 无效为 `MODULE_CONFIG_INVALID`，不可用为 `MODULE_CONFIG_UNAVAILABLE`，写入失败为 `MODULE_CONFIG_WRITE_FAILED`；消息不含存储绝对路径。status 可为 disabled/loading/loaded/error/blocked；动作 `ok:true` 表示请求处理完成，仍需检查 item.status 是否实际 loaded。

面板显示来源徽章、数量、依赖和 blocked/error，按 canReload/canToggle 控制按钮；内置隐藏重载，外部清单关闭时提示先编辑并重载。刷新重新读取列表，操作后按返回状态提示结果。没有安装、卸载或删除路由。

具有有效 `module.config` / schema surface、`module-file` 绑定与 available:true 的内置或外部配置模块显示「配置」按钮，进入详情并调用既有 GET `/modules/config`；「详情」与卡片背景入口也加载同一编辑器，列表没有重复表单。按 schema.fields 复用既有 FieldRow/FieldControl，关闭或未 loaded 时只读。GET 加载到本地草稿，保存携带 revision，成功后重新 GET；即使重读失败也保留保存返回的新 revision。取消丢弃草稿并可再次加载，返回列表清除编辑器。保存期间禁用控件与返回按钮，冲突或保存错误保留草稿并提示重新加载；重新加载丢弃当前草稿。MODULE_CONFIG_* 错误语义保持。未声明可用模块配置的模块没有可写配置区；legacy-core 在详情使用上文的全局字段与即时保存链路。module-file 编辑独立于全局 `/config`；Phase 3A 只调整 legacy-core 的设置呈现归属，存储键、位置、默认值与值保持不变。

当前限制：没有依赖下载/安装、版本解析、签名、进程/VM 沙箱、远程仓库、自动更新、marketplace 或上传安装 UI。模块自己的文件变更不会被监视；需要手动点击重载或调用 API。

