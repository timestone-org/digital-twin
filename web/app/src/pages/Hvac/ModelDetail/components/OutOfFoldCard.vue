<script setup lang="ts">
/**
 * @fileoverview 折外总览：散点 + 误差分布 + 按折稳定性 + 误差最大的 5 次。
 *
 * ⚠ 这里画的是**全量**折外预测，与 ⑥ 逐条表分开取：两者共用一页 20 条的话，
 * 一张 20 个点的散点根本不是这个模型的画像，用户会以为折外预测只有 20 条。
 * ⚠ 这个下拉是全页唯一的组合筛选控件：⑤ 表的行点击写回同一个取值，⑥ 表也读它。
 */
import { computed, ref } from 'vue'
import type { DtSegmentedOption, DtSelectOption } from '@dt/contracts'
import {
  DtCard,
  DtEmpty,
  DtHelpTip,
  DtNotice,
  DtSegmented,
  DtSelect,
  DtSpinner,
} from '@dt/ui'

import { formatSet } from '@/features/hvac/modelView'
import ErrorHistogram from './ErrorHistogram.vue'
import FoldStabilityBar from './FoldStabilityBar.vue'
import PredictionScatter from './PredictionScatter.vue'
import TopErrorList from './TopErrorList.vue'
import { SCATTER_MAX_ROWS, type OutOfFold } from '../useOutOfFold'

const CAP_HELP =
  `图上最多画 ${SCATTER_MAX_ROWS} 条：再多画下去点会糊成一片，浏览器也开始卡。` +
  '逐条表不受影响，它走服务端分页，是完整的。'

const SCALE_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'linear', label: '线性' },
  { value: 'sqrt', label: '压缩' },
]

const props = defineProps<{
  outOfFold: OutOfFold
  /** 模型的服务组合，过滤下拉的选项。 */
  sets: readonly (readonly string[])[]
  /** 当前过滤的组合键；空串 = 全部。 */
  filter: string
}>()

const emit = defineEmits<{ 'update:filter': [value: string] }>()

const scale = ref<'linear' | 'sqrt'>('linear')

const filterOptions = computed<DtSelectOption[]>(() => [
  { value: '', label: '全部组合' },
  ...props.sets.map((set) => ({
    value: formatSet(set),
    label: formatSet(set),
  })),
])

const loaded = computed(() => props.outOfFold.rows.value.length)
const total = computed(() => props.outOfFold.total.value)
const isCapped = computed(() => total.value > loaded.value)
const isBlank = computed(
  () =>
    !props.outOfFold.loading.value &&
    props.outOfFold.error.value === null &&
    loaded.value === 0,
)

function onScale(value: string): void {
  if (value === 'linear' || value === 'sqrt') scale.value = value
}
</script>

<template>
  <DtCard class="min-w-0">
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <h2 class="text-sm font-semibold text-text-primary">
        折外总览
        <span class="ml-1 text-xs font-normal text-text-secondary">
          全部来自折外预测：模型没见过答案的那次
        </span>
      </h2>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <DtSelect
          class="w-44"
          size="sm"
          :model-value="props.filter"
          :options="filterOptions"
          aria-label="按组合过滤"
          @update:model-value="emit('update:filter', $event)"
        />
        <DtSegmented
          :model-value="scale"
          :options="SCALE_OPTIONS"
          size="sm"
          aria-label="坐标刻度"
          @update:model-value="onScale"
        />
      </div>
    </div>

    <!-- ⚠ 图例必须有：四种着色的含义不能只靠悬停 title 猜 -->
    <ul
      class="m-0 mb-2 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-2xs text-text-secondary"
    >
      <li class="flex items-center gap-1">
        <span class="size-2 rounded-full bg-accent-primary/70" />热行命中
      </li>
      <li class="flex items-center gap-1">
        <span class="size-2 rounded-full bg-state-warning" />热行漏盖
      </li>
      <li class="flex items-center gap-1">
        <span class="size-2 rounded-full bg-text-disabled/40" />零行
      </li>
      <li class="flex items-center gap-1">
        <span class="h-2 w-4 rounded-sm bg-accent-primary/20" />±MAE 带
      </li>
    </ul>

    <DtNotice v-if="props.outOfFold.error.value" intent="danger">
      {{ props.outOfFold.error.value }}
      <button
        type="button"
        class="ml-2 underline"
        @click="props.outOfFold.reload()"
      >
        重试
      </button>
    </DtNotice>

    <DtEmpty
      v-else-if="isBlank"
      title="还没有折外预测"
      hint="训练完成后，这里画出每次开机的预测与实际。"
    />

    <template v-else>
      <div class="grid min-w-0 gap-4 xl:grid-cols-[24rem_minmax(0,1fr)]">
        <PredictionScatter
          :rows="props.outOfFold.filtered.value"
          :hot-mae="props.outOfFold.hotMae.value"
          :scale="scale"
        />
        <div class="flex min-w-0 flex-col gap-4">
          <ErrorHistogram
            :rows="props.outOfFold.hotRows.value"
            :hot-mae="props.outOfFold.hotMae.value"
          />
          <FoldStabilityBar :stats="props.outOfFold.foldStats.value" />
        </div>
      </div>

      <div class="mt-3">
        <TopErrorList :rows="props.outOfFold.topErrors.value" />
      </div>
    </template>

    <p class="mt-2 flex items-center gap-1 text-2xs text-text-disabled">
      <template v-if="props.outOfFold.loading.value">
        <DtSpinner :size="12" />
        已载入 {{ loaded }} / {{ total }} 条…
      </template>
      <template v-else-if="isCapped">
        共 {{ total }} 条折外预测，图上画了 {{ loaded }} 条（超出部分未画）
        <DtHelpTip label="为什么有上限" :text="CAP_HELP" />
      </template>
      <template v-else>
        共 {{ total }} 条折外预测，图上画了 {{ loaded }} 条
      </template>
    </p>
  </DtCard>
</template>
