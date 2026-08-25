<script setup lang="ts">
/**
 * @fileoverview 编辑器的浮层：挑点弹窗、快捷键帮助、全屏预览、画布右键菜单，
 * 外加助手面板。只做转发；开关状态归页面持有。
 *
 * ⚠ 助手压在 dropdown 之上、modal 之下（`--z-assistant`）：它是常驻的工作面
 * 而不是弹窗，挑点弹窗这类业务浮层仍要能盖住它。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { CollectPoint } from '@dt/contracts'
import type { ContextMenuAction } from '../scripts/contextMenuItems'
import type { ContextMenuState } from '../scripts/useEditorContextMenu'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
import AiDock from '@/components/ai/AiDock.vue'
import type { AiPanel } from '@/composables/useAiPanel'
import CanvasContextMenu from './CanvasContextMenu.vue'
import EditorPreview from './EditorPreview.vue'
import ShortcutsDialog from './ShortcutsDialog.vue'

defineProps<{
  pickingFieldKey: string | null
  helpOpen: boolean
  previewOpen: boolean
  nodes: readonly DashboardNodePayload[]
  design: DesignSize
  getManifest: GetModuleManifest
  chromeJson: Record<string, unknown>
  contextMenu: ContextMenuState | null
  ai: AiPanel
}>()

const emit = defineEmits<{
  'close-picker': [open: boolean]
  pick: [point: CollectPoint]
  'update:helpOpen': [open: boolean]
  'close-preview': []
  'menu-pick': [action: ContextMenuAction]
  'close-menu': []
}>()
</script>

<template>
  <PointPickerDialog
    :model-value="pickingFieldKey !== null"
    :field-key="pickingFieldKey"
    @update:model-value="emit('close-picker', $event)"
    @pick="emit('pick', $event)"
  />
  <ShortcutsDialog
    :open="helpOpen"
    @update:open="emit('update:helpOpen', $event)"
  />
  <EditorPreview
    v-if="previewOpen"
    :nodes="nodes"
    :design="design"
    :get-manifest="getManifest"
    :chrome-json="chromeJson"
    @close="emit('close-preview')"
  />
  <CanvasContextMenu
    :menu="contextMenu"
    @pick="emit('menu-pick', $event)"
    @close="emit('close-menu')"
  />

  <AiDock
    :ai="ai"
    surface-label="大屏编辑器"
    hint="助手改的是草稿，保存要你自己按。"
  />
</template>
