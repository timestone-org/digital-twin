/**
 * @fileoverview 下拉选项的纯逻辑：过滤、按可用项移动高亮。与渲染无关，单独可测。
 */

import type { DtSelectOption } from '@dt/contracts'

/** 选项多到这个数就默认给搜索框；少于它时搜索框只是碍事。 */
export const SEARCHABLE_THRESHOLD = 8

/**
 * 按关键词过滤。**label 与 value 都参与匹配**——权限码、HTTP 方法这类选项，
 * 人记得住的往往是取值本身而不是中文名。
 * @param options 全量选项
 * @param query 关键词，空串表示不过滤
 */
export function filterOptions(
  options: readonly DtSelectOption[],
  query: string,
): DtSelectOption[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...options]
  return options.filter(
    (option) =>
      option.label.toLowerCase().includes(needle) ||
      option.value.toLowerCase().includes(needle),
  )
}

/** 第一个可选项的下标；全都禁用时给 -1。 */
export function firstEnabled(options: readonly DtSelectOption[]): number {
  return options.findIndex((option) => option.disabled !== true)
}

/** 最后一个可选项的下标；全都禁用时给 -1。 */
export function lastEnabled(options: readonly DtSelectOption[]): number {
  for (let index = options.length - 1; index >= 0; index -= 1) {
    if (options[index]?.disabled !== true) return index
  }
  return -1
}

/**
 * 从 `from` 往 `delta` 方向找下一个可选项，到头绕回。
 * ⚠ 必须跳过禁用项：停在禁用项上时回车什么都不会发生，用户以为键盘坏了。
 * @param options 当前可见的选项
 * @param from 当前高亮下标，-1 表示还没有
 * @param delta +1 向下、-1 向上
 */
export function nextEnabled(
  options: readonly DtSelectOption[],
  from: number,
  delta: number,
): number {
  const total = options.length
  if (total === 0) return -1
  let cursor = from
  for (let step = 0; step < total; step += 1) {
    cursor = (cursor + delta + total) % total
    if (options[cursor]?.disabled !== true) return cursor
  }
  return -1
}

/** 取值在选项里的下标；找不到给 -1。 */
export function indexOfValue(
  options: readonly DtSelectOption[],
  value: string,
): number {
  return options.findIndex((option) => option.value === value)
}
