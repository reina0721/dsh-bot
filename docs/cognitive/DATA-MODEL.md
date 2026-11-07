# 认知数据模型（DATA-MODEL）

> **实现说明（v0.4.0）**：下面的「逻辑表」是领域模型与目标 schema；当前 `src/cognition/store.js`
> 用一个通用物理表承载全部实体，而不是为每个逻辑表建独立 SQL 表：
>
> ```sql
> records(kind TEXT, id TEXT, created_at INTEGER, updated_at INTEGER,
>         person_id TEXT, scope_type TEXT, scope_id TEXT, status TEXT, data TEXT,
>         PRIMARY KEY(kind,id))
> fts(rowid, kind, record_id, text)
> raw(kind, dedupe_key, ...)
> meta(key, value)
> ```
>
> `kind` 对应下文逻辑表名（`person`/`relationship`/`memory`/`decision`/...），`data` 是 JSON；
> 常用字段同时提升为列以便过滤。这样 schema 演进不需要为每种实体写迁移；代价是跨实体 JOIN 交给
> service 层，而不是 SQL。FTS 检索用 `kind` 限制实体类型。迁移时若要拆分物理表，按本文件逻辑模型映射。

> 存储：SQLite（WAL、foreign_keys、FTS5）+ 原始事件 JSONL；旧环境 JSON fallback。  
> 所有表包含 `created_at`/`updated_at`（epoch ms）与 `version`（乐观并发，必要时）；内容字段统一 UTF-8 文本/JSON。

## 1. 标识与时间

- ID：`crypto.randomUUID()`；原始事件另有平台 `external_id` + `dedupe_key=platform:message_id`。
- 时间：`now()` 可注入；测试使用 FakeClock；所有时间戳为 UTC epoch ms，展示时用用户/面板时区。
- 作用域：`scope_type in ('global','group','private','topic')` + `scope_id`；`visibility`（normal/private/secret）+ `sensitivity`。
- 版本：`schema_version` 存 `meta`；实体 `version` 用于 CAS；`state_transitions` 记录关键变化。

## 2. 表

