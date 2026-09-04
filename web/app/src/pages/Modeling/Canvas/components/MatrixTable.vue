<script setup lang="ts">
/**
 * @fileoverview 混淆矩阵：n×n 热力格，右侧一列挂每类的召回率与支持度，底部两行
 * 挂每类的精确率与判成数，右下角是总行数与准确率（设计规格 §5-21）。
 *
 * ⚠ 热力格必须坐在一层不透明实底上：面板与弹窗底色都是半透明、背后还压着一张
 * 会动的画布，直接叠半透明色会把 3% 与 12% 的格子糊成一片（规格 §7）。
 * ⚠ 颜色不作唯一编码：判对的格子数字加粗，判错的格子另加斜纹。
 * ⚠ 两半各一把尺子：对角格铺这一行的召回率，判错格铺与最深错格的行数比，图例
 * 与图注要把两句口径都写出来。判对色用 `--state-success`、判错用
 * `--state-danger`——六套预设里只有这一对色相角差处处 ≥120°（规格 §5-21）。
 */
import type { DtTableColumn } from '@dt/contracts'
import { DtEmpty, DtTable, DtTooltip } from '@dt/ui'
import { computed, type CSSProperties } from 'vue'

import {
  buildMatrixStats,
  MAX_MATRIX_CLASSES,
  type ClassStat,
  type MatrixCell,
} from '../scripts/matrixStats'
import { grouped, niceNumber } from '../scripts/numbers'

const props = withDefaults(
  defineProps<{
    labels: readonly string[]
    matrix: readonly (readonly (number | null)[])[]
    caption?: string
    maxClasses?: number
    emptyText?: string
  }>(),
  {
    caption: '',
    maxClasses: MAX_MATRIX_CLASSES,
    emptyText: '这一步没有混淆矩阵',
  },
)

// 行头那一列
const TRUTH_KEY = 'truth'
// 右侧边栏的两列
const RECALL_KEY = 'recall'
const SUPPORT_KEY = 'support'
// 热力深浅的两端：再淡就看不出这一格有数，再深就压不住字
const MIN_ALPHA = 0.12
const MAX_ALPHA = 0.72
// ⚠ 判错格上限低一档：危险色明度比成功色低得多，铺到 0.72 时暗色预设下白字只
// 剩 4.4:1、换深墨更只有 3.3:1；六套逐档实测 0.58 是六套都还有 4.6:1 的最深一档
const MISS_MAX_ALPHA = 0.58
// 过了这一档，判对格的字要换成压在实心底上的深墨色
const DEEP_ALPHA = 0.45

type CellKind = 'hit' | 'miss' | 'edge'

interface CellView {
  readonly kind: CellKind
  readonly text: string
  readonly hint: string
  readonly isDeep: boolean
  readonly isStriped: boolean
  readonly paint: CSSProperties | undefined
}

interface MatrixRow {
  readonly id: string
  readonly name: string
  readonly hint: string
  readonly cells: Readonly<Record<string, CellView>>
}

interface MatrixColumn extends DtTableColumn {
  readonly slot: string
}

const BLANK: CellView = {
  kind: 'edge',
  text: '',
  hint: '',
  isDeep: false,
  isStriped: false,
  paint: undefined,
}

const stats = computed(() => buildMatrixStats(props.labels, props.matrix))

/**
 * 比率原样写成 0–1 的数，不换算成百分数。
 * ⚠ 乘 100 会把 0.923077 推进 `niceNumber` 的定点档，印出 92.3077% 这种六位有
 * 效数字；比率档走的是四位有效数字，正是这些数该有的位数。
 */
function rate(value: number | null): string {
  return niceNumber(value)
}

/** 深浅铺在 `matrixStats` 已按两把尺子归好的强度上，这里只管两端的取值。 */
function alphaOf(cell: MatrixCell): number {
  if (cell.heat <= 0) return 0
  const top = cell.isHit ? MAX_ALPHA : MISS_MAX_ALPHA
  return MIN_ALPHA + cell.heat * (top - MIN_ALPHA)
}

