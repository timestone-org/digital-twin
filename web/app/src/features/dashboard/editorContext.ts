/**
 * @fileoverview 编辑器向配置控件下发上下文的缝：控件既不认识路由也不持有大屏文档，
 * 需要按项目取数（挑另一张大屏这类）时只认这一个注入键。
 */
import { inject, type InjectionKey, type Ref } from 'vue'
import type { ModuleSubEditor } from '@dt/contracts'

/** 正在编辑的大屏属于哪个项目；不在编辑器里挂载时取不到。 */
export const EDITOR_PROJECT_ID_KEY: InjectionKey<Ref<string | null>> = Symbol(
  'dt-editor-project-id',
)

/**
 * 取当前项目 id 的引用；没人下发时给 `null`。
 * ⚠ 拿到 `null` 的一方必须**说出来**，不许当成「这个项目下没有东西」——
 * 一个空下拉和一次没查成，用户分不出来。
 */
export function useEditorProjectId(): Ref<string | null> | null {
  return inject(EDITOR_PROJECT_ID_KEY, null)
}

/** 打开某个模块的整页子编辑器。 */
export type OpenSubEditor = (subEditor: ModuleSubEditor) => void

/**
 * 子编辑器的入口。属性面板只认这一个注入键，路由与保存都归编辑器页面管。
 * ⚠ 子编辑器是另开一页、直接落库的，而编辑器页面手里可能攥着未保存的布局改动——
 * 落库会让本地草稿因版本对不上被丢弃。所以下发方**必须**先处理脏状态再跳，
 * 不能让这一步静默吃掉用户没保存的改动。
 */
export const EDITOR_SUB_EDITOR_KEY: InjectionKey<OpenSubEditor> = Symbol(
  'dt-editor-sub-editor',
)

/** 取子编辑器入口；不在编辑器里挂载时给 `null`，此时不该画入口按钮。 */
export function useOpenSubEditor(): OpenSubEditor | null {
  return inject(EDITOR_SUB_EDITOR_KEY, null)
}
