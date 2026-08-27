/**
 * @fileoverview 守 info-card 的外观模型：数值夹回清单范围、「没配就不注入变量」、
 * `auto` 排布按格数收敛、外层网格的列模板，以及变量名联合与模块全部样式源里的引用集合
 * 双向吻合。
 * ⚠ 变量名拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`，这条双向断言是这套变量唯一的守卫。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { IC_CELL_VAR_NAMES } from '../../../src/modules/info-card/cells'
import {
  CARD_VALUE_STOPS,
  IC_VAR_NAMES,
  readCardLook,
  type CardVars,
} from '../../../src/modules/info-card/look'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULE_DIR = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'info-card',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--ic-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--ic-[a-z0-9-]+)\s*:/g

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

/** 样式里真正 `var(--ic-…)` 引用到的变量名。 */
function referencedVars(): string[] {
  return namesMatching(VAR_REFERENCE)
}

/** 样式表自己声明的别名，它们不由 `look.ts` 注入，故不进变量名联合。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

function varsOf(config: Record<string, unknown>): CardVars {
  return readCardLook(config).vars
}

/** 摊满全部旋钮的一份配置：每个变量都得注入，用来验「联合里没有空转的名字」。 */
function fullConfig(): Record<string, unknown> {
  return {
    valueSize: 26,
    valueGlow: 8,
    valueFill: 'gradient',
    valueColor: 'var(--accent-secondary)',
    unit: { place: 'attached', size: 11, tone: 'muted', opacity: 0.5 },
    icon: { mode: 'badge', shape: 'rounded', glow: 6 },
  }
}

describe('尺寸夹回清单声明的范围', () => {
  it('负数与超界都夹回去——负的内边距会让整条声明被浏览器丢掉', () => {
    const nums = readCardLook({
      gapX: -8,
      gapY: 999,
      padX: -1,
      padY: 999,
      cellPadX: -4,
      cellPadY: 999,
      labelSize: 0,
      labelOpacity: 0,
      valueSize: 900,
      valueGlow: -3,
      unit: { size: 400, opacity: 9 },
      icon: { size: 4, glow: 99, fontSize: 0, gap: 99, opacity: 0 },
    }).nums

    expect(nums).toEqual({
      gapX: 0,
      gapY: 40,
      padX: 0,
      padY: 40,
      cellPadX: 0,
      cellPadY: 40,
      labelSize: 8,
      labelOpacity: 0.2,
      valueSize: 200,
      valueGlow: 0,
      unitSize: 32,
      unitOpacity: 1,
      iconSize: 16,
      iconGlow: 24,
      iconFont: 8,
      iconGap: 40,
      iconOpacity: 0.2,
    })
  })

  it('一个键都没有时的缺省与清单逐项对齐', () => {
    expect(readCardLook({}).nums).toEqual({
      gapX: 10,
      gapY: 10,
      padX: 10,
      padY: 6,
      cellPadX: 12,
      cellPadY: 8,
      labelSize: 12,
      labelOpacity: 1,
      valueSize: 0,
      valueGlow: 0,
      unitSize: 12,
      unitOpacity: 1,
      iconSize: 20,
      iconGlow: 8,
      iconFont: 18,
      iconGap: 10,
      iconOpacity: 1,
    })
  })
})

describe('没配 = 不写键', () => {
  it('数值字号的哨兵 0 不注入变量，样式表那条 clamp 才接得上', () => {
    expect(varsOf({ valueSize: 0 })['--ic-value-size']).toBeUndefined()
    expect(varsOf({ valueSize: 26 })['--ic-value-size']).toBe('26px')
  })

  it('辉光半径 0 不注入', () => {
    expect(varsOf({ valueGlow: 0 })['--ic-value-glow']).toBeUndefined()
    expect(varsOf({ valueGlow: 12 })['--ic-value-glow']).toBe('12px')
  })

  it('纯色档不拼渐变串', () => {
    expect(
      varsOf({ valueFill: 'solid' })['--ic-value-gradient'],
    ).toBeUndefined()
    expect(varsOf({ valueFill: 'gradient' })['--ic-value-gradient']).toContain(
      'linear-gradient(',
    )
  })

  it('不画图标那一档一个图标变量都不注入', () => {
    const vars = varsOf({ icon: { mode: 'none', size: 40 } })

    expect(vars['--ic-icon-size']).toBeUndefined()
    expect(vars['--ic-icon-bg']).toBeUndefined()
  })

  it('单位「跟随数值色」那一档不注入颜色变量，改由格上的类接手', () => {
    const accent = readCardLook({ unit: { tone: 'accent' } })
    const muted = readCardLook({ unit: { tone: 'muted' } })

    expect(accent.vars['--ic-unit-color']).toBeUndefined()
    expect(accent.classes).toContain('ic--unit-tone-accent')
    expect(muted.vars['--ic-unit-color']).toBe('var(--text-disabled)')
    expect(muted.classes).not.toContain('ic--unit-tone-accent')
  })

  it('数值纯色留空时回落主题强调色，不留一个空串', () => {
    expect(varsOf({})['--ic-value-color']).toBe('var(--accent-primary)')
    expect(
      varsOf({ valueColor: ' var(--state-info) ' })['--ic-value-color'],
    ).toBe('var(--state-info)')
  })

  it('标签层级四档各对一个主题变量', () => {
    expect(varsOf({ labelTone: 'title' })['--ic-label-color']).toBe(
      'var(--text-title)',
    )
    expect(varsOf({ labelTone: 'nope' })['--ic-label-color']).toBe(
      'var(--text-secondary)',
    )
  })
})

