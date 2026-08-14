<script setup lang="ts">
/**
 * @fileoverview 出处条：这份评估是拿哪一段数据、什么口径、什么时候训出来的。
 *
 * ⚠ 与状态条的 stale 提示不重复：状态条说**该做什么**（「建议重训」），
 * 这里说**是什么**（「特征 v2」）。两者语气不同，都要有。
 */
import { computed } from 'vue'
import type { AcModel } from '@dt/contracts'

import { formatDay, formatMinuteStamp, formatSince } from '@/utils/datetime'

const props = defineProps<{ model: AcModel }>()

const windowText = computed(() => {
  const { window_start: start, window_end: end } = props.model
  if (start === null || end === null) return '—'
  const days = Math.max(
    1,
    Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000),
  )
  return `${formatDay(start)} → ${formatDay(end)}（${days} 天）`
})

const sampleText = computed(() => {
  const { sample_count: total, metrics } = props.model
  if (total === null) return '—'
  const overall = metrics?.overall
  if (overall === undefined || overall.zero_count === null) return String(total)
  return `${total}（热 ${overall.hot?.count ?? 0} · 零 ${overall.zero_count}）`
})

const trainedText = computed(() => {
  const at = props.model.trained_at
  if (at === null) return '尚未训练'
  return `训练于 ${formatMinuteStamp(at)}（${formatSince(at)}）`
})
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary"
  >
    <span>数据窗口 {{ windowText }}</span>
    <span>样本 {{ sampleText }}</span>
    <span>半衰期 {{ props.model.half_life_days }} 天</span>
    <span>
      特征
      <span :class="{ 'text-state-warning': props.model.is_feature_stale }">
        {{
          props.model.feature_version === null
            ? '—'
            : `v${props.model.feature_version}`
        }}
      </span>
    </span>
    <span>{{ trainedText }}</span>
  </div>
</template>
