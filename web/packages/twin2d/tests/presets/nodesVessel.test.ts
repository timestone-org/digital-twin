/**
 * @fileoverview 锁住两个储能容器预置样式：水箱（tank）与分集水器（manifold/cylinder）的
 * id、尺寸、图元树、那批逐值抄来的几何与配色，以及三条变体。
 * 圆柱那五处是「抄成同色 / 抄成对称就白做了、而每一项数值单看都对」的那一类，各钉一条：
 * 端盖与体身异色、体身矩形无 rx、端盖横半径固定 10、双集管线的 -3 / +6 不对称、
 * 标题阴影取背景色而不是强调色。少了它们，退化过程不会有任何一步报错。
 */
import { describe, expect, it } from 'vitest'

import { evalExpr, exprSlotRefs } from '../../src/expr'
import { TWIN_2D_STATUSES } from '../../src/kinds'
import { normalizeNodeStyle } from '../../src/normalizeStyles'
import { svgShapeAttrs } from '../../src/paintVec'
import { TWIN_2D_PALETTE_RGB, mixTransparent } from '../../src/presets/palette'
import { TWIN_2D_VESSEL_STYLES } from '../../src/presets/nodesVessel'
import { evalCondition } from '../../src/variants'
import type {
  Twin2dNodeStyle,
  Twin2dSlot,
  Twin2dVariant,
} from '../../src/types'
import type {
  Twin2dBoxPrim,
  Twin2dExpr,
  Twin2dIcoPrim,
  Twin2dPrim,
  Twin2dPrimPatch,
  Twin2dShadow,
  Twin2dShape,
  Twin2dStrokePass,
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../../src/typesPrim'
import type { Twin2dVariantCtx } from '../../src/variants'

const ACCENT = 'var(--t2-accent)'
const FILL_B = 'var(--t2-fill-b)'
const DANGER = 'var(--state-danger)'

/** 圆柱的设计尺寸，几何断言全按它算 */
const CYL_W = 224
const CYL_H = 126
const CYL_CY = CYL_H / 2

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

function vecOf(style: Twin2dNodeStyle, id: string): Twin2dVecPrim {
  const prim = primOf(style, id)
  if (prim.kind !== 'vec') throw new Error(`${id} 不是 vec`)
  return prim
}

/** 一个样式的槽位口径表：`evalExpr` 拿它给 `join` 的每一段过单位与精度。 */
function formatsOf(style: Twin2dNodeStyle): Map<string, Twin2dSlot> {
  return new Map(style.slots.map((slot) => [slot.key, slot]))
}

/** 一个样式的读数行算式。 */
function readingOf(style: Twin2dNodeStyle): Twin2dExpr {
  const expr = style.slots.find((slot) => slot.key === 'reading')?.expr
  if (expr === null || expr === undefined) throw new Error('读数必须是派生槽')
  return expr
}

function styleOf(id: string): Twin2dNodeStyle {
  const hit = TWIN_2D_VESSEL_STYLES.find((style) => style.id === id)
  if (hit === undefined) throw new Error(`没有预置样式 ${id}`)
  return hit
}

function variantOf(style: Twin2dNodeStyle, id: string): Twin2dVariant {
  const hit = style.variants.find((variant) => variant.id === id)
  if (hit === undefined) throw new Error(`${style.id} 没有变体 ${id}`)
  return hit
}

// ⚠ 取值器把「补丁里没有这一项」变成抛错而不是可选链：一串 `?.` 会让断言在补丁整块
// 缺席时静默通过，而那正是「hover 配了没反应」的样子
function patchOf(variant: Twin2dVariant, primId: string): Twin2dPrimPatch {
  const patch = variant.patch[primId]
  if (patch === undefined) {
    throw new Error(`变体 ${variant.id} 没有补丁 ${primId}`)
  }
  return patch
}

function strokesOf(patch: Twin2dPrimPatch): readonly Twin2dStrokePass[] {
  const strokes = patch.strokes
  if (strokes === undefined) throw new Error('这条补丁没有换描边')
  return strokes
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

function onlyStroke(prim: Twin2dVecPrim): Twin2dStrokePass {
  expect(prim.strokes).toHaveLength(1)
  const stroke = prim.strokes[0]
  if (stroke === undefined) throw new Error(`${prim.id} 没有描边`)
  return stroke
}

function rectOf(prim: Twin2dVecPrim): Extract<Twin2dShape, { kind: 'rect' }> {
  const shape = prim.shape
  if (shape.kind !== 'rect') throw new Error(`${prim.id} 不是矩形`)
  return shape
}

function ellipseOf(
  prim: Twin2dVecPrim,
): Extract<Twin2dShape, { kind: 'ellipse' }> {
  const shape = prim.shape
  if (shape.kind !== 'ellipse') throw new Error(`${prim.id} 不是椭圆`)
  return shape
}

/**
 * 一枚 vec 落到某个实例盒上真正画出来的 SVG 几何属性。
 * ⚠ 断言几何一律走这里而不是直读 `shape`：坐标档决定同一组数字画在哪，读 `shape`
 * 的用例在「几何恒定不随盒走」这个缺陷面前是全绿的（§7.5）。
 */
function geometryOf(
  style: Twin2dNodeStyle,
  id: string,
  boxW: number,
  boxH: number,
): Record<string, string> {
  const prim = vecOf(style, id)
  return svgShapeAttrs(prim.shape, prim.coord, boxW, boxH)
}

function ctxWith(status: Twin2dVariantCtx['status']): Twin2dVariantCtx {
  return {
    states: new Set(),
    status,
    tags: new Map<string, string>(),
    slots: new Map<string, unknown>(),
    fields: new Map(),
  }
}

function primIds(prims: readonly Twin2dPrim[]): string[] {
  const ids: string[] = []
  for (const prim of prims) {
    ids.push(prim.id)
    if (prim.kind === 'box') ids.push(...primIds(prim.children))
  }
  return ids
}

describe('两个储能容器预置样式', () => {
  it('id / 名字 / 分类 / 缺省状态 / 尺寸逐值与参考项目的 builtinLibrary 对齐', () => {
    expect(TWIN_2D_VESSEL_STYLES.map((style) => style.id)).toEqual([
      'water-tank',
      'manifold',
    ])
    expect(TWIN_2D_VESSEL_STYLES.map((style) => style.name)).toEqual([
      '水箱',
      '分集水器',
    ])
    for (const style of TWIN_2D_VESSEL_STYLES) {
      expect(style.category).toBe('vessel')
      expect(style.defaultStatus).toBe('online')
    }
    expect(styleOf('water-tank').size).toEqual({ w: 196, h: 140 })
    expect(styleOf('manifold').size).toEqual({ w: CYL_W, h: CYL_H })
  })

  it('强调色走语义 token：水箱一级、分集水器二级，两者不同', () => {
    expect(styleOf('water-tank').accent).toBe('var(--accent-primary)')
    expect(styleOf('manifold').accent).toBe('var(--accent-secondary)')
  })

  it('四个中点端口逐值，两形共用同一份', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      expect(style.ports.map((port) => port.id)).toEqual(['l', 'r', 't', 'b'])
      expect(style.ports.map((port) => port.side)).toEqual([
        'left',
        'right',
        'top',
        'bottom',
      ])
      expect(style.ports.map((port) => port.at)).toEqual([
        { kind: 'perim', t: 0.875 },
        { kind: 'perim', t: 0.375 },
        { kind: 'perim', t: 0.125 },
        { kind: 'perim', t: 0.625 },
      ])
      // ⚠ 一处 'auto' 都不许留：auto 流进正交路由会让那一条线从节点中心横穿出去
      expect(style.ports.every((port) => port.side !== 'auto')).toBe(true)
    }
  })

  it('六个槽位的键与顺序即 nodeValues 的行序，primary 只有温度，status 不带 enumMap', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      expect(style.slots.map((slot) => slot.key)).toEqual([
        'temperature_c',
        'target_c',
        'level_pct',
        'stored_kwh',
        'status',
        'reading',
      ])
      expect(style.slots.map((slot) => slot.label)).toEqual([
        '当前温度',
        '目标温度',
        '液位',
        '储能',
        '状态',
        '读数行（温度 · 液位）',
      ])
      expect(style.slots.map((slot) => slot.unit)).toEqual([
        '℃',
        '℃',
        '%',
        'kWh',
        '',
        '',
      ])
      expect(
        style.slots.filter((slot) => slot.primary).map((slot) => slot.key),
      ).toEqual(['temperature_c'])
      const status = style.slots[4]
      expect(status?.dataType).toBe('enum')
      expect(status?.enumMap).toEqual({})
    }
  })

  it('读数是一个派生槽：温度 · 液位，缺一段只出一段、全缺给 null', () => {
    const reading = styleOf('water-tank').slots[5]
    expect(reading?.kind).toBe('derived')
    expect(reading?.expr).toEqual({
      kind: 'join',
      of: [
        { kind: 'slot', slot: 'temperature_c' },
        { kind: 'slot', slot: 'level_pct' },
      ],
      sep: ' · ',
    })
    const style = styleOf('water-tank')
    const expr = readingOf(style)
    expect(
      evalExpr(
        expr,
        new Map<string, unknown>([
          ['temperature_c', 63.4],
          ['level_pct', 82],
        ]),
        formatsOf(style),
      ),
    ).toBe('63.4℃ · 82%')
    expect(
      evalExpr(
        expr,
        new Map<string, unknown>([['level_pct', 82]]),
        formatsOf(style),
      ),
    ).toBe('82%')
    expect(
      evalExpr(expr, new Map<string, unknown>(), formatsOf(style)),
    ).toBeNull()
  })

  // 参考项目 `TopologyNodeView.vue` 的 vesselReading：`${t.toFixed(1)}℃` 与
  // `${Math.round(l)}%`，两段之间才是 ' · '
  it('读数行逐段过槽位口径：温度一位小数带 ℃、液位取整带 %', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      const expr = readingOf(style)

      expect(
        evalExpr(
          expr,
          new Map<string, unknown>([
            ['temperature_c', 100],
            ['level_pct', 0],
          ]),
          formatsOf(style),
        ),
      ).toBe('100.0℃ · 0%')
      expect(
        evalExpr(
          expr,
          new Map<string, unknown>([
            ['temperature_c', 63.44],
            ['level_pct', 82.6],
          ]),
          formatsOf(style),
        ),
      ).toBe('63.4℃ · 83%')
    }
  })

  it('每处槽引用都落在自己声明的槽位里（零悬空槽）', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      const keys = new Set(style.slots.map((slot) => slot.key))
      const src = txtOf(style, 'reading').src
      if (src.kind !== 'slot') throw new Error('读数必须取自槽位')
      expect(keys.has(src.slot)).toBe(true)
      for (const slot of style.slots) {
        if (slot.expr === null) continue
        for (const ref of exprSlotRefs(slot.expr))
          expect(keys.has(ref)).toBe(true)
      }
    }
  })

  it('每条变体的补丁都寻址到真实图元（补丁键悬空是静默失效）', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      const ids = new Set(primIds(style.prims))
      for (const variant of style.variants) {
        for (const key of Object.keys(variant.patch)) {
          expect(ids.has(key)).toBe(true)
        }
      }
      expect(style.variants.map((variant) => variant.id)).toEqual([
        'hover',
        'selected',
        'alarm',
        'label-left',
        'label-right',
        'label-inside',
      ])
    }
  })

  it('状态点四档都画、`hidden` 档整枝不画', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      const dot = boxOf(style, 'status-dot')
      expect(dot.z).toBe(5)
      expect(dot.size).toEqual({ w: 7, h: 7 })
      expect(dot.radius).toBe('pill')
      const when = dot.when
      if (when === null) throw new Error('状态点必须带 when')
      for (const status of TWIN_2D_STATUSES) {
        expect(evalCondition(when, ctxWith(status))).toBe(true)
      }
      expect(evalCondition(when, ctxWith(null))).toBe(false)
    }
  })

  it('预置数据本身已经是归一化的结果：过一遍归一化逐字不变', () => {
    for (const style of TWIN_2D_VESSEL_STYLES) {
      expect(normalizeNodeStyle(structuredClone(style))).toEqual(style)
    }
  })
})

