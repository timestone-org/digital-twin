/** @fileoverview 四类原子业务节点；DOM 文本不拼接 HTML。 */
import { createBusinessNodeView } from './businessNodeView'
import { Node, mergeAttributes } from '@tiptap/core'
import type { Attributes } from '@tiptap/core'
import type { PreviewStore } from './documentPreview'

/**
 * 四类业务节点扩展。
 * @param store 正文试算结果；缺省时节点只显示占位
 */
export function createBusinessExtensions(store: PreviewStore | null = null) {
  const view = createBusinessNodeView(store)
  return ['metricRef', 'condText', 'dsChart', 'dsTable'].map((kind) =>
    businessNode(kind, view),
  )
}

export const businessExtensions = createBusinessExtensions()

function businessNode(
  kind: string,
  view: ReturnType<typeof createBusinessNodeView>,
) {
  return Node.create({
    name: kind,
    group: kind === 'metricRef' || kind === 'condText' ? 'inline' : 'block',
    inline: kind === 'metricRef' || kind === 'condText',
    atom: true,
    addAttributes: defaultAttributes,
    addNodeView() {
      return view
    },
    parseHTML() {
      return [{ tag: `span[data-report-node="${kind}"]` }]
    },
    renderHTML({ node, HTMLAttributes }) {
      const labels: Record<string, string> = {
        metricRef: '指标',
        condText: '条件文本',
        dsChart: '数据图表',
        dsTable: '数据表格',
      }
      const expression: unknown = node.attrs['expr']
      const label =
        typeof expression === 'string' && expression
          ? expression
          : (labels[kind] ?? kind)
      return [
        'span',
        mergeAttributes(HTMLAttributes, {
          'data-report-node': kind,
          class: 'report-data-node',
        }),
        label,
      ]
    },
  })
}

function defaultAttributes(): Attributes {
  const defaults: Record<string, { default: unknown }> = {
    expr: { default: '' },
    precision: { default: 2 },
    unit: { default: '' },
    title: { default: '' },
    table: { default: '' },
    keys: { default: [] },
    series: { default: [] },
    window: { default: null },
    offset: { default: 0 },
    anchor: { default: 'period' },
    kind: { default: 'line' },
    x_axis: { default: 'time' },
    category_key: { default: '' },
    limit: { default: 1000 },
    bucket: { default: 'none' },
    agg: { default: 'avg' },
    order: { default: 'asc' },
    decimals: { default: 2 },
    time_format: { default: 'auto' },
    summary: { default: 'none' },
    render: { default: 'native' },
  }
  return Object.fromEntries(
    Object.entries(defaults).map(([key, value]) => [
      key,
      {
        ...value,
        parseHTML: (element: HTMLElement) =>
          readAttribute(element, key, value.default),
        renderHTML: (attrs: Record<string, unknown>) => ({
          [`data-report-${key}`]: JSON.stringify(attrs[key]),
        }),
      },
    ]),
  )
}

function readAttribute(
  element: HTMLElement,
  key: string,
  fallback: unknown,
): unknown {
  const raw = element.getAttribute(`data-report-${key}`)
  if (raw === null) return fallback
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed
  } catch {
    return fallback
  }
}
