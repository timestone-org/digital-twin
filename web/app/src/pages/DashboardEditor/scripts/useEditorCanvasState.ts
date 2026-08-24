/**
 * @fileoverview 大屏编辑画布的尺寸、缩放与组件句柄状态。
 */
import type { DashboardPayload } from '@dt/contracts'
import { designSize } from '@dt/runtime'
import { computed, ref, type Ref } from 'vue'

import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import type EditorCanvas from '../components/EditorCanvas.vue'

export function useEditorCanvasState(
  dashboard: Readonly<Ref<DashboardPayload | null>>,
) {
  const design = computed(() =>
    designSize(
      dashboard.value?.designWidth ?? 0,
      dashboard.value?.designHeight ?? 0,
    ),
  )
  const zoom = ref<CanvasZoom>(null)
  const canvasRef = ref<InstanceType<typeof EditorCanvas> | null>(null)
  const fitScale = computed(() => canvasRef.value?.fitScale ?? 1)
  const centerOn = (nodeId: string): void =>
    void canvasRef.value?.centerOn(nodeId)

  return { design, zoom, canvasRef, fitScale, centerOn }
}
