/**
 * @fileoverview 把 `@dt/contracts` 的空调与空间类型钉在 platform-server 的
 * openapi.json 上。做法与 auth 那份一致：`Record<keyof T, true>` 在**类型层**
 * 枚举一遍键（漏一个或多一个都过不了 typecheck），再与 openapi 的 properties 比对。
 *
 * ⚠ 手写类型比真接口宽松时编译器无从发现：页面照着读一个后端并不返回的字段，
 * 运行时取到 undefined，崩在渲染里而不是取数处。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  AcModel,
  ModelMetrics,
  ModelMetricsBlock,
  ModelPrediction,
  ModelPredictResult,
  AcDataBinding,
  AcDataset,
  AcItemList,
  AcMetric,
  AcMetricLimit,
  AcSourceObject,
  AcUnit,
  AcUnitRelocateResult,
  CombinationCoverage,
  CursorPage,
  Page,
  RawSample,
  RawSeries,
  Room,
  RoomRef,
  SeriesPoint,
  StartupBatch,
  StartupBatches,
  StartupEpisode,
  StartupExclusion,
  SourceRange,
  StartupRebuildResult,
  Workshop,
  WorkshopRef,
} from '@dt/contracts'
import {
  AC_METRIC_GROUPS,
  AC_METRIC_LIMITS_MAX,
  STARTUP_BATCH_STATUSES,
  STARTUP_EXCLUSION_REASON_MAX,
  STARTUP_OUTCOMES,
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

// 分组的闭集只存在于后端的常量表里，openapi 只说它是 string
const CATALOG_PATH = join(
  process.cwd(),
  '..',
  'server',
  'services',
  'platform-server',
  'src',
  'platform_server',
  'apps',
  'hvac',
  'datasets.py',
)

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

interface OpenApiProperty {
  format?: string
  maxItems?: number
  maxLength?: number
  anyOf?: { type?: string }[]
}

interface OpenApiShape {
  required?: string[]
  properties?: Record<string, OpenApiProperty | undefined>
}

/** 触发重算那条端点的响应码表。 */
function rebuildResponses(): Record<string, unknown> | undefined {
  const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    paths: Record<
      string,
      Record<string, { responses?: Record<string, unknown> }>
    >
  }
  return spec.paths['/api/v1/platform/rooms/{room_id}/startup-batches:rebuild']
    ?.post?.responses
}

/** 同一份 spec 的细粒度视图：键集之外还要看类型、格式与上限。 */
function detailed(): Record<string, OpenApiShape | undefined> {
  return (
    JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
      components: { schemas: Record<string, OpenApiShape> }
    }
  ).components.schemas
}

/** 键集的类型层枚举。少写一个键、或写了接口上没有的键，vue-tsc 直接红。 */
type Keys<T> = Record<keyof T, true>

