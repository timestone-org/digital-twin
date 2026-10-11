/**
 * @fileoverview 助手步骤的有界预览与展示文字；真实回执保持独立。
 * 约束见 docs/AI_ASSISTANT_DESIGN.md。
 */

/** 一个入参值最多留多少字。 */
export const MAX_VALUE_CHARS = 200
/** 一步最多摊几个入参。 */
export const MAX_KEYS = 20
/** 产出预览的上限。 */
export const MAX_OUTPUT_CHARS = 1_500

const ELLIPSIS = '…'
/** 内嵌图片的 data URI 前缀。⚠ 与服务端 `vision.is_image` 同一条判定。 */
const IMAGE_PREFIX = 'data:image/'
const MAX_SUMMARY_CHARS = 80
const MAX_DISPLAY_DEPTH = 3
const PRIORITY_FIELDS = new Set([
  'metadata',
  'pagination',
  'warnings',
  'warning',
  'total',
  'has_more',
  'next_page',
  'next_cursor',
  'is_stale',
  'errors',
  'error',
])

/**
 * 这个产出是不是一张内嵌的图。
 * ⚠ 图要单拎出来：混在文本产出里的话，界面上会出现几十万字符的一坨 base64。
 * @param given 工具产出
 */
export function isImageOutput(given: unknown): given is string {
  return typeof given === 'string' && given.startsWith(IMAGE_PREFIX)
}

/**
 * 入参摊成一张键值表；没有入参给 `null`。
 * @param given 原始入参（对象），或服务端已经摊平的那一份
 */
export function inputPreview(given: unknown): Record<string, string> | null {
  const body = asObject(given)
  if (body === null) return null
  const keys = Object.keys(body)
  if (keys.length === 0) return null
  const flat: Record<string, string> = {}
  for (const key of keys.slice(0, MAX_KEYS)) {
    flat[key] = clamped(asText(body[key]), MAX_VALUE_CHARS)
  }
  if (keys.length > MAX_KEYS) {
    flat[ELLIPSIS] = `另有 ${keys.length - MAX_KEYS} 项未摊开`
  }
  return flat
}

/**
 * 产出摊成一段文字；没有产出、或产出是一张图，都给 `null`。
 *
 * ⚠ 认得出 `{ body: … }` 就只取那一格：服务端落库时把结果包了一层，
 * 连壳一起显示的话，回放出来的每一步产出前面都顶着一个 `{"body":"`。
 *
 * @param given 工具产出，或库里存的那一份
 */
export function outputPreview(given: unknown): string | null {
  const text = outputText(given)
  return text === null ? null : clamped(text, MAX_OUTPUT_CHARS)
}

/**
 * 从完整回执生成展示载体，避免先截断 JSON 再解析。
 * @param given 完整工具产出
 */
export function outputDisplay(given: unknown): {
  displayOutput?: string
  displaySummary?: string
} {
  const text = outputText(given, true)
  if (text === null) return {}
  const displayOutput = toolOutputPreview(text)
  const displaySummary = toolOutputSummary(text)
  return {
    ...(displayOutput === null ? {} : { displayOutput }),
    ...(displaySummary === null ? {} : { displaySummary }),
  }
}

function outputText(given: unknown, keepSiblingFields = false): string | null {
  if (given === undefined || given === null || isImageOutput(given)) return null
  const text = asText(displayBody(given, keepSiblingFields))
  return text === '' ? null : text
}

function displayBody(given: unknown, keepSiblingFields: boolean): unknown {
  const object = asObject(given)
  if (object === null || typeof object.body !== 'string') return given
  if (keepSiblingFields && Object.keys(object).length !== 1) return given
  return object.body
}

/**
 * 将旧 JSON 预览转换为可读正文，新文本直接保留。
 * @param given 步骤的产出文字
 */
export function toolOutputPreview(given: string | undefined): string | null {
  if (given === undefined || given.trim() === '' || isImageOutput(given))
    return null
  const parsed = parsedOutput(given)
  if (!parsed.isJson) return displayClamped(given, true)
  return displayClamped(displayValue(parsed.value, '', 0).join('\n'), false)
}

function displayClamped(text: string, completeLines: boolean): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text
  const boundary = text.lastIndexOf('\n', MAX_OUTPUT_CHARS)
  const isTableRow = text.slice(boundary + 1).startsWith('| ')
  const prefix = text.slice(
    0,
    (completeLines || isTableRow) && boundary > 0 ? boundary : MAX_OUTPUT_CHARS,
  )
  return `${prefix}\n\n…（另有内容未展示，产出预览已截断）`
}

/**
 * 提取折叠步骤的一行概要。
 * @param given 步骤的产出文字
 */
