<script setup lang="ts">
/**
 * @fileoverview 一条轴上的若干段：数据实际覆盖的时段、没有数据的断档、并排的
 * 两段（训练 / 测试）、请求区间与实际区间的对照。六个算子（取数、重采样、切分、
 * 滞后、滚动、交叉验证）共用这一张画法，规格 §7。
 *
 * ⚠ 断档与「有数据但值为空」不是一回事：断档是这一段压根没有行，画成交叉散列；
 * 空值率那件事归直方图与条形表，别在这里混着说。
 * ⚠ 时刻按**本机时区**显示，图下那行结论里明说——后端给的一律是 UTC。
 * ⚠ 参考几何一律走文字色不走 `--border-strong`：后者压在浅色面板底上只有
 * 1.38:1，远不到 WCAG 1.4.11 对非文本图形的 3:1（口径与实测见 §7 的配色表）。
 * ⚠ 次色不能是 `--state-success`：它与 `--accent-primary` 在翡翠绿下色相只差
 * 10.7°，两档会塌成同一片绿；`--state-warning` 在全部内置预设里最小差 46.9°。
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

// 次色那一档上下各让出这么多：叠在主色上时主色从上下两条缝里露出来
const SECONDARY_INSET = 2

/**
 * 一段在自己那一行里占的纵向位置。
 * ⚠ 主次两段叠在同一行时，后画的那个整块盖住前一个，只有不重叠的一小截露出
 * 另一个颜色——而「取数覆盖真的叠了没有」正是这个件的主用途。次色缩一圈画，
 * 重叠处就一定看得见下面那一段的上下两条边。
 * Args: tone 这一段的档；top 这一行的顶；height 行高。
 */
function laneOf(
  tone: string,
  top: number,
  height: number,
): { y: number; height: number } {
  if (tone !== 'secondary' || height <= SECONDARY_INSET * 3) {
    return { y: top, height }
  }
  return { y: top + SECONDARY_INSET, height: height - SECONDARY_INSET * 2 }
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
            :y="laneOf(bar.tone, row.top, view.rowHeight).y"
            :width="bar.width"
            :height="laneOf(bar.tone, row.top, view.rowHeight).height"
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

  // 坐标轴与刻度字同一档：全部内置预设里最低 4.64:1
  &__axis {
    stroke: var(--text-disabled);
  }

  &__lane {
    fill: rgba(var(--neutral-fg-rgb), 0.05);
  }

  &__bar {
    // 每段都描一圈中性边：重叠处两条边都在，读者看得出这是两段而不是一段
    &--primary,
    &--secondary {
      stroke: rgba(var(--neutral-fg-rgb), 0.5);
      stroke-width: 0.6;
    }

    &--primary {
      fill: rgba(var(--accent-primary-rgb), 0.65);
    }

    &--secondary {
      fill: rgba(var(--state-warning-rgb), 0.65);
    }

    // 「之前」/ 请求区间：空心描边、无填充
    &--requested {
      fill: none;
      stroke: var(--text-disabled);
      stroke-width: 1;
    }

    // 打乱重排：交叉散列是它的身份，外圈那道边走中性色。
    // ⚠ 边不许跟着散列走 --state-warning——那在浅色预设下最低只有 2.00:1，这一段
    // 的轮廓就没了；散列本身照旧是警示色，颜色不作唯一编码
    &--shuffled {
      stroke: rgba(var(--neutral-fg-rgb), 0.5);
      stroke-width: 1;
    }

    // 断档：交叉散列之外还有一圈虚边
    &--gap {
      stroke: var(--text-disabled);
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
    border: 1px solid var(--text-disabled);
    border-radius: 2px;

    &--primary {
      border-color: var(--accent-primary);
      background: rgba(var(--accent-primary-rgb), 0.65);
    }

    // 次色比主色矮一圈，与图上缩一圈画的那一档对上
    &--secondary {
      height: 0.34rem;
      border-color: var(--state-warning);
      background: rgba(var(--state-warning-rgb), 0.65);
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
