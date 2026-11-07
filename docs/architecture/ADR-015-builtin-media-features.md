# ADR-015：内置媒体功能提取（one-shot 模块 1）

- 状态：已接受并实现；模块 1，含 C01 授权修复
- 日期：2026-11-07
- 基线：main `ddcb082`，工作分支 `feat/builtin-features`
- 前置：[ADR-010](ADR-010-provider-composition.md)、[ADR-013](ADR-013-media-boundary.md)、[ADR-014](ADR-014-module-webui.md)

## 所有权切换

默认启用的 `builtin-media-features` 是 Bilibili 服务解释、`/bili`、表情包功能策略和 `/sticker` 的唯一所有者。setup 注册固定 `mediaFeatures` provider 并自行 start；start/stop 幂等。只有该模块 ID 可注册此槽位；注册表的 `reminders` 通知仍单独驱动宿主提醒所有权，媒体注册、停用或恢复不重启提醒。没有 core 媒体功能 worker 或命令回退。模块停用后，两个保留命令静默结束，Bilibili 与全部表情包功能 HTTP 路由拒绝；`/media/status` 继续返回存储计数及可用状态。

媒体传输、provider/凭据、下载上传、路径/扩展名/大小/realpath 校验、`src/media/stickers.js` 文件与索引、HTTP 注册和现有入站媒体处理保留核心。删除原 `src/content/bilibili.js`；服务移入 `src/modules/builtin/media-features/bilibili.js`，核心不导入功能实现。保留搜索/热门/视频/公开评论/离线分享的规范化、BV 校验、评论去重、顺序与 1–20 条上限。

## 窄端口与命令授权

仅内置声明 `media:features`，且 ID 为 `builtin-media-features` 的 runtime 得到 `api.mediaFeatures`。外部声明在 import 前拒绝；没有原始 media/stickers、HTTP、gateway、路径、字节或凭据 API。端口每次调用与关键 await 后校验 runtime；停用/失败/dispose 撤销旧实例。

- `config()` 仅投影规范化的 `content.bilibili` 三字段和 `media.stickers` 的 maxCount/maxBytes；媒体/图片/贴纸开关仅经 `status()` 的布尔投影暴露。
- Bilibili transport 仅 `search({keyword,page_size})`、`popular({ps})`、`view({bvid})`、`replies({oid,ps})`。宿主固定 `https://api.bilibili.com`、四个端点、参数白名单、User-Agent/Referer、1000–60000ms 超时，拒绝重定向，流式正文上限 2 MiB。模块不能指定 URL/headers/Cookie/WBI。业务 code 与结果解释属于模块。
- Sticker port 仅 `pick({tag})` 与 `send({commandToken,stickerId})`，pick 仅返回 ID/名称。核心在已授权 `/sticker` 调用内签发不透明对象令牌，固定目标；不能指定目标、路径或内容。令牌在 await 前消费，失败也不能重用，handler 结束即撤销，不能跨 runtime 使用。
- 核心通过存储解析文件，再复用媒体文件检查和 delivery/outbound access/rate/leak/dryRun 闸门发送一次；无重试、无网关回退。模块不会得到路径/字节，核心文件错误使用固定安全消息。
- 命令注册新增仅内置可用的 `audience: 'owner' | 'owner-or-operator'`。`/bili` 保留主人/只读操作员，`/sticker` 只限主人；deniedCommands 和会话出站访问检查都先于模块处理和令牌签发。原用法、空结果和公开接口错误文案保留。

## C01：库与发送授权分离

C01 基线为 main `e5a206c`，工作分支 `feat/closed-loop-v2`。原单一 `authorizeStickers()` 将图片开关错误地施加到库管理；内部 provider 改为两个显式方法，不保留未使用的旧方法：

- `authorizeStickerLibrary()`：当前模块 runtime 活跃、`media.enabled`、`media.stickers.enabled`，且库服务可用。
- `authorizeStickerSend()`：库授权成立，再要求 `media.images.enabled` 和媒体/delivery 服务可用。命令与宿主发送端口均使用发送授权；文件解析 await 后、提交 delivery 前重复校验当前开关、runtime 与目标访问权限。

