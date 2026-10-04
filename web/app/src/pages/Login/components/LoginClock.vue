<script setup lang="ts">
/**
 * @fileoverview 登录页品牌面板底部的本地时钟。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DtIcon } from '@dt/ui'

import { formatDate, formatTimeOfDay } from '@/utils/datetime'

function readClock(): { time: string; date: string } {
  return { time: formatTimeOfDay(), date: formatDate() }
}

// 初值在 setup 时就算好：只在 onMounted 里赋值会让首帧的时钟位置是空的
const clock = ref(readClock())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    clock.value = readClock()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <div class="login-clock dt-animate-fade-up">
    <div class="login-clock__readout">
      <span class="login-clock__now">
        <DtIcon name="activity" :size="13" />
        <span>{{ clock.time }}</span>
      </span>
      <span>{{ clock.date }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.login-clock {
  position: relative;
  z-index: 1;
  animation-delay: 320ms;

  &__readout {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__now {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-secondary);
  }
}
</style>
