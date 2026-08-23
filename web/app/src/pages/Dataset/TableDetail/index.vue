<script setup lang="ts">
/**
 * @fileoverview 一张台账的详情：身份条 + 分区页签 + 分区出口。
 *
 * ⚠ 三个分区是**子路由**而不是页内状态：地址会跟着变，于是「把列配置发给
 * 同事」「刷新还停在这一页」「后退回上一个分区」都成立
 * （docs/DATASET_DESIGN.md §7.1）。
 * ⚠ 台账与列的状态只在这一层持有，两个分区都受控地拿到同一份列定义（§7.2），
 * 于是「改了列 → 数据表格的列跟着变」只有一条数据流。数据行是例外：它只喂给
 * 「数据」分区一处，且带着游标栈与写后重取，摊到这里会让这一层同时管四份状态。
 */
import { computed, onMounted } from 'vue'
import { RouterView, useRoute } from 'vue-router'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtPageState, DtTag } from '@dt/ui'

import PermGuard from '@/components/PermGuard.vue'
import type { AppTabItem } from '@/components/layout'
import { AppShell, AppTabNav } from '@/components/layout'
import ColumnFormDialog from './components/ColumnFormDialog.vue'
import { collectSummary } from '../scripts/collectSummary'
import { useColumnOps } from './scripts/useColumnOps'
import { useTableDetail } from './scripts/useTableDetail'

const route = useRoute()

const tableId = computed(() => String(route.params.tableId ?? ''))
const detail = useTableDetail(() => tableId.value)
const ops = useColumnOps({
  tableId: () => tableId.value,
  columns: detail.columns,
  setColumns: detail.setColumns,
  reloadColumns: detail.reloadColumns,
})

/** 分区是子路由，页签因此是真链接：可收藏、可中键新开、后退可用。 */
const tabs = computed<AppTabItem[]>(() => [
  {
    key: 'columns',
    label: '列配置',
    icon: 'list-checks',
    to: `/datasets/${tableId.value}/columns`,
  },
  {
    key: 'records',
    label: '数据',
    icon: 'table',
    to: `/datasets/${tableId.value}/records`,
  },
])

/**
 * 「只读」的判据是**一个写入口都没有**（设计 §7.3）。
 * ⚠ 拿单个码判是错的：只有录入权限的人看到「只读 · 仅可查看」，会以为自己
 * 进错了账号。这四个码互不蕴含，故要一个都不占才算只读。
 */
const WRITE_CODES: readonly string[] = [
  PERMISSION_CODES.datasetManage,
  PERMISSION_CODES.datasetRecordWrite,
  PERMISSION_CODES.datasetOverride,
  PERMISSION_CODES.datasetBackfill,
]

// 顶栏只摆列配置那一个主动作。数据分区的三颗（录入 / 重算 / 批量撤销）挂在
// 分区自己的工具条上——它们各挂各的码，摊到顶栏就得把三份权限判断也搬上来
const isColumnsTab = computed(() => route.name === 'dataset-table-columns')

const collect = computed(() => {
  const table = detail.table.value
  return table === null ? null : collectSummary(table)
})

onMounted(() => {
  void detail.load()
})
</script>

<template>
  <AppShell
    :title="detail.table.value?.name ?? '台账详情'"
    subtitle="列配置 · 数据 · 趋势"
    back-to="/datasets"
    back-label="返回台账列表"
  >
    <template #actions>
      <PermGuard
        v-if="isColumnsTab && detail.table.value"
        :codes="[PERMISSION_CODES.datasetManage]"
      >
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新增列
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col">
      <DtPageState
        :loading="detail.loading.value"
        :error="detail.error.value"
        :empty="
          detail.table.value === null &&
          !detail.loading.value &&
          detail.error.value === null
        "
        empty-title="台账不存在"
        empty-hint="它可能已经被删掉了，回列表看看。"
        @retry="detail.load()"
      >
        <div
          v-if="detail.table.value"
          class="flex h-full min-h-0 flex-col gap-4"
        >
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <DtTag mono size="sm">{{ detail.table.value.code }}</DtTag>
            <DtTag
              size="sm"
              :intent="detail.table.value.is_enabled ? 'success' : 'neutral'"
            >
              {{ detail.table.value.is_enabled ? '启用' : '停用' }}
            </DtTag>
            <!-- ⚠ 整页只摆这一处，行内不再重复——每行挂一句是纯噪音。
                 判据见 WRITE_CODES；`mode="any"` 即「四个占一个就不是只读」。
                 默认插槽刻意留空：有权限时这里什么都不该多出来（设计 §7.3） -->
            <PermGuard :codes="WRITE_CODES" mode="any" explain />
            <span class="text-text-secondary">
              {{ detail.columns.value.length }} 列
            </span>
            <span
              v-if="collect"
              class="text-text-secondary"
              :title="collect.hint"
            >
              · {{ collect.label }}
            </span>
          </div>

          <AppTabNav :items="tabs" label="台账详情分区" />

          <!-- ⚠ 分区收 table / columns / busy 三个 prop。写错 prop 名时
               typecheck 与 lint 双双放行，靠 sections.spec.ts 兜 -->
          <RouterView v-slot="{ Component }">
            <component
              :is="Component"
              class="min-h-0 flex-1"
              :table="detail.table.value"
              :columns="detail.columns.value"
              :busy="ops.busy.value"
              @edit="ops.openEdit"
              @remove="ops.removeColumn"
              @move="ops.moveColumn"
            />
          </RouterView>
        </div>
      </DtPageState>
    </div>

    <ColumnFormDialog
      v-model="ops.isFormOpen.value"
      :table-id="tableId"
      :column="ops.editing.value"
      @saved="ops.afterSaved($event)"
    />
  </AppShell>
</template>
