/** @fileoverview 标准图文字容量与同层统一名称框。 */
import { DomainError } from './graph'
import { required } from './required'
import type { GraphDocument, GraphNode, Issue } from './types'
export const units = (value: string): number =>
  [...value].reduce(
    (sum, char) => sum + (required(char.codePointAt(0)) < 128 ? 0.53 : 1),
    0,
  )
export function labelLines(name: string, capacity: number): string[] {
  const lines: string[] = []
  for (const paragraph of name.split('\n')) {
    let current = '',
      width = 0
    for (const char of paragraph) {
      const size = required(char.codePointAt(0)) < 128 ? 0.53 : 1
      if (width + size > capacity && current) {
        lines.push(current)
        current = ''
        width = 0
      }
      current += char
      width += size
    }
    lines.push(current)
  }
  return lines
}
export function preflight(
  document: GraphDocument,
  depth: Map<string, number>,
): Issue[] {
  const issues: Issue[] = [],
    warnings: Issue[] = []
  if (!document.nodes.some((node) => node.kind === 'meter'))
    issues.push({ nodeId: null, message: '请先添加至少一个计量节点' })
  for (const node of document.nodes) {
    const incoming = document.edges.some((edge) => edge.target === node.id),
      outgoing = document.edges.some((edge) => edge.source === node.id)
    if (node.kind === 'junction') {
      if (!incoming || !outgoing)
        issues.push({
          nodeId: node.id,
          message: `${node.code}：汇流点必须同时连接上游和下游`,
        })
    } else {
      issues.push(...textIssues(node, required(depth.get(node.id))))
      if (!incoming && !outgoing)
        warnings.push({
          nodeId: node.id,
          message: `${node.code} 是独立根节点，已保留在图纸中`,
        })
    }
  }
  if (issues.length)
    throw new DomainError('请修正以下问题后生成图纸', 'DRAWING_INVALID', issues)
  return warnings
}
function textIssues(node: GraphNode, depth: number): Issue[] {
  const issues: Issue[] = []
  if (labelLines(node.name, depth < 3 ? 8 : 7).length > 2)
    issues.push({
      nodeId: node.id,
      message: `${node.code}：名称超过标准框的两行容量，请缩短文字`,
    })
  if (units(node.code) > 5.5 || units(node.parameter) > 5.5)
    issues.push({
      nodeId: node.id,
      message: `${node.code}：圆内文字过长，请控制在 5 个汉字或 10 个英文字符以内`,
    })
  return issues
}

export function metricsFor(
  document: GraphDocument,
  depth: Map<string, number>,
) {
  const metrics = new Map(
    document.nodes
      .filter((n) => n.kind === 'meter')
      .map((node) => {
        const lines = labelLines(
          node.name,
          required(depth.get(node.id)) < 3 ? 8 : 7,
        )
        return [
          node.id,
          {
            lines,
            labelWidth: Math.max(
              100,
              Math.min(120, Math.max(...lines.map(units)) * 14 + 4),
            ),
            labelHeight: lines.length === 1 ? 30 : 40,
          },
        ]
      }),
  )
  for (const rank of new Set(depth.values())) {
    const peers = document.nodes.filter(
      (n) => n.kind === 'meter' && depth.get(n.id) === rank,
    )
    const width = Math.max(
      ...peers.map((n) => required(metrics.get(n.id)).labelWidth),
    )
    const height = Math.max(
      ...peers.map((n) => required(metrics.get(n.id)).labelHeight),
    )
    for (const n of peers)
      Object.assign(required(metrics.get(n.id)), {
        labelWidth: width,
        labelHeight: height,
      })
  }

  return metrics
}
