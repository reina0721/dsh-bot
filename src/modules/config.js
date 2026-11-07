// 内置 registry 与外部 manifest 共用的声明式配置契约。
export const MAX_CONFIG_BYTES = 64 * 1024
const PATH_RE = /^[a-z][a-zA-Z0-9_]{0,63}$/
const TYPES = new Set(['switch', 'text', 'textarea', 'number', 'select', 'string-list', 'number-list'])
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const fail = (message) => { throw Object.assign(new Error(message), { code: 'MODULE_CONFIG_INVALID' }) }

function validateValue(field, value) {
  const bad = () => fail(`配置字段 ${field.path} 的值不符合 ${field.type} 或边界要求`)
  const number = (item) => typeof item === 'number' && Number.isFinite(item)
    && (field.min === undefined || item >= field.min) && (field.max === undefined || item <= field.max)
  const string = (item) => typeof item === 'string' && Array.from(item).length <= field.maxChars
  switch (field.type) {
    case 'switch': if (typeof value !== 'boolean') bad(); break
    case 'text': case 'textarea': if (!string(value)) bad(); break
    case 'number': if (!number(value)) bad(); break
    case 'select': if (!field.options.some((option) => option.value === value)) bad(); break
    case 'string-list': case 'number-list':
      if (!Array.isArray(value) || value.length < field.minItems || value.length > field.maxItems
        || !Array.from(value).every(field.type === 'string-list' ? string : number)) bad()
      break
  }
  return structuredClone(value)
}

export function validateConfigSchema(raw) {
  if (!object(raw) || raw.version !== 1 || !Array.isArray(raw.fields) || raw.fields.length > 32) fail('配置 schema 必须为 version:1，且最多 32 个字段')
  if (Buffer.byteLength(JSON.stringify(raw)) > MAX_CONFIG_BYTES) fail('模块配置 schema 超过 64 KiB')
  const paths = new Set()
  const fields = raw.fields.map((input) => {
    if (!object(input) || typeof input.path !== 'string' || !PATH_RE.test(input.path) || paths.has(input.path)) fail('配置字段 path 必须是唯一的平面键')
    paths.add(input.path)
    if (!TYPES.has(input.type)) fail('配置字段类型不支持（禁止 secret）')
    if (typeof input.label !== 'string' || !input.label.trim()) fail('配置字段 label 必须非空')
    // 只公开已知的 UI 元数据，避免清单或 registry 私有属性进入 GET。
    const field = { path: input.path, type: input.type, label: input.label }
    for (const key of ['help', 'placeholder', 'unit']) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'string') fail(`配置字段 ${key} 必须是文本`)
        field[key] = input[key]
      }
    }
    for (const key of ['min', 'max', 'step']) {
      if (input[key] !== undefined) {
        if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || (key === 'step' && input[key] <= 0)) fail(`配置字段 ${key} 必须是有效数字`)
        field[key] = input[key]
      }
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) fail('配置字段 min 不能大于 max')
    if (['text', 'textarea', 'string-list'].includes(field.type)) {
      field.maxChars = input.maxChars ?? 2000
      if (!Number.isSafeInteger(field.maxChars) || field.maxChars < 0 || field.maxChars > MAX_CONFIG_BYTES) fail('配置字段 maxChars 不合法')
    }
    if (field.type.endsWith('-list')) {
      field.minItems = input.minItems ?? 0
      field.maxItems = input.maxItems ?? 100
      if (![field.minItems, field.maxItems].every((n) => Number.isSafeInteger(n) && n >= 0 && n <= 1000) || field.minItems > field.maxItems) fail('配置列表长度边界不合法')
    }
    if (field.type === 'select') {
      if (!Array.isArray(input.options) || !input.options.length || input.options.length > 100) fail('select 需要 1–100 个 options')
      const seen = new Set()
      field.options = input.options.map((option) => {
        if (!object(option) || typeof option.value !== 'string' || seen.has(option.value)) fail('select options.value 必须是唯一字符串')
        if (option.label !== undefined && typeof option.label !== 'string') fail('select options.label 必须是文本')
        seen.add(option.value)
        return { value: option.value, label: option.label ?? option.value }
      })
    }
    const fallback = field.type === 'switch' ? false : field.type === 'number' ? 0
      : field.type === 'select' ? field.options[0].value : field.type.endsWith('-list') ? [] : ''
    field.default = validateValue(field, Object.hasOwn(input, 'default') ? input.default : fallback)
    return field
  })
  const schema = { version: 1, fields }
  if (Buffer.byteLength(JSON.stringify(schema)) > MAX_CONFIG_BYTES) fail('模块配置 schema 超过 64 KiB')
  validateConfigValues(schema, {})
  return schema
}

export function validateConfigValues(schema, values) {
  if (!object(values)) fail('配置 values 必须是对象')
  const paths = new Set(schema.fields.map((field) => field.path))
  if (Object.keys(values).some((key) => !paths.has(key))) fail('配置包含未知字段')
  const result = Object.fromEntries(schema.fields.map((field) => [field.path,
    validateValue(field, Object.hasOwn(values, field.path) ? values[field.path] : field.default),
  ]))
  if (Buffer.byteLength(JSON.stringify(result, null, 2)) > MAX_CONFIG_BYTES) fail('模块配置超过 64 KiB')
  return result
}
