<script setup lang="ts">
/**
 * @fileoverview 编辑器的三个浮层：挑点弹窗、快捷键帮助、全屏预览。
 * 只做转发；开关状态归页面持有。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { DesignSize, GetModuleManifest } from '@dt/runtime'

import type { CollectPoint } from '@/api/collect'
import EditorPreview from './EditorPreview.vue'
import PointPickerDialog from './PointPickerDialog.vue'
import ShortcutsDialog from './ShortcutsDialog.vue'

defineProps<{
  pickingFieldKey: string | null
  helpOpen: boolean
  previewOpen: boolean
  nodes: readonly DashboardNodePayload[]
  design: DesignSize
  getManifest: GetModuleManifest
  chromeJson: Record<string, unknown>
}>()

const emit = defineEmits<{
  'close-picker': [open: boolean]
  pick: [point: CollectPoint]
  'update:helpOpen': [open: boolean]
  'close-preview': []
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
</template>
