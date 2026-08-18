<script setup lang="ts">
/**
 * @fileoverview 编辑器的四个浮层：挑点弹窗、快捷键帮助、全屏预览、画布右键菜单。
 * 只做转发；开关状态归页面持有。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { CollectPoint } from '@dt/contracts'
import type { ContextMenuAction } from '../scripts/contextMenuItems'
import type { ContextMenuState } from '../scripts/useEditorContextMenu'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
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
</template>
