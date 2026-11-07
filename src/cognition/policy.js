// 行为策略：候选动作 → 风险/关系/情绪/人格/成本打分 → 选择 → 结果观察。
//
// 策略与实际结果分离：decision 记录选择时的候选与特征，outcome 单独记录后续观察；
// 单次结果只做小幅 Beta 更新，不把偶然反馈当永久真理。沉默/等待是一等动作。

import { clamp, round, uid, hourKey } from './util.js'

export const ACTION_LABELS = {
  reply: '回复',
  reply_short: '简短回复',
  clarify: '澄清',
  comfort: '关心/安慰',
  tease: '调侃',
  serious: '严肃回应',
  change_topic: '转移话题',
  wait: '等待',
  silence: '沉默',
  react: '表情反应',
  learn: '记录并学习',
  recall_tease: '调侃撤回',
  recall_concern: '关心撤回',
  recall_probe: '试探撤回',
  recall_silence: '假装没注意',
  recall_ignore: '完全忽略',
  proactive: '主动发起',
}

export function contextBucket({ turn, relationship, emotion, appraisal, unknown } = {}) {
  const chat = turn?.chatType || 'other'
  const addressed = turn?.addressed ? 'addr' : 'ambient'
  const rel = relationship ? (relationship.trust > 0.65 ? 'trust_hi' : relationship.trust < 0.3 ? 'trust_lo' : 'trust_mid') : 'trust_none'
  const mood = emotion ? (emotion.valence > 0.2 ? 'pos' : emotion.valence < -0.2 ? 'neg' : 'neutral') : 'neutral'
  const gap = unknown ? 'gap' : 'known'
  const intent = appraisal?.intent || 'chat'
  return `${chat}:${addressed}:${rel}:${mood}:${gap}:${intent}`
}

