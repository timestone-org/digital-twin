<script setup lang="ts">
/**
 * @fileoverview 横条：一个件服务规格 §5 里 18 处横条用法——排行(single)、
 * 前后对比(pairs)、三分占比(stacked)、区间(range)。
 *
 * ⚠ 用 HTML 不用 SVG：名称要跟条子对齐、要能 `text-overflow` 省略、右侧要挂
 * 读数，这三样 SVG 都做不好（设计规格 §7）。取数在 `scripts/barList.ts`。
 * ⚠ 参考几何一律走文字色不走 `--border-strong`：后者压在浅色面板底上只有
 * 1.38:1，远不到 WCAG 1.4.11 对非文本图形的 3:1（口径与实测见 §7 的配色表）。
 */
import { DtEmpty, DtTooltip } from '@dt/ui'
import { computed } from 'vue'

import {
  buildBarList,
  DEFAULT_PAIR_LABELS,
  MAX_BAR_ROWS,
  type BarListItem,
  type BarListMode,
  type BarListRule,
} from '../scripts/barList'

const props = withDefaults(
  defineProps<{
    items: readonly BarListItem[]
    mode?: BarListMode
    unit?: string
    pairLabels?: readonly [string, string]
    reference?: BarListRule | null
    threshold?: BarListRule | null
    caption?: string
    maxItems?: number
    emptyText?: string
  }>(),
  {
    mode: 'single',
    unit: '',
    pairLabels: () => DEFAULT_PAIR_LABELS,
    reference: null,
    threshold: null,
    caption: '',
    maxItems: MAX_BAR_ROWS,
    emptyText: '这一步没有可画的条目',
  },
)

const view = computed(() =>
  buildBarList(props.items, {
    mode: props.mode,
    unit: props.unit,
    pairLabels: props.pairLabels,
    reference: props.reference,
    threshold: props.threshold,
    maxItems: props.maxItems,
  }),
)

/** 截断必须标注，且要说清截了多少（规格 §2-P5）。 */
const moreText = computed(
  () =>
    `项数超过上限：只画了前 ${view.value.shown} 项，另有 ${view.value.hidden} 项没画（共 ${props.items.length} 项）`,
)
</script>

