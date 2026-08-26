/**
 * @fileoverview 锁住换热器（square）与文字标注（text）两个预置样式：方块的居中图标与
 * 下方外侧标签的摆位、hover 的 **1.04**（与末端那一档 1.025 逐值不同，抄串了没有一处报错）、
 * 文字标注的无边框无底色，以及它「不画状态点」那一档只由 `defaultStatus: 'hidden'` 表达
 * ——参考项目里那是 `category === 'label'` 的一条渲染分支，分类在新模型里不参与任何渲染判断。
 */
import { describe, expect, it } from 'vitest'

import { statusColor } from '../../src/paintCommon'
import { normalizeNodeStyle } from '../../src/normalizeStyles'
import { TWIN_2D_MISC_STYLES } from '../../src/presets/nodesMisc'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import { TWIN_2D_PALETTE, mixTransparent } from '../../src/presets/palette'
import { evalCondition } from '../../src/variants'
import type { Twin2dNodeStyle, Twin2dVariant } from '../../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dTxtPrim,
} from '../../src/typesPrim'
import type { Twin2dVariantCtx } from '../../src/variants'

const ACCENT = 'var(--t2-accent)'

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

function primOf(style: Twin2dNodeStyle, id: string): Twin2dPrim {
  const hit = walk(style.prims, id)
  if (hit === null) throw new Error(`预置样式 ${style.id} 里没有图元 ${id}`)
  return hit
}

function boxOf(style: Twin2dNodeStyle, id: string): Twin2dBoxPrim {
  const prim = primOf(style, id)
  if (prim.kind !== 'box') throw new Error(`${id} 不是 box`)
  return prim
}

function txtOf(style: Twin2dNodeStyle, id: string): Twin2dTxtPrim {
  const prim = primOf(style, id)
  if (prim.kind !== 'txt') throw new Error(`${id} 不是 txt`)
  return prim
}

function icoOf(style: Twin2dNodeStyle, id: string): Twin2dIcoPrim {
  const prim = primOf(style, id)
  if (prim.kind !== 'ico') throw new Error(`${id} 不是 ico`)
  return prim
}

function styleOf(id: string): Twin2dNodeStyle {
  const hit = TWIN_2D_MISC_STYLES.find((style) => style.id === id)
  if (hit === undefined) throw new Error(`没有预置样式 ${id}`)
  return hit
}

function variantOf(style: Twin2dNodeStyle, id: string): Twin2dVariant {
  const hit = style.variants.find((variant) => variant.id === id)
  if (hit === undefined) throw new Error(`${style.id} 没有变体 ${id}`)
  return hit
}

function ctxWith(status: Twin2dVariantCtx['status']): Twin2dVariantCtx {
  return {
    states: new Set(),
    status,
    tags: new Map<string, string>(),
    slots: new Map<string, unknown>(),
  }
}