export function buildCandidates({ turn, relationship, emotion, appraisal, unknown, memories, persona, skills = {}, config = {}, recall = null } = {}) {
  const c = config.policy || {}
  const addressed = Boolean(turn?.addressed)
  const groupEngaged = Boolean(turn?.groupEngaged)
  const valence = Number(emotion?.valence || 0)
  const stress = Number(emotion?.stress || 0)
  const trust = Number(relationship?.trust ?? 0.3)
  const affinity = Number(relationship?.affinity ?? 0.05)
  const conflict = Number(relationship?.conflict || 0)
  const humor = Number(persona?.traits?.humor ?? 0.5)
  const caution = Number(persona?.traits?.caution ?? 0.5)
  const novelty = Number(appraisal?.novelty || 0)
  const risk = Number(appraisal?.risk || 0)
  const teasingSkill = Number(skills.teasing ?? 0.45)
  const empathySkill = Number(skills.empathy ?? 0.45)
  const conflictSkill = Number(skills.conflict_repair ?? 0.35)
  const candidates = []

  const push = (action, utility, reason, gates = []) => candidates.push({ action, label: ACTION_LABELS[action] || action, utility: round(utility, 4), reason, gates })

  if (recall) {
    const saw = Boolean(recall.sawContent)
    const base = 0.38 + (addressed ? 0.1 : 0) + (affinity > 0.3 ? 0.08 : 0) - conflict * 0.15 - risk * 0.2
    if (saw) {
      push('recall_tease', base + humor * 0.18 + (trust > 0.55 ? 0.1 : -0.05) - caution * 0.12 + (teasingSkill - 0.45) * 0.1, '看见了内容，关系/幽默允许调侃')
      push('recall_concern', base + 0.08 + Math.max(0, -valence) * 0.1 + (empathySkill - 0.45) * 0.1, '关心对方撤回的原因')
      push('recall_probe', base + 0.02 + novelty * 0.05, '试探但不直接提内容')
    } else {
      push('recall_concern', base + 0.12 + (empathySkill - 0.45) * 0.1, '未看见内容，只能关心/询问')
      push('recall_probe', base + 0.06, '未看见内容，试探')
    }
    push('recall_silence', 0.42 + (addressed ? -0.15 : 0.1), '假装没注意，避免压力')
    push('recall_ignore', 0.3 + (addressed ? -0.1 : 0.1), '完全忽略')
    return candidates.sort((a, b) => b.utility - a.utility)
  }

  push('reply', 0.5 + (addressed ? Number(c.addressedBoost ?? 0.15) : groupEngaged ? 0 : -Number(c.groupPenalty ?? 0.1))
    + trust * 0.12 + affinity * 0.08 + valence * 0.06 - conflict * 0.12 - risk * 0.15 + (memories?.length ? 0.02 : 0),
  '普通回复：维持交流/回应目标')
  push('reply_short', 0.46 + (addressed ? 0.1 : groupEngaged ? 0 : -0.06) + (stress > 0.5 ? 0.06 : 0) - conflict * 0.06,
    '简短回应：低能量/低信息量')
  if (unknown || (appraisal?.confidence != null && appraisal.confidence < 0.45)) {
    push('clarify', 0.47 + (addressed ? 0.12 : 0) + (novelty * 0.08), '理解置信度低，先澄清而不是编造')
    push('learn', 0.4 + (config.learning?.enabled ? 0.1 : -0.3), '存在知识缺口，记录/学习')
  }
  if (valence < -0.15 || Number(appraisal?.otherDistress || 0) > 0.4) {
    push('comfort', 0.48 + Math.abs(Math.min(0, valence)) * 0.18 + trust * 0.08 + (empathySkill - 0.45) * 0.12, '对方/情境负面，优先关心')
    push('serious', 0.4 + Math.abs(Math.min(0, valence)) * 0.1, '降低玩笑尺度')
  }
  if (humor > 0.45 && affinity > 0.1 && trust > 0.4 && risk < 0.45 && conflict < 0.35 && valence > -0.25 && !appraisal?.serious) {
    push('tease', 0.34 + humor * 0.18 + affinity * 0.1 + trust * 0.06 - caution * 0.1 - risk * 0.2 + (teasingSkill - 0.45) * 0.14, '关系允许且风险低，可以轻调侃')
  }
  if (conflict > 0.35) {
    push('serious', 0.46 + conflict * 0.12 + (conflictSkill - 0.35) * 0.1, '冲突升高，降低玩笑、认真处理')
  }
  if (Number(appraisal?.topicExhausted || 0) > 0.5 || (memories?.length === 0 && !addressed)) {
    push('change_topic', 0.33 + novelty * 0.05, '话题枯竭/无相关记忆')
  }
  push('wait', Number(c.waitThreshold ?? 0.38) + 0.12 + (turn?.completeness != null && turn.completeness < 0.6 ? 0.1 : 0) - stress * 0.05,
    '等待更多信息/不打断')
  push('silence', Number(c.silenceThreshold ?? 0.3) + (addressed ? -0.12 : groupEngaged ? -0.04 : 0.12) + conflict * 0.05 - (valence > 0.2 ? 0.05 : 0),
    '保持沉默，不打扰')
  if (stress > 0.55) {
    for (const item of candidates) if (['tease', 'reply'].includes(item.action)) item.utility = round(item.utility - 0.06, 4)
  }
  return candidates.sort((a, b) => b.utility - a.utility)
}

export function utilityToProbability(utility) {
  return round(1 / (1 + Math.exp(-(utility - 0.45) * 6)), 4)
}

