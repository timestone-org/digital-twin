<script setup lang="ts">
/**
 * @fileoverview `bins` 块的画法：每列一张分布直方图，参考线画在它该在的地方。
 * 服务取数、对齐、过滤、裁剪、填缺失、标准化、丢缺失、重采样这几个算子
 * （规格 §5、§4.3 的 `bins` 那一行）。
 *
 * ⚠ 后端的 `by_column[].low/high` 是这条轴的两端，桶高自己说不出它横跨哪一段：
 * 缺了这两个数只能照实说画不出来，不许拿下标当刻度顶上去。
 * ⚠ `reporting.py::_ratio_bins` 那一族（cast_type / drop_missing）铺的是 0–1 的
 * 空值率、每列只有一两个数，不是分布：拿直方图画会印出「轴上共 0.42 行」这种
 * 假账，故这一档改走横条。判据只认「两端恰是 0 与 1 且每列不超过两根柱」。
 */
import { DtButton, DtTooltip } from '@dt/ui'
import { computed, ref } from 'vue'

import type { BarListItem, BarListMode, BarListRule } from '../scripts/barList'
import type {
  HistogramBin,
  HistogramMark,
  NormalCurve,
  OffAxisBar,
} from '../scripts/histogramGeometry'
import { grouped, niceNumber, percentText } from '../scripts/numbers'
import type { ReportBlock } from '../scripts/reportBlocks'
import { binsOf, recordOf } from '../scripts/reportBlocks'

import BarList from './BarList.vue'
import BlockNotes from './BlockNotes.vue'
import HistogramChart from './HistogramChart.vue'

const props = defineProps<{ block: ReportBlock }>()

// 后端 `reporting.py` 的两个硬上限：触到了界面要说清还有没列出来的（§2-P5）
const MAX_COLUMNS = 8
const MAX_BINS = 40
/** 首屏先画这么多列：八张直方图摞在一起一屏读不完，其余的按需展开。 */
const FIRST_SHOWN = 2
/** 比率档的两端与柱数上限，与 `_ratio_bins` 的固定签名对齐。 */
const RATIO_LOW = 0
const RATIO_HIGH = 1
const RATIO_BARS = 2

const INTENTS = ['danger', 'warning', 'info'] as const
type MarkIntent = (typeof INTENTS)[number]

/** 认不出的语义一律落到 `info`：它是最轻的那一档，不会把一条线冤成越界线。 */
function intentOf(text: string): MarkIntent {
  return INTENTS.find((one) => one === text) ?? 'info'
}

function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 这条轴的两端。⚠ `binsOf` 今天不读这两个字段，只能就地补一趟同序的读取。 */
interface Range {
  low: number | null
  high: number | null
}

function rangesOf(payload: Record<string, unknown>): Range[] {
  const raw = payload['by_column']
  const items = Array.isArray(raw) ? raw : []
  return items.map((item) => {
    const one = recordOf(item)
    return { low: numberOf(one['low']), high: numberOf(one['high']) }
  })
}

interface ColumnView {
  id: string
  name: string
  /** 后端给的桶高原样留一份：比率档要按数读，不按柱读。 */
  values: number[]
  bins: HistogramBin[]
  marks: HistogramMark[]
  offAxis: OffAxisBar | null
  /** 同均值同方差的正态参考曲线；null = 这张图不比对正态。 */
  curve: NormalCurve | null
  range: Range
  /** 图下那行结论：轴铺在哪、几个箱、几条参考线（规格 §2-P6）。 */
  note: string
}

/**
 * 桶高折成柱：等宽铺在 `[low, high]` 上。两端缺一个就一根柱都不画。
 *
 * ⚠ 丢弃段跟着桶走：这一步筛掉的行数是后端逐桶数出来的，前端拿参考线的哪一侧
 * 去推的话，判据是 `>` 还是 `<` 它根本不知道。
 * Args: counts, dropped, range。
 */