| 表 | 关键列 | 说明 |
|---|---|---|
| `meta` | key, value | schema_version、bot_id、created_at |
| `raw_events` | id, platform, external_id, kind, chat_type, chat_id, sender_id, message_id, payload_json, received_at, accepted, dedupe_key | 过滤前原始事件；append-only；JSONL 镜像 |
| `turns` | id, chat_type, chat_id, sender_id, message_ids_json, text, status(open/ready/closed/cancelled), started_at, soft_deadline, hard_deadline, close_reason, decision_id, generation_started_at | 聚合轮次；重启恢复 |
| `persons` | id, display_name, first_seen, last_seen, status(active/merged/deleted) | 内部人物实体 |
| `identities` | id, person_id, platform, platform_user_id, scope_type, scope_id, nickname, card, confidence, status, first_seen, last_seen | 身份证据，非真实人物 |
| `groups` | id, platform, platform_group_id, title, first_seen, last_seen | 群实体 |
| `group_members` | group_id, person_id, role, joined_at, last_seen, confidence | 群内角色 |
| `person_facets` | id, person_id, facet, value_json, evidence_kind(fact/self_report/observation/inference/hypothesis), scope_type, scope_id, confidence, source_kind, source_ref, status(active/outdated/disputed/deleted), version, observed_at | 分层画像 |
| `relationships` | id, person_id, scope_type, scope_id, affinity, familiarity, trust, intimacy, respect, wariness, conflict, comfort, initiative, stability, version, updated_at | 多维有向关系 |
| `relationship_events` | id, person_id, scope_type, scope_id, field, before, after, reason, evidence_json, created_at | 关系历史 |
| `persona_state` | id=1, traits_json, values_json, style_json, locked_json, updated_at, version | Bot 长期人格（单例） |
| `persona_history` | id, traits_json, values_json, style_json, reason, created_at | 慢演化历史 |
| `emotions` | id=1, valence, arousal, dominance, stress, fatigue, mood_valence, discrete_json, appraisal_json, updated_at | 当前情绪（单例） |
| `emotion_events` | id, delta_json, appraisal_json, source, created_at | 情绪事件流 |
| `memories` | id, type(episodic/semantic/emotional/social/procedural/self), scope_type, scope_id, person_id, chat_id, content, summary, salience, importance, confidence, valence, arousal, source_event_ids_json, stability, last_accessed, access_count, status(active/inactive/archived/deleted), version | 统一记忆；类型区分 |
| `memory_links` | id, from_id, to_id, relation, weight, confidence, source, created_at | 关联网络；双向查询 |
| `memories_fts` | memory_id, fts_text | FTS5；中文单字+二元组 |
| `beliefs` | id, subject, proposition, probability, evidence_json, status(fact/hypothesis/disputed/outdated), scope_type, scope_id, created_at, updated_at | 信念/推测 |
| `knowledge_claims` | id, concept, claim, definition, evidence_json, confidence, reliability, status(active/disputed/outdated), valid_from, valid_to, created_at, updated_at | 学习/语义知识 |
| `unknowns` | id, unknown_type, surface, context, person_id, chat_id, known_part, missing_part, hypothesis, confidence, priority, status(open/learning/resolved/deferred/failed), occurrences, created_at, updated_at | 知识缺口 |
| `learning_tasks` | id, unknown_id, plan_json, status(pending/running/done/failed/cancelled), attempts, next_run_at, budget_tokens, error, created_at, updated_at | 学习队列 |
| `learning_evidence` | id, task_id, source_id, url, title, fetched_at, excerpt, content_hash, reliability, stance, created_at | 证据 |
| `skills` | id, name, base_mastery, effective_mastery, confidence, uses, successes, failures, last_used, decay_tau, transfer_json, updated_at | 技能状态 |
| `skill_events` | id, skill_id, delta, reason, outcome_id, created_at | 技能历史 |
| `policies` | id, action, context_bucket, alpha, beta, trials, reward_sum, updated_at | 上下文 bandit |
| `decisions` | id, turn_id, action, context_json, candidates_json, features_json, expected_utility, confidence, status(pending/sent/skipped/failed), created_at | 策略选择 |
| `outcomes` | id, decision_id, observed_json, reward, attribution_confidence, created_at | 结果与归因 |
| `state_transitions` | id, entity, entity_id, field, before_json, after_json, reason, trace_id, created_at | 变化审计 |
| `traces` | id, turn_id, stage, summary_json, tokens, latency_ms, error, created_at | 管线 trace（脱敏） |
| `metrics` | id, name, value, labels_json, at | 计数/直方/趋势 |
| `proactive_intents` | id, target_person_id, chat_type, chat_id, reason, due_at, status, budget_key, created_at | 主动行为 |
| `audit_log` | id, actor(ui/autonomous/system), action, entity, detail_json, created_at | 管理/删除/重置审计 |

`decisions.status` 是兼容流程字段，实际还可能包含 `dry_run/observed`；它不是送达真相。闭环 v2 的真实投递语义与逻辑记录见第 6 节，待实现后从唯一 delivery receipt 读取 status/parts，不能据旧 decision 回填历史回执。

## 3. 关键接口

```js
// 存储层只暴露仓储；service 不得拼 SQL
createStore({ dir, clock, log }) -> {
  ready, close, tx(fn),
  raw: { append(event), listRecent(chat, limit), markAccepted(id) },
  turns: { upsert(turn), getOpen(), close(id, patch), linkDecision(id, decisionId) },
  persons, identities, groups, facets, relationships,
  persona, emotion, memories, links, beliefs, claims,
  unknowns, learning, skills, policies, decisions, outcomes,
  transitions, traces, metrics, proactive, audit,
  exportPerson(id), deletePerson(id), backup()
}
```

## 4. 隐私与删除

