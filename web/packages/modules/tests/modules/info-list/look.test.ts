/**
 * @fileoverview 守 info-list 的外观模型：数值夹回清单范围、「没配就不注入变量」、
 * 表头与数据行共用同一份列模板，以及变量名联合与模块全部样式源里的引用集合双向吻合。
 * ⚠ 变量名拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到 `packages/modules/src`，
 * 这条双向断言是这套变量唯一的守卫。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  IL_VAR_NAMES,
  readListLook,
  type ListVars,
} from '../../../src/modules/info-list/look'
import { IL_BADGE_VAR_NAMES } from '../../../src/modules/info-list/rowAlarm'
import { IL_ROW_VAR_NAMES } from '../../../src/modules/info-list/rows'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULE_DIR = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'info-list',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--il-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--il-[a-z0-9-]+)\s*:/g

/**
 * 模块目录里的全部样式源：两份 scss，加上组件里的每个 `<style>` 块。
 * ⚠ 只扫一份 scss 会让另一份里的拼写错误无人看着——变量分散在四个文件里。
 */
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

/** 样式里真正 `var(--il-…)` 引用到的变量名。 */
function referencedVars(): string[] {
  return namesMatching(VAR_REFERENCE)
}

/** 样式表自己声明的别名，它们不由 `look.ts` 注入，故不进变量名联合。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

function varsOf(config: Record<string, unknown>): ListVars {
  return readListLook(config).vars
}

describe('尺寸夹回清单声明的范围', () => {
  it('负数与超界都夹回去——负的内边距会让整条声明被浏览器丢掉', () => {
    const nums = readListLook({
      spacing: { padX: -8, padY: 999 },
      labelSize: 0,
      valueSize: 500,
      unitSize: 400,
      valueGlow: -3,
      meter: { height: 0, width: -20, glow: 99 },
    }).nums

    expect(nums.padX).toBe(0)
    expect(nums.padY).toBe(40)
    expect(nums.labelSize).toBe(8)
    expect(nums.valueSize).toBe(48)
    expect(nums.unitSize).toBe(32)
    expect(nums.valueGlow).toBe(0)
    expect(nums.meterHeight).toBe(1)
    expect(nums.meterWidth).toBe(0)
    expect(nums.meterGlow).toBe(24)
  })

  it('非数与带引号的数字都落回缺省——尺寸不吃字符串', () => {
    const nums = readListLook({
      labelSize: '20',
      valueSize: Number.NaN,
      spacing: 'nope',
    }).nums

    expect(nums.labelSize).toBe(13)
    expect(nums.valueSize).toBe(16)
    expect(nums.padX).toBe(6)
    expect(nums.rowPadY).toBe(6)
  })

  it('一个键都没配时给的是一整套缺省', () => {
    const nums = readListLook({}).nums

    expect(nums).toEqual({
      padX: 6,
      padY: 4,
      rowPadX: 4,
      rowPadY: 6,
      labelSize: 13,
      valueSize: 16,
      valueGlow: 0,
      unitSize: 11,
      meterHeight: 4,
      meterWidth: 0,
      meterGlow: 6,
    })
  })
})

describe('没配就不注入变量', () => {
  it('读数颜色留空时不写键，样式表才回落得到档位缺省', () => {
    expect(varsOf({})).not.toHaveProperty('--il-value-color')
    expect(varsOf({ valueColor: '   ' })).not.toHaveProperty('--il-value-color')
    expect(varsOf({ valueColor: 'var(--accent-primary)' })).toHaveProperty(
      '--il-value-color',
      'var(--accent-primary)',
    )
  })

  it('辉光为 0 时不写键', () => {
    expect(varsOf({ valueGlow: 0 })).not.toHaveProperty('--il-value-glow')
    expect(varsOf({ valueGlow: 10 })).toHaveProperty('--il-value-glow', '10px')
  })

  it('进度条颜色与辉光同一条口径', () => {
    expect(varsOf({ meter: { color: '', glow: 0 } })).not.toHaveProperty(
      '--dt-meter-color',
    )
    expect(varsOf({ meter: { color: '', glow: 0 } })).not.toHaveProperty(
      '--dt-meter-glow',
    )
    const filled = varsOf({ meter: { color: 'var(--state-info)', glow: 8 } })
    expect(filled['--dt-meter-color']).toBe('var(--state-info)')
    expect(filled['--dt-meter-glow']).toBe('8px')
  })

  it('尺寸类变量一律注入，缺省也算一次显式选择', () => {
    const vars = varsOf({})

    expect(vars['--il-pad-x']).toBe('6px')
    expect(vars['--il-row-py']).toBe('6px')
    expect(vars['--il-value-size']).toBe('16px')
    expect(vars['--il-unit-size']).toBe('11px')
    expect(vars['--dt-meter-h']).toBe('4px')
  })

  it('进度条宽度 0 = 铺满，非 0 才给定宽', () => {
    expect(varsOf({ meter: { width: 0 } })['--dt-meter-w']).toBe('100%')
    expect(varsOf({ meter: { width: 128 } })['--dt-meter-w']).toBe('128px')
  })
})

describe('行名的文字层级', () => {
  it('四档各自映到一个主题变量，认不出的落回次要', () => {
    expect(varsOf({ labelTone: 'title' })['--il-label-color']).toBe(
      'var(--text-title)',
    )
    expect(varsOf({ labelTone: 'primary' })['--il-label-color']).toBe(
      'var(--text-primary)',
    )
    expect(varsOf({ labelTone: 'muted' })['--il-label-color']).toBe(
      'var(--text-disabled)',
    )
    expect(varsOf({ labelTone: 'nope' })['--il-label-color']).toBe(
      'var(--text-secondary)',
    )
  })
})

describe('三列档的列模板', () => {
  it('单位列的上界跟着单位字号走，只此一份字符串', () => {
    expect(varsOf({ unitSize: 11 })['--il-cols-tpl']).toBe(
      'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 88px)',
    )
    expect(varsOf({ unitSize: 16 })['--il-cols-tpl']).toBe(
      'minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 128px)',
    )
  })

  it('表头只在三列档才谈得上，段位编排档下一律不画', () => {
    const stacked = readListLook({
      rowLayout: 'stack',
      columnHeader: { show: true },
    })
    const columns = readListLook({
      rowLayout: 'columns',
      columnHeader: { show: true },
    })

    expect(stacked.header.show).toBe(false)
    expect(columns.header.show).toBe(true)
  })

  it('表头文案空白回落缺省，不留一条只有分隔线的空表头', () => {
    const header = readListLook({
      rowLayout: 'columns',
      columnHeader: { show: true, name: '  ', value: '当日', unit: '' },
    }).header

    expect(header.name).toBe('名称')
    expect(header.value).toBe('当日')
    expect(header.unit).toBe('单位')
  })
})

describe('一档一个修饰类', () => {
  it('八组档位各出一个类名，缺省也出', () => {
    expect(readListLook({}).classes).toEqual([
      'il--layout-stack',
      'il--shell-divider',
      'il--divider-dotted',
      'il--hover-none',
      'il--unit-attached',
      'il--badge-outline',
      'il--group-none',
    ])
  })

  it('配过的档位逐个落到类名上', () => {
    const classes = readListLook({
      rowLayout: 'columns',
      rowShell: 'accent',
      dividerStyle: 'dashed',
      hover: 'lift',
      unitPlace: 'column',
      badge: { style: 'solid' },
      grouping: 'tabs',
      meter: { dot: true },
    }).classes

    expect(classes).toEqual([
      'il--layout-columns',
      'il--shell-accent',
      'il--divider-dashed',
      'il--hover-lift',
      'il--unit-column',
      'il--badge-solid',
      'il--group-tabs',
      'il--meter-dot',
    ])
  })

  it('认不出的档位一律回落，不留一个没有样式的类名', () => {
    expect(
      readListLook({ rowShell: 'ghost', hover: 'spin' }).classes,
    ).toContain('il--shell-divider')
    expect(
      readListLook({ rowShell: 'ghost', hover: 'spin' }).classes,
    ).toContain('il--hover-none')
  })
})

describe('行的声明式编排', () => {
  it('最多三段，多出来的整段不要', () => {
    const lines = readListLook({
      rowLines: [
        { left: 'label' },
        { left: 'value' },
        { left: 'sub' },
        { left: 'time' },
      ],
    }).lines

    expect(lines).toHaveLength(3)
    expect(lines.map((line) => line.left)).toEqual(['label', 'value', 'sub'])
  })

  it('四件全空的段不渲染——留着它就是一条撑高行高的空白', () => {
    const lines = readListLook({
      rowLines: [{ left: 'label' }, {}, { right: 'value' }],
    }).lines

    expect(lines).toHaveLength(2)
    expect(lines[1]?.right).toBe('value')
  })

  it('段的键带上位次与件名，两段同款也不撞', () => {
    const lines = readListLook({
      rowLines: [{ left: 'label' }, { left: 'label' }],
    }).lines

    expect(new Set(lines.map((line) => line.key)).size).toBe(2)
  })

  it('认不出的件落成空，不会把整段吃掉', () => {
    const lines = readListLook({
      rowLines: [{ left: 'label', right: 'sparkline' }],
    }).lines

    expect(lines[0]?.left).toBe('label')
    expect(lines[0]?.right).toBe('none')
  })

  it('没配段位时一段都不画', () => {
    expect(readListLook({}).lines).toEqual([])
    expect(readListLook({ rowLines: 'nope' }).lines).toEqual([])
  })

  it('前导列与两个尾列只收各自那张表里的件', () => {
    const shape = readListLook({
      rowShape: { lead: 'badge', tail: 'value', tail2: 'time', extras: true },
    }).shape

    expect(shape).toEqual({
      lead: 'badge',
      tail: 'value',
      tail2: 'time',
      extras: true,
    })
    expect(
      readListLook({ rowShape: { lead: 'desc', tail: 'meter' } }).shape,
    ).toEqual({ lead: 'none', tail: 'none', tail2: 'none', extras: false })
  })
})

describe('进度件与徽章那两簇', () => {
  it('百分比读数缺省是开着的，两条各自选源与小字', () => {
    const meter = readListLook({
      meter: {
        kind: 'bar',
        source: 'share',
        label: '占比',
        source2: 'aux2',
        label2: '液位',
        dot: true,
      },
    }).meter

    expect(meter.kind).toBe('bar')
    expect(meter.source).toBe('share')
    expect(meter.label).toBe('占比')
    expect(meter.source2).toBe('aux2')
    expect(meter.label2).toBe('液位')
    expect(meter.dot).toBe(true)
    expect(meter.showPercent).toBe(true)
  })

  it('一个键都没配时两条都不画', () => {
    const meter = readListLook({}).meter

    expect(meter.kind).toBe('none')
    expect(meter.source).toBe('range')
    expect(meter.source2).toBe('none')
  })

  it('徽章的种类与样式各自回落', () => {
    expect(readListLook({ badge: { kind: 'device' } }).badge).toEqual({
      kind: 'device',
      style: 'outline',
    })
    expect(readListLook({}).badge).toEqual({ kind: 'none', style: 'outline' })
  })

  it('分组档原样带出来，取值层要按它分段', () => {
    expect(readListLook({ grouping: 'section' }).grouping).toBe('section')
    expect(readListLook({ grouping: 'nope' }).grouping).toBe('none')
  })
})

describe('变量名与样式表双向吻合', () => {
  it('扫描本身没有空转——四份样式源都扫到了，也真扫出了变量', () => {
    expect(styleSources().length).toBeGreaterThan(3)
    expect(referencedVars().length).toBeGreaterThan(0)
  })

  it('声明的每个变量名都在样式表里被引用过', () => {
    const referenced = new Set(referencedVars())
    const declared = [
      ...IL_VAR_NAMES,
      ...IL_ROW_VAR_NAMES,
      ...IL_BADGE_VAR_NAMES,
    ]

    expect(declared.filter((name) => !referenced.has(name))).toEqual([])
  })

  it('样式表里引用的每个变量名要么由 look 注入，要么就在这份样式表里声明过', () => {
    const known = new Set<string>([
      ...IL_VAR_NAMES,
      ...IL_ROW_VAR_NAMES,
      ...IL_BADGE_VAR_NAMES,
      ...localVars(),
    ])

    expect(referencedVars().filter((name) => !known.has(name))).toEqual([])
  })

  it('样式表里的别名真的只有那两个，别名不许悄悄替掉注入的变量', () => {
    expect(localVars()).toEqual(['--il-line-style'])
  })

  it('块级变量真的全都摊在 vars 里，没有只声明不注入的', () => {
    const vars = varsOf({
      valueColor: 'var(--accent-primary)',
      valueGlow: 8,
      meter: { color: 'var(--state-info)', glow: 6 },
    })

    expect(IL_VAR_NAMES.filter((name) => vars[name] === undefined)).toEqual([])
  })
})
