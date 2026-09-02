<script setup lang="ts">
/**
 * @fileoverview 数据表格：数据时间 + 台账自己的列 + 录入者 + 行内动作。
 *
 * ⚠ 中间那段列是**动态**的，由台账的列配置驱动，故用 computed 拼 `DtDataColumn[]`
 * 配动态插槽名。`data-view-slots.contract.spec.ts` 只认 `const XXX_COLUMNS`
 * 形式的静态常量，扫不到这里——动态表的列⇄槽一致性由 RecordTable.spec.ts 自己
 * 钉一条（docs/DATASET_DESIGN.md §7.11）。
 * ⚠ 动态列的 key 一律加前缀：列标识由用户自定，正好起名叫 `ts` 或 `actions` 时
 * 会和固定列撞名，撞上的那一格会静默显示成另一列的内容。
 * ⚠ 翻页是游标不是页码，因此不给 `DtDataView` 传 `pagination`：这个端点根本
 * 给不出 total（§6.1）。
 */
import { computed } from 'vue'
import type { DatasetColumn, DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtCursorPager, DtDataView } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import RecordCell from './RecordCell.vue'
import { sampleMedians, type RecordRow } from '../scripts/recordView'

const LEAD_COLUMNS: readonly DtDataColumn[] = [
  { key: 'ts', label: '数据时间', width: '12rem', card: 'title' },
]

const TAIL_COLUMNS: readonly DtDataColumn[] = [
  { key: 'author', label: '录入者', width: '8rem', card: 'meta' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '6rem',
    card: 'actions',
  },
]

const EMPTY = {
  title: '这张台账还没有数据',
  hint: '用上面的「录入数据」填第一行；公式列会在保存时自动算出来。自动采集的台账要等采集器跑过一个周期才会有行。',
}

// 动态列的 key 前缀，见文件头
const VALUE_PREFIX = 'value:'

const props = defineProps<{
  rows: readonly RecordRow[]
  columns: readonly DatasetColumn[]
  loading: boolean
  error: string | null
  /** 1 起的页序。游标分页没有总数，所以只说得出这个。 */
  page: number
  hasPrev: boolean
  hasNext: boolean
  /** 有一次写在飞：行内动作跟着禁用。 */
  busy: boolean
}>()

const emit = defineEmits<{
  prev: []
  next: []
  retry: []
  edit: [row: RecordRow]
  remove: [row: RecordRow]
  revoke: [column: DatasetColumn, row: RecordRow]
}>()

/**
 * 一列在表格里的 key。
 * @param key 列标识
 */
function valueKey(key: string): string {
  return `${VALUE_PREFIX}${key}`
}

/**
 * 一列的单元格插槽名。动态插槽名写在属性位置不能带反引号，只能走函数。
 * @param key 列标识
 */
function cellSlot(key: string): `cell-${string}` {
  return `cell-${valueKey(key)}`
}

/** 表头带上单位：不带的话「1.8」到底是吨还是万吨全靠猜。 */
function headerOf(column: DatasetColumn): string {
  return column.unit === null || column.unit === ''
    ? column.name
    : `${column.name}（${column.unit}）`
}

const tableColumns = computed<DtDataColumn[]>(() => [
  ...LEAD_COLUMNS,
  ...props.columns.map((column) => ({
    key: valueKey(column.key),
    label: headerOf(column),
    width: '9rem',
    // 数值靠右：位数一变，左对齐的数字就对不上行
    ...(column.data_type === 'number' ? { align: 'right' as const } : {}),
  })),
  ...TAIL_COLUMNS,
])

// 「样本太少」是相对判断，基准是本列在当前这一页的中位数
const medians = computed(() => sampleMedians(props.columns, props.rows))
</script>

<template>
  <div class="record-table flex min-h-0 flex-1 flex-col gap-2">
    <!-- 钉死表格视图：数据表读的是「一列一列对下来」，卡片视图给不了这件事 -->
    <DtDataView
      class="min-h-0 flex-1"
      view="table"
      :columns="tableColumns"
      :rows="props.rows"
      :loading="props.loading"
      :error="props.error"
      :empty="EMPTY"
      :layout="{ toggle: false, minWidth: '60rem', fixedLayout: true }"
      @retry="emit('retry')"
    >
      <template #cell-ts="{ row }">
        <span class="whitespace-nowrap text-text-secondary">{{
          row.time
        }}</span>
      </template>

      <template
        v-for="column in props.columns"
        :key="column.key"
        #[cellSlot(column.key)]="{ row }"
      >
        <RecordCell
          :column="column"
          :row="row"
          :median="medians[column.key] ?? null"
          :busy="props.busy"
          @revoke="(target, at) => emit('revoke', target, at)"
        />
      </template>

      <!-- 自动采集的行没有录入者，说「自动采集」而不是留一个破折号：
           后者会被读成「不知道是谁写的」 -->
      <template #cell-author="{ row }">
        <span class="truncate text-xs text-text-disabled">
          {{
            row.record.created_by_name ??
            (row.record.source === 'collect' ? '自动采集' : '—')
          }}
        </span>
      </template>

      <template #cell-actions="{ row }">
        <div class="flex items-center justify-end gap-1">
          <PermGuard :codes="[PERMISSION_CODES.datasetRecordWrite]">
            <DtButton
              variant="ghost"
              intent="neutral"
              size="sm"
              icon="pencil"
              aria-label="编辑数据行"
              title="编辑数据行"
              :disabled="props.busy"
              @click="emit('edit', row)"
            />
            <DtButton
              variant="ghost"
              intent="danger"
              size="sm"
              icon="trash"
              aria-label="删除数据行"
              title="删除数据行"
              :disabled="props.busy"
              @click="emit('remove', row)"
            />
          </PermGuard>
        </div>
      </template>
    </DtDataView>

    <DtCursorPager
      class="shrink-0"
      aria-label="数据行翻页"
      :page="props.page"
      :count="props.rows.length"
      :has-prev="props.hasPrev"
      :has-next="props.hasNext"
      :loading="props.loading"
      @prev="emit('prev')"
      @next="emit('next')"
    />
  </div>
</template>

<style scoped>
/* 列名由用户自定且带单位，定宽列里不换行会盖到相邻表头上 */
.record-table :deep(.dt-table thead th) {
  white-space: normal;
  vertical-align: bottom;
}
</style>