/** 读数里始终印绝对行数与行内占比：颜色是相对尺子，这两个数才是绝对的。 */
function hintOf(cell: MatrixCell, truth: string, guess: string): string {
  return `真实「${truth}」判成「${guess}」：${grouped(cell.count)} 行，占这一行 ${rate(cell.share)}`
}

function heatCell(cell: MatrixCell, truth: string, guess: string): CellView {
  const alpha = alphaOf(cell)
  return {
    kind: cell.isHit ? 'hit' : 'miss',
    text: grouped(cell.count),
    hint: hintOf(cell, truth, guess),
    isDeep: cell.isHit && alpha > DEEP_ALPHA,
    isStriped: !cell.isHit && cell.count > 0,
    paint: alpha > 0 ? { '--cell-alpha': String(alpha) } : undefined,
  }
}

function edgeCell(text: string, hint: string): CellView {
  return { ...BLANK, text, hint }
}

/** 一行热力格，按列建键。 */
function heatCells(
  row: readonly MatrixCell[],
  truth: string,
  labels: readonly string[],
): Record<string, CellView> {
  const cells: Record<string, CellView> = {}
  for (const [column, cell] of row.entries()) {
    cells[`p${column}`] = heatCell(cell, truth, labels[column] ?? '')
  }
  return cells
}

/** 一个真实类目的一行：热力格 + 右侧的召回率与支持度。 */
function classRow(
  stat: ClassStat,
  index: number,
  row: readonly MatrixCell[],
  labels: readonly string[],
): MatrixRow {
  return {
    id: `truth-${index}`,
    name: stat.label,
    hint: `真实是「${stat.label}」的行`,
    cells: {
      ...heatCells(row, stat.label, labels),
      [RECALL_KEY]: edgeCell(
        rate(stat.recall),
        `召回率 = 判对 ${grouped(stat.hit)} ÷ 真实 ${grouped(stat.support)}`,
      ),
      [SUPPORT_KEY]: edgeCell(
        grouped(stat.support),
        `真实是这一类的行数，占全部 ${rate(stat.actualShare)}`,
      ),
    },
  }
}

/** 底部第一行：每类的精确率，右下角落总准确率。 */
function precisionRow(
  classes: readonly ClassStat[],
  accuracy: number | null,
): MatrixRow {
  const cells: Record<string, CellView> = {}
  for (const [column, stat] of classes.entries()) {
    cells[`p${column}`] = edgeCell(
      rate(stat.precision),
      `精确率 = 判对 ${grouped(stat.hit)} ÷ 判成「${stat.label}」的 ${grouped(stat.predicted)}`,
    )
  }
  cells[RECALL_KEY] = edgeCell(rate(accuracy), '准确率 = 对角线之和 ÷ 总行数')
  return { id: 'precision', name: '精确率', hint: '这一列里判对的比例', cells }
}

/** 底部第二行：每类被判到的行数，右下角落总行数。 */
function predictedRow(classes: readonly ClassStat[], total: number): MatrixRow {
  const cells: Record<string, CellView> = {}
  for (const [column, stat] of classes.entries()) {
    cells[`p${column}`] = edgeCell(
      grouped(stat.predicted),
      `判成「${stat.label}」的行数，占全部 ${rate(stat.predictedShare)}`,
    )
  }
  cells[SUPPORT_KEY] = edgeCell(grouped(total), '总行数')
  return {
    id: 'predicted',
    name: '判成这一类',
    hint: '被判成这一类的行数',
    cells,
  }
}

const columns = computed<MatrixColumn[]>(() => [
  {
    key: TRUTH_KEY,
    label: '真实＼判成',
    width: '8rem',
    align: 'left',
    slot: `cell-${TRUTH_KEY}`,
  },
  ...stats.value.labels.map((label, index) => ({
    key: `p${index}`,
    label,
    width: '5.5rem',
    align: 'center' as const,
    slot: `cell-p${index}`,
  })),
  {
    key: RECALL_KEY,
    label: '召回率',
    width: '5.5rem',
    align: 'right',
    slot: `cell-${RECALL_KEY}`,
  },
  {
    key: SUPPORT_KEY,
    label: '支持度',
    width: '5rem',
    align: 'right',
    slot: `cell-${SUPPORT_KEY}`,
  },
])

