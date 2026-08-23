<script setup lang="ts">
/**
 * @fileoverview 数据台账列表：台账的建、改、删与检索。
 * 一张台账 = 一份自定义表结构 + 按周期落的行（docs/DATASET_DESIGN.md §1.2）。
 * 列配置、数据录入与趋势在详情页，随第 9 期落地。
 *
 * ⚠ 搜索是**纯客户端过滤**：台账是业务级资源，几十张顶天（设计 §7.9）。
 * 于是一次取回、本地筛，既不用为每个字符发一次请求，也不会出现「服务端翻页
 * 与本地筛选各筛各的」——那时第 2 页会漏掉本该命中的行，且不报任何错。
 */
import { computed, onMounted, ref } from 'vue'
import type { DatasetTableSummary, DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtIcon, DtInput, DtNotice, DtTag } from '@dt/ui'

import * as dataset from '@/api/dataset'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'
import TableFormDialog from './components/TableFormDialog.vue'
import TableRowActions from './components/TableRowActions.vue'
import { collectSummary } from '../scripts/collectSummary'
import { matchesKeyword, retentionLabel } from './scripts/tableView'
import { useTableOps } from './scripts/useTableOps'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'code', label: '编码', width: '12rem', card: 'meta' },
  { key: 'collect', label: '取数方式', width: '14rem' },
  { key: 'column_count', label: '列数', width: '5rem', align: 'right' },
  { key: 'retention', label: '保留期', width: '7rem' },
  { key: 'status', label: '状态', width: '6rem' },
  { key: 'created_at', label: '创建时间', width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '6rem',
    card: 'actions',
  },
]

const BLANK_EMPTY = {
  title: '还没有台账',
  hint: '台账用来记周期性的业务数据：先建一张表，再给它配列——人工填的、从点位历史汇总的、或由公式算出来的。',
}

// 后端 size 的上限。一次取满是「客户端过滤」的前提
const PAGE_SIZE = 200

const view = useViewMode('dataset-tables')
const keyword = ref('')

const list = useAsyncList<DatasetTableSummary>(
  (query) => dataset.listDatasetTables(query),
  PAGE_SIZE,
)
const ops = useTableOps(() => list.reload())

const visible = computed(() =>
  list.items.value.filter((table) => matchesKeyword(table, keyword.value)),
)

// ⚠ 取回的比库里的少时必须明说：本地筛选只筛得到手上这一批，闭口不谈
// 就是在拿一份不完整的结果冒充全部（设计 §7.13）
const missing = computed(() =>
  Math.max(list.total.value - list.items.value.length, 0),
)

// ⚠ 筛出来是空的不等于一张都没有：合成一种的话，关键词打错一个字，界面就在
// 劝人再建一张台账（见 utils/listEmpty）
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '台账',
    keyword: keyword.value,
    blank: BLANK_EMPTY,
  }),
)

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="数据台账" subtitle="自定义表结构 · 人工录入 / 点位汇总">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.datasetManage]" explain>
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新建台账
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="missing > 0" intent="warning" icon="alert-triangle">
        还有 {{ missing }} 张台账没取回来，搜索只筛得到已经列出的这
        {{ list.items.value.length }} 张。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="visible"
        :loading="list.loading.value"
        :error="list.error.value"
        :empty="emptyState"
        :layout="{ minWidth: '68rem', cardColumns: 3, cardMinWidth: '20rem' }"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            class="w-72"
            size="sm"
            type="search"
            placeholder="搜索名称或编码"
            aria-label="搜索台账"
          >
            <template #leading><DtIcon name="search" :size="14" /></template>
          </DtInput>
        </template>

        <template #summary>共 {{ visible.length }} 张</template>

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

        <template #cell-code="{ row }">
          <DtTag mono size="sm">{{ row.code }}</DtTag>
        </template>

        <template #cell-collect="{ row }">
          <span
            class="truncate text-text-secondary"
            :title="collectSummary(row).hint"
          >
            {{ collectSummary(row).label }}
          </span>
        </template>

        <template #cell-column_count="{ row }">{{ row.column_count }}</template>

        <template #cell-retention="{ row }">
          {{ retentionLabel(row.retention_days) }}
        </template>

        <template #cell-status="{ row }">
          <DtTag size="sm" :intent="row.is_enabled ? 'success' : 'neutral'">
            {{ row.is_enabled ? '启用' : '停用' }}
          </DtTag>
        </template>

        <template #cell-created_at="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>

        <template #cell-actions="{ row }">
          <TableRowActions
            :table="row"
            @edit="ops.openEdit($event)"
            @remove="ops.removeTable($event)"
          />
        </template>
      </DtDataView>
    </div>

    <TableFormDialog
      v-model="ops.isFormOpen.value"
      :table="ops.editing.value"
      @saved="ops.afterSaved($event)"
    />
  </AppShell>
</template>