describe('水箱（tank）', () => {
  it('图元树：外壳套图标与主体，主体里是标题加读数，另有管接头与状态点', () => {
    const style = styleOf('water-tank')
    expect(style.prims.map((prim) => prim.id)).toEqual([
      'frame',
      'stubs',
      'status-dot',
      'badge',
      'label-outer',
    ])
    expect(boxOf(style, 'frame').children.map((prim) => prim.id)).toEqual([
      'icon',
      'body',
    ])
    expect(boxOf(style, 'body').children.map((prim) => prim.id)).toEqual([
      'label-natural',
      'reading',
    ])
  })

  it('胶囊外壳逐值：1.5px 描边、药丸圆角、4/14 内边距、8 间距、两条发光', () => {
    const frame = boxOf(styleOf('water-tank'), 'frame')
    expect(frame.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
    expect(frame.border).toEqual({
      width: 1.5,
      style: 'solid',
      color: ACCENT,
      sides: { top: true, right: true, bottom: true, left: true },
    })
    expect(frame.radius).toBe('pill')
    expect(frame.layout.flow).toBe('row')
    expect(frame.layout.gap).toBe(8)
    expect(frame.layout.align).toBe('center')
    expect(frame.layout.pad).toEqual([4, 14, 4, 14])
    expect(frame.shadows.map((shadow) => shadow.blur)).toEqual([16, 9])
    expect(frame.shadows.map((shadow) => shadow.inset)).toEqual([true, false])
    expect(frame.shadows.map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 12),
      mixTransparent(ACCENT, 26),
    ])
  })

  it('底渐变是 180°，不是 box / 方块两形的 150°', () => {
    const frame = boxOf(styleOf('water-tank'), 'frame')
    expect(frame.fills).toHaveLength(1)
    expect(frame.fills[0]).toMatchObject({ kind: 'linear', angle: 180 })
    expect(frame.fills[0]).not.toMatchObject({ angle: 150 })
  })

  it('外壳过渡三属性，不含 box 一形那条 background', () => {
    expect(boxOf(styleOf('water-tank'), 'frame').transition).toEqual({
      props: ['border-color', 'box-shadow', 'transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  it('图标 30×30 并钉住最小宽（参考项目的 flex: 0 0 auto）', () => {
    const icon = icoOf(styleOf('water-tank'), 'icon')
    expect(icon.size).toEqual({ w: 30, h: 30 })
    expect(icon.minWidth).toBe(30)
    expect(icon.src).toEqual({ kind: 'sprite', id: 'ico-vsl-tank' })
    expect(icon.color).toBe(ACCENT)
  })

  it('主体撑满剩余宽并两行居中，间距 2', () => {
    const body = boxOf(styleOf('water-tank'), 'body')
    expect(body.size).toEqual({ w: '100%', h: 'auto' })
    expect(body.layout.flow).toBe('col')
    expect(body.layout.gap).toBe(2)
    expect(body.layout.align).toBe('center')
    expect(body.layout.justify).toBe('center')
  })

  it('标题走显示名并单行省略，读数走派生槽且带 .5px 字距', () => {
    const style = styleOf('water-tank')
    const title = txtOf(style, 'label-natural')
    expect(title.src).toEqual({ kind: 'label' })
    expect(title.maxWidth).toBe('100%')
    expect(title.align).toBe('center')
    expect(title.nowrap).toBe(true)
    expect(title.ellipsis).toBe(true)
    expect(title.titleAttr).toBe(true)
    // ⚠ 罐形标题**没有**阴影，圆柱那一处才有
    expect(title.shadows).toEqual([])
    const reading = txtOf(style, 'reading')
    expect(reading.src).toEqual({ kind: 'slot', slot: 'reading' })
    expect(reading.font).toEqual({
      family: 'var(--font-digit)',
      size: 30,
      letterSpacing: 0.5,
      color: ACCENT,
    })
    expect(reading.shadows.map((shadow) => shadow.blur)).toEqual([3])
    expect(reading.shadows.map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 70),
    ])
  })

  it('管接头：贴底沿外挑 5px、左右各留 24%、色带 18/2 且不吃指针', () => {
    const stubs = boxOf(styleOf('water-tank'), 'stubs')
    expect(stubs.at).toEqual({
      kind: 'abs',
      left: '24%',
      right: '24%',
      top: null,
      bottom: -5,
      tx: '0',
      ty: '0',
    })
    expect(stubs.size).toEqual({ w: 'auto', h: 5 })
    expect(stubs.opacity).toBe(0.45)
    expect(stubs.pointerEvents).toBe('none')
    expect(stubs.fills).toEqual([
      {
        kind: 'repeat',
        id: 'stubs',
        angle: 90,
        color: ACCENT,
        width: 2,
        gap: 18,
        opacity: 1,
      },
    ])
  })

  it('hover 抬 3px 并放大到 1.02——不是 box 的 1.025、也不是方块的 1.04', () => {
    const hover = variantOf(styleOf('water-tank'), 'hover')
    expect(hover.when).toEqual({ kind: 'state', state: 'hover' })
    expect(hover.rootPatch).toEqual({ lift: 3, scale: 1.02, z: 30 })
    expect(hover.rootPatch.scale).not.toBe(1.025)
    expect(hover.rootPatch.scale).not.toBe(1.04)
  })

  it('hover 只换描边与三重阴影，不追加径向高光', () => {
    const frame = patchOf(variantOf(styleOf('water-tank'), 'hover'), 'frame')
    expect(frame.border?.color).toBe(
      `color-mix(in srgb, ${ACCENT} 86%, var(--text-primary))`,
    )
    // ⚠ box 一形的 hover 会把 fills 换成「渐变 + 径向高光」，罐形那一档没有这一步
    expect(frame.fills).toBeUndefined()
    expect(shadowsOf(frame).map((shadow) => shadow.blur)).toEqual([20, 18, 18])
    expect(shadowsOf(frame).map((shadow) => shadow.y)).toEqual([0, 8, 0])
    expect(shadowsOf(frame).map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 18),
      'rgba(0, 0, 0, 0.22)',
      mixTransparent(ACCENT, 40),
    ])
  })

  it('选中出一圈 2px 实色加一层外发光，落在有圆角的胶囊外壳上而不是节点根', () => {
    const selected = variantOf(styleOf('water-tank'), 'selected')
    const frame = patchOf(selected, 'frame')
    expect(selected.when).toEqual({ kind: 'state', state: 'selected' })
    expect(shadowsOf(frame).map((shadow) => shadow.spread)).toEqual([2, 0])
    expect(shadowsOf(frame).map((shadow) => shadow.color)).toEqual([
      ACCENT,
      mixTransparent(ACCENT, 45),
    ])
    // ⚠ 节点根 `.t2-node` 没有 border-radius：这两条落到根上就是在药丸外壳外画直角框，
    //   取值一条都不差，只有形状不对，没有一处会报错
    expect(selected.rootPatch).toEqual({})
  })

  it('报警转危险色、外壳呼吸、状态点脉冲', () => {
    const alarm = variantOf(styleOf('water-tank'), 'alarm')
    expect(alarm.when).toEqual({ kind: 'status', in: ['alarm'] })
    expect(patchOf(alarm, 'frame').border?.color).toBe(DANGER)
    expect(patchOf(alarm, 'frame').anim).toEqual({
      kind: 'breathe',
      durationMs: 1000,
    })
    expect(patchOf(alarm, 'status-dot').anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
  })
})

