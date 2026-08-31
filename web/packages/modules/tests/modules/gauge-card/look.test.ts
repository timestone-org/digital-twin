/**
 * @fileoverview 守 gauge-card 的外观模型：尺寸夹回清单范围、「没配就不注入变量」、
 * 五档几何各自的缺省、`auto` 排布按仪表个数收敛、外层网格的列模板，以及变量名联合与
 * 模块全部样式源里的引用集合双向吻合。
 * ⚠ 变量名拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`，这条双向断言是这套变量唯一的守卫。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { GC_ITEM_VAR_NAMES } from '../../../src/modules/gauge-card/gauges'
import {
  GAUGE_SIZE_BOUNDS,
  GC_VAR_NAMES,
  readGaugeLook,
  type GaugeVars,
} from '../../../src/modules/gauge-card/look'
import { GAUGE_SHAPE_THICKNESS } from '../../../src/modules/gauge-card/options'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULE_DIR = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'gauge-card',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--gc-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--gc-[a-z0-9-]+)\s*:/g

/** 模块目录里的全部样式源：每份 scss，加上组件里的每个 `<style>` 块。 */
function styleSources(): string[] {
  return readdirSync(MODULE_DIR)
    .filter((name) => name.endsWith('.scss') || name.endsWith('.vue'))
    .flatMap((name) => {
      const text = readFileSync(join(MODULE_DIR, name), 'utf8')
      if (name.endsWith('.scss')) return [text]
      return [...text.matchAll(STYLE_BLOCK)].map((match) => match[1] ?? '')
    })
}

function namesMatching(pattern: RegExp): string[] {
  const found = new Set<string>()
  for (const source of styleSources()) {
    for (const match of source.matchAll(pattern)) {
      const name = match[1]
      if (name !== undefined) found.add(name)
    }
  }
  return [...found].sort()
}

/** 样式里真正 `var(--gc-…)` 引用到的变量名。 */
function referencedVars(): string[] {
  return namesMatching(VAR_REFERENCE)
}

/** 样式表自己声明的别名，它们不由 `look.ts` 注入，故不进变量名联合。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

function varsOf(config: Record<string, unknown>): GaugeVars {
  return readGaugeLook(config).vars
}

/**
 * 摊满全部旋钮的两份配置，用来验「联合里没有空转的名字」。
 * ⚠ 必须两份：`--gc-outline` 只有储罐那一档注入，而储罐不吃厚度所以那一档没有
 * `--gc-thickness`——一份配置永远盖不全，硬凑一份会把这条断言写成永远绿的。
 */
function fullConfigs(): Record<string, unknown>[] {
  const common = {
    valueSize: 26,
    valueGlow: 8,
    valueColor: 'var(--accent-secondary)',
    fillColor: 'var(--state-success)',
    trackColor: 'var(--surface-sunken)',
    unitSize: 11,
    labelSize: 14,
    tickSize: 12,
    geometry: { tankWidth: 60, tubeWidth: 16, bulbSize: 30 },
  }
  return [
    { ...common, shape: 'tank' },
    { ...common, shape: 'track' },
  ]
}

describe('尺寸夹回清单声明的范围', () => {
  it('负数与超界都夹回去——负的内边距会让整条声明被浏览器丢掉', () => {
    const nums = readGaugeLook({
      gap: -8,
      padX: 999,
      padY: -1,
      valueSize: 900,
      valueGlow: -3,
      unitSize: 400,
      labelSize: 0,
      tickSize: 99,
    }).nums

    expect(nums).toEqual({
      gap: 0,
      padX: 40,
      padY: 0,
      valueSize: 200,
      valueGlow: 0,
      unitSize: 32,
      labelSize: 8,
      tickSize: 20,
    })
  })

  it('非数与数字字符串一律回落缺省，不把 NaN 摊进 px 串', () => {
    const nums = readGaugeLook({
      gap: Number.NaN,
      padX: '20',
      unitSize: null,
      labelSize: undefined,
      tickSize: 'x',
    }).nums

    expect(nums.gap).toBe(10)
    expect(nums.padX).toBe(10)
    expect(nums.unitSize).toBe(12)
    expect(nums.labelSize).toBe(12)
    expect(nums.tickSize).toBe(10)
  })
})

