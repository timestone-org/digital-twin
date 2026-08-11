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
  AcUnit,
  AcUnitRelocateResult,
  Page,
  Room,
  RoomRef,
  Workshop,
  WorkshopRef,
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

const schemas = (
  JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
    components: { schemas: Record<string, OpenApiSchema> }
  }
).components.schemas

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
    const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as {
      components: {
        schemas: Record<
          string,
          { properties?: Record<string, { format?: string }> }
        >
      }
    }
    const properties = spec.components.schemas.AcUnitOut?.properties ?? {}
    expect(properties.created_at?.format).toBe('date-time')
    expect(properties.updated_at?.format).toBe('date-time')
  })
})
