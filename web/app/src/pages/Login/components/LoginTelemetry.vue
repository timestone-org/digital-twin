<script setup lang="ts">
/**
 * @fileoverview 登录页品牌面板底部的遥测读数与实时时钟。纯装饰、无交互。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { DtIcon } from '@dt/ui'

/** 装饰性遥测读数（静态质感数据，仅用于氛围）。 */
const telemetry = [
  { key: 'status', label: 'SYSTEM', value: 'ONLINE', accent: true },
  { key: 'nodes', label: 'NODES', value: '1.2K', accent: false },
  { key: 'uptime', label: 'UPTIME', value: '99.9%', accent: false },
  { key: 'sync', label: 'SYNC', value: 'REALTIME', accent: false },
]

function readClock(): { time: string; date: string } {
  const now = new Date()
  return {
    time: now.toLocaleTimeString('zh-CN', { hour12: false }),
    date: now.toLocaleDateString('zh-CN'),
  }
}

// 初值在 setup 时就算好：只在 onMounted 里赋值会让首帧的时钟位置是空的
const clock = ref(readClock())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    clock.value = readClock()
  }, 1000)
})

// ⚠ 定时器必须在卸载时清掉：大屏一开就是几天，漏一个就持续累积
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <div class="telemetry dt-animate-fade-up">
    <div class="telemetry__grid">
      <div v-for="item in telemetry" :key="item.key" class="telemetry__cell">
        <span class="telemetry__cell-label">{{ item.label }}</span>
        <span
          class="telemetry__cell-value"
          :class="item.accent ? 'is-online' : 'is-plain'"
        >
          <span
            v-if="item.accent"
            class="telemetry__dot dt-animate-pulse-dot"
          />{{ item.value }}
        </span>
      </div>
    </div>
    <div class="telemetry__clock">
      <span class="telemetry__clock-now">
        <DtIcon name="activity" :size="13" />
        <span>{{ clock.time }}</span>
      </span>
      <span>{{ clock.date }}</span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.telemetry {
  position: relative;
  z-index: 1;
  animation-delay: 320ms;

  &__grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    margin-bottom: 16px;
  }

  // 遥测格是「格」不是面板，不套 DtCard；描边取值仍来自同一批 --card-* token
  &__cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    background: var(--card-bg);
    border: 1px solid var(--card-border);
    border-radius: var(--card-radius);
  }

  &__cell-label {
    font-size: 10px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--text-disabled);
  }

  &__cell-value {
    font-size: 14px;
    font-weight: 600;

    &.is-online {
      color: var(--state-success);
    }

    &.is-plain {
      color: var(--accent-secondary);
    }
  }

  &__dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 6px;
    border-radius: 50%;
    background: var(--state-success);
    box-shadow: 0 0 8px var(--state-success);
    vertical-align: middle;
  }

  &__clock {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 12px;
    border-top: 1px solid var(--border-subtle);
    font-size: 12px;
    color: var(--text-disabled);
  }

  &__clock-now {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--accent-secondary);
  }
}
</style>