function barsOf(
  counts: readonly number[],
  dropped: readonly number[],
  range: Range,
): HistogramBin[] {
  const { low, high } = range
  if (counts.length === 0 || low === null || high === null) return []
  const width = (high - low) / counts.length
  return counts.map((count, seat) => ({
    low: low + seat * width,
    high: low + (seat + 1) * width,
    count,
    dropped: dropped[seat] ?? 0,
  }))
}

/** 参考线读成一句话：位置要跟着名字一起说，只说名字对不上号。 */
function markText(marks: readonly HistogramMark[]): string {
  if (marks.length === 0) return ''
  const listed = marks
    .map(
      (mark) =>
        `${mark.label === '' ? '未命名' : mark.label}（${niceNumber(mark.at)}）`,
    )
    .join('、')
  return `；参考线 ${marks.length} 条：${listed}`
}

function noteOf(
  counts: readonly number[],
  range: Range,
  marks: readonly HistogramMark[],
): string {
  const { low, high } = range
  if (low === null || high === null) {
    return counts.length === 0
      ? '这一列没有可画的分布'
      : `这一列没给出数轴的两端：有 ${grouped(counts.length)} 个桶高，却不知道它们横跨哪一段，画不出来`
  }
  const span = `横轴 ${niceNumber(low)} ~ ${niceNumber(high)}`
  if (counts.length === 0) return `${span}，一根柱都没有`
  const full =
    counts.length >= MAX_BINS
      ? `；箱数已到上限 ${MAX_BINS}，更细的分不出来`
      : ''
  return `${span}，共 ${grouped(counts.length)} 个箱${markText(marks)}${full}`
}

const ranges = computed(() => rangesOf(props.block.payload))

const columns = computed<ColumnView[]>(() =>
  binsOf(props.block.payload).map((column, seat) => {
    const range = ranges.value[seat] ?? { low: null, high: null }
    const marks = column.marks.map((mark) => ({
      at: mark.at,
      label: mark.label,
      intent: intentOf(mark.intent),
    }))
    return {
      // ⚠ 位置进 key：同名两列会撞键，撞了之后 Vue 只画得出一张
      id: `${seat}:${column.key}`,
      name: column.key,
      values: column.bins,
      bins: barsOf(column.bins, column.dropped, range),
      marks,
      offAxis: column.offAxis,
      curve: column.curve,
      range,
      note: noteOf(column.bins, range, marks),
    }
  }),
)

const isOpen = ref(false)

const shown = computed(() =>
  isOpen.value ? columns.value : columns.value.slice(0, FIRST_SHOWN),
)

const restCount = computed(() =>
  Math.max(columns.value.length - FIRST_SHOWN, 0),
)

const moreText = computed(() =>
  isOpen.value
    ? '收起后面那几列'
    : `展开另外 ${grouped(restCount.value)} 列的分布`,
)

/** 每列只有一两个铺在 0–1 上的数：这是空值率，不是分布。 */
const isRatio = computed(
  () =>
    columns.value.length > 0 &&
    columns.value.every(
      (column) =>
        column.range.low === RATIO_LOW &&
        column.range.high === RATIO_HIGH &&
        column.values.length <= RATIO_BARS,
    ),
)

const ratioMode = computed<BarListMode>(() =>
  columns.value.some((column) => column.values.length > 1) ? 'pairs' : 'single',
)

const ratioItems = computed<BarListItem[]>(() =>
  columns.value.map((column) => ({
    name: column.name,
    value: column.values[0] ?? null,
    before: column.values[0] ?? null,
    after: column.values[1] ?? null,
  })),
)

/** 阈值那条线：几列共用同一条，取第一条读得出来的。 */
const ratioRule = computed<BarListRule | null>(() => {
  for (const column of columns.value) {
    const [mark] = column.marks
    if (mark !== undefined) return { value: mark.at, label: mark.label }
  }
  return null
})

/** 最高的那一列。⚠ 算不出来的那几列不参与比较，也不当成 0（规格 §2-P4）。 */
interface RatioTop {
  name: string
  value: number
  after: number | null
}

