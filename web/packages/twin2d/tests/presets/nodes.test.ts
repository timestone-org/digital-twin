/**
 * @fileoverview 锁住预置节点样式的汇总面：19 条的身份与文档序、id → 样式那张查表与
 * 清单是同一批对象，以及「源与末端两族进的是**带子类变体**的那一份」。
 *
 * ⚠ 汇总面接错了族在渲染层是彻底静默的：节点照样画得出来，只是 25 种子类组合一条
 * 都不生效；id 漏一个也只是调色板里少一件。两样都没有一处会报错，只有这里扫得出来。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_CIRCUIT_STYLES } from '../../src/presets/circuit'
import {
  TWIN_2D_BUILTIN_NODE_STYLES,
  TWIN_2D_BUILTIN_NODE_STYLE_MAP,
} from '../../src/presets/nodes'
import { TWIN_2D_MISC_STYLES } from '../../src/presets/nodesMisc'
import { TWIN_2D_SOURCE_STYLES } from '../../src/presets/nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import { TWIN_2D_VESSEL_STYLES } from '../../src/presets/nodesVessel'
import {
  TWIN_2D_SOURCE_SUBTYPE_DEFS,
  TWIN_2D_SUBTYPED_SOURCE_STYLES,
  TWIN_2D_SUBTYPED_TERMINAL_STYLES,
  TWIN_2D_SUBTYPE_TAG_KEY,
  TWIN_2D_TERMINAL_SUBTYPE_DEFS,
} from '../../src/presets/subtypes'
import type { Twin2dNodeStyle } from '../../src/types'

/** 参考项目 `BUILTIN_NODE_TYPES` 的 11 条，逐位同序。 */
const REFERENCE_TYPE_IDS = [
  'waste-heat-source',
  'steam-source',
  'air-source',
  'solar-source',
  'water-tank',
  'manifold',
  'bath-terminal',
  'heating-terminal',
  'ac-terminal',
  'heat-exchanger',
  'label',
] as const

/** 8 枚电路符号，接在 11 种节点类型之后。 */
const CIRCUIT_IDS = [
  'circuit-resistor',
  'circuit-capacitor',
  'circuit-inductor',
  'circuit-diode',
  'circuit-switch',
  'circuit-ground',
  'circuit-source',
  'circuit-junction',
] as const

function idsOf(styles: readonly Twin2dNodeStyle[]): string[] {
  return styles.map((style) => style.id)
}

describe('预置节点样式的清单', () => {
  it('19 条：11 种节点类型接 8 枚电路符号', () => {
    expect(idsOf(TWIN_2D_BUILTIN_NODE_STYLES)).toEqual([
      ...REFERENCE_TYPE_IDS,
      ...CIRCUIT_IDS,
    ])
  })

  it('前 11 条的文档序与参考项目的内置类型表逐位一致', () => {
    expect(idsOf(TWIN_2D_BUILTIN_NODE_STYLES).slice(0, 11)).toEqual([
      ...REFERENCE_TYPE_IDS,
    ])
  })

  it('id 两两不同——重名会让后一条在查表里静默盖掉前一条', () => {
    const ids = idsOf(TWIN_2D_BUILTIN_NODE_STYLES)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('五个族一件不落，且各族内部保持本族的文档序', () => {
    const ids = idsOf(TWIN_2D_BUILTIN_NODE_STYLES)
    const families = [
      idsOf(TWIN_2D_SOURCE_STYLES),
      idsOf(TWIN_2D_VESSEL_STYLES),
      idsOf(TWIN_2D_TERMINAL_STYLES),
      idsOf(TWIN_2D_MISC_STYLES),
      idsOf(TWIN_2D_CIRCUIT_STYLES),
    ]

    expect(families.flat()).toEqual(ids)
  })

  it('每一条都过得了「样式必备的九项」这道形状检查', () => {
    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      expect(Object.keys(style).sort()).toEqual([
        'accent',
        'category',
        'defaultStatus',
        'id',
        'name',
        'ports',
        'prims',
        'size',
        'slots',
        'variants',
      ])
    }
  })
})

describe('id → 样式的查表', () => {
  it('条数与清单一样，一条不多一条不少', () => {
    expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.size).toBe(
      TWIN_2D_BUILTIN_NODE_STYLES.length,
    )
  })

  it('每个 id 取到的就是清单里的那一份，不是复制品', () => {
    for (const style of TWIN_2D_BUILTIN_NODE_STYLES) {
      expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(style.id)).toBe(style)
    }
  })

  it('查表的键集合就是那 19 个 id', () => {
    expect([...TWIN_2D_BUILTIN_NODE_STYLE_MAP.keys()]).toEqual(
      idsOf(TWIN_2D_BUILTIN_NODE_STYLES),
    )
  })

  it('没登记的 id 取到 undefined，不给兜底样式', () => {
    expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get('no-such-style')).toBeUndefined()
  })
})