<template>
  <div class="dt-ml-bars">
    <ul v-if="view.legend.length > 0" class="dt-ml-bars__keys">
      <li v-for="one in view.legend" :key="one.key">
        <span
          class="dt-ml-bars__swatch"
          :class="`dt-ml-bars__swatch--${one.kind}`"
        />{{ one.label }}
      </li>
    </ul>
    <ul v-if="view.rows.length > 0" class="dt-ml-bars__rows">
      <li
        v-if="view.ruleLabels.length > 0"
        class="dt-ml-bars__ruler"
        :class="{ 'dt-ml-bars__ruler--tall': view.ruleRows > 1 }"
      >
        <span
          v-for="one in view.ruleLabels"
          :key="one.key"
          class="dt-ml-bars__mark"
          :class="[
            `dt-ml-bars__mark--${one.kind}`,
            `dt-ml-bars__mark--${one.place}`,
            `dt-ml-bars__mark--row${one.row}`,
          ]"
          :style="one.style"
        >
          <span class="dt-ml-bars__mark-text">{{ one.label }}</span>
        </span>
      </li>
      <li v-for="row in view.rows" :key="row.key" class="dt-ml-bars__row">
        <DtTooltip class="dt-ml-bars__name" :content="row.name">
          <span class="dt-ml-bars__label">{{ row.name }}</span>
        </DtTooltip>
        <span class="dt-ml-bars__track" aria-hidden="true">
          <span
            v-for="rule in view.rules"
            :key="rule.key"
            class="dt-ml-bars__rule"
            :class="`dt-ml-bars__rule--${rule.kind}`"
            :style="rule.style"
          />
          <span
            v-for="piece in row.pieces"
            :key="piece.key"
            class="dt-ml-bars__piece"
            :class="[
              `dt-ml-bars__piece--${piece.tone}`,
              `dt-ml-bars__piece--${piece.band}`,
            ]"
            :style="piece.style"
          />
          <span
            v-if="row.whisker"
            class="dt-ml-bars__whisker"
            :style="row.whisker"
          />
          <span v-if="row.tick" class="dt-ml-bars__tick" :style="row.tick" />
          <span v-if="row.dot" class="dt-ml-bars__dot" :style="row.dot" />
        </span>
        <span class="dt-ml-bars__num">{{ row.text }}</span>
      </li>
    </ul>
    <DtEmpty v-else size="inline" :title="emptyText" />
    <p v-if="view.hidden > 0" class="dt-ml-bars__more">{{ moreText }}</p>
    <p v-if="caption !== '' || $slots.caption" class="dt-ml-bars__caption">
      <slot name="caption">{{ caption }}</slot>
    </p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-bars {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;

  &__keys,
  &__rows {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // ⚠ 三列必须由整张表定宽，不是每行各自收缩：名字与读数逐行长短不一时，
  // 每行的轨道起点与终点会各差几十像素，条长就没法横着比了
  // ⚠ 每格还要各自写死列号：标签那一栏只占中间一列，光靠自动落位会把它后面
  // 所有格子挨个推后一格，整张表错位
  &__rows {
    display: grid;
    grid-template-columns: fit-content(12rem) minmax(0, 1fr) max-content;
    gap: 0.25rem 0.5rem;
    align-items: center;
    font-size: var(--ctl-hint-fs-sm);
  }

  &__swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.55rem;
    margin-right: 0.25rem;
    border-radius: var(--radius-sm);
    vertical-align: -1px;
  }

  &__row {
    display: contents;
  }

  // 竖线的名字站在自己那条线的正上方：搁在左上角图例里的话，读者得横跨大半张
  // 图才能把字与线对上，而参考线与阈值线两个色块本来就长得差不多（规格 §7）
  &__ruler {
    position: relative;
    height: 1.05rem;
    grid-column: 2;
  }

  // 两条标签挨得太近时错开一行摆，这一栏跟着长高
  &__ruler--tall {
    height: 2.1rem;
  }

  &__mark {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 0;
    color: var(--text-secondary);

    // 引线：从这块字的底下接到轨道上，跨过网格那道缝
    &::after {
      position: absolute;
      top: 100%;
      left: 0;
      height: 0.25rem;
      border-left: 1px dashed var(--text-disabled);
      content: '';
    }
  }

  &__mark--row1::after {
    top: calc(100% - 1.05rem);
    height: 1.3rem;
  }

  // 阈值线的引线跟着阈值线走：更粗一档的文字色。
  // ⚠ 不许回到 --state-warning——它压在浅色面板底上最低只有 2.00:1，远不到 WCAG
  // 1.4.11 对非文本图形的 3:1。哪条线是阈值靠线宽与这块字自己的名字认
  &__mark--threshold::after {
    border-left-width: 2px;
    border-left-color: var(--text-secondary);
  }

  &__mark-text {
    position: absolute;
    bottom: 0;
    left: 0;
    line-height: 1.05rem;
    white-space: nowrap;
  }

  &__mark--row1 &__mark-text {
    bottom: 1.05rem;
  }

  // 落在轨道正中的居中摆，贴着两端的改成单边对齐，免得写到轨道外面去
  &__mark--mid &__mark-text {
    transform: translateX(-50%);
  }

  &__mark--start &__mark-text {
    margin-left: 0.15rem;
  }

  &__mark--end &__mark-text {
    margin-left: -0.15rem;
    transform: translateX(-100%);
  }

  // 长中文列名统一口径：12rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是匿名
  // 弹性项，`text-overflow` 管不着，名字会顶开整行而不是收成省略号
  &__name {
    min-width: 0;
    grid-column: 1;
  }

  &__label {
    overflow: hidden;
    min-width: 0;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__track {
    position: relative;
    height: 1rem;
    grid-column: 2;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
  }

  &__piece {
    position: absolute;
    border-radius: var(--radius-sm);
  }

  &__piece--full {
    top: 0;
    bottom: 0;
  }

  &__piece--top {
    top: 0;
    bottom: 52%;
  }

  &__piece--bottom {
    top: 52%;
    bottom: 0;
  }

  &__swatch--primary,
  &__piece--primary {
    background-color: rgba(var(--accent-primary-rgb), 0.75);
  }

  // 空心描边无填充时，两个色相在全部内置预设下的对比关系不稳定
  &__swatch--before,
  &__piece--before {
    border: 1px dashed var(--text-disabled);
  }

  // 丢弃/被改写：警示色**并且**斜纹，颜色不作唯一编码
  &__swatch--dropped,
  &__piece--dropped {
    background-color: rgba(var(--state-warning-rgb), 0.5);
    background-image: repeating-linear-gradient(
      45deg,
      rgba(var(--neutral-fg-rgb), 0.45) 0 2px,
      transparent 2px 5px
    );
  }

  // 越界：危险色**并且**一圈边框
  &__swatch--danger,
  &__piece--danger {
    border: 1px solid var(--state-danger);
    background-color: rgba(var(--state-danger-rgb), 0.55);
  }

  &__swatch--neutral,
  &__piece--neutral {
    background-color: rgba(var(--neutral-fg-rgb), 0.25);
  }

  // ⚠ 竖线往左挪半像素：落在 0% 或 100% 上时，描边整条落在轨道外被裁掉，
  // 而「阈值恰好是最大值」「全是负数」这两种情形一点都不罕见
  &__rule,
  &__tick {
    position: absolute;
    top: 0;
    bottom: 0;
    margin-left: -0.5px;
  }

  &__swatch--zero,
  &__swatch--reference,
  &__swatch--threshold,
  &__swatch--tick {
    width: 0;
  }

  // ⚠ 参考几何一律走文字色不走 --border-strong：后者压在浅色面板底上只有
  // 1.38:1，零线与参考线在浅色预设里根本找不到（六套实测见 §7 的配色表）
  &__swatch--zero,
  &__swatch--reference,
  &__swatch--threshold,
  &__rule {
    border-left: 1px dashed var(--text-disabled);
  }

  // 零线是这张图的基准：实线，走高对比度文字色
  &__swatch--zero,
  &__rule--zero {
    border-left-style: solid;
    border-left-color: var(--text-secondary);
  }

  // 阈值线：更粗一档，配它自己那块字
  &__swatch--threshold,
  &__rule--threshold {
    border-left-width: 2px;
    border-left-color: var(--text-secondary);
  }

  &__swatch--tick,
  &__tick {
    border-left: 1px solid var(--text-title);
  }

  &__swatch--dot,
  &__dot {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: var(--radius-pill);
    background: var(--accent-primary);
  }

  &__whisker {
    position: absolute;
    top: calc(50% - 0.3rem);
    height: 0.6rem;
    border-inline: 1px solid rgba(var(--text-title-rgb), 0.8);

    &::before {
      position: absolute;
      top: 50%;
      right: 0;
      left: 0;
      border-top: 1px solid rgba(var(--text-title-rgb), 0.8);
      content: '';
    }
  }

  &__dot {
    position: absolute;
    top: 50%;
    margin: -0.2rem 0 0 -0.2rem;
  }

  &__num {
    grid-column: 3;
    color: var(--text-title);
    font-family: var(--font-digit);
    text-align: right;
    white-space: nowrap;
  }

  &__more,
  &__caption {
    margin: 0;
    font-size: var(--ctl-hint-fs-sm);
  }

  &__more {
    color: var(--state-warning);
  }

  &__caption {
    color: var(--text-secondary);
  }
}
</style>
