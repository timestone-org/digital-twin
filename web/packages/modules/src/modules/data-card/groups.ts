/**
 * @fileoverview 卡片的分组与告警：按格上的「分组」字符串分段或分页签，以及逐格
 * 求一次值规则。两件都是纯函数，摆错的表现（页签少一个、该红的没红）在界面上
 * 很难反推是哪一步错的。
 *
 * ⚠ 页签的计数用**全量格数**而不是当前页签的子集：切到某一页再看计数会变，
 * 是用户第一眼就会当成 bug 的那种不一致（与 info-list 同一条口径）。
 */
import { readText } from '../../shared/config'
import {
  evaluateValueRules,
  type ValueHit,
  type ValueRule,
} from '../../shared/valueRules'

/** 分组形态。分组键是格上的自由字符串。 */
export const CARD_GROUPINGS = ['none', 'section', 'tabs'] as const
export type CardGrouping = (typeof CARD_GROUPINGS)[number]

/** 没起分组名的格归到这一组；空串在页签上摆不出来。 */
export const UNGROUPED_LABEL = '其他'

/** 一组格：组名 + 组里格的下标。 */
export interface CardGroup {
  name: string
  /** 这一组里各格在原表里的下标，原序。 */
  indexes: number[]
}

/**
 * 按格上的分组名分组，**保持首次出现的顺序**。
 * ⚠ 不排序：组的顺序就是用户在格表里摆出来的顺序，按字典序重排会让「洗浴 / 空调 /
 * 采暖」变成「采暖 / 空调 / 洗浴」，而用户并没有动过配置。
 * @param groups 逐格的分组名原值
 */
export function toCardGroups(groups: readonly unknown[]): CardGroup[] {
  const out: CardGroup[] = []
  const seen = new Map<string, CardGroup>()
  groups.forEach((raw, index) => {
    const name = readText(raw).trim() || UNGROUPED_LABEL
    const found = seen.get(name)
    if (found === undefined) {
      const made: CardGroup = { name, indexes: [index] }
      seen.set(name, made)
      out.push(made)
    } else {
      found.indexes.push(index)
    }
  })
  return out
}

/**
 * 挑当前该显示哪一组。
 * ⚠ 认不出的组名回落到第一组而不是显示空：配置里写错一个字就整块空白，
 * 而两侧都不报错。
 * @param groups 分好的组
 * @param wanted 想要哪一组，空串 = 第一组
 */
export function pickGroup(
  groups: readonly CardGroup[],
  wanted: string,
): string {
  if (groups.length === 0) return ''
  const hit = groups.find((one) => one.name === wanted)
  return hit?.name ?? groups[0]?.name ?? ''
}

/** 一格的告警结论。 */
export interface CardAlarm {
  hit: ValueHit | null
  blink: boolean
}

/**
 * 逐格求一次值规则。
 * ⚠ 规则表为空时**一次求值都不做**：这是绝大多数卡片的情形，而求值器要逐条
 * 走比较器，十几格 × 八条规则每帧都算是白烧。
 * ⚠ 形参别叫 `values`：「声明的槽键与真正读的键」那道闸按 `values.<键>` 逐个扫源码，
 * 会把 `values.map` 认成读了一个叫 map 的槽。
 * @param judged 逐格被判的那个值
 * @param rules 已规整的规则表
 */
export function evaluateCells(
  judged: readonly unknown[],
  rules: readonly ValueRule[],
): CardAlarm[] {
  if (rules.length === 0) return judged.map(() => ({ hit: null, blink: false }))
  return judged.map((one) => {
    const hit = evaluateValueRules(one, rules)
    return { hit, blink: hit?.blink ?? false }
  })
}
