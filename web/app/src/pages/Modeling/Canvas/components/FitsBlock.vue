<script setup lang="ts">
/**
 * @fileoverview `fits` 块的画法：学到了什么、能不能核对——逐列一行的表
 * ＋ 一行结论 ＋ 表下逐列一行的算式。
 *
 * ⚠ 算式一律摆在表格**下方**而不是塞进单元格：塞进去之后分式与根号只能压成
 * 一行文本，一条公式的优先级从版式上就读不出来了（规格 §11 的 R-28）。
 * ⚠ 参数列由数据自适应展开，取料在 `scripts/fitsTable.ts`。
 */
import { DtEmpty, DtTable, DtTooltip } from '@dt/ui'
import { computed } from 'vue'

import { notesOf, sortedNotes } from '../scripts/blockNotes'
import {
  BLANK,
  fitColumnsOf,
  fitFormulasOf,
  fitRowsOf,
  fitTableRowsOf,
  fitsSummary,
  hasSkipped,
  type FitColumn,
} from '../scripts/fitsTable'
import type { ReportBlock } from '../scripts/reportBlocks'
import { fitsOf } from '../scripts/reportBlocks'

import FormulaBlock from './FormulaBlock.vue'

const props = defineProps<{ block: ReportBlock }>()

// 列名那一列宽 12rem（长中文列名收省略号），参数列各 8rem，理由列 14rem
const NAME_REM = 12
const PARAM_REM = 8
const REASON_REM = 14

const NAME_COLUMN: FitColumn = {
  key: 'key',
  label: '列',
  width: `${NAME_REM}rem`,
  align: 'left',
  slot: 'cell-key',
}

const REASON_COLUMN: FitColumn = {
  key: 'reason',
  label: '没处理的原因',
  width: `${REASON_REM}rem`,
  align: 'left',
  slot: 'cell-reason',
}

const fit = computed(() => fitsOf(props.block.payload))
const rows = computed(() => fitRowsOf(fit.value))
const paramColumns = computed(() => fitColumnsOf(rows.value))
const isSkipShown = computed(() => hasSkipped(rows.value))

const columns = computed<FitColumn[]>(() => [
  NAME_COLUMN,
  ...paramColumns.value,
  ...(isSkipShown.value ? [REASON_COLUMN] : []),
])

const tableRows = computed(() => fitTableRowsOf(rows.value, paramColumns.value))

// 列多了让 DtTable 自己横滚，不把每一列压到读不出来
const minWidth = computed(
  () =>
    `${NAME_REM + paramColumns.value.length * PARAM_REM + (isSkipShown.value ? REASON_REM : 0)}rem`,
)

const summary = computed(() => fitsSummary(fit.value, rows.value))
const formulas = computed(() => fitFormulasOf(rows.value))
// ⚠ 两档不能合并：会让人读出错误结论的那一句要整条摆，口径说明一行灰字就够
const notes = computed(() => sortedNotes(notesOf(props.block.payload)))
</script>

<template>
  <div class="dt-ml-fits">
    <p class="dt-ml-fits__title">{{ props.block.title }}</p>
    <DtEmpty
      v-if="rows.length === 0"
      size="inline"
      title="这一步没有可核对的拟合参数"
    />
    <template v-else>
      <DtTable
        :columns="columns"
        :rows="tableRows"
        :min-width="minWidth"
        :caption="props.block.title"
      >
        <template #cell-key="{ row }">
          <DtTooltip class="dt-ml-fits__name" :content="row.name">
            <span class="dt-ml-fits__label">{{ row.name }}</span>
          </DtTooltip>
        </template>
        <template
          v-for="column in paramColumns"
          :key="column.key"
          #[column.slot]="{ row }"
        >
          {{ row.values[column.key] ?? BLANK }}
        </template>
        <template #cell-reason="{ row }">
          <span class="dt-ml-fits__reason">{{
            row.reason === '' ? BLANK : row.reason
          }}</span>
        </template>
      </DtTable>
      <p class="dt-ml-fits__summary">{{ summary }}</p>
      <section v-if="formulas.length > 0" class="dt-ml-fits__fx">
        <p class="dt-ml-fits__fx-title">逐列的算式</p>
        <FormulaBlock
          v-for="one in formulas"
          :key="one.key"
          class="dt-ml-fits__fx-row"
          :nodes="one.nodes"
        />
      </section>
      <ul v-if="notes.length > 0" class="dt-ml-fits__notes">
        <li
          v-for="one in notes"
          :key="one.text"
          :class="`dt-ml-fits__note--${one.level}`"
        >
          {{ one.text }}
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-fits {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  // 长中文列名统一口径：12rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是
  // 匿名弹性项，`text-overflow` 管不着，名字会把整列顶宽
  &__name {
    display: flex;
    max-width: 12rem;
    min-width: 0;
  }

  &__label {
    overflow: hidden;
    min-width: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__reason {
    color: var(--text-secondary);
  }

  &__summary {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
    line-height: 1.6;
  }

  &__fx {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding-top: 0.25rem;
    border-top: 1px solid var(--border-subtle);
  }

  &__fx-title {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    font-weight: 600;
  }

  // 一列一行等宽起排：左边缘对齐，读者按行比得出哪一列的参数不一样
  &__fx-row {
    padding: 0.125rem 0;
  }

  &__notes {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    line-height: 1.6;
  }

  // 会让人读出错误结论的那一句自己带底与边：一行灰字在一屏数字里会被略过
  &__note--alert {
    padding: 0.125rem 0.375rem;
    border-left: 3px solid rgba(var(--state-warning-rgb), 0.7);
    background: rgba(var(--state-warning-rgb), 0.08);
    color: var(--text-primary);
    list-style: none;
  }
}
</style>