const ratioTop = computed<RatioTop | null>(() => {
  let best: RatioTop | null = null
  for (const column of columns.value) {
    const [value] = column.values
    if (value === undefined) continue
    if (best === null || value > best.value) {
      best = { name: column.name, value, after: column.values[1] ?? null }
    }
  }
  return best
})

/** 比率档的结论：最高的那一列是谁、有没有越过阈值（规格 §2-P6）。 */
const ratioNote = computed(() => {
  const top = ratioTop.value
  if (top === null) {
    return '这几列的空值率一个都算不出来（这一步一行都没有），一列都没画。'
  }
  const head =
    ratioMode.value === 'pairs'
      ? `最高的一列是「${top.name}」：${percentText(top.value * 100)} → ${percentText(top.after === null ? null : top.after * 100)}`
      : `最高的一列是「${top.name}」：${percentText(top.value * 100)}`
  const rule = ratioRule.value
  if (rule === null) return `${head}。`
  const over = columns.value.filter(
    (column) => (column.values[0] ?? -1) > rule.value,
  ).length
  const line = `${rule.label} ${percentText(rule.value * 100)}`
  return over === 0
    ? `${head}；${line}，没有一列越过。`
    : `${head}；${line}，${grouped(over)} 列越过了。`
})

/** 整块的结论那行字。 */
const summary = computed(() => {
  const count = columns.value.length
  if (count === 0) return '这一步没有可画的分布。'
  const drawn = isRatio.value ? count : shown.value.length
  const head = `共 ${grouped(count)} 列，画了 ${grouped(drawn)} 列。`
  return count >= MAX_COLUMNS
    ? `${head}最多只画得下 ${MAX_COLUMNS} 列，这一块已经列满，可能还有列没画出来。`
    : head
})
</script>

<template>
  <section class="dt-ml-bins">
    <p class="dt-ml-bins__title">{{ props.block.title }}</p>
    <template v-if="isRatio">
      <BarList
        :items="ratioItems"
        :mode="ratioMode"
        :threshold="ratioRule"
        empty-text="这一步没有可画的空值率"
      />
      <p class="dt-ml-bins__note">{{ ratioNote }}</p>
    </template>
    <template v-else>
      <div class="dt-ml-bins__grid">
        <figure
          v-for="column in shown"
          :key="column.id"
          class="dt-ml-bins__cell"
        >
          <DtTooltip class="dt-ml-bins__name" :content="column.name">
            <span class="dt-ml-bins__label">{{ column.name }}</span>
          </DtTooltip>
          <HistogramChart
            :bins="column.bins"
            :marks="column.marks"
            :off-axis="column.offAxis"
            :curve="column.curve"
            dropped-label="被这一步筛掉"
          />
          <figcaption class="dt-ml-bins__note">{{ column.note }}</figcaption>
        </figure>
      </div>
      <DtButton
        v-if="restCount > 0"
        class="dt-ml-bins__toggle"
        variant="ghost"
        size="sm"
        @click="isOpen = !isOpen"
      >
        {{ moreText }}
      </DtButton>
    </template>
    <p class="dt-ml-bins__summary">{{ summary }}</p>
    <BlockNotes :payload="props.block.payload" />
  </section>
</template>

<style scoped lang="scss">
.dt-ml-bins {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  // 一列一张图并排铺；列宽下限与主体图同档，摆不下两张就整列摞下来。
  // ⚠ 下限写小了是「配了不生效」的隐形版：图照画，只是 viewBox 把 7px 的刻度字
  // 按「渲染宽 ÷ 360」缩到读不动，代码一行都不红
  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(44rem, 100%), 44rem));
    gap: 0.75rem;
  }

  &__cell {
    margin: 0;
    // 单元格内不再另设上限，图跟着格子走
    --dt-ml-chart-max: 100%;
  }

  // 长中文列名统一口径：12rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是匿名
  // 弹性项，`text-overflow` 管不着
  &__name {
    display: flex;
    max-width: 12rem;
    min-width: 0;
  }

  &__label {
    overflow: hidden;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__note,
  &__summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__toggle {
    align-self: flex-start;
  }
}
</style>