const SHAPES: Record<string, Record<string, true>> = {
  WorkshopRef: {
    id: true,
    name: true,
  } satisfies Keys<WorkshopRef>,

  RoomRef: {
    id: true,
    name: true,
  } satisfies Keys<RoomRef>,

  WorkshopOut: {
    id: true,
    name: true,
    room_count: true,
    ac_unit_count: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<Workshop>,

  RoomOut: {
    id: true,
    name: true,
    workshop: true,
    ac_unit_count: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<Room>,

  AcUnitOut: {
    id: true,
    serial: true,
    name: true,
    room: true,
    workshop: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<AcUnit>,

  AcUnitRelocateOut: {
    moved_count: true,
    room: true,
    workshop: true,
  } satisfies Keys<AcUnitRelocateResult>,

  Page_AcUnitOut_: {
    items: true,
    page: true,
    size: true,
    total: true,
  } satisfies Keys<Page<AcUnit>>,

  DatasetsOut: {
    items: true,
  } satisfies Keys<AcItemList<AcDataset>>,

  DatasetOut: {
    key: true,
    name: true,
    description: true,
    metrics: true,
  } satisfies Keys<AcDataset>,

  MetricOut: {
    key: true,
    name: true,
    unit: true,
    group: true,
    is_limitable: true,
    is_charted_by_default: true,
  } satisfies Keys<AcMetric>,

  AcDataBindingsOut: {
    items: true,
  } satisfies Keys<AcItemList<AcDataBinding>>,

  AcDataBindingOut: {
    dataset: true,
    source_object: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<AcDataBinding>,

  MetricLimitsOut: {
    items: true,
  } satisfies Keys<AcItemList<AcMetricLimit>>,

  MetricLimitOut: {
    metric: true,
    lower_limit: true,
    upper_limit: true,
  } satisfies Keys<AcMetricLimit>,

  SourceObjectsOut: {
    items: true,
  } satisfies Keys<AcItemList<AcSourceObject>>,

  SourceObjectOut: {
    name: true,
    caption: true,
    row_count_hint: true,
  } satisfies Keys<AcSourceObject>,

  CursorPage_RawSampleOut_: {
    items: true,
    next: true,
    has_more: true,
  } satisfies Keys<CursorPage<RawSample>>,

  RawSampleOut: {
    ts: true,
    workshop_temp_avg: true,
    workshop_humidity_avg: true,
    ac_temp_setpoint: true,
    ac_humidity_setpoint: true,
    fresh_air_temp: true,
    fresh_air_humidity: true,
    supply_air_temp: true,
    supply_air_humidity: true,
    return_air_temp: true,
    return_air_humidity: true,
    mixed_air_temp: true,
    mixed_air_humidity: true,
    chilled_water_supply_temp: true,
    chilled_water_supply_pressure: true,
    heat_steam_temp: true,
    heat_steam_pressure: true,
    humidify_steam_temp: true,
    humidify_steam_pressure: true,
    fan_frequency: true,
  } satisfies Keys<RawSample>,

  RawSeriesOut: {
    interval_minutes: true,
    metrics: true,
    points: true,
  } satisfies Keys<RawSeries>,

  SeriesPointOut: {
    ts: true,
    values: true,
  } satisfies Keys<SeriesPoint>,

  StartupEpisodeOut: {
    started_at: true,
    running_set: true,
    complied_at: true,
    duration_minutes: true,
    outcome: true,
    readings: true,
    idle_minutes: true,
    is_excluded: true,
    exclusion_reason: true,
  } satisfies Keys<StartupEpisode>,

  StartupBatchOut: {
    id: true,
    status: true,
    is_current: true,
    params_fingerprint: true,
    logic_version: true,
    window_start: true,
    window_end: true,
    shard_total: true,
    shard_done: true,
    episode_count: true,
    unmatched_exclusion_count: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<StartupBatch>,

  StartupBatchesOut: {
    items: true,
    current: true,
    coverage: true,
    expected_fingerprint: true,
    is_stale: true,
    source_range: true,
  } satisfies Keys<StartupBatches>,

  SourceRangeOut: {
    start: true,
    end: true,
  } satisfies Keys<SourceRange>,

  CombinationCoverageOut: {
    running_set: true,
    usable_count: true,
  } satisfies Keys<CombinationCoverage>,

  StartupRebuildOut: {
    batch_id: true,
    status: true,
    shard_total: true,
    window_start: true,
    window_end: true,
    is_clamped: true,
  } satisfies Keys<StartupRebuildResult>,

  StartupExclusionOut: {
    started_at: true,
    reason: true,
    excluded_by: true,
    created_at: true,
  } satisfies Keys<StartupExclusion>,

  CursorPage_StartupEpisodeOut_: {
    items: true,
    next: true,
    has_more: true,
  } satisfies Keys<CursorPage<StartupEpisode>>,

  AcModelOut: {
    id: true,
    name: true,
    description: true,
    room: true,
    workshop: true,
    serving_sets: true,
    half_life_days: true,
    status: true,
    error: true,
    feature_version: true,
    trained_at: true,
    sample_count: true,
    window_start: true,
    window_end: true,
    metrics: true,
    is_batch_stale: true,
    is_feature_stale: true,
    created_by: true,
    created_at: true,
    updated_at: true,
  } satisfies Keys<AcModel>,

  MetricsBlockOut: {
    count: true,
    mae: true,
    medae: true,
    rmse: true,
    coverage: true,
    mean_width: true,
    reliability: true,
  } satisfies Keys<ModelMetricsBlock>,

  ModelMetricsOut: {
    overall: true,
    by_set: true,
  } satisfies Keys<ModelMetrics>,

  ModelPredictionOut: {
    started_at: true,
    running_set: true,
    actual_minutes: true,
    p10: true,
    p50: true,
    p90: true,
    fold: true,
  } satisfies Keys<ModelPrediction>,

  PredictOut: {
    p10: true,
    p50: true,
    p90: true,
    interval_width_minutes: true,
    reliability: true,
    is_in_serving_sets: true,
    trained_at: true,
  } satisfies Keys<ModelPredictResult>,

  CursorPage_ModelPredictionOut_: {
    items: true,
    next: true,
    has_more: true,
  } satisfies Keys<CursorPage<ModelPrediction>>,
}

describe('@dt/contracts 与 platform openapi.json 的字段一致', () => {
  it.each(Object.keys(SHAPES))('%s', (schemaName) => {
    const schema = schemas[schemaName]
    expect(schema, `openapi.json 里没有 ${schemaName}`).toBeDefined()
    const actual = Object.keys(schema?.properties ?? {}).sort()
    const declared = Object.keys(SHAPES[schemaName] ?? {}).sort()
    expect(actual).toEqual(declared)
  })

  it('空调的所属位置逐级展开，列表页不必再为每台空调回查一次', () => {
    const keys = Object.keys(schemas.AcUnitOut?.properties ?? {})
    expect(keys).toContain('room')
    expect(keys).toContain('workshop')
  })

  it('时刻字段声明成 date-time，前端由此保住时间语义', () => {
    const properties = detailed().AcUnitOut?.properties ?? {}
    expect(properties.created_at?.format).toBe('date-time')
    expect(properties.updated_at?.format).toBe('date-time')
  })

  it('绑定的两个时刻同样是 date-time', () => {
    const properties = detailed().AcDataBindingOut?.properties ?? {}
    expect(properties.created_at?.format).toBe('date-time')
    expect(properties.updated_at?.format).toBe('date-time')
  })
})

describe('达标范围的上下限是精确小数', () => {
  it.each(['lower_limit', 'upper_limit'])(
    '%s 后端按 string 传，不是 JSON number',
    (field) => {
      const property = detailed().MetricLimitOut?.properties?.[field]
      expect(property?.anyOf?.map((item) => item.type)).toEqual([
        'string',
        'null',
      ])
    },
  )

  it('前端类型也是 string | null——写成 number 会把 20.15 读成 20.149999999999999', () => {
    const limit: AcMetricLimit = {
      metric: 'workshop_temp_avg',
      lower_limit: '20.15',
      upper_limit: null,
    }
    expect(typeof limit.lower_limit).toBe('string')
    expect(limit.upper_limit).toBeNull()
  })
})

describe('入参形状', () => {
  it('设绑定只送对象名，数据集在路径上', () => {
    const keys = Object.keys(schemas.AcDataBindingPutIn?.properties ?? {})
    expect(keys).toEqual(['source_object'])
  })

  it('写达标范围是覆盖式的整包，只有 items 一个键', () => {
    const keys = Object.keys(schemas.MetricLimitsPutIn?.properties ?? {})
    expect(keys).toEqual(['items'])
  })

  it('条数上限与后端同值', () => {
    const items = detailed().MetricLimitsPutIn?.properties?.items
    expect(items?.maxItems).toBe(AC_METRIC_LIMITS_MAX)
  })
})

describe('表格一行与指标目录逐一对应', () => {
  it('RawSampleOut 的字段就是「时刻 + 目录里的每一个指标」，不多不少', () => {
    // ⚠ 表格的列由目录生成：后端某个指标改了 key 而这里没跟上，那一列会静静
    // 渲染成占位符，页面看着完全正常
    const source = readFileSync(CATALOG_PATH, 'utf8')
    const catalogKeys = [...source.matchAll(/^\s+key="([a-z0-9_]+)",$/gm)].map(
      (match) => match[1],
    )
    const shape = Object.keys(schemas.RawSampleOut?.properties ?? {})
    expect(catalogKeys).not.toHaveLength(0)
    expect([...shape].sort()).toEqual([...catalogKeys, 'ts'].sort())
  })

  it('每个测点都是 number | null——null 是断档，不许折成 0', () => {
    const properties = detailed().RawSampleOut?.properties ?? {}
    const readings = Object.entries(properties).filter(([key]) => key !== 'ts')
    expect(readings).not.toHaveLength(0)
    for (const [key, property] of readings) {
      expect(
        property?.anyOf?.map((item) => item.type),
        key,
      ).toEqual(['number', 'null'])
    }
  })
})

describe('指标分组的闭集与后端目录一致', () => {
  it('AC_METRIC_GROUPS 与 datasets.py 的 GROUP_* 常量逐项对上', () => {
    // ⚠ openapi 把 group 声明成自由 string，闭集在后端的常量表里，
    // 只能从那份源码取——后端加一个分组而前端没跟上，穷尽分支会静默漏掉它
    const source = readFileSync(CATALOG_PATH, 'utf8')
    const declared = [
      ...source.matchAll(/^GROUP_[A-Z_]+ = "([a-z_]+)"$/gm),
    ].map((match) => match[1])
    expect(declared).not.toHaveLength(0)
    expect([...declared].sort()).toEqual([...AC_METRIC_GROUPS].sort())
  })
})

describe('开机事件的闭集与后端常量一致', () => {
  // ⚠ openapi 把 outcome 与 status 都声明成自由 string，闭集只在后端的常量表里
  const STARTUP_SOURCE = join(
    process.cwd(),
    '..',
    'server',
    'services',
    'platform-server',
    'src',
    'platform_server',
    'apps',
    'hvac',
    'startups.py',
  )

  it.each([
    ['OUTCOME', STARTUP_OUTCOMES],
    ['BATCH_STATUS', STARTUP_BATCH_STATUSES],
  ])('%s_* 与前端的联合类型逐项对上', (prefix, declared) => {
    const source = readFileSync(STARTUP_SOURCE, 'utf8')
    const found = [
      ...source.matchAll(new RegExp(`^${prefix}_[A-Z_]+ = "([a-z_]+)"$`, 'gm')),
    ].map((match) => match[1])
    expect(found).not.toHaveLength(0)
    expect([...found].sort()).toEqual([...declared].sort())
  })

  it('排除原因的长度上限与后端同值', () => {
    const property = detailed().StartupExclusionIn?.properties?.reason
    expect(property?.maxLength).toBe(STARTUP_EXCLUSION_REASON_MAX)
  })

  it('达标时长可以为 null，也可以是 0——0 是「一起来就达标」，不是没有值', () => {
    const property = detailed().StartupEpisodeOut?.properties?.duration_minutes
    expect(property?.anyOf?.map((item) => item.type)).toEqual([
      'integer',
      'null',
    ])
  })

  it('抽取区间两端都可省——空请求体就是全部可用历史', () => {
    const shape = detailed().StartupRebuildIn
    expect(shape?.required ?? []).toEqual([])
    for (const key of ['window_start', 'window_end']) {
      expect(
        shape?.properties?.[key]?.anyOf?.map((item) => item.type),
        key,
      ).toContain('null')
    }
  })

  it('触发重算只入队：202 而不是 200', () => {
    const responses = Object.keys(rebuildResponses() ?? {})
    expect(responses).toContain('202')
    expect(responses).not.toContain('200')
  })
})
