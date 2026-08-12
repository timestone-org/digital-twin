<script setup lang="ts">
/**
 * @fileoverview 组合覆盖度：每个运行组合攒下了多少可用事件。
 *
 * ⚠ 这是页面上最能指导决策的一块——它直接回答「哪些组合的历史够建模、
 * 哪些还差得远」。条数少的必须照样列出来并且看得见，藏起来等于把
 * 「这个组合没数据」说成「这个组合没问题」。
 */
import { computed } from 'vue'
import type { CombinationCoverage } from '@dt/contracts'
import { DtEmpty, DtProgress, DtTag } from '@dt/ui'

import { formatRunningSet, sortedCoverage } from '../startupView'

// 低于这个条数的组合另标一下：样本太少，训练出来的结论不可信
const THIN_THRESHOLD = 20

const props = defineProps<{ items: readonly CombinationCoverage[] }>()

const rows = computed(() => sortedCoverage(props.items))
const most = computed(() =>
  Math.max(1, ...rows.value.map((item) => item.usable_count)),
)
</script>

<template>
  <div class="flex flex-col gap-2">
    <DtEmpty
      v-if="rows.length === 0"
      title="还没有可用事件"
      hint="抽取完成后，这里按运行组合列出各自攒了多少条。"
    />
    <div
      v-for="row in rows"
      :key="row.running_set.join(',')"
      class="flex items-center gap-3"
    >
      <span class="w-40 shrink-0 truncate text-xs text-text-primary">
        {{ formatRunningSet(row.running_set) }}
      </span>
      <DtProgress
        class="flex-1"
        :value="row.usable_count"
        :max="most"
        :intent="row.usable_count < THIN_THRESHOLD ? 'warning' : 'primary'"
      />
      <DtTag
        size="sm"
        :intent="row.usable_count < THIN_THRESHOLD ? 'warning' : 'neutral'"
      >
        {{ row.usable_count }} 条
      </DtTag>
    </div>
    <p v-if="rows.length > 0" class="text-xs text-text-disabled">
      少于 {{ THIN_THRESHOLD }} 条的组合已标黄：样本太少，先别拿它训练。
    </p>
  </div>
</template>
