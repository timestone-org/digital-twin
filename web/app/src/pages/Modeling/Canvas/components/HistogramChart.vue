<script setup lang="ts">
/**
 * @fileoverview 分布直方图：一排柱 + 参考竖线 + 保留/丢弃双色分段 + 离轴柱 +
 * 正态参考曲线。九个算子（对齐、过滤、重采样、填缺失、裁剪、切分、两种评估）
 * 共用这一张画法，规格 §7「同一个语义永远同一个外形」。
 *
 * ⚠ 颜色不作唯一编码：丢弃段除了警示色还有斜纹，越界段除了危险色还有边框。
 * ⚠ 参考几何一律走文字色不走 `--border-strong`：后者压在浅色面板底上只有
 * 1.38:1，远不到 WCAG 1.4.11 对非文本图形的 3:1（口径与实测见 §7 的配色表）。
 */
import { computed, useId } from 'vue'

import type {
  HistogramBin,
  HistogramMark,
  NormalCurve,
  OffAxisBar,
} from '../scripts/histogramGeometry'
import { histogramGeometry } from '../scripts/histogramGeometry'

const props = withDefaults(
  defineProps<{
    bins: readonly HistogramBin[]
    caption?: string
    axisLabel?: string
    marks?: readonly HistogramMark[]
    offAxis?: OffAxisBar | null
    curve?: NormalCurve | null
    keptLabel?: string
    droppedLabel?: string
    dropIntent?: 'danger' | 'warning'
  }>(),
  {
    caption: '',
    axisLabel: '',
    marks: () => [],
    offAxis: null,
    curve: null,
    keptLabel: '保留',
    droppedLabel: '丢弃',
    dropIntent: 'warning',
  },
)

const view = computed(() =>
  histogramGeometry({
    bins: props.bins,
    marks: props.marks,
    offAxis: props.offAxis,
    curve: props.curve,
    droppedLabel: props.droppedLabel,
  }),
)

// ⚠ 一屏可能挂好几张图，pattern 的 id 撞了会让后一张引到前一张的斜纹
const patternId = `dt-ml-hist-${useId()}`
const dropFill = computed(() => `url(#${patternId}-${props.dropIntent})`)
</script>