describe('板式换热器（square）', () => {
  it('id / 名字 / 分类 / 尺寸 / 强调色逐值', () => {
    const style = styleOf('heat-exchanger')
    expect(style.name).toBe('板式换热器')
    expect(style.category).toBe('exchanger')
    expect(style.defaultStatus).toBe('online')
    expect(style.size).toEqual({ w: 154, h: 154 })
    expect(style.accent).toBe(TWIN_2D_PALETTE.water)
    expect(style.ports).toEqual([])
  })

  it('结构：外壳只做居中，里面一块铺满的方砖套一枚半宽半高的图标', () => {
    const style = styleOf('heat-exchanger')
    expect(style.prims.map((prim) => prim.id)).toEqual([
      'frame',
      'label-natural',
      'status-dot',
    ])
    const frame = boxOf(style, 'frame')
    expect(frame.layout.flow).toBe('none')
    expect(frame.fills).toEqual([])
    expect(frame.children.map((prim) => prim.id)).toEqual(['tile'])
    const tile = boxOf(style, 'tile')
    expect(tile.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
    expect(tile.layout.flow).toBe('none')
    expect(tile.children.map((prim) => prim.id)).toEqual(['glyph'])
    const glyph = icoOf(style, 'glyph')
    expect(glyph.size).toEqual({ w: '50%', h: '50%' })
    expect(glyph.src).toEqual({ kind: 'sprite', id: 'ico-hx' })
    expect(glyph.color).toBe(ACCENT)
  })

  it('方砖逐值：1.5px 描边、8 圆角、150° 渐变，内发光 14% 与外发光 24%', () => {
    const tile = boxOf(styleOf('heat-exchanger'), 'tile')
    expect(tile.border.width).toBe(1.5)
    expect(tile.border.color).toBe(ACCENT)
    expect(tile.radius).toBe(8)
    expect(tile.fills[0]).toMatchObject({ kind: 'linear', angle: 150 })
    expect(tile.shadows.map((shadow) => shadow.blur)).toEqual([14, 8])
    expect(tile.shadows.map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 14),
      mixTransparent(ACCENT, 24),
    ])
    expect(tile.transition).toEqual({
      props: ['border-color', 'box-shadow', 'transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  it('标签在节点盒下方外侧，字号比显示名小 1px', () => {
    const label = txtOf(styleOf('heat-exchanger'), 'label-natural')
    expect(label.at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: null,
      bottom: -2,
      tx: '-50%',
      ty: '100%',
    })
    expect(label.src).toEqual({ kind: 'label' })
    expect(label.font).toEqual({
      size: 17,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect(label.nowrap).toBe(true)
    expect(label.titleAttr).toBe(true)
    expect(label.shadows.map((shadow) => shadow.blur)).toEqual([4])
    expect(label.shadows[0]?.color).toBe(mixTransparent(ACCENT, 50))
  })

  it('hover 放大到 1.04，与末端那一档 1.025 逐值不同', () => {
    const hover = variantOf(styleOf('heat-exchanger'), 'hover')
    expect(hover.rootPatch).toEqual({ lift: 3, scale: 1.04, z: 30 })
    const terminalHover = TWIN_2D_TERMINAL_STYLES[0]?.variants.find(
      (variant) => variant.id === 'hover',
    )
    expect(terminalHover?.rootPatch.scale).toBe(1.025)
    expect(hover.rootPatch.scale).not.toBe(terminalHover?.rootPatch.scale)
  })

  it('hover 只换方砖的描边与三重阴影：这一形不追加径向高光，落影是 .22 不是 .24', () => {
    const hover = variantOf(styleOf('heat-exchanger'), 'hover')
    expect(Object.keys(hover.patch)).toEqual(['tile'])
    const tile = hover.patch['tile']
    expect(tile?.fills).toBeUndefined()
    expect(tile?.border?.color).toBe(
      `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`,
    )
    expect(tile?.shadows?.map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 18),
      'rgba(0, 0, 0, 0.22)',
      mixTransparent(ACCENT, 42),
    ])
  })

  it('选中出一圈 2px；报警让方砖转危险色、状态点脉冲', () => {
    const style = styleOf('heat-exchanger')
    const selected = variantOf(style, 'selected')
    expect(selected.rootPatch.shadows?.map((shadow) => shadow.spread)).toEqual([
      2, 0,
    ])
    const alarm = variantOf(style, 'alarm')
    expect(alarm.patch['tile']?.border?.color).toBe('var(--state-danger)')
    expect(alarm.patch['tile']?.anim).toEqual({
      kind: 'breathe',
      durationMs: 1000,
    })
    expect(alarm.patch['status-dot']?.anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
  })

  it('四个换热字段落成槽位，顺序即行序，primary 是换热温度', () => {
    const style = styleOf('heat-exchanger')
    expect(style.slots.map((slot) => slot.key)).toEqual([
      'temperature_c',
      'flow_m3h',
      'pressure_kpa',
      'status',
    ])
    expect(style.slots.map((slot) => slot.unit)).toEqual([
      '℃',
      'm³/h',
      'kPa',
      '',
    ])
    expect(
      style.slots.filter((slot) => slot.primary).map((slot) => slot.key),
    ).toEqual(['temperature_c'])
    expect(style.slots[3]?.dataType).toBe('enum')
    expect(style.slots[3]?.enumMap).toEqual({})
  })
})

describe('文字标注（text）', () => {
  it('id / 名字 / 分类 / 尺寸逐值；强调色是唯一一件跟随换肤的', () => {
    const style = styleOf('label')
    expect(style.name).toBe('文字标注')
    expect(style.category).toBe('label')
    expect(style.size).toEqual({ w: 224, h: 50 })
    expect(style.accent).toBe('var(--accent-primary)')
    expect(style.slots).toEqual([])
    expect(style.ports).toEqual([])
  })

  it('一条 3px×1em 的竖色条加一段文字，外壳无边框无底色', () => {
    const style = styleOf('label')
    const frame = boxOf(style, 'frame')
    expect(frame.fills).toEqual([])
    expect(frame.border.width).toBe(0)
    expect(frame.border.style).toBe('none')
    expect(frame.shadows).toEqual([])
    expect(frame.layout.gap).toBe(6)
    expect(frame.layout.align).toBe('center')
    expect(frame.children.map((prim) => prim.id)).toEqual([
      'bar',
      'label-natural',
    ])
    const bar = boxOf(style, 'bar')
    expect(bar.size).toEqual({ w: 3, h: '1em' })
    expect(bar.radius).toBe(0)
    expect(bar.fills).toEqual([
      { kind: 'solid', id: 'bar-fill', color: ACCENT, opacity: 1 },
    ])
    expect(bar.shadows.map((shadow) => shadow.blur)).toEqual([6])
    expect(bar.shadows[0]?.color).toBe(ACCENT)
  })

  it('文字 18/600，nowrap 且不挂 title；发光是 5px 45%', () => {
    const text = txtOf(styleOf('label'), 'label-natural')
    expect(text.src).toEqual({ kind: 'label' })
    expect(text.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect(text.nowrap).toBe(true)
    expect(text.titleAttr).toBe(false)
    expect(text.shadows.map((shadow) => shadow.blur)).toEqual([5])
    expect(text.shadows[0]?.color).toBe(mixTransparent(ACCENT, 45))
  })

  it('这一件不画状态点：缺省状态是 hidden，那一档取不到颜色、状态点整枝不渲染', () => {
    const style = styleOf('label')
    expect(style.defaultStatus).toBe('hidden')
    expect(statusColor(style.defaultStatus)).toBeNull()
    const when = boxOf(style, 'status-dot').when
    if (when === null) throw new Error('状态点必须带 when')
    expect(evalCondition(when, ctxWith(null))).toBe(false)
    // 节点上显式给了状态时照旧画——「不画」是缺省，不是这一件的硬性限制
    expect(evalCondition(when, ctxWith('warning'))).toBe(true)
  })

  it('没有 hover 与选中变体：参考项目那三条规则一条都不落在这一形上', () => {
    const style = styleOf('label')
    expect(style.variants.map((variant) => variant.id)).toEqual(['alarm'])
    expect(style.variants[0]?.patch['status-dot']?.anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
    expect(style.variants[0]?.rootPatch).toEqual({})
  })
})

describe('两个样式都是已归一化的数据', () => {
  it('过一遍归一化逐字不变', () => {
    expect(TWIN_2D_MISC_STYLES.map((style) => style.id)).toEqual([
      'heat-exchanger',
      'label',
    ])
    for (const style of TWIN_2D_MISC_STYLES) {
      expect(normalizeNodeStyle(structuredClone(style))).toEqual(style)
    }
  })
})
