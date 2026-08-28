/**
 * @fileoverview 锁住四个能源源预置样式：id / 尺寸 / 强调色 / 图元树 / 端口 / 槽位与
 * 三档变体的逐值取值，出处是参考项目 topology-view 的 `builtinLibrary.ts` 与
 * `TopologyNodeView.vue` 的样式块。
 * ⚠ 最后两条是「预置库是数据、不是渲染分支」的机械证明：四棵图元树除图标那一枚
 * sprite 外必须逐字相同，且整份字面量过一遍归一化不变。少了它们，「预置数据」会
 * 慢慢长回渲染件里的 `if (styleId === …)`，而这个退化过程没有任何一步会报错。
 */
import { describe, expect, it } from 'vitest'

import { evalExpr } from '../../src/expr'
import { formatSlotValue } from '../../src/format'
import { normalizeNodeStyle } from '../../src/normalizeStyles'
import {
  TWIN_2D_SOURCE_STYLES,
  TWIN_2D_SOURCE_STYLE_IDS,
} from '../../src/presets/nodesSource'
import { TWIN_2D_PALETTE } from '../../src/presets/palette'
import { applyVariants, evalCondition } from '../../src/variants'
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
  Twin2dTxtPrim,
  Twin2dVecPrim,
} from '../../src/typesPrim'
import type { Twin2dVariantCtx } from '../../src/variants'

/** 节点根注入的强调色变量，图元里一律引它 */
const ACCENT = 'var(--t2-accent)'

/**
 * 掺透明底的那一串。
 * ⚠ 这里**另写一份**而不是 import `mixTransparent`：拿被测模块自己的拼串器去核对它自己
 * 拼出来的串，两边一起改错时用例照绿。
 */
function mix(percent: number): string {
  return `color-mix(in srgb, ${ACCENT} ${percent}%, transparent)`
}

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

