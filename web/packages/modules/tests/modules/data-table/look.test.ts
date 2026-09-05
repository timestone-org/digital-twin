/**
 * @fileoverview 守 data-table 的形态层与它和样式表之间的那几条契约：
 * 修饰类逐档、数值夹回可配区间、留空的读数颜色整条键都不写，
 * 以及本族最要紧的那一条——**表头与数据行的列宽模板逐字相同**。
 *
 * ⚠ 列宽写成两处字符串就会错列，而 typecheck 与 lint 都看不出问题。
 * 只有本文件这条源码级断言拦得住。
 * ⚠ `--dtb-*` 这套变量个个带回落值，而全局那道 css-var-names 契约只查**不带回落**的
 * 引用——于是这套名字它一个都不管，拼错既不报错也不生效，只有下面那条双向吻合断言管。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  DTB_VAR_NAMES,
  NAME_HEADER_DEFAULT,
  readTableLook,
} from '../../../src/modules/data-table/look'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const STYLE_FILE = join(
  process.cwd(),
  'packages',
  'modules',
  'src',
  'modules',
  'data-table',
  '_variants.scss',
)

/** 剥掉注释：文件头里提到的变量名是说明，不是引用。 */
function styleSource(): string {
  return readFileSync(STYLE_FILE, 'utf8').replace(/\/\/[^\n]*/g, '')
}

/** 表头与数据行的列宽都写在这条规则里；抓选择器与那一行声明。 */
const COLUMNS_RULE =
  /(?<selectors>(?:\.[\w-]+,\s*)*\.[\w-]+)\s*\{(?<body>[^}]*grid-template-columns[^}]*)\}/g

describe('列宽模板：表头与数据行只有一份', () => {
  it('整份样式表里 grid-template-columns 只出现一次', () => {
    const source = styleSource()

    expect(source.split('grid-template-columns')).toHaveLength(2)
  })

  it('那唯一一条规则同时管着表头与数据行', () => {
    const [match] = [...styleSource().matchAll(COLUMNS_RULE)]
    const selectors = (match?.groups?.selectors ?? '')
      .split(',')
      .map((item) => item.trim())

    expect(selectors).toContain('.dtb-head')
    expect(selectors).toContain('.dtb-row')
  })

  it('两边读的是同一个变量，不是各拼一份字面量', () => {
    const [match] = [...styleSource().matchAll(COLUMNS_RULE)]
    const declaration = /grid-template-columns:\s*(?<value>[^;]+);/.exec(
      match?.groups?.body ?? '',
    )

    expect(declaration?.groups?.value).toContain('var(--dtb-cols-tpl')
  })
})

describe('CSS 变量名两侧吻合', () => {
  it('联合里的每一个都真被样式表引用了', () => {
    const source = styleSource()
    const unused = DTB_VAR_NAMES.filter((name) => !source.includes(name))

    expect(unused).toEqual([])
  })

  it('样式表引用的每一个都在联合里', () => {
    const referenced = [
      ...styleSource().matchAll(/var\((?<name>--dtb-[\w-]+)/g),
    ]
      .map((match) => match.groups?.name ?? '')
      .filter((name) => !DTB_VAR_NAMES.some((known) => known === name))

    expect([...new Set(referenced)]).toEqual([])
  })

  it('每个 var() 都带回落值——不带的那条拼错就整条声明作废', () => {
    const bare = [...styleSource().matchAll(/var\(\s*--dtb-[\w-]+\s*\)/g)].map(
      (match) => match[0],
    )

    expect(bare).toEqual([])
  })
})

describe('修饰类', () => {
  it('密度、网格线、斑马纹与钉住表头各自挂类', () => {
    const look = readTableLook({
      density: 'loose',
      gridLines: 'both',
      striped: true,
      showHeader: true,
      headerSticky: true,
    })

    expect(look.classes).toEqual([
      'dtb--density-loose',
      'dtb--lines-both',
      'dtb--striped',
      'dtb--sticky',
    ])
  })

  it('认不出的档位回落缺省，不让脏配置挑走一档语义', () => {
    const look = readTableLook({ density: 'huge', gridLines: 1 })

    expect(look.classes).toContain('dtb--density-normal')
    expect(look.classes).toContain('dtb--lines-horizontal')
  })

  it('斑马纹与钉住表头关掉时对应的类整条不挂', () => {
    const look = readTableLook({ striped: false, headerSticky: false })

    expect(look.classes).not.toContain('dtb--striped')
    expect(look.classes).not.toContain('dtb--sticky')
  })

  it('表头不画时钉不钉都不算钉住——类挂在不存在的表头上没有意义', () => {
    const look = readTableLook({ showHeader: false, headerSticky: true })

    expect(look.header.sticky).toBe(false)
    expect(look.classes).not.toContain('dtb--sticky')
  })
})

describe('表头文案', () => {
  it('留空与一串空格都回落缺省', () => {
    expect(readTableLook({}).header.name).toBe(NAME_HEADER_DEFAULT)
    expect(readTableLook({ nameHeader: '   ' }).header.name).toBe(
      NAME_HEADER_DEFAULT,
    )
  })

  it('配了就用配的', () => {
    expect(readTableLook({ nameHeader: '设备' }).header.name).toBe('设备')
  })
})

describe('数值', () => {
  it('字号夹回可配区间：0 字号会让整张表看不见', () => {
    expect(readTableLook({ valueSize: 0 }).nums.valueSize).toBe(8)
    expect(readTableLook({ headSize: 999 }).nums.headSize).toBe(48)
  })

  it('行高按密度走，三档互不相同', () => {
    const pads = (['compact', 'normal', 'loose'] as const).map(
      (density) => readTableLook({ density }).nums.cellPadY,
    )

    expect(new Set(pads).size).toBe(3)
  })

  it('变量里的 px 串跟着解析后的数值走', () => {
    const look = readTableLook({ valueSize: 22, nameSize: 15, headSize: 11 })

    expect(look.vars['--dtb-value-size']).toBe('22px')
    expect(look.vars['--dtb-name-size']).toBe('15px')
    expect(look.vars['--dtb-head-size']).toBe('11px')
  })
})

describe('读数颜色', () => {
  it('留空时整条键都不写，样式表的回落才生效', () => {
    expect(readTableLook({}).vars).not.toHaveProperty('--dtb-value-color')
  })

  it('配了就原样写下去', () => {
    expect(
      readTableLook({ valueColor: 'var(--accent-primary)' }).vars[
        '--dtb-value-color'
      ],
    ).toBe('var(--accent-primary)')
  })

  it('行名层级走主题变量，换肤时跟着走', () => {
    expect(readTableLook({ nameTone: 'title' }).vars['--dtb-name-color']).toBe(
      'var(--text-title)',
    )
  })
})
