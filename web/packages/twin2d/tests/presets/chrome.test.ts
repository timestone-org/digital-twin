/**
 * @fileoverview 锁住每份节点预置样式都挂的两枚外挂件：左上角标（盒 + 字 + `line-height: 1`）
 * 与外置显示名（四档 abs、上限按档不同、不吃指针），外加「哪一枚显示」那一层——
 * 它必须由 `when` 条件驱动而不是渲染层的分支，否则显示名位置这六档就只剩两档能用。
 */
import { describe, expect, it } from 'vitest'

import { normalizeNodeStyle } from '../../src/normalizeStyles'
import { normalizePrim, normalizePrimPatch } from '../../src/normalizePrims'
import {
  TWIN_2D_BADGE_PRIM_ID,
  TWIN_2D_LABEL_OUTER_PRIM_ID,
  TWIN_2D_LABEL_VARIANTS,
  badgePrim,
  labelOuterPrim,
  twin2dChromePrims,
  twin2dWithChrome,
} from '../../src/presets/chrome'
import { TWIN_2D_MISC_STYLES } from '../../src/presets/nodesMisc'
import { TWIN_2D_SOURCE_STYLES } from '../../src/presets/nodesSource'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import { TWIN_2D_VESSEL_STYLES } from '../../src/presets/nodesVessel'
import { evalCondition } from '../../src/variants'
import type { Twin2dLabelPos, Twin2dNodeField } from '../../src/kinds'
import type { Twin2dNodeStyle } from '../../src/types'
import type { Twin2dPrim } from '../../src/typesPrim'
import type { Twin2dVariantCtx } from '../../src/variants'

/** 十一份节点预置样式：源 4 / 容器 2 / 末端 3 / 换热与标注 2 */
const ALL_STYLES: readonly Twin2dNodeStyle[] = [
  ...TWIN_2D_SOURCE_STYLES,
  ...TWIN_2D_VESSEL_STYLES,
  ...TWIN_2D_TERMINAL_STYLES,
  ...TWIN_2D_MISC_STYLES,
]

/** 显示名六档 */
const POSITIONS: readonly Twin2dLabelPos[] = [
  'bottom',
  'top',
  'left',
  'right',
  'inside',
  'hidden',
]

function walk(prims: readonly Twin2dPrim[], id: string): Twin2dPrim | null {
  for (const prim of prims) {
    if (prim.id === id) return prim
    if (prim.kind === 'box') {
      const hit = walk(prim.children, id)
      if (hit !== null) return hit
    }
  }
  return null
}

/** 只给一个字段的求值上下文，其余全空。 */
function fieldCtx(key: Twin2dNodeField, value: string): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: null,
    tags: new Map(),
    slots: new Map(),
    fields: new Map([[key, value]]),
  }
}

/** 某一档 `labelPos` 下这份样式实际画出来的显示名图元 id。 */
function shownLabels(style: Twin2dNodeStyle, pos: string): string[] {
  const ctx = fieldCtx('labelPos', pos)
  return [TWIN_2D_LABEL_OUTER_PRIM_ID, 'label-natural'].filter((id) => {
    const prim = walk(style.prims, id)
    return prim !== null && prim.when !== null && evalCondition(prim.when, ctx)
  })
}

describe('两枚外挂件挂在每一份预置样式上', () => {
  it('十一份样式各带一枚角标与一枚外置显示名，且排在自己那批图元之后', () => {
    expect(ALL_STYLES).toHaveLength(11)
    for (const style of ALL_STYLES) {
      const ids = style.prims.map((prim) => prim.id)

      expect([style.id, ids.slice(-2)]).toEqual([
        style.id,
        [TWIN_2D_BADGE_PRIM_ID, TWIN_2D_LABEL_OUTER_PRIM_ID],
      ])
    }
  })

  it('十一份样式各带三条名位变体，且排在自己那批变体之后', () => {
    for (const style of ALL_STYLES) {
      const ids = style.variants.map((variant) => variant.id)

      expect([style.id, ids.slice(-3)]).toEqual([
        style.id,
        ['label-left', 'label-right', 'label-inside'],
      ])
    }
  })

  // ⚠ 三条变体补的都是同一枚图元：补到别的 id 上是静默失效，图元照画、位置不动
  it('三条名位变体只补外置显示名那一枚', () => {
    for (const variant of TWIN_2D_LABEL_VARIANTS) {
      expect([variant.id, Object.keys(variant.patch)]).toEqual([
        variant.id,
        [TWIN_2D_LABEL_OUTER_PRIM_ID],
      ])
      expect([variant.id, variant.rootPatch]).toEqual([variant.id, {}])
    }
  })

  it('外挂件是逐份新建的对象，不是十一份共享的同一个引用', () => {
    const [first, second] = [twin2dChromePrims(), twin2dChromePrims()]

    expect(first[0]).not.toBe(second[0])
    expect(first[0]).toEqual(second[0])
  })
})

describe('哪一枚显示由 when 条件决定', () => {
  it('bottom 走自然名位、另四档走外置那一枚、hidden 两枚都不画', () => {
    for (const style of ALL_STYLES) {
      for (const pos of POSITIONS) {
        const expected =
          pos === 'hidden'
            ? []
            : [pos === 'bottom' ? 'label-natural' : TWIN_2D_LABEL_OUTER_PRIM_ID]

        expect([style.id, pos, shownLabels(style, pos)]).toEqual([
          style.id,
          pos,
          expected,
        ])
      }
    }
  })

  it('角标按 node.badge 有没有值决定画不画，空串不画', () => {
    const badge = badgePrim()
    if (badge.when === null) throw new Error('角标没有显示条件')

    expect(evalCondition(badge.when, fieldCtx('badge', 'A1'))).toBe(true)
    expect(evalCondition(badge.when, fieldCtx('badge', ''))).toBe(false)
  })
})

describe('外挂件本身就是归一化后的数据', () => {
  it('两枚图元过一遍归一化逐字不变', () => {
    for (const prim of twin2dChromePrims()) {
      expect(normalizePrim(structuredClone(prim), 0)).toEqual(prim)
    }
  })

  it('三条名位补丁过一遍归一化逐字不变', () => {
    for (const variant of TWIN_2D_LABEL_VARIANTS) {
      const patch = variant.patch[TWIN_2D_LABEL_OUTER_PRIM_ID]

      expect([variant.id, normalizePrimPatch(structuredClone(patch))]).toEqual([
        variant.id,
        patch,
      ])
    }
  })

  it('十一份样式整份过一遍归一化逐字不变', () => {
    for (const style of ALL_STYLES) {
      expect(normalizeNodeStyle(structuredClone(style))).toEqual(style)
    }
  })
})

describe('twin2dWithChrome 只做追加', () => {
  it('样式自己的图元与变体一个不动，两枚外挂件与三条变体接在后面', () => {
    const bare: Twin2dNodeStyle = {
      id: 'x',
      name: 'X',
      category: 'misc',
      accent: '',
      defaultStatus: 'online',
      size: { w: 100, h: 60 },
      prims: [labelOuterPrim()],
      ports: [],
      slots: [],
      variants: [],
    }
    const dressed = twin2dWithChrome(bare)

    expect(dressed.prims.map((prim) => prim.id)).toEqual([
      TWIN_2D_LABEL_OUTER_PRIM_ID,
      TWIN_2D_BADGE_PRIM_ID,
      TWIN_2D_LABEL_OUTER_PRIM_ID,
    ])
    expect(dressed.variants).toHaveLength(3)
    expect(dressed.size).toEqual(bare.size)
  })
})
