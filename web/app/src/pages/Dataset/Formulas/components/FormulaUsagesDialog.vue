<script setup lang="ts">
/**
 * @fileoverview 引用反查：哪些台账列在用这一条库公式。
 *
 * 这是这一页的安全网。改一条库公式**即刻**改掉全部引用方的口径，而历史行要
 * 等那张台账重算之后才跟上——改之前先看这一面，改之后去重算
 * （docs/DATASET_DESIGN.md §5.11）。
 * ⚠ 这里**不摆批量重算**：后端只有按表的 `:recompute`，没有按公式的批量作业。
 * 摆一个按不动的按钮不如老实指路。
 */
import { RouterLink } from 'vue-router'
import type { DtDataColumn } from '@dt/contracts'
import { DtButton, DtDataView, DtModal, DtTag } from '@dt/ui'
import type { DtDataViewLayout } from '@dt/ui'

import type { FormulaUsageRow } from '../scripts/formulaView'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'table_name', label: '台账', width: '12rem', card: 'title' },
  { key: 'column_name', label: '列', width: '10rem', card: 'meta' },
  { key: 'formula', label: '列公式' },
  {
    key: 'actions',
    label: '',
    align: 'right',
    width: '6rem',
    card: 'actions',
  },
]

const LAYOUT: DtDataViewLayout = {
  toggle: false,
  fill: false,
  minWidth: '38rem',
}

const EMPTY = {
  title: '还没有台账列在用它',
  hint: '现在改它的口径不会影响任何已有数据。',
}

const props = defineProps<{
  modelValue: boolean
  title: string
  rows: readonly FormulaUsageRow[]
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  retry: []
}>()
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="`引用「${props.title}」的台账列`"
    description="改动即刻生效，历史行要等那张台账重算之后才跟上"
    width="52rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs leading-relaxed text-text-secondary">
        下面这些列即刻按新口径算。标「间接」的那几列是被别的库公式带进来的，
        改这一列救不了、要去改那条公式。新口径落到历史行上，要在各自的台账
        详情页重算。
      </p>

      <DtDataView
        :columns="COLUMNS"
        :rows="props.rows"
        view="table"
        :loading="props.loading"
        :error="props.error"
        :empty="EMPTY"
        :layout="LAYOUT"
        @retry="emit('retry')"
      >
        <template #cell-table_name="{ row }">
          <span class="truncate">{{ row.table_name }}</span>
        </template>

        <template #cell-column_name="{ row }">
          <span class="flex items-center gap-1">
            <span class="truncate">{{ row.column_name }}</span>
            <DtTag v-if="!row.is_direct" size="sm" intent="warning">间接</DtTag>
          </span>
        </template>

        <template #cell-formula="{ row }">
          <code
            class="block truncate text-xs text-text-secondary"
            :title="row.formula"
          >
            {{ row.formula }}
          </code>
        </template>

        <template #cell-actions="{ row }">
          <RouterLink :to="`/datasets/${row.table_id}`">
            <DtButton variant="ghost" intent="neutral" size="sm">
              去台账
            </DtButton>
          </RouterLink>
        </template>
      </DtDataView>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        关闭
      </DtButton>
    </template>
  </DtModal>
</template>
