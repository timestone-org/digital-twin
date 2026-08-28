/**
 * @fileoverview 把 2D 孪生编辑器接进助手。
 * 单独一层是为了让页面只写一行——接线细节不摊进那份单文件组件。
 *
 * ⚠ 保存接页面**现有**的那条路径：落库走大屏的整树替换，漏一个节点就是把它
 * 删了，只有那一份是对的。
 * ⚠ 保存失败（含 409 冲突）一律抛：静默吞掉会让模型接着往下绑，而每一条都存
 * 不进去。
 */
import { getModule } from '@dt/modules'

import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import type { SaveOutcome } from '@/features/ai/saveTool'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'

import { createTwin2dSurface } from './aiSurface'
import type { Twin2dEditorSelection } from './editorSelection'
import type { Twin2dBindings } from './useTwin2dBindings'
import type { Twin2dEditorPage } from './useTwin2dEditorPage'

/** 空态里那几句开场，按这一页真有的能力写。 */
export const TWIN_2D_AI_STARTERS: readonly string[] = [
  '把我选中的这几个节点接到对应的点位',
  '照着这一台，把另一台的点位接一遍',
  '这张图现在有几行没接上？都在等什么',
]

/**
 * 装上助手面板。须在 setup 内调用。
 * @param page 这一页的取数、节点与落库
 * @param binding 绑定表、写入口与画中画那份快照缓存
 * @param selection 画布上那一条选中轴
 */
export function useTwin2dAi(
  page: Twin2dEditorPage,
  binding: Twin2dBindings,
  selection: Twin2dEditorSelection,
): AiPanel {
  const nodeId = (): string => page.node.value?.id ?? ''
  return useAiPanel({
    surface: () =>
      createTwin2dSurface({
        config: () => page.doc.value?.config.value ?? null,
        bindings: () => binding.bindings.value,
        write: binding.write,
        drop: binding.drop,
        nodeId,
        nodeLabel: () => {
          const node = page.node.value
          return node === null ? '' : nodeLabelOf(node, getModule)
        },
        moduleType: () => page.node.value?.moduleType ?? '',
        selection,
        read: binding.live.read,
        save: () => saveOnce(page),
        savedVersion: () => page.dashboard.value?.rowVersion ?? null,
      }),
    refId: nodeId,
  })
}

/**
 * 跑一次页面自己的保存，把结论收成工具那一层要的形状。
 * ⚠ 冲突文案要在保存**之后**读：`conflict` 是这一次保存写进去的，先读一定是
 * 上一次那句，或者干脆是空的。
 * @param page 这一页的落库
 */
async function saveOnce(page: Twin2dEditorPage): Promise<SaveOutcome> {
  const isSaved = await page.save()
  return { isSaved, message: page.conflict.value }
}
