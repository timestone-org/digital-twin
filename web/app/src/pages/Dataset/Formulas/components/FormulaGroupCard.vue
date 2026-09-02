<script setup lang="ts">
/**
 * @fileoverview 公式库里的一个分类分组：一张按分类切出来的小表。
 *
 * ⚠ `fill=false`：这一页是「若干个分组各一张小表」，滚动归外层那一个容器，
 * 每张小表都按内容高度渲染，否则它们会互相抢高度、谁也拿不到有界高度。
 * ⚠ 视图切换器关掉：整页共用顶部那一个，每组各挂一个会切出互不一致的状态。
 */
import type { DatasetFormulaDef, DtDataColumn } from '@dt/contracts'
import { DtCard, DtDataView, DtTag } from '@dt/ui'
import type { DtDataViewLayout } from '@dt/ui'

import FormulaRowActions from './FormulaRowActions.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', width: '16rem', card: 'title' },
  { key: 'signature', label: '调用写法', width: '16rem', card: 'meta' },
  { key: 'expression', label: '公式体' },
  { key: 'status', label: '状态', width: '8rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '12rem',
    card: 'actions',
  },
]

const LAYOUT: DtDataViewLayout = {
  toggle: false,
  fill: false,
  fixedLayout: true,
  minWidth: '64rem',
  cardColumns: 2,
  cardMinWidth: '22rem',
}

defineProps<{
  title: string
  items: readonly DatasetFormulaDef[]
  view: 'table' | 'card'
}>()

const emit = defineEmits<{
  usages: [formula: DatasetFormulaDef]
  edit: [formula: DatasetFormulaDef]
  toggle: [formula: DatasetFormulaDef]
  restore: [formula: DatasetFormulaDef]
  remove: [formula: DatasetFormulaDef]
}>()
</script>

<template>
  <DtCard :title="title" :subtitle="`${items.length} 条`" padding="sm">
    <DtDataView :columns="COLUMNS" :rows="items" :view="view" :layout="LAYOUT">
      <template #cell-name="{ row }">
        <div class="min-w-0">
          <p class="truncate">{{ row.name }}</p>
          <p
            v-if="row.description"
            class="truncate text-xs text-text-secondary"
          >
            {{ row.description }}
          </p>
        </div>
      </template>

      <!-- 调用写法直接给出来：台账列里要照着它写 @标识(实参) -->
      <template #cell-signature="{ row }">
        <DtTag mono size="sm" class="max-w-full" :title="row.signature">
          <span class="min-w-0 truncate">{{ row.signature }}</span>
        </DtTag>
      </template>

      <template #cell-expression="{ row }">
        <code
          class="block truncate text-xs text-text-secondary"
          :title="row.expression"
        >
          {{ row.expression }}
        </code>
      </template>

      <template #cell-status="{ row }">
        <span class="flex flex-wrap items-center gap-1">
          <DtTag size="sm" :intent="row.is_enabled ? 'success' : 'warning'">
            {{ row.is_enabled ? '启用' : '已停用' }}
          </DtTag>
          <DtTag v-if="row.is_builtin" size="sm">预设</DtTag>
        </span>
      </template>

      <template #cell-actions="{ row }">
        <FormulaRowActions
          :formula="row"
          @usages="emit('usages', $event)"
          @edit="emit('edit', $event)"
          @toggle="emit('toggle', $event)"
          @restore="emit('restore', $event)"
          @remove="emit('remove', $event)"
        />
      </template>
    </DtDataView>
  </DtCard>
</template>
