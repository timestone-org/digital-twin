<script setup lang="ts">
/**
 * @fileoverview AppTopbar —— 返回入口 + 页面标题 + 扫描装饰 + 时钟 + actions 槽。
 * 导航不在这里：它常驻最左侧的 AppNavRail。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { DtDigits, DtIcon } from '@dt/ui'

import { formatTimeOfDay } from '@/utils/datetime'

import ThemeSwitcher from './ThemeSwitcher.vue'

const props = defineProps<{
  title?: string | undefined
  subtitle?: string | undefined
  /** 给了才显示返回入口；取值是站内路径，如 `/system/users`。 */
  backTo?: string | undefined
  backLabel?: string | undefined
}>()

const backText = computed(() => props.backLabel ?? '返回')

// 初值在 setup 里就取：只在 onMounted 里赋值的话时钟位置会空一帧
const now = ref(formatTimeOfDay())
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = formatTimeOfDay()
  }, 1000)
})

// ⚠ 顶栏常驻整个会话，定时器不清就是一条持续累积的泄漏
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<template>
  <header
    class="relative z-30 flex h-16 shrink-0 items-center gap-4 border-b border-border-subtle bg-surface-panel/40 px-5 backdrop-blur-md"
  >
    <!-- 扫描光带单独套一层 overflow-hidden，避免裁掉右侧可能出现的下拉面板 -->
    <span class="pointer-events-none absolute inset-0 overflow-hidden">
      <span class="topbar-scan absolute inset-y-0 left-0 w-1/3" />
    </span>

    <div class="relative z-10 flex min-w-0 items-center gap-3">
      <!--
        用 RouterLink 而不是按钮：返回是导航、地址会变，中键新标签打开与复制链接
        都该照常可用。同理不用 router.back()——那条路径在直接进子页面时会退出站外。
      -->
      <RouterLink
        v-if="backTo"
        :to="backTo"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-default text-text-secondary transition-colors hover:border-accent-primary hover:text-accent-primary"
        :aria-label="backText"
        :title="backText"
      >
        <DtIcon name="arrow-right" :size="16" class="rotate-180" />
      </RouterLink>

      <div class="min-w-0">
        <h1
          v-if="title"
          class="dt-glow-text truncate text-base font-semibold tracking-wide"
        >
          {{ title }}
        </h1>
        <p v-if="subtitle" class="truncate text-xs text-text-disabled">
          {{ subtitle }}
        </p>
      </div>
    </div>

    <div class="relative z-10 ml-auto flex items-center gap-4">
      <slot name="actions" />
      <!-- 换肤是外壳常驻功能，不走 actions 槽——那个槽归页面自己 -->
      <ThemeSwitcher />
      <div
        class="hidden shrink-0 items-center gap-2 text-text-secondary sm:flex"
      >
        <DtIcon name="activity" :size="14" class="text-accent-primary/70" />
        <DtDigits
          :value="now"
          class="topbar-clock text-sm tracking-wider text-accent-secondary"
        />
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

// 时钟贴在顶栏最右，读数一变宽左邻的换肤钮与 actions 槽就跟着位移。DtDigits 已把每个
// 数字锁进 1ch，这里再按最宽读数留一只固定盒子：冒号与字距不锁宽，且换语言环境后
// 位数未必还是 8，留出富余比正好卡住稳。
.topbar-clock {
  display: inline-block;
  min-width: 9ch;
  text-align: center;
}

// 横向扫光。keyframes 定义在全局 animations.scss 里：scoped 会给块内 keyframes
// 改名加 hash，与别处复用的同名动画对不上。
.topbar-scan {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(var(--accent-primary-rgb), 0.12),
    transparent
  );
  animation: dt-scan-x 4s linear infinite;
}

@include t.reduced-motion {
  .topbar-scan {
    animation: none;
  }
}
</style>
