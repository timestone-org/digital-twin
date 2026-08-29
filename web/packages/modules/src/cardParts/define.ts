/**
 * @fileoverview `defineCardPart` —— 把作者写的部件定义整理成能并进同一张 `itemSchema`
 * 的形状。它只做两件**作者一定会漏**的事，其余原样透传。
 *
 * 部件们的字段要并进同一张 `itemSchema`（部件列表是 `type: 'array'`，而 itemSchema
 * 是同构的），靠 `when: { key: 'kind' }` 让每一档只露自己那几个。这条路完全落在现有
 * 机制内——属性面板、批量配置、助手的模块清单全都自动支持，一行适配都不用写。
 */
import type { ConfigField } from '@dt/contracts'

import type { CardPartDefinition, CardPartInput } from './types'

/** 部件档名在行里存在这个键上。⚠ 与 `data-card` 的 itemSchema 逐字相同。 */
export const CARD_PART_KIND_KEY = 'kind'

/**
 * 字段键的前缀分隔符。
 * ⚠ 用 `-` 不用 `.`：仓里有按点号切配置路径的地方，带点的键会在那里被劈成两段。
 */
const SEPARATOR = '-'

/**
 * 前缀化后的字段键。
 * @param kind 部件档名
 * @param key 作者写的键
 */
export function partFieldKey(kind: string, key: string): string {
  return `${kind}${SEPARATOR}${key}`
}

/**
 * 把一行部件配置收窄成这一档自己的键（去前缀）。渲染前调一次，部件因此看不见别档的键。
 * @param kind 部件档名
 * @param row 落库的那一行
 */
export function partConfigOf(
  kind: string,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const head = `${kind}${SEPARATOR}`
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith(head)) out[key.slice(head.length)] = value
  }
  return out
}

/**
 * 整理一个字段：键前缀化，没有自己 `when` 的补上 kind 条件，有自己 `when` 的把
 * 那个键也前缀化。
 *
 * ⚠ **只动顶层**：`object` 的 `fields` 与 `array` 的 `itemSchema` 是各自的作用域，
 * 它们的键不会与别档相撞，`when` 也只判自己那一层的同级。跟着前缀化会让子字段的
 * 条件指空，那个子字段就永远不出现。
 *
 * ⚠ 作者自己写了 `when` 的字段**不再补 kind 条件**——`ConfigFieldCondition` 只判一个键。
 * 它靠**沿 `when` 链上溯**拿到 kind 条件：它指向的那个同伴字段自己带着 kind 条件，
 * 链式判定于是让它在别档下一并消失（`configForm.ts` 的 `isFieldVisible`）。
 * 所以作者的 `when` 必须指向**同一个部件里的另一个字段**，由契约测试钉死。
 * @param kind 部件档名
 * @param field 作者写的字段
 */
function prefixed(kind: string, field: ConfigField): ConfigField {
  const out: ConfigField = { ...field, key: partFieldKey(kind, field.key) }
  out.when =
    field.when === undefined
      ? { key: CARD_PART_KIND_KEY, in: [kind] }
      : { ...field.when, key: partFieldKey(kind, field.when.key) }
  return out
}

/**
 * 定义一个部件。
 * @param input 作者写的定义，字段键按未前缀化的写
 */
export function defineCardPart(input: CardPartInput): CardPartDefinition {
  return {
    ...input,
    fields: input.fields.map((field) => prefixed(input.kind, field)),
  }
}
