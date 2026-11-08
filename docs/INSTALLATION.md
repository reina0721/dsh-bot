# 安装、升级与回退

## 前提与 profile

需要可运行的 dsh、Node.js >=22.13.0 和 DSH >=0.2.0 <0.3.0。`--profile` 指向实际使用的配置，例如 desktop；先确认 profile 名称，安装不会自动重启它。

## Release 直链

```sh
dsh plugin --profile desktop add https://github.com/reina0721/dsh-bot/releases/download/v0.11.25/dsh-bot.tgz
```

追踪最新稳定版时将 URL 换为 `https://github.com/reina0721/dsh-bot/releases/latest/download/dsh-bot.tgz`。推荐固定版本以便重复安装。v0.11.25 已发布，这些固定链接可直接使用。

## 一键安装脚本

从 [PowerShell 脚本](../scripts/install.ps1) 或 [Shell 脚本](../scripts/install.sh) 下载并查看内容，然后执行：

```powershell
.\install.ps1 -Profile desktop -Version 0.11.25 -DshPath 'C:\path with spaces\dsh.cmd'
```

```sh
sh install.sh --profile desktop --version 0.11.25 --dsh '/path with spaces/dsh'
```

省略版本时安装最新稳定版；可传 `0.11.25` 或 `v0.11.25`。脚本解析最新 Release 到固定标签，下载同一版本的包与 SHA256SUMS，验证后安装，结束时清理临时下载。校验通过的包保留在 `$DSH_HOME/plugins-cache/dsh-bot/v<版本>/`，以维持 DSH 对本地安装包的路径引用；后续安装同版本时拒绝覆盖内容不同的缓存。不会安装 DSH、Node、QQ 网关或重启服务。

## 下载与源码安装

从 [Releases](https://github.com/reina0721/dsh-bot/releases) 下载 dsh-bot.zip 和 SHA256SUMS，验证 zip 的 SHA-256 后解压，选择包含 package.json 的 dsh-bot 目录安装。保存该目录，不要安装后删除本地插件目录。

```sh
git clone https://github.com/reina0721/dsh-bot.git
cd dsh-bot
dsh plugin --profile desktop add .
```

源码 zip 是整个仓库，Release zip 是经过白名单筛选的可安装包。插件管理器也可使用解压后的本地目录。

## 升级与回退

停止对应 DSH profile，备份 `$DSH_HOME/plugins-data/dsh-bot/`，用目标版本的固定 tgz URL 再次执行安装命令，随后启动并检查面板与连接。回退使用旧版本的固定 URL；数据格式跨版本不保证可逆，必要时恢复升级前备份。

从旧插件名升级必须先按[迁移说明](MIGRATION.md)处理。模型密钥来自本地配置或环境变量，安装不会替你设置。
