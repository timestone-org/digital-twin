<script setup lang="ts">
/** @fileoverview 对话中的只读实时卡片。 */
import { computed, toRef } from 'vue'
import { DtButton, DtCard, DtNotice, DtTag } from '@dt/ui'
import type { LivePoint } from '@/features/knowledgeChat/liveTools'
import { formatTimestampMs } from '@/utils/datetime'
import { useLivePoint } from '../scripts/useLivePoint'

const props = defineProps<{ point: LivePoint; enabled: boolean }>()
const live = useLivePoint(toRef(props, 'point'), toRef(props, 'enabled'))
const value = computed(() => {
  const sample = live.sample.value
  if (sample?.state !== 'ok') return '—'
  if (sample.value === null) return 'null'
  if (typeof sample.value === 'boolean') return sample.value ? 'true' : 'false'
  return typeof sample.value === 'object'
    ? JSON.stringify(sample.value)
    : typeof sample.value === 'string' || typeof sample.value === 'number'
      ? String(sample.value)
      : '—'
})
const sampledAt = computed(() => {
  const sample = live.sample.value
  return sample?.state === 'ok' ? formatTimestampMs(sample.timestampMs) : '—'
})
const quality = computed(() => {
  const sample = live.sample.value
  if (sample?.state === 'error') return sample.errorMessage
  if (sample?.state !== 'ok') return ''
  return { good: '质量正常', uncertain: '质量存疑', bad: '质量不可用' }[
    sample.quality
  ]
})
const status = computed(() => {
  if (!props.enabled) return '已停止 · 仅最近6张卡片自动订阅'
  if (live.isPaused.value) return '已暂停 · 最后读数'
  if (live.error.value) return '数据不可用'
  if (live.isLoading.value) return '正在读取点位'
  if (!live.isConnected.value) return '连接中断 · 数据可能过期'
  if (!live.isLive.value) return '等待最新读数'
  if (live.sample.value?.state === 'error') return '暂无读数'
  return '持续接收'
})
</script>

<template>
  <li class="chat-live-point">
    <DtCard padding="sm">
      <div class="chat-live-point__header">
        <div>
          <strong>{{ live.current.value.name }}</strong>
          <div class="chat-live-point__source">
            {{ live.current.value.source_name }}
          </div>
        </div>
        <DtTag
          :intent="
            live.isLive.value && live.sample.value?.state === 'ok'
              ? 'success'
              : 'warning'
          "
          size="sm"
          >{{ status }}</DtTag
        >
        <DtButton v-if="enabled" variant="ghost" size="xs" @click="live.toggle">
          {{ live.isPaused.value ? '恢复' : '暂停' }}
        </DtButton>
      </div>
      <div
        class="chat-live-point__value"
        :class="{ 'chat-live-point__value--stale': !live.isLive.value }"
      >
        {{ value }} <span>{{ live.current.value.unit }}</span>
      </div>
      <div class="chat-live-point__source">
        采样时间：{{ sampledAt }} · {{ quality || '尚无读数' }}
      </div>
      <DtNotice v-if="live.error.value" intent="warning">{{
        live.error.value
      }}</DtNotice>
      <DtButton
        v-if="live.error.value && enabled && !live.isPaused.value"
        variant="ghost"
        size="xs"
        @click="live.retry"
        >重新连接</DtButton
      >
    </DtCard>
  </li>
</template>

<style scoped lang="scss">
.chat-live-point {
  margin-block: 0.5rem;
  list-style: none;
}
.chat-live-point__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem;
}
.chat-live-point__header > div {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.chat-live-point__source {
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.chat-live-point__value {
  color: var(--accent-primary);
  font-size: 2rem;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  padding-block: 0.5rem;
}
.chat-live-point__value > span {
  color: var(--text-secondary);
  font-size: 0.875rem;
}
.chat-live-point__value--stale {
  color: var(--text-secondary);
}
</style>
