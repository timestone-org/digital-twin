/**
 * @fileoverview 把孪生编辑器的配置、绑定、视口与保存能力接进助手。
 * 单独一层是为了让页面只写一行——接线细节不摊进那份单文件组件。
 *
 * ⚠ 保存接页面**现有**的那条路径：落库走大屏的整树替换，漏一个节点就是把它
 * 删了，只有那一份是对的。
 * ⚠ 保存失败（含 409 冲突）一律抛：静默吞掉会让模型接着往下绑，而每一条都存
 * 不进去。
 */
import { getModule } from '@dt/modules'
import type { TwinConfig } from '@dt/twin-config'

import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import type { SaveOutcome } from '@/features/ai/saveTool'
import { nodeLabelOf } from '@/features/dashboard/nodeLabel'

import { createTwinSurface } from './aiSurface'
import type { TwinSelection } from './types'
import type { TwinEditorPage } from './useTwinEditorPage'
import type { TwinBindings } from './useTwinBindings'

/**
 * 装上助手面板。
 * @param page 这一页的取数、节点与落库
 * @param binding 绑定表、写入口与视口那份快照缓存
 * @param config 归一化后的孪生配置；还没读出来时给 null
 * @param selection 用户此刻在大纲里选中的那一个
 * @param stage 3D 视口的宿主元素，截图的根；还没挂载时给 null
 */
export function useTwinAi(
  page: TwinEditorPage,
  binding: TwinBindings,
  config: () => TwinConfig | null,
  selection: () => TwinSelection,
  stage: () => HTMLElement | null,
): AiPanel {
  const nodeId = (): string => page.node.value?.id ?? ''
  return useAiPanel({
    surface: () =>
      createTwinSurface({
        config,
        patchConfig: (next) => {
          const doc = page.doc.value
          if (doc === null) throw new Error('孪生配置还没读出来')
          doc.commit(next)
        },
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
        stage,
        read: binding.readSample,
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
async function saveOnce(page: TwinEditorPage): Promise<SaveOutcome> {
  const isSaved = await page.save()
  return { isSaved, message: page.conflict.value }
}
