/**
 * @fileoverview 打开模块自带的整页子编辑器（清单上的 `subEditor` 声明）。
 *
 * ⚠ 子编辑器是另开一页、**直接落库**的。而本页手里可能攥着没保存的布局改动，
 * 一旦子编辑器落了库，服务端 `updatedAt` 就变了，本页的本地草稿会因版本对不上
 * 被静默丢弃——用户回来时改动没了，还没有任何提示。所以脏着的时候先问、
 * 先存成功再跳，绝不静默带走。
 */
import type { ModuleSubEditor } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { provide } from 'vue'
import type { ComputedRef } from 'vue'
import { useRouter } from 'vue-router'

import type { DashboardEditor } from '@/composables/useDashboardEditor'
import { EDITOR_SUB_EDITOR_KEY } from '@/features/dashboard/editorContext'

export interface SubEditorEntryDeps {
  dashboardId: () => string
  /** 当前选中的节点；没选中时不该出现入口，这里再兜一次。 */
  selectedId: ComputedRef<string | null>
  /** 布局或元数据任一脏着都算脏。 */
  isDirty: () => boolean
  /** 保存两条轴；回执由调用方各自解读，这里只等它跑完。 */
  save: () => Promise<unknown>
  confirm: {
    ask: (input: {
      title: string
      message: string
      confirmText: string
      danger: boolean
    }) => Promise<boolean>
  }
  toast: { error: (message: string) => void }
}

/**
 * 装上子编辑器入口：向属性面板下发打开函数，并把同一个函数交回给调用方——
 * 右键菜单那条走的是它。
 * ⚠ 两处必须落到同一个出口：各写一份的话，「先保存再跳」这条前置只会在其中一条上，
 * 而两条看起来一模一样。
 */
export function useSubEditorEntry(
  deps: SubEditorEntryDeps,
): (subEditor: ModuleSubEditor) => void {
  const router = useRouter()

  async function open(subEditor: ModuleSubEditor): Promise<void> {
    const nodeId = deps.selectedId.value
    if (nodeId === null) return

    if (deps.isDirty()) {
      const go = await deps.confirm.ask({
        title: '先保存当前改动',
        message:
          '孪生编辑器会直接保存到服务器。为免这里未保存的改动丢失，先保存一次再打开。',
        confirmText: '保存并打开',
        danger: false,
      })
      if (!go) return
      await deps.save()
      // save 自己会 toast 失败原因；这里只负责别在没存上的时候跳走
      if (deps.isDirty()) return
    }

    const target = {
      name: subEditor.routeName,
      params: { dashboardId: deps.dashboardId(), nodeId },
    }
    // ⚠ 路由名写错时 push 会抛，而不是静默不动——照实说出来，别让按钮点了没反应
    try {
      await router.push(target)
    } catch {
      deps.toast.error(
        `打不开「${subEditor.label}」：路由 ${subEditor.routeName} 不存在`,
      )
    }
  }

  const enter = (subEditor: ModuleSubEditor): void => void open(subEditor)
  provide(EDITOR_SUB_EDITOR_KEY, enter)
  return enter
}

/**
 * 进这个节点的子编辑器；没有声明子编辑器的节点什么都不做。右键菜单那条走它。
 * ⚠ 先选中再进：动作层按选中项走，用户也得看见是哪一个被打开了。
 * ⚠ 与属性面板落到**同一个** `enter`：各写一份的话，「先保存再跳」这条前置
 * 只会在其中一条上，而两条看起来一模一样。
 * @param editor 编辑器文档
 * @param getManifest 取模块清单
 * @param enter `useSubEditorEntry` 交回来的那个出口
 * @param nodeId 要进哪个节点
 */
export function openSubEditor(
  editor: DashboardEditor,
  getManifest: GetModuleManifest,
  enter: (subEditor: ModuleSubEditor) => void,
  nodeId: string,
): void {
  const node = editor.nodes.value.find((one) => one.id === nodeId)
  const sub =
    node === undefined ? undefined : getManifest(node.moduleType)?.subEditor
  if (sub === undefined) return
  editor.select(nodeId)
  editor.flush()
  enter(sub)
}
