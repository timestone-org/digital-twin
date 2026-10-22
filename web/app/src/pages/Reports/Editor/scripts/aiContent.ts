/** @fileoverview 报告正文按路径续读，并用原文前置条件修改文本草稿。 */
import type { AssistantToolCall, ReportDocument } from '@dt/contracts'

function pathOf(call: AssistantToolCall): number[] {
  const path = call.arguments.path
  if (typeof path !== 'string' || !/^(?:\d+(?:\.\d+)*)?$/.test(path))
    throw new Error('path 必须来自正文提纲')
  return path === '' ? [] : path.split('.').map(Number)
}

function atPath(
  document: ReportDocument,
  path: readonly number[],
): ReportDocument {
  let node = document
  for (const index of path) {
    const next = node.content?.[index]
    if (next === undefined) throw new Error('正文路径已变化，请重新读取')
    node = next
  }
  return node
}

export function reportText(node: ReportDocument): string {
  return node.text ?? (node.content ?? []).map(reportText).join('')
}

function canReplace(node: ReportDocument): boolean {
  if (!['paragraph', 'heading'].includes(node.type)) return false
  const marks = JSON.stringify(node.content?.[0]?.marks ?? [])
  return (node.content ?? []).every(
    (child) =>
      child.type === 'text' && JSON.stringify(child.marks ?? []) === marks,
  )
}

export function readReportContent(
  document: ReportDocument,
  call: AssistantToolCall,
) {
  const node = atPath(document, pathOf(call))
  const text = reportText(node)
  const offset = integer(call.arguments.offset, 0, Number.MAX_SAFE_INTEGER)
  const limit = integer(call.arguments.limit, 4000, 8000)
  if (limit < 1) throw new Error('limit 必须大于0')
  const value = text.slice(offset, offset + limit)
  const next = offset + value.length
  return {
    path: call.arguments.path,
    type: node.type,
    text: value,
    offset,
    total_chars: text.length,
    can_replace_text: canReplace(node),
    has_more: next < text.length,
    next_offset: next < text.length ? next : null,
  }
}

function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > maximum
  )
    throw new Error('正文窗口参数超出范围')
  return value
}

export function replaceReportText(
  document: ReportDocument,
  call: AssistantToolCall,
): ReportDocument {
  const path = pathOf(call)
  const current = atPath(document, path)
  if (!canReplace(current))
    throw new Error('该节点含复杂内容或不同文本格式，请在正文编辑器修改')
  if (call.arguments.expected_text !== reportText(current))
    throw new Error('正文已变化，请重新读取后修改')
  const text = call.arguments.text
  if (typeof text !== 'string' || text.length > 16000)
    throw new Error('替换正文必须是16000字符以内的文本')
  const marks = current.content?.[0]?.marks
  const next: ReportDocument = {
    ...current,
    content:
      text === ''
        ? []
        : [{ type: 'text', text, ...(marks === undefined ? {} : { marks }) }],
  }
  return replaceAt(document, path, next)
}

function replaceAt(
  node: ReportDocument,
  path: readonly number[],
  replacement: ReportDocument,
): ReportDocument {
  const index = path[0]
  if (index === undefined) return replacement
  return {
    ...node,
    content: (node.content ?? []).map((child, position) =>
      position === index ? replaceAt(child, path.slice(1), replacement) : child,
    ),
  }
}
