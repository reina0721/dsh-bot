# ADR-020: settings ownership and navigation contract

- 状态：已接受；AstrBot alignment **C01 only**，契约与离线验证。
- 基线：main `b3d07a0`，v0.11.15；分支 `feat/astrbot-alignment`。
- 实现：`src/core/settings-schema.js`、`src/core/navigation.js`。

## 背景与边界

现有 15 个顶层标签、15 个认知子页和 30 个配置组分别承担导航、编辑与运行操作，部分旧组混合核心字段与模块字段。后续界面和 profile 重构需要先确定唯一编辑所有者，避免把同一字段复制到 System、Profiles 与 Extensions。

C01 仅提供静态、深冻结的元数据和纯导航函数，尚未接入客户端。`client.js`、HTTP、配置读写、运行行为和 DSH 注册保持原样。没有 profile 迁移、新沙盒代码、版本变化或发布；旧面板仍按现有方式工作。这里的唯一编辑所有者约束后续编辑入口，不宣称已重构旧界面。

## 所有权、作用域与存储

| ownerClass | 唯一编辑职责 | scope | 规范位置 |
| --- | --- | --- | --- |
| `system` | 连接、凭据、访问控制、运行基础设施、全局资源预算、数据治理 | `system` | System 或 Data & Logs |
| `profile` | 人格表达、轮次、模型选择、情绪、关系、记忆、目的与策略 | `profile` | Profiles |
| `module` | 已由内置模块独占的业务设置，以及模块文件配置 | 旧核心绑定为 `system`；模块文件为 `module` | Extensions → 指定 moduleId → config |
| `operation` | 人工执行的一次动作，不是持久设置 | `request` | 操作所在目的地 |

**scope 是契约中的编辑上下文，不是新存储路径，也不是既有 profile 隔离能力的声明。** `storage: config.json` 的 297 个路径继续使用原来的全局文件。`profile` 类描述后续 profile 编辑的归属；C01 不复制、重命名或按人格切换这些设置。内置模块的 41 个旧绑定字段仍属全局配置。内置 sample 的 `modules.builtin-sample.message` 是契约命名空间，`storage: module-file`，实际仍由原模块配置机制保存其平面键 `message`，不写入核心配置。

`OPERATION_CONTRACTS` 用 module lifecycle、备份恢复、学习任务三个已有动作族说明 operation 类型，既不是完整动作清单，也不授予权限或执行动作。现有 action/operation 服务继续持有执行、确认、限权与审计。`SETTINGS_FIELDS` 不接收 operation 字段。

## 字段模型与校验

每个字段有 `path`、`ownerClass`、`scope`、`canonical: {area, section, moduleId?, anchor?}`、`sensitivity`、`apply`、`aliases`，以及 `storage`、`legacyGroup`、`exposure`。元数据不包含实际值、默认值、令牌或环境变量内容。

- `sensitivity`: `public`、`private`、`secret`、`secret-reference`。两个 OneBot token 是 secret；API Key 环境变量名是引用。敏感度是编辑元数据，不能代替既有脱敏、鉴权或出站闸门。
- `apply: next-use`: 保存后由下一次读取/使用生效，不承诺改写在途操作或重新调度已有计时器。
- `apply: gateway-reconnect`: 与网关 restart key 对齐；启停、账号/核验开关、端点和 SnowLuma 选择可能重建连接，仍遵守当前连接状态。
- `apply: module-restart`: `cognition.reminders.tickMs` 的计时器间隔需要模块重新启动才重新建立；C01 不自动重启。
- `apply: read-only`: `version`、内部 delivery engine 和旧 `addressedOnlyGroups` 兼容项不提供规范编辑控件。它们仍有唯一元数据所有者；不新增可编辑入口。
- `exposure` 区分原面板、人格编辑、仅配置文件、内部项和模块 schema；不是新可见性规则。

