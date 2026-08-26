/**
 * @fileoverview 守 5 种预置连线样式：id / 中文名 / 主色逐值同参考项目，芯线那一遍逐值
 * 同 `.topo-edge`，流动、箭头、非活跃三档的取值不许漂；以及流动那一遍挂的类名与
 * `twin2d.scss` 里的 keyframes 确实是一对（两处都从文件里读，不手抄）。
 *
 * ⚠ 守的是「预置数据慢慢长回渲染分支」这条没有任何一步会报错的退化：预置库里每一个
 * 数都只在这里被钉住一次，改了它而这里没红，就说明它其实没人在乎——那才是该删的时候。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { TWIN_2D_DEFAULT_CORNER_RADIUS } from '../../src/constants'
import { normalizeEdgeStyle } from '../../src/normalizeStyles'
import {
  TWIN_2D_EDGE_PRESETS,
  TWIN_2D_EDGE_PRESET_DEFS,
  twin2dEdgePreset,
} from '../../src/presets/edges'
import { TWIN_2D_PALETTE } from '../../src/presets/palette'
import type { Twin2dEdgeStyle } from '../../src/types'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const RENDER = join(process.cwd(), 'packages', 'twin2d', 'src', 'render')
const SCSS = join(RENDER, 'twin2d.scss')
const EDGE_LAYER = join(RENDER, 'Twin2dEdgeLayer.vue')

/** 参考项目 `BUILTIN_EDGE_KINDS` 的 5 条：id / 中文名 / 主色（`--chart-series-1..5`） */
const REFERENCE: readonly (readonly [string, string, string])[] = [
  ['waste-heat', '余热', '#62ff8a'],
  ['steam', '蒸汽', '#ff5c7a'],
  ['air', '空气能', '#ff9b54'],
  ['solar', '太阳能', '#2fe9ff'],
  ['water', '水流', '#7bd5ff'],
]

function presetOf(id: string): Twin2dEdgeStyle {
  const found = TWIN_2D_EDGE_PRESETS.find((style) => style.id === id)
  if (found === undefined) throw new Error(`没有预置连线样式 ${id}`)
  return found
}

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('预置连线样式的清单', () => {
  it('刚好 5 种，id 与文档序逐字同参考项目', () => {
    expect(TWIN_2D_EDGE_PRESETS.map((style) => style.id)).toEqual(
      REFERENCE.map(([id]) => id),
    )
  })

  it('id 不重复', () => {
    const ids = new Set(TWIN_2D_EDGE_PRESETS.map((style) => style.id))
    expect(ids.size).toBe(TWIN_2D_EDGE_PRESETS.length)
  })

  it.each(REFERENCE)('%s 的中文名与主色逐值', (id, name, accent) => {
    const style = presetOf(id)
    expect(style.name).toBe(name)
    expect(style.accent).toBe(accent)
  })

  it('主色都取自调色板，没有第二处字面 hex', () => {
    const swatches = new Set<string>(Object.values(TWIN_2D_PALETTE))
    for (const style of TWIN_2D_EDGE_PRESETS) {
      expect(swatches.has(style.accent)).toBe(true)
    }
  })

  it('身份表的调色板键与产出的主色对得上', () => {
    for (const def of TWIN_2D_EDGE_PRESET_DEFS) {
      expect(twin2dEdgePreset(def).accent).toBe(TWIN_2D_PALETTE[def.paletteKey])
    }
  })
})

