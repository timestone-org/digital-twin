<script setup lang="ts">
/**
 * @fileoverview 孪生编辑器的浮层：批量加部件、挑点弹窗，外加助手面板。
 * 只做转发；状态全归页面持有。
 *
 * ⚠ 助手在这一页**只有绑点**，没有截图：整块视口是 WebGL，截图库取到的一定
 * 是空的（见 `scripts/aiSurface.ts` 的文件头）。
 */
import type { BulkParts } from '../scripts/useBulkParts'
import type { TwinBindings } from '../scripts/useTwinBindings'
import AiDock from '@/components/ai/AiDock.vue'
import PointPickerDialog from '@/components/binding/PointPickerDialog.vue'
import type { AiPanel } from '@/composables/useAiPanel'
import BulkPartsDialog from './BulkPartsDialog.vue'

defineProps<{
  bulk: BulkParts
  binding: TwinBindings
  ai: AiPanel
}>()

const emit = defineEmits<{ 'add-parts': [names: readonly string[]] }>()
</script>

<template>
  <BulkPartsDialog
    :open="bulk.open.value"
    :candidates="bulk.candidates.value"
    :preselect="bulk.preselect.value"
    @update:open="bulk.open.value = $event"
    @confirm="emit('add-parts', $event)"
  />

  <PointPickerDialog
    :model-value="binding.pickingFieldKey.value !== null"
    :field-key="binding.pickingFieldKey.value"
    @update:model-value="binding.closePicker"
    @pick="binding.pickPoint"
  />

  <AiDock
    :ai="ai"
    surface-kind="twin-editor"
    surface-label="孪生编辑器"
    hint="助手改的是草稿，保存要你自己按。"
  />
</template>
