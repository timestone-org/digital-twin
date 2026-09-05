<script setup lang="ts">
/**
 * @fileoverview pie-chart 的渲染：读一次配置与注入袋收成 `SliceView[]`，
 * 再把「出 option」这件事交给 `option.ts`，本文件只做接线。
 *
 * ⚠ 绑定槽键要在本文件里字面读一遍：「声明的槽与渲染侧真读的槽逐一对上」那条闸
 * 只扫模块目录本身、不跟着 import 走，写在 `slices.ts` 里不算数。
 * ⚠ `watchValues` 收的是**函数**，配 `valuesDeep: false` 用：传解包后的整袋值是
 * 类型错，而缺省的深度 watch 会把每一片逐键遍历一遍。
 * ⚠ `partialMerge` 带上 `title`：环心那个读数是从实时值派生的，不换它就会停在
 * 第一帧上，而扇区跟着变。
 */
import type { InteractionEvent, ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'

import type { ChartBuild } from '../../shared/chart/chartKit'
import ChartShell from '../../shared/chart/ChartShell.vue'
import { buildPieOption, pickedSliceValue } from './option'
import {
  ariaSummaryOf,
  buildSliceViews,
  emptyStateOf,
  signatureOf,
  SLICE_SLOT_KEY,
} from './slices'

/** 值变时替换这几个键：图例承载逐片状态，标题承载环心读数，两者都随值走。 */
const PARTIAL_MERGE = ['series', 'legend', 'title']

const props = defineProps<{
  config: Record<string, unknown>
  meta?: ModuleMeta
  values: Record<string, unknown>
}>()

const emit = defineEmits<{ interaction: [event: InteractionEvent] }>()

const views = computed(() =>
  buildSliceViews({
    config: props.config,
    rows: props.values[SLICE_SLOT_KEY],
    slots: props.meta?.slots,
  }),
)

const signature = computed(() => signatureOf(views.value))

// 一片都画不出来、或读数合计为 0 才算空；配了 6 片接了 2 片是常态，那不是空态
const empty = computed(() => emptyStateOf(props.config, views.value))

const ariaSummary = computed(() => ariaSummaryOf(views.value))

const build: ChartBuild = (theme, resolve) =>
  buildPieOption(props.config, views.value, theme, resolve)

/**
 * 点某一片时上抛的值。
 * @param params echarts 的图元点击回调参数
 */
function pickValue(params: unknown): string {
  return pickedSliceValue(views.value, params)
}

/**
 * 点某一片时上抛它配置里的名称。
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
