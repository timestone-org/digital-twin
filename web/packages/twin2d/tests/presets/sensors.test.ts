/**
 * @fileoverview 守 4 种预置传感器药丸：缩写 / 中文名 / 主色 / 单位 / 默认槽位逐值同
 * 参考项目的 `BUILTIN_SENSOR_KINDS`，药丸本体的尺寸、描边、外发光与三片文字的字号
 * 逐值同 `.topo-sensor`。
 *
 * ⚠ 最要紧的一条是「药丸只由 box + txt 拼出来」：它一旦长成第五种图元 kind 或一个
 * 专用渲染分支，「内置库只是预置数据」这句话就不再成立，而这个退化过程没有任何一步
 * 会报错——只有这里的 kind 穷举拦得住。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_DEFAULT_PLACEHOLDER } from '../../src/constants'
import { TWIN_2D_PRIM_KINDS } from '../../src/kinds'
import { normalizePrim } from '../../src/normalizePrims'
import { normalizeSlot } from '../../src/normalizeStyles'
import { TWIN_2D_PALETTE } from '../../src/presets/palette'
import {
  TWIN_2D_SENSOR_DEFAULT_AT,
  TWIN_2D_SENSOR_DEFS,
  TWIN_2D_SENSOR_PILLS,
  TWIN_2D_SENSOR_PLACEHOLDER,
  TWIN_2D_SENSOR_SLOTS,
  twin2dSensorIdPrefix,
  twin2dSensorPill,
  twin2dSensorSlot,
} from '../../src/presets/sensors'
import type { Twin2dSensorDef } from '../../src/presets/sensors'
import type { Twin2dBoxPrim, Twin2dPrim } from '../../src/typesPrim'

/** 参考项目 `BUILTIN_SENSOR_KINDS` 的 4 条：缩写 / 中文名 / 主色 / 单位 / 默认字段 */
const REFERENCE: readonly (readonly [
  string,
  string,
  string,
  string,
  string,
])[] = [
  ['TT', '温度', '#62ff8a', '℃', 'temperature_c'],
  ['FT', '流量', '#ff9b54', 'm³/h', 'flow_m3h'],
  ['PT', '压力', '#2fe9ff', 'kPa', 'pressure_kpa'],
  ['LT', '液位', '#7bd5ff', '%', 'level_pct'],
]

function defOf(id: string): Twin2dSensorDef {
  const found = TWIN_2D_SENSOR_DEFS.find((def) => def.id === id)
  if (found === undefined) throw new Error(`没有预置传感器 ${id}`)
  return found
}

function pillOf(id: string): Twin2dBoxPrim {
  const prefix = twin2dSensorIdPrefix(defOf(id))
  const found = TWIN_2D_SENSOR_PILLS.find(
    (pill) => pill.id === `${prefix}-pill`,
  )
  if (found === undefined) throw new Error(`没有预置药丸 ${id}`)
  return found
}

/** 递归收一棵图元树上用到的全部 kind 与全部 id。 */
function walk(prims: readonly Twin2dPrim[], seen: Twin2dPrim[]): Twin2dPrim[] {
  for (const prim of prims) {
    seen.push(prim)
    if (prim.kind === 'box') walk(prim.children, seen)
  }
  return seen
}

