/** @fileoverview 整库重嵌的预检、任务与启动请求逐字段对齐 OpenAPI。 */
import type {
  KnowledgeReembeddingJob,
  KnowledgeReembeddingPreview,
  KnowledgeReembeddingStart,
} from '@dt/contracts'
import { KNOWLEDGE_REEMBEDDING_STATUSES } from '@dt/contracts'
import { describe, expect, it } from 'vitest'
import specification from '../../../../server/services/knowledge-server/openapi.json'

const previewFields = {
  target_model: true,
  target_dimensions: true,
  target_space_id: true,
  content_revision: true,
  total_documents: true,
  total_chunks: true,
  can_start: true,
  note: true,
} satisfies Record<keyof KnowledgeReembeddingPreview, true>

const jobFields = {
  id: true,
  base_id: true,
  status: true,
  target_model: true,
  target_dimensions: true,
  total_chunks: true,
  completed_chunks: true,
  created_at: true,
  finished_at: true,
  error_message: true,
} satisfies Record<keyof KnowledgeReembeddingJob, true>

const startFields = {
  target_space_id: true,
  expected_revision: true,
} satisfies Record<keyof KnowledgeReembeddingStart, true>

describe('knowledge-server', () => {
  it('ReembeddingPreviewOut、ReembeddingStartIn 和 ReembeddingJobOut 的字段与闭合状态一致', () => {
    const schemas = specification.components.schemas
    for (const [name, fields] of [
      ['ReembeddingPreviewOut', previewFields],
      ['ReembeddingStartIn', startFields],
      ['ReembeddingJobOut', jobFields],
    ] as const) {
      const schema = schemas[name]
      expect(Object.keys(schema.properties).sort()).toEqual(
        Object.keys(fields).sort(),
      )
      expect([...schema.required].sort()).toEqual(Object.keys(fields).sort())
    }
    expect(schemas.ReembeddingStartIn.additionalProperties).toBe(false)
    expect(schemas.ReembeddingStartIn.properties.target_space_id.pattern).toBe(
      '^[0-9a-f]{64}$',
    )
    expect(
      schemas.ReembeddingStartIn.properties.expected_revision.minimum,
    ).toBe(0)
    expect(
      [...schemas.ReembeddingJobOut.properties.status.enum].sort(),
    ).toEqual([...KNOWLEDGE_REEMBEDDING_STATUSES].sort())
  })

  it('确认预检和启动是分开的操作，列表、任务进度、取消均有独立入口', () => {
    const root = '/api/v1/knowledge/knowledge-bases/{base_id}/reembeddings'
    const routes = specification.paths
    expect(
      routes[`${root}:preview`].post.responses['200'].content[
        'application/json'
      ].schema.$ref,
    ).toContain('ReembeddingPreviewOut')
    expect(
      routes[root].post.responses['202'].content['application/json'].schema
        .$ref,
    ).toContain('ReembeddingJobOut')
    expect(
      routes[root].post.parameters.some(
        (item) =>
          item.in === 'header' && item.name.toLowerCase() === 'idempotency-key',
      ),
    ).toBe(true)
    expect(
      routes[root].get.responses['200'].content['application/json'].schema.$ref,
    ).toContain('Page_ReembeddingJobOut')
    expect(
      routes[`${root}/{job_id}`].get.responses['200'].content[
        'application/json'
      ].schema.$ref,
    ).toContain('ReembeddingJobOut')
    expect(
      routes[`${root}/{job_id}:cancel`].post.responses['200'].content[
        'application/json'
      ].schema.$ref,
    ).toContain('ReembeddingJobOut')
  })
})
