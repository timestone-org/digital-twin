/**
 * @fileoverview 锁住三个末端预置样式：id / 尺寸 / 强调色逐值、图元树的结构与那批
 * 逐值抄来的几何与配色、hover 的 1.025（不是方块的 1.04）、四个槽位的顺序与 primary，
 * 以及「三者只差图标」这一条——它是「预置库是数据、不是渲染分支」的机械证明：
 * 一旦有人把某一件的观感挪进渲染件里的 `if (styleId === …)`，三棵树就不再逐字相同，
 * 而那个退化过程本身不会有任何一步报错。
 */
import { describe, expect, it } from 'vitest'

import { TWIN_2D_STATUSES } from '../../src/kinds'
import { normalizeNodeStyle } from '../../src/normalizeStyles'
import { TWIN_2D_PALETTE, mixTransparent } from '../../src/presets/palette'
import { TWIN_2D_TERMINAL_STYLES } from '../../src/presets/nodesTerminal'
import { evalCondition } from '../../src/variants'
import type { Twin2dNodeStyle, Twin2dVariant } from '../../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dFill,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dShadow,
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
  const hit = TWIN_2D_TERMINAL_STYLES.find((style) => style.id === id)
  if (hit === undefined) throw new Error(`没有预置样式 ${id}`)
  return hit
}

function variantOf(style: Twin2dNodeStyle, id: string): Twin2dVariant {
  const hit = style.variants.find((variant) => variant.id === id)
  if (hit === undefined) throw new Error(`${style.id} 没有变体 ${id}`)
  return hit
}

// ⚠ 三个取值器把「补丁里没有这一项」变成抛错而不是可选链：一串 `?.` 会让断言在
// 补丁整块缺席时静默通过，而那正是「hover 配了没反应」的样子
function patchOf(variant: Twin2dVariant, primId: string): Twin2dPrimPatch {
  const patch = variant.patch[primId]
  if (patch === undefined) {
    throw new Error(`变体 ${variant.id} 没有补丁 ${primId}`)
  }
  return patch
}

function borderColorOf(patch: Twin2dPrimPatch): string {
  const border = patch.border
  if (border === undefined) throw new Error('这条补丁没有换描边')
  return border.color
}

function fillsOf(patch: Twin2dPrimPatch): readonly Twin2dFill[] {
  const fills = patch.fills
  if (fills === undefined) throw new Error('这条补丁没有换填充')
  return fills
}

function shadowsOf(patch: Twin2dPrimPatch): readonly Twin2dShadow[] {
  const shadows = patch.shadows
  if (shadows === undefined) throw new Error('这条补丁没有换阴影')
  return shadows
}

function rootShadowsOf(variant: Twin2dVariant): readonly Twin2dShadow[] {
  const shadows = variant.rootPatch.shadows
  if (shadows === undefined) throw new Error('这条变体没有换节点根的阴影')
  return shadows
}

function ctxWith(status: Twin2dVariantCtx['status']): Twin2dVariantCtx {
  return {
    states: new Set(),
    status,
    tags: new Map<string, string>(),
    slots: new Map<string, unknown>(),
  }
}

