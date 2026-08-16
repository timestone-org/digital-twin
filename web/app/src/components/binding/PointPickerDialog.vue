<script setup lang="ts">
/**
 * @fileoverview 挑点位的弹窗：按关键字搜采集点位，选中的写回绑定。
 * ⚠ 关键字连着敲会连着发请求，取数在 `usePointPicker` 里防了竞态；
 * 这里只负责在打开时搜一次、关闭时把在途请求掐掉。
 */
import {
  DtButton,
  DtEmpty,
  DtIcon,
  DtInput,
  DtModal,
  DtNotice,
  DtSpinner,
  DtTag,
} from '@dt/ui'
import { onUnmounted, watch } from 'vue'

import type { CollectPoint } from '@dt/contracts'
import { usePointPicker } from '@/composables/usePointPicker'

const props = defineProps<{ modelValue: boolean; fieldKey: string | null }>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  pick: [point: CollectPoint]
}>()

const picker = usePointPicker()

watch(
  () => props.modelValue,
  (open) => {
    if (open) void picker.search()
    else picker.dispose()
  },
)

// ⚠ 组件卸载时也要掐：弹窗开着的时候切走大屏，在途那次回来会写一个已经不在的状态
onUnmounted(picker.dispose)

function choose(point: CollectPoint): void {
  emit('pick', point)
  emit('update:modelValue', false)
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="挑一个采集点位"
    :description="fieldKey ?? undefined"
    width="40rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex max-h-[24rem] flex-col gap-3">
      <DtInput
        v-model="picker.keyword.value"
        size="sm"
        placeholder="按名称或编码搜索"
        @enter="picker.search()"
      >
        <template #leading><DtIcon name="search" :size="14" /></template>
      </DtInput>

      <DtNotice v-if="picker.error.value" intent="danger" icon="alert-triangle">
        {{ picker.error.value }}
      </DtNotice>
      <DtSpinner v-else-if="picker.loading.value" />
      <DtEmpty
        v-else-if="picker.items.value.length === 0"
        icon="search"
        title="没有匹配的点位"
        hint="换个关键字试试"
      />
      <div v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <button
          v-for="point in picker.items.value"
          :key="point.id"
          type="button"
          class="dt-pick__item"
          @click="choose(point)"
        >
          <span class="flex-1 truncate">{{ point.name }}</span>
          <DtTag size="sm" intent="neutral">{{ point.code }}</DtTag>
        </button>
      </div>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-pick__item {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 6px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-panel);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;

  &:hover {
    border-color: var(--accent-primary);
  }
}
</style>
