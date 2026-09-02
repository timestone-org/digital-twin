<script setup lang="ts">
/**
 * @fileoverview 真值对预测值的散点，外加一条理想的对角线。
 *
 * ⚠ 自绘不引图表库：这里只要一层点和一条线，为它拉一个 echarts 实例既要管销毁
 * 又要多背几十 KB（ADR-0028 同理）。
 */
import { computed } from 'vue'

const props = defineProps<{
  pairs: readonly [number, number][]
  isTruncated: boolean
}>()

/** 画幅边长与四周留白（SVG 用户坐标）。 */
const SIZE = 240
const PAD = 28

const bounds = computed(() => {
  const values = props.pairs.flat()
  if (values.length === 0) return { low: 0, high: 1 }
  const low = Math.min(...values)
  const high = Math.max(...values)
  // 全都一样时给一个人为的跨度，否则所有点会挤在一条线上、除法还会除到 0
  return high > low ? { low, high } : { low: low - 1, high: high + 1 }
})

function project(value: number): number {
  const { low, high } = bounds.value
  return PAD + ((value - low) / (high - low)) * (SIZE - PAD * 2)
}

const dots = computed(() =>
  props.pairs.map(([truth, guess], at) => ({
    key: `${at}:${truth}:${guess}`,
    left: project(truth),
    top: SIZE - project(guess),
  })),
)
</script>

<template>
  <figure class="dt-ml-scatter">
    <figcaption>真值（横）对预测值（纵）—— 点越贴近虚线越准</figcaption>
    <svg
      :viewBox="`0 0 ${SIZE} ${SIZE}`"
      role="img"
      aria-label="真值对预测值散点图"
    >
      <line
        class="dt-ml-scatter__ideal"
        :x1="PAD"
        :y1="SIZE - PAD"
        :x2="SIZE - PAD"
        :y2="PAD"
      />
      <circle
        v-for="dot in dots"
        :key="dot.key"
        class="dt-ml-scatter__dot"
        :cx="dot.left"
        :cy="dot.top"
        r="2.5"
      />
    </svg>
    <p v-if="props.isTruncated" class="dt-ml-scatter__note">
      点太多，这里只画了其中一部分
    </p>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-scatter {
  margin: 0;

  figcaption {
    margin-bottom: 0.25rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  svg {
    width: 100%;
    max-width: 18rem;
  }

  &__ideal {
    stroke: var(--border-strong);
    stroke-dasharray: 4 3;
  }

  &__dot {
    fill: rgb(var(--accent-primary-rgb) / 0.7);
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
