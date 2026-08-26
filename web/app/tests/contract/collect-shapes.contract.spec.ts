/**
 * @fileoverview 把 `@dt/contracts` 的采集类型钉在 platform-server 的
 * openapi.json 上。
 *
 * 做法与 `opcua-shapes.contract.spec.ts` 同源，理由也同源：手写的类型比真接口
 * 宽松时，页面对着不存在的字段取值会拿到 undefined 并**崩在渲染里**，而
 * typecheck、lint、单测全绿——编译器无从发现后端改了字段名。
 *
 * ⚠ 还额外钉两件后端与前端各存一份的**数字**：批量建点的单批上限与采样周期
 * 下限。它们漂开的表现分别是「导入永远 422」与「表单放行一个后端会拒的值」，
 * 两者都不会在任何编译期报出来。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  CollectAddressCheck,
  CollectBrowseItem,
  CollectBrowseResult,
  CollectConnectivity,
  CollectHistoryAggregate,
  CollectHistoryBucket,
  CollectPoint,
  CollectPointBatch,
  CollectPointSaved,
  CollectSource,
  CollectSourceRuntime,
  CollectSubtreeItem,
  CollectSubtreeResult,
  CollectWriteResult,
  Page,
} from '@dt/contracts'
import {
  COLLECT_DATA_TYPES,
  COLLECT_MIN_INTERVAL_MS,
  COLLECT_POINT_BATCH_MAX,
  COLLECT_PROTOCOLS,
  COLLECT_READ_MODES,
} from '@dt/contracts'

interface OpenApiSchema {
  properties?: Record<string, unknown>
}

// ⚠ 用 process.cwd()（= web/）而不是 import.meta.url：happy-dom 下后者不是 file URL
const SPEC_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'openapi.json',
)

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
  components: { schemas: Record<string, OpenApiSchema> }
}
const schemas = spec.components.schemas

type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  SourceOut: {
    id: true,
    name: true,
    code: true,
    description: true,
    protocol: true,
    endpoint: true,
    username: true,
    has_credential: true,
    options_json: true,
    read_mode: true,
    poll_interval_ms: true,
    is_enabled: true,
    point_count: true,
    live_point_limit: true,
    runtime: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<CollectSource>,

  SourceRuntimeOut: {
    state: true,
    point_count: true,
    error_category: true,
    error_detail: true,
    leader_instance: true,
    updated_at: true,
  } satisfies Keys<CollectSourceRuntime>,

  ConnectivityOut: {
    source_id: true,
    is_reachable: true,
    detail: true,
  } satisfies Keys<CollectConnectivity>,

  BrowseItemOut: {
    address: true,
    name: true,
    has_children: true,
    is_variable: true,
    data_type: true,
  } satisfies Keys<CollectBrowseItem>,

  BrowseOut: {
    items: true,
  } satisfies Keys<CollectBrowseResult>,

  SubtreeItemOut: {
    parent: true,
    address: true,
    name: true,
    has_children: true,
    is_variable: true,
    data_type: true,
  } satisfies Keys<CollectSubtreeItem>,

  SubtreeOut: {
    items: true,
    is_truncated: true,
  } satisfies Keys<CollectSubtreeResult>,

  PointOut: {
    id: true,
    source_id: true,
    node_key: true,
    code: true,
    name: true,
    address: true,
    data_type: true,
    unit: true,
    sampling_interval_ms: true,
    deadband: true,
    archive_enabled: true,
    archive_max_interval_ms: true,
    archive_retention_days: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<CollectPoint>,

  AddressCheckOut: {
    address: true,
    status: true,
    detail: true,
  } satisfies Keys<CollectAddressCheck>,

  PointBatchOut: {
    items: true,
    address_checks: true,
  } satisfies Keys<CollectPointBatch>,

  PointSavedOut: {
    point: true,
    address_check: true,
  } satisfies Keys<CollectPointSaved>,

  WriteOut: {
    point_id: true,
    node_key: true,
    is_written: true,
  } satisfies Keys<CollectWriteResult>,

  AggregateBucketOut: {
    node_key: true,
    bucket_start: true,
    value: true,
    sample_count: true,
  } satisfies Keys<CollectHistoryBucket>,

  AggregateOut: {
    items: true,
    interval: true,
    aggregate: true,
    timezone: true,
    is_truncated: true,
  } satisfies Keys<CollectHistoryAggregate>,

  Page_SourceOut_: {
    items: true,
    page: true,
    size: true,
    total: true,
  } satisfies Keys<Page<CollectSource>>,
}

describe('@dt/contracts 的采集类型与 openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })
})

/** 从 openapi 里取一个字段的枚举 / const 取值集合。 */
function literalsOf(schemaName: string, field: string): string[] {
  const property = schemas[schemaName]?.properties?.[field]
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null) return
    const shape: Record<string, unknown> = { ...node }
    if (Array.isArray(shape.enum)) {
      for (const value of shape.enum) {
        if (typeof value === 'string') found.push(value)
      }
    }
    if (typeof shape.const === 'string') found.push(shape.const)
    for (const value of Object.values(shape)) {
      if (Array.isArray(value)) value.forEach(walk)
      else walk(value)
    }
  }
  walk(property)
  return [...new Set(found)].sort()
}

/** 从 openapi 里取一个字段的数值约束。 */
function constraintOf(schemaName: string, field: string, key: string): unknown {
  const property = schemas[schemaName]?.properties?.[field]
  if (typeof property !== 'object' || property === null) return undefined
  return Reflect.get(property, key)
}

describe('const 联合与后端的闭合集合一致', () => {
  it('协议', () => {
    expect([...COLLECT_PROTOCOLS].sort()).toEqual(
      literalsOf('SourceCreateIn', 'protocol'),
    )
  })

  it('读取方式', () => {
    expect([...COLLECT_READ_MODES].sort()).toEqual(
      literalsOf('SourceCreateIn', 'read_mode'),
    )
  })

  it('数据类型', () => {
    expect([...COLLECT_DATA_TYPES].sort()).toEqual(
      literalsOf('PointItemIn', 'data_type'),
    )
  })
})

describe('两处前后端各存一份的数字', () => {
  it('批量建点的单批上限与后端同值', () => {
    // ⚠ 前端切批比后端大一条，表现就是「每一批都 422」，而文件本身没问题
    expect(constraintOf('PointCreateIn', 'items', 'maxItems')).toBe(
      COLLECT_POINT_BATCH_MAX,
    )
  })

  it('采样周期的下限与后端同值', () => {
    // ⚠ 前端放得比后端松，表现是表单说「可以」而保存时 422 指到一个字段
    expect(constraintOf('PointItemIn', 'sampling_interval_ms', 'minimum')).toBe(
      COLLECT_MIN_INTERVAL_MS,
    )
  })
})
