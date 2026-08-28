<script setup lang="ts">
/**
 * @fileoverview 孪生编辑器的浮层：批量加部件、挑点弹窗，外加助手面板。
 * 只做转发；状态全归页面持有。
 *
 * ⚠ 助手在这一页截得了图，但走的不是截图库直读：整块视口是 WebGL，直读取到的
 * 一定是空的，所以插一张场景登记的快照替身（见 `scripts/aiSurface.ts` 的文件头）。
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

// ⚠ 开关状态归页面持有，这里只上抛。就地写 `bulk.open.value = $event` 是改
// prop 上挂着的那只 ref——能跑，但状态的归属从此有两处，而 vue 的 lint 拦它
const emit = defineEmits<{
  'add-parts': [names: readonly string[]]
  'update:bulk-open': [open: boolean]
}>()
</script>

<template>
  <BulkPartsDialog
    :open="bulk.open.value"
    :candidates="bulk.candidates.value"
    @update:open="emit('update:bulk-open', $event)"
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
    surface-label="孪生编辑器"
    hint="助手改的是草稿；它自己会问你要不要保存，保存之后实时读数才认得新绑的点位。"
    :starters="[
      '把选中的这个实体绑到对应的点位',
      '照着 1 号机组，把 2 号机组的点位接一遍',
      '这段孪生现在有几行没接上？都在等什么',
      '截一张当前场景，讲讲你看到了什么',
    ]"
  />
</template>
