/**
 * @fileoverview 编辑器向配置控件下发上下文的缝：控件既不认识路由也不持有大屏文档，
 * 需要按项目取数（挑另一张大屏这类）时只认这一个注入键。
 */
import { inject, type InjectionKey, type Ref } from 'vue'

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