库存逐路径显式列出，不能通过“未知 cognition 字段自动归 profile”掩盖漏项。`SETTINGS_GROUPS` 仅按规范所有者分区，不复制旧组；`validateSettingsSchema()` 在加载时检查路径/别名唯一、所有权类别与目的地、作用域、模块 ID、敏感度、生效方式和组分区完整性，并拒绝非元数据属性。测试独立读取 `CONFIG_GROUPS`、`DEFAULTS` 和内置 registry，新增/删除/移动字段或模块时必须同步契约。

基线覆盖：30 组（13 普通组 + 17 `cog-*`）、278 面板字段、19 个额外配置叶子、1 个模块文件字段；合计 **298 字段 / 32 个规范所有者组**（system 133、profile 123、module 42）。未解决组：**无**。数组按一个可编辑字段计数。

### 混合组的决定

- `media`: 传输、provider 和凭据属 System Media；三个贴纸策略字段属 `builtin-media-features`。`content` 的三个 Bilibili 字段也只归该模块。
- `cog-turn`: typing 字段归 `builtin-typing`，其余轮次行为归 Profiles Turn。
- `cog-reply`: 六个回复布局字段归 `builtin-reply-delivery`；通知、请求和拍一拍行为归 Profiles Reply。
- `cog-core`: 五个认知行为字段归 Profiles General；两个 debug 字段归 System Diagnostics。
- `cog-llm`: 模型选择、生成参数、预算模式和人格额度归 Profiles Models；全局额度、并发、超时、重试、cache、宿主回退归 System Models。
- `cog-permissions`、`cog-admin` 归 System Access；privacy 和 import 归 Data & Logs；learning、proactivity、reminders 的设置分别只归其模块。Profiles 中对应业务页保留数据/状态导航，不复制模块设置。

这些是设置编辑职责，不改变 ADR-012 至 ADR-019 定义的服务所有权、核心回退、业务开关或安全边界。

## 六区导航登记模型

`NAVIGATION_REGISTRY` 列出 area、section、现有组件名和 availability。组件名仅为受信静态描述，既不是动态 import，也不是 DSH slot 或外部 manifest 扩展点。

| area | 名称 | 内容 |
| --- | --- | --- |
| `overview` | Overview | 概览 |
| `chat` | Chat & Sandbox | 消息；sandbox 仅 `planned`、组件空数组 |
| `profiles` | Profiles | 人格库、15 个认知子页及规范行为设置分区 |
| `extensions` | Extensions | 模块目录；具体模块目的地为 `module-dependent` |
| `data` | Data & Logs | 媒体/内容操作页、事件、日志、备份、隐私与导入 |
| `system` | System | General、连接、超时、外观、安全、访问、运行时、媒体基础设施、模型基础设施、诊断、关于 |

`existing` 表示有可复用的现有组件，不表示六区界面已经上线。`planned` 不提供组件实现；后续消费者必须尊重 availability。既有 DSH 仍只注册 `main` 与 `sidebar.panellist`，不按六区新增入口。

## 旧目的地与别名

`LEGACY_TABS`、`LEGACY_COGNITION_SECTIONS`、`LEGACY_CONFIG_GROUPS`、`LEGACY_MODULE_IDS`、`LEGACY_ANCHORS` 是完整基线库存，`LEGACY_ALIASES` 提供无歧义命名空间。`resolveAlias(id)` 找不到时返回 null；返回副本，不能修改登记数据。

| 旧目标 | 规范目标 |
| --- | --- |
| overview / messages | Overview Overview / Chat Messages |
| connect / config | System Connection / **System General** |
| settings / models / security / about | System Appearance / Models / Security / About |
| persona / cognition | Profiles Library / **Profiles Overview** |
| modules | Extensions Modules |
| media / content / backup / logs | Data Media / Content / Backup / Logs |
| cognition + 15 个 section | Profiles 中同名 section |
| basic / endpoint / snowluma / timeouts | System General / Connection / Connection / Timeouts |
| events / logging / ui / security / access / runtime / media / content / ops | 对应静态组表；content 归媒体功能模块，ops 归 Data Backup |
| 17 个 cog-* | 对应静态组表及上面的混合组决定 |

