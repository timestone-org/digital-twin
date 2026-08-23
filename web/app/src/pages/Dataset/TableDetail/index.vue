<script setup lang="ts">
/**
 * @fileoverview 一张台账的详情：身份条 + 分区页签 + 分区出口。
 *
 * ⚠ 三个分区是**子路由**而不是页内状态：地址会跟着变，于是「把列配置发给
 * 同事」「刷新还停在这一页」「后退回上一个分区」都成立
 * （docs/DATASET_DESIGN.md §7.1）。本期只有「列配置」一个分区。
 * ⚠ 台账与列的状态只在这一层持有，分区组件全部受控、只 emit 不自取数（§7.2）。
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
])

// 每个分区的主动作各不相同（列配置是「新增列」，数据分区将是「录入数据」），
// 故按当前分区决定顶栏上摆哪一个
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
            <!-- ⚠ 「只读」的判据是**一个写入口都没有**：本页的写码只有
                 dataset:manage 一个，故它就是判据。整页只摆这一处，行内不再
                 重复——每行挂一句是纯噪音（设计 §7.3）。
                 默认插槽刻意留空：有权限时这里什么都不该多出来 -->
            <PermGuard :codes="[PERMISSION_CODES.datasetManage]" explain />
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
