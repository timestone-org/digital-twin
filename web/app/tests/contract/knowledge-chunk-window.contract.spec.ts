/** @fileoverview 知识原块窗口的公开字段、续读标识和字符上限。 */
import { describe, expect, it } from 'vitest'
import specification from '../../../../server/services/knowledge-server/openapi.json'

describe('knowledge-server', () => {
  it('ChunkWindowOut 保留证据身份、原文、出处和完整续读状态', () => {
    const schema = specification.components.schemas['ChunkWindowOut']
    const fields = [
      'base_id',
      'chunk_id',
      'document_title',
      'heading_path',
      'locator',
      'text',
      'offset',
      'total_chars',
      'has_more',
      'next_offset',
    ]
    expect(Object.keys(schema.properties).sort()).toEqual([...fields].sort())
    expect([...schema.required].sort()).toEqual([...fields].sort())
    expect(schema.properties.text.type).toBe('string')
    expect(schema.properties.has_more.type).toBe('boolean')
    expect(schema.properties.next_offset.anyOf).toEqual([
      { type: 'integer' },
      { type: 'null' },
    ])
    expect(schema.properties.locator.$ref).toBe(
      '#/components/schemas/LocatorOut',
    )
    expect(schema.properties.base_id.format).toBe('uuid')
    expect(schema.properties.chunk_id.format).toBe('uuid')
  })

  it('块读取窗口必须有界且为只读 GET', () => {
    const operation =
      specification.paths[
        '/api/v1/knowledge/knowledge-bases/{base_id}/chunks/{chunk_id}'
      ].get
    const limit = operation.parameters.find(
      (parameter) => parameter.name === 'limit',
    )
    expect(limit?.schema).toMatchObject({
      type: 'integer',
      minimum: 1,
      maximum: 8000,
      default: 4000,
    })
    expect(
      operation.responses['200'].content['application/json'].schema.$ref,
    ).toBe('#/components/schemas/ApiResponse_ChunkWindowOut_')
  })
})
