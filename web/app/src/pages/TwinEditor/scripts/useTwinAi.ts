/**
 * @fileoverview 把孪生编辑器接进助手。
 * 单独一层是为了让页面只写一行——它已经顶着 300 行的上限。
 */
import { useAiPanel, type AiPanel } from '@/composables/useAiPanel'
import type { TwinConfig } from '@dt/twin-config'

import { createTwinSurface } from './aiSurface'
import type { TwinEditorPage } from './useTwinEditorPage'
import type { TwinBindings } from './useTwinBindings'

/**
 * 装上助手面板。
 * @param page 这一页的取数与节点
 * @param binding 绑定表与写入口
 * @param config 归一化后的孪生配置；还没读出来时给 null
 * @param stage 3D 视口的宿主元素，截图的根；还没挂载时给 null
 */
export function useTwinAi(
  page: TwinEditorPage,
  binding: TwinBindings,
  config: () => TwinConfig | null,
  stage: () => HTMLElement | null,
): AiPanel {
  const nodeId = (): string => page.node.value?.id ?? ''
  return useAiPanel({
    surface: () =>
      createTwinSurface({
        config,
        bindings: () => binding.bindings.value,
        write: binding.write,
        nodeId,
        stage,
      }),
    refId: nodeId,
  })
}