describe('渐变串', () => {
  it('少于两个有效色标时整份回落主题色标——单色渐变是非法值', () => {
    const one = varsOf({
      valueFill: 'gradient',
      valueGradient: [{ color: 'var(--x)' }],
    })

    expect(one['--ic-value-gradient']).toBe(
      `linear-gradient(0deg, ${CARD_VALUE_STOPS.join(', ')})`,
    )
  })

  it('两个以上色标按声明序拼进去，空色标不算数', () => {
    const vars = varsOf({
      valueFill: 'gradient',
      valueGradient: [
        { color: 'var(--a)' },
        { color: '  ' },
        { color: 'var(--b)' },
      ],
    })

    expect(vars['--ic-value-gradient']).toBe(
      'linear-gradient(0deg, var(--a), var(--b))',
    )
  })

  it('角度归一到 [0,360)：负数与越界都会让整条声明被丢掉', () => {
    const negative = varsOf({ valueFill: 'gradient', gradientAngle: -90 })
    const over = varsOf({ valueFill: 'gradient', gradientAngle: 450 })

    expect(negative['--ic-value-gradient']).toContain('linear-gradient(270deg,')
    expect(over['--ic-value-gradient']).toContain('linear-gradient(90deg,')
  })
})

describe('图标容器', () => {
  it('底色起止留空时按强调色调出两档，角度缺省 135', () => {
    const bg = varsOf({ icon: { mode: 'badge' } })['--ic-icon-bg']

    expect(bg).toContain('linear-gradient(135deg,')
    expect(bg).toContain('color-mix(in srgb, var(--accent-primary) 26%')
  })

  it('填了起止色就用填的那两支', () => {
    const bg = varsOf({
      icon: {
        mode: 'badge',
        bgFrom: 'var(--a)',
        bgTo: 'var(--b)',
        bgAngle: 20,
      },
    })['--ic-icon-bg']

    expect(bg).toBe('linear-gradient(20deg, var(--a), var(--b))')
  })

  it('三种形状各对一个圆角', () => {
    const radius = (shape: string): string | undefined =>
      varsOf({ icon: { mode: 'badge', shape } })['--ic-icon-radius']

    expect(radius('circle')).toBe('50%')
    expect(radius('rounded')).toBe('var(--radius-md)')
    expect(radius('square')).toBe('0')
  })

  it('外发光摊成一整条投影串，半径 0 也仍是合法值', () => {
    expect(varsOf({ icon: { mode: 'badge', glow: 0 } })['--ic-icon-glow']).toBe(
      '0 0 0px color-mix(in srgb, var(--accent-primary) 45%, transparent)',
    )
  })
})

describe('档位修饰类', () => {
  it('八档各出一个类，认不出的取值一律回落缺省档', () => {
    expect(readCardLook({ cellShell: 'nope', hover: 'nope' }).classes).toEqual([
      'ic--layout-single',
      'ic--shell-plain',
      'ic--hover-none',
      'ic--align-center',
      'ic--icon-none',
      'ic--icon-at-left',
      'ic--unit-baseline',
      'ic--font-digit',
    ])
  })

  it('每一档都真的换类名', () => {
    const classes = readCardLook({
      cellShell: 'accent',
      hover: 'lift',
      align: 'right',
      icon: { mode: 'badge', position: 'top' },
      unit: { place: 'attached' },
      valueFont: 'body',
    }).classes

    expect(classes).toEqual([
      'ic--layout-single',
      'ic--shell-accent',
      'ic--hover-lift',
      'ic--align-right',
      'ic--icon-badge',
      'ic--icon-at-top',
      'ic--unit-attached',
      'ic--font-body',
    ])
  })

  it('标签位置**不**进这一份：它只有在标签真渲染时才准挂', () => {
    const look = readCardLook({ labelPlace: 'left' })

    expect(look.labelPlace).toBe('left')
    expect(look.classes.join(' ')).not.toContain('label')
  })

  it('图标那一簇的两档原样带给格，形状与配色已经摊进变量了', () => {
    expect(
      readCardLook({ icon: { mode: 'corner', position: 'top' } }).icon,
    ).toEqual({
      mode: 'corner',
      position: 'top',
    })
  })
})

