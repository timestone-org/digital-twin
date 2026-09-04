<script setup lang="ts">
/**
 * @fileoverview 散点四态：真值对预测（pairs）、残差诊断（residual）、按行序或
 * 时间的序列（series）、正态 QQ。九个算子（两种回归、树、残差分析、回归评估、
 * 重采样、滞后、滚动、主成分）共用这一张画法，规格 §7「同一个语义永远同一个外形」。
 *
 * ⚠ 颜色不作唯一编码：「之前」那一路除了灰还空心，多路序列除了色相还有各自的
 * 标记形状与线型，参考线与阈值线的线型也不同。
 */
import { computed } from 'vue'

import type {
  ScatterBand,
  ScatterMode,
  ScatterRule,
  ScatterSeries,
} from '../scripts/scatterGeometry'
import { scatterGeometry } from '../scripts/scatterGeometry'

const props = withDefaults(
  defineProps<{
    series: readonly ScatterSeries[]
    mode?: ScatterMode
    caption?: string
    xLabel?: string
    yLabel?: string
    rules?: readonly ScatterRule[]
    band?: ScatterBand | null
    isTruncated?: boolean
    note?: string
  }>(),
  {
    mode: 'pairs',
    caption: '',
    xLabel: '',
    yLabel: '',
    rules: () => [],
    band: null,
    isTruncated: false,
    note: '',
  },
)

const view = computed(() =>
  scatterGeometry({
    mode: props.mode,
    series: props.series,
    rules: props.rules,
    band: props.band,
  }),
)
</script>

