# 验证与发布

## 本地检查

在根目录运行 `npm test`、`npm run check:docs`、`npm run pack:release`、`npm run check:package`。dist 输出可安装 tgz、zip 和 SHA256SUMS；两种包共用 npm files 白名单。

离线测试不需要真实 QQ 或模型密钥。外部模型测试按环境变量启用，不把密钥写入仓库。历史验证证据见[归档](archive/README.md)，不能当作新版测试结果。

PowerShell 下可用 `npm run verify -- -DshPath 'C:\path\to\dsh.cmd'` 对真实 DSH 做临时 profile 安装、启动、健康接口和网页插件注册验证。默认寻找 PATH 中的 dsh，验证结束清理临时 profile 与进程。

附加 `-PackagePath dist/dsh-bot.tgz` 可验证实际发布压缩包的安装链路；省略时验证仓库源码目录。

## 发布步骤

1. 确认远程仓库已改名为 reina0721/dsh-bot，启用 Actions。首次发布前 README 的 Release 链接不可用。
2. 更新 package.json 版本与 CHANGELOG，完成检查与真实 DSH 验证。
3. 提交后创建对应标签，例如 `git tag v0.11.14`，再推送提交与标签。
4. Actions 在 Windows、Linux 验证版本、测试、文档和安装包。任一失败均不发布；全部通过后，从 Linux 验证任务下载原产物创建 Release，不重新打包。
5. 标签必须与 package.json 完全一致。带连字符的版本发布为 prerelease，稳定版可通过 latest/download 获取。
6. 首次发布后在独立 profile 验证真实 GitHub tgz 直链、PowerShell 和 Shell 安装脚本、zip 本地安装，并检查校验文件与版本回退。

不发布 npm 包。Release 发布需要工作流 contents:write 权限；普通验证任务只读。若发布失败，先排查日志和现有 Release 状态，不覆盖已经对外发布的同版本文件。修复后发布新版本。