describe('预置传感器的清单', () => {
  it('刚好 4 种，缩写与文档序逐字同参考项目', () => {
    expect(TWIN_2D_SENSOR_DEFS.map((def) => def.id)).toEqual(
      REFERENCE.map(([id]) => id),
    )
  })

  it.each(REFERENCE)(
    '%s 的中文名 / 主色 / 单位 / 默认槽位逐值',
    (id, label, color, unit, slotKey) => {
      const def = defOf(id)
      expect(def.label).toBe(label)
      expect(TWIN_2D_PALETTE[def.paletteKey]).toBe(color)
      expect(def.unit).toBe(unit)
      expect(def.slotKey).toBe(slotKey)
    },
  )

  it('主色是系列色板的复用，不是温度语义色', () => {
    // ⚠ TT 是绿的：照「温度当然是红的」把它换成 tempHot 就与参考项目不再同色
    expect(TWIN_2D_PALETTE[defOf('TT').paletteKey]).not.toBe(
      TWIN_2D_PALETTE.tempHot,
    )
    expect(TWIN_2D_PALETTE[defOf('TT').paletteKey]).toBe(
      TWIN_2D_PALETTE.wasteHeat,
    )
  })

  it('四枚药丸的图元 id 两两不重名，同一个节点上能一起挂', () => {
    const ids = walk(TWIN_2D_SENSOR_PILLS, []).map((prim) => prim.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(16)
  })
})

describe('药丸只是 box + txt 的组合', () => {
  it('一个 box 套三个 txt，一个第五种 kind 都没有用到', () => {
    const kinds = new Set(walk(TWIN_2D_SENSOR_PILLS, []).map((p) => p.kind))
    expect([...kinds].sort()).toEqual(['box', 'txt'])
    for (const kind of kinds) {
      expect(TWIN_2D_PRIM_KINDS).toContain(kind)
    }
  })

  it('每一枚都是 1 个 box + 3 个 txt', () => {
    for (const pill of TWIN_2D_SENSOR_PILLS) {
      expect(pill.kind).toBe('box')
      expect(pill.children).toHaveLength(3)
      expect(pill.children.map((child) => child.kind)).toEqual([
        'txt',
        'txt',
        'txt',
      ])
    }
  })

  it('整枚都不吃指针事件（子片上放开一格就把命中判定打回来）', () => {
    for (const prim of walk(TWIN_2D_SENSOR_PILLS, [])) {
      expect(prim.pointerEvents).toBe('none')
    }
  })
})

describe('一枚药丸的取值', () => {
  const pill = pillOf('TT')
  const color = TWIN_2D_PALETTE.wasteHeat

  it('落点缺省是上边中点外侧', () => {
    expect(pill.at).toEqual(TWIN_2D_SENSOR_DEFAULT_AT)
    expect(pill.at).toEqual({ kind: 'anchor', anchor: 't', dx: 0, dy: 0 })
  })

  it('药丸底：pill 圆角、1px 主色描边、6px 主色外发光', () => {
    expect(pill.radius).toBe('pill')
    expect(pill.border.width).toBe(1)
    expect(pill.border.color).toBe(color)
    expect(pill.shadows).toEqual([
      {
        id: 'pill-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 6,
        spread: 0,
        color: `color-mix(in srgb, ${color} 55%, transparent)`,
      },
    ])
  })

  it('底色照抄参考项目那条只活在兜底位的 var 链', () => {
    expect(pill.fills).toEqual([
      {
        kind: 'solid',
        id: 'pill-fill',
        color: 'var(--t2-fill-a, var(--surface-panel))',
        opacity: 1,
      },
    ])
  })

  it('三片按基线排一行，间隙与内边距是 16px 基准下的 em 折算值', () => {
    expect(pill.layout).toEqual({
      flow: 'row',
      gap: 4.48,
      align: 'baseline',
      justify: 'start',
      wrap: false,
      pad: [1.92, 8, 1.92, 8],
    })
  })

  it('缩写片：字面量、700、0.04em 字距', () => {
    const tag = pill.children[0]
    expect(tag?.kind === 'txt' ? tag.src : null).toEqual({
      kind: 'lit',
      text: 'TT',
    })
    expect(tag?.kind === 'txt' ? tag.font : null).toEqual({
      family: 'var(--font-display)',
      size: 16,
      weight: 700,
      letterSpacing: 0.64,
      color,
    })
  })

  it('读数片：接槽位、等宽数字字族、0 0 5px 的同色字晕', () => {
    const value = pill.children[1]
    expect(value?.kind === 'txt' ? value.src : null).toEqual({
      kind: 'slot',
      slot: 'temperature_c',
    })
    expect(value?.kind === 'txt' ? value.font.family : '').toBe(
      'var(--font-digit)',
    )
    expect(value?.kind === 'txt' ? value.shadows : []).toEqual([
      {
        id: 'reading-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 5,
        spread: 0,
        color: 'currentColor',
      },
    ])
  })

  it('单位片：0.78em、透明度 .82、写的是本种的单位', () => {
    const unit = pill.children[2]
    expect(unit?.kind === 'txt' ? unit.src : null).toEqual({
      kind: 'lit',
      text: '℃',
    })
    expect(unit?.kind === 'txt' ? unit.font.size : 0).toBe(12.48)
    expect(unit?.opacity).toBe(0.82)
    expect(unit?.hidden).toBe(false)
  })

  it('三片都跟着本种主色走，不靠继承', () => {
    for (const child of pill.children) {
      expect(child.kind === 'txt' ? child.font.color : '').toBe(color)
    }
  })
})

describe('没有单位的那一种', () => {
  const def: Twin2dSensorDef = {
    id: 'XX',
    label: '无单位',
    paletteKey: 'solar',
    unit: '',
    slotKey: 'raw',
  }

  it('单位片整片不渲染，而不是渲染成一个空 span', () => {
    const pill = twin2dSensorPill(def, TWIN_2D_SENSOR_DEFAULT_AT, 'sensor-xx')
    expect(pill.children[2]?.hidden).toBe(true)
    expect(pill.children).toHaveLength(3)
  })

  it('落点可以换成周长参数，药丸本体不变', () => {
    const at = { kind: 'perim', t: 0.25, gap: 0, dx: 0, dy: 0 } as const
    const pill = twin2dSensorPill(def, at, 'sensor-xx')
    expect(pill.at).toEqual(at)
  })
})

describe('药丸的读数槽位', () => {
  it('4 条，与药丸同序同 key', () => {
    expect(TWIN_2D_SENSOR_SLOTS.map((slot) => slot.key)).toEqual(
      TWIN_2D_SENSOR_DEFS.map((def) => def.slotKey),
    )
  })

  it('占位符是两个 ASCII 连字符，与节点侧的 em dash 有意不同', () => {
    expect(TWIN_2D_SENSOR_PLACEHOLDER).toBe('--')
    expect(TWIN_2D_SENSOR_PLACEHOLDER).not.toBe(TWIN_2D_DEFAULT_PLACEHOLDER)
    for (const slot of TWIN_2D_SENSOR_SLOTS) {
      expect(slot.placeholder).toBe('--')
    }
  })

  it('TT 那一条逐值', () => {
    expect(twin2dSensorSlot(defOf('TT'))).toEqual({
      key: 'temperature_c',
      label: '温度',
      kind: 'live',
      dataType: 'number',
      unit: '℃',
      precision: null,
      format: 'auto',
      enumMap: {},
      placeholder: '--',
      primary: false,
      expr: null,
    })
  })
})

describe('预置药丸与槽位过一遍归一化恒等', () => {
  it.each(TWIN_2D_SENSOR_PILLS.map((pill) => [pill.id, pill] as const))(
    '%s',
    (_id, pill) => {
      expect(normalizePrim(pill, 0)).toEqual(pill)
    },
  )

  it.each(TWIN_2D_SENSOR_SLOTS.map((slot) => [slot.key, slot] as const))(
    '%s',
    (_key, slot) => {
      expect(normalizeSlot(slot)).toEqual(slot)
    },
  )
})