const rows = computed<MatrixRow[]>(() => {
  const { classes, cells, labels, accuracy, total } = stats.value
  return [
    ...classes.map((stat, index) =>
      classRow(stat, index, cells[index] ?? [], labels),
    ),
    precisionRow(classes, accuracy),
    predictedRow(classes, total),
  ]
})

/** 超过上限就不画热力表了：格子细到读不出数，硬画反而更误导。 */
const isOverflow = computed(() => stats.value.labels.length > props.maxClasses)
const isEmpty = computed(() => stats.value.labels.length === 0)
const hasGrid = computed(
  () => stats.value.issue === '' && !isEmpty.value && !isOverflow.value,
)

const overflowText = computed(
  () =>
    `类别有 ${stats.value.labels.length} 个，超过 ${props.maxClasses} 个的上限，混淆矩阵画不下`,
)

/** 错格那半张图的尺子刻在图例上：不写清楚，「越深」就没有口径。 */
const missKey = computed(() => {
  const { missPeak } = stats.value
  if (missPeak === 0) return '判错：斜纹；这一次一格都没判错'
  return `判错：斜纹，越深错的行数越多，最深的一格 ${grouped(missPeak)} 行`
})

/** 图下那行给所有人看的结论（规格 §2-P6）。 */
const summary = computed(() => {
  const { total, correct, accuracy } = stats.value
  if (total === 0) return '这份测试集里一行都没有，准确率无定义'
  return `共 ${grouped(total)} 行，判对 ${grouped(correct)} 行，准确率 ${rate(accuracy)}`
})

function cellOf(row: MatrixRow, key: string): CellView {
  return row.cells[key] ?? BLANK
}
</script>