describe('auto 排布按格数收敛', () => {
  it('只有一格时是大字居中，多格时是网格', () => {
    expect(readCardLook({}, 1).layout).toBe('single')
    expect(readCardLook({}, 3).layout).toBe('grid')
  })

  it('一格都没有时也是大字居中，不摆一张空网格', () => {
    expect(readCardLook({}).layout).toBe('single')
  })

  it('显式选了档就不看格数', () => {
    expect(readCardLook({ layout: 'grid' }, 1).layout).toBe('grid')
    expect(readCardLook({ layout: 'single' }, 5).layout).toBe('single')
  })
})

describe('外层网格', () => {
  it('自动列按最小列宽铺满，行等高——不给行高时项数少会堆在顶上', () => {
    expect(readCardLook({ layout: 'grid' }).gridStyle).toEqual({
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gridAutoRows: 'minmax(0, 1fr)',
      gap: '10px 10px',
      padding: '6px 10px',
    })
  })

  it('指定列数就等分几列，档值是字符串', () => {
    expect(
      readCardLook({ layout: 'grid', columns: '3' }).gridStyle
        .gridTemplateColumns,
    ).toBe('repeat(3, minmax(0, 1fr))')
  })

  it('档值写成数字判不中白名单，静默回落自动', () => {
    expect(
      readCardLook({ layout: 'grid', columns: 3 }).gridStyle
        .gridTemplateColumns,
    ).toBe('repeat(auto-fit, minmax(120px, 1fr))')
  })

  it('单格大字档不看列数，整块就一列', () => {
    expect(
      readCardLook({ layout: 'single', columns: '4' }).gridStyle
        .gridTemplateColumns,
    ).toBe('minmax(0, 1fr)')
  })

  it('格间距与整块内边距按「纵 横」摊进网格，不另开变量', () => {
    const style = readCardLook({
      layout: 'grid',
      gapX: 4,
      gapY: 12,
      padX: 8,
      padY: 2,
    }).gridStyle

    expect(style.gap).toBe('12px 4px')
    expect(style.padding).toBe('2px 8px')
  })
})

describe('变量名与样式表双向吻合', () => {
  it('扫描本身没有空转——样式源都扫到了，也真扫出了变量', () => {
    expect(styleSources().length).toBeGreaterThan(0)
    expect(referencedVars().length).toBeGreaterThan(0)
  })

  it('声明的每个变量名都在样式表里被引用过', () => {
    const referenced = new Set(referencedVars())
    const declared = [...IC_VAR_NAMES, ...IC_CELL_VAR_NAMES]

    expect(declared.filter((name) => !referenced.has(name))).toEqual([])
  })

  it('样式表里引用的每个变量名要么由取值层注入，要么就在这份样式表里声明过', () => {
    const known = new Set<string>([
      ...IC_VAR_NAMES,
      ...IC_CELL_VAR_NAMES,
      ...localVars(),
    ])

    expect(referencedVars().filter((name) => !known.has(name))).toEqual([])
  })

  it('样式表里的别名真的只有那两个，别名不许悄悄替掉注入的变量', () => {
    expect(localVars()).toEqual(['--ic-main', '--ic-tone'])
  })

  it('块级变量真的全都摊在 vars 里，没有只声明不注入的', () => {
    const vars = varsOf(fullConfig())

    expect(IC_VAR_NAMES.filter((name) => vars[name] === undefined)).toEqual([])
  })
})

describe('读数辉光对回参考仓', () => {
  it('辉光色压到数值色的一半，不是整条 currentcolor', () => {
    // .kpi-num 是 color-mix(… var(--kpi-accent) 50% …)，.kpi-cell__value 是 55%：
    // 直接用 currentcolor 会得到一倍强的光晕
    const glow = styleSources()
      .join('\n')
      .match(/text-shadow:\s*0 0 var\(--ic-value-glow[^;]*/)

    expect(glow?.[0]).toContain('color-mix(in srgb, currentcolor 50%')
  })
})