名字冲突通过 `tab:media` / `group:media`、`tab:overview` / `cognition:overview` 消解；裸名字按 tab → group → cognition section 查找。`module:<id>` 与七个裸内置模块 ID 打开指定模块 detail。五个原系统设置分类也有 `settings:<id>` 别名。

每个字段有原路径别名与 `group:<legacyGroup>/<path>` 别名，解析时携带 `fieldPath`，直接指向其唯一规范所有者。**旧组别名只是落点，不是该组所有字段的第二个编辑所有者。** 例如 `group:cog-reply` 落在 Profiles Reply，但 `cognition.reply.split` 直接落在 reply-delivery 模块 config。

所有 `ob-tab-*` / `ob-panel-*` 旧标签锚点都映射到原标签规范目标；字符串别名允许前导 `#`。实际 DOM 锚点覆盖 `ob-media-stickers`、`ob-cog-unknowns/tasks/claims`、`ob-module-detail/config/panel/reminders`，以及动态 `ob-cog-decision-<id>`、`ob-cog-task-<id>`。模块锚点模板必须带具体 moduleId 才能形成可导航目标；不会根据 manifest 注册新位置。

## 纯导航 API

```js
go('config') // { area: 'system', section: 'general' }
go('cognition') // { area: 'profiles', section: 'overview' }
go('cognition', 'cog-learning')
// { area: 'extensions', section: 'module',
//   moduleId: 'builtin-learning', anchor: 'ob-module-config' }

goTo({ tab: 'cognition', section: 'learning', anchor: 'tasks', taskId: 'Task:ABC-1' })
// { area: 'profiles', section: 'learning',
//   anchor: 'ob-cog-tasks', taskId: 'Task:ABC-1' }
```

`goTo`（别名 `normalizeNavigation`）同时接受旧 `{tab, section?, moduleId?, anchor?, decisionId?, taskId?}` 和规范 `{area, section?, ...}`。规范目标可再次规范化，结果不变；未给 section 时使用该 area 的首个分区。短锚点补齐既有 DOM 前缀，完整锚点保持原样。moduleId、decisionId、taskId 保持大小写、标点及完整 ID，不截断、不数字化。

沿用旧目标的 ASCII 标识约束：非空 ID/anchor 最多 96 字符，首字符字母或数字，后续允许字母、数字、`_ . : -`。允许通过 moduleId 指向语法合法的外部本地模块，不把它们注册到静态目录；是否存在/可用仍由模块页判断。decision/task 动态锚点仅解析后缀 ID，不拉取业务数据。不允许互相冲突的目标、无 moduleId 的模块锚点、未知 section/anchor、同时带 decisionId 与 taskId，或携带额外非导航属性。

未知或格式错误的导航请求返回全新 `{area: 'overview', section: 'overview'}`，不保留旧 ID。函数不抛出到调用方，不访问 DOM、不滚动、不变更历史、不读写配置、不运行 action。C01 没有替换旧 `client.js` 的 `navigationTarget` 或 React 回调。

## 验证

`test/settings-schema.test.js` 对照实际配置/默认叶子/模块 registry，检查覆盖、唯一所有权、错误元数据拒绝、敏感度、不可变性，并对照现有客户端全部 tab/section/静态锚点与组件。`test/navigation.test.js` 穷举所有旧别名、字段和组的落点，验证动态 ID、短/完整锚点、幂等及安全回退。客户端 shim 和包检查继续断言 DSH 注册只有原两个 slot。

必要命令：`npm test`、`npm run check:docs`、`npm run check:parity`、`npm run pack:release`、`npm run check:package`、`git diff --check`。包检查同时验证两个归档包含并可加载本契约和 ADR。本次只构建本地验证产物，不推送、部署或发布。
