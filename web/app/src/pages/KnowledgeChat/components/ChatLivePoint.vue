<script setup lang="ts">
/** @fileoverview 对话中的只读实时卡片。 */
import { computed, ref, toRef } from 'vue'
import { DtButton, DtCard, DtNotice } from '@dt/ui'
import type { LivePoint } from '@/features/knowledgeChat/liveTools'
import { formatTimestampMs } from '@/utils/datetime'
import { formatLiveValue } from '../scripts/formatLiveValue'
import { useLivePoint } from '../scripts/useLivePoint'
import { MAX_ACTIVE_LIVE_CARDS } from '@/config/app'
import ChatLivePointSettings from './ChatLivePointSettings.vue'

const props = defineProps<{ point: LivePoint; enabled: boolean }>()
const live = useLivePoint(toRef(props, 'point'), toRef(props, 'enabled'))
const decimals = ref<number | undefined>(2)
const value = computed(() => {
  const sample = live.sample.value
  return sample?.state === 'ok'
    ? formatLiveValue(sample.value, decimals.value)
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
  if (!props.enabled)
    return `已停止 · 仅最近${MAX_ACTIVE_LIVE_CARDS}张卡片自动订阅`
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
      <strong class="chat-live-point__name" :title="live.current.value.name">
        {{ live.current.value.name }}
      </strong>
      <div class="chat-live-point__reading">
        <div
          class="chat-live-point__value"
          :class="{ 'chat-live-point__value--stale': !live.isLive.value }"
        >
          {{ value }} <span>{{ live.current.value.unit }}</span>
        </div>
        <DtButton v-if="enabled" variant="ghost" size="xs" @click="live.toggle">
          {{ live.isPaused.value ? '恢复' : '暂停' }}
        </DtButton>
        <ChatLivePointSettings
          v-model="decimals"
          :source-name="live.current.value.source_name"
          :sampled-at="sampledAt"
          :quality="quality"
        />
      </div>
      <div class="chat-live-point__status" :title="`${sampledAt} · ${quality}`">
        <span
          class="chat-live-point__dot"
          :class="{
            'chat-live-point__dot--live':
              live.isLive.value &&
              live.sample.value?.state === 'ok' &&
              live.sample.value.quality === 'good',
          }"
        />
        {{ status }}
        <span
          v-if="
            live.sample.value?.state === 'ok' &&
            live.sample.value.quality !== 'good'
          "
          >· {{ quality }}</span
        >
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
  flex: 0 0 17rem;
  width: 17rem;
  max-width: 100%;
  min-width: 0;
  list-style: none;
}
.chat-live-point__name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.8125rem;
}
.chat-live-point__reading {
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding-block: 0.375rem;
}
.chat-live-point__value {
  flex: 1;
  min-width: 0;
  color: var(--accent-primary);
  font-size: 1.625rem;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.chat-live-point__value > span {
  color: var(--text-secondary);
  font-size: 0.75rem;
}
.chat-live-point__value--stale {
  color: var(--text-secondary);
}
.chat-live-point__status {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--text-secondary);
  font-size: 0.6875rem;
}
.chat-live-point__dot {
  flex-shrink: 0;
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: var(--state-warning);
}
.chat-live-point__dot--live {
  background: var(--state-success);
}
</style>