describe('五档几何各自的缺省', () => {
  it('厚度留空时随形状，储罐与温度计恒零——那两档不吃厚度', () => {
    const byShape = Object.keys(GAUGE_SHAPE_THICKNESS).map((shape) => [
      shape,
      readGaugeLook({ shape, geometry: { thickness: 0 } }).geometry.thickness,
    ])

    expect(Object.fromEntries(byShape)).toEqual(GAUGE_SHAPE_THICKNESS)
  })

  it('配了厚度就夹进区间，负数与非数当作留空', () => {
    expect(
      readGaugeLook({ shape: 'arc', geometry: { thickness: 99 } }).geometry
        .thickness,
    ).toBe(24)
    expect(
      readGaugeLook({ shape: 'linear', geometry: { thickness: -4 } }).geometry
        .thickness,
    ).toBe(12)
    expect(
      readGaugeLook({ shape: 'track', geometry: { thickness: Number.NaN } })
        .geometry.thickness,
    ).toBe(18)
  })

  it('张角夹进区间，非数回落 270 度', () => {
    expect(readGaugeLook({ geometry: { arcSpan: 20 } }).geometry.arcSpan).toBe(
      180,
    )
    expect(readGaugeLook({ geometry: { arcSpan: 999 } }).geometry.arcSpan).toBe(
      300,
    )
    expect(readGaugeLook({ geometry: { arcSpan: 'x' } }).geometry.arcSpan).toBe(
      270,
    )
  })

  it('罐宽、管宽与球径各按自己那条区间夹，缺省逐字取自参考仓', () => {
    const wide = readGaugeLook({
      geometry: { tankWidth: 999, tubeWidth: 0, bulbSize: -1 },
    }).geometry

    expect(wide.tankWidth).toBe(GAUGE_SIZE_BOUNDS.tankWidth.max)
    expect(wide.tubeWidth).toBe(GAUGE_SIZE_BOUNDS.tubeWidth.min)
    expect(wide.bulbSize).toBe(GAUGE_SIZE_BOUNDS.bulbSize.min)
    expect(readGaugeLook({}).geometry).toMatchObject({
      tankWidth: 56,
      tubeWidth: 14,
      bulbSize: 26,
    })
  })

  it('弧的整条 d 跟着厚度与张角走，模板不必自己算', () => {
    const thin = readGaugeLook({ geometry: { thickness: 2 } }).geometry.arcPath
    const thick = readGaugeLook({ geometry: { thickness: 24 } }).geometry
      .arcPath

    expect(thin.startsWith('M ')).toBe(true)
    expect(thin).not.toBe(thick)
  })
})

describe('没配就不注入变量', () => {
  it('三个颜色留空时一个键都不写——注入了就落不回样式表里那档缺省', () => {
    const vars = varsOf({ fillColor: '', trackColor: '', valueColor: '  ' })

    expect(vars['--gc-fill-color']).toBeUndefined()
    expect(vars['--gc-track-color']).toBeUndefined()
    expect(vars['--gc-value-color']).toBeUndefined()
  })

  it('读数字号与辉光取零时不写键，交给样式表里那条自适应', () => {
    const vars = varsOf({ valueSize: 0, valueGlow: 0 })

    expect(vars['--gc-value-size']).toBeUndefined()
    expect(vars['--gc-value-glow']).toBeUndefined()
    expect(varsOf({ valueSize: 30, valueGlow: 6 })['--gc-value-size']).toBe(
      '30px',
    )
  })

  it('不吃厚度的两档不写厚度键，写了零就再也回落不到档位缺省', () => {
    expect(varsOf({ shape: 'tank' })['--gc-thickness']).toBeUndefined()
    expect(varsOf({ shape: 'linear' })['--gc-thickness']).toBe('12px')
  })

  it('居中读数的描边只有储罐那一档注入，这是有意的偏离而不是漏配', () => {
    expect(varsOf({ shape: 'tank' })['--gc-outline']).toContain(
      'var(--surface-sunken)',
    )
    expect(varsOf({ shape: 'arc' })['--gc-outline']).toBeUndefined()
    expect(varsOf({ shape: 'thermometer' })['--gc-outline']).toBeUndefined()
  })

  it('标签层级换的是颜色变量，不是一个类名', () => {
    expect(varsOf({ labelTone: 'title' })['--gc-label-color']).toBe(
      'var(--text-title)',
    )
    expect(varsOf({ labelTone: '不存在' })['--gc-label-color']).toBe(
      'var(--text-secondary)',
    )
  })
})

