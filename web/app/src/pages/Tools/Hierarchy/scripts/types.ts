/** @fileoverview 层级图绘图结果与编辑器内部类型。 */
import type {
  HierarchyDocument,
  HierarchyEdge,
  HierarchyNode,
} from '@dt/contracts'
export type GraphDocument = HierarchyDocument
export type GraphNode = HierarchyNode
export type GraphEdge = HierarchyEdge
export type NodeKind = GraphNode['kind']
export type ExportFormat = 'svg' | 'png' | 'pdf' | 'json' | 'xlsx'
export interface Issue {
  nodeId: string | null
  message: string
}
export interface Drawing {
  svg: string
  width: number
  height: number
  nodeCount: number
  levelCount: number
  rows: { rank: number; row: number; centerY: number; count: number }[]
  warnings: Issue[]
  positions: Record<string, { x: number; y: number; rank: number; row: number }>
}
