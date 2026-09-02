<script setup lang="ts">
/**
 * @fileoverview 残差直方图：误差都落在哪一段。
 *
 * ⚠ 看它是为了分辨两种「误差大」：整体偏在一边（有系统性偏差，模型本身没学对）
 * 与两边对称地散开（噪声大，再调也就这样）。只看 RMSE 一个数分不出这两种。
 */
import { computed } from 'vue'

import { niceNumber } from '../scripts/numbers'
import type { ResidualBin } from '../scripts/preview'

const props = defineProps<{ bins: readonly ResidualBin[] }>()

/** 画幅（SVG 用户坐标）。 */
const WIDTH = 320
const HEIGHT = 120
const AXIS = 16

const tallest = computed(() =>
  Math.max(1, ...props.bins.map((bin) => bin.count)),
)

const bars = computed(() => {
  const span = WIDTH / Math.max(1, props.bins.length)
  return props.bins.map((bin, at) => {
    const height = (bin.count / tallest.value) * (HEIGHT - AXIS)
    return {
      key: `${bin.low}:${bin.high}`,
      left: at * span,
      width: Math.max(1, span - 2),
      top: HEIGHT - AXIS - height,
      height,
      title: `${niceNumber(bin.low)} ~ ${niceNumber(bin.high)}：${bin.count} 行`,
    }
  })
})

/** 零误差落在横轴的哪一处；全部残差同号时给 null，不画那条线。 */
const zeroAt = computed(() => {
  const low = props.bins[0]?.low
  const high = props.bins.at(-1)?.high
  if (low === undefined || high === undefined || low > 0 || high < 0)
    return null
  return ((0 - low) / (high - low)) * WIDTH
})
</script>

<template>
  <figure class="dt-ml-residual">
    <figcaption>残差分布（真值 − 预测值）—— 越集中在 0 附近越好</figcaption>
    <svg :viewBox="`0 0 ${WIDTH} ${HEIGHT}`" role="img" aria-label="残差直方图">
      <rect
        v-for="bar in bars"
        :key="bar.key"
        class="dt-ml-residual__bar"
        :x="bar.left"
        :y="bar.top"
        :width="bar.width"
        :height="bar.height"
      >
        <title>{{ bar.title }}</title>
      </rect>
      <line
        class="dt-ml-residual__axis"
        x1="0"
        :y1="HEIGHT - AXIS"
        :x2="WIDTH"
        :y2="HEIGHT - AXIS"
      />
      <line
        v-if="zeroAt !== null"
        class="dt-ml-residual__zero"
        :x1="zeroAt"
        y1="0"
        :x2="zeroAt"
        :y2="HEIGHT - AXIS"
      />
    </svg>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-residual {
  margin: 0;

  figcaption {
    margin-bottom: 0.25rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  svg {
    width: 100%;
    max-width: 24rem;
  }

  &__bar {
    fill: rgb(var(--accent-primary-rgb) / 0.6);
  }

  &__axis {
    stroke: var(--border-strong);
  }

  &__zero {
    stroke: var(--state-warning);
    stroke-dasharray: 4 3;
  }
}
</style>
