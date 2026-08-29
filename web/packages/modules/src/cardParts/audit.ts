/**
 * @fileoverview 一批部件定义是否自洽——机制自带的自检，与 `missingConfigControls()` 同构。
 *
 * 这几条查的都是**加一个部件时漏了不会报错**的事。摆卡片的模块把内置部件的字段静态
 * 并进自己的 `configSchema`，一旦并出重名或指空条件，表现全都是「属性面板上那一格
 * 调了没反应」或「那一格永远不出现」，而 typecheck、lint、build 一路全绿。
 *
 * ⚠ 每条都只吃数据、不挂载：契约测试因此可以对全部内置部件跑一遍，秒级。
 */
import type { ConfigField } from '@dt/contracts'

import { CARD_PART_KIND_KEY } from './define'
import type { CardPartDefinition, CardSlotKey } from './types'

/** 定义里必须有、且不许是空串的那几项。 */
const REQUIRED_TEXT = ['label', 'icon', 'hint'] as const

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

/**
 * 缺了必填项的部件，形如 `meter.icon`。
 * ⚠ 缺 `icon` 的部件在「加部件」菜单里没有图标且不报错；缺 `hint` 的让用户与模型
 * 都猜不出该什么时候用它。
 * @param parts 一批部件定义
 */
export function incompleteParts(
  parts: readonly CardPartDefinition[],
): string[] {
  return parts.flatMap((part) => [
    ...REQUIRED_TEXT.filter((key) => isBlank(part[key])).map(
      (key) => `${part.kind}.${key}`,
    ),
    ...(typeof part.component === 'function' ? [] : [`${part.kind}.component`]),
  ])
}

/**
 * 并进同一张 itemSchema 后重名的字段键，形如 `meter-color`。
 * ⚠ 重名的后果是两个部件共用一个取值：改这个部件的颜色，另一个跟着变。
 * @param parts 一批部件定义
 */
export function duplicateFieldKeys(
  parts: readonly CardPartDefinition[],
): string[] {
  const seen = new Set<string>()
  const clashed = new Set<string>()
  for (const field of parts.flatMap((part) => part.fields)) {
    if (seen.has(field.key)) clashed.add(field.key)
    seen.add(field.key)
  }
  return [...clashed].sort()
}

/**
 * `when` 指向并集里并不存在的键的那些字段，形如 `meter-target → meter-showTarge`。
 *
 * ⚠ 指空的条件**恒不满足**，那个字段于是**永远不出现**在属性面板上，
 * 而两侧都不报错——本仓最典型的一类静默失效。
 * @param parts 一批部件定义
 * @param outerKeys 部件字段之外、itemSchema 里还有的键（`kind`、格级的那几个）
 */
export function danglingPartConditions(
  parts: readonly CardPartDefinition[],
  outerKeys: readonly string[],
): string[] {
  const keys = new Set<string>([
    ...outerKeys,
    ...parts.flatMap((part) => part.fields.map((field) => field.key)),
  ])
  return parts.flatMap((part) =>
    part.fields
      .filter((field) => field.when !== undefined && !keys.has(field.when.key))
      .map((field) => `${field.key} → ${field.when?.key ?? ''}`),
  )
}

/**
 * 声明了却不存在的子槽，形如 `meter.level`。
 * ⚠ 声明与实际读的对不上时，绑点面板提示接 A、部件其实读 B——用户接了半天没有值，
 * 而两边都不报错。
 * @param parts 一批部件定义
 * @param allowed 摆卡片的模块真有的那几个子槽
 */
export function strayPartSlots(
  parts: readonly CardPartDefinition[],
  allowed: readonly CardSlotKey[],
): string[] {
  const known = new Set<string>(allowed)
  return parts.flatMap((part) =>
    part.slots
      .filter((slot) => !known.has(slot))
      .map((slot) => `${part.kind}.${slot}`),
  )
}

/**
 * 一个部件的字段是否都挂得到 kind 条件——直接挂，或沿 `when` 链上溯挂到。
 *
 * ⚠ 挂不到的字段会**在所有档下都出现**：用户选了「进度条」，面板上却摆着
 * 「徽章」的颜色，改了它两档一起变。
 * @param part 一个部件定义
 */
export function fieldsWithoutKindCondition(part: CardPartDefinition): string[] {
  const byKey = new Map(part.fields.map((field) => [field.key, field]))
  return part.fields
    .filter((field) => !reachesKind(field, byKey))
    .map((field) => field.key)
}

/**
 * 沿 `when` 链上溯，看这一条最终判不判得到 `kind`。
 * ⚠ 链**必须终于 `kind`**：停在别的外层键上就是「这个字段在所有档下都出现」。
 * ⚠ 记下走过的键——清单是人写的，`a → b → a` 这种环写得出来，不记就死循环。
 * @param field 起点字段
 * @param byKey 这个部件自己的字段表
 */
function reachesKind(
  field: ConfigField,
  byKey: ReadonlyMap<string, ConfigField>,
): boolean {
  const seen = new Set<string>([field.key])
  let current: ConfigField | undefined = field
  while (current?.when !== undefined) {
    const key: string = current.when.key
    if (key === CARD_PART_KIND_KEY) return true
    if (seen.has(key) || !byKey.has(key)) return false
    seen.add(key)
    current = byKey.get(key)
  }
  return false
}
