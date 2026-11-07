// Bot 长期人格：稳定特质、价值边界、表达风格，以及操作者可编辑的文本人设。
// 状态独立于情绪/关系/技能；单次互动不能改变；演化有速率上限与历史。

import { clamp, deepClone, round, uid } from './util.js'

export const TRAIT_KEYS = [
  'extraversion', 'openness', 'agreeableness', 'conscientiousness', 'emotionalSensitivity',
  'humor', 'socialInitiative', 'caution', 'expressiveness', 'conflictApproach',
  'riskTolerance', 'consistency',
]
export const STYLE_KEYS = ['formality', 'verbosity', 'emojiRate', 'punctuation', 'teasingBound', 'warmth']

export const PROFILE_TEXT_LIMITS = {
  displayName: 40,
  tagline: 120,
  identity: 300,
  background: 1500,
  personality: 1000,
  speakingStyle: 800,
  examples: 1500,
}
export const PROFILE_TEXT_FIELDS = Object.keys(PROFILE_TEXT_LIMITS)
export const PROFILE_LIST_FIELDS = ['likes', 'dislikes', 'boundaries']
export const PROFILE_LIST_MAX_ITEMS = 20
export const PROFILE_LIST_ITEM_MAX = 80
export const PROFILE_PROMPT_MAX_CHARS = 2000
export const PERSONA_ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

const SINGLE_LINE_FIELDS = new Set(['displayName', 'tagline', 'identity'])

function cleanText(value, max, { multiline = false } = {}) {
  let text = String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
  if (!multiline) text = text.replace(/\s+/g, ' ')
  const chars = [...text]
  if (chars.length > max) text = chars.slice(0, max).join('').trimEnd()
  return text
}

function cleanList(value, maxItems = PROFILE_LIST_MAX_ITEMS, itemMax = PROFILE_LIST_ITEM_MAX) {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const items = []
  for (const item of value) {
    const text = cleanText(item, itemMax)
    if (!text || seen.has(text)) continue
    seen.add(text)
    items.push(text)
    if (items.length >= maxItems) break
  }
  return items
}

export function defaultProfile(config = {}) {
  const source = config.persona?.profile && typeof config.persona.profile === 'object' ? config.persona.profile : {}
  const profile = {}
  for (const key of PROFILE_TEXT_FIELDS) profile[key] = cleanText(source[key], PROFILE_TEXT_LIMITS[key], { multiline: !SINGLE_LINE_FIELDS.has(key) })
  for (const key of PROFILE_LIST_FIELDS) profile[key] = cleanList(source[key])
  return profile
}

export function sanitizeProfile(input, config = {}) {
  const base = defaultProfile(config)
  const source = input && typeof input === 'object' ? input : {}
  const profile = {}
  for (const key of PROFILE_TEXT_FIELDS) {
    profile[key] = source[key] === undefined
      ? base[key]
      : cleanText(source[key], PROFILE_TEXT_LIMITS[key], { multiline: !SINGLE_LINE_FIELDS.has(key) })
  }
  for (const key of PROFILE_LIST_FIELDS) {
    profile[key] = source[key] === undefined ? base[key] : cleanList(source[key])
  }
  return profile
}

export function personaProfileText(profile, { maxChars = PROFILE_PROMPT_MAX_CHARS } = {}) {
  const p = profile || {}
  const lines = []
  if (p.displayName) lines.push(`名字/自称：${p.displayName}`)
  if (p.tagline) lines.push(`一句话介绍：${p.tagline}`)
  if (p.identity) lines.push(`身份：${p.identity}`)
  if (p.background) lines.push(`背景：${p.background}`)
  if (p.personality) lines.push(`性格：${p.personality}`)
  if (p.speakingStyle) lines.push(`说话风格：${p.speakingStyle}`)
  if (Array.isArray(p.likes) && p.likes.length) lines.push(`喜欢：${p.likes.join('、')}`)
  if (Array.isArray(p.dislikes) && p.dislikes.length) lines.push(`不喜欢：${p.dislikes.join('、')}`)
  if (Array.isArray(p.boundaries) && p.boundaries.length) lines.push(`边界/禁忌：${p.boundaries.join('、')}`)
  if (p.examples) lines.push(`示例对话（参考语气，不要照抄）：${p.examples}`)
  const text = lines.join('\n')
  const chars = [...text]
  const limit = Math.max(0, Number(maxChars) || PROFILE_PROMPT_MAX_CHARS)
  if (chars.length <= limit) return text
  return chars.slice(0, Math.max(0, limit - 1)).join('').trimEnd() + '…'
}

export function sanitizePersonaId(value, fallback = 'self') {
  const id = String(value || '')
  return PERSONA_ID_RE.test(id) ? id : fallback
}

