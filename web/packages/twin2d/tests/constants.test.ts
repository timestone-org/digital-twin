/**
 * @fileoverview 锁死三个绑定槽键在两处的一致：模块清单声明的槽键与行 fieldKey 构造。
 * ⚠ 这两处任意一处把名字写错，typecheck 与 lint 都放行，表现只是「这个槽永远取不到值」。
 * 顺带锁住归一化共用的上限与缺省——缺省落到区间外时，脏数据会被"修"成另一个非法值。
 */
import type { BindingSpec } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_CONFIG_KEY,
  TWIN_2D_CONFIG_VERSION,
  TWIN_2D_DEFAULT_CANVAS_HEIGHT,
  TWIN_2D_DEFAULT_CANVAS_WIDTH,
  TWIN_2D_DEFAULT_FIT_PADDING,
  TWIN_2D_DEFAULT_FLOW_SPEED,
  TWIN_2D_DEFAULT_GRID,
  TWIN_2D_DEFAULT_PLACEHOLDER,
  TWIN_2D_EDGE_BINDING_KEY,
  TWIN_2D_EDGE_ROW_SLOTS,
  TWIN_2D_MAX_CANVAS_SIZE,
  TWIN_2D_MAX_EXPR_DEPTH,
  TWIN_2D_MAX_FIT_PADDING,
  TWIN_2D_MAX_FLOW_SPEED,
  TWIN_2D_MAX_GRID,
  TWIN_2D_MAX_PRIM_DEPTH,
  TWIN_2D_MAX_TAG_LENGTH,
  TWIN_2D_MIN_CANVAS_SIZE,
  TWIN_2D_MIN_FIT_PADDING,
  TWIN_2D_MIN_FLOW_SPEED,
  TWIN_2D_MIN_GRID,
  TWIN_2D_NODE_BINDING_KEY,
  TWIN_2D_NODE_ROW_SLOTS,
  TWIN_2D_STATUS_BINDING_KEY,
  TWIN_2D_STATUS_ROW_SLOTS,
  TWIN_2D_VIEW_BINDINGS,
  arrayRowFieldKey,
  edgeRowFieldKey,
  nodeRowFieldKey,
  statusRowFieldKey,
} from '../src/constants'

function specOf(key: string): BindingSpec {
  const found = TWIN_2D_VIEW_BINDINGS.find((spec) => spec.key === key)
  if (found === undefined) throw new Error(`模块清单里没有绑定槽 ${key}`)
  return found
}

function fieldKeysOf(spec: BindingSpec): string[] {
  return (spec.arrayFields ?? []).map((field) => field.key)
}

describe('文档身份', () => {
  it('配置键与版本是写死的字面量', () => {
    expect(TWIN_2D_CONFIG_KEY).toBe('twin2d')
    expect(TWIN_2D_CONFIG_VERSION).toBe(1)
  })

  it('三个槽键各是自己的字面量', () => {
    expect(TWIN_2D_NODE_BINDING_KEY).toBe('nodeValues')
    expect(TWIN_2D_STATUS_BINDING_KEY).toBe('nodeStatus')
    expect(TWIN_2D_EDGE_BINDING_KEY).toBe('edgeValues')
  })
})

describe('绑定槽清单', () => {
  it('清单里的槽与槽键常量逐字一致', () => {
    expect(TWIN_2D_VIEW_BINDINGS.map((spec) => spec.key)).toEqual([
      TWIN_2D_NODE_BINDING_KEY,
      TWIN_2D_STATUS_BINDING_KEY,
      TWIN_2D_EDGE_BINDING_KEY,
    ])
  })

  // ⚠ 三个槽的行都钉在实体上：漏掉这个标记会让面板要求索引连续，
  //   而「一张图四十个槽位只接三个点位」正是这个模块的常态
  it('三个槽都是数组槽且都钉实体、都声明了行内子槽', () => {
    for (const spec of TWIN_2D_VIEW_BINDINGS) {
      expect(spec.isArray).toBe(true)
      expect(spec.isEntityPinned).toBe(true)
      expect(fieldKeysOf(spec).length).toBeGreaterThan(0)
    }
  })

  it('清单声明的行内子槽与子槽常量逐字一致', () => {
    expect(fieldKeysOf(specOf(TWIN_2D_NODE_BINDING_KEY))).toEqual([
      ...TWIN_2D_NODE_ROW_SLOTS,
    ])
    expect(fieldKeysOf(specOf(TWIN_2D_STATUS_BINDING_KEY))).toEqual([
      ...TWIN_2D_STATUS_ROW_SLOTS,
    ])
    expect(fieldKeysOf(specOf(TWIN_2D_EDGE_BINDING_KEY))).toEqual([
      ...TWIN_2D_EDGE_ROW_SLOTS,
    ])
  })

  // ⚠ 声明了 enumMap 会把数值 1 换成映射表里的串，toDeviceStatus 认不出来于是
  //   全图状态集体退回 unknown（灰），而没有任何一处报错（§10.2）
  it('节点状态的子槽刻意不声明 enumMap', () => {
    const [field] = specOf(TWIN_2D_STATUS_BINDING_KEY).arrayFields ?? []
    expect(field?.enumMap).toBeUndefined()
  })

  // ⚠ 状态槽也是 `number`：状态在这里是数字编码（0/1/2/3），由 toDeviceStatus
  //   分档。`enum` 那一档的意思是「配了 enumMap，值要换成映射里的文案」——
  //   声明成 enum 却不给 map，等于摆着一个「看起来该配映射」的槽等人踩，
  //   还让绑点面板上静态常量那一格从数字框退化成文本框
  it('三个槽的 dataType 都是数值', () => {
    expect(specOf(TWIN_2D_NODE_BINDING_KEY).dataType).toBe('number')
    expect(specOf(TWIN_2D_STATUS_BINDING_KEY).dataType).toBe('number')
    expect(specOf(TWIN_2D_EDGE_BINDING_KEY).dataType).toBe('number')
  })

  it('节点状态的子槽也是数值', () => {
    const [field] = specOf(TWIN_2D_STATUS_BINDING_KEY).arrayFields ?? []
    expect(field?.dataType).toBe('number')
  })

  // ⚠ 一张纯静态工艺图是合法用法，所以本模块没有必绑槽
  it('一个槽都不是必绑', () => {
    for (const spec of TWIN_2D_VIEW_BINDINGS) {
      expect(spec.isRequired).toBeUndefined()
    }
  })
})

