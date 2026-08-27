/**
 * @fileoverview 守 info-feed 的外观模型：七个尺寸旋钮夹回清单范围、七个变量一个不缺地注入、
 * 两组档位各挂一个修饰类，以及变量名联合与模块全部样式源里的引用集合双向吻合。
 * ⚠ 变量名拼错既不报错也不生效——`css-variables.contract.spec.ts` 扫不到
 * `packages/modules/src`，这条双向断言是这套变量唯一的守卫。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { IF_ROW_VAR_NAMES } from '../../../src/modules/info-feed/feed'
import {
  FEED_SIZE_BOUNDS,
  IF_VAR_NAMES,
  readFeedLook,
  type FeedVars,
} from '../../../src/modules/info-feed/look'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULE_DIR = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'info-feed',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--if-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--if-[a-z0-9-]+)\s*:/g

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

/** 样式里真正 `var(--if-…)` 引用到的变量名。 */
function referencedVars(): string[] {
  return namesMatching(VAR_REFERENCE)
}

/** 样式表自己声明的别名，它们不由 `look.ts` 注入，故不进变量名联合。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

function varsOf(config: Record<string, unknown>): FeedVars {
  return readFeedLook(config).vars
}

describe('尺寸夹回清单声明的范围', () => {
  it('负数与超界都夹回去——负的内边距会让整条声明被浏览器丢掉', () => {
    const nums = readFeedLook({
      dotSize: -3,
      dotGlow: 999,
      levelSize: 0,
      timeSize: 400,
      textSize: 2,
      rowPadX: -1,
      rowPadY: 99,
    }).nums

    expect(nums).toEqual({
      dotSize: 4,
      dotGlow: 24,
      levelSize: 10,
      timeSize: 32,
      textSize: 10,
      rowPadX: 0,
      rowPadY: 24,
    })
  })

  it('非数与数字字符串一律回落缺省，不把 NaN 摊进 px 串', () => {
    const nums = readFeedLook({
      dotSize: Number.NaN,
      dotGlow: '12',
      levelSize: null,
      timeSize: undefined,
      textSize: 'x',
      rowPadX: {},
      rowPadY: Number.POSITIVE_INFINITY,
    }).nums

    expect(nums).toEqual({
      dotSize: 8,
      dotGlow: 6,
      levelSize: 12,
      timeSize: 12,
      textSize: 13,
      rowPadX: 4,
      rowPadY: 7,
    })
  })

  it('小数取整——半个像素的圆点在两条相邻行上会画成两种大小', () => {
    expect(readFeedLook({ dotSize: 8.6, rowPadY: 6.2 }).nums).toMatchObject({
      dotSize: 9,
      rowPadY: 6,
    })
  })

  it('区间表与清单那七个字段逐字相同，缺省对回参考源码', () => {
    expect(FEED_SIZE_BOUNDS).toEqual({
      dotSize: { min: 4, max: 24, fallback: 8 },
      dotGlow: { min: 0, max: 24, fallback: 6 },
      levelSize: { min: 10, max: 32, fallback: 12 },
      timeSize: { min: 10, max: 32, fallback: 12 },
      textSize: { min: 10, max: 32, fallback: 13 },
      rowPadX: { min: 0, max: 24, fallback: 4 },
      rowPadY: { min: 0, max: 24, fallback: 7 },
    })
  })
})

describe('七个变量一个不缺地注入', () => {
  it('空配置也摊出全部七个键，值就是字段缺省', () => {
    expect(varsOf({})).toEqual({
      '--if-dot-size': '8px',
      '--if-dot-glow': '6px',
      '--if-level-size': '12px',
      '--if-time-size': '12px',
      '--if-text-size': '13px',
      '--if-row-px': '4px',
      '--if-row-py': '7px',
    })
  })

  it('辉光取零照样注入——少注入这一个，样式表里那句兜底会把关掉的辉光又打开', () => {
    expect(varsOf({ dotGlow: 0 })['--if-dot-glow']).toBe('0px')
    expect(varsOf({ rowPadX: 0, rowPadY: 0 })).toMatchObject({
      '--if-row-px': '0px',
      '--if-row-py': '0px',
    })
  })

  it('配了就跟着走，px 单位由取值层拼好，模板不做拼接', () => {
    expect(varsOf({ dotSize: 14, textSize: 20 })).toMatchObject({
      '--if-dot-size': '14px',
      '--if-text-size': '20px',
    })
  })
})

describe('档位修饰类', () => {
  it('两组档位各挂一个类，档位名不进模板', () => {
    expect(
      readFeedLook({ rowBorderStyle: 'solid', timePlace: 'left' }).classes,
    ).toEqual(['if--border-solid', 'if--time-left'])
  })

  it('认不出的取值回落缺省档，不拼出一个样式表里没有的类', () => {
    const look = readFeedLook({ rowBorderStyle: 'ridge', timePlace: 3 })

    expect(look.classes).toEqual(['if--border-dotted', 'if--time-right'])
    expect(look.borderStyle).toBe('dotted')
    expect(look.timePlace).toBe('right')
  })

  it('每一档分隔线都拼得出一个类，四档都在样式表里有落点', () => {
    const styles = ['dotted', 'dashed', 'solid', 'none']
    const rules = styleSources().join('\n')

    for (const style of styles) {
      expect([style, rules.includes(`.if--border-${style}`)]).toEqual([
        style,
        true,
      ])
    }
  })
})

describe('三个开关', () => {
  it('三个开关缺省全开，圆点与级别文字是同一件事的两种编码', () => {
    expect(readFeedLook({}).show).toEqual({
      dot: true,
      level: true,
      time: true,
    })
  })

  it('显式关掉才关，非布尔的脏值一律回落到开着的那一侧', () => {
    expect(
      readFeedLook({ showDot: false, showLevel: false, showTime: false }).show,
    ).toEqual({ dot: false, level: false, time: false })
    expect(readFeedLook({ showDot: 0, showTime: 'false' }).show).toMatchObject({
      dot: true,
      time: true,
    })
  })
})

describe('变量名与样式表双向吻合', () => {
  it('扫描本身没有空转——样式源都扫到了，也真扫出了变量', () => {
    expect(styleSources().length).toBeGreaterThan(0)
    expect(referencedVars().length).toBeGreaterThan(0)
  })

  it('声明的每个变量名都在样式表里被引用过', () => {
    const referenced = new Set(referencedVars())
    const declared = [...IF_VAR_NAMES, ...IF_ROW_VAR_NAMES]

    expect(declared.filter((name) => !referenced.has(name))).toEqual([])
  })

  it('样式表里引用的每个变量名要么由取值层注入，要么就在这份样式表里声明过', () => {
    const known = new Set<string>([
      ...IF_VAR_NAMES,
      ...IF_ROW_VAR_NAMES,
      ...localVars(),
    ])

    expect(referencedVars().filter((name) => !known.has(name))).toEqual([])
  })

  it('样式表里的别名真的只有那两个，别名不许悄悄替掉注入的变量', () => {
    expect(localVars()).toEqual(['--if-line-style', '--if-tone'])
  })

  it('块级变量真的全都摊在 vars 里，没有只声明不注入的', () => {
    const injected = new Set(Object.keys(varsOf({})))

    expect(IF_VAR_NAMES.filter((name) => !injected.has(name))).toEqual([])
  })
})

describe('级别色的落点对回参考源码', () => {
  it('未识别级别落回中性次要文字色，不伪装成某一档状态', () => {
    const tone = styleSources()
      .join('\n')
      .match(/--if-tone:[^;]*/)

    expect(tone?.[0]).toContain('var(--if-level-color, var(--text-secondary))')
  })

  it('圆点的外发光与圆点同色，辉光取零即等价于纯色点', () => {
    const glow = styleSources()
      .join('\n')
      .match(/box-shadow: 0 0 var\(--if-dot-glow[^;]*/)

    expect(glow?.[0]).toContain('var(--if-tone)')
  })

  it('时刻挪到正文之前那一档换的是正文的次序，圆点与级别仍钉在行首', () => {
    const rule = styleSources()
      .join('\n')
      .match(/\.if-row\.if--time-left[^}]*}/)

    expect(rule?.[0]).toContain('.if-text')
    expect(rule?.[0]).toContain('order: 1')
  })
})
