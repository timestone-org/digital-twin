<script setup lang="ts">
/**
 * @fileoverview 模板库：浏览全部整屏模板，点一张就是「用它新建」，
 * 有删除码的人还能删。取数在 `TemplateGallery` 里，删除的二次确认与落库在父页面。
 *
 * ⚠ `reload` 透出给父页面：删成功后不刷一次，被删掉的那张模板会一直挂在网格里。
 */
import { ref } from 'vue'
import { DtButton, DtModal } from '@dt/ui'
import type { DashboardTemplateSummary } from '@dt/contracts'

import TemplateGallery from './TemplateGallery.vue'

defineProps<{ open: boolean; canDelete: boolean }>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  use: [template: DashboardTemplateSummary]
  delete: [template: DashboardTemplateSummary]
}>()

const gallery = ref<InstanceType<typeof TemplateGallery> | null>(null)

/** 父页面删完模板后调，重新取一次列表。 */
function reload(): void {
  gallery.value?.reload()
}

defineExpose({ reload })
</script>

<template>
  <DtModal
    :model-value="open"
    title="模板库"
    :description="
      canDelete
        ? '点一张模板即可基于它新建大屏；卡片右上角可删除模板。'
        : '点一张模板即可基于它新建大屏。'
    "
    width="52rem"
    @update:model-value="emit('update:open', $event)"
  >
    <TemplateGallery
      ref="gallery"
      :active="open"
      :deletable="canDelete"
      @select="emit('use', $event)"
      @delete="emit('delete', $event)"
    />

    <template #footer>
      <DtButton size="sm" @click="emit('update:open', false)">关闭</DtButton>
    </template>
  </DtModal>
</template>
