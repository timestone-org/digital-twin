<script setup lang="ts">
/**
 * @fileoverview DtIcon —— 按名字从受控注册表取图标。颜色继承 currentColor。
 * ⚠ 未登记的名字静默不渲染、不报错；名字的正确性只能靠契约测试兜。
 */
import { computed } from 'vue'
import { ICONS, isIconName } from './registry'

const props = withDefaults(
  defineProps<{
    name: string
    size?: number
    strokeWidth?: number
    spin?: boolean
  }>(),
  { size: 18, strokeWidth: 2, spin: false },
)

const paths = computed<readonly string[]>(() =>
  isIconName(props.name) ? ICONS[props.name] : [],
)

/** 非法尺寸（NaN / 负数）会产出 width="NaN" 这种非法属性，回退默认值。 */
const safeSize = computed(() =>
  Number.isFinite(props.size) && props.size > 0 ? props.size : 18,
)
</script>

<template>
  <svg
    v-if="paths.length > 0"
    class="dt-icon"
    :class="{ 'dt-icon--spin': spin }"
    :width="safeSize"
    :height="safeSize"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path v-for="shape in paths" :key="shape" :d="shape" />
  </svg>
</template>

<style scoped lang="scss">
.dt-icon {
  display: inline-block;
  flex-shrink: 0;
  vertical-align: middle;
}
.dt-icon--spin {
  animation: dt-icon-spin 0.8s linear infinite;
}
@keyframes dt-icon-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .dt-icon--spin {
    animation-duration: 1.6s;
  }
}
</style>
