/**
 * @fileoverview data-table 的配置 → 形态：一次读完外观那一半 config，收成一份
 * `TableLook`（修饰类、`--dtb-*` 变量、解析后的数值与表头那一格的文案）。
 * 纯函数，模板只摆件不判档位。
 * ⚠ 数值一律夹回清单声明的范围：`min` / `max` 只约束属性面板，脏配置里的 `-8` 会让
 * 整条 CSS 声明被浏览器丢掉，而 `0` 字号会让整张表彻底看不见。
 * ⚠ 列宽模板**不在这里**：它由数据侧的 `columnsTemplateOf` 算，表头与数据行共用，
 * 摆两处来源就会错列。
 */
import type { CSSProperties } from 'vue'

import {
  readBoolean,
  readEnum,
  readNumber,
  readTrimmedText,
} from '../../shared/config'
import {
  TABLE_DENSITY_PAD,
  TABLE_DENSITY_VALUES,
  TABLE_FONT_MAX,
  TABLE_FONT_MIN,
  TABLE_GRID_LINE_VALUES,
  TABLE_TONE_COLORS,
  TABLE_TONE_VALUES,
  type TableDensity,
  type TableGridLine,
} from './options'

/** 表头第一格的缺省文案。 */
export const NAME_HEADER_DEFAULT = '名称'

/** 缺省字号。 */
const HEAD_SIZE_DEFAULT = 12
const NAME_SIZE_DEFAULT = 13
const VALUE_SIZE_DEFAULT = 14

/** 整块四周的内边距（px），不给配，只按密度走。 */
const BLOCK_PAD_X = 4
const BLOCK_PAD_Y = 2

/** 列间距（px）。 */
const COLUMN_GAP = 8

type DtbVarName =
  | '--dtb-cols-tpl'
  | '--dtb-pad-x'
  | '--dtb-pad-y'
  | '--dtb-cell-px'
  | '--dtb-cell-py'
  | '--dtb-col-gap'
  | '--dtb-head-size'
  | '--dtb-head-color'
  | '--dtb-name-size'
  | '--dtb-name-color'
  | '--dtb-value-size'
  | '--dtb-value-color'

/**
 * 本模块自己的一组 CSS 变量；样式表只认变量，不认配置键。
 * ⚠ 全局那道 `css-var-names.contract.spec.ts` 只查**不带回落值**的 `var(--x)`，
 * 而这套变量个个带回落（带回落是对的，见样式表文件头）——于是名字拼错时它一声不吭。
 * 拦得住的只有 `look.test.ts` 里那条与 scss 双向吻合的断言。
 */
export type TableVars = CSSProperties & Partial<Record<DtbVarName, string>>

/** 变量名清单，给「联合 ⟷ scss 引用集合双向吻合」那条契约测试用。 */
export const DTB_VAR_NAMES: readonly DtbVarName[] = [
  '--dtb-cols-tpl',
  '--dtb-pad-x',
  '--dtb-pad-y',
  '--dtb-cell-px',
  '--dtb-cell-py',
  '--dtb-col-gap',
  '--dtb-head-size',
  '--dtb-head-color',
  '--dtb-name-size',
  '--dtb-name-color',
  '--dtb-value-size',
  '--dtb-value-color',
]

/** 解析并夹取之后的数值；断言尺寸时读这一份而不是解析 px 串。 */
export interface TableNums {
  headSize: number
  nameSize: number
  valueSize: number
  cellPadY: number
}

/** 表头那一行的形态。 */
export interface TableHeader {
  show: boolean
  /** ⚠ 只有表头画出来时才谈得上钉住：`showHeader` 关着时这一项恒为 false。 */
  sticky: boolean
  /** 表头第一格的文案，也就是行名那一列的列头。 */
  name: string
}

/** 一块表从配置里读出来的全部形态。 */
export interface TableLook {
  classes: string[]
  vars: TableVars
  nums: TableNums
  header: TableHeader
  density: TableDensity
  gridLines: TableGridLine
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/**
 * 字号：夹回可配区间。
 * @param raw 配置里读出来的原值
 * @param fallback 取不到有限数时的回退
 */
function fontSize(raw: unknown, fallback: number): number {
  return clamp(
    Math.round(readNumber(raw, fallback)),
    TABLE_FONT_MIN,
    TABLE_FONT_MAX,
  )
}

/**
 * 表头形态。
 * ⚠ `sticky` 与 `showHeader` 相与：表头不画时钉住谁都没有意义，而单看
 * `headerSticky` 会让样式类挂在一个并不存在的表头上。
 * @param config 该节点落库的配置
 */
function readHeader(config: Record<string, unknown>): TableHeader {
  const show = readBoolean(config.showHeader, true)
  return {
    show,
    sticky: show && readBoolean(config.headerSticky, true),
    name: readTrimmedText(config.nameHeader) || NAME_HEADER_DEFAULT,
  }
}

/**
 * 一块表的形态。
 * @param config 该节点落库的配置
 */
export function readTableLook(config: Record<string, unknown>): TableLook {
  const density = readEnum(config.density, TABLE_DENSITY_VALUES, 'normal')
  const gridLines = readEnum(
    config.gridLines,
    TABLE_GRID_LINE_VALUES,
    'horizontal',
  )
  const header = readHeader(config)
  const nums: TableNums = {
    headSize: fontSize(config.headSize, HEAD_SIZE_DEFAULT),
    nameSize: fontSize(config.nameSize, NAME_SIZE_DEFAULT),
    valueSize: fontSize(config.valueSize, VALUE_SIZE_DEFAULT),
    cellPadY: TABLE_DENSITY_PAD[density],
  }
  const tone = readEnum(config.nameTone, TABLE_TONE_VALUES, 'secondary')
  const valueColor = readTrimmedText(config.valueColor)
  return {
    classes: [
      `dtb--density-${density}`,
      `dtb--lines-${gridLines}`,
      ...(readBoolean(config.striped, true) ? ['dtb--striped'] : []),
      ...(header.sticky ? ['dtb--sticky'] : []),
    ],
    vars: {
      '--dtb-pad-x': `${String(BLOCK_PAD_X)}px`,
      '--dtb-pad-y': `${String(BLOCK_PAD_Y)}px`,
      '--dtb-cell-px': `${String(COLUMN_GAP)}px`,
      '--dtb-cell-py': `${String(nums.cellPadY)}px`,
      '--dtb-col-gap': `${String(COLUMN_GAP)}px`,
      '--dtb-head-size': `${String(nums.headSize)}px`,
      '--dtb-head-color': TABLE_TONE_COLORS[tone],
      '--dtb-name-size': `${String(nums.nameSize)}px`,
      '--dtb-name-color': TABLE_TONE_COLORS[tone],
      '--dtb-value-size': `${String(nums.valueSize)}px`,
      // ⚠ 留空时整条键都不写：写成空串会让 `var(--dtb-value-color)` 取到空值，
      //   而 CSS 的回落只在变量**没定义**时才生效，定义成空串等于把颜色抹掉
      ...(valueColor === '' ? {} : { '--dtb-value-color': valueColor }),
    },
    nums,
    header,
    density,
    gridLines,
  }
}
