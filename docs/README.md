# 文档导航

| 使用场景 | 文档 |
| --- | --- |
| 安装、升级、回退 | [安装指南](INSTALLATION.md) |
| 实机截图与可复现演示 | [DSH 实机演示](DEMO.md) |
| 从旧版升级 | [手动迁移](MIGRATION.md) |
| 连接、人格与面板 | [用户手册](USER-MANUAL.md) |
| 配置与数据位置 | [配置参考](CONFIG.md) |
| 安装本地模块 | [本地模块](MODULES.md) |
| 模型接入 | [模型网关](MODEL-GATEWAY.md) |
| 遇到问题 | [故障排查](TROUBLESHOOTING.md) |
| 开发与接口 | [架构契约](ARCHITECTURE.md) · [贡献指南](../CONTRIBUTING.md) |
| 闭环 v2（已批准、待实现） | [模块健康/所有权/人工恢复 ADR-018](architecture/ADR-018-module-closed-loop.md) · [系统关联/回执/反馈 ADR-019](architecture/ADR-019-system-closed-loop.md) |
| 验证与发布 | [发布指南](RELEASING.md) |
| 当前能力 | [实现状态](cognitive/IMPLEMENTATION-STATUS.md) · [覆盖矩阵](cognitive/COVERAGE-MATRIX.md) |
| 与 Aurabot 的差距 | [全量对标报告与路线图](research/GAP-AURABOT.md) |
| 视觉基线 | [Archify 视觉层](ARCHIFY.md) · [架构/流程/状态/路线图](visuals/README.md) |
| 响应式 UI 验收 | [导航、模块与保存栏契约及 pending 浏览器矩阵](design/responsive-navigation-modules.md) |
| 认知设计 | [能力地图](cognitive/CAPABILITY-MAP.md) · [数据模型](cognitive/DATA-MODEL.md) · [算法](cognitive/ALGORITHMS.md) · [决策记录](cognitive/DECISIONS.md) |
| 研究与长期目标 | [项目愿景](research/VISION.md) · [OneBot 生态](research/ONEBOT-ECOSYSTEM.md) · [认知研究](cognitive/RESEARCH.md) |
| 历史验证 | [归档说明](archive/README.md) |

用户指南描述当前版本；研究和愿景不代表已经实现。历史证据只证明当时版本与环境下的验证结果。

C02 仅冻结闭环 v2 文档契约：模块健康读取缓存，固定人工 restart 经操作去重与排空；系统回执无正文、按人格限 7 天/5000 条，发送以 ADR-006 为准，未观察反馈不算负面、研究不编造首次历史。新增 API/UI 与存储尚未实现，既有外部恢复和管理信任边界保持。
