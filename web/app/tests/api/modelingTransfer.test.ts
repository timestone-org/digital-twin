/** @fileoverview 流水线迁移请求使用平台前缀、真实POST形状和导入幂等键。 */
import type {
  ModelingImportInspection,
  ModelingPipeline,
  ModelingTransferDocument,
} from '@dt/contracts'
import { afterEach, expect, it, vi } from 'vitest'
import { configureApiClient } from '@/api/client'
import {
  exportPipeline,
  importPipeline,
  inspectPipelineImport,
} from '@/api/modelingTransfer'

const document: ModelingTransferDocument = {
  format_version: '1.0',
  pipeline: {
    code: 'energy',
    name: '能耗',
    description: null,
    graph: { format_version: '1.0', nodes: [], edges: [] },
  },
  operators: [],
}
const inspection: ModelingImportInspection = {
  document,
  can_import: true,
  issues: [],
  source_table_codes: [],
  node_count: 0,
  edge_count: 0,
}
const pipeline: ModelingPipeline = {
  ...document.pipeline,
  description: null,
  id: 'imported',
  node_count: 0,
  source_table_codes: [],
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  created_by_name: null,
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  configureApiClient({ getToken: () => null })
})

it('预检和导出复用统一信封，保留取消信号和账号身份', async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: inspection,
          trace_id: 'trace',
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 0,
          message: 'ok',
          data: document,
          trace_id: 'trace',
        }),
      ),
    )
  vi.stubGlobal('fetch', fetch)
  configureApiClient({ getToken: () => 'access-token' })
  const controller = new AbortController()
  expect(await inspectPipelineImport(document, controller.signal)).toEqual(
    inspection,
  )
  expect(await exportPipeline('source/id', controller.signal)).toEqual(document)
  expect(fetch.mock.calls[0]?.[0]).toBe(
    '/api/v1/platform/modeling-pipelines:inspect-import',
  )
  expect(fetch.mock.calls[1]?.[0]).toBe(
    '/api/v1/platform/modeling-pipelines/source%2Fid:export',
  )
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify(document),
    signal: expect.any(AbortSignal),
  })
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Authorization'),
  ).toBe('Bearer access-token')
})

it('导入用独立写端点和幂等键，提交目标编码与名称', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 0,
        message: 'ok',
        data: pipeline,
        trace_id: 'trace',
      }),
      { status: 201 },
    ),
  )
  vi.stubGlobal('fetch', fetch)
  const input = {
    document,
    code: 'energy_copy',
    name: '能耗副本',
    description: null,
  }
  expect(await importPipeline(input, 'transfer-test-key')).toEqual(pipeline)
  expect(fetch.mock.calls[0]?.[0]).toBe(
    '/api/v1/platform/modeling-pipelines:import',
  )
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({
    method: 'POST',
    body: JSON.stringify(input),
  })
  expect(
    new Headers(fetch.mock.calls[0]?.[1]?.headers).get('Idempotency-Key'),
  ).toBe('transfer-test-key')
})