<template>
  <figure class="dt-ml-scatter">
    <figcaption v-if="props.caption">{{ props.caption }}</figcaption>
    <p v-if="view.isBlank" class="dt-ml-scatter__blank">这一步没有可画的点</p>
    <svg
      v-else
      :viewBox="view.viewBox"
      role="img"
      :aria-label="props.caption || '散点图'"
    >
      <g class="dt-ml-scatter__grid">
        <template v-for="tick in view.yTicks" :key="tick.key">
          <line
            :x1="view.plot.left"
            :y1="tick.at"
            :x2="view.plot.right"
            :y2="tick.at"
          />
          <text :x="view.plot.left - 4" :y="tick.at + 3">{{ tick.text }}</text>
        </template>
      </g>
      <g v-if="view.band !== null" class="dt-ml-scatter__band">
        <rect
          :x="view.plot.left"
          :y="view.band.top"
          :width="view.plot.right - view.plot.left"
          :height="view.band.height"
        />
        <text :x="view.plot.right - 3" :y="view.band.labelTop">
          {{ view.band.label }}
        </text>
      </g>
      <line
        v-if="view.diagonal !== null"
        class="dt-ml-scatter__ideal"
        :x1="view.diagonal.x1"
        :y1="view.diagonal.y1"
        :x2="view.diagonal.x2"
        :y2="view.diagonal.y2"
      />
      <g class="dt-ml-scatter__rules">
        <template v-for="rule in view.drawnRules" :key="rule.key">
          <line
            class="dt-ml-scatter__rule"
            :class="`dt-ml-scatter__rule--${rule.intent}`"
            :x1="view.plot.left"
            :y1="rule.top"
            :x2="view.plot.right"
            :y2="rule.top"
          />
          <text :x="view.plot.left + 3" :y="rule.labelTop">
            {{ rule.text }}
          </text>
        </template>
      </g>
      <g class="dt-ml-scatter__series">
        <template v-for="one in view.series" :key="one.key">
          <polyline
            v-if="one.linePoints"
            class="dt-ml-scatter__line"
            :class="`dt-ml-scatter__line--${one.tone}`"
            :points="one.linePoints"
          />
          <path
            v-if="one.dotsPath"
            class="dt-ml-scatter__dots"
            :class="`dt-ml-scatter__dots--${one.tone}`"
            :d="one.dotsPath"
          />
        </template>
      </g>
      <line
        class="dt-ml-scatter__axis"
        :x1="view.plot.left"
        :y1="view.plot.baseline"
        :x2="view.plot.right"
        :y2="view.plot.baseline"
      />
      <g class="dt-ml-scatter__xlabels">
        <text
          v-for="tick in view.xTicks"
          :key="tick.key"
          :x="tick.at"
          :y="view.plot.baseline + 12"
        >
          {{ tick.text }}
        </text>
        <text
          v-if="props.xLabel"
          class="dt-ml-scatter__axis-name"
          :x="view.plot.right"
          :y="view.plot.baseline + 24"
        >
          {{ props.xLabel }}
        </text>
      </g>
      <text
        v-if="props.yLabel"
        class="dt-ml-scatter__yaxis-name"
        :x="view.plot.left - 4"
        :y="view.plot.top - 5"
      >
        {{ props.yLabel }}
      </text>
    </svg>
    <p class="dt-ml-scatter__summary">{{ view.summary }}</p>
    <p v-if="view.sampledNote" class="dt-ml-scatter__note">
      {{ view.sampledNote }}
    </p>
    <p v-if="props.isTruncated" class="dt-ml-scatter__note">
      点太多，后端只带回来其中一部分
    </p>
    <p v-if="props.note" class="dt-ml-scatter__note">{{ props.note }}</p>
    <p
      v-for="rule in view.strayRules"
      :key="rule.key"
      class="dt-ml-scatter__note"
    >
      {{ rule.text }} 落在这段数据的范围之外，没有画出来
    </p>
    <ul v-if="view.hasLegend" class="dt-ml-scatter__legend">
      <li v-for="one in view.series" :key="one.key">
        <span
          class="dt-ml-scatter__swatch"
          :class="[
            `dt-ml-scatter__swatch--${one.tone}`,
            `dt-ml-scatter__swatch--${one.shape}`,
          ]"
        />
        {{ one.name }}
      </li>
    </ul>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-scatter {
  // 上限归摆放它的那一区给，44rem 只是兜底（规格 §3.2 的主体图宽度）：viewBox
  // 会把 7px 的刻度字连同线宽一起等比放大，没有上限的宽容器里字就成了三四倍
  max-width: var(--dt-ml-chart-max, 44rem);
  margin: 0;

  figcaption {
    margin-bottom: 0.25rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  svg {
    width: 100%;
  }

  text {
    fill: var(--text-disabled);
    font-size: 7px;
  }

  &__grid {
    text-anchor: end;

    line {
      stroke: var(--border-subtle);
    }
  }

  &__xlabels {
    text-anchor: middle;
  }

  &__axis-name {
    fill: var(--text-secondary);
    text-anchor: end;
  }

  &__yaxis-name {
    fill: var(--text-secondary);
    text-anchor: start;
  }

  &__axis {
    stroke: var(--border-strong);
  }

  &__ideal {
    stroke: var(--border-strong);
    stroke-dasharray: 4 3;
  }

  // ±σ 带：淡底之外还有两条虚边与一个文字标签
  &__band {
    text-anchor: end;

    rect {
      fill: rgba(var(--neutral-fg-rgb), 0.07);
      stroke: var(--border-strong);
      stroke-dasharray: 2 3;
    }
  }

  &__rule {
    stroke-dasharray: 4 3;

    // 参考线走中性描边，阈值线走警示色 + 更疏的虚线
    &--reference {
      stroke: var(--border-strong);
    }

    &--threshold {
      stroke: var(--state-warning);
      stroke-dasharray: 8 4;
    }
  }

  &__dots {
    stroke-width: 1;

    // 「之前」那一路：空心描边、无填充
    &--before {
      fill: none;
      stroke: var(--text-disabled);
    }

    &--t0 {
      fill: rgba(var(--accent-primary-rgb), 0.7);
    }

    &--t1 {
      fill: rgba(var(--state-success-rgb), 0.7);
    }

    &--t2 {
      fill: rgba(var(--state-warning-rgb), 0.7);
    }

    &--t3 {
      fill: rgba(var(--state-danger-rgb), 0.7);
    }

    &--t4 {
      fill: rgba(var(--accent-secondary-rgb), 0.7);
    }

    &--t5 {
      fill: var(--state-idle);
    }
  }

  &__line {
    fill: none;
    stroke-width: 1.2;

    &--before {
      stroke: var(--text-disabled);
      stroke-dasharray: 3 2;
    }

    &--t0 {
      stroke: var(--accent-primary);
    }

    &--t1 {
      stroke: var(--state-success);
      stroke-dasharray: 6 3;
    }

    &--t2 {
      stroke: var(--state-warning);
      stroke-dasharray: 2 2;
    }

    &--t3 {
      stroke: var(--state-danger);
      stroke-dasharray: 8 2 2 2;
    }

    &--t4 {
      stroke: var(--accent-secondary);
      stroke-dasharray: 4 4;
    }

    &--t5 {
      stroke: var(--state-idle);
      stroke-dasharray: 1 3;
    }
  }

  &__blank,
  &__summary,
  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__note {
    color: var(--text-disabled);
  }

  &__legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0.25rem 0 0;
    padding: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    list-style: none;

    li {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
  }

  &__swatch {
    width: 0.5rem;
    height: 0.5rem;
    border: 1px solid var(--text-disabled);

    &--circle {
      border-radius: 50%;
    }

    &--diamond {
      transform: rotate(45deg);
    }

    &--before {
      background: none;
    }

    &--t0 {
      border-color: var(--accent-primary);
      background: rgba(var(--accent-primary-rgb), 0.7);
    }

    &--t1 {
      border-color: var(--state-success);
      background: rgba(var(--state-success-rgb), 0.7);
    }

    &--t2 {
      border-color: var(--state-warning);
      background: rgba(var(--state-warning-rgb), 0.7);
    }

    &--t3 {
      border-color: var(--state-danger);
      background: rgba(var(--state-danger-rgb), 0.7);
    }

    &--t4 {
      border-color: var(--accent-secondary);
      background: rgba(var(--accent-secondary-rgb), 0.7);
    }

    &--t5 {
      border-color: var(--state-idle);
      background: var(--state-idle);
    }
  }
}
</style>
