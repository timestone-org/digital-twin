/**
 * @fileoverview ② 区的取料：一组指标折成 4–8 张卡片的显示口径。
 *
 * ⚠ 只有有公认好坏线的那几个指标才染色（口径在 `metricBands.ts`）：给 MAE
 * 拍一个颜色等于替用户下一个没根据的结论（规格 §2-P3）。
 */
import type { DtIntent } from '@dt/contracts'

import type { MetricBand, MetricSpace } from './metricBands'
import {
  BAND_INTENTS,
  bandHintOf,
  bandOf,
  labelOf,
  unitOf,
} from './metricBands'
import { niceNumber } from './numbers'

/** ② 区最多摆几张卡；再多要标注截断（规格 §3.2）。 */
export const MAX_STAT_CARDS = 8

/** 算不出来的指标写这四个字，不写 0（规格 §2-P4）。 */
export const UNDEFINED_TEXT = '无定义'

/** 三档的中文名。⚠ 颜色不作唯一编码，每张染过色的卡另带这个词。 */
export const BAND_WORDS: Record<MetricBand, string> = {
  good: '好',
  fair: '一般',
  poor: '差',
  unknown: '',
}

/** 要摆上去的一个指标。 */
export interface StatItem {
  key: string
  /** ⚠ 留 null：算不出来的那一项显示成 0 是假数。 */
  value: number | null
  /** 覆盖 `metricBands` 查出来的中文名；空串 = 用查出来的。 */
  label?: string | undefined
  /** 已经排好版的读数（「12,480 行」这类）；给了就不再走 `niceNumber`。 */
  text?: string | undefined
  /** 追加在阈值口径后面的一句，比如「为什么这一项是无定义」。 */
  hint?: string | undefined
}

/** 一张卡片摆出来的样子，模板里不再做判断。 */
export interface StatCardView {
  key: string
  label: string
  /** 读数正文，走 `DtDigits` 锁宽。 */
  text: string
  unit: string
  band: MetricBand
  intent: DtIntent
  /** 三档的中文名；没有好坏线的一律空串。 */
  word: string
  hint: string
  /** 无定义的那几张：口径说明直接摊在卡片上，不藏进小问号。 */
  isUndefined: boolean
}

/** 一个读数印成什么。Args: item。 */
function textOf(item: StatItem): string {
  if (item.text !== undefined && item.text !== '') return item.text
  return item.value === null ? UNDEFINED_TEXT : niceNumber(item.value)
}

/**
 * 一张卡片。
 *
 * ⚠ 无定义时不染色也不摆档位词：一个算不出来的 R² 染成红色会被读成
 * 「算出来了，而且很差」。
 * Args: item, space。
 */
function cardOf(item: StatItem, space: MetricSpace): StatCardView {
  const band = bandOf(item.key, item.value, space)
  const isUndefined = item.value === null && item.text === undefined
  const hints = [bandHintOf(item.key, space), item.hint ?? ''].filter(
    (one) => one !== '',
  )
  return {
    key: item.key,
    label:
      item.label !== undefined && item.label !== ''
        ? item.label
        : labelOf(item.key, space),
    text: textOf(item),
    unit: isUndefined ? '' : unitOf(item.key, space),
    band,
    intent: BAND_INTENTS[band],
    word: BAND_WORDS[band],
    hint: hints.join('；'),
    isUndefined,
  }
}

/**
 * 一组指标折成卡片，超出上限的截掉——截断由 `statCardsMore` 明说。
 * Args: items, space。
 */
export function statCardsOf(
  items: readonly StatItem[],
  space: MetricSpace = 'metric',
): StatCardView[] {
  return items.slice(0, MAX_STAT_CARDS).map((item) => cardOf(item, space))
}

/** 截断必须标注（规格 §2-P5）；没截时给空串。Args: items。 */
export function statCardsMore(items: readonly StatItem[]): string {
  if (items.length <= MAX_STAT_CARDS) return ''
  return `只列了前 ${MAX_STAT_CARDS} 项，共 ${niceNumber(items.length)} 项`
}
