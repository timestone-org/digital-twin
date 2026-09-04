<script setup lang="ts">
/**
 * @fileoverview trend-chart 的渲染：读一次配置与注入袋收成 `SeriesView[]`，
 * 再把「出 option」这件事交给 `option.ts`，本文件只做接线。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `series.ts` 里不算数。
 * ⚠ `watchValues` 收的是**函数**，配 `valuesDeep: false` 用：传解包后的整袋值是
 * 类型错，而缺省的深度 watch 会把 6 条 × 几百个点逐键遍历一遍。
 * ⚠ 时间的格式化一律在 `option.ts` 里：组件里禁 `new Date(` 与 `toLocaleString(`。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import type { ChartBuild } from '../../shared/chart/chartKit'
import ChartShell from '../../shared/chart/ChartShell.vue'
import { buildTrendOption, pickedSeriesValue } from './option'
import {
  ariaSummaryOf,
  buildSeriesViews,
  emptyStateOf,
  SERIES_SLOT_KEY,
  signatureOf,
} from './series'

/** 值变时替换这两个键：图例承载逐条状态，series 承载曲线本身，两者都随值走。 */
const PARTIAL_MERGE = ['series', 'legend']

const props = defineProps<{
  config: Record<string, unknown>
  meta?: ModuleMeta
  values: Record<string, unknown>
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const views = computed(() =>
  buildSeriesViews({
    config: props.config,
    rows: props.values[SERIES_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

const signature = computed(() => signatureOf(views.value))

// 一条都画不出来才算空；配了 6 条接了 2 条是常态，那不是空态
const empty = computed(() => emptyStateOf(props.config, views.value))

const ariaSummary = computed(() => ariaSummaryOf(views.value))

const build: ChartBuild = (theme, resolve) =>
  buildTrendOption(props.config, views.value, theme, resolve)

/**
 * 点某一条线时上抛的值。
 * @param params echarts 的图元点击回调参数
 */
function pickValue(params: unknown): string {
  return pickedSeriesValue(views.value, params)
}

/**
 * 点某一条线时上抛它配置里的名称。
 * ⚠ 冒泡由 `useEChart` 的图元点击一处吞掉：这块图不开「整块可点」，但缩放条上的
 * 拖拽仍会落在同一棵 DOM 上，吞掉最省事也最不会互相打架。
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