function flatten(prims: readonly Twin2dPrim[]): Twin2dPrim[] {
  const out: Twin2dPrim[] = []
  for (const prim of prims) {
    out.push(prim)
    if (prim.kind === 'box') out.push(...flatten(prim.children))
  }
  return out
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

/**
 * 求一条算式的值；口径表给空。
 * ⚠ 本文件那两条兜底链产出的是**数**、不经 `join`，逐段口径用不上；水箱那条读数行
 * 才要口径（`nodesVessel.test.ts`）。
 */
function evalOf(
  expr: Twin2dExpr,
  values: ReadonlyMap<string, unknown>,
): number | string | null {
  return evalExpr(expr, values, new Map())
}

function slotOf(style: Twin2dNodeStyle, key: string): Twin2dSlot {
  const slot = style.slots.find((one) => one.key === key)
  if (slot === undefined) throw new Error(`样式 ${style.id} 没有槽位 ${key}`)
  return slot
}

function styleOf(id: string): Twin2dNodeStyle {
  const hit = TWIN_2D_SOURCE_STYLES.find((style) => style.id === id)
  if (hit === undefined) throw new Error(`没有预置样式 ${id}`)
  return hit
}

function variantOf(style: Twin2dNodeStyle, id: string): Twin2dVariant {
  const hit = style.variants.find((variant) => variant.id === id)
  if (hit === undefined) throw new Error(`${style.id} 没有变体 ${id}`)
  return hit
}

// ⚠ 取补丁一律抛错而不是可选链：一串 `?.` 会让断言在补丁整块缺席时静默通过，
//   而「hover 配了没反应」正是这个样子
function patchOf(variant: Twin2dVariant, primId: string): Twin2dPrimPatch {
  const patch = variant.patch[primId]
  if (patch === undefined) {
    throw new Error(`变体 ${variant.id} 没有补丁 ${primId}`)
  }
  return patch
}

/** 一条补丁里换掉的描边色；没换就抛错 */
function borderColorOf(patch: Twin2dPrimPatch): string {
  const border = patch.border
  if (border === undefined) throw new Error('这条补丁没有换描边')
  return border.color
}

function ctxOf(over: Partial<Twin2dVariantCtx>): Twin2dVariantCtx {
  return {
    states: new Set(),
    status: 'online',
    tags: new Map<string, string>(),
    slots: new Map<string, unknown>(),
    fields: new Map(),
    ...over,
  }
}

/** 一棵树上被引用到的槽键：txt 的来源、图元的显示条件、派生槽的算式各出一份 */
function slotRefsOf(style: Twin2dNodeStyle): string[] {
  const keys: string[] = []
  for (const prim of flatten(style.prims)) {
    if (prim.kind === 'txt' && prim.src.kind === 'slot')
      keys.push(prim.src.slot)
    const when = prim.when
    if (when !== null && when.kind === 'has') keys.push(...when.slots)
  }
  return keys
}

const SOURCE_IDS = [
  'waste-heat-source',
  'steam-source',
  'air-source',
  'solar-source',
]

/** 全树 29 枚图元的文档序（深度优先），四个样式逐字相同；末两枚是每份样式都挂的外挂件 */
const PRIM_IDS = [
  'frame',
  'icon',
  'glyph',
  'body',
  'label-natural',
  'readings',
  'energy-main',
  'energy-label',
  'output-value',
  'energy-unit',
  'energy-pct',
  'efficiency-value',
  'energy-tip',
  'tip-arrow',
  'tip-title',
  'tip-rows',
  'tip-row-input',
  'tip-input-label',
  'tip-input-value',
  'tip-row-output',
  'tip-output-label',
  'tip-output-value',
  'tip-row-efficiency',
  'tip-efficiency-label',
  'tip-efficiency-value',
  'status-dot',
  'badge',
  'badge-text',
  'label-outer',
]

describe('四个能源源预置样式', () => {
  it('id / 名字 / 分类 / 缺省状态 / 尺寸逐值与参考项目的 builtinLibrary 对齐', () => {
    expect([...TWIN_2D_SOURCE_STYLE_IDS]).toEqual(SOURCE_IDS)
    expect(TWIN_2D_SOURCE_STYLES.map((style) => style.id)).toEqual(SOURCE_IDS)
    expect(TWIN_2D_SOURCE_STYLES.map((style) => style.name)).toEqual([
      '余热回收',
      '蒸汽锅炉',
      '空气能',
      '太阳能',
    ])
    for (const style of TWIN_2D_SOURCE_STYLES) {
      expect(style.category).toBe('source')
      expect(style.defaultStatus).toBe('online')
      expect(style.size).toEqual({ w: 224, h: 124 })
    }
  })

  it('强调色四档：余热绿 / 蒸汽红 / 空气能橙 / 太阳青，两两不同', () => {
    expect(styleOf('waste-heat-source').accent).toBe(TWIN_2D_PALETTE.wasteHeat)
    expect(styleOf('steam-source').accent).toBe(TWIN_2D_PALETTE.steam)
    expect(styleOf('air-source').accent).toBe(TWIN_2D_PALETTE.airEnergy)
    expect(styleOf('solar-source').accent).toBe(TWIN_2D_PALETTE.solar)
    expect(TWIN_2D_SOURCE_STYLES.map((style) => style.accent)).toEqual([
      '#62ff8a',
      '#ff5c7a',
      '#ff9b54',
      '#2fe9ff',
    ])
  })

  it('四枚 sprite 逐值，与参考项目的 SOURCE_CLASS_ICON 同名', () => {
    expect(
      TWIN_2D_SOURCE_STYLES.map((style) => icoOf(style, 'glyph').src),
    ).toEqual([
      { kind: 'sprite', id: 'ico-src-waste-heat' },
      { kind: 'sprite', id: 'ico-src-steam' },
      { kind: 'sprite', id: 'ico-src-air-source' },
      { kind: 'sprite', id: 'ico-src-solar' },
    ])
  })

  for (const id of SOURCE_IDS) {
    it(`${id} 结构完整：29 枚图元、id 全树唯一、槽引用与补丁寻址都不悬空`, () => {
      const style = styleOf(id)
      const prims = flatten(style.prims)
      expect(prims.map((prim) => prim.id)).toEqual(PRIM_IDS)
      expect(new Set(prims.map((prim) => prim.id)).size).toBe(29)
      expect(style.prims.map((prim) => prim.id)).toEqual([
        'frame',
        'energy-tip',
        'status-dot',
        'badge',
        'label-outer',
      ])

      const slotKeys = new Set(style.slots.map((slot) => slot.key))
      expect(new Set(style.slots.map((slot) => slot.key)).size).toBe(
        style.slots.length,
      )
      for (const key of slotRefsOf(style)) expect(slotKeys.has(key)).toBe(true)
      for (const slot of style.slots) {
        if (slot.expr === null) continue
        for (const ref of JSON.stringify(slot.expr).matchAll(
          /"slot":"(\w+)"/g,
        )) {
          expect(slotKeys.has(ref[1] ?? '')).toBe(true)
        }
      }

      const primIds = new Set(prims.map((prim) => prim.id))
      for (const variant of style.variants) {
        for (const target of Object.keys(variant.patch)) {
          expect(primIds.has(target)).toBe(true)
        }
      }

      const portIds = style.ports.map((port) => port.id)
      expect(new Set(portIds).size).toBe(portIds.length)
    })
  }

  it('外框逐值：1.5px 强调色描边、8 圆角、6/10 内边距、8 间距、150° 渐变与两条发光', () => {
    const frame = boxOf(styleOf('waste-heat-source'), 'frame')
    expect(frame.at).toEqual({ kind: 'fill', inset: [0, 0, 0, 0] })
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
    expect(frame.cursor).toBe('help')
    expect(frame.fills).toHaveLength(1)
    expect(frame.fills[0]).toMatchObject({ kind: 'linear', angle: 150 })
    expect(frame.shadows.map((shadow) => [shadow.inset, shadow.blur])).toEqual([
      [true, 14],
      [false, 8],
    ])
    expect(frame.shadows.map((shadow) => shadow.color)).toEqual([
      mix(12),
      mix(22),
    ])
    expect(frame.transition).toEqual({
      props: ['border-color', 'background', 'box-shadow', 'transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  it('图标底板 34×34 套 26×26 图标，底色是写死的那一处而不是节点色派生', () => {
    const style = styleOf('steam-source')
    const plate = boxOf(style, 'icon')
    expect(plate.size).toEqual({ w: 34, h: 34 })
    expect(plate.layout.flow).toBe('none')
    expect(plate.layout.align).toBe('center')
    expect(plate.layout.justify).toBe('center')
    expect(plate.radius).toBe(4)
    expect(plate.border.width).toBe(1)
    expect(plate.border.color).toBe(mix(40))
    expect(plate.fills).toEqual([
      {
        kind: 'solid',
        id: 'icon-plate',
        color: 'rgba(var(--accent-primary-rgb), 0.06)',
        opacity: 1,
      },
    ])
    expect(icoOf(style, 'glyph').size).toEqual({ w: 26, h: 26 })
    expect(icoOf(style, 'glyph').color).toBe(ACCENT)
  })

  it('主体两行一列：显示名 18px/600，读数行两端分布、间距 10', () => {
    const style = styleOf('air-source')
    const body = boxOf(style, 'body')
    expect(body.size).toEqual({ w: '100%', h: 'auto' })
    expect(body.layout.flow).toBe('col')
    expect(body.layout.gap).toBe(2)
    expect(body.layout.align).toBe('stretch')

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

    const readings = boxOf(style, 'readings')
    expect(readings.layout.flow).toBe('row')
    expect(readings.layout.align).toBe('baseline')
    expect(readings.layout.justify).toBe('between')
    expect(readings.layout.gap).toBe(10)
    expect(readings.when).toEqual({
      kind: 'has',
      slots: ['input_kwh', 'output_kwh', 'efficiency_pct'],
      mode: 'any',
    })
  })

  it('能量三件套：「输出」大字「kWh」12px 副色，大字 28px 带 3px 字发光', () => {
    const style = styleOf('solar-source')
    const main = boxOf(style, 'energy-main')
    expect(main.layout.align).toBe('baseline')
    expect(main.layout.gap).toBe(4)
    expect(main.children.map((prim) => prim.id)).toEqual([
      'energy-label',
      'output-value',
      'energy-unit',
    ])
    expect(txtOf(style, 'energy-label').src).toEqual({
      kind: 'lit',
      text: '输出',
    })
    expect(txtOf(style, 'energy-unit').src).toEqual({
      kind: 'lit',
      text: 'kWh',
    })
    for (const id of ['energy-label', 'energy-unit']) {
      expect(txtOf(style, id).font).toEqual({
        size: 12,
        letterSpacing: 0,
        color: 'var(--text-secondary)',
      })
    }

    const value = txtOf(style, 'output-value')
    expect(value.src).toEqual({ kind: 'slot', slot: 'output' })
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 28,
      letterSpacing: 0.5,
      color: ACCENT,
    })
    expect(value.shadows).toEqual([
      {
        id: 'output-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 3,
        spread: 0,
        color: mix(70),
      },
    ])
  })

  it('能效药丸：pill 圆角、1/6 内边距、52% 描边、14% 底、8px 外发光、digit 20px', () => {
    const style = styleOf('waste-heat-source')
    const pill = boxOf(style, 'energy-pct')
    expect(pill.radius).toBe('pill')
    expect(pill.layout.pad).toEqual([1, 6, 1, 6])
    expect(pill.border.width).toBe(1)
    expect(pill.border.color).toBe(mix(52))
    expect(pill.fills).toEqual([
      { kind: 'solid', id: 'pct-bg', color: mix(14), opacity: 1 },
    ])
    expect(pill.shadows.map((shadow) => [shadow.blur, shadow.color])).toEqual([
      [8, mix(26)],
    ])
    expect(pill.transition?.durationMs).toBe(180)

    const value = txtOf(style, 'efficiency-value')
    expect(value.src).toEqual({ kind: 'slot', slot: 'efficiency' })
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 20,
      letterSpacing: 0.4,
      color: ACCENT,
    })
  })

  it('悬浮卡卡体逐值：abs 摆位、188 下限、z 10、三层底、三重阴影、8px 背板模糊', () => {
    const tip = boxOf(styleOf('steam-source'), 'energy-tip')
    expect(tip.at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: -10,
      bottom: null,
      tx: '-50%',
      ty: 'calc(-100% - 4px)',
    })
    expect(tip.minWidth).toBe(188)
    expect(tip.z).toBe(10)
    expect(tip.opacity).toBe(0)
    expect(tip.scale).toBe(0.96)
    expect(tip.transformOrigin).toBe('50% 100%')
    expect(tip.backdropBlur).toBe(8)
    expect(tip.radius).toBe(4)
    expect(tip.border.width).toBe(1)
    expect(tip.border.color).toBe(mix(62))
    expect(tip.layout.pad).toEqual([8, 10, 8, 10])
    expect(tip.layout.gap).toBe(6)
    // 文档序从下往上：写死的底 → 顶上那圈光斑 → 近乎不透明的两段渐变
    expect(tip.fills.map((fill) => fill.kind)).toEqual([
      'solid',
      'radial',
      'linear',
    ])
    expect(tip.shadows.map((shadow) => [shadow.y, shadow.blur])).toEqual([
      [0, 18],
      [12, 26],
      [0, 18],
    ])
    expect(tip.shadows.map((shadow) => shadow.color)).toEqual([
      mix(14),
      'rgba(0, 0, 0, 0.48)',
      mix(30),
    ])
    expect(tip.transition).toEqual({
      props: ['opacity', 'transform'],
      durationMs: 180,
      easing: 'ease',
    })
  })

  // ⚠ 单拎一条：卡片吃了指针就会 hover 自我抖动——卡片弹出来盖住指针 → 节点失去
  //   hover → 卡片收起 → 指针回到节点 → 再弹出，每秒十几次，而每一帧的样式都是「对」的
  it('悬浮卡与它的小箭头一律不吃指针事件', () => {
    for (const style of TWIN_2D_SOURCE_STYLES) {
      expect(boxOf(style, 'energy-tip').pointerEvents).toBe('none')
      expect(vecOf(style, 'tip-arrow').pointerEvents).toBe('none')
    }
  })

  it('悬浮卡三行：标题 220 上限，行内说明字靠左、digit 15px 读数靠右', () => {
    const style = styleOf('air-source')
    const tip = boxOf(style, 'energy-tip')
    expect(tip.children.map((prim) => prim.id)).toEqual([
      'tip-arrow',
      'tip-title',
      'tip-rows',
    ])
    const title = txtOf(style, 'tip-title')
    expect(title.maxWidth).toBe(220)
    expect(title.src).toEqual({ kind: 'label' })
    expect(title.font).toEqual({
      size: 12,
      weight: 600,
      color: 'var(--text-title)',
    })
    expect(title.titleAttr).toBe(false)

    expect(boxOf(style, 'tip-rows').children.map((prim) => prim.id)).toEqual([
      'tip-row-input',
      'tip-row-output',
      'tip-row-efficiency',
    ])
    const row = boxOf(style, 'tip-row-input')
    expect(row.layout.justify).toBe('between')
    expect(row.layout.align).toBe('baseline')
    expect(row.layout.gap).toBe(14)
    expect(txtOf(style, 'tip-input-label').src).toEqual({
      kind: 'lit',
      text: '输入能量',
    })
    expect(txtOf(style, 'tip-input-label').font).toEqual({
      size: 12,
      color: 'var(--text-secondary)',
    })
    const value = txtOf(style, 'tip-output-value')
    expect(value.src).toEqual({ kind: 'slot', slot: 'output_total' })
    expect(value.font).toEqual({
      family: 'var(--font-digit)',
      size: 15,
      weight: 400,
      color: ACCENT,
    })
    expect(value.nowrap).toBe(true)
    expect(txtOf(style, 'tip-efficiency-value').src).toEqual({
      kind: 'slot',
      slot: 'efficiency',
    })
  })

  it('小箭头：8×8 转 45°，只描右下两条边，走开口折线', () => {
    const arrow = vecOf(styleOf('solar-source'), 'tip-arrow')
    expect(arrow.size).toEqual({ w: 8, h: 8 })
    expect(arrow.rotate).toBe(45)
    expect(arrow.coord).toBe('unit')
    expect(arrow.stretch).toBe(true)
    expect(arrow.shape).toEqual({
      kind: 'poly',
      points: [
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      closed: false,
    })
    expect(arrow.at).toMatchObject({ kind: 'abs', left: '50%', bottom: -5 })
    expect(arrow.fill).toEqual({
      kind: 'color',
      color: 'var(--surface-overlay)',
    })
    expect(arrow.strokes.map((pass) => [pass.width, pass.color])).toEqual([
      [1, mix(48)],
    ])
    expect(arrow.strokes[0]?.nonScaling).toBe(true)
  })

  it('状态点：右下 5/5、7×7 药丸、6px 同色发光、z 5，hidden 档整枝摘掉', () => {
    const style = styleOf('waste-heat-source')
    const dot = boxOf(style, 'status-dot')
    expect(dot.at).toEqual({
      kind: 'abs',
      left: null,
      right: 5,
      top: null,
      bottom: 5,
      tx: '0',
      ty: '0',
    })
    expect(dot.size).toEqual({ w: 7, h: 7 })
    expect(dot.z).toBe(5)
    expect(dot.radius).toBe('pill')
    expect(dot.fills).toEqual([
      { kind: 'solid', id: 'dot-bg', color: 'var(--t2-status)', opacity: 1 },
    ])
    expect(dot.shadows.map((shadow) => [shadow.blur, shadow.color])).toEqual([
      [6, 'var(--t2-status)'],
    ])
    const when = dot.when
    expect(when).toEqual({
      kind: 'status',
      in: ['online', 'offline', 'warning', 'alarm'],
    })
    expect(when !== null && evalCondition(when, ctxOf({ status: null }))).toBe(
      false,
    )
    expect(
      when !== null && evalCondition(when, ctxOf({ status: 'offline' })),
    ).toBe(true)
  })

  it('四边中点端口：上 .125 / 右 .375 / 下 .625 / 左 .875，侧向定死不留 auto', () => {
    for (const style of TWIN_2D_SOURCE_STYLES) {
      expect(style.ports.map((port) => [port.id, port.side, port.at])).toEqual([
        ['l', 'left', { kind: 'perim', t: 0.875 }],
        ['r', 'right', { kind: 'perim', t: 0.375 }],
        ['t', 'top', { kind: 'perim', t: 0.125 }],
        ['b', 'bottom', { kind: 'perim', t: 0.625 }],
      ])
      for (const port of style.ports) {
        expect(port.dir).toBe('both')
        expect(port.showName).toBe(false)
        expect(port.marker).toBe(null)
      }
    }
  })

  it('槽位表：SOURCE_FIELDS 的八项逐值，加 cop 与三个派生槽', () => {
    const style = styleOf('steam-source')
    expect(style.slots.map((slot) => slot.key)).toEqual([
      'input_kwh',
      'output_kwh',
      'efficiency_pct',
      'today_kwh',
      'power_kw',
      'temperature_c',
      'flow_m3h',
      'status',
      'cop',
      'output',
      'output_total',
      'efficiency',
    ])
    expect(style.slots.map((slot) => slot.label)).toEqual([
      '输入能量',
      '输出能量',
      '能效',
      '今日产能',
      '当前功率',
      '温度',
      '流量',
      '状态',
      '性能系数',
      '输出（读数行）',
      '输出（悬浮卡）',
      '能效（合成）',
    ])
    expect(style.slots.map((slot) => slot.unit)).toEqual([
      'kWh',
      'kWh',
      '%',
      'kWh',
      'kW',
      '℃',
      'm³/h',
      '',
      '',
      '',
      'kWh',
      '%',
    ])
    expect(
      style.slots.filter((slot) => slot.primary).map((s) => s.key),
    ).toEqual(['output_kwh'])
    expect(style.slots.filter((slot) => slot.kind === 'derived').length).toBe(3)
    for (const slot of style.slots) expect(slot.placeholder).toBe('—')
  })

  it('状态槽的映射表键是字符串，四档与参考项目的 STATUS_LABELS 同义', () => {
    const status = styleOf('solar-source').slots.find((s) => s.key === 'status')
    expect(status?.dataType).toBe('enum')
    expect(status?.enumMap).toEqual({
      '0': '离线',
      '1': '运行',
      '2': '待机',
      '3': '报警',
    })
  })

  // 参考项目 `formatKwhShort` 是 `(v / 1000).toFixed(abs >= 10_000 ? 0 : 1)`：千位那一支
  // 留一位小数、万位那一支不留。两支都得对上，钉死一个位数只能对上其中一支
  it('主读数压缩档：3300 显 3.3k、12345 显 12k、千位以下显整数', () => {
    const output = slotOf(styleOf('air-source'), 'output')

    expect(formatSlotValue(3300, output)).toBe('3.3k')
    expect(formatSlotValue(1400, output)).toBe('1.4k')
    expect(formatSlotValue(12345, output)).toBe('12k')
    expect(formatSlotValue(880, output)).toBe('880')
    expect(formatSlotValue(-3300, output)).toBe('-3.3k')
  })

  // 参考项目 `formatPct` 是 `${fmtTrim(v, 2)}%`：百分号紧贴数值；同一张卡上的
  // `formatKwhFull` 是 `${…} kWh`，字母单位前留一个空格
  it('能效那一槽百分号紧贴，kWh 那两槽照旧留空格', () => {
    const style = styleOf('air-source')

    expect(formatSlotValue(32, slotOf(style, 'efficiency'))).toBe('32%')
    expect(formatSlotValue(63.456, slotOf(style, 'efficiency'))).toBe('63.46%')
    expect(formatSlotValue(1234.6, slotOf(style, 'input_kwh'))).toBe(
      '1,235 kWh',
    )
  })

  it('输出兜底链：output_kwh 优先，缺了落 today_kwh，两个都没有给空', () => {
    const expr = styleOf('air-source').slots.find(
      (s) => s.key === 'output',
    )?.expr
    if (expr == null) throw new Error('output 槽没有算式')
    expect(evalOf(expr, new Map([['output_kwh', 820]]))).toBe(820)
    expect(evalOf(expr, new Map([['today_kwh', 640]]))).toBe(640)
    expect(
      evalOf(
        expr,
        new Map([
          ['output_kwh', 0],
          ['today_kwh', 640],
        ]),
      ),
    ).toBe(0)
    expect(evalOf(expr, new Map([['power_kw', 12]]))).toBe(null)
  })

  it('能效兜底链三级：显式能效 → COP×100 → 输出÷投入×100，投入为 0 时整式为空', () => {
    const expr = styleOf('air-source').slots.find(
      (s) => s.key === 'efficiency',
    )?.expr
    if (expr == null) throw new Error('efficiency 槽没有算式')
    expect(evalOf(expr, new Map([['efficiency_pct', 88]]))).toBe(88)
    expect(evalOf(expr, new Map([['cop', 3.2]]))).toBeCloseTo(320, 10)
    expect(
      evalOf(
        expr,
        new Map([
          ['output_kwh', 90],
          ['input_kwh', 200],
        ]),
      ),
    ).toBe(45)
    expect(
      evalOf(
        expr,
        new Map([
          ['output_kwh', 90],
          ['input_kwh', 0],
        ]),
      ),
    ).toBe(null)
  })

  it('hover 的六处补丁逐值：抬 3 放大 1.025 抬 z 到 30，外壳换色叠光斑换三重阴影', () => {
    const style = styleOf('waste-heat-source')
    const hover = variantOf(style, 'hover')
    expect(hover.when).toEqual({ kind: 'state', state: 'hover' })
    expect(hover.rootPatch).toEqual({ lift: 3, scale: 1.025, z: 30 })

    const frame = patchOf(hover, 'frame')
    expect(borderColorOf(frame)).toBe(
      'color-mix(in srgb, var(--t2-accent) 86%, var(--text-primary))',
    )
    // 常态那层 150° 渐变照旧，顶上**追加**一层左上角光斑
    expect(frame.fills?.map((fill) => fill.kind)).toEqual(['linear', 'radial'])
    expect(frame.fills?.[1]).toMatchObject({ kind: 'radial', cx: 0.25, cy: 0 })
    expect(frame.shadows?.map((s) => [s.inset, s.y, s.blur])).toEqual([
      [true, 0, 18],
      [false, 8, 18],
      [false, 0, 18],
    ])
    expect(frame.shadows?.map((s) => s.color)).toEqual([
      mix(18),
      'rgba(0, 0, 0, 0.24)',
      mix(42),
    ])

    const icon = patchOf(hover, 'icon')
    expect(icon.scale).toBe(1.08)
    expect(borderColorOf(icon)).toBe(mix(62))
    expect(icon.fills).toEqual([
      { kind: 'solid', id: 'icon-plate', color: mix(16), opacity: 1 },
    ])
    expect(icon.shadows?.map((s) => [s.blur, s.color])).toEqual([[12, mix(34)]])

    const tip = patchOf(hover, 'energy-tip')
    expect(tip.opacity).toBe(1)
    expect(tip.scale).toBe(1)
    expect(tip.at).toEqual({
      kind: 'abs',
      left: '50%',
      right: null,
      top: -10,
      bottom: null,
      tx: '-50%',
      ty: 'calc(-100% - 8px)',
    })
  })

  it('选中：2px 实边加一层 16px 外发光，落在圆角外壳上而不是没有圆角的节点根', () => {
    const style = styleOf('solar-source')
    const selected = variantOf(style, 'selected')
    expect(selected.when).toEqual({ kind: 'state', state: 'selected' })
    expect(selected.rootPatch).toEqual({})
    const frame = patchOf(selected, 'frame')
    expect(frame.shadows).toEqual([
      {
        id: 'sel-ring',
        inset: false,
        x: 0,
        y: 0,
        blur: 0,
        spread: 2,
        color: ACCENT,
      },
      {
        id: 'sel-glow',
        inset: false,
        x: 0,
        y: 0,
        blur: 16,
        spread: 0,
        color: mix(45),
      },
    ])
  })

  it('报警按状态命中而不是交互态：描边转危险色，外壳呼吸、状态点脉冲', () => {
    const style = styleOf('steam-source')
    const alarm = variantOf(style, 'alarm')
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
    // ⚠ 写成 `{kind:'state',state:'alarm'}` 就是一条永不命中的变体：交互态只从外部
    //   props 进，舞台一个都不传，报警节点会照常画成常态且零报错
    expect(evalCondition(alarm.when, ctxOf({ status: 'alarm' }))).toBe(true)
    expect(evalCondition(alarm.when, ctxOf({ status: 'online' }))).toBe(false)
  })

  it('三档交互变体加三档名位变体，文档序即覆盖序，且常态一档都不命中', () => {
    for (const style of TWIN_2D_SOURCE_STYLES) {
      expect(style.variants.map((variant) => variant.id)).toEqual([
        'hover',
        'selected',
        'alarm',
        'label-left',
        'label-right',
        'label-inside',
      ])
    }
    const style = styleOf('waste-heat-source')
    const idle = applyVariants(style.prims, style.variants, ctxOf({}))
    expect(idle.root).toEqual({})
    expect(idle.prims).toBe(style.prims)

    const hovered = applyVariants(
      style.prims,
      style.variants,
      ctxOf({ states: new Set(['hover']) }),
    )
    expect(hovered.root).toEqual({ lift: 3, scale: 1.025, z: 30 })
    const tip = walk(hovered.prims, 'energy-tip')
    expect(tip?.opacity).toBe(1)
  })

  // ⚠ 这一条是「预置库是数据、不是渲染分支」的机械证明：把那枚 sprite 抹平之后四棵树
  //   必须逐字相同。一旦有人把某一类的观感挪进渲染件里的 `if (styleId === …)`，
  //   四棵树就不再相同，而那个退化过程本身不会有任何一步报错
  it('四棵图元树除图标那一枚 sprite 外逐字相同，槽位与端口整份共享', () => {
    const shapes = TWIN_2D_SOURCE_STYLES.map((style) =>
      JSON.stringify(style.prims).replace(/"ico-src-[a-z-]+"/g, '"<sprite>"'),
    )
    expect(new Set(shapes).size).toBe(1)
    const slots = TWIN_2D_SOURCE_STYLES.map((s) => JSON.stringify(s.slots))
    expect(new Set(slots).size).toBe(1)
    const ports = TWIN_2D_SOURCE_STYLES.map((s) => JSON.stringify(s.ports))
    expect(new Set(ports).size).toBe(1)
    const variants = TWIN_2D_SOURCE_STYLES.map((s) =>
      JSON.stringify(s.variants),
    )
    expect(new Set(variants).size).toBe(1)
  })

  // ⚠ 归一化会把越界的取值悄悄改成兜底值：往返不变才说明这批字面量本来就是规范形，
  //   否则用户看到的是「我配的数被改了，但没人告诉我」
  it('整份字面量过一遍归一化不变', () => {
    for (const style of TWIN_2D_SOURCE_STYLES) {
      const round = normalizeNodeStyle(JSON.parse(JSON.stringify(style)))
      expect(round).toEqual(style)
    }
  })
})