describe('分集水器（cylinder）', () => {
  it('图元树与叠序：体身在下、端盖压两头、双管在上，图标与文字层最后', () => {
    const style = styleOf('manifold')
    expect(style.prims.map((prim) => prim.id)).toEqual([
      'frame',
      'cap-left',
      'cap-right',
      'line-warm',
      'line-cool',
      'icon',
      'body',
      'status-dot',
      'badge',
      'label-outer',
    ])
    expect(boxOf(style, 'body').children.map((prim) => prim.id)).toEqual([
      'label-natural',
      'reading',
    ])
  })

  it('五枚 vec 一律铺满节点盒、几何走归一坐标、两轴各自拉伸且照旧可点', () => {
    const style = styleOf('manifold')
    const ids = ['frame', 'cap-left', 'cap-right', 'line-warm', 'line-cool']
    for (const id of ids) {
      const prim = vecOf(style, id)
      expect(prim.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
      // ⚠ 必须是 unit：px 档的坐标不随实例盒走，而 viewBox 取的正是实例盒尺寸，
      //   于是节点放宽之后圆柱恒定停在 224 宽上（§7.5）
      expect(prim.coord).toBe('unit')
      // ⚠ stretch 即 preserveAspectRatio="none"，参考项目的圆柱就是拉伸的
      expect(prim.stretch).toBe(true)
      // ⚠ 圆柱本体是可点的，只有压在它上面的文字层显式让开；摘成 'none' 会让整个
      //   圆柱只剩图标那一小块能点中
      expect(prim.pointerEvents).toBe('auto')
      expect(onlyStroke(prim).nonScaling).toBe(true)
      expect(onlyStroke(prim).width).toBe(1.2)
    }
  })

  it('默认盒下五枚 vec 的几何逐像素等于参考取值', () => {
    const style = styleOf('manifold')
    const at = (id: string): Record<string, string> =>
      geometryOf(style, id, CYL_W, CYL_H)

    expect(at('frame')).toEqual({
      x: '10',
      y: '0',
      width: '204',
      height: '126',
      rx: '0',
      ry: '0',
    })
    expect(at('cap-left')).toEqual({ cx: '10', cy: '63', rx: '10', ry: '63' })
    expect(at('cap-right')).toEqual({ cx: '214', cy: '63', rx: '10', ry: '63' })
    expect(at('line-warm')).toEqual({
      x1: '14',
      y1: '60',
      x2: '210',
      y2: '60',
    })
    expect(at('line-cool')).toEqual({
      x1: '14',
      y1: '69',
      x2: '210',
      y2: '69',
    })
  })

  // ⚠ 几何按设计像素直写时这一条必红：`paintVec` 的 viewBox 取的正是实例盒尺寸，
  //   viewBox 与元素同尺时 `preserveAspectRatio="none"` 一点缩放都不产生——节点放宽，
  //   圆柱纹丝不动地留在 224 宽上，右边空出一大块，而一处都不报错
  it('节点放宽一倍时五枚 vec 的几何跟着变宽', () => {
    const style = styleOf('manifold')
    const wide = (id: string): Record<string, string> =>
      geometryOf(style, id, CYL_W * 2, CYL_H)

    expect(wide('frame')).toEqual({
      x: '20',
      y: '0',
      width: '408',
      height: '126',
      rx: '0',
      ry: '0',
    })
    expect(wide('cap-left')).toEqual({ cx: '20', cy: '63', rx: '20', ry: '63' })
    expect(wide('cap-right')).toEqual({
      cx: '428',
      cy: '63',
      rx: '20',
      ry: '63',
    })
    expect(wide('line-warm')).toEqual({
      x1: '28',
      y1: '60',
      x2: '420',
      y2: '60',
    })
    expect(wide('line-cool')).toEqual({
      x1: '28',
      y1: '69',
      x2: '420',
      y2: '69',
    })
  })

  // ⚠ 五处「抄成同色 / 抄成对称就白做了」的第一处
  it('端盖与体身**不同色**——圆柱的立体感全在这一处', () => {
    const style = styleOf('manifold')
    const bodyFill = vecOf(style, 'frame').fill
    const capFill = vecOf(style, 'cap-left').fill
    expect(bodyFill).toEqual({ kind: 'color', color: 'var(--surface-panel)' })
    expect(capFill).toEqual({ kind: 'color', color: 'var(--surface-overlay)' })
    expect(capFill).not.toEqual(bodyFill)
    expect(vecOf(style, 'cap-right').fill).toEqual(capFill)
  })

  // ⚠ 第二处
  it('体身矩形**没有圆角**：rx 恒 0，圆全靠两端的端盖压出来', () => {
    const style = styleOf('manifold')
    const rect = rectOf(vecOf(style, 'frame'))
    const drawn = geometryOf(style, 'frame', CYL_W, CYL_H)

    expect(rect.rx).toBe(0)
    // 归一坐标下两轴各按自己的比例放大，两个方向都得是 0 才是真的直角
    expect([drawn['rx'], drawn['ry']]).toEqual(['0', '0'])
  })

  // ⚠ 第三处
  it('端盖横半径**不随高走**：拉高一倍时竖半径跟着变、横半径纹丝不动', () => {
    const style = styleOf('manifold')
    const normal = geometryOf(style, 'cap-left', CYL_W, CYL_H)
    const tall = geometryOf(style, 'cap-left', CYL_W, CYL_H * 2)

    expect([normal['rx'], normal['ry']]).toEqual(['10', String(CYL_CY)])
    // 抄成「横半径也归高」时两者会一起变，而画出来只是「端盖胖了一点」
    expect([tall['rx'], tall['ry']]).toEqual(['10', String(CYL_H)])
    expect(normal['rx']).not.toBe(normal['ry'])
  })

  it('两枚端盖各压一头：圆心在 10 与 W−10、竖向都在中线上', () => {
    const style = styleOf('manifold')
    const left = geometryOf(style, 'cap-left', CYL_W, CYL_H)
    const right = geometryOf(style, 'cap-right', CYL_W, CYL_H)

    expect([left['cx'], left['cy']]).toEqual(['10', String(CYL_CY)])
    expect([right['cx'], right['cy']]).toEqual([
      String(CYL_W - 10),
      String(CYL_CY),
    ])
    expect(ellipseOf(vecOf(style, 'cap-left')).cx).not.toBe(
      ellipseOf(vecOf(style, 'cap-right')).cx,
    )
  })

  // ⚠ 第四处
  it('双集管线**不对称**：暖管在 cy-3、冷管在 cy+6，不是 ±3', () => {
    const style = styleOf('manifold')
    const warm = geometryOf(style, 'line-warm', CYL_W, CYL_H)
    const cool = geometryOf(style, 'line-cool', CYL_W, CYL_H)
    const warmY = Number(warm['y1'])
    const coolY = Number(cool['y1'])

    expect(warmY).toBe(CYL_CY - 3)
    expect(coolY).toBe(CYL_CY + 6)
    expect(warm['y1']).toBe(warm['y2'])
    expect(cool['y1']).toBe(cool['y2'])
    expect(CYL_CY - warmY).not.toBe(coolY - CYL_CY)
    expect(coolY - CYL_CY).not.toBe(3)
    for (const line of [warm, cool]) {
      expect([line['x1'], line['x2']]).toEqual(['14', String(CYL_W - 14)])
    }
  })

  // ⚠ 第五处
  it('标题阴影取**背景色**而不是强调色，否则深色底上标题会发光', () => {
    const title = txtOf(styleOf('manifold'), 'label-natural')
    expect(title.shadows).toEqual([
      {
        id: 'title-halo',
        inset: false,
        x: 0,
        y: 0,
        blur: 4,
        spread: 0,
        color: FILL_B,
      },
    ])
    expect(title.shadows.map((shadow) => shadow.color)).not.toContain(ACCENT)
    expect(title.shadows.map((shadow) => shadow.color)).not.toContain(
      mixTransparent(ACCENT, 70),
    )
  })

  it('四处描边色逐值取自调色板：体身 62% / 端盖 70% / 暖 60% / 冷 60%', () => {
    const style = styleOf('manifold')
    expect(onlyStroke(vecOf(style, 'frame')).color).toBe(
      `rgba(${TWIN_2D_PALETTE_RGB.water}, 0.62)`,
    )
    expect(onlyStroke(vecOf(style, 'cap-left')).color).toBe(
      `rgba(${TWIN_2D_PALETTE_RGB.water}, 0.7)`,
    )
    expect(onlyStroke(vecOf(style, 'cap-right')).color).toBe(
      `rgba(${TWIN_2D_PALETTE_RGB.water}, 0.7)`,
    )
    expect(onlyStroke(vecOf(style, 'line-warm')).color).toBe(
      `rgba(${TWIN_2D_PALETTE_RGB.steam}, 0.6)`,
    )
    expect(onlyStroke(vecOf(style, 'line-cool')).color).toBe(
      `rgba(${TWIN_2D_PALETTE_RGB.solar}, 0.6)`,
    )
  })

  it('只有双集管线是圆头，体身与端盖是平头', () => {
    const style = styleOf('manifold')
    expect(onlyStroke(vecOf(style, 'line-warm')).cap).toBe('round')
    expect(onlyStroke(vecOf(style, 'line-cool')).cap).toBe('round')
    expect(onlyStroke(vecOf(style, 'frame')).cap).toBe('butt')
    expect(onlyStroke(vecOf(style, 'cap-left')).cap).toBe('butt')
  })

  it('图标贴左 7% 竖向居中、26×26 且压在 SVG 之上', () => {
    const icon = icoOf(styleOf('manifold'), 'icon')
    expect(icon.at).toEqual({
      kind: 'abs',
      left: '7%',
      right: null,
      top: '50%',
      bottom: null,
      tx: '0',
      ty: '-50%',
    })
    expect(icon.size).toEqual({ w: 26, h: 26 })
    expect(icon.z).toBe(2)
    expect(icon.src).toEqual({ kind: 'sprite', id: 'ico-vsl-manifold' })
  })

  it('文字层按 0 / 14% / 0 / 24% 内缩、不吃指针、两行无间距', () => {
    const body = boxOf(styleOf('manifold'), 'body')
    expect(body.at).toEqual({ kind: 'fill', inset: [0, '14%', 0, '24%'] })
    expect(body.pointerEvents).toBe('none')
    expect(body.z).toBe(2)
    expect(body.layout.flow).toBe('col')
    expect(body.layout.align).toBe('center')
    expect(body.layout.justify).toBe('center')
    // ⚠ 罐形那一列是 2，这里是 0——逐值不同
    expect(body.layout.gap).toBe(0)
  })

  it('圆柱读数没有字距，罐形那一处才有 .5px', () => {
    const reading = txtOf(styleOf('manifold'), 'reading')
    expect(reading.font).toEqual({
      family: 'var(--font-digit)',
      size: 30,
      color: ACCENT,
    })
    expect(reading.font.letterSpacing).toBeUndefined()
    expect(txtOf(styleOf('water-tank'), 'reading').font.letterSpacing).toBe(0.5)
  })

  it('hover 把体身描边转强调色并加粗到 1.8，且不抬也不放大', () => {
    const hover = variantOf(styleOf('manifold'), 'hover')
    const stroke = strokesOf(patchOf(hover, 'frame'))[0]
    expect(stroke?.width).toBe(1.8)
    expect(stroke?.color).toBe(ACCENT)
    // ⚠ 参考项目的 hover 只落在圆柱体身描边上，罐形那一档才有位移与放大
    expect(hover.rootPatch.lift).toBeUndefined()
    expect(hover.rootPatch.scale).toBeUndefined()
    expect(rootShadowsOf(hover).map((shadow) => shadow.color)).toEqual([
      mixTransparent(ACCENT, 64),
    ])
  })

  it('选中把体身线宽提到 2.5 并只加一层发光，没有罐形那圈 2px 实边', () => {
    const selected = variantOf(styleOf('manifold'), 'selected')
    const stroke = strokesOf(patchOf(selected, 'frame'))[0]
    expect(stroke?.width).toBe(2.5)
    expect(stroke?.color).toBe(`rgba(${TWIN_2D_PALETTE_RGB.water}, 0.62)`)
    expect(rootShadowsOf(selected)).toEqual([
      {
        id: 'halo',
        inset: false,
        x: 0,
        y: 0,
        blur: 8,
        spread: 0,
        color: ACCENT,
      },
    ])
    expect(
      rootShadowsOf(selected).map((shadow) => shadow.spread),
    ).not.toContain(2)
  })

  it('报警只换色不加粗、不呼吸，状态点照旧脉冲', () => {
    const alarm = variantOf(styleOf('manifold'), 'alarm')
    const stroke = strokesOf(patchOf(alarm, 'frame'))[0]
    expect(stroke?.color).toBe(DANGER)
    // ⚠ 只有选中那一档加粗到 2.5，报警仍是 1.2
    expect(stroke?.width).toBe(1.2)
    expect(patchOf(alarm, 'frame').anim).toBeUndefined()
    expect(patchOf(alarm, 'status-dot').anim).toEqual({
      kind: 'pulse',
      durationMs: 1000,
    })
    expect(rootShadowsOf(alarm).map((shadow) => shadow.color)).toEqual([DANGER])
  })
})
