<script setup lang="ts">
/**
 * @fileoverview 趋势图的公共面：范围控件 + 勾选清单 + 三条提示 + 一张折线图。
 * 点位历史与数据台账两个来源共用它，各自只管取数。
 *
 * ⚠ 曲线只在点「查询」之后变，不跟着勾选实时变。不说破的话，新勾的那一列
 * 要么画成一条空曲线（看着像「这列没数据」）、要么干脆不出现（看着像「没生效」），
 * 两种都会把人引去查采集，而实际上只是还没重查。
 * ⚠ 截断必须说清砍掉的是哪一头：曲线**开头**凭空少一截最容易被读成
 * 「那阵子采集坏了」（docs/DATASET_DESIGN.md §6.2）。
 * ⚠ 取数失败时**不画图**：一张空图与「这段时间确实没有数据」长得一模一样。
 */
import { computed } from 'vue'

import {
  DtButton,
  DtCheckbox,
  DtDateTimeInput,
  DtEmpty,
  DtLineChart,
  DtNotice,
  DtSelect,
} from '@dt/ui'
import type { DtSelectOption } from '@dt/contracts'
import type { DtChartSeries } from '@dt/ui'

import {
  MAX_TREND_SERIES,
  countTrendPoints,
  type TrendItem,
} from '@/features/trend/trendSeries'
import {
  TREND_RANGE_CUSTOM,
  TREND_RANGE_PRESETS,
  resolveTrendRange,
  type TrendRangeValue,
} from '@/features/trend/trendRange'

const props = defineProps<{
  /** 可勾的项；空数组即这一面根本没有画得出的东西。 */
  items: readonly TrendItem[]
  selected: readonly string[]
  series: readonly DtChartSeries[]
  loading: boolean
  /** 勾选已经超出上一次查询的结果。 */
  dirty: boolean
  /** 截断的那一句，没截断给 null。 */
  truncation: string | null
  /** 取数失败的那一句，有它就不画图。 */
  failure: string | null
  range: TrendRangeValue
  /** 一条都没勾时的引导语。 */
  blankHint: string
}>()

const emit = defineEmits<{
  toggle: [key: string]
  query: []
  'update:range': [range: TrendRangeValue]
}>()

const rangeOptions: readonly DtSelectOption[] = TREND_RANGE_PRESETS.map(
  (preset) => ({ value: preset.value, label: preset.label }),
)

const isCustom = computed(() => props.range.preset === TREND_RANGE_CUSTOM)
const isFull = computed(() => props.selected.length >= MAX_TREND_SERIES)
// ⚠ 传 0 当「现在」：预设档不看时钟就定得下合不合法，自定义档也只比两端的先后
const rangeProblem = computed(() => resolveTrendRange(props.range, 0).problem)
const canQuery = computed(
  () => props.selected.length > 0 && rangeProblem.value === null,
)
const pointCount = computed(() => countTrendPoints(props.series))

function patchRange(patch: Partial<TrendRangeValue>): void {
  emit('update:range', { ...props.range, ...patch })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <DtEmpty
      v-if="items.length === 0"
      icon="chart-line"
      title="没有可画的量"
      :hint="blankHint"
    />

    <template v-else>
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-40">
          <DtSelect
            :model-value="range.preset"
            :options="rangeOptions"
            label="时间范围"
            size="sm"
            :error="rangeProblem ?? undefined"
            @update:model-value="patchRange({ preset: $event })"
          />
        </div>
        <DtDateTimeInput
          v-if="isCustom"
          :model-value="range.from"
          label="开始"
          size="sm"
          @update:model-value="patchRange({ from: $event })"
        />
        <DtDateTimeInput
          v-if="isCustom"
          :model-value="range.to"
          label="结束"
          size="sm"
          @update:model-value="patchRange({ to: $event })"
        />
        <DtButton
          size="sm"
          icon="chart-line"
          :loading="loading"
          :disabled="!canQuery"
          @click="emit('query')"
        >
          查询
        </DtButton>
      </div>

      <fieldset class="flex flex-wrap items-center gap-x-4 gap-y-2">
        <legend class="sr-only">要画哪几条曲线</legend>
        <DtCheckbox
          v-for="item in items"
          :key="item.key"
          :model-value="selected.includes(item.key)"
          :label="item.label"
          :disabled="isFull && !selected.includes(item.key)"
          @update:model-value="emit('toggle', item.key)"
        />
      </fieldset>

      <p class="text-xs text-text-secondary">
        最多同时画 {{ MAX_TREND_SERIES }} 条；曲线上的缺口表示那一刻没有取值。
      </p>

      <DtNotice v-if="dirty" intent="warning" icon="alert-triangle">
        勾选已经变了，图上画的还是上一次查询的那几条。点「查询」刷新曲线。
      </DtNotice>

      <DtNotice v-if="truncation" intent="warning" icon="alert-triangle">
        {{ truncation }}
      </DtNotice>

      <DtNotice v-if="failure" intent="danger" icon="alert-circle">
        {{ failure }}
      </DtNotice>
      <DtNotice v-else-if="selected.length === 0" intent="info">
        勾选上面任意一项就能看到曲线。
      </DtNotice>
      <DtLineChart
        v-else
        class="min-h-0 flex-1"
        height="100%"
        :series="series"
        :loading="loading"
        aria-label="趋势曲线"
      />

      <p v-if="pointCount > 0" class="text-xs text-text-disabled">
        共 {{ pointCount }} 个数据点。
      </p>
    </template>
  </div>
</template>
