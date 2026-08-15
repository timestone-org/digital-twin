/**
 * @fileoverview 检查器分区的折叠记忆：按分区标题记住用户的取舍，切换实体后仍然
 * 保持。⚠ 不落库、不进撤销栈——这是「我这会儿不关心这一节」的临时意图，
 * 写进配置会让两个人打开同一张大屏看到不同的面板。
 * ⚠ 键只用标题：不同检查器里的「显隐」是同一件事，用户折叠了一处就该处处折叠，
 * 否则配二十个部件仍要展开二十次。
 */
import { reactive } from 'vue'

/** 用户显式点过的分区；没点过的不在表里，按各检查器给的初值走。 */
const choices = reactive(new Map<string, boolean>())

/**
 * 这一节现在该不该展开。
 * @param title 分区标题
 * @param defaultOpen 用户没点过时的初值
 */
export function isSectionOpen(title: string, defaultOpen: boolean): boolean {
  return choices.get(title) ?? defaultOpen
}

/**
 * 记下用户这一次的取舍。
 * @param title 分区标题
 * @param open 展开还是折叠
 */
export function setSectionOpen(title: string, open: boolean): void {
  choices.set(title, open)
}

/** 清空记忆，供测试隔离。 */
export function __resetSectionCollapse(): void {
  choices.clear()
}