export function defaultPersona(config = {}) {
  const persona = config.persona || {}
  const traits = {}
  for (const key of TRAIT_KEYS) traits[key] = clamp(persona.traits?.[key] ?? 0.5, 0.1, 0.9)
  const style = {}
  for (const key of STYLE_KEYS) style[key] = clamp(persona.style?.[key] ?? 0.5, 0, 1)
  return {
    id: 'self',
    traits,
    style,
    values: Array.isArray(persona.values) ? [...persona.values] : [],
    profile: defaultProfile(config),
    locked: [],
    history: [],
    version: 1,
  }
}

export function sanitizePersona(input, config = {}) {
  const base = defaultPersona(config)
  const src = input && typeof input === 'object' ? input : {}
  const traits = {}
  for (const key of TRAIT_KEYS) traits[key] = clamp(src.traits?.[key] ?? base.traits[key], 0.1, 0.9)
  const style = {}
  for (const key of STYLE_KEYS) style[key] = clamp(src.style?.[key] ?? base.style[key], 0, 1)
  return {
    ...base,
    ...deepClone(src),
    id: sanitizePersonaId(src.id, 'self'),
    traits,
    style,
    profile: sanitizeProfile(src.profile, config),
    values: Array.isArray(src.values) ? src.values.map(String).slice(0, 30) : base.values,
    locked: Array.isArray(src.locked) ? src.locked.filter((key) => TRAIT_KEYS.includes(key) || STYLE_KEYS.includes(key)) : [],
    history: Array.isArray(src.history) ? src.history.slice(-100) : [],
    version: Math.max(1, Number(src.version) || 1),
    createdAt: Number(src.createdAt) || 0,
    updatedAt: Number(src.updatedAt) || 0,
  }
}

/** 长期慢演化：evidence 是 [-1,1] 的目标偏移；每天最多 evolutionPerDay。 */
export function evolvePersona(persona, evidence = {}, { config = {}, elapsedDays = 1, now = Date.now() } = {}) {
  const cfg = config.persona || {}
  if (cfg.evolutionEnabled === false) return persona
  const maxDelta = clamp(Number(cfg.evolutionPerDay ?? 0.005) * Math.max(0, elapsedDays), 0, 0.05)
  const next = deepClone(persona)
  const changes = []
  for (const key of TRAIT_KEYS) {
    if (next.locked.includes(key)) continue
    const delta = Number(evidence[key])
    if (!Number.isFinite(delta) || delta === 0) continue
    const bounded = clamp(delta, -1, 1) * maxDelta
    const before = next.traits[key]
    next.traits[key] = round(clamp(before + bounded, 0.1, 0.9), 4)
    if (next.traits[key] !== before) changes.push({ key, before, after: next.traits[key] })
  }
  if (changes.length) {
    next.version += 1
    next.history.push({ at: now, changes, reason: 'slow_evolution' })
    next.history = next.history.slice(-100)
  }
  return next
}

export function applyPersonaEdit(persona, patch = {}, { now = Date.now() } = {}) {
  const next = deepClone(persona)
  const changes = []
  for (const key of TRAIT_KEYS) {
    if (patch.traits?.[key] === undefined) continue
    const before = next.traits[key]
    next.traits[key] = round(clamp(Number(patch.traits[key]), 0.1, 0.9), 4)
    if (before !== next.traits[key]) changes.push({ key: `traits.${key}`, before, after: next.traits[key] })
  }
  for (const key of STYLE_KEYS) {
    if (patch.style?.[key] === undefined) continue
    const before = next.style[key]
    next.style[key] = round(clamp(Number(patch.style[key]), 0, 1), 4)
    if (before !== next.style[key]) changes.push({ key: `style.${key}`, before, after: next.style[key] })
  }
  if (patch.profile && typeof patch.profile === 'object') {
    if (!next.profile || typeof next.profile !== 'object') next.profile = defaultProfile()
    for (const key of PROFILE_TEXT_FIELDS) {
      if (patch.profile[key] === undefined) continue
      const before = String(next.profile[key] || '')
      const after = cleanText(patch.profile[key], PROFILE_TEXT_LIMITS[key], { multiline: !SINGLE_LINE_FIELDS.has(key) })
      if (before !== after) {
        next.profile[key] = after
        changes.push({ key: `profile.${key}`, before, after })
      }
    }
    for (const key of PROFILE_LIST_FIELDS) {
      if (patch.profile[key] === undefined) continue
      const before = Array.isArray(next.profile[key]) ? next.profile[key] : []
      const after = cleanList(patch.profile[key])
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        next.profile[key] = after
        changes.push({ key: `profile.${key}`, before: [...before], after: [...after] })
      }
    }
  }
  if (Array.isArray(patch.values)) next.values = patch.values.map(String).slice(0, 30)
  if (Array.isArray(patch.locked)) next.locked = patch.locked.filter((key) => TRAIT_KEYS.includes(key) || STYLE_KEYS.includes(key))
  if (patch.locked) {
    for (const key of patch.locked) if (TRAIT_KEYS.includes(key) || STYLE_KEYS.includes(key)) {
      if (!next.locked.includes(key)) next.locked.push(key)
    }
  }
  if (patch.unlock) {
    next.locked = next.locked.filter((key) => !patch.unlock.includes(key))
  }
  if (changes.length || patch.values || patch.locked) {
    next.version += 1
    next.history.push({ at: now, changes, reason: patch.reason || 'user_edit' })
    next.history = next.history.slice(-100)
  }
  return { persona: next, changes }
}

