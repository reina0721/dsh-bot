# 视觉基线（Archify）

5 张可交互的 standalone HTML，用来回答「现在是什么样、目标是什么样、一条消息怎么走、轮次怎么流转、怎么分阶段补齐」。源文件是 `src/*.json`，输出 HTML 自带主题、路径/透镜、搜索与导出，不依赖网络。

| 图 | 类型 | 回答的问题 | 源文件 | 证据 |
|---|---|---|---|---|
| [current-architecture.html](current-architecture.html) | architecture | M7 审计基线的模块、边界与数据流（15 标签、Session/媒体/模块/运维） | [src/current-architecture.json](src/current-architecture.json) | [evidence](evidence/current-architecture/) |
| [target-architecture.html](target-architecture.html) | architecture | M1–M3 目标设计（历史设计稿；当前实现以 current-architecture 为准） | [src/target-architecture.json](src/target-architecture.json) | [evidence](evidence/target-architecture/) |
| [message-lifecycle.html](message-lifecycle.html) | workflow | 一条 QQ 消息从入站到出站，经过访问/聚合/Session/出站闸门 | [src/message-lifecycle.json](src/message-lifecycle.json) | [evidence](evidence/message-lifecycle/) |
| [turn-lifecycle.html](turn-lifecycle.html) | lifecycle | 对话轮次的状态机：聚合、等待、决策、生成、沉默、冷却 | [src/turn-lifecycle.json](src/turn-lifecycle.json) | [evidence](evidence/turn-lifecycle/) |
| [parity-roadmap.html](parity-roadmap.html) | workflow | M0–M7 的里程碑与验收门；含 2026-11-06 审计快照 | [src/parity-roadmap.json](src/parity-roadmap.json) | [evidence](evidence/parity-roadmap/) |

current-architecture 与 parity-roadmap 已于 2026-11-06 用 Archify 3.0.1 重新生成，通过 `validate` + `deliver` + `check` + `browser-check`（Chrome for Testing 157，1440×900 桌面视口）；其余三张仍为 M0 基线。证据是 `*.finalize.json` / `*.browser-check.json`；不声称做过人工感知评审的部分会明确标注。

## 怎么打开

直接双击 HTML，或在浏览器打开本地路径。文件是自包含的；发给别人也不需要安装 Archify。

## 怎么重新生成

```sh
bash scripts/archify-visuals.sh
```

需要 `ARCHIFY_CHROME`；安装、环境与回滚见 [ARCHIFY.md](../ARCHIFY.md)。单张重生成：

```sh
node "$ARCHIFY_SKILL/bin/archify.mjs" finalize architecture \
  docs/visuals/src/current-architecture.json \
  docs/visuals/current-architecture.html --quality showcase --json
```

证据 sidecar 由输出路径拥有；同一路径二次 finalize 时用新的 `--out-dir`，不要复用旧证据。

## 版本限制

当前安装的适配器是 `@tt-a1i/archify-dsh@1.0.0`，内含 Archify 3.0.1，只支持 5 种图。ERD / class / tree / timeline / waterfall / 一页解释器要等 3.2.0 的适配器（1.1.0）发布；届时优先补：

- 记忆数据模型 ERD；
- 能力矩阵 tree；
- 里程碑 timeline；
- 面向用户的一页解释器。

## 维护约定

- 每个里程碑结束更新 `current-architecture` 与 `parity-roadmap`；M7 已更新两者，但 target-architecture 仍是 M1–M3 历史设计稿。
- 2026-11-06 的审计快照：61 项中 8 项用户豁免、47 项非 has/exempt；M7 发布门未关闭。
- 图必须与 `docs/research/GAP-AURABOT.md` 的状态一致；不一致时以代码/测试为准，并修图。
- 不把图当成实现证据；图只说明设计/结构。

C09 包隐私核验将既有证据 JSON 中的仓库绝对路径改为相对路径，工具安装/cache 根目录改为 `<tool-home>` 占位；只规范化机器路径，不改历史状态、时间、图表内容/hash 或重新运行浏览器。这些图表的历史 browser-check 不能作为 AstrBot 六区/Chat UI 的本轮真实浏览器证据，当前缺口见 [C09 验收](../architecture/ASTRBOT-ALIGNMENT-ACCEPTANCE.md)。
