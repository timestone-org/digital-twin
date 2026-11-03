/** @fileoverview 流水线迁移的生成线形、版本字段与端点契约。 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  ModelingImportInspection,
  ModelingPipelineImportInput,
  ModelingTransferDocument,
  ModelingTransferIssue,
  ModelingTransferOperator,
  ModelingTransferPipeline,
} from '@dt/contracts'
import { expect, it } from 'vitest'

const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)
const spec: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))
const SHAPES = {
  PipelineTransferDocument: {
    format_version: true,
    pipeline: true,
    operators: true,
  } satisfies Record<keyof ModelingTransferDocument, true>,
  PipelineImportIn: {
    document: true,
    code: true,
    name: true,
    description: true,
  } satisfies Record<keyof ModelingPipelineImportInput, true>,
  PipelineImportInspection: {
    document: true,
    can_import: true,
    issues: true,
    source_table_codes: true,
    node_count: true,
    edge_count: true,
  } satisfies Record<keyof ModelingImportInspection, true>,
  TransferPipeline: {
    code: true,
    name: true,
    description: true,
    graph: true,
  } satisfies Record<keyof ModelingTransferPipeline, true>,
  TransferOperator: { operator: true, spec_version: true } satisfies Record<
    keyof ModelingTransferOperator,
    true
  >,
  TransferIssue: {
    level: true,
    message: true,
    node_id: true,
    edge_id: true,
  } satisfies Record<keyof ModelingTransferIssue, true>,
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('缺少OpenAPI对象')
  return value as Record<string, unknown>
}
function at(value: unknown, keys: string[]): unknown {
  return keys.reduce((current: unknown, key) => object(current)[key], value)
}

it.each(Object.entries(SHAPES))(
  '%s 的字段来自当前 platform OpenAPI',
  (name, fields) => {
    expect(
      Object.keys(
        object(at(spec, ['components', 'schemas', name, 'properties'])),
      ).sort(),
    ).toEqual(Object.keys(fields).sort())
  },
)

it('迁移类型可重复生成且格式版本必填', async () => {
  const execute = promisify(execFile)
  await expect(
    execute(
      'uv',
      [
        'run',
        '--no-sync',
        'python',
        '-m',
        'scripts.export_modeling_transfer_types',
        '--check',
      ],
      { cwd: dirname(SPEC_PATH), timeout: 60_000 },
    ),
  ).resolves.toMatchObject({ stdout: '' })
  expect(
    at(spec, ['components', 'schemas', 'PipelineTransferDocument', 'required']),
  ).toContain('format_version')
  expect(
    at(spec, [
      'components',
      'schemas',
      'PipelineTransferDocument',
      'properties',
      'format_version',
      'const',
    ]),
  ).toBe('1.0')
}, 60_000)

it.each([
  [
    '/api/v1/platform/modeling-pipelines:inspect-import',
    '200',
    'ApiResponse_PipelineImportInspection_',
  ],
  [
    '/api/v1/platform/modeling-pipelines:import',
    '201',
    'ApiResponse_PipelineOut_',
  ],
  [
    '/api/v1/platform/modeling-pipelines/{pipeline_id}:export',
    '200',
    'ApiResponse_PipelineTransferDocument_',
  ],
])('%s 的成功状态和响应信封保持一致', (path, status, schema) => {
  expect(
    at(spec, [
      'paths',
      path,
      'post',
      'responses',
      status,
      'content',
      'application/json',
      'schema',
      '$ref',
    ]),
  ).toBe(`#/components/schemas/${schema}`)
})