export function toolOutputSummary(given: string | undefined): string | null {
  if (given === undefined || given === '') return null
  const parsed = parsedOutput(given)
  const rows = resultRows(parsed.value)
  if (parsed.isJson && rows !== null) return `返回 ${rows.length} 条结果`
  const first = (toolOutputPreview(given) ?? '')
    .split('\n')
    .find((line) => line.trim() !== '')
    ?.replace(/^[-#>\s]+/, '')
    .replaceAll('`', '')
  if (!first) return null
  return first.length <= MAX_SUMMARY_CHARS
    ? first
    : `${first.slice(0, MAX_SUMMARY_CHARS)}…`
}

function parsedOutput(text: string): { isJson: boolean; value: unknown } {
  try {
    const value: unknown = JSON.parse(text)
    return { isJson: true, value }
  } catch {
    return { isJson: false, value: text }
  }
}

function resultRows(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    const rows: unknown[] = value
    return rows
  }
  const object = asObject(value)
  if (object === null || !Array.isArray(object.items)) return null
  const rows: unknown[] = object.items
  return rows
}

function displayValue(value: unknown, path: string, depth: number): string[] {
  if (Array.isArray(value)) return displayRows(value, path, depth)
  const object = asObject(value)
  if (object === null || depth >= MAX_DISPLAY_DEPTH) {
    return [
      path === '' ? displayText(value) : `- \`${path}\`: ${displayText(value)}`,
    ]
  }
  const entries = Object.entries(object).sort(
    ([left, leftValue], [right, rightValue]) =>
      displayOrder(left, leftValue) - displayOrder(right, rightValue),
  )
  if (entries.length === 0)
    return [path === '' ? '返回空对象' : `- \`${path}\`: {}`]
  const lines = entries
    .slice(0, MAX_KEYS)
    .flatMap(([key, item]) =>
      displayValue(item, path === '' ? key : `${path}.${key}`, depth + 1),
    )
  if (entries.length > MAX_KEYS)
    lines.push(`…（另有 ${entries.length - MAX_KEYS} 个字段未展示）`)
  return lines
}

function displayOrder(key: string, value: unknown): number {
  if (PRIORITY_FIELDS.has(key)) return -1
  if (Array.isArray(value)) return 2
  return asObject(value) === null ? 0 : 1
}

function displayRows(rows: unknown[], path: string, depth: number): string[] {
  const heading =
    path === '' ? `返回 ${rows.length} 条结果` : `${path}: ${rows.length} 条`
  if (rows.length === 0) return [heading]
  const shown = rows.slice(0, MAX_KEYS)
  const table = rowsTable(shown)
  const lines =
    table ??
    shown.flatMap((row, at) =>
      displayValue(row, `${path || '结果'}[${at + 1}]`, depth + 1),
    )
  if (rows.length > shown.length)
    lines.push(`…（另有 ${rows.length - shown.length} 条未展示）`)
  return [heading, '', ...lines, '']
}

function rowsTable(rows: unknown[]): string[] | null {
  const objects = rows.map(asObject)
  const first = objects[0]
  if (first === undefined || first === null) return null
  const keys = Object.keys(first)
  if (keys.length === 0 || keys.length > MAX_KEYS) return null
  if (!objects.every((row) => matchingRow(row, keys))) return null
  const values = objects.map((row) =>
    keys.map((key) => displayText(row?.[key])),
  )
  if ([keys, ...values].flat().some((cell) => /[|\r\n]/.test(cell))) return null
  return [
    `| ${keys.map(displayText).join(' | ')} |`,
    `| ${keys.map(() => '---').join(' | ')} |`,
    ...values.map((row) => `| ${row.join(' | ')} |`),
  ]
}

function displayText(value: unknown): string {
  const text = asText(value)
  return /[*_~[\]]/.test(text) && !/[`\r\n]/.test(text) ? `\`${text}\`` : text
}

function matchingRow(
  row: Record<string, unknown> | null,
  keys: string[],
): boolean {
  return (
    row !== null &&
    Object.keys(row).length === keys.length &&
    keys.every(
      (key) =>
        key in row && (row[key] === null || typeof row[key] !== 'object'),
    )
  )
}

function asObject(given: unknown): Record<string, unknown> | null {
  if (typeof given !== 'object' || given === null || Array.isArray(given)) {
    return null
  }
  return { ...given }
}

/**
 * 一个值摊成文字。裸串原样，其余走 JSON。
 * ⚠ 裸串不走 JSON：走了的话每个字符串值都被套上一对引号，而那是给机器看的。
 */
function asText(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    // 循环引用一类：说清楚它画不出来，而不是让整张卡片空着
    return '（这个值展不开）'
  }
}

/** 钳到上限内，截断要说出来——静默截断会让人把半份产出当成全部。 */
function clamped(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}${ELLIPSIS}（共 ${text.length} 字，已截断）`
}
