<script setup lang="ts">
/**
 * @fileoverview 格子的账：这一步默默改了多少个数（规格 §4.3 的 `cells` 块）。
 *
 * ⚠ 这一类最容易被略过：行数一行没变、列也一列没动，变的只是格子里的数——
 * `cast_type` 抹掉的、`fill_missing` 填上的、`clip_outlier` 削掉的都在这里。
 * ⚠ 原值样例是这一块唯一买不回来的东西：只报个数的话，用户分不出坏的是 `--`
 * 这类占位符，还是整列都填错了单位。
 */
import { DtNotice, DtTooltip } from '@dt/ui'
import { computed } from 'vue'

import type { BarListItem } from '../scripts/barList'
import {
  LEDGER_LIMITS,
  cellsSummary,
  keyedNames,
  noticesOf,
  rangeText,
  sampleText,
} from '../scripts/ledgerBlocks'
import type { ReportBlock } from '../scripts/reportBlocks'
import { cellsOf } from '../scripts/reportBlocks'

import BarList from './BarList.vue'

const props = defineProps<{ block: ReportBlock }>()

const cells = computed(() => cellsOf(props.block.payload))
const notices = computed(() => noticesOf(props.block.payload))
const summary = computed(() => cellsSummary(cells.value))

const items = computed<BarListItem[]>(() =>
  cells.value.map((cell) => ({ name: cell.key, value: cell.changed })),
)

interface CellRow {
  readonly key: string
  readonly changed: string
  readonly range: string
  readonly samples: readonly { readonly key: string; readonly text: string }[]
  readonly cut: string
}

const rows = computed<CellRow[]>(() => {
  const keys = keyedNames(cells.value.map((cell) => cell.key))
  return cells.value.map((cell, seat) => ({
    key: keys[seat] ?? cell.key,
    changed: `${cell.changed} 格`,
    range: rangeText(cell.low, cell.high),
    samples: cell.samples.map((value, place) => ({
      key: `${keys[seat] ?? cell.key}:${place}`,
      text: sampleText(value),
    })),
    // ⚠ 只说「列到上限」不说「共 M 个」：payload 不带原始个数，M 只能编
    cut:
      cell.samples.length >= LEDGER_LIMITS.samples
        ? `样例已经列到上限 ${LEDGER_LIMITS.samples} 个`
        : '',
  }))
})

const columnCut = computed(() =>
  cells.value.length >= LEDGER_LIMITS.cells
    ? `逐列的账已经列到上限 ${LEDGER_LIMITS.cells} 列，改得少的那些没有带出来`
    : '',
)
</script>

<template>
  <section class="dt-ml-cells">
    <h6 class="dt-ml-cells__title">{{ props.block.title }}</h6>
    <DtNotice
      v-for="text in notices.alerts"
      :key="text"
      intent="warning"
      icon="alert-triangle"
    >
      {{ text }}
    </DtNotice>
    <BarList :items="items" unit="格" empty-text="这一步一个格子都没有改" />
    <p v-if="columnCut !== ''" class="dt-ml-cells__more">{{ columnCut }}</p>
    <ul v-if="rows.length > 0" class="dt-ml-cells__rows">
      <li v-for="row in rows" :key="row.key">
        <p class="dt-ml-cells__head">
          <DtTooltip class="dt-ml-cells__name" :content="row.key">
            <span class="dt-ml-cells__text">{{ row.key }}</span>
          </DtTooltip>
          <span class="dt-ml-cells__num">{{ row.changed }}</span>
          <span class="dt-ml-cells__range">{{ row.range }}</span>
        </p>
        <p v-if="row.samples.length > 0" class="dt-ml-cells__samples">
          <span class="dt-ml-cells__label">原值样例</span>
          <DtTooltip
            v-for="one in row.samples"
            :key="one.key"
            class="dt-ml-cells__name"
            :content="one.text"
          >
            <span class="dt-ml-cells__text">{{ one.text }}</span>
          </DtTooltip>
        </p>
        <p v-else class="dt-ml-cells__samples">
          <span class="dt-ml-cells__label">这一列没有带回原值样例</span>
        </p>
        <p v-if="row.cut !== ''" class="dt-ml-cells__more">{{ row.cut }}</p>
      </li>
    </ul>
    <p class="dt-ml-cells__read">{{ summary }}</p>
    <ul v-if="notices.notes.length > 0" class="dt-ml-cells__hints">
      <li v-for="text in notices.notes" :key="text">{{ text }}</li>
    </ul>
  </section>
</template>

<style scoped lang="scss">
.dt-ml-cells {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-raised);

  &__title {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-md);
    font-weight: 600;
  }

  &__rows {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  &__head,
  &__samples {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 0.5rem;
    align-items: baseline;
    margin: 0;
    font-size: var(--ctl-hint-fs-sm);
  }

  &__label,
  &__range {
    color: var(--text-secondary);
  }

  &__num,
  &__range {
    font-family: var(--font-digit);
  }

  &__num {
    color: var(--text-title);
  }

  // 长中文列名与超长原值统一口径：12rem 省略号，全名走 DtTooltip（规格 §7 末）
  // ⚠ 省略号必须落在里面这层：DtTooltip 的根是 inline-flex，文字在它上面是匿名
  // 弹性项，`text-overflow` 管不着
  &__name {
    max-width: 12rem;
    min-width: 0;
  }

  &__text {
    overflow: hidden;
    max-width: 12rem;
    padding: 0.05rem 0.35rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__hints {
    margin: 0;
    padding-left: 1.1rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }

  // 图下那一行结论是给所有人的，不是 sr-only（规格 §2-P6）
  &__read {
    margin: 0;
    color: var(--text-primary);
    font-size: var(--ctl-hint-fs-sm);
  }

  &__more {
    margin: 0;
    color: var(--state-warning);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
