<script setup lang="ts">
/**
 * @fileoverview DtSpinner —— 加载指示。`label` 供读屏使用，视觉上隐藏。
 */
withDefaults(defineProps<{ size?: number; label?: string }>(), {
  size: 20,
  label: '加载中',
})
</script>

<template>
  <span class="dt-spinner" role="status">
    <span
      class="dt-spinner__ring"
      :style="{ width: `${size}px`, height: `${size}px` }"
      aria-hidden="true"
    />
    <span class="dt-spinner__label">{{ label }}</span>
  </span>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-spinner {
  display: inline-flex;
  align-items: center;

  &__ring {
    display: inline-block;
    border: 2px solid rgba(var(--accent-primary-rgb), 0.25);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: dt-spinner-spin 0.7s linear infinite;
  }

  // 视觉隐藏但仍被读屏取到：display:none 会让它从无障碍树上消失
  &__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@keyframes dt-spinner-spin {
  to {
    transform: rotate(360deg);
  }
}

@include ctl.reduced-motion {
  .dt-spinner__ring {
    animation-duration: 1.6s;
  }
}
</style>
