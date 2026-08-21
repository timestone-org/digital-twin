<script setup lang="ts">
/**
 * @fileoverview 按服务组合的评估表。点一行 = 把折外总览与逐条表筛到该组合。
 *
 * ⚠ 没样本的组合照样列出来并标「无样本」——藏起来的话，用户不知道自己勾的
 * 组合根本没攒到可用事件，推荐给出的宽区间也就无从解释。
 * ⚠ 行点击写回折外总览那一个筛选器，不另开第二个：两个控件各记各的，界面
 * 就会出现「表已筛过、下拉却显示全部」。
 */
import type { DtDataColumn } from '@dt/contracts'
import { DtDataView, DtTag } from '@dt/ui'

import type { SetMetricsRow } from '@/features/hvac/modelView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'set', label: '组合', width: '14rem', card: 'title' },
  { key: 'count', label: '样本', width: '8rem', align: 'right' },
  { key: 'r2', label: '热行 R²', width: '6.5rem', align: 'right' },
  { key: 'mae', label: '热行 MAE', width: '8rem', align: 'right' },
  { key: 'coverage', label: '热行覆盖率', width: '7rem', align: 'right' },
  { key: 'width', label: '区间宽度', width: '8rem', align: 'right' },
  { key: 'zeroHit', label: '判零率', width: '6rem', align: 'right' },
  { key: 'hotHit', label: '判出率', width: '6rem', align: 'right' },
  { key: 'reliability', label: '可靠性', width: '8rem' },
]

const props = defineProps<{
  rows: readonly SetMetricsRow[]
  /** 当前选中的组合键；空串 = 全部。 */
  selected: string
}>()

const emit = defineEmits<{ select: [value: string] }>()

/** 再点一次选中的那行就回到「全部组合」。 */
function toggle(key: string): void {
  emit('select', props.selected === key ? '' : key)
}
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="false"
    :error="null"
    :layout="{ toggle: false, minWidth: '60rem', fill: false }"
    :empty="{ title: '没有配置服务组合' }"
  >
    <template #cell-set="{ row }">
      <button
        type="button"
        class="w-full truncate rounded-sm px-1 text-left font-mono text-xs"
        :class="[
          { 'opacity-50': !row.hasSamples },
          row.set === props.selected
            ? 'bg-accent-primary/10 text-accent-primary'
            : '',
        ]"
        :disabled="!row.hasSamples"
        :aria-current="row.set === props.selected ? 'true' : undefined"
        :title="row.hasSamples ? undefined : '这个组合还没有可用事件'"
        @click="toggle(row.set)"
      >
        {{ row.set }}
      </button>
    </template>
    <template #cell-count="{ row }">{{ row.count }}</template>
    <template #cell-r2="{ row }">
      <span :class="row.r2Class">{{ row.r2 }}</span>
    </template>
    <template #cell-mae="{ row }">{{ row.mae }}</template>
    <template #cell-coverage="{ row }">{{ row.coverage }}</template>
    <template #cell-width="{ row }">{{ row.width }}</template>
    <template #cell-zeroHit="{ row }">{{ row.zeroHit }}</template>
    <template #cell-hotHit="{ row }">{{ row.hotHit }}</template>
    <template #cell-reliability="{ row }">
      <DtTag size="sm" :intent="row.reliabilityIntent">
        {{ row.reliabilityLabel }}
      </DtTag>
    </template>
  </DtDataView>
</template>
