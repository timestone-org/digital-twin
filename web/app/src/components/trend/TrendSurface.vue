<script setup lang="ts">
/**
 * @fileoverview 趋势图的公共面：顶上一条时间范围工具条，左边一栏勾选清单，
 * 右边一张占满剩余高度的折线图。点位历史与数据台账两个来源共用它，各自只管
 * 取数，各自的筛选控件从 `filters` 插槽塞进左栏。
 *
 * ⚠ 勾选清单**必须自己滚**，不能跟着页面一路铺下去：现场一个数据源几十上百个
 * 点位，平铺开就是一堵墙，把下面那张图挤成一条缝——而图才是这一页的正事。
 * ⚠ 曲线只在点「查询」之后变，不跟着勾选实时变。不说破的话，新勾的那一列
 * 要么画成一条空曲线（看着像「这列没数据」）、要么干脆不出现（看着像「没生效」），
 * 两种都会把人引去查采集，而实际上只是还没重查。
 * ⚠ 截断必须说清砍掉的是哪一头：曲线**开头**凭空少一截最容易被读成
 * 「那阵子采集坏了」（docs/DATASET_DESIGN.md §6.2）。
 * ⚠ 取数失败时**不画图**：一张空图与「这段时间确实没有数据」长得一模一样。
 * ⚠ 范围不合法的那句话摆在工具条**下面**，不走 `DtSelect` 的 `error`：
 * `DtField` 把错误渲染在控件底下，而这一行是 `items-end` 对齐的——一格长高
 * 就把它自己的控件顶上去，整条工具条当场错位。同理，这一行里任何控件都不许
 * 带 `error` / `hint`。
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

import { MAX_TREND_SERIES, type TrendItem } from '@/features/trend/trendSeries'
import {
  TREND_RANGE_CUSTOM,
  TREND_RANGE_PRESETS,
  resolveTrendRange,
  type TrendRangeValue,
} from '@/features/trend/trendRange'

const props = defineProps<{
  /** 可勾的项；空数组即这一面眼下没有画得出的东西。 */
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
  /** 一条可勾的都没有时的引导语。 */
  blankHint: string
  /** 图底下那一行说明，例如这次用的桶宽。没有就不占位。 */
  footnote?: string | undefined
}>()

const emit = defineEmits<{
  toggle: [key: string]
  clear: []
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

function patchRange(patch: Partial<TrendRangeValue>): void {
  emit('update:range', { ...props.range, ...patch })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex flex-col gap-1.5">
      <div class="flex flex-wrap items-end gap-3">
        <div class="w-40">
          <DtSelect
            :model-value="range.preset"
            :options="rangeOptions"
            label="时间范围"
            size="sm"
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
        <slot name="options" />
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

      <p v-if="rangeProblem" class="text-xs text-state-danger" role="alert">
        {{ rangeProblem }}
      </p>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
      <aside class="flex min-h-0 shrink-0 flex-col gap-2 xl:w-72">
        <slot name="filters" />

        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-text-secondary">
            已选 {{ selected.length }} / {{ MAX_TREND_SERIES }} 条
          </span>
          <DtButton
            variant="ghost"
            intent="neutral"
            size="xs"
            :disabled="selected.length === 0"
            @click="emit('clear')"
          >
            清空
          </DtButton>
        </div>

        <fieldset
          class="min-h-0 max-h-48 flex-1 overflow-y-auto rounded-md border border-border-subtle bg-surface-sunken/40 p-2 xl:max-h-none"
        >
          <legend class="sr-only">要画哪几条曲线</legend>
          <DtEmpty
            v-if="items.length === 0"
            size="inline"
            icon="chart-line"
            title="没有可画的量"
            :hint="blankHint"
          />
          <DtCheckbox
            v-for="item in items"
            v-else
            :key="item.key"
            class="w-full py-1"
            :title="item.label"
            :model-value="selected.includes(item.key)"
            :label="item.label"
            :disabled="isFull && !selected.includes(item.key)"
            @update:model-value="emit('toggle', item.key)"
          />
        </fieldset>

        <p class="text-xs text-text-disabled">
          {{
            isFull
              ? `最多同时画 ${MAX_TREND_SERIES} 条，要换别的先取消一条。`
              : `最多同时画 ${MAX_TREND_SERIES} 条；曲线上的缺口表示那一段没有取到值。`
          }}
        </p>
      </aside>

      <section class="flex min-h-0 flex-1 flex-col gap-2">
        <DtNotice v-if="dirty" intent="warning" icon="alert-triangle">
          勾选已经变了，图上画的还是上一次查询的那几条。点「查询」刷新曲线。
        </DtNotice>

        <DtNotice v-if="truncation" intent="warning" icon="alert-triangle">
          {{ truncation }}
        </DtNotice>

        <DtNotice v-if="failure" intent="danger" icon="alert-circle">
          {{ failure }}
        </DtNotice>
        <DtEmpty
          v-else-if="selected.length === 0"
          class="min-h-0 flex-1"
          icon="chart-line"
          title="还没有勾选要画的量"
          hint="在左边勾上任意一项，再点「查询」就能看到曲线。"
        />
        <DtLineChart
          v-else
          class="min-h-0 flex-1"
          height="100%"
          :series="series"
          :loading="loading"
          aria-label="趋势曲线"
        />

        <p v-if="footnote" class="text-xs text-text-disabled">
          {{ footnote }}
        </p>
      </section>
    </div>
  </div>
</template>
