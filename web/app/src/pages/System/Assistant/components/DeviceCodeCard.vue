<script setup lang="ts">
/**
 * @fileoverview 等人去别的设备上确认的那一屏：验证地址 + 用户码。
 *
 * ⚠ 用户码摆成大号等宽：它要被人**照着念或照着敲**，比例字体下 0/O、1/l
 * 分不开，而输错一次就要从头再来一遍。
 */
import { computed, onUnmounted, ref, watch } from 'vue'
import type { AssistantDeviceLoginStart } from '@dt/contracts'
import { DtButton, DtSpinner } from '@dt/ui'

const props = defineProps<{ pending: AssistantDeviceLoginStart }>()
defineEmits<{ cancel: []; done: [] }>()

/**
 * 还剩多少秒。
 * ⚠ 卸载必须清掉这个定时器。
 * ⚠ 初值走 watch 的 immediate 而不是在根作用域读 props：那样读一次就把
 * 响应性丢了，换一次登录之后倒计时还停在上一次的秒数上。
 */
const left = ref(0)
watch(
  () => props.pending.expires_in_s,
  (seconds) => {
    left.value = seconds
  },
  { immediate: true },
)
const timer = setInterval(() => {
  left.value = Math.max(left.value - 1, 0)
}, 1000)

onUnmounted(() => {
  clearInterval(timer)
})

const remaining = computed(() => {
  const minutes = Math.floor(left.value / 60)
  const seconds = `${left.value % 60}`.padStart(2, '0')
  return `${minutes}:${seconds}`
})
</script>

<template>
  <div class="device-code">
    <p class="device-code__step">
      1. 打开
      <a
        :href="pending.verification_uri"
        target="_blank"
        rel="noopener noreferrer"
      >
        {{ pending.verification_uri }}
      </a>
    </p>
    <p class="device-code__step">2. 登录之后输入这串码：</p>
    <p class="device-code__code">{{ pending.user_code }}</p>
    <div class="device-code__foot">
      <DtSpinner :size="14" label="正在等你确认" />
      <span>等你确认，剩 {{ remaining }}</span>
      <DtButton variant="ghost" size="xs" @click="$emit('cancel')">
        取消
      </DtButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.device-code {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.875rem;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}

.device-code__step {
  margin: 0;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

/* ⚠ 等宽 + 拉开字距：这串码要被人照着敲，0 与 O 必须分得开 */
.device-code__code {
  margin: 0.25rem 0;
  color: var(--accent-on-surface);
  font-family: var(--font-mono);
  font-size: 1.75rem;
  font-weight: 600;
  letter-spacing: 0.18em;
}

.device-code__foot {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--text-secondary);
  font-size: 0.75rem;
}
</style>
