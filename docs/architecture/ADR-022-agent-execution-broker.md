# ADR-022：Agent execution broker（AstrBot alignment C06 / C07）

- 状态：C06 broker 与 C07 Agent 工具/会话隔离已实现；C07 基线 C06 `b90f731`，默认关闭。
- 范围：执行接纳、工作区文件能力、Linux bwrap 驱动、管理 API、持久审计及 C07 运行时接线。
- preset 配置缺口尚待宿主补齐；受保护的 `cordis.patch.yml` 与 `.archify/` 保持原样。离线 Chat sandbox 保持原服务与 API。

## 信任边界与策略

`src/sandbox/bootstrap.js` 只在 live host 组装独立 broker；不进入 simulation graph。`service.js` 管理接纳、有限并发、排队、取消、策略代次、artifact 和 drain；`policy.js` 从受信调用上下文派生 persona / principal / chat type / chat / session 的 SHA-256 作用域。QQ 身份由服务端配置计算 owner/operator/other，不能从作业输入授予角色。默认 owner 私聊有 workspace/execute，operator、other 和所有 group 没有能力；配置矩阵可显式授予。网络始终关闭。

管理 HTTP 接口沿用 DSH management webServer 的管理员认证边界，与现有管理 API 相同；注册器本身不实现第二套账号认证。管理调用使用固定 `management` principal/private chat/session 和当前人格，作为受信管理 owner；不是从 QQ 消息或 HTTP 字段推断的身份。不得将这些路径直接暴露为公共匿名端点。C07 Agent 使用另一条服务端真实上下文接线，不复用 management 身份。

有效策略代次摘要覆盖 sandbox 配置和 owner/operators；create 必须带当前 `policyGeneration`，过期返回 POLICY_CHANGED。执行前再次核对，100ms monitor 撤销运行中作业；未开始的旧策略作业不能执行。requestId 只在完整作用域内幂等，相同内容返回原 ID，不同内容返回 IDEMPOTENCY_CONFLICT。策略被撤销时不以幂等重放绕过权限。

## 工作区与 artifact

`workspace.js` 为每个作用域建立私有目录并串行锁定；持久内容不超过 **64 MiB / 1024 项**（目录也计数）。只允许相对路径，拒绝绝对路径、空段、`.`/`..`、反斜线、NUL、符号链接、硬链接及特殊文件。祖先目录不能经符号链接重定向，POSIX 祖先必须属于 root/当前用户且无 group/world 写权限（root 的 sticky 临时目录例外），最终私有目录必须属于当前进程用户且无 group/world 写权限。读取用 lstat + O_NOFOLLOW/非阻塞文件打开和句柄 fstat；写入配额预检后原子 rename。这里假设 broker 用户及宿主文件系统受信，不抵御同 UID 的恶意宿主进程或管理员修改私有目录。

每个作业持有作用域锁。执行取得独立快照并仅以只读 `/workspace` 挂载；恶意代码永远拿不到持久工作区的可写挂载。`file-worker.js` 在 broker 内执行有限 `file.write/read/list/delete`，不是任意脚本；驱动 unavailable 时，这些操作在启用、授权、审计可用和路径检查通过后仍可独立运行。

执行时 `/work` 为 64 MiB tmpfs，`/tmp` 为 1 MiB tmpfs，受同一 memory cgroup 记账，退出即丢弃。C06 不自动导回任意执行文件；stdout/stderr 合并为单一 artifact（默认最多 64 KiB），file.read/list 也生成有界 artifact。artifact API 用 base64 JSON，避免浏览器把用户内容当 HTML。只有终态且 artifact/终态审计完成后可读取，返回内容没有宿主路径。工作区文件不是日志，artifact 是用户显式作业结果，均不进入审计元数据。

## Linux 隔离与 fail closed

仅使用固定 `/usr/bin/bwrap`（root 所有、非 setuid/setgid、不可 group/world 写）。驱动从固定系统 dash/cat/sleep/env/head/yes/wc/ls 和 `ldd` 解析出的 ELF 库复制最小 rootfs，拒绝不安全来源；不挂载 host `/`、home、DSH、仓库、SSH、Docker/socket 或宿主设备目录。无下载、依赖安装或 OS 安装。未知/缺失 bwrap 选项、动态库、namespace 权限或控制器均使真实探针失败，不能回退为 host shell 执行。