export function chooseAction(candidates, { config = {}, rng = Math.random, addressed = false, groupEngaged = false, contextKey = '' } = {}) {
  const c = config.policy || {}
  const epsilon = clamp(Number(c.epsilon ?? 0.04), 0, 0.2)
  const scored = candidates.map((candidate) => ({
    ...candidate,
    probability: utilityToProbability(candidate.utility),
    bandit: 0.5,
    final: candidate.utility,
  }))
  // 低风险探索：只在 reply/wait/silence 之间轻微扰动，不随机化安全/关系敏感动作。
  if (rng() < epsilon) {
    const safe = scored.filter((item) => ['reply', 'reply_short', 'wait', 'silence'].includes(item.action))
    if (safe.length) {
      const pick = safe[Math.floor(rng() * safe.length)]
      pick.explored = true
      pick.final = round(pick.utility + 0.03, 4)
    }
  }
  scored.sort((a, b) => b.final - a.final)
  const best = scored[0]
  const replyCandidates = scored.filter((item) => ['reply', 'reply_short', 'clarify', 'comfort', 'tease', 'serious', 'change_topic', 'recall_tease', 'recall_concern', 'recall_probe'].includes(item.action))
  const bestReply = replyCandidates[0]
  const threshold = Number(c.replyThreshold ?? 0.52) + (addressed ? -Number(c.addressedBoost ?? 0.15) : groupEngaged ? 0 : Number(c.groupPenalty ?? 0))
  let action = 'silence'
  let chosen = scored.find((item) => item.action === 'silence') || best
  if (bestReply && bestReply.utility >= threshold) {
    chosen = bestReply
    action = bestReply.action
  } else if ((scored.find((item) => item.action === 'wait')?.utility || 0) >= Number(c.waitThreshold ?? 0.38) && !addressed && !groupEngaged) {
    chosen = scored.find((item) => item.action === 'wait')
    action = 'wait'
  } else if (best.action === 'silence' || best.action === 'wait') {
    chosen = best
    action = best.action
  } else if (bestReply && bestReply.utility > Number(c.silenceThreshold ?? 0.3)) {
    chosen = bestReply
    action = bestReply.action
  }
  return {
    action,
    chosen,
    candidates: scored,
    confidence: round(clamp(chosen.probability || chosen.utility, 0, 1), 3),
    contextKey,
    expectedUtility: chosen.utility,
    explored: Boolean(chosen.explored),
  }
}

export function inferReward(observation = {}) {
  let reward = 0
  if (observation.explicitCorrection) reward -= 0.8
  if (observation.userContinued) reward += 0.15
  if (observation.userIgnored) reward -= 0.15
  if (Number.isFinite(observation.sentiment)) reward += clamp(Number(observation.sentiment), -1, 1) * 0.35
  if (observation.recalled) reward -= 0.2
  if (observation.safetyViolation) reward -= 1
  if (observation.positiveReaction) reward += 0.3
  return round(clamp(reward, -1, 1), 3)
}