describe('三个末端预置样式', () => {
  it('id / 名字 / 分类 / 缺省状态 / 尺寸逐值与参考项目的 builtinLibrary 对齐', () => {
    expect(TWIN_2D_TERMINAL_STYLES.map((style) => style.id)).toEqual([
      'bath-terminal',
      'heating-terminal',
      'ac-terminal',
    ])
    expect(TWIN_2D_TERMINAL_STYLES.map((style) => style.name)).toEqual([
      '洗浴终端',
      '采暖终端',
      '空调终端',
    ])
    for (const style of TWIN_2D_TERMINAL_STYLES) {
      expect(style.category).toBe('terminal')
      expect(style.defaultStatus).toBe('online')
      expect(style.size).toEqual({ w: 196, h: 112 })
      expect(style.ports).toEqual([])
    }
  })

  it('强调色三档逐值：冷色 / 热色 / 水色，两两不同', () => {
    expect(styleOf('bath-terminal').accent).toBe(TWIN_2D_PALETTE.tempCold)
    expect(styleOf('heating-terminal').accent).toBe(TWIN_2D_PALETTE.tempHot)
    expect(styleOf('ac-terminal').accent).toBe(TWIN_2D_PALETTE.water)
    const accents = new Set(TWIN_2D_TERMINAL_STYLES.map((s) => s.accent))
    expect(accents.size).toBe(TWIN_2D_TERMINAL_STYLES.length)
  })

  it('图元树的结构：外壳套图标底板与主体，主体里是标题加一行读数', () => {
    const style = styleOf('bath-terminal')
    expect(style.prims.map((prim) => prim.id)).toEqual(['frame', 'status-dot'])
    const frame = boxOf(style, 'frame')
    expect(frame.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
    expect(frame.children.map((prim) => prim.id)).toEqual(['icon', 'body'])
    expect(boxOf(style, 'icon').children.map((prim) => prim.id)).toEqual([
      'glyph',
    ])
    expect(boxOf(style, 'body').children.map((prim) => prim.id)).toEqual([
      'label-natural',
      'readings',
    ])
    expect(boxOf(style, 'readings').children.map((prim) => prim.id)).toEqual([
      'value',
    ])
  })

  it('外壳逐值：1.5px 强调色描边、8 圆角、6/10 内边距、8 间距、两条发光', () => {
    const frame = boxOf(styleOf('bath-terminal'), 'frame')
    expect(frame.border).toEqual({
      width: 1.5,
      style: 'solid',
      color: ACCENT,
      sides: { top: true, right: true, bottom: true, left: true },
    })
    expect(frame.radius).toBe(8)
    expect(frame.layout.flow).toBe('row')
    expect(frame.layout.gap).toBe(8)
    expect(frame.layout.align).toBe('center')
    expect(frame.layout.pad).toEqual([6, 10, 6, 10])
    expect(frame.fills).toHaveLength(1)
    expect(frame.fills[0]).toMatchObject({ kind: 'linear', angle: 150 })
    expect(frame.shadows.map((shadow) => shadow.blur)).toEqual([14, 8])
    expect(frame.shadows.map((shadow) => shadow.inset)).toEqual([true, false])
    expect(frame.shadows.map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 12),
      mixTransparent(ACCENT, 22),
    ])
    expect(frame.transition).toEqual({
      props: ['border-color', 'background', 'box-shadow', 'transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  it('图标底板 34×34、图标 26×26，底色是写死的那一处而不是节点色派生', () => {
    const style = styleOf('bath-terminal')
    const plate = boxOf(style, 'icon')
    expect(plate.size).toEqual({ w: 34, h: 34 })
    expect(plate.layout.flow).toBe('none')
    expect(plate.radius).toBe(4)
    expect(plate.border.width).toBe(1)
    expect(plate.border.color).toBe(mixTransparent(ACCENT, 40))
    expect(plate.fills).toEqual([
      {
        kind: 'solid',
        id: 'plate',
        color: 'rgba(var(--accent-primary-rgb), 0.06)',
        opacity: 1,
      },
    ])
    const glyph = icoOf(style, 'glyph')
    expect(glyph.size).toEqual({ w: 26, h: 26 })
    expect(glyph.color).toBe(ACCENT)
  })

  it('三枚图标逐值，且三棵图元树除图标外逐字相同', () => {
    const sprites = TWIN_2D_TERMINAL_STYLES.map(
      (style) => icoOf(style, 'glyph').src,
    )
    expect(sprites).toEqual([
      { kind: 'sprite', id: 'ico-term-shower' },
      { kind: 'sprite', id: 'ico-term-radiator' },
      { kind: 'sprite', id: 'ico-term-ac' },
    ])
    const shapeOf = (style: Twin2dNodeStyle): string =>
      JSON.stringify(style.prims).replace(/"ico-term-[a-z]+"/g, '"ico"')
    const first = shapeOf(styleOf('bath-terminal'))
    expect(shapeOf(styleOf('heating-terminal'))).toBe(first)
    expect(shapeOf(styleOf('ac-terminal'))).toBe(first)
  })

  it('标题走显示名、主读数走 primary 槽，两处字体逐值', () => {
    const style = styleOf('bath-terminal')
    const title = txtOf(style, 'label-natural')
    expect(title.src).toEqual({ kind: 'label' })
    expect(title.font).toEqual({
      size: 18,
      weight: 600,
      color: 'var(--text-primary)',
    })
    expect(title.nowrap).toBe(true)
    expect(title.ellipsis).toBe(true)
    expect(title.titleAttr).toBe(true)
    const value = txtOf(style, 'value')
    expect(value.src).toEqual({ kind: 'slot', slot: 'today_kwh' })
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 32,
      letterSpacing: 0.5,
      color: ACCENT,
    })
    expect(value.shadows).toEqual([
      {
        id: 'value-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 3,
        spread: 0,
        color: mixTransparent(ACCENT, 70),
      },
    ])
  })

  it('hover 抬 3px 并放大到 1.025——不是方块的 1.04、也不是罐形的 1.02', () => {
    for (const style of TWIN_2D_TERMINAL_STYLES) {
      const hover = variantOf(style, 'hover')
      expect(hover.when).toEqual({ kind: 'state', state: 'hover' })
      expect(hover.rootPatch).toEqual({ lift: 3, scale: 1.025, z: 30 })
      expect(hover.rootPatch.scale).not.toBe(1.04)
      expect(hover.rootPatch.scale).not.toBe(1.02)
    }
  })

  it('hover 给外壳追加一层径向高光、换三重阴影', () => {
    const frame = patchOf(variantOf(styleOf('bath-terminal'), 'hover'), 'frame')
    expect(borderColorOf(frame)).toBe(
      `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`,
    )
    expect(fillsOf(frame).map((fill) => fill.kind)).toEqual([
      'linear',
      'radial',
    ])
    expect(shadowsOf(frame).map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 18),
      'rgba(0, 0, 0, 0.24)',
      mixTransparent(ACCENT, 42),
    ])
    expect(shadowsOf(frame).map((shadow) => shadow.y)).toEqual([0, 8, 0])
  })

  it('hover 把图标底板放大到 1.08 并换掉它的描边、底色与发光', () => {
    const icon = patchOf(variantOf(styleOf('bath-terminal'), 'hover'), 'icon')
    expect(icon.scale).toBe(1.08)
    expect(borderColorOf(icon)).toBe(mixTransparent(ACCENT, 62))
    expect(fillsOf(icon)).toEqual([
      {
        kind: 'solid',
        id: 'plate',
        color: mixTransparent(ACCENT, 16),
        opacity: 1,
      },
    ])
    expect(shadowsOf(icon).map((shadow) => shadow.blur)).toEqual([12])
  })

  it('选中出一圈 2px 实色加一层外发光', () => {
    const selected = variantOf(styleOf('heating-terminal'), 'selected')
    expect(selected.when).toEqual({ kind: 'state', state: 'selected' })
    expect(rootShadowsOf(selected).map((shadow) => shadow.spread)).toEqual([
      2, 0,
    ])
    expect(rootShadowsOf(selected).map((shadow) => shadow.color)).toEqual([
      ACCENT,
      mixTransparent(ACCENT, 45),
    ])
    expect(selected.patch).toEqual({})
  })

  it('报警转危险色、外壳呼吸、状态点脉冲', () => {
    const alarm = variantOf(styleOf('heating-terminal'), 'alarm')
    expect(alarm.when).toEqual({ kind: 'status', in: ['alarm'] })
    expect(borderColorOf(patchOf(alarm, 'frame'))).toBe('var(--state-danger)')
    expect(patchOf(alarm, 'frame').anim).toEqual({
      kind: 'breathe',
      durationMs: 1000,
    })
    expect(patchOf(alarm, 'status-dot').anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
  })

  it('状态点四档都画、`hidden` 档整枝不画', () => {
    const dot = boxOf(styleOf('ac-terminal'), 'status-dot')
    expect(dot.z).toBe(5)
    expect(dot.size).toEqual({ w: 7, h: 7 })
    expect(dot.radius).toBe('pill')
    expect(dot.fills).toEqual([
      { kind: 'solid', id: 'dot', color: 'var(--t2-status)', opacity: 1 },
    ])
    const when = dot.when
    if (when === null)
      throw new Error('状态点必须带 when，否则 hidden 档也会画')
    for (const status of TWIN_2D_STATUSES) {
      expect(evalCondition(when, ctxWith(status))).toBe(true)
    }
    expect(evalCondition(when, ctxWith(null))).toBe(false)
  })

  it('四个槽位的键与顺序即 nodeValues 的行序，primary 只有一个，status 不带 enumMap', () => {
    for (const style of TWIN_2D_TERMINAL_STYLES) {
      expect(style.slots.map((slot) => slot.key)).toEqual([
        'today_kwh',
        'demand_kw',
        'satisfaction_pct',
        'status',
      ])
      expect(style.slots.map((slot) => slot.unit)).toEqual([
        'kWh',
        'kW',
        '%',
        '',
      ])
      expect(
        style.slots.filter((slot) => slot.primary).map((s) => s.key),
      ).toEqual(['today_kwh'])
      expect(style.slots.map((slot) => slot.kind)).toEqual([
        'live',
        'live',
        'live',
        'live',
      ])
      const status = style.slots[3]
      expect(status?.dataType).toBe('enum')
      expect(status?.enumMap).toEqual({})
    }
  })

  it('每处 slot 引用都落在自己声明的槽位里（零悬空槽）', () => {
    for (const style of TWIN_2D_TERMINAL_STYLES) {
      const keys = new Set(style.slots.map((slot) => slot.key))
      const src = txtOf(style, 'value').src
      if (src.kind !== 'slot') throw new Error('主读数必须取自槽位')
      expect(keys.has(src.slot)).toBe(true)
    }
  })

  it('预置数据本身已经是归一化的结果：过一遍归一化逐字不变', () => {
    for (const style of TWIN_2D_TERMINAL_STYLES) {
      expect(normalizeNodeStyle(structuredClone(style))).toEqual(style)
    }
  })
})
