/** @fileoverview 从 hierarchy OpenAPI 生成的层级图契约。 */
export interface HierarchySchemas {
  HierarchyCapabilities: {
    history_limit: number
    is_enabled: boolean
    max_edges: number
    max_nodes: number
  }
  HierarchyCreate: { document: HierarchySchemas['HierarchyDocument'] }
  HierarchyDocument: {
    edges: HierarchySchemas['HierarchyEdge'][]
    nodes: HierarchySchemas['HierarchyNode'][]
    paper: HierarchySchemas['HierarchyPaper']
    schemaVersion: 1
    templateId: 'case-v1'
    title: string
    viewport: HierarchySchemas['HierarchyViewport']
  }
  HierarchyEdge: { id: string; source: string; target: string }
  HierarchyHistory: {
    has_more: boolean
    items: HierarchySchemas['HierarchyVersion'][]
    next: string | null
  }
  HierarchyNode: {
    code: string
    id: string
    kind: 'meter' | 'junction'
    name: string
    order: number
    parameter: string
    position: HierarchySchemas['HierarchyPosition']
  }
  HierarchyPage: {
    items: HierarchySchemas['HierarchySummary'][]
    page: number
    size: number
    total: number
  }
  HierarchyPaper: { width: number }
  HierarchyPosition: { x: number; y: number }
  HierarchyProject: {
    document: HierarchySchemas['HierarchyDocument']
    id: string
    node_count: number
    revision: number
    title: string
    updated_at: string
  }
  HierarchyRestore: { revision: number; target_revision: number }
  HierarchySave: {
    document: HierarchySchemas['HierarchyDocument']
    revision: number
  }
  HierarchySummary: {
    id: string
    node_count: number
    revision: number
    title: string
    updated_at: string
  }
  HierarchyVersion: { created_at: string; revision: number }
  HierarchyViewport: { x: number; y: number; zoom: number }
}
export type HierarchyDocument = HierarchySchemas['HierarchyDocument']
export type HierarchyNode = HierarchySchemas['HierarchyNode']
export type HierarchyEdge = HierarchySchemas['HierarchyEdge']
export type HierarchyPosition = HierarchySchemas['HierarchyPosition']
export type HierarchyViewport = HierarchySchemas['HierarchyViewport']
export type HierarchyPaper = HierarchySchemas['HierarchyPaper']
export type HierarchyCreate = HierarchySchemas['HierarchyCreate']
export type HierarchySave = HierarchySchemas['HierarchySave']
export type HierarchyRestore = HierarchySchemas['HierarchyRestore']
export type HierarchySummary = HierarchySchemas['HierarchySummary']
export type HierarchyProject = HierarchySchemas['HierarchyProject']
export type HierarchyPage = HierarchySchemas['HierarchyPage']
export type HierarchyVersion = HierarchySchemas['HierarchyVersion']
export type HierarchyHistory = HierarchySchemas['HierarchyHistory']
export type HierarchyCapabilities = HierarchySchemas['HierarchyCapabilities']
