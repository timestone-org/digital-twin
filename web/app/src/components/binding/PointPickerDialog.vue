<script setup lang="ts">
/** @fileoverview 配置点位选择弹窗：自然语言检索、数据源筛选与绑定回填。 */
import {
  DtButton,
  DtEmpty,
  DtIcon,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtSpinner,
  DtSwitch,
} from '@dt/ui'
import { computed, onUnmounted, watch } from 'vue'

import PointPickerItem from './PointPickerItem.vue'

import type { CollectPoint, PointMatchOut } from '@dt/contracts'
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

const picker = usePointPicker(true)
const candidates = computed(
  () => picker.matches.value?.items ?? picker.items.value,
)

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

async function choose(point: CollectPoint | PointMatchOut): Promise<void> {
  const selected = await picker.resolve(point)
  if (selected === null) return
  emit('pick', selected)
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
      <div class="flex flex-wrap items-center gap-2">
        <DtSwitch
          v-model="picker.semantic.value"
          size="sm"
          label="智能检索"
          @update:model-value="picker.search()"
        />
        <span class="text-xs text-text-secondary"
          >支持设备、位置和测量量描述，例如“余热回收水箱温度”</span
        >
      </div>
      <div class="flex flex-wrap gap-2">
        <DtSelect
          :model-value="picker.sourceId.value"
          :options="picker.sourceOptions.value"
          size="sm"
          aria-label="数据源"
          class="w-44 max-w-full"
          @update:model-value="onSource"
        />
        <DtInput
          v-model="picker.keyword.value"
          size="sm"
          class="min-w-48 flex-1"
          aria-label="搜索点位"
          :maxlength="picker.semantic.value ? 300 : undefined"
          :placeholder="
            picker.semantic.value
              ? '描述要找的点位，回车搜索'
              : '按名称或编码搜索'
          "
          @enter="picker.search()"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
        <DtButton
          size="sm"
          icon="search"
          :loading="picker.loading.value"
          @click="picker.search()"
          >搜索</DtButton
        >
      </div>

      <DtNotice
        v-if="picker.sourceError.value"
        intent="warning"
        icon="alert-circle"
      >
        数据源清单没取到（{{ picker.sourceError.value }}），仍可搜索点位。
      </DtNotice>

      <DtNotice
        v-if="picker.matches.value?.note"
        intent="warning"
        icon="alert-circle"
      >
        {{ picker.matches.value.note }}
      </DtNotice>
      <p v-if="picker.matches.value" class="text-xs text-text-secondary">
        {{
          picker.matches.value.mode === 'hybrid'
            ? '已结合语义与关键词检索'
            : '本次按关键词检索'
        }}，按相关性显示候选；请核对名称、编码与数据源。
      </p>
      <DtNotice v-if="picker.error.value" intent="danger" icon="alert-triangle">
        {{ picker.error.value }}
      </DtNotice>
      <DtSpinner v-else-if="picker.loading.value" />
      <DtEmpty
        v-else-if="candidates.length === 0"
        icon="search"
        title="没有匹配的点位"
        hint="试试设备名、位置、测量量或准确编码"
      />
      <div v-else class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <PointPickerItem
          v-for="point in candidates"
          :key="point.id"
          :point="point"
          :source-name="picker.sourceName(point.source_id)"
          :disabled="picker.selecting.value"
          @pick="choose(point)"
        />
      </div>

      <p v-if="picker.hasMore.value" class="dt-pick__more">
        共 {{ picker.total.value }} 个点位，只列出前
        {{ POINT_PICKER_PAGE_SIZE }} 个；用数据源或关键字缩小范围。
      </p>
    </div>

    <template #footer>
      <DtButton variant="ghost" @click="emit('update:modelValue', false)">
        取消
      </DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-pick__more {
  color: var(--text-secondary);
}
</style>
