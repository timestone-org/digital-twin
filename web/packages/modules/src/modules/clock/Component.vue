<script setup lang="ts">
/** @fileoverview 按配置时区格式化当前时间并释放定时器。 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, onMounted, onUnmounted, ref } from 'vue'

import { readBoolean, readEnum, readNumber } from '../../shared/config'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})
onUnmounted(() => {
  if (timer !== undefined) clearInterval(timer)
})
const text = computed(() => {
  const timezone = readEnum(
    props.config.timezone,
    ['Asia/Shanghai', 'UTC'],
    'Asia/Shanghai',
  )
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: timezone,
    ...(readBoolean(props.config.showDate, true)
      ? ({ year: 'numeric', month: '2-digit', day: '2-digit' } as const)
      : {}),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(readBoolean(props.config.showSeconds, true)
      ? ({ second: '2-digit' } as const)
      : {}),
  }).format(now.value)
  return parts
})
const style = computed(() => ({
  textAlign: readEnum(props.config.align, ['left', 'center', 'right'], 'right'),
  fontSize: `${readNumber(props.config.fontSize, 20)}px`,
  opacity: readNumber(props.config.opacity, 0.75),
}))
</script>

<template>
  <div class="clock" :style="style">
    <span>{{ text }}</span>
  </div>
</template>

<style scoped lang="scss">
.clock {
  display: grid;
  align-items: center;
  width: 100%;
  height: 100%;
  font-family: var(--font-digit);
  color: var(--text-primary);
  white-space: nowrap;
}
</style>