export function personaSummary(persona) {
  const t = persona?.traits || {}
  const profile = persona?.profile || {}
  return {
    openness: t.openness,
    humor: t.humor,
    caution: t.caution,
    socialInitiative: t.socialInitiative,
    warmth: persona?.style?.warmth,
    formality: persona?.style?.formality,
    values: Array.isArray(persona?.values) ? persona.values.slice(0, 8) : [],
    version: persona?.version || 1,
    profile: {
      displayName: profile.displayName || '',
      tagline: profile.tagline || '',
      identity: profile.identity || '',
      personality: profile.personality || '',
      speakingStyle: profile.speakingStyle || '',
      boundaries: Array.isArray(profile.boundaries) ? profile.boundaries.slice(0, 8) : [],
    },
    hasProfile: Object.values(profile).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim())),
  }
}

export function personaPublicItem(persona, activeId = '') {
  const profile = persona?.profile || {}
  return {
    id: persona?.id || 'self',
    displayName: profile.displayName || '',
    tagline: profile.tagline || '',
    version: Number(persona?.version) || 1,
    active: persona?.id === activeId,
    hasProfile: Object.values(profile).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(String(value || '').trim())),
    source: persona?.source ? { repo: persona.source.repo || '', commit: persona.source.commit || '', version: persona.source.version || '' } : null,
    createdAt: Number(persona?.createdAt) || 0,
    updatedAt: Number(persona?.updatedAt) || 0,
  }
}

