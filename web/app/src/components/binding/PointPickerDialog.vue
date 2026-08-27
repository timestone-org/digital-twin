<script setup lang="ts">
/**
 * @fileoverview 挑点位的弹窗：按数据源与关键字搜采集点位，选中的写回绑定。
 * ⚠ 关键字连着敲会连着发请求，取数在 `usePointPicker` 里防了竞态；
 * 这里只负责在打开时搜一次、关闭时把在途请求掐掉。
 * ⚠ 一页只列得下前几个，列不全时必须把总数说出来：不说的话，用户会以为
 * 看到的就是全部，然后在清单里找一个明明存在的点位怎么也找不到。
 */
import {
  DtButton,
  DtEmpty,
  DtIcon,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtSpinner,
  DtTag,
} from '@dt/ui'
import { onUnmounted, watch } from 'vue'

import type { CollectPoint } from '@dt/contracts'
import {
  POINT_PICKER_PAGE_SIZE,
  usePointPicker,
} from '@/composables/usePointPicker'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    fieldKey: string | null
    /**
     * 叠放层级，原样交给 DtModal。
     * ⚠ 从另一个弹窗里打开这个面板时必须给 `confirm`：同层的两个弹窗 z-index
     * 相同，谁在上只由 body 里的先后决定，表现是「挑点位点了没反应」。
     */
    layer?: 'modal' | 'confirm'
  }>(),
  { layer: 'modal' },
)

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  pick: [point: CollectPoint]
}>()

const picker = usePointPicker()

watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      picker.dispose()
      return
    }
    void picker.loadSources()
    void picker.search()
  },
)

// ⚠ 组件卸载时也要掐：弹窗开着的时候切走大屏，在途那次回来会写一个已经不在的状态
onUnmounted(picker.dispose)

/** 换数据源即重搜：筛选条件留在界面上却不生效，比没有筛选更误导。 */
function onSource(value: string): void {
  picker.sourceId.value = value
  void picker.search()
}

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
    :layer="props.layer"
    width="40rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex max-h-96 flex-col gap-3">
      <div class="flex gap-2">
        <DtSelect
          :model-value="picker.sourceId.value"
          :options="picker.sourceOptions.value"
          size="sm"
          aria-label="数据源"
          class="w-56 shrink-0"
          @update:model-value="onSource"
        />
        <DtInput
          v-model="picker.keyword.value"
          size="sm"
          class="flex-1"
          placeholder="按名称或编码搜索"
          @enter="picker.search()"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
      </div>

      <DtNotice
        v-if="picker.sourceError.value"
        intent="warning"
        icon="alert-circle"
      >
        数据源清单没取到（{{ picker.sourceError.value }}），只能按关键字搜。
      </DtNotice>

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
          <span
            v-if="picker.sourceName(point.source_id) !== ''"
            class="dt-pick__source"
          >
            {{ picker.sourceName(point.source_id) }}
          </span>
          <DtTag size="sm" intent="neutral">{{ point.code }}</DtTag>
        </button>
      </div>

      <p v-if="picker.hasMore.value" class="dt-pick__more">
        共 {{ picker.total.value }} 个点位，只列出前
        {{ POINT_PICKER_PAGE_SIZE }} 个；用数据源或关键字缩小范围。
      </p>
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

.dt-pick__source {
  flex-shrink: 0;
  max-width: 10rem;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--text-secondary);
}

.dt-pick__more {
  color: var(--text-secondary);
}
</style>
