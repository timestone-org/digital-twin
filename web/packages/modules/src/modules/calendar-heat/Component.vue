<script setup lang="ts">
/**
 * @fileoverview calendar-heat 的渲染：读一次配置与注入袋收成 `MetricView[]`，
 * 再把「出 option」这件事交给 `option.ts`，本文件只做接线。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `days.ts` 里不算数。
 * ⚠ `watchValues` 收的是**函数**，配 `valuesDeep: false` 用：传解包后的整袋值是
 * 类型错，而缺省的深度 watch 会把四张 × 三百多天逐键遍历一遍。
 * ⚠ `partialMerge` 把坐标一起带上：日期跨度、色阶端点与逐张标题全是从实时值派生的，
 * 只换 series 会让日历框停在第一帧的跨度上，而格子按新跨度落位——整片错格。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import type { ChartBuild } from '../../shared/chart/chartKit'
import ChartShell from '../../shared/chart/ChartShell.vue'
import {
  ariaSummaryOf,
  buildMetricViews,
  DAY_SLOT_KEY,
  emptyStateOf,
  signatureOf,
} from './days'
import { buildCalendarOption, pickedMetricValue } from './option'

/** 值变时替换这几个键：标题承载逐张状态，坐标与色标都随取回的日子走。 */
const PARTIAL_MERGE = [
  'series',
  'title',
  'calendar',
  'visualMap',
  'grid',
  'xAxis',
  'yAxis',
]

const props = defineProps<{
  config: Record<string, unknown>
  meta?: ModuleMeta
  values: Record<string, unknown>
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const views = computed(() =>
  buildMetricViews({
    config: props.config,
    rows: props.values[DAY_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

const signature = computed(() => signatureOf(views.value))

// 一天的读数都没取到才算空；配了 4 张接了 1 张是常态，那不是空态
const empty = computed(() => emptyStateOf(props.config, views.value))

const ariaSummary = computed(() => ariaSummaryOf(views.value))

const build: ChartBuild = (theme) =>
  buildCalendarOption(props.config, views.value, theme)

/**
 * 点某一格时上抛的值。
 * @param params echarts 的图元点击回调参数
 */
function pickValue(params: unknown): string {
  return pickedMetricValue(views.value, params)
}

/**
 * 点某一格时上抛那张日历配置里的名称。
 * ⚠ 冒泡由 `useEChart` 的图元点击一处吞掉：不吞的话同一次点击会再被
 * 「整块可点」兜底抛一次，toggle 类动作当场自我抵消。
 * @param event 图元点击派生的联动事件
 */
function onPick(event: InteractionEvent): void {
  emit('interaction', event)
}
</script>

<template>
  <ChartShell
    :config="config"
    :values="values"
    :build="build"
    :is-empty="empty.isEmpty"
    :empty-text="empty.text"
    :aria-summary="ariaSummary"
    :item-click="{ emit: onPick, readValue: pickValue }"
    :partial-merge="PARTIAL_MERGE"
    :values-deep="false"
    :watch-values="() => signature"
  />
</template>