<template>
  <div class="dt-ml-matrix">
    <p v-if="stats.issue !== ''" class="dt-ml-matrix__note">
      {{ stats.issue }}
    </p>
    <DtEmpty v-else-if="isEmpty" size="inline" :title="emptyText" />
    <p v-else-if="isOverflow" class="dt-ml-matrix__note">{{ overflowText }}</p>
    <ul v-if="hasGrid" class="dt-ml-matrix__keys">
      <li>
        <span
          class="dt-ml-matrix__swatch dt-ml-matrix__swatch--hit"
        />判对：对角线，数字加粗，越深这一类的召回率越高
      </li>
      <li>
        <span class="dt-ml-matrix__swatch dt-ml-matrix__swatch--miss" />{{
          missKey
        }}
      </li>
    </ul>
    <DtTable
      v-if="hasGrid"
      class="dt-ml-matrix__board"
      :columns="columns"
      :rows="rows"
      min-width="0"
      fixed-layout
    >
      <!-- ⚠ 插槽参数必须显式标类型：动态插槽名下 `row` 会退化成 any，
           写错字段名 typecheck 一声不吭 -->
      <template
        v-for="column in columns"
        :key="column.key"
        #[column.slot]="{ row }: { row: MatrixRow }"
      >
        <DtTooltip
          v-if="column.key === TRUTH_KEY"
          class="dt-ml-matrix__name"
          :content="row.hint"
        >
          <span class="dt-ml-matrix__text">{{ row.name }}</span>
        </DtTooltip>
        <span
          v-else
          class="dt-ml-matrix__cell"
          :class="[
            `dt-ml-matrix__cell--${cellOf(row, column.key).kind}`,
            {
              'is-deep': cellOf(row, column.key).isDeep,
              'is-striped': cellOf(row, column.key).isStriped,
            },
          ]"
          :style="cellOf(row, column.key).paint"
          :title="cellOf(row, column.key).hint"
          >{{ cellOf(row, column.key).text }}</span
        >
      </template>
    </DtTable>
    <p v-if="stats.issue === '' && !isEmpty" class="dt-ml-matrix__sum">
      {{ summary }}
    </p>
    <p v-if="caption !== '' || $slots.caption" class="dt-ml-matrix__caption">
      <slot name="caption">{{ caption }}</slot>
    </p>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-matrix {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  font-size: var(--ctl-hint-fs-sm);

  &__keys {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--text-secondary);
  }

  &__swatch {
    display: inline-block;
    width: 0.75rem;
    height: 0.55rem;
    margin-right: 0.25rem;
    border-radius: var(--radius-sm);
    vertical-align: -1px;
  }

  &__swatch--hit {
    background-color: rgba(var(--state-success-rgb), 0.6);
  }

  // 判错：危险色**并且**斜纹，颜色不作唯一编码
  &__swatch--miss {
    background-color: rgba(var(--state-danger-rgb), 0.5);
    background-image: repeating-linear-gradient(
      45deg,
      rgba(var(--neutral-fg-rgb), 0.45) 0 2px,
      transparent 2px 5px
    );
  }

  // ⚠ 热力格坐在这一层不透明实底上：面板与弹窗底色都是半透明、背后还压着一张
  // 会动的画布，半透明色直接叠上去时 3% 与 12% 的格子会糊成一片
  // ⚠ 实底要跟着表格收边：铺满整行时表格右边会拖着一大块与面板不同色的死区
  &__board {
    width: fit-content;
    max-width: 100%;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
  }

  // ⚠ 表格按列宽自然排布：铺满 100% 会把两个类目的矩阵拉成两块巨幅色块，
  // 宽了由 DtTable 自己的滚动容器横着滚
  &__board :deep(table.dt-table) {
    width: auto;
  }

  // 格子要铺满整格才读得出深浅，内边距挪到格子自己身上
  // ⚠ 选择器要比 DtTable 自己那条更具体：`.dt-table td` 编译出来与本组件的
  // `[data-v] td` 同分，同分时谁赢取决于样式表顺序
  // ⚠ `height: 1px` 是让格子撑满整行的老办法：不写它，百分比高度无从解析，
  // 没有字的那两个角上会浮出一块矮半截的色块
  &__board :deep(.dt-table td) {
    height: 1px;
    padding: 0;
    border-bottom: 0;
  }

  // ⚠ 列名也要按 8rem 收口：`table-layout: fixed` 在表宽为 auto 时不生效，
  // 列宽回落成按内容撑开，一个长类名就能把那一列拉出两倍宽
  &__board :deep(.dt-table th) {
    max-width: 8rem;
    padding: 6px;
    background: var(--surface-panel);
  }

  &__cell {
    display: block;
    box-sizing: border-box;
    height: 100%;
    padding: 0.4rem 0.35rem;
    color: var(--text-secondary);
    font-family: var(--font-digit);
    white-space: nowrap;
  }

  // 边栏：与热力格区分开，不参与深浅
  &__cell--edge {
    background-color: rgba(var(--text-title-rgb), 0.1);
    color: var(--text-title);
  }

  &__cell--hit,
  &__cell--miss {
    background-color: color-mix(
      in oklab,
      var(--cell-hue) calc(var(--cell-alpha, 0) * 100%),
      var(--surface-raised)
    );
  }

  // 判对：成功色，数字加粗
  &__cell--hit {
    --cell-hue: var(--state-success);

    color: var(--text-title);
    font-weight: 600;
  }

  // ⚠ 字用满强度的 --text-primary：格底铺到半程就落进中明度带，七成不透明度
  // 的 --text-secondary 只剩 2.4:1
  &__cell--miss {
    --cell-hue: var(--state-danger);

    color: var(--text-primary);
  }

  &__cell.is-striped {
    background-image: repeating-linear-gradient(
      45deg,
      rgba(var(--neutral-fg-rgb), 0.28) 0 2px,
      transparent 2px 5px
    );
  }

  // 深底上白字只剩 1.8:1，得换成深墨色
  &__cell.is-deep {
    color: var(--text-on-emphasis);
  }

  // 长类名统一口径：8rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是匿名
  // 弹性项，`text-overflow` 管不着
  &__name {
    max-width: 8rem;
    min-width: 0;
    padding: 0.4rem 0.5rem;
  }

  &__text {
    overflow: hidden;
    min-width: 0;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__note,
  &__sum,
  &__caption {
    margin: 0;
  }

  &__note {
    color: var(--state-warning);
  }

  &__sum {
    color: var(--text-title);
  }

  &__caption {
    color: var(--text-secondary);
  }
}
</style>
