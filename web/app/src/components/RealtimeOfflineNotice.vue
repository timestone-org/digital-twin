<script setup lang="ts">
/**
 * @fileoverview 大屏上的「通道断了」角标。连着时**什么都不画**。
 *
 * ⚠ 这条不是模块、不由制作者摆：一块挂在墙上的屏，最危险的失效就是数值停住
 * 而屏上一切如常。靠制作者记得放一个 connection-status 模块，等于把这件事
 * 交给了最容易忘的一环。
 * ⚠ 也不跟着返回按钮那套「闲置淡出」走：淡出是给装饰用的，这条是故障告知。
 * ⚠ 文案说的是后果不是协议名：「数值停在断开前」看的人能立刻判断该不该信，
 * 「WebSocket disconnected」不能。
 */
import { DtIcon } from '@dt/ui'

import { useRealtimeOffline } from '@/composables/useRealtimeOffline'

const isOffline = useRealtimeOffline()
</script>

<template>
  <div
    v-if="isOffline"
    class="pointer-events-none absolute right-4 top-4 flex items-center gap-2 rounded-md border border-state-warning bg-surface-overlay/85 px-3 py-2 text-sm text-state-warning backdrop-blur-sm"
    role="status"
    data-test="realtime-offline"
  >
    <DtIcon name="alert-triangle" :size="16" />
    <span>实时通道已断开，画面上的数值停在断开前</span>
  </div>
</template>
