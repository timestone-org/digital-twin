/**
 * @fileoverview 正文内显示的试算结果：按节点路径取值，并用属性指纹拦住改过的节点。
 * 路径口径与后端 `document.walk_nodes` 相同（`content.i.content.j`）。
 */
import type { ReportDocument, ReportSchemas } from '@dt/contracts'

type NodeValue = ReportSchemas['NodeValue']

/** 编辑器文档里本模块用到的那一小块定位能力。 */
export interface ResolvableDoc {
  resolve: (position: number) => {
    depth: number
    index: (depth: number) => number
  }
}

export const BUSINESS_NODE_TYPES = new Set([
  'metricRef',
  'condText',
  'dsChart',
  'dsTable',
])

export interface DocumentPreview {
  period: string
  nodes: Record<string, NodeValue>
  /** 试算那一刻各业务节点的属性指纹。 */
  signatures: Record<string, string>
}

export interface PreviewStore {
  current: () => DocumentPreview | null
  set: (value: DocumentPreview | null) => void
  /** 正文结构变化后让各节点重新定位自己的路径。 */
  refresh: () => void
  subscribe: (listener: () => void) => () => void
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, 'en'))
        .map(([key, child]) => [key, stable(child)]),
    )
  }
  return value
}

/**
 * 节点类型与属性的稳定指纹。
 * @param type 节点类型
 * @param attrs 节点属性
 */
export function nodeSignature(type: string, attrs: unknown): string {
  return JSON.stringify([type, stable(attrs ?? {})])
}

/**
 * 收集文档里每个业务节点的路径指纹。
 * @param document 试算所用的草稿正文
 */
export function previewSignatures(
  document: ReportDocument,
): Record<string, string> {
  const found: Record<string, string> = {}
  const visit = (node: ReportDocument, path: string): void => {
    if (BUSINESS_NODE_TYPES.has(node.type))
      found[path] = nodeSignature(node.type, node.attrs)
    node.content?.forEach((child, index) => {
      visit(child, path ? `${path}.content.${index}` : `content.${index}`)
    })
  }
  visit(document, '')
  return found
}

/**
 * 编辑器位置对应的节点路径。
 * @param doc 编辑器当前文档
 * @param position 节点起始位置
 */
export function nodePath(doc: ResolvableDoc, position: number): string {
  const resolved = doc.resolve(position)
  const parts: string[] = []
  for (let depth = 0; depth <= resolved.depth; depth += 1)
    parts.push(`content.${resolved.index(depth)}`)
  return parts.join('.')
}

/**
 * 路径上的试算值；节点在试算后改过配置则视为没有。
 * @param preview 最近一次试算
 * @param path 节点路径
 * @param signature 节点当前指纹
 */
export function previewValue(
  preview: DocumentPreview | null,
  path: string,
  signature: string,
): NodeValue | null {
  if (!preview || preview.signatures[path] !== signature) return null
  return preview.nodes[path] ?? null
}

/** 每个编辑器实例一份，经闭包交给节点视图，不走 tiptap 的选项深拷贝。 */
export function createPreviewStore(): PreviewStore {
  let value: DocumentPreview | null = null
  const listeners = new Set<() => void>()
  const notify = (): void => {
    listeners.forEach((listener) => listener())
  }
  return {
    current: () => value,
    set: (next) => {
      value = next
      notify()
    },
    refresh: notify,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
