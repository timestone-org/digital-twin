/**
 * @fileoverview 把扁平的部件表摊成一格里的若干「行」。
 *
 * 部件表是扁平的（MODULE_DATA_CARD_DESIGN §1），而列表族的行是「左边名称、
 * 右边徽标」这样左右配对的。两者之间只隔一条规则，写在这里而不是模板里，
 * 是为了让它能被单测钉住——摆错行在界面上只是「怎么挤到一起去了」，很难反推。
 *
 * ⚠ 刻意**不引入「行」容器**：那会让部件表变成两层，于是「加部件」先要「加一行」，
 * 撤销轴、排序、右栏选中三处都得跟着分叉（§11.3）。
 */
import { CARD_PART_PLACES, type CardPartPlace } from './define'

/** 一件部件在成行结果里的样子；`index` 是它在原表里的下标，选中态靠它对回去。 */
export interface CardLineItem<T> {
  index: number
  part: T
}

/** 一行：左簇与右簇。`block` 档独占一行，落在左簇且右簇为空。 */
export interface CardLine<T> {
  /** 整行独占的那一件；非 null 时左右两簇必为空。 */
  block: CardLineItem<T> | null
  left: CardLineItem<T>[]
  right: CardLineItem<T>[]
}

/**
 * 读一件部件的占位档；认不出的一律当整行。
 * ⚠ 认不出时不能扔掉那一件：扔了就是「我加的部件不见了」，而配置里明明有。
 * @param raw 行上 `place` 键的原值
 */
export function readPlace(raw: unknown): CardPartPlace {
  return CARD_PART_PLACES.find((one) => one === raw) ?? 'block'
}

function emptyLine<T>(): CardLine<T> {
  return { block: null, left: [], right: [] }
}

/**
 * 按 §11.3 那条规则成行：`block` 独占一行；连续的 `left` 聚成左簇、`right` 聚成
 * 右簇；遇到 `block`、或在 `right` 之后再遇到 `left`，就起新的一行。
 * @param parts 部件表，原序
 * @param placeOf 取一件部件的占位档
 */
export function toCardLines<T>(
  parts: readonly T[],
  placeOf: (part: T) => CardPartPlace,
): CardLine<T>[] {
  const lines: CardLine<T>[] = []
  let current: CardLine<T> | null = null
  parts.forEach((part, index) => {
    const place = placeOf(part)
    if (place === 'block') {
      lines.push({ block: { index, part }, left: [], right: [] })
      current = null
      return
    }
    // ⚠ 右簇之后再来左件，是下一行的开头：不断开的话「读数｜进度条」与下一组
    //   「名称｜徽标」会挤成一行四件，而用户摆的是两行
    if (current === null || (place === 'left' && current.right.length > 0)) {
      current = emptyLine<T>()
      lines.push(current)
    }
    current[place].push({ index, part })
  })
  return lines
}