bwrap 强制 user/mount/PID/IPC/network/UTS/cgroup namespace，显式 `--unshare-user` 与 `--unshare-cgroup` 避免 `--unshare-all` 中 try 语义的降级；禁用嵌套 user namespace，drop ALL capabilities，bwrap 自身设置 no_new_privs，创建新 session 并绑定父进程死亡。`/proc` 保留为空目录，避免 mountinfo 泄露宿主 backing paths；`/sys` 不挂载。`/dev` 由 bwrap 新建。环境只设置 PATH/HOME/LANG/LC_ALL/TMPDIR（shell/bwrap 可添加固定 `/work` PWD），不继承 process.env。实现选项语义参考 [bubblewrap 上游源码](https://github.com/containers/bubblewrap/blob/main/bubblewrap.c)。

cgroup v2 必须已委派 memory/pids/cpu；驱动只在本进程已有 cgroup 下建立随机私有子树，不修改共享父级 controllers。每作业设 memory.max、swap=0、oom.group、pids.max、cpu.max（最多一个 CPU），必须支持 cgroup.kill。受信 launcher 在管道 gate 上等待，加入 cgroup 后才释放 bwrap，用户脚本不进入 host launcher 语法。core dump 禁用。超时、取消、输出超限和退出都 kill 整个 cgroup，加进程组清理，验证 populated=0 并删除 cgroup后才返回。清理失败将 driver/service 置为 failed，不能继续接纳执行。

隔离内的固定 launcher 通过专用 FD 发送 ready marker，随后关闭该 FD 才执行用户代码；隔离启动失败的原始 stderr 不作为 artifact 返回，固定错误码不会回显路径。就绪探针真实启动同一路径的短 shell 作业，验证 PID/rootfs/env 边界；不使用 mock 作为运行时探针。每次真实执行还核对 bwrap info-fd 的 mount/net/PID/IPC/UTS/cgroup namespace inode 都与宿主不同；该元数据不公开到 API。清理不确定时驱动锁定拒绝重新就绪。

## 状态、API 与限额

所有路径以 `/onebot-qq/api` 为前缀，继承 opaque Origin/null/iframe 拒绝与方法检查。

| 方法与路径 | 输入 / 行为 |
| --- | --- |
| GET `/sandbox/status` | 无参数；readiness/reason/driver、能力、限额、代次、running/queued；无命令、凭据或宿主路径 |
| POST `/sandbox/probe` | `{}`；管理员有界探针、single flight、60 秒冷却，执行中拒绝 |
| GET `/sandbox/audit` | 无参数；本作用域最多 128 条 metadata 审计投影 |
| GET `/sandbox/jobs` | 无参数；本作用域最多 128 条 metadata |
| POST `/sandbox/jobs/create` | `{kind,requestId,policyGeneration,...}`；kind 为 execute 或四种 file 操作 |
| GET `/sandbox/jobs/detail?id=job_…` | 本作用域单条 metadata；未知/跨作用域统一 JOB_NOT_FOUND |
| POST `/sandbox/jobs/cancel` | `{id}`；持久取消意图，queued 取消或运行中 AbortSignal |
| GET `/sandbox/artifact?id=job_…` | 终态 artifact；返回 `{encoding:"base64",bytes,content}` |

execute 只接受 code（shell 文本 ≤16 KiB），不接受 caller 指定 executable、argv、env、挂载或网络；file.write 接受 path/content（UTF-8 ≤64 KiB），read/delete 接受 path，list 无附加参数。严格拒绝未知字段、客户端作用域/角色、重复 query key、错误 JSON、超过 96 KiB body。API 每分钟最多 120 次、最多 8 个在途请求。探针最多八个有 1 秒超时的固定 ldd 和一个 2 秒真实执行，文件系统操作依赖正常本地内核返回；不是对挂死内核的硬实时保证。

readiness 为 disabled/checking/ready/unavailable/draining/failed。默认 disabled；启用/变更策略后 checking，通过 probe 才 ready。bwrap/cgroup/平台不可用时 unavailable，固定原因包括 BWRAP_MISSING/BWRAP_UNSAFE/CGROUP_UNAVAILABLE/ROOTFS_UNSAFE/PROBE_FAILED/UNSUPPORTED_PLATFORM。Windows 与其它平台执行不可用。audit/driver 故障为 failed，卸载为 draining 并等待取消清理。没有自动危险降级。

## 审计、恢复与限制

`audit.js` 原子替换并 fsync 文件及目录，最多 512 条 metadata。接纳和开始执行都必须先持久化，失败即阻止副作用和后续 admission；终态写盘失败返回 AUDIT_UNAVAILABLE，结果窗口不能假称成功。记录仅作业/作用域摘要、状态/时间/固定原因、code/文件操作 SHA-256、request/fingerprint/策略代次摘要、退出码和输出字节数；不记录命令、代码、正文、环境、文件内容或 host 路径。

重启将未完成 metadata 标 interrupted，不续跑用户代码。保留的已完成作业仍支持去重；队列仅内存，code/文件内容不落审计。并发默认 2（1–4）；保留作业默认最多 128，容量满时只淘汰旧终态及其 artifact，全部活动则拒绝；幂等窗口随有限保留窗口结束。审计滚动恢复不是无限期作业数据库，不保证崩溃窗口的 exactly-once。没有跨进程 workspace/audit 锁；同一数据根目录只允许一个 broker 实例。

文件操作的取消是操作间协作取消：已提交的原子文件写入不会回滚。任意脚本执行不回写持久工作区；目前只提供固定最小 shell 工具，无 Python/Node/编译器或用户选 rootfs，没有文件下载网络能力。这是 C06 的保守能力边界。

## 验证证据

`test/agent-sandbox.test.js` 明确使用 fake driver 验证接纳、并发/取消、幂等、策略/作用域、审计故障/恢复、artifact、API 与独立文件操作；这些不证明 OS containment。工作区测试覆盖 traversal/symlink/hardlink/quota/lock/snapshot。

`test/agent-sandbox-linux.test.js` 始终使用真实 Linux driver，按能力验证 rootfs/PID/env/network、输出、内存、进程树、超时、取消、只读快照/tmpfs；不可用时验证 service unavailable 且拒绝执行，并逐项 skip/report。C06 本次环境没有 bwrap，cgroup 委派写入返回 EROFS；真实隔离七项跳过，**没有证明本机真实 containment**，也未安装或改造系统以绕过限制。


## C07 Agent 工具与会话隔离

host 在 assembleServices 前建立唯一 executionSandbox，经 assembly → cognition → runtime 注入；simulation 仍使用 fixture runtime，不注入 live broker。运行时从真实 turn 绑定 principal/chat，persona 服务提供人格 ID、切换代次与人格内容摘要（编辑/重置/演化也使旧绑定失效），模型输入不能授予角色。

`src/runtime/sandbox-tools.js` 定义六个严格 object schema，拒绝未知字段，不接受角色、人格、策略代次、环境变量、宿主路径、挂载、网络或目标会话覆盖：

| 工具 | 输入 | C06 broker 能力 |
| --- | --- | --- |
| `sandbox_file_list` | `{}` | `file.list` |
| `sandbox_file_read` | `{path}` | `file.read`，相对路径 |
| `sandbox_file_write` | `{path,content}` | `file.write`，UTF-8 ≤64 KiB |
| `sandbox_shell` | `{code}` | `execute`，code ≤16 KiB，无 env/argv/executable |
| `sandbox_python` | `{code}` | 当前驱动没有 Python，固定 `SANDBOX_CAPABILITY_UNAVAILABLE`；不增加解释器 |
| `sandbox_action` | `{action:"file.delete",path}` | 仅 C06 `file.delete`，不是 QQ/通用 action bus |

每次调用及异步等待后检查 admission、人格/策略代次与 broker ready；角色/群组矩阵由服务端配置推导，默认仅 owner private。仅 enabled + ready + session 有能力时挂载这六个工具；workspace-only session 的 shell/Python 仍返回 POLICY_DENIED。disabled/unavailable/checking/draining/failed 或无 broker 时挂载零个 sandbox 工具，即使 C06 管理 API 的独立文件操作仍可用，也不从 Agent 绕过 ready 条件。原三个 QQ 工具仍仅 full/private，定义与发送路径不变，执行入口追加会话有效性检查。

工具只投影固定状态/错误码、opaque job ID 和有界 artifact 内容；不回显异常、driver/setup 信息或宿主路径。artifact 先验证 ≤64 KiB，再最多返回 16 KiB UTF-8 输出及 bytes/truncated；不自动导回脚本产生的文件。工具总等待上限 35 秒，runtime 回复超时可更早撤销；broker 自身仍执行原资源/超时限制。工具返回是用户显式作业结果，不进入审计正文。已接纳的文件原子写入或 QQ 发送不能通过撤销回滚。

会话绑定 environment（live）、runtime instance、persona ID/代次、principal、chat type/ID、preset、policy generation、DSH session instance。broker 的 session 维度使用包含环境和 runtime instance 的随机摘要，同一聊天的新 Session 不复用旧 workspace/job 作用域。sessions.json 仅作 metadata 映射；进程重启不会重新接纳没有当前实例绑定的旧 Session。群里不同 principal、preset/就绪状态变化也更换 Session。

策略/人格变化、reply/tool 超时、dispose 会先同步撤销工具接纳，内部 create 的独立 AbortSignal（不属于作业/HTTP 字段）在 durable admission 等待后、执行开始前重检，并中断运行作业；同时取消已知作业。即使 create 在撤销后才返回 ID，也立即取消，迟到 artifact 不交付。尝试宿主 `agent.abort()`；缺方法或失败时仍退休 Session、注销 context/tools、解除映射，忽略迟到事件，下一轮创建新 Session。100ms monitor 清理无新调用时的失效绑定并检查 ready 丢失；每次工具调用与事件另核对当前绑定。oneshot 只返回模型文本，不解析工具 JSON、代码块或执行意图；Agent 失败可回退 oneshot 文本。

## C07 preset 缺口（不改 live patch）

沙盒启用后，运行时固定选择下列独立 preset（当前 bundle **尚未声明**），包括 broker unavailable 的情况；本 runtime 一旦进入沙盒模式，随后 disabled/unavailable 也不降级到旧通用工具 preset。默认从未启用 sandbox 的 legacy 行为保持原样。

| 需要由宿主另行提供的 preset | 内容 |
| --- | --- |
| `dsh-bot-sandbox-private` | persona prefix 引用 `{{dshbot_persona}}` + `{{dshbot_rules_private}}`，time-context，可选原 compaction；QQ/sandbox 工具仅由 runtime 挂载 |
| `dsh-bot-sandbox-social` | persona prefix 引用 `{{dshbot_persona}}` + `{{dshbot_rules_social}}`，time-context，可选原 compaction；仅挂策略显式许可的 sandbox 工具 |

两者必须排除 `@deepseek-ai/dsh-tool-fs`、`@deepseek-ai/dsh-tool-fs-search`、`@deepseek-ai/dsh-tool-web` 及任何通用 shell/exec/宿主文件/网络插件或继承。旧 `dsh-bot-private` 目前仍声明 fs/web，仅属于未启用 sandbox 的 legacy 路径，不能作为沙盒隔离证据。安全 preset 缺失时创建失败，返回固定 RUNTIME_FAILED 并允许 oneshot 文本回退；不尝试 legacy preset，不挂通用工具作为 fallback。

C07 未安装 bwrap/Python 或修改 cgroup、版本、live preset/patch。当前宿主无可用执行驱动，实际路由不挂 sandbox 工具；真实 ready Agent 与 preset/DSH 集成仍待宿主具备上述条件后验证。`test/runtime-sandbox-tools.test.js` 用 fake ready broker / fake driver 与真实 broker 文件能力验证工具、策略、路径、输出界限、scope/代次、timeout/cancel/dispose、迟到 admission/action/event、无 generic fallback、QQ 兼容及真实 cognition 装配。fake ready 证据不证明 OS containment，真实 Linux 探针仍按上文单独报告。
