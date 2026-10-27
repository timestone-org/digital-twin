/** @fileoverview 完整参数文档解析与 Schema 字段展示。 */
import type { ModelingConfiguration } from '@dt/contracts'

export function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

export function parseConfiguration(text: string): {
  value: ModelingConfiguration | null
  error: string
} {
  try {
    const parsed: unknown = JSON.parse(text)
    const document = objectOf(parsed)
    const nodes = objectOf(document?.['nodes'])
    if (!nodes || Object.keys(document ?? {}).some((key) => key !== 'nodes'))
      return { value: null, error: '配置必须是仅含 nodes 的对象' }
    const entries: [string, Record<string, unknown>][] = []
    for (const [id, config] of Object.entries(nodes)) {
      const node = objectOf(config)
      if (!node) return { value: null, error: `${id} 的参数必须是对象` }
      entries.push([id, node])
    }
    return { value: { nodes: Object.fromEntries(entries) }, error: '' }
  } catch {
    return { value: null, error: 'JSON 格式不完整，请检查引号、逗号与括号' }
  }
}

export interface ParameterField {
  key: string
  label: string
  hint: string
  kind: 'string' | 'number' | 'boolean' | 'select' | 'json'
  options: { value: string; label: string }[]
  required: boolean
}

export function parameterFields(
  schema: Record<string, unknown>,
): ParameterField[] {
  const properties = objectOf(schema['properties']) ?? {}
  const required = Array.isArray(schema['required']) ? schema['required'] : []
  return Object.entries(properties).map(([key, raw]) => {
    const field = resolveField(schema, objectOf(raw) ?? {})
    const alternatives = Array.isArray(field['anyOf']) ? field['anyOf'] : []
    const scalar =
      alternatives
        .map((value) => resolveField(schema, objectOf(value) ?? {}))
        .find((item) => item['type'] !== 'null') ?? field
    const choices = Array.isArray(scalar['enum'])
      ? scalar['enum'].filter(
          (item): item is string => typeof item === 'string',
        )
      : []
    const type = scalar['type']
    const kind = fieldKind(type, choices.length > 0)
    return {
      key,
      label: typeof field['title'] === 'string' ? field['title'] : key,
      hint:
        typeof field['description'] === 'string' ? field['description'] : '',
      kind,
      options: choices.map((value) => ({ value, label: value })),
      required: required.includes(key),
    }
  })
}

function resolveField(
  schema: Record<string, unknown>,
  field: Record<string, unknown>,
): Record<string, unknown> {
  const reference = field['$ref']
  if (typeof reference !== 'string' || !reference.startsWith('#/')) return field
  let target: unknown = schema
  for (const part of reference.slice(2).split('/')) {
    target = objectOf(target)?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  }
  return { ...objectOf(target), ...field }
}

function fieldKind(type: unknown, hasChoices: boolean): ParameterField['kind'] {
  if (hasChoices) return 'select'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'string' || type === 'boolean') return type
  return 'json'
}