export function createPolicyService({ store, getConfig, clock, rng = Math.random, observer = null } = {}) {
  const cfg = () => getConfig()?.cognition || {}

  function rateSnapshot(chatType, chatId, now = clock.now()) {
    const hour = hourKey(now)
    const sent = store.list('decision', { limit: 5000, where: (item) => item.status === 'sent' && Number(item.atHour) === hour })
    const globalCount = sent.length
    const chatCount = sent.filter((item) => item.chatType === chatType && String(item.chatId || '') === String(chatId || '')).length
    return { globalCount, chatCount }
  }

  function canSend(chatType, chatId, now = clock.now()) {
    const c = cfg()
    const { globalCount, chatCount } = rateSnapshot(chatType, chatId, now)
    if (globalCount >= Number(c.policy?.dailyGlobalLimit ?? 120)) return { ok: false, reason: 'global_rate_limit' }
    const limit = chatType === 'group' ? Number(c.policy?.perChatGroup ?? 10) : Number(c.policy?.perChatPrivate ?? 30)
    if (chatCount >= limit) return { ok: false, reason: 'chat_rate_limit' }
    return { ok: true }
  }

  function betaFor(action, contextKey) {
    const id = `${action}:${contextKey}`
    const record = store.get('policy', id) || { alpha: 1, beta: 1, trials: 0, rewardSum: 0 }
    return { id, record, mean: record.alpha / (record.alpha + record.beta) }
  }

  function decide({ turn, relationship, emotion, appraisal, unknown, memories, persona, skills = {}, recall = null } = {}) {
    const c = cfg()
    const contextKey = contextBucket({ turn, relationship, emotion, appraisal, unknown })
    const candidates = buildCandidates({ turn, relationship, emotion, appraisal, unknown, memories, persona, skills, config: c, recall })
    const adjusted = candidates.map((candidate) => {
      const beta = betaFor(candidate.action, contextKey)
      return { ...candidate, bandit: round(beta.mean, 3), utility: round(candidate.utility + (beta.mean - 0.5) * 0.12, 4) }
    })
    const gate = canSend(turn?.chatType, turn?.chatId)
    const choice = chooseAction(adjusted, {
      config: c, rng, addressed: Boolean(turn?.addressed), groupEngaged: Boolean(turn?.groupEngaged), contextKey,
    })
    if (!gate.ok && ['reply', 'reply_short', 'clarify', 'comfort', 'tease', 'serious', 'change_topic', 'recall_tease', 'recall_concern', 'recall_probe'].includes(choice.action)) {
      const silence = choice.candidates.find((item) => item.action === 'silence') || { action: 'silence', utility: 0.3, probability: 0.3 }
      choice.action = 'silence'
      choice.chosen = silence
      choice.gated = gate.reason
    }
    const at = clock.now()
    const decision = {
      id: uid('decision'),
      turnId: turn?.id || '',
      chatType: turn?.chatType || '',
      chatId: String(turn?.chatId || ''),
      personId: relationship?.personId || '',
      action: choice.action,
      contextKey,
      candidates: choice.candidates,
      features: {
        addressed: Boolean(turn?.addressed), groupEngaged: Boolean(turn?.groupEngaged), completeness: turn?.completeness,
        valence: emotion?.valence, stress: emotion?.stress,
        trust: relationship?.trust, affinity: relationship?.affinity, conflict: relationship?.conflict,
        recall: recall ? { sawContent: Boolean(recall.sawContent), messageId: recall.messageId } : null,
      },
      expectedUtility: choice.expectedUtility,
      confidence: choice.confidence,
      reason: choice.chosen?.reason || '',
      explored: choice.explored,
      gated: choice.gated || '',
      status: 'pending',
      atHour: hourKey(at),
      createdAt: at,
      updatedAt: at,
    }
    store.put('decision', decision.id, decision)
    return decision
  }

  function markSent(decisionId, { messageId = '', dryRun = false } = {}) {
    const decision = store.get('decision', decisionId)
    if (!decision) return null
    const next = { ...decision, status: dryRun ? 'dry_run' : 'sent', sentAt: clock.now(), messageId: String(messageId || ''), updatedAt: clock.now() }
    store.put('decision', decisionId, next)
    return next
  }

  function markFailed(decisionId, error) {
    const decision = store.get('decision', decisionId)
    if (!decision) return null
    const next = { ...decision, status: 'failed', error: String(error || '').slice(0, 500), updatedAt: clock.now() }
    store.put('decision', decisionId, next)
    return next
  }

  function recordOutcome(decisionId, observation = {}, { source = 'unknown', dedupeKey } = {}) {
    if (typeof decisionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(decisionId)
      || !['incoming', 'reaction', 'manual', 'unknown'].includes(source)
      || typeof dedupeKey !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/.test(dedupeKey)
      || !observation || typeof observation !== 'object' || Array.isArray(observation)) throw Error('FEEDBACK_QUERY_INVALID')
    const booleanKeys = ['explicitCorrection', 'userContinued', 'userIgnored', 'recalled', 'safetyViolation', 'positiveReaction']
    if (Object.keys(observation).some(key => ![...booleanKeys, 'sentiment', 'attribution', 'attributionConfidence', 'observation'].includes(key))
      || booleanKeys.some(key => observation[key] != null && typeof observation[key] !== 'boolean')
      || ['sentiment', 'attributionConfidence'].some(key => observation[key] != null && !Number.isFinite(observation[key]))
      || (observation.attribution != null && !['direct', 'heuristic', 'unobserved'].includes(observation.attribution))
      || (observation.observation != null && !['positive', 'negative', 'neutral', 'unobserved'].includes(observation.observation))) throw Error('FEEDBACK_QUERY_INVALID')
    const observed = Object.fromEntries(booleanKeys.map(key => [key, observation[key] === true]))
    observed.sentiment = clamp(observation.sentiment ?? 0, -1, 1)
    const unobserved = observation.observation === 'unobserved' || observation.attribution === 'unobserved'
    const attribution = unobserved ? 'unobserved' : ['incoming', 'unknown'].includes(source) ? 'heuristic' : observation.attribution || (source === 'manual' ? 'direct' : 'heuristic')
    const attributionConfidence = clamp(observation.attributionConfidence ?? 0.5, 0, 1)
    // Expiry/no observation is not a policy trial, including a neutral trial.
    if (unobserved) return { id: null, decisionId, reward: null, policyUpdated: false, source, attribution, attributionConfidence }
    if (store.atomicTransactions !== true || !observer?.commitFeedback || !observer?.ownsFeedbackStore?.(store)) throw Error('FEEDBACK_ATOMICITY_UNAVAILABLE')
    const duplicate = () => store.list('outcome', { limit: 1, where: o => o.decisionId === decisionId && o.dedupeKey === dedupeKey })[0]
    const prior = duplicate()
    if (prior) return prior // Business dedupe survives short-lived observation eviction.
    return observer.commitFeedback(decisionId, () => {
      const prior = duplicate()
      if (prior) return { duplicate: true, outcome: prior }
      const decision = store.get('decision', decisionId)
      if (!decision) throw Error('FEEDBACK_DECISION_NOT_FOUND')
      const reward = inferReward(observed)
      const beta = betaFor(decision.action, decision.contextKey)
      const snapshot = record => ({ alpha: record.alpha, beta: record.beta, trials: record.trials || 0, rewardSum: record.rewardSum || 0 })
      const before = snapshot(beta.record)
      const success = reward > 0 ? 1 : reward < 0 ? 0 : 0.5
      const after = { alpha: round(before.alpha + success, 3), beta: round(before.beta + (1 - success), 3),
        trials: before.trials + 1, rewardSum: round(before.rewardSum + reward, 3) }
      const outcome = { id: uid('outcome'), decisionId, observed, reward, source, dedupeKey,
        sourceEventId: uid('observation'), attribution, attributionConfidence,
        policyUpdated: true, policyBefore: before, policyAfter: after, createdAt: clock.now() }
      store.put('outcome', outcome.id, outcome)
      store.put('decision', decisionId, { ...decision, status: 'observed', reward, outcomeId: outcome.id, updatedAt: clock.now() })
      store.put('policy', beta.id, { id: beta.id, action: decision.action, contextKey: decision.contextKey, ...after, updatedAt: clock.now() })
      return { outcome, data: { source, sourceEventId: outcome.sourceEventId, attribution, attributionConfidence,
        observation: reward > 0 ? 'positive' : reward < 0 ? 'negative' : 'neutral', reward, outcomeId: outcome.id, policyUpdated: true } }
    })
  }

  function history({ limit = 50 } = {}) {
    return store.list('decision', { limit: Number(limit) || 50 })
  }

  function stats() {
    const decisions = store.list('decision', { limit: 5000 })
    const policies = store.list('policy', { limit: 1000 })
    const sent = decisions.filter((item) => ['sent', 'dry_run'].includes(item.status))
    return {
      total: decisions.length,
      sent: sent.length,
      byAction: decisions.reduce((acc, item) => { acc[item.action] = (acc[item.action] || 0) + 1; return acc }, {}),
      silent: decisions.filter((item) => item.action === 'silence').length,
      wait: decisions.filter((item) => item.action === 'wait').length,
      averageReward: round(decisions.filter((item) => Number.isFinite(item.reward)).reduce((sum, item) => sum + item.reward, 0) / Math.max(1, decisions.filter((item) => Number.isFinite(item.reward)).length), 3),
      policies: policies.sort((a, b) => (b.trials || 0) - (a.trials || 0)).slice(0, 20),
    }
  }

  function resetLearning() {
    for (const record of store.list('policy', { limit: 100000 })) store.remove('policy', record.id)
    return { ok: true }
  }

  return { decide, markSent, markFailed, recordOutcome, inferReward, history, stats, resetLearning, canSend, rateSnapshot, betaFor }
}
