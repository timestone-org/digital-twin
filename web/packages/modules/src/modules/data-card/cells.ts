/**
 * @fileoverview 卡片的两张表怎么归一：**格**（数据与格级口径）与**部件**（观感）。
 *
 * ⚠ 部件表是**卡片级**的，所有格共用一份。逐格的话，配十个格就要配十份部件列表；
 * 而族里每个卡片模块都是「一套观感 + N 行数据」，逐格会让这一个与兄弟们的心智
 * 模型分叉（MODULE_DATA_CARD_DESIGN §1）。
 */
import { resolveImageValue } from '../../shared/assetImage'
import type { CardCellFormat } from '../../cardParts/types'
import {
  readArray,
  readNumber,
  readRecord,
  readText,
} from '../../shared/config'

/** 格表落在这个配置键上。 */
export const DATA_CARD_CELLS_KEY = 'cells'
/** 部件表落在这个配置键上。 */
export const DATA_CARD_PARTS_KEY = 'parts'
/** 数组绑定槽的键；行钉在格上。 */
export const DATA_CARD_SLOT_KEY = 'cellValues'

/** 归一后的一个格。 */
export interface CardCell {
  label: string
  /** 已解析成可直接用的图标地址；空串 = 没配。 */
  icon: string
  /** 分组名，分段与页签按它归堆；空串 = 没起名字。 */
  group: string
  /**
   * 这一格的基色，只填 `var(--…)` 引用。空串 = 跟随卡片。
   * ⚠ 它是**格**的属性不是部件的：一列里逐格换色是列表族最常见的做法，
   * 而部件是卡片级的，配在部件上会让十个格同一个颜色。
   */
  color: string
  unit: string
  precision: number
  /** 点这一格时上抛的值，空串 = 这一格点了不上抛。 */
  emitValue: string
}

/** 归一后的一条部件。⚠ 除 `kind` 外原样保留——各档自己的键由部件去前缀后读。 */
export interface CardPartRow extends Record<string, unknown> {
  kind: string
}

/**
 * 读格表。
 * ⚠ 一个格都没有时返回空表而不是补一个：补出来的那个格在绑点面板上会多出一行，
 * 而那一行永远喂不到任何东西。
 * @param raw 配置里的那个数组
 */
export function readCells(raw: unknown): CardCell[] {
  return readArray(raw).map((one) => {
    const row = readRecord(one)
    return {
      label: readText(row.label),
      icon: resolveImageValue(readText(row.icon).trim()),
      group: readText(row.group),
      color: readText(row.color),
      unit: readText(row.unit),
      precision: readNumber(row.precision, 1),
      emitValue: readText(row.emitValue),
    }
  })
}

/**
 * 读部件表。**认不出 `kind` 的行直接丢掉**——留着它会让装配点画一排占位，
 * 而用户并没有加过那一件。
 * @param raw 配置里的那个数组
 */
export function readParts(raw: unknown): CardPartRow[] {
  return readArray(raw).flatMap((one) => {
    const row = readRecord(one)
    const kind = readText(row.kind)
    return kind === '' ? [] : [{ ...row, kind }]
  })
}

/** 卡片级的三项格式口径，逐格与格自己的单位、小数位合成一份。 */
export interface CardFormatDefaults {
  emptyText: string
  thousands: boolean
  fixedDecimals: boolean
}

/**
 * 一个格的格式口径。
 * @param cell 归一后的格
 * @param card 卡片级的三项
 */
export function cellFormat(
  cell: CardCell,
  card: CardFormatDefaults,
): CardCellFormat {
  return {
    unit: cell.unit,
    precision: cell.precision,
    emptyText: card.emptyText,
    thousands: card.thousands,
    fixedDecimals: card.fixedDecimals,
  }
}
