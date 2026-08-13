<script setup lang="ts">
/**
 * @fileoverview 推荐结果里一个组合的成绩卡：p50、区间、瞬时达标概率与标注。
 */
import type { ModelRecommendEntry } from '@dt/contracts'
import { DtTag } from '@dt/ui'

import {
  RELIABILITY_VIEW,
  formatMinutes,
  formatRate,
} from '@/features/hvac/modelView'

const props = defineProps<{ entry: ModelRecommendEntry }>()
</script>

<template>
  <div
    class="flex flex-col gap-1 rounded-md border p-3"
    :class="
      props.entry.is_recommended
        ? 'border-accent-primary/60'
        : 'border-border-subtle'
    "
  >
    <p class="flex items-center gap-2">
      <span class="font-mono text-xs text-text-secondary">
        {{ props.entry.set_key }}
      </span>
      <DtTag v-if="props.entry.is_recommended" size="sm" intent="success">
        推荐
      </DtTag>
    </p>
    <p class="flex items-baseline gap-2">
      <span class="text-xl font-semibold text-text-primary">
        {{ formatMinutes(props.entry.p50) }}
      </span>
      <span class="text-xs text-text-secondary">
        80% 区间 {{ props.entry.p10.toFixed(1) }} –
        {{ props.entry.p90.toFixed(1) }}
      </span>
    </p>
    <p class="flex flex-wrap items-center gap-2">
      <span class="text-xs text-text-secondary">
        开机即达标 {{ formatRate(props.entry.instant_probability) }}
      </span>
      <DtTag
        size="sm"
        :intent="RELIABILITY_VIEW[props.entry.reliability].intent"
      >
        {{ RELIABILITY_VIEW[props.entry.reliability].label }}
      </DtTag>
      <DtTag v-if="props.entry.is_dedicated" size="sm" intent="success">
        组合专属模型
      </DtTag>
      <DtTag v-else size="sm" intent="info">
        组合样本不足，共用模型兜底
      </DtTag>
    </p>
  </div>
</template>