describe('一种连线的结构', () => {
  const style = presetOf('waste-heat')

  it('两遍描边：宽底在下、窄芯在上', () => {
    expect(style.strokes.map((pass) => pass.id)).toEqual(['base', 'core'])
    expect(style.strokes[0]?.width).toBe(6)
    expect(style.strokes[0]?.color).toBe(
      'color-mix(in srgb, currentColor 22%, transparent)',
    )
  })

  it('芯线那一遍逐值同参考项目的 .topo-edge', () => {
    expect(style.strokes[1]).toEqual({
      id: 'core',
      width: 2,
      color: 'currentColor',
      dash: [10, 10],
      cap: 'round',
      join: 'round',
      opacity: 1,
      nonScaling: true,
    })
  })

  it('走线跟随几何层缺省，拐角半径 8', () => {
    expect(style.route).toBe('auto')
    expect(style.cornerRadius).toBe(TWIN_2D_DEFAULT_CORNER_RADIUS)
    expect(style.cornerRadius).toBe(8)
  })

  it('只有末端画箭头，取值逐值同参考项目', () => {
    expect(style.startMarker).toEqual({ kind: 'none' })
    expect(style.endMarker).toEqual({
      kind: 'arrow',
      size: 10,
      spread: 0.42,
      filled: true,
      opacity: 0.82,
    })
  })

  it('非活跃档压透明度、拉直虚线，颜色沿用边色', () => {
    expect(style.inactive).toEqual({
      opacity: 0.5,
      dashOff: true,
      color: '',
    })
  })

  it('标签的字色与字距刻意缺席（缺席 = 跟随边色与主题）', () => {
    expect(style.label.font).toEqual({
      family: 'var(--font-digit)',
      size: 12,
      weight: 600,
    })
    expect(style.label.box).not.toBeNull()
    expect(style.label.box?.radius).toBe('pill')
    expect(style.label.box?.pad).toEqual([2, 6, 2, 6])
    expect(style.label.box?.border.style).toBe('none')
  })

  it('五种的结构与描边完全同形，差的只有 id / 名字 / 主色', () => {
    for (const other of TWIN_2D_EDGE_PRESETS) {
      expect(other.strokes).toEqual(style.strokes)
      expect(other.flow).toEqual(style.flow)
      expect(other.endMarker).toEqual(style.endMarker)
      expect(other.inactive).toEqual(style.inactive)
      expect(other.label).toEqual(style.label)
    }
  })
})

describe('预置连线过一遍归一化恒等', () => {
  it.each(TWIN_2D_EDGE_PRESETS.map((style) => [style.id, style] as const))(
    '%s',
    (_id, style) => {
      expect(normalizeEdgeStyle(style)).toEqual(style)
    },
  )
})

describe('流动动画', () => {
  it('五种都开流动，dash 与芯线同段长、基准 0.8s', () => {
    for (const style of TWIN_2D_EDGE_PRESETS) {
      expect(style.flow).toEqual({
        enabled: true,
        dash: [10, 10],
        durationMs: 800,
      })
    }
  })

  it('dash 段数是偶数，dashoffset 终点才等于一个完整周期', () => {
    for (const style of TWIN_2D_EDGE_PRESETS) {
      const sum = style.flow.dash.reduce((total, seg) => total + seg, 0)
      expect(style.flow.dash.length % 2).toBe(0)
      expect(sum).toBeGreaterThan(0)
    }
  })

  it('连线层挂的类名与 scss 里的规则、keyframes 三处对得上', () => {
    const layer = read(EDGE_LAYER)
    const scss = read(SCSS)
    const declared = /const FLOW_CLASS = '([a-z0-9-]+)'/.exec(layer)?.[1]
    expect(declared).toBeDefined()
    const rule = new RegExp(`\\.${declared ?? ''}\\s*\\{([^}]*)\\}`).exec(scss)
    expect(rule).not.toBeNull()
    const keyframes = /animation:\s*([a-z0-9-]+)/.exec(rule?.[1] ?? '')?.[1]
    expect(keyframes).toBeDefined()
    expect(scss).toContain(`@keyframes ${keyframes ?? ''}`)
  })

  it('那条 keyframes 的终点是注入进来的 --t2-dash-end，不是写死的 -20', () => {
    const scss = read(SCSS)
    const body = /@keyframes t2-dash\s*\{([\s\S]*?)\n\}/.exec(scss)?.[1] ?? ''
    expect(body).toContain('var(--t2-dash-end)')
    expect(body).not.toContain('-20')
  })
})
