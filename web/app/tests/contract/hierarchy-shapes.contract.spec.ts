/** @fileoverview 层级图 OpenAPI 形状与生成类型的完整字段契约。 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import type { HierarchySchemas } from '@dt/contracts'
import { object } from '../../src/pages/Tools/Hierarchy/scripts/graph'
const input: unknown = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      '..',
      'server',
      'services',
      'hierarchy-server',
      'openapi.json',
    ),
    'utf8',
  ),
)
const schemas = object(object(object(input)['components'])['schemas'])
const shapes = {
  HierarchyCapabilities: {
    is_enabled: true,
    history_limit: true,
    max_edges: true,
    max_nodes: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyCapabilities'], true>,
  HierarchyCreate: { document: true } satisfies Record<
    keyof HierarchySchemas['HierarchyCreate'],
    true
  >,
  HierarchyDocument: {
    edges: true,
    nodes: true,
    paper: true,
    schemaVersion: true,
    templateId: true,
    title: true,
    viewport: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyDocument'], true>,
  HierarchyEdge: { id: true, source: true, target: true } satisfies Record<
    keyof HierarchySchemas['HierarchyEdge'],
    true
  >,
  HierarchyHistory: {
    has_more: true,
    items: true,
    next: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyHistory'], true>,
  HierarchyNode: {
    code: true,
    id: true,
    kind: true,
    name: true,
    order: true,
    parameter: true,
    position: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyNode'], true>,
  HierarchyPage: {
    items: true,
    page: true,
    size: true,
    total: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyPage'], true>,
  HierarchyPaper: { width: true } satisfies Record<
    keyof HierarchySchemas['HierarchyPaper'],
    true
  >,
  HierarchyPosition: { x: true, y: true } satisfies Record<
    keyof HierarchySchemas['HierarchyPosition'],
    true
  >,
  HierarchyProject: {
    document: true,
    id: true,
    node_count: true,
    revision: true,
    title: true,
    updated_at: true,
  } satisfies Record<keyof HierarchySchemas['HierarchyProject'], true>,
  HierarchyRestore: { revision: true, target_revision: true } satisfies Record<
    keyof HierarchySchemas['HierarchyRestore'],
    true
  >,
  HierarchySave: { document: true, revision: true } satisfies Record<
    keyof HierarchySchemas['HierarchySave'],
    true
  >,
  HierarchySummary: {
    id: true,
    node_count: true,
    revision: true,
    title: true,
    updated_at: true,
  } satisfies Record<keyof HierarchySchemas['HierarchySummary'], true>,
  HierarchyVersion: { created_at: true, revision: true } satisfies Record<
    keyof HierarchySchemas['HierarchyVersion'],
    true
  >,
  HierarchyViewport: { x: true, y: true, zoom: true } satisfies Record<
    keyof HierarchySchemas['HierarchyViewport'],
    true
  >,
}
it.each(Object.entries(shapes))(
  '%s 的字段与服务契约逐字一致',
  (name, fields) => {
    expect(Object.keys(fields).sort()).toEqual(
      Object.keys(object(object(schemas[name])['properties'])).sort(),
    )
  },
)
