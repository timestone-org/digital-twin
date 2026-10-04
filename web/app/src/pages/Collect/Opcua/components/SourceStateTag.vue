<script setup lang="ts">
/**
 * @fileoverview 数据源启停与最后上报的运行态徽标；停用后的上报标为历史。
 * 停用与断开分开标识，分别指向配置与现场连接。
 */
import { computed } from 'vue'
import type { CollectSourceRuntime } from '@dt/contracts'
import { DtTag, DtTooltip } from '@dt/ui'

import { formatDateTime } from '@/utils/datetime'
import { errorSummary, stateLook, type StateLook } from '../scripts/sourceState'

const props = defineProps<{
  runtime: CollectSourceRuntime
  isEnabled: boolean
}>()

const historical = computed(
  () => !props.isEnabled && props.runtime.updated_at !== null,
)
const look = computed((): StateLook => {
  const reported = stateLook(props.runtime.state)
  return historical.value
    ? { label: `上次${reported.label}`, intent: 'neutral' }
    : reported
})
const reason = computed(() =>
  historical.value
    ? `上次上报于 ${formatDateTime(props.runtime.updated_at, '未知时间')}`
    : errorSummary(props.runtime),
)
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <DtTag v-if="!isEnabled" intent="neutral" size="sm">已停用</DtTag>
    <DtTooltip v-if="reason" :content="reason">
      <DtTag :intent="look.intent" size="sm">{{ look.label }}</DtTag>
    </DtTooltip>
    <DtTag v-else :intent="look.intent" size="sm">{{ look.label }}</DtTag>
  </div>
</template>