describe('进汇总的是带子类变体的那一份', () => {
  it('四个源类样式逐个取自 TWIN_2D_SUBTYPED_SOURCE_STYLES', () => {
    for (const [index, style] of TWIN_2D_SUBTYPED_SOURCE_STYLES.entries()) {
      expect(TWIN_2D_BUILTIN_NODE_STYLES[index]).toBe(style)
    }
  })

  it('三个末端样式逐个取自 TWIN_2D_SUBTYPED_TERMINAL_STYLES', () => {
    for (const [index, style] of TWIN_2D_SUBTYPED_TERMINAL_STYLES.entries()) {
      expect(TWIN_2D_BUILTIN_NODE_STYLES[6 + index]).toBe(style)
    }
  })

  it('四个源类各带 4 条子类变体，且排在交互态变体之前', () => {
    for (const id of REFERENCE_TYPE_IDS.slice(0, 4)) {
      const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(id)

      expect(style?.variants.slice(0, 4).map((one) => one.id)).toEqual(
        TWIN_2D_SOURCE_SUBTYPE_DEFS.map((def) => `subtype-${def.id}`),
      )
      expect(style?.variants.slice(4).map((one) => one.id)).toEqual([
        'hover',
        'selected',
        'alarm',
      ])
    }
  })

  it('三个末端各带 3 条子类变体，且排在交互态变体之前', () => {
    for (const id of REFERENCE_TYPE_IDS.slice(6, 9)) {
      const style = TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(id)

      expect(style?.variants.slice(0, 3).map((one) => one.id)).toEqual(
        TWIN_2D_TERMINAL_SUBTYPE_DEFS.map((def) => `subtype-${def.id}`),
      )
      expect(style?.variants.slice(3).map((one) => one.id)).toEqual([
        'hover',
        'selected',
        'alarm',
      ])
    }
  })

  it('25 条子类变体全部认 tags.subtype 这一个键', () => {
    const conditions = TWIN_2D_BUILTIN_NODE_STYLES.flatMap((style) =>
      style.variants
        .filter((one) => one.id.startsWith('subtype-'))
        .map((one) => one.when),
    )

    expect(conditions.length).toBe(25)
    for (const when of conditions) {
      expect(when.kind).toBe('tag')
      expect(when.kind === 'tag' ? when.key : '').toBe(TWIN_2D_SUBTYPE_TAG_KEY)
    }
  })

  it('容器、换热与标注、电路四族原样进来，一条子类变体都不带', () => {
    const untouched = [
      ...TWIN_2D_VESSEL_STYLES,
      ...TWIN_2D_MISC_STYLES,
      ...TWIN_2D_CIRCUIT_STYLES,
    ]

    for (const style of untouched) {
      expect(TWIN_2D_BUILTIN_NODE_STYLE_MAP.get(style.id)).toBe(style)
      expect(
        style.variants.filter((one) => one.id.startsWith('subtype-')),
      ).toEqual([])
    }
  })
})
