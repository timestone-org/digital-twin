<script setup lang="ts">
/**
 * @fileoverview AppLogo —— 项目标志：两圈虚线轨道套一枚立方体线框。
 * 取色全部走 @dt/tokens 的语义变量，换肤时跟着变。
 *
 * ⚠ favicon 用的是 `public/logo.svg`——那份必须自带取值（浏览器渲染 favicon
 * 时读不到页面的 CSS 变量），两份的几何由 AppLogo.contract.spec.ts 钉在一起。
 */
import { computed } from 'vue'

const props = defineProps<{ size?: number | undefined }>()

const DEFAULT_SIZE_PX = 28

/** 非法尺寸（NaN / 负数）会产出 width="NaN" 这种非法属性，回退默认值。 */
const safeSize = computed(() =>
  props.size !== undefined && Number.isFinite(props.size) && props.size > 0
    ? props.size
    : DEFAULT_SIZE_PX,
)
</script>

<template>
  <svg
    class="app-logo"
    :width="safeSize"
    :height="safeSize"
    viewBox="0 0 1024 1024"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <rect width="1024" height="1024" rx="224" fill="var(--surface-base)" />
    <path
      d="M512 161C705.852 161 863 262.919 863 388.5C863 514.081 705.852 616 512 616C318.148 616 161 514.081 161 388.5C161 262.919 318.148 161 512 161Z"
      stroke="var(--accent-primary)"
      stroke-width="26"
      stroke-linecap="round"
      stroke-dasharray="16 34"
    />
    <path
      d="M512 298C679.066 298 814.5 384.559 814.5 491.5C814.5 598.441 679.066 685 512 685C344.934 685 209.5 598.441 209.5 491.5C209.5 384.559 344.934 298 512 298Z"
      stroke="var(--accent-secondary)"
      stroke-width="18"
      stroke-linecap="round"
      stroke-dasharray="12 28"
    />
    <path
      d="M512 230L735 358.5V615.5L512 744L289 615.5V358.5L512 230Z"
      fill="rgba(var(--accent-primary-rgb), 0.1)"
      stroke="var(--accent-secondary)"
      stroke-width="20"
    />
    <path
      d="M512 230V744"
      stroke="var(--accent-secondary)"
      stroke-width="14"
      stroke-linecap="round"
    />
    <path
      d="M289 358.5L512 487L735 358.5"
      stroke="var(--accent-secondary)"
      stroke-width="14"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M289 615.5L512 487L735 615.5"
      stroke="rgba(var(--accent-primary-rgb), 0.55)"
      stroke-width="12"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M381 409L512 333L643 409V560L512 636L381 560V409Z"
      fill="rgba(var(--accent-primary-rgb), 0.16)"
      stroke="var(--accent-primary)"
      stroke-width="16"
      stroke-linejoin="round"
    />
    <path
      d="M512 333V636"
      stroke="var(--accent-primary)"
      stroke-width="11"
      stroke-linecap="round"
    />
    <path
      d="M381 409L512 484L643 409"
      stroke="var(--accent-primary)"
      stroke-width="11"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <path
      d="M430 527L512 575L594 527V457L512 410L430 457V527Z"
      fill="rgba(var(--accent-secondary-rgb), 0.28)"
      stroke="var(--text-title)"
      stroke-width="10"
    />
    <circle cx="512" cy="230" r="28" fill="var(--accent-primary)" />
    <circle cx="735" cy="358" r="24" fill="var(--accent-secondary)" />
    <circle cx="735" cy="616" r="24" fill="var(--accent-primary)" />
    <circle cx="512" cy="744" r="28" fill="var(--accent-secondary)" />
    <circle cx="289" cy="616" r="24" fill="var(--accent-primary)" />
    <circle cx="289" cy="358" r="24" fill="var(--accent-secondary)" />
    <path
      d="M169 745L313 661"
      stroke="var(--accent-primary)"
      stroke-width="18"
      stroke-linecap="round"
    />
    <path
      d="M855 745L711 661"
      stroke="var(--accent-secondary)"
      stroke-width="18"
      stroke-linecap="round"
    />
    <circle cx="154" cy="754" r="31" fill="var(--accent-primary)" />
    <circle cx="870" cy="754" r="31" fill="var(--accent-secondary)" />
    <path
      d="M410 798H614"
      stroke="var(--accent-secondary)"
      stroke-width="22"
      stroke-linecap="round"
    />
  </svg>
</template>

<style scoped lang="scss">
.app-logo {
  display: block;
  flex-shrink: 0;
}
</style>
