<script setup lang="ts">
/**
 * @fileoverview 按服务组合的评估表。
 *
 * ⚠ 没样本的组合照样列出来并标「无样本」——藏起来的话，用户不知道自己勾的
 * 组合根本没攒到可用事件，试算给出的宽区间也就无从解释。
 */
import type { DtDataColumn } from '@dt/contracts'
import { DtDataView, DtTag } from '@dt/ui'

import type { SetMetricsRow } from '@/features/hvac/modelView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'set', label: '组合', width: '14rem', card: 'title' },
  { key: 'count', label: '样本', width: '8rem', align: 'right' },
  { key: 'mae', label: '热行 MAE', width: '8rem', align: 'right' },
  { key: 'coverage', label: '热行覆盖率', width: '7rem', align: 'right' },
  { key: 'width', label: '区间宽度', width: '8rem', align: 'right' },
  { key: 'zeroHit', label: '判零率', width: '6rem', align: 'right' },
  { key: 'reliability', label: '可靠性', width: '8rem' },
]

const props = defineProps<{ rows: readonly SetMetricsRow[] }>()
</script>

<template>
  <DtDataView
    view="table"
    :columns="COLUMNS"
    :rows="props.rows"
    :loading="false"
    :error="null"
    :layout="{ toggle: false, minWidth: '48rem' }"
    :empty="{ title: '没有配置服务组合' }"
  >
    <template #cell-set="{ row }">
      <span
        class="font-mono text-xs"
        :class="{ 'opacity-50': !row.hasSamples }"
      >
        {{ row.set }}
      </span>
    </template>
    <template #cell-count="{ row }">{{ row.count }}</template>
    <template #cell-mae="{ row }">{{ row.mae }}</template>
    <template #cell-coverage="{ row }">{{ row.coverage }}</template>
    <template #cell-width="{ row }">{{ row.width }}</template>
    <template #cell-zeroHit="{ row }">{{ row.zeroHit }}</template>
    <template #cell-reliability="{ row }">
      <DtTag size="sm" :intent="row.reliabilityIntent">
        {{ row.reliabilityLabel }}
      </DtTag>
    </template>
  </DtDataView>
</template>
