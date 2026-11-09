/**
 * @fileoverview 大屏编辑画布的尺寸、缩放与组件句柄状态。
 */
import type { DashboardPayload } from '@dt/contracts'
import { designSize } from '@dt/runtime'
import { computed, ref, type Ref } from 'vue'

import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { clampDesignExtent } from '@/features/dashboard/designExtent'
import type EditorCanvas from '../components/EditorCanvas.vue'
import type { EditorMetaDraft } from './useEditorMeta'

/**
 * 画布的设计尺寸先读页面设置的草稿：右栏一改，画布、吸附与钉位几何当场跟着变。
 * @param dashboard 已保存的大屏载荷
 * @param draft 页面设置的元数据草稿
 */
export function useEditorCanvasState(
  dashboard: Readonly<Ref<DashboardPayload | null>>,
  draft: Readonly<Ref<EditorMetaDraft | null>>,
) {
  const extentOf = (value: number | undefined): number =>
    value === undefined ? 0 : clampDesignExtent(value)
  const design = computed(() =>
    designSize(
      extentOf(draft.value?.designWidth ?? dashboard.value?.designWidth),
      extentOf(draft.value?.designHeight ?? dashboard.value?.designHeight),
    ),
  )
  const zoom = ref<CanvasZoom>(null)
  const canvasRef = ref<InstanceType<typeof EditorCanvas> | null>(null)
  const fitScale = computed(() => canvasRef.value?.fitScale ?? 1)
  const centerOn = (nodeId: string): void =>
    void canvasRef.value?.centerOn(nodeId)

  return { design, zoom, canvasRef, fitScale, centerOn }
}
