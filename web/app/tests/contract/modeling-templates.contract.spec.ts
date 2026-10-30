/** @fileoverview 模板建模生成线形与 OpenAPI 逐字段一致。 */
import type {
  ModelingConfiguration,
  ModelingConfigurationDetail,
  ModelingInstance,
  ModelingParameterNode,
  ModelingTemplate,
} from '@dt/contracts'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// happy-dom 的 import.meta.url 使用浏览器地址。
const spec: {
  components: {
    schemas: Record<string, { properties?: Record<string, unknown> }>
  }
} = JSON.parse(
  readFileSync(
    join(
      process.cwd(),
      '..',
      'server',
      'services',
      'platform-server',
      'openapi.json',
    ),
    'utf8',
  ),
)
const pairs = [
  [
    'ModelingConfiguration',
    { nodes: true } satisfies Record<keyof ModelingConfiguration, true>,
  ],
  [
    'ModelingConfigurationOut',
    {
      configuration: true,
      json_schema: true,
      nodes: true,
      instance: true,
    } satisfies Record<keyof ModelingConfigurationDetail, true>,
  ],
  [
    'ModelingParameterNodeOut',
    {
      id: true,
      alias: true,
      operator: true,
      config: true,
      known_columns: true,
    } satisfies Record<keyof ModelingParameterNode, true>,
  ],
  [
    'ModelingTemplateOut',
    {
      id: true,
      pipeline_id: true,
      code: true,
      name: true,
      description: true,
      version: true,
      node_count: true,
      is_enabled: true,
      created_by_name: true,
      created_at: true,
      updated_at: true,
    } satisfies Record<keyof ModelingTemplate, true>,
  ],
  [
    'ModelingInstanceOut',
    {
      id: true,
      code: true,
      name: true,
      description: true,
      template_id: true,
      template_name: true,
      template_version: true,
      revision: true,
      archived_at: true,
      latest_run: true,
      created_at: true,
      updated_at: true,
    } satisfies Record<keyof ModelingInstance, true>,
  ],
] as const

describe('模板与实例契约', () => {
  it.each(pairs)('%s 字段一致', (name, fields) => {
    expect(Object.keys(fields).sort()).toEqual(
      Object.keys(spec.components.schemas[name]?.properties ?? {}).sort(),
    )
  })
})
