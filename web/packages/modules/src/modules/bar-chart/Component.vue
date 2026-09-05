<script setup lang="ts">
/**
 * @fileoverview bar-chart 的渲染：读一次配置与注入袋收成 `BarChartView`，
 * 再把「出 option」这件事交给 `option.ts`，本文件只做接线。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `bars.ts` 里不算数。
 * ⚠ `watchValues` 收的是**函数**，配 `valuesDeep: false` 用：传解包后的整袋值是
 * 类型错，而缺省的深度 watch 会把 8 组 × 数百个桶逐键遍历一遍。
 * ⚠ `partialMerge` 不带 `title`：本族的标题条走 `ModulePanel`，图内没有派生读数，
 * 带上它只会让每次值刷新多替换一个恒等的键。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import type { ChartBuild } from '../../shared/chart/chartKit'
import ChartShell from '../../shared/chart/ChartShell.vue'
import {
  ariaSummaryOf,
  BAR_SLOT_KEY,
  buildBarViews,
  emptyStateOf,
  signatureOf,
} from './bars'
import { buildBarOption, pickedBarValue } from './option'

/** 值变时替换这两个键：图例承载逐行状态，系列承载读数。 */
const PARTIAL_MERGE = ['series', 'legend']

const props = defineProps<{
  config: Record<string, unknown>
  meta?: ModuleMeta
  values: Record<string, unknown>
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const view = computed(() =>
  buildBarViews({
    config: props.config,
    rows: props.values[BAR_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

const signature = computed(() => signatureOf(view.value))

// 一格读数都画不出来才算空；配了 6 组接了 2 组是常态，那不是空态
const empty = computed(() => emptyStateOf(props.config, view.value))

const ariaSummary = computed(() => ariaSummaryOf(props.config, view.value))

const build: ChartBuild = (theme, resolve) =>
  buildBarOption(props.config, view.value, theme, resolve)

/**
 * 点某一根柱时上抛的值。
 * @param params echarts 的图元点击回调参数
 */
function pickValue(params: unknown): string {
  return pickedBarValue(view.value, params)
}

/**
 * 点某一根柱时上抛它那一组配置里的名称。
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
