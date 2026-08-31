/**
 * @fileoverview 守 nav-tabs 的外观模型：脏值夹回清单声明的范围、两个哨兵、
 * 「没配就不注入变量」、语义色只取主题变量、默认选中夹在真实格数之内，
 * 以及变量名联合与模块全部样式源里的引用集合双向吻合。
 * ⚠ 变量名拼错既不报错也不生效——`css-var-names.contract.spec.ts` 扫得到本包，
 * 但它只查「名字有没有人写过」；这一条守的是「注入的与用到的是同一批」。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  TABS_VAR_NAMES,
  readTabsSpec,
  type TabsVars,
} from '../../../src/modules/nav-tabs/look'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const MODULE_DIR = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'nav-tabs',
)

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/g
const VAR_REFERENCE = /var\(\s*(--tab-[a-z0-9-]+)/g
const VAR_DECLARATION = /(--tab-[a-z0-9-]+)\s*:/g

/** 模块目录里的全部样式源：那份 scss，加上组件里的每个 `<style>` 块。 */
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

/** 样式里真正 `var(--tab-…)` 引用到的变量名。 */
function referencedVars(): string[] {
  return namesMatching(VAR_REFERENCE)
}

/** 样式表自己声明的 `--tab-…`；本模块的变量全由 look 注入，这里应当是空的。 */
function localVars(): string[] {
  return namesMatching(VAR_DECLARATION)
}

function varsOf(config: Record<string, unknown>): TabsVars {
  return readTabsSpec(config).vars
}

function classesOf(config: Record<string, unknown>): string[] {
  return readTabsSpec(config).classes
}

const THREE_TABS = [
  { label: '总览', emitValue: 'overview' },
  { label: '能耗', emitValue: 'energy' },
  { label: '设备', emitValue: 'device' },
]

describe('页签的读取', () => {
  it('一行配置读成一格：文案、图标、联动值与禁用各归各的', () => {
    const [first] = readTabsSpec({
      items: [
        { label: ' 总览 ', emitValue: ' overview ', icon: 'gauge' },
        { label: '能耗', disabled: true },
      ],
    }).items

    expect(first).toMatchObject({
      label: ' 总览 ',
      icon: 'gauge',
      emitValue: 'overview',
      isDisabled: false,
    })
  })

  it('没写文案的格给一个带序号的占位，空轨道看着像模块坏了', () => {
    const spec = readTabsSpec({ items: [{}, {}] })

    expect(spec.items.map((tab) => tab.label)).toEqual(['页签 1', '页签 2'])
  })

  it('名单外的图标名回落成「不画图标」——DtIcon 遇到没登记的名字只是空着', () => {
    const spec = readTabsSpec({ items: [{ icon: 'no-such-icon' }] })

    expect(spec.items[0]?.icon).toBe('')
  })

  it('禁用只认真正的 true：配置里存了字符串不算', () => {
    const spec = readTabsSpec({ items: [{ disabled: 'true' }] })

    expect(spec.items[0]?.isDisabled).toBe(false)
  })

  it('不是数组的 items 收成空表，而不是让整块渲染炸掉', () => {
    expect(readTabsSpec({ items: '总览,能耗' }).items).toEqual([])
  })
})

describe('默认选中', () => {
  it('1 基的人类计数落成 0 基下标', () => {
    expect(readTabsSpec({ items: THREE_TABS, activeIndex: 2 }).activeAt).toBe(1)
  })

  it('超出格数就夹到最后一格，否则整条轨道没有任何一格是亮的', () => {
    expect(readTabsSpec({ items: THREE_TABS, activeIndex: 9 }).activeAt).toBe(2)
    expect(readTabsSpec({ items: THREE_TABS, activeIndex: 0 }).activeAt).toBe(0)
  })

  it('一格都没有时是 0，不会算出负下标', () => {
    expect(readTabsSpec({ items: [], activeIndex: 3 }).activeAt).toBe(0)
  })
})

describe('数值一律夹回清单声明的范围', () => {
  it('负字号与超界内边距都夹回去——整条声明被丢掉的话轨道会消失', () => {
    const vars = varsOf({ fontSize: -8, itemPaddingX: 999, trackPadding: -3 })

    expect(vars['--tab-font-size']).toBe('8px')
    expect(vars['--tab-px']).toBe('64px')
    expect(vars['--tab-pad']).toBe('0px')
  })

  it('胶囊档的圆角比任何高度都大，直角档是 0', () => {
    expect(varsOf({ shape: 'pill' })['--tab-item-radius']).toBe('999px')
    expect(varsOf({ shape: 'sharp' })['--tab-item-radius']).toBe('0px')
  })

  it('切角档把那个数放进切角变量，圆角归零', () => {
    const vars = varsOf({ shape: 'cut', itemRadius: 12 })

    expect(vars['--tab-cut']).toBe('12px')
    expect(vars['--tab-item-radius']).toBe('0px')
  })

  it('图标字号配 0 = 跟着字号走，配了就用配的', () => {
    expect(readTabsSpec({ fontSize: 20 }).iconSize).toBe(22)
    expect(readTabsSpec({ fontSize: 20, iconSize: 30 }).iconSize).toBe(30)
  })
})

