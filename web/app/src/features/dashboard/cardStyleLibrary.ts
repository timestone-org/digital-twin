/**
 * @fileoverview 「用户存下来的那些卡片样式」的注入接缝：外观字段组要在下拉里
 * 列出它们，而它取数的能力由页面 `provide` 下来——这个组件在三处用，
 * 逐层透传要穿四层 props（DashboardEditor → RightRail → InspectorPane → 面板）。
 *
 * ⚠ 注入的是**函数不是值**：外观字段组在 computed 里调用它，响应式依赖由那次
 * 调用建立；传一个取好的数组进来，样式库刷新了下拉也不会重算，且不报任何错。
 * ⚠ 不装就是「一条用户样式都没有」——只列内置那两档。这是个诚实的降级：
 * 样式库是个可选的增强，取不到它不该让外观面板整个不可用。
 */
import type { CardStyle } from '@dt/contracts'
import { inject, provide, type InjectionKey } from 'vue'

/** 取当前这一份用户样式；每次求值都重新调用它。 */
export type ReadCardStyles = () => readonly CardStyle[]

export const CARD_STYLE_LIBRARY_KEY: InjectionKey<ReadCardStyles> = Symbol(
  'dt-card-style-library',
)

const NONE: ReadCardStyles = () => []

/**
 * 给本子树装上样式库。须在 setup 内调用。
 * @param read 取当前样式表的函数
 */
export function provideCardStyles(read: ReadCardStyles): void {
  provide(CARD_STYLE_LIBRARY_KEY, read)
}

/** 取本子树的样式库；没装过就是空的。须在 setup 内调用。 */
export function useCardStyles(): ReadCardStyles {
  return inject(CARD_STYLE_LIBRARY_KEY, NONE)
}

/**
 * 这个模块能套哪些用户样式：通用外壳样式 + 绑了这个类型的那些。
 *
 * ⚠ 列了套不上的等于摆一个点下去只写一半的按钮：别的模块的内芯键在这里根本
 * 不存在，写进去既不报错也不生效。
 * @param styles 全部用户样式
 * @param moduleType 这个节点的模块类型；大屏级缺省面板给 null（那时只有外壳）
 */
export function stylesForModule(
  styles: readonly CardStyle[],
  moduleType: string | null,
): CardStyle[] {
  return styles.filter(
    (one) => one.moduleType === null || one.moduleType === moduleType,
  )
}