<template>
  <figure class="dt-ml-hist">
    <figcaption v-if="props.caption">{{ props.caption }}</figcaption>
    <p v-if="view.isBlank" class="dt-ml-hist__blank">这一步没有可画的分布</p>
    <svg
      v-else
      :viewBox="view.viewBox"
      role="img"
      :aria-label="props.caption || '分布直方图'"
    >
      <defs>
        <pattern
          :id="`${patternId}-warning`"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect class="dt-ml-hist__hatch-bg" width="6" height="6" />
          <line class="dt-ml-hist__hatch-line" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
        <pattern
          :id="`${patternId}-danger`"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <rect class="dt-ml-hist__clip-bg" width="6" height="6" />
        </pattern>
      </defs>
      <g class="dt-ml-hist__grid">
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
      <g class="dt-ml-hist__bars">
        <template v-for="bar in view.bars" :key="bar.key">
          <rect
            v-if="bar.keptHeight > 0"
            class="dt-ml-hist__bar-kept"
            :x="bar.left"
            :y="bar.keptTop"
            :width="bar.width"
            :height="bar.keptHeight"
          >
            <title>{{ bar.title }}</title>
          </rect>
          <rect
            v-if="bar.dropHeight > 0"
            class="dt-ml-hist__bar-dropped"
            :class="`dt-ml-hist__bar-dropped--${props.dropIntent}`"
            :fill="dropFill"
            :x="bar.left"
            :y="bar.dropTop"
            :width="bar.width"
            :height="bar.dropHeight"
          >
            <title>{{ bar.title }}</title>
          </rect>
        </template>
      </g>
      <polyline
        v-if="view.curvePoints"
        class="dt-ml-hist__curve"
        :points="view.curvePoints"
      />
      <g class="dt-ml-hist__marks">
        <template v-for="mark in view.drawnMarks" :key="mark.key">
          <line
            class="dt-ml-hist__mark"
            :class="[
              `dt-ml-hist__mark--${mark.intent}`,
              { 'is-unnamed': mark.text === '' },
            ]"
            :x1="mark.left"
            :y1="mark.lineTop"
            :x2="mark.left"
            :y2="view.plot.baseline"
          >
            <title>{{ mark.full }}</title>
          </line>
          <text
            class="dt-ml-hist__mark-label"
            :x="mark.labelLeft"
            :y="mark.labelTop"
            :text-anchor="mark.anchor"
          >
            {{ mark.text }}
          </text>
        </template>
      </g>
      <line
        class="dt-ml-hist__axis"
        :x1="view.plot.left"
        :y1="view.plot.baseline"
        :x2="view.plot.right"
        :y2="view.plot.baseline"
      />
      <g class="dt-ml-hist__xlabels">
        <text
          v-for="tick in view.xTicks"
          :key="tick.key"
          :x="tick.at"
          :y="view.plot.baseline + 10"
        >
          {{ tick.text }}
        </text>
        <text
          v-if="props.axisLabel"
          class="dt-ml-hist__axis-name"
          :x="view.plot.right"
          :y="view.plot.baseline + 28"
        >
          {{ props.axisLabel }}
        </text>
      </g>
      <g v-if="view.offAxis !== null" class="dt-ml-hist__off">
        <line
          class="dt-ml-hist__off-split"
          :x1="view.plot.right + 4"
          :y1="view.plot.top - 6"
          :x2="view.plot.right + 4"
          :y2="view.plot.baseline"
        />
        <rect
          class="dt-ml-hist__bar-off"
          :x="view.offAxis.left"
          :y="view.offAxis.top"
          :width="view.offAxis.width"
          :height="view.offAxis.height"
        >
          <title>{{ view.offAxis.title }}</title>
        </rect>
        <text :x="view.plot.right + 6" :y="view.plot.baseline + 10">
          {{ view.offAxis.label }}
        </text>
        <text :x="view.plot.right + 6" :y="view.plot.baseline + 19">
          不在轴上
        </text>
      </g>
    </svg>
    <p class="dt-ml-hist__summary">{{ view.summary }}</p>
    <p
      v-for="mark in view.strayMarks"
      :key="mark.key"
      class="dt-ml-hist__stray"
    >
      {{ mark.text }} 落在这段数据的范围之外，没有画出来
    </p>
    <ul v-if="view.hasDropped" class="dt-ml-hist__legend">
      <li>
        <span class="dt-ml-hist__swatch dt-ml-hist__swatch--kept" />
        {{ props.keptLabel }}
      </li>
      <li>
        <span
          class="dt-ml-hist__swatch"
          :class="`dt-ml-hist__swatch--${props.dropIntent}`"
        />
        {{ props.droppedLabel }}
      </li>
    </ul>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-hist {
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

  &__off {
    text-anchor: start;
  }

  // 坐标轴与刻度字同一档：六套预设里最低 5.10:1
  &__axis {
    stroke: var(--text-disabled);
  }

  &__bar-kept {
    fill: rgba(var(--accent-primary-rgb), 0.6);
  }

  // 越界段：危险色之外还有 1px 边框，颜色不作唯一编码
  &__bar-dropped--danger {
    stroke: var(--state-danger);
    stroke-width: 1;
  }

  &__clip-bg {
    fill: rgba(var(--state-danger-rgb), 0.5);
  }

  // 丢弃段：警示色之外还有斜纹
  &__hatch-bg {
    fill: rgba(var(--state-warning-rgb), 0.35);
  }

  &__hatch-line {
    stroke: var(--state-warning);
    stroke-width: 2;
  }

  &__bar-off {
    fill: rgba(var(--neutral-fg-rgb), 0.35);
    stroke: var(--text-disabled);
    stroke-width: 1;
    stroke-dasharray: 3 2;
  }

  // 正态参考曲线是拿来比对形状的基准，走 8.07:1 那一档
  &__curve {
    fill: none;
    stroke: var(--text-secondary);
    stroke-dasharray: 3 2;
  }

  &__off-split {
    stroke: var(--text-disabled);
    stroke-dasharray: 2 3;
  }

  // 三档标记线各有各的线型与文字标签，颜色不作唯一编码。
  // ⚠ 软界与位置标记不再走 --state-warning / --state-info：这两个在浅色预设下
  // 只有 2.31:1 与 2.99:1，压在面板底上就是一条看不见的线
  &__mark {
    stroke-dasharray: 4 3;

    // 硬界（裁剪上下界）：危险色，六套最低 3.38:1
    &--danger {
      stroke: var(--state-danger);
      stroke-width: 1.2;
    }

    // 软界 / 阈值：更粗更疏的虚线
    &--warning {
      stroke: var(--text-secondary);
      stroke-width: 1.8;
      stroke-dasharray: 8 4;
    }

    // 位置标记（均值 / 中位数）：最细最密的虚线
    &--info {
      stroke: var(--text-disabled);
      stroke-dasharray: 2 3;
    }

    // 标签被挤掉的那条：只换线型不换色——档还是那个档，点线明说「这条线的名字
    // 不在图上」，名字由结论那行点名、悬停时也读得到。
    // ⚠ 照旧画成同款虚线的话，读者只会看见一条无名的线
    &.is-unnamed {
      stroke-width: 1;
      stroke-dasharray: 1 2;
    }
  }

  &__mark-label {
    fill: var(--text-secondary);
  }

  &__blank,
  &__summary,
  &__stray {
    margin: 0.25rem 0 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__stray {
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
    width: 0.75rem;
    height: 0.5rem;
    border-radius: 2px;

    &--kept {
      background: rgba(var(--accent-primary-rgb), 0.6);
    }

    &--warning {
      border: 1px solid var(--state-warning);
      background: repeating-linear-gradient(
        45deg,
        rgba(var(--state-warning-rgb), 0.35),
        rgba(var(--state-warning-rgb), 0.35) 2px,
        var(--state-warning) 2px,
        var(--state-warning) 4px
      );
    }

    &--danger {
      border: 1px solid var(--state-danger);
      background: rgba(var(--state-danger-rgb), 0.5);
    }
  }
}
</style>