describe('颜色与「没配就不注入」', () => {
  it('语义色只取主题变量，换肤时整屏页签跟着走', () => {
    expect(varsOf({ tone: 'success' })['--tab-accent']).toBe(
      'var(--state-success)',
    )
    // ⚠ 黄底上的浅字读不出来，预警档压的是深色字
    expect(varsOf({ tone: 'warning' })['--tab-on']).toBe('var(--text-inverse)')
  })

  it('自定义档留空回落主题强调色，填了就用填的', () => {
    expect(varsOf({ tone: 'custom' })['--tab-accent']).toBe(
      'var(--accent-primary)',
    )
    expect(varsOf({ tone: 'custom', accent: ' #0af ' })['--tab-accent']).toBe(
      '#0af',
    )
  })

  it('四个「留空 = 跟风格自动」的键没配就不注入，注入了就回落不到风格缺省', () => {
    const bare = varsOf({})

    expect(bare['--tab-text']).toBeUndefined()
    expect(bare['--tab-active-text']).toBeUndefined()
    expect(bare['--tab-track']).toBeUndefined()
    expect(bare['--tab-active-weight']).toBeUndefined()
  })

  it('选中字重配 0 就是「与未选中同一个字重」，不注入变量', () => {
    expect(
      varsOf({ activeFontWeight: 0 })['--tab-active-weight'],
    ).toBeUndefined()
    expect(varsOf({ activeFontWeight: 700 })['--tab-active-weight']).toBe('700')
  })

  it('辉光关着就不注入半径，开着才有', () => {
    expect(varsOf({ glow: false })['--tab-glow']).toBeUndefined()
    expect(varsOf({ glow: true, glowRadius: 20 })['--tab-glow']).toBe('20px')
  })
})

describe('类名', () => {
  it('轮廓类名带 shape- 前缀：胶囊轮廓与实心风格否则会撞成同一个类', () => {
    const classes = classesOf({ variant: 'solid', shape: 'pill' })

    expect(classes).toContain('dt-tabs--solid')
    expect(classes).toContain('dt-tabs--shape-pill')
  })

  it('名单外的取值一律回落缺省档，不会拼出一个样式表里没有的类', () => {
    const classes = classesOf({ variant: 'nope', hover: 'nope' })

    expect(classes).toContain('dt-tabs--track')
    expect(classes).toContain('dt-tabs--hover-tint')
  })

  it('等分出厂就开，分隔线与辉光出厂关着', () => {
    expect(classesOf({})).toContain('dt-tabs--stretch')
    expect(classesOf({ stretch: false })).not.toContain('dt-tabs--stretch')
    expect(classesOf({})).not.toContain('dt-tabs--divider')
    expect(classesOf({})).not.toContain('dt-tabs--glow')
  })

  it('充满模块那一档才给 fill', () => {
    expect(classesOf({})).toContain('dt-tabs--fill')
    expect(classesOf({ sizing: 'auto' })).not.toContain('dt-tabs--fill')
  })
})

describe('外层排布', () => {
  it('充满模块时不参与对齐——轨道就是那个矩形本身', () => {
    expect(readTabsSpec({}).hostStyle).toEqual({
      justifyContent: 'flex-start',
      alignItems: 'stretch',
    })
  })

  it('按内容尺寸时按两个方向各自落位', () => {
    expect(
      readTabsSpec({ sizing: 'auto', align: 'right', vAlign: 'top' }).hostStyle,
    ).toEqual({ justifyContent: 'flex-end', alignItems: 'flex-start' })
  })
})

describe('变量名与样式表双向吻合', () => {
  it('扫描本身没有空转——样式源扫到了，也真扫出了变量', () => {
    expect(styleSources().length).toBeGreaterThan(1)
    expect(referencedVars().length).toBeGreaterThan(0)
  })

  it('声明的每个变量名都在样式表里被引用过', () => {
    const referenced = new Set(referencedVars())

    expect(TABS_VAR_NAMES.filter((name) => !referenced.has(name))).toEqual([])
  })

  it('样式表里引用的每个变量名都由 look 注入，没有第二个来源', () => {
    const known = new Set<string>(TABS_VAR_NAMES)

    expect(referencedVars().filter((name) => !known.has(name))).toEqual([])
    expect(localVars()).toEqual([])
  })

  it('不带条件的那批变量真的全都摊在 vars 里，没有只声明不注入的', () => {
    const optional = new Set([
      '--tab-text',
      '--tab-active-text',
      '--tab-track',
      '--tab-active-weight',
      '--tab-glow',
    ])
    const vars = varsOf({})

    expect(
      TABS_VAR_NAMES.filter(
        (name) => !optional.has(name) && vars[name] === undefined,
      ),
    ).toEqual([])
  })
})