describe('档位修饰类', () => {
  it('六组档位各挂一个类，认不出的取值回落缺省档', () => {
    const classes = readGaugeLook({
      shape: 'tank',
      fillStyle: 'gradient',
      readoutPlace: 'below',
      unitPlace: 'attached',
      layout: 'grid',
    }).classes

    expect(classes).toEqual([
      'gc--layout-grid',
      'gc--shape-tank',
      'gc--fill-gradient',
      'gc--ind-fill',
      'gc--read-below',
      'gc--unit-attached',
    ])
  })

  it('认不出的档位一律回落，不拼出一个样式表里没有的类', () => {
    expect(readGaugeLook({ shape: 'donut', fillStyle: 3 }).classes).toContain(
      'gc--shape-arc',
    )
    expect(readGaugeLook({ shape: 'donut', fillStyle: 3 }).classes).toContain(
      'gc--fill-solid',
    )
  })
})

describe('auto 排布按仪表个数收敛', () => {
  it('只有一个仪表时铺满，多个走网格', () => {
    expect(readGaugeLook({ layout: 'auto' }, 1).layout).toBe('single')
    expect(readGaugeLook({ layout: 'auto' }, 3).layout).toBe('grid')
  })

  it('显式选了档就不看个数', () => {
    expect(readGaugeLook({ layout: 'grid' }, 1).layout).toBe('grid')
    expect(readGaugeLook({ layout: 'single' }, 9).layout).toBe('single')
  })
})

describe('外层网格', () => {
  it('列数是字符串档：数字 3 判不中白名单，静默回落自适应', () => {
    expect(
      readGaugeLook({ layout: 'grid', columns: '3' }).gridStyle
        .gridTemplateColumns,
    ).toBe('repeat(3, minmax(0, 1fr))')
    expect(
      readGaugeLook({ layout: 'grid', columns: 3 }).gridStyle
        .gridTemplateColumns,
    ).toBe('repeat(auto-fit, minmax(120px, 1fr))')
  })

  it('铺满档不看列数，整块就一列', () => {
    expect(
      readGaugeLook({ layout: 'single', columns: '4' }).gridStyle
        .gridTemplateColumns,
    ).toBe('minmax(0, 1fr)')
  })

  it('仪表间距与整块内边距摊进网格，不另开变量', () => {
    const style = readGaugeLook({
      layout: 'grid',
      gap: 4,
      padX: 8,
      padY: 2,
    }).gridStyle

    expect(style.gap).toBe('4px')
    expect(style.padding).toBe('2px 8px')
    expect(style.gridAutoRows).toBe('minmax(0, 1fr)')
  })
})

describe('变量名与样式表双向吻合', () => {
  it('扫描本身没有空转——样式源都扫到了，也真扫出了变量', () => {
    expect(styleSources().length).toBeGreaterThan(0)
    expect(referencedVars().length).toBeGreaterThan(0)
  })

  it('声明的每个变量名都在样式表里被引用过', () => {
    const referenced = new Set(referencedVars())
    const declared = [...GC_VAR_NAMES, ...GC_ITEM_VAR_NAMES]

    expect(declared.filter((name) => !referenced.has(name))).toEqual([])
  })

  it('样式表里引用的每个变量名要么由取值层注入，要么就在这份样式表里声明过', () => {
    const known = new Set<string>([
      ...GC_VAR_NAMES,
      ...GC_ITEM_VAR_NAMES,
      ...localVars(),
    ])

    expect(referencedVars().filter((name) => !known.has(name))).toEqual([])
  })

  it('样式表里的别名真的只有那两个，别名不许悄悄替掉注入的变量', () => {
    expect(localVars()).toEqual(['--gc-read-color', '--gc-tone'])
  })

  it('块级变量真的全都摊在 vars 里，没有只声明不注入的', () => {
    const injected = new Set(
      fullConfigs().flatMap((config) => Object.keys(varsOf(config))),
    )

    expect(GC_VAR_NAMES.filter((name) => !injected.has(name))).toEqual([])
  })
})

describe('读数辉光对回参考仓', () => {
  it('辉光色压到读数色的一半，不是整条 currentcolor', () => {
    const glow = styleSources()
      .join('\n')
      .match(/0 0 var\(--gc-value-glow[^,]*,[^;]*/)

    expect(glow?.[0]).toContain('color-mix(in srgb, currentcolor 50%')
  })
})
