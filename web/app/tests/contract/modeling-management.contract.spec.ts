/** @fileoverview 建模命令和切换历史与 platform OpenAPI 的字段、可空性及路径契约。 */
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  MODELING_COMMAND_OPERATIONS,
  MODELING_COMMAND_STATES,
} from '@dt/contracts'
import type {
  ModelDeploymentSwitch,
  ModelingCommand,
  ModelingCommandFailure,
  ModelingCommandOperation,
  ModelingCommandState,
} from '@dt/contracts'

type WireKind<T> =
  NonNullable<T> extends string
    ? 'string'
    : NonNullable<T> extends number
      ? 'integer'
      : NonNullable<T> extends boolean
        ? 'boolean'
        : NonNullable<T> extends readonly unknown[]
          ? 'array'
          : 'object'

type Fields<T> = {
  [Key in keyof T]-?: {
    type: WireKind<T[Key]>
    isNullable: null extends T[Key] ? true : false
    isRequired: Record<string, never> extends Pick<T, Key> ? false : true
    reference?: string
    format?: 'uuid' | 'date-time'
    itemsReference?: string
    valuesReference?: string
  }
}

interface WireField {
  type: string
  isNullable: boolean
  isRequired: boolean
  reference?: string
  format?: string
  itemsReference?: string
  valuesReference?: string
}

const FAILURE = {
  code: { type: 'integer', isNullable: false, isRequired: true },
  message: { type: 'string', isNullable: false, isRequired: true },
  details: {
    type: 'array',
    isNullable: false,
    isRequired: true,
    itemsReference: 'FieldErrorOut',
  },
} satisfies Fields<ModelingCommandFailure>

const SWITCH = {
  id: { type: 'string', isNullable: false, isRequired: true, format: 'uuid' },
  deployment_id: {
    type: 'string',
    isNullable: true,
    isRequired: true,
    format: 'uuid',
  },
  deployment_code: { type: 'string', isNullable: false, isRequired: true },
  from_model_version_id: {
    type: 'string',
    isNullable: false,
    isRequired: true,
    format: 'uuid',
  },
  to_model_version_id: {
    type: 'string',
    isNullable: false,
    isRequired: true,
    format: 'uuid',
  },
  revision: { type: 'integer', isNullable: false, isRequired: true },
  rollback_of_id: {
    type: 'string',
    isNullable: true,
    isRequired: true,
    format: 'uuid',
  },
  is_signature_change_confirmed: {
    type: 'boolean',
    isNullable: false,
    isRequired: true,
  },
  created_by_name: { type: 'string', isNullable: false, isRequired: true },
  created_at: {
    type: 'string',
    isNullable: false,
    isRequired: true,
    format: 'date-time',
  },
} satisfies Fields<ModelDeploymentSwitch>

const COMMAND = {
  id: { type: 'string', isNullable: false, isRequired: true, format: 'uuid' },
  operation: { type: 'string', isNullable: false, isRequired: true },
  resource_id: {
    type: 'string',
    isNullable: true,
    isRequired: true,
    format: 'uuid',
  },
  state: { type: 'string', isNullable: false, isRequired: true },
  http_status: { type: 'integer', isNullable: true, isRequired: true },
  result: {
    type: 'object',
    isNullable: true,
    isRequired: true,
    valuesReference: 'JsonValue',
  },
  error: {
    type: 'object',
    isNullable: true,
    isRequired: true,
    reference: 'CommandFailureOut',
  },
  created_at: {
    type: 'string',
    isNullable: false,
    isRequired: true,
    format: 'date-time',
  },
  completed_at: {
    type: 'string',
    isNullable: true,
    isRequired: true,
    format: 'date-time',
  },
  trace_id: { type: 'string', isNullable: false, isRequired: true },
  is_verification_required: {
    type: 'boolean',
    isNullable: false,
    isRequired: true,
  },
} satisfies Fields<ModelingCommand>

const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)
const SPEC: unknown = JSON.parse(readFileSync(SPEC_PATH, 'utf8'))

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function objectOf(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new Error('OpenAPI 字段不是对象')
  }
  return value
}

function readAt(value: unknown, keys: readonly string[]): unknown {
  return keys.reduce<unknown>((current, key) => objectOf(current)[key], value)
}

function checkField(schema: unknown, expected: WireField): void {
  const field = objectOf(schema)
  const branches = Array.isArray(field['anyOf'])
    ? field['anyOf'].map(objectOf)
    : [field]
  expect(branches.some((branch) => branch['type'] === 'null')).toBe(
    expected.isNullable,
  )
  const actual = objectOf(branches.find((branch) => branch['type'] !== 'null'))
  if (expected.reference) {
    expect(actual['$ref']).toBe(`#/components/schemas/${expected.reference}`)
  } else {
    expect(actual['type']).toBe(expected.type)
  }
  expect(actual['format']).toBe(expected.format)
  if (expected.itemsReference) {
    expect(readAt(actual, ['items', '$ref'])).toBe(
      `#/components/schemas/${expected.itemsReference}`,
    )
  }
  if (expected.valuesReference) {
    expect(readAt(actual, ['additionalProperties', '$ref'])).toBe(
      `#/components/schemas/${expected.valuesReference}`,
    )
  }
}

