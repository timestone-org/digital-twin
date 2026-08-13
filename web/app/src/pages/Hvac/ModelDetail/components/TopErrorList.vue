<script setup lang="ts">
/**
 * @fileoverview 误差最大的 5 次折外预测，只读。
 *
 * ⚠ 不做成「点一下跳到逐条表对应行」：那条记录多半不在当前页，跳过去要重算
 * 页码，而 `/predictions` 端点不支持按 `started_at` 定位。
 * ⚠ 零行不排除：实际 0 分钟却被预测成 40 分钟是严重错误，藏起来说不过去。
 */
import { computed } from 'vue'
import type { ModelPrediction } from '@dt/contracts'
import { DtTag } from '@dt/ui'

import { formatMinuteStamp } from '@/utils/datetime'
import { formatSet, signedError } from '@/features/hvac/modelView'

const props = defineProps<{ rows: readonly ModelPrediction[] }>()

const cards = computed(() =>
  props.rows.map((row) => {
    const error = signedError(row)
    return {
      id: row.started_at,
      // 起始时刻只到分钟：秒在这里没有信息量，占掉的是卡片宽度
      started: formatMinuteStamp(row.started_at).slice(5),
      set: formatSet(row.running_set),
      isZeroRow: row.actual_minutes === 0,
      actual: row.actual_minutes,
      predicted: row.p50.toFixed(1),
      error: `${error > 0 ? '+' : '−'}${Math.abs(error).toFixed(1)}`,
    }
  }),
)
</script>

<template>
  <div class="flex flex-col gap-1">
    <p class="text-xs font-medium text-text-primary">误差最大的 5 次</p>
    <p v-if="cards.length === 0" class="text-xs text-text-secondary">
      这个组合没有折外预测。
    </p>
    <ul
      v-else
      class="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 xl:grid-cols-5"
    >
      <li
        v-for="card in cards"
        :key="card.id"
        class="flex min-w-0 flex-col gap-0.5 rounded-md border border-border-subtle p-2"
      >
        <p class="flex items-center justify-between gap-1">
          <span class="truncate text-2xs text-text-secondary">
            {{ card.started }}
          </span>
          <DtTag v-if="card.isZeroRow" size="sm" intent="neutral">零行</DtTag>
        </p>
        <p class="truncate font-mono text-2xs text-text-secondary">
          {{ card.set }}
        </p>
        <p class="text-xs text-text-primary">
          实际 {{ card.actual }} → 预测 {{ card.predicted }}
        </p>
        <p class="text-xs text-state-warning">误差 {{ card.error }} 分钟</p>
      </li>
    </ul>
  </div>
</template>