- `visibility`/`sensitivity` 在**写入时**校验；secret 永不进入 LLM。
- 检索强制 `scope` 过滤：群聊无法读私聊；第三方私密设定默认不向其他人表达。
- 显式删除：`deletePerson` 单事务级联删除 identities/facets/relationships/memory_links/memories(facets)/persona?（bot 人格不删）；learning 任务解除关联；保留脱敏 audit。
- 模拟遗忘：`status=inactive` + retrieval weight 衰减，不删除 DB 行；UI 区分「遗忘」与「删除」。
- 导出：人物/全局 JSON（含来源、时间、作用域），默认排除 secret；导出记 audit。
- 保留：raw 180d、traces 30d、decisions 90d、metrics 365d（可配）；清理任务记录指标。

## 5. 迁移与回滚

- `PRAGMA user_version`；迁移按顺序原子执行；迁移前 `VACUUM INTO backups/cognition-vN-<ts>.sqlite`。
- 失败：关闭写入、把错误暴露到 `/cognition/overview`，平台仍可运行；保留备份路径。
- JSON fallback：同一仓储接口，文件 `cognition-state.json`；明确 `storage=json-fallback`。

## 6. 闭环 v2 逻辑记录（C02 已批准，待实现）

权威 schema/枚举、API 与单写责任见 [ADR-019](../architecture/ADR-019-system-closed-loop.md)；模块健康与 runtimeGeneration 见 [ADR-018](../architecture/ADR-018-module-closed-loop.md)。以下为后续逻辑模型，不代表已有物理表、迁移或 API。

| 逻辑记录 | 关键字段与契约 |
| --- | --- |
| `loop` | version/id/personaId/kind/status/stage；turnId/decisionId/unknownId/taskId/firstDetectedTurnId/moduleId/runtimeGeneration 可为 null；startedAt/updatedAt/completedAt/reasonCode。kind 为 social/proactivity/research，status 为 running/completed/failed/interrupted |
| `receipt` | version/id/loopId/personaId/kind/eventId；turnId/decisionId/taskId/runtimeGeneration/attemptId 可为 null；occurredAt/recordedAt 与按 kind 白名单 data，不接受任意业务 JSON |
| delivery data | status 为 sent/partial/failed/dry_run/empty，parts 为实际成功条数，failedPart 为 0-based 或 null，errorCode 为固定码；核心统一交付适配器单写，沿用 ADR-006 |
| no_send data | WAIT/SILENCE/GATED/EMPTY_OUTPUT/CANCELLED/MODULE_DISABLED/STALE_CONTEXT 与固定 gateCode；未进入交付边界不虚构 failed delivery |
| feedback data | source/sourceEventId/attribution/attributionConfidence/observation/reward/outcomeId/policyUpdated；receipt、outcome、decision 关联与 policy 累计同一同步事务去重提交；unobserved 的 reward/outcomeId 为 null，policyUpdated 为 false，不更新 trials/alpha/beta |
| research data | status/unknownId/firstDetectedTurnId/evidenceCount/claimId/errorCode；首次检测仅记录真实 turn.id，重复检测不覆盖，旧数据缺失为 null，不推断或回填历史 |

上述记录仅含内部不透明关联 ID、固定码、时间与有界计数/分数，不含正文、prompt/模型输出、查询词、unknown surface/context、URL/证据、平台聊天/用户 ID、路径、凭据或原异常。反馈平台消息关联留在原人格私有业务映射。空值表示未观察/不适用，不等于 0、false 或已失败。

loop 与 receipt 每人格**合计**最多 5000 条，最长 7 天；先到任一上限即按最旧 loop 连同回执整组清理，更新不延长寿命，不能留下悬空引用。此特定保留策略优先于第 4 节其它实体的保留期，不删除原 decision/outcome/task/claim 或回滚 policy；GET 不执行清理且不返回超期数据。

写入捕获原人格及切换代次，跨 await 不写到新人格；查询、去重、删除与限额均隔离，删除人格删除观测历史，复制人格不复制运行观测记录。业务与外部 I/O 无跨系统原子性，回执缺失显示未知；初始化把遗留 running loop 标为 interrupted，保留已有回执，不自动重发/续跑，不承诺 exactly-once。模块 operation registry 则仅存在当前进程，不混入人格认知数据或反馈策略学习。