const SHAPES: ReadonlyArray<readonly [string, Record<string, WireField>]> = [
  ['CommandFailureOut', FAILURE],
  ['DeploymentSwitchOut', SWITCH],
  ['ModelingCommandOut', COMMAND],
]

const COMMANDS_PATH = '/api/v1/platform/modeling-commands'
const DEPLOYMENT_PATH = '/api/v1/platform/modeling-deployments/{deployment_id}'

describe('建模命令与部署切换契约', () => {
  it('管理线形和枚举可由 OpenAPI 重复生成', async () => {
    const execute = promisify(execFile)
    await expect(
      execute(
        'uv',
        [
          'run',
          '--no-sync',
          'python',
          '-m',
          'scripts.export_modeling_management_types',
          '--check',
        ],
        { cwd: dirname(SPEC_PATH), timeout: 60_000 },
      ),
    ).resolves.toMatchObject({ stdout: '' })
  }, 60_000)

  it.each(SHAPES)('%s 的键、必填、可空性及字段类型一致', (name, fields) => {
    const schema = readAt(SPEC, ['components', 'schemas', name])
    const properties = objectOf(readAt(schema, ['properties']))
    expect(Object.keys(properties).sort()).toEqual(Object.keys(fields).sort())
    const required = readAt(schema, ['required'])
    if (!Array.isArray(required)) throw new Error('缺少必填字段清单')
    expect([...required].sort()).toEqual(
      Object.entries(fields)
        .filter(([, field]) => field.isRequired)
        .map(([key]) => key)
        .sort(),
    )
    for (const [key, expected] of Object.entries(fields)) {
      checkField(properties[key], expected)
    }
  })

  it('17种操作和4个状态与查询参数及命令出参一致', () => {
    expectTypeOf<
      ModelingCommand['operation']
    >().toEqualTypeOf<ModelingCommandOperation>()
    expectTypeOf<
      ModelingCommand['state']
    >().toEqualTypeOf<ModelingCommandState>()
    const properties = [
      'components',
      'schemas',
      'ModelingCommandOut',
      'properties',
    ]
    expect(readAt(SPEC, [...properties, 'operation', 'enum'])).toEqual([
      ...MODELING_COMMAND_OPERATIONS,
    ])
    expect(readAt(SPEC, [...properties, 'state', 'enum'])).toEqual([
      ...MODELING_COMMAND_STATES,
    ])
    const parameters = readAt(SPEC, [
      'paths',
      COMMANDS_PATH,
      'get',
      'parameters',
    ])
    if (!Array.isArray(parameters)) throw new Error('缺少命令查询参数')
    const operation = parameters
      .map(objectOf)
      .find((item) => item['name'] === 'operation')
    expect(readAt(operation, ['schema', 'enum'])).toEqual([
      ...MODELING_COMMAND_OPERATIONS,
    ])
    expect(
      parameters
        .map(objectOf)
        .find((item) => item['name'] === 'Idempotency-Key'),
    ).toMatchObject({ in: 'header', required: true })
  })

  it.each([
    [COMMANDS_PATH, 'get', 'ApiResponse_ModelingCommandOut_'],
    [`${COMMANDS_PATH}/{command_id}`, 'get', 'ApiResponse_ModelingCommandOut_'],
    [`${DEPLOYMENT_PATH}:switch`, 'post', 'ApiResponse_ModelDeploymentOut_'],
    [`${DEPLOYMENT_PATH}:rollback`, 'post', 'ApiResponse_ModelDeploymentOut_'],
    [
      `${DEPLOYMENT_PATH}/switches`,
      'get',
      'ApiResponse_CursorPage_DeploymentSwitchOut__',
    ],
    [
      '/api/v1/platform/modeling-instances/{instance_id}:archive',
      'post',
      'ApiResponse_ModelingInstanceOut_',
    ],
    [
      '/api/v1/platform/modeling-instances/{instance_id}:restore',
      'post',
      'ApiResponse_ModelingInstanceOut_',
    ],
    [
      '/api/v1/platform/modeling-model-versions/{version_id}:archive',
      'post',
      'ApiResponse_ModelVersionOut_',
    ],
    [
      '/api/v1/platform/modeling-model-versions/{version_id}:restore',
      'post',
      'ApiResponse_ModelVersionOut_',
    ],
    [
      '/api/v1/platform/modeling-model-versions/{version_id}/deployments',
      'get',
      'ApiResponse_CursorPage_ModelDeploymentOut__',
    ],
  ])('%s %s 读取真实响应资源', (path, method, response) => {
    expect(
      readAt(SPEC, [
        'paths',
        path,
        method,
        'responses',
        '200',
        'content',
        'application/json',
        'schema',
        '$ref',
      ]),
    ).toBe(`#/components/schemas/${response}`)
  })
})
