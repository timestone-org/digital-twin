<script setup lang="ts">
/**
 * @fileoverview 趋势分析页的「数据台账」源：先选一张台账，再画它的数值列。
 *
 * ⚠ 图表按 `tableId` 挂 `:key` 整体重建：勾选与已取序列都是它的内部状态，
 * 换表时留下任何一份，新表的图上就会挂着旧表那条看不出是旧的曲线。
 * ⚠ 深链指向的台账没了时只说一句、页面照常可用，**不当成加载失败**
 * （docs/DATASET_DESIGN.md §7.13）。
 * ⚠ 选表的下拉塞进图表左栏的 `filters` 插槽，而不是另起一行摆在图上方：
 * 「挑什么」的控件全在一处，图才留得住高度。
 */
import { onMounted, onUnmounted } from 'vue'

import { DtEmpty, DtNotice, DtSelect } from '@dt/ui'

import DatasetTrendChart from '@/components/trend/DatasetTrendChart.vue'
import { useDatasetPicker } from '../scripts/useDatasetPicker'

const props = defineProps<{
  /** 深链带来的预选台账，没带就是 null。 */
  initialTableId: string | null
}>()

const picker = useDatasetPicker()

onMounted(() => {
  void picker.load(props.initialTableId)
})

onUnmounted(picker.dispose)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <DtNotice
      v-if="picker.missingLink.value"
      intent="warning"
      icon="alert-triangle"
    >
      {{ picker.missingLink.value }}
    </DtNotice>

    <!-- 报错单独一格、不进下面的分支链：取列失败时选表框得留着，好换一张 -->
    <DtNotice v-if="picker.error.value" intent="danger" icon="alert-circle">
      {{ picker.error.value }}
    </DtNotice>
    <template v-if="picker.options.value.length === 0">
      <DtEmpty
        v-if="!picker.error.value"
        icon="table"
        title="还没有台账"
        hint="先去「数据台账」建一张，配好列之后这里才画得出曲线。"
      />
    </template>
    <DatasetTrendChart
      v-else-if="picker.tableId.value !== '' && !picker.error.value"
      :key="picker.tableId.value"
      :table-id="picker.tableId.value"
      :columns="picker.columns.value"
    >
      <template #filters>
        <DtSelect
          :model-value="picker.tableId.value"
          :options="picker.options.value"
          label="数据台账"
          size="sm"
          @update:model-value="picker.select($event)"
        />
      </template>
    </DatasetTrendChart>
    <template v-else>
      <div class="w-72">
        <DtSelect
          :model-value="picker.tableId.value"
          :options="picker.options.value"
          label="数据台账"
          size="sm"
          @update:model-value="picker.select($event)"
        />
      </div>
      <DtEmpty
        v-if="picker.tableId.value === ''"
        icon="chart-line"
        title="还没有选台账"
        hint="在上面挑一张台账就能看它的曲线。"
      />
    </template>
  </div>
</template>
