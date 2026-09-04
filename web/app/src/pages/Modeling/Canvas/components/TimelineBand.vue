<script setup lang="ts">
/**
 * @fileoverview 一条轴上的若干段：数据实际覆盖的时段、没有数据的断档、并排的
 * 两段（训练 / 测试）、请求区间与实际区间的对照。六个算子（取数、重采样、切分、
 * 滞后、滚动、交叉验证）共用这一张画法，规格 §7。
 *
 * ⚠ 断档与「有数据但值为空」不是一回事：断档是这一段压根没有行，画成交叉散列；
 * 空值率那件事归直方图与条形表，别在这里混着说。
 * ⚠ 时刻按**本机时区**显示，图下那行结论里明说——后端给的一律是 UTC。
 */
import { computed, useId } from 'vue'

import type { TimelineRow, TimelineScale } from '../scripts/timelineGeometry'
import { timelineGeometry } from '../scripts/timelineGeometry'

const props = withDefaults(
  defineProps<{
    rows: readonly TimelineRow[]
    scale?: TimelineScale
    span?: { low: number; high: number } | null
    caption?: string
    note?: string
  }>(),
  {
    scale: 'time',
    span: null,
    caption: '',
    note: '',
  },
)

const view = computed(() =>
  timelineGeometry({
    scale: props.scale,
    rows: props.rows,
    span: props.span,
  }),
)

// ⚠ 一屏可能挂好几条带，pattern 的 id 撞了会让后一条引到前一条的散列
const patternId = `dt-ml-band-${useId()}`

/** 交叉散列那两档要按 id 引 pattern，别的档交给 CSS。 */
function fillOf(tone: string): string | undefined {
  if (tone === 'gap') return `url(#${patternId}-gap)`
  if (tone === 'shuffled') return `url(#${patternId}-shuffled)`
  return undefined
}
</script>

<template>
  <figure class="dt-ml-band">
    <figcaption v-if="props.caption">{{ props.caption }}</figcaption>
    <p v-if="view.isBlank" class="dt-ml-band__blank">这一步没有可画的时间段</p>
    <svg
      v-else
      :viewBox="view.viewBox"
      role="img"
      :aria-label="props.caption || '时间覆盖带'"
    >
      <defs>
        <pattern
          :id="`${patternId}-gap`"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path class="dt-ml-band__hatch--gap" d="M0,0L6,6M6,0L0,6" />
        </pattern>
        <pattern
          :id="`${patternId}-shuffled`"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
        >
          <path class="dt-ml-band__hatch--shuffled" d="M0,0L6,6M6,0L0,6" />
        </pattern>
      </defs>
      <g class="dt-ml-band__rows">
        <template v-for="row in view.rows" :key="row.key">
          <text
            class="dt-ml-band__name"
            :x="view.plot.left - 4"
            :y="row.labelTop"
          >
            {{ row.name }}
            <title>{{ row.fullName }}</title>
          </text>
          <rect
            class="dt-ml-band__lane"
            :x="view.plot.left"
            :y="row.top"
            :width="view.plot.right - view.plot.left"
            :height="view.rowHeight"
          />
          <rect
            v-for="bar in row.gaps"
            :key="bar.key"
            class="dt-ml-band__bar dt-ml-band__bar--gap"
            :fill="fillOf(bar.tone)"
            :x="bar.left"
            :y="row.top"
            :width="bar.width"
            :height="view.rowHeight"
          >
            <title>{{ bar.title }}</title>
          </rect>
          <rect
            v-for="bar in row.bars"
            :key="bar.key"
            class="dt-ml-band__bar"
            :class="`dt-ml-band__bar--${bar.tone}`"
            :fill="fillOf(bar.tone)"
            :x="bar.left"
            :y="row.top"
            :width="bar.width"
            :height="view.rowHeight"
          >
            <title>{{ bar.title }}</title>
          </rect>
        </template>
      </g>
      <line
        class="dt-ml-band__axis"
        :x1="view.plot.left"
        :y1="view.plot.baseline"
        :x2="view.plot.right"
        :y2="view.plot.baseline"
      />
      <g class="dt-ml-band__xlabels">
        <text
          v-for="tick in view.xTicks"
          :key="tick.key"
          :x="tick.at"
          :y="view.plot.baseline + 10"
        >
          {{ tick.text }}
        </text>
      </g>
    </svg>
    <p class="dt-ml-band__summary">{{ view.summary }}</p>
    <p v-for="text in view.notes" :key="text" class="dt-ml-band__note">
      {{ text }}
    </p>
    <p v-if="props.note" class="dt-ml-band__note">{{ props.note }}</p>
    <ul v-if="view.legend.length > 0" class="dt-ml-band__legend">
      <li v-for="item in view.legend" :key="item.key">
        <span
          class="dt-ml-band__swatch"
          :class="`dt-ml-band__swatch--${item.tone}`"
        />
        {{ item.text }}
      </li>
    </ul>
  </figure>
</template>

<style scoped lang="scss">
.dt-ml-band {
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

  &__name {
    text-anchor: end;
  }

  &__xlabels {
    text-anchor: middle;
  }

  &__axis {
    stroke: var(--border-strong);
  }

  &__lane {
    fill: rgba(var(--neutral-fg-rgb), 0.05);
  }

  &__bar {
    &--primary {
      fill: rgba(var(--accent-primary-rgb), 0.65);
    }

    &--secondary {
      fill: rgba(var(--state-success-rgb), 0.65);
    }

    // 「之前」/ 请求区间：空心描边、无填充
    &--requested {
      fill: none;
      stroke: var(--text-disabled);
      stroke-width: 1;
    }

    // 打乱重排：警示色的交叉散列之外还有一圈边，颜色不作唯一编码
    &--shuffled {
      stroke: var(--state-warning);
      stroke-width: 1;
    }

    // 断档：交叉散列之外还有一圈虚边
    &--gap {
      stroke: var(--border-strong);
      stroke-dasharray: 2 2;
    }
  }

  // ⚠ SVG 的 path 默认填黑：只给 stroke 的话整格散列会糊成一块实心黑
  &__hatch--gap,
  &__hatch--shuffled {
    fill: none;
  }

  &__hatch--gap {
    stroke: rgba(var(--neutral-fg-rgb), 0.3);
  }

  &__hatch--shuffled {
    stroke: var(--state-warning);
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
    width: 0.75rem;
    height: 0.5rem;
    border: 1px solid var(--border-strong);
    border-radius: 2px;

    &--primary {
      border-color: var(--accent-primary);
      background: rgba(var(--accent-primary-rgb), 0.65);
    }

    &--secondary {
      border-color: var(--state-success);
      background: rgba(var(--state-success-rgb), 0.65);
    }

    &--requested {
      border-color: var(--text-disabled);
      background: none;
    }

    &--shuffled {
      border-color: var(--state-warning);
      background: repeating-linear-gradient(
        45deg,
        rgba(var(--state-warning-rgb), 0.2),
        rgba(var(--state-warning-rgb), 0.2) 2px,
        var(--state-warning) 2px,
        var(--state-warning) 3px
      );
    }

    &--gap {
      background: repeating-linear-gradient(
        45deg,
        rgba(var(--neutral-fg-rgb), 0.05),
        rgba(var(--neutral-fg-rgb), 0.05) 2px,
        rgba(var(--neutral-fg-rgb), 0.3) 2px,
        rgba(var(--neutral-fg-rgb), 0.3) 3px
      );
    }
  }
}
</style>