export function createPersonaService({ store, getConfig, clock }) {
  const cfg = () => getConfig()?.cognition || {}
  const activeSettingKey = 'persona.activeId'
  let scopeGeneration = 0

  function readActiveId() {
    try {
      const record = store.get('setting', activeSettingKey)
      return sanitizePersonaId(record?.value, '')
    } catch (error) {
      return ''
    }
  }

  function writeActiveId(id) {
    if (readActiveId() !== id) scopeGeneration++
    store.put('setting', activeSettingKey, { value: id, at: clock.now() })
  }

  function records() {
    try {
      return store.list('persona', { limit: 1000 })
        .map((item) => sanitizePersona(item, cfg()))
        .sort((a, b) => (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0) || a.id.localeCompare(b.id))
    } catch (error) {
      return []
    }
  }

  function getById(id) {
    const wanted = sanitizePersonaId(id, '')
    if (!wanted) return null
    const existing = store.get('persona', wanted)
    return existing ? sanitizePersona(existing, cfg()) : null
  }

  function ensureActiveId() {
    const recordsNow = records()
    let active = readActiveId()
    if (active && recordsNow.some((item) => item.id === active)) return active
    active = recordsNow.find((item) => item.id === 'self')?.id || recordsNow[0]?.id || ''
    if (!active) {
      const now = clock.now()
      const persona = sanitizePersona({
        ...defaultPersona(cfg()),
        id: 'self',
        createdAt: now,
        updatedAt: now,
        history: [{ at: now, changes: [], reason: 'created' }],
      }, cfg())
      store.put('persona', 'self', persona)
      active = 'self'
    }
    writeActiveId(active)
    return active
  }

  function ensure() {
    const active = ensureActiveId()
    return getById(active) || getById('self')
  }

  function list() {
    const active = ensureActiveId()
    return records().map((item) => personaPublicItem(item, active))
  }

  function save(next, reason = 'update', personaId = '') {
    const active = ensureActiveId()
    const id = sanitizePersonaId(personaId || next?.id, active)
    const previous = getById(id)
    const now = clock.now()
    const persona = sanitizePersona({
      ...next,
      id,
      createdAt: Number(next?.createdAt) || Number(previous?.createdAt) || now,
      updatedAt: now,
    }, cfg())
    store.put('persona', id, { ...persona, reason, at: now })
    return store.get('persona', id)
  }

  function create({ name = '', copyFrom = '', activate = true, profile = null, traits = null, style = null, values = null, locked = null, source = null, reason = '' } = {}) {
    const active = ensureActiveId()
    const fromPersona = copyFrom ? getById(copyFrom === 'active' ? active : copyFrom) : null
    const now = clock.now()
    const id = uid('persona')
    const count = records().length
    const base = fromPersona ? deepClone(fromPersona) : defaultPersona(cfg())
    const patchProfile = profile && typeof profile === 'object' ? profile : {}
    const displayName = cleanText(name, PROFILE_TEXT_LIMITS.displayName)
      || cleanText(patchProfile.displayName, PROFILE_TEXT_LIMITS.displayName)
      || (fromPersona ? `${fromPersona.profile?.displayName || '人格'} 副本` : `人格 ${count + 1}`)
    const patchTraits = traits && typeof traits === 'object' ? traits : {}
    const patchStyle = style && typeof style === 'object' ? style : {}
    const mergedTraits = {}
    for (const key of TRAIT_KEYS) mergedTraits[key] = Number(patchTraits[key] ?? base.traits?.[key] ?? 0.5)
    const mergedStyle = {}
    for (const key of STYLE_KEYS) mergedStyle[key] = Number(patchStyle[key] ?? base.style?.[key] ?? 0.5)
    const imported = Boolean(source && (source.repo || source.repoUrl || source.format || source.file))
    const historyReason = imported ? 'imported' : (fromPersona ? 'duplicated' : 'created')
    const persona = sanitizePersona({
      ...base,
      id,
      profile: { ...(base.profile || {}), ...patchProfile, displayName },
      traits: mergedTraits,
      style: mergedStyle,
      values: Array.isArray(values) ? values : base.values,
      locked: Array.isArray(locked) ? locked : (fromPersona ? [...fromPersona.locked] : []),
      ...(source ? { source: deepClone(source) } : {}),
      version: 1,
      history: [{ at: now, changes: [], reason: historyReason }],
      createdAt: now,
      updatedAt: now,
    }, cfg())
    const writeReason = reason || historyReason
    store.tx(() => {
      store.put('persona', id, { ...persona, reason: writeReason, at: now })
      if (activate !== false) writeActiveId(id)
    })
    return {
      ok: true,
      persona: getById(id),
      activeId: activate === false ? active : id,
      personas: list(),
    }
  }

  function importPersona(patch = {}) {
    return create({ ...patch, copyFrom: '', reason: 'imported' })
  }

  function duplicate(personaId = '') {
    return create({ copyFrom: personaId || ensureActiveId() })
  }

  function activate(personaId) {
    const id = sanitizePersonaId(personaId, '')
    const persona = getById(id)
    if (!persona) return { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' }
    writeActiveId(id)
    return { ok: true, activeId: id, persona: getById(id), personas: list() }
  }

  function remove(personaId) {
    const id = sanitizePersonaId(personaId, '')
    const all = records()
    if (!all.some((item) => item.id === id)) return { ok: false, code: 'PERSONA_NOT_FOUND', message: '人格不存在' }
    if (all.length <= 1) return { ok: false, code: 'LAST_PERSONA', message: '至少保留一份人格' }
    store.remove('persona', id)
    const active = readActiveId()
    if (active === id) {
      const next = records()[0]
      writeActiveId(next.id)
    }
    return { ok: true, activeId: readActiveId(), persona: getById(readActiveId()), personas: list() }
  }

  function get() { return ensure() }

  function edit(patch, personaId = '') {
    const active = ensureActiveId()
    const id = sanitizePersonaId(personaId || active, active)
    const current = getById(id)
    if (!current) return null
    const result = applyPersonaEdit(current, patch, { now: clock.now() })
    store.tx(() => save(result.persona, 'user_edit', id))
    return { ...result, persona: store.get('persona', id) }
  }

  function reset(personaId = '') {
    const active = ensureActiveId()
    const id = sanitizePersonaId(personaId || active, active)
    const current = getById(id)
    if (!current) return null
    const now = clock.now()
    const persona = sanitizePersona({
      ...defaultPersona(cfg()),
      id,
      createdAt: Number(current.createdAt) || now,
      updatedAt: now,
      history: [{ at: now, changes: [], reason: 'reset' }],
    }, cfg())
    store.put('persona', id, { ...persona, reason: 'reset', at: now })
    return persona
  }

  function maybeEvolve(evidence, elapsedDays = 1) {
    const before = ensure()
    const next = evolvePersona(before, evidence, { config: cfg(), elapsedDays, now: clock.now() })
    if (next.version !== before.version) store.put('persona', before.id, next)
    store.put('state', 'persona.lastEvolutionAt', { at: clock.now(), elapsedDays })
    return next
  }

  function summary() {
    const current = ensure()
    const active = current.id
    return {
      ...personaSummary(current),
      activeId: active,
      personaCount: records().length,
    }
  }

  return {
    ensure, get, getById, list, summary, save, edit, maybeEvolve, reset,
    create, duplicate, importPersona, activate, remove,
    activeId: () => ensureActiveId(),
    scopeGeneration: () => scopeGeneration,
  }
}
