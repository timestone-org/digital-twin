<script setup lang="ts">
/**
 * @fileoverview DtSkeleton —— 加载骨架（流光）。
 * ⚠ 它只占位，不表达「正在加载」：读屏要知道的话由外面的 aria-busy 说。
 */
import { computed } from 'vue'

// 多行骨架里末行的宽度，短一截才像一段自然结束的文字
const LAST_LINE_WIDTH = '60%'

const props = withDefaults(
  defineProps<{
    /** 行数，>0 时渲染多行文本骨架。 */
    lines?: number
    /** 圆形，用于头像与状态点。 */
    circle?: boolean
  }>(),
  { lines: 0, circle: false },
)

/** 非有限值（NaN / Infinity）与非正数一律当 0，否则 v-for 会拿到非整数。 */
const lineCount = computed(() =>
  Number.isFinite(props.lines) && props.lines > 0 ? Math.floor(props.lines) : 0,
)

function lineWidth(index: number): string {
  return index === lineCount.value && lineCount.value > 1
    ? LAST_LINE_WIDTH
    : '100%'
}
</script>

<template>
  <div v-if="lineCount > 0" class="dt-skeleton-lines">
    <span
      v-for="line in lineCount"
      :key="line"
      class="dt-skeleton dt-skeleton--line"
      :style="{ width: lineWidth(line) }"
    />
  </div>
  <span
    v-else
    class="dt-skeleton dt-skeleton--block"
    :class="{ 'dt-skeleton--circle': circle }"
  />
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-skeleton {
  border-radius: var(--radius-sm);
  background: linear-gradient(
    100deg,
    var(--surface-sunken) 30%,
    rgba(var(--accent-primary-rgb), 0.1) 50%,
    var(--surface-sunken) 70%
  );
  // 背景铺两倍宽才有东西可以推着走，1 倍时整块只会闪
  background-size: 200% 100%;
  animation: dt-skeleton-shimmer 1.6s linear infinite;

  &--line {
    height: 14px;
  }

  &--block {
    display: block;
  }

  &--circle {
    border-radius: var(--radius-pill);
  }
}

.dt-skeleton-lines {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

@keyframes dt-skeleton-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

@include ctl.reduced-motion {
  .dt-skeleton {
    animation: none;
  }
}
</style>
