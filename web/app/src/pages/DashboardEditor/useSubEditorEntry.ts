/**
 * @fileoverview 打开模块自带的整页子编辑器（清单上的 `subEditor` 声明）。
 *
 * ⚠ 子编辑器是另开一页、**直接落库**的。而本页手里可能攥着没保存的布局改动，
 * 一旦子编辑器落了库，服务端 `updatedAt` 就变了，本页的本地草稿会因版本对不上
 * 被静默丢弃——用户回来时改动没了，还没有任何提示。所以脏着的时候先问、
 * 先存成功再跳，绝不静默带走。
 */
import type { ModuleSubEditor } from '@dt/contracts'
import { provide } from 'vue'
import type { ComputedRef } from 'vue'
import { useRouter } from 'vue-router'

import { EDITOR_SUB_EDITOR_KEY } from '@/features/dashboard/editorContext'

export interface SubEditorEntryDeps {
  dashboardId: () => string
  /** 当前选中的节点；没选中时不该出现入口，这里再兜一次。 */
  selectedId: ComputedRef<string | null>
  /** 布局或元数据任一脏着都算脏。 */
  isDirty: () => boolean
  save: () => Promise<void>
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

/** 装上子编辑器入口，向属性面板下发打开函数。 */
export function useSubEditorEntry(deps: SubEditorEntryDeps): void {
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
      deps.toast.error(`打不开「${subEditor.label}」：路由 ${subEditor.routeName} 不存在`)
    }
  }

  provide(EDITOR_SUB_EDITOR_KEY, (subEditor) => void open(subEditor))
}