describe('数组行 fieldKey', () => {
  it('形状是 槽键[下标].子槽', () => {
    expect(arrayRowFieldKey('rows', 0, 'value')).toBe('rows[0].value')
  })

  it('三类的构造函数走同一套形状', () => {
    expect(nodeRowFieldKey(4)).toBe('nodeValues[4].value')
    expect(statusRowFieldKey(2)).toBe('nodeStatus[2].status')
    expect(edgeRowFieldKey(0, 'active')).toBe('edgeValues[0].active')
    expect(edgeRowFieldKey(1, 'direction')).toBe('edgeValues[1].direction')
    expect(edgeRowFieldKey(3, 'value')).toBe('edgeValues[3].value')
  })

  it('构造出的 fieldKey 前缀就是清单里的槽键', () => {
    expect(nodeRowFieldKey(0).startsWith(TWIN_2D_NODE_BINDING_KEY)).toBe(true)
    expect(statusRowFieldKey(0).startsWith(TWIN_2D_STATUS_BINDING_KEY)).toBe(
      true,
    )
    expect(
      edgeRowFieldKey(0, 'value').startsWith(TWIN_2D_EDGE_BINDING_KEY),
    ).toBe(true)
  })
})

describe('上限与缺省', () => {
  it('两条递归深度是文档里的 6 与 3', () => {
    expect(TWIN_2D_MAX_PRIM_DEPTH).toBe(6)
    expect(TWIN_2D_MAX_EXPR_DEPTH).toBe(3)
  })

  it('画布下限 200、网格 2..200', () => {
    expect(TWIN_2D_MIN_CANVAS_SIZE).toBe(200)
    expect(TWIN_2D_MIN_GRID).toBe(2)
    expect(TWIN_2D_MAX_GRID).toBe(200)
  })

  // ⚠ 缺省本身落在区间外时，脏数据会被"修"成另一个非法值而且一路不报错
  it('每个缺省都落在自己的区间内', () => {
    expect(TWIN_2D_DEFAULT_CANVAS_WIDTH).toBeGreaterThanOrEqual(
      TWIN_2D_MIN_CANVAS_SIZE,
    )
    expect(TWIN_2D_DEFAULT_CANVAS_HEIGHT).toBeGreaterThanOrEqual(
      TWIN_2D_MIN_CANVAS_SIZE,
    )
    expect(TWIN_2D_DEFAULT_CANVAS_WIDTH).toBeLessThanOrEqual(
      TWIN_2D_MAX_CANVAS_SIZE,
    )
    expect(TWIN_2D_DEFAULT_CANVAS_HEIGHT).toBeLessThanOrEqual(
      TWIN_2D_MAX_CANVAS_SIZE,
    )
    expect(TWIN_2D_DEFAULT_GRID).toBeGreaterThanOrEqual(TWIN_2D_MIN_GRID)
    expect(TWIN_2D_DEFAULT_GRID).toBeLessThanOrEqual(TWIN_2D_MAX_GRID)
    expect(TWIN_2D_DEFAULT_FIT_PADDING).toBeGreaterThanOrEqual(
      TWIN_2D_MIN_FIT_PADDING,
    )
    expect(TWIN_2D_DEFAULT_FIT_PADDING).toBeLessThanOrEqual(
      TWIN_2D_MAX_FIT_PADDING,
    )
    expect(TWIN_2D_DEFAULT_FLOW_SPEED).toBeGreaterThanOrEqual(
      TWIN_2D_MIN_FLOW_SPEED,
    )
    expect(TWIN_2D_DEFAULT_FLOW_SPEED).toBeLessThanOrEqual(
      TWIN_2D_MAX_FLOW_SPEED,
    )
  })

  it('占位符是 em dash，标签长度上限是正数', () => {
    expect(TWIN_2D_DEFAULT_PLACEHOLDER).toBe('—')
    expect(TWIN_2D_MAX_TAG_LENGTH).toBeGreaterThan(0)
  })
})
