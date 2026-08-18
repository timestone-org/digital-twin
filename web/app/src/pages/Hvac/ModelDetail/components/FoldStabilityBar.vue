<script setup lang="ts">
/**
 * @fileoverview 按折稳定性：每一折的热行 MAE 各一根条。
 *
 * 做一行数字加几根条而不是分面小图：这块只回答「模型在时间上稳不稳」一个问题，
 * 五张各带坐标系的散点要占掉半屏。真要下钻某一折，⑥ 表有 `fold` 列。
 */
import { computed } from 'vue'
import { DtHelpTip, DtProgress } from '@dt/ui'

import { formatMinutes } from '@/features/hvac/modelView'
import type { FoldStat } from '../scripts/foldStats'

const FOLD_HELP =
  '评估按开机时间切成连续的几段，每段轮流当「模型没见过」的那一折。' +
  '某一折明显更差，说明那段时间的运行模式和其它时候不一样。'

const props = defineProps<{ stats: readonly FoldStat[] }>()

/** 条长按各折 hotMae 对最大值归一。 */
const top = computed(() =>
  Math.max(1, ...props.stats.map((stat) => stat.hotMae ?? 0)),
)
</script>

<template>
  <div class="flex min-w-0 flex-col gap-1">
    <p class="flex items-center gap-1 text-xs font-medium text-text-primary">
      按折稳定性（热行 MAE）
      <DtHelpTip label="按折稳定性" :text="FOLD_HELP" />
    </p>
    <p v-if="props.stats.length === 0" class="text-xs text-text-secondary">
      这个组合没有折外预测，看不出按折的稳定性。
    </p>
    <ul v-else class="m-0 grid list-none grid-cols-2 gap-x-3 gap-y-1 p-0">
      <li
        v-for="stat in props.stats"
        :key="stat.fold"
        class="flex min-w-0 items-center gap-2"
        :class="{ 'opacity-50': stat.hotMae === null }"
      >
        <span class="w-10 shrink-0 text-2xs text-text-secondary">
          折{{ stat.fold }}
        </span>
        <DtProgress
          v-if="stat.hotMae !== null"
          class="min-w-0 flex-1"
          size="sm"
          :value="stat.hotMae"
          :max="top"
        />
        <span v-else class="min-w-0 flex-1 text-2xs text-text-disabled">
          没有热行
        </span>
        <span class="shrink-0 text-2xs text-text-primary">
          {{ stat.hotMae === null ? '—' : formatMinutes(stat.hotMae) }}
        </span>
      </li>
    </ul>
  </div>
</template>