| 模块运行 | 媒体开关 | 表情包开关 | 图片开关 | 库管理/预览 | 发送 |
| --- | --- | --- | --- | --- | --- |
| 关 | 任意 | 任意 | 任意 | 关闭 | 关闭 |
| 开 | 关 | 任意 | 任意 | 关闭 | 关闭 |
| 开 | 开 | 关 | 任意 | 关闭 | 关闭 |
| 开 | 开 | 开 | 关 | 可用 | 关闭 |
| 开 | 开 | 开 | 开 | 可用 | 可用 |

表中可用仍要求对应服务存在；发送另经原 access/rate/leak/dryRun 闸门。库服务缺失关闭两类授权，媒体/delivery 缺失仅关闭发送。令牌仍绑定已授权命令和固定目标，await 前单次消费，失败或开关关闭也不能重用；旧代次不可使用，无发送重试。

`/media/status.stickers` 的 `available` 为 `libraryAvailable` 兼容别名；另有 `sendAvailable`、`libraryReason`、`sendReason`。成功原因为 `null`，拒绝原因按顺序为 `MODULE_DISABLED`、`MEDIA_DISABLED`、`STICKERS_DISABLED`、`LIBRARY_UNAVAILABLE`、`IMAGES_DISABLED`、`DELIVERY_UNAVAILABLE`；发送继承库拒绝原因。状态读取保持无发送副作用，模块停用仍可读取库计数。

## UI 与配置

描述包含 `module.detail` 的 `media-features.preview`、`module.config/schema`（legacy-core）与 `module.panel` 的 `media-features.panel`。preview 仅接收有界冻结投影，无请求/写入。Bilibili 操作面板移至模块详情，原「内容」页保留入口指引。六个旧配置字段标记 `module:'builtin-media-features'`，在模块详情复用全局保存；系统设置不重复展示，停用/未 loaded 只读。

表情包管理控件保留核心媒体页，读取 `/media/status.stickers.libraryAvailable` 后开放；图片关闭时显示「库可用；图片开关关闭导致发送禁用」。核心所有 list/upload/tag/delete/file 路由均咨询当前 provider，缺失或策略拒绝时关闭；提交请求在读 body 后再授权，所有库操作 await 后复查，文件预览读取字节后也复查。模块配置详情以只读草稿分别展示库与发送有效状态。没有新增 DSH sidebar/main slot。

配置键、默认值、格式、存储位置和贴纸数据均不迁移；Bilibili 默认关闭，媒体/图片默认关闭，贴纸配置默认开启，模块默认启用不代表父开关开启。版本和依赖保持。

## 验证与限制

`test/bilibili.test.js` 保留业务行为对等；`test/builtin-media-features.test.js` 覆盖 provider 身份、投影、命令受众/拒绝、一次发送、令牌、旧生命周期、HTTP 禁用和数据保留；现有模块/面板/宿主/E2E 测试验证目录、配置、纯预览与提醒隔离。C01 新增四个开关的全部 16 种组合、图片关闭时 upload/list/tag/delete/file 预览、服务缺失、异步关闭/访问撤销、关闭图片后令牌失效与实际 outbound access/rate/leak/dryRun 回归；React shim 验证管理操作和分离预览。包检查验证两个归档包含新模块和本 ADR，并在解包目录独立加载/停用 provider。

这是同进程内置 API 边界，不是 Node.js 进程沙箱。已进入核心原子存储写入或已提交 outbound 的在途操作可以完成；停用后不再接纳功能操作，也不重试已提交发送。公开接口的登录/风控限制保持；未验证真实 Bilibili/QQ provider 或真实浏览器。表情包管理 UI 暂留核心媒体页并完整授权，属于明确保留项。仅本地测试、打包校验与一次提交；不涉及其它 one-shot 模块、推送、部署、版本、标签或发布。
