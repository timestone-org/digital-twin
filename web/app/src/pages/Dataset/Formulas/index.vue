<script setup lang="ts">
/**
 * @fileoverview 公式库：可复用公式的增删改、启停、恢复出厂口径与引用反查。
 *
 * 一条库公式属于**全库**而不是某一张台账：台账列里写 `@标识(实参)` 调用它，
 * 于是改一条会同时改掉所有引用它的台账列，爆炸半径比改单张表的一列大一个量级
 * （docs/DATASET_DESIGN.md §5.11、§9）。这一页的每一处措辞都在为这件事服务：
 * 写动作单挂 `formula:manage`，改完的回执报出跟着走的列数，停用与删除的拦截
 * 原因留在页面上而不是六秒后消失。
 *
 * ⚠ 搜索是**纯客户端过滤**：库只有几十条，后端本来就不分页。
 * ⚠ 这一页没有批量重算：后端只有按表的 `:recompute`，没有按公式的批量作业。
 */
import { computed, onMounted, ref } from 'vue'
import type { DatasetFormulaDef, DtSegmentedOption } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtIcon,
  DtInput,
  DtNotice,
  DtPageState,
  DtSegmented,
} from '@dt/ui'

import * as formulas from '@/api/datasetFormulas'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { listEmptyState } from '@/utils/listEmpty'
import FormulaFormDialog from './components/FormulaFormDialog.vue'
import FormulaGroupCard from './components/FormulaGroupCard.vue'
import FormulaUsagesDialog from './components/FormulaUsagesDialog.vue'
import { groupFormulas } from './scripts/formulaView'
import { useFormulaOps } from './scripts/useFormulaOps'
import { useFormulaUsages } from './scripts/useFormulaUsages'

const VIEW_OPTIONS: readonly DtSegmentedOption[] = [
  { value: 'table', label: '表格视图', icon: 'table', iconOnly: true },
  { value: 'card', label: '卡片视图', icon: 'layout-grid', iconOnly: true },
]

const BLANK_EMPTY = {
  title: '公式库还是空的',
  hint: '公式在这里定义一次，就能被所有台账的列反复调用；出厂预设的那批口径也会列在这里。',
}

const keyword = ref('')
const view = useViewMode('dataset-formulas')

// ⚠ 后端不分页（集合只有几十条），这里包成一页只为借 useAsyncList 的三态与
// 竞态防护——连点几次写动作会并发重取，慢的那次后返回会覆盖新的结果
const list = useAsyncList<DatasetFormulaDef>(async () => {
  const items = await formulas.listDatasetFormulas()
  return { items, page: 1, size: items.length, total: items.length }
})

const ops = useFormulaOps(() => list.reload())
const usages = useFormulaUsages()

const groups = computed(() => groupFormulas(list.items.value, keyword.value))

// ⚠ 筛出来是空的不等于一条都没有：合成一种的话，关键词打错一个字，界面就在
// 劝人再建一条公式（见 utils/listEmpty）
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '公式',
    keyword: keyword.value,
    blank: BLANK_EMPTY,
  }),
)

onMounted(() => {
  void list.reload()
})
</script>

<template>
  <AppShell title="公式库" subtitle="可复用公式 · 台账列里写 @标识(实参) 调用">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.formulaManage]" explain>
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新建公式
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <p class="text-xs leading-relaxed text-text-secondary">
        公式在这里定义一次，台账列里写 @标识(实参) 就能调用。改一条公式，
        所有引用它的台账列即刻按新口径算，历史行要等各自的台账重算之后才跟上
        ——动手之前先点「引用」看一眼波及面。
      </p>

      <!-- 被后端拦下的那次操作：它点名了受影响的台账，留在页面上直到下一次动作 -->
      <DtNotice v-if="ops.blocked.value" intent="danger" icon="alert-triangle">
        {{ ops.blocked.value }}
        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          @click="ops.dismissBlocked"
        >
          知道了
        </DtButton>
      </DtNotice>

      <div class="flex flex-wrap items-center gap-3">
        <DtInput
          v-model="keyword"
          class="w-72"
          size="sm"
          type="search"
          placeholder="搜索标识、名称、说明或公式体"
          aria-label="搜索公式"
        >
          <template #leading><DtIcon name="search" :size="14" /></template>
        </DtInput>
        <DtSegmented
          v-model="view"
          class="ml-auto"
          :options="VIEW_OPTIONS"
          aria-label="切换展示方式"
        />
      </div>

      <!-- ⚠ 外面这一层不是多余的：DtPageState 渲染的是 fragment，
           class 落不到任何节点上，min-h-0 flex-1 会静默失效 -->
      <div class="min-h-0 flex-1">
        <DtPageState
          :loading="list.loading.value"
          :error="list.error.value"
          :empty="groups.length === 0"
          :empty-title="emptyState.title"
          :empty-hint="emptyState.hint"
          empty-icon="type"
          @retry="list.reload()"
        >
          <!-- 若干个分组各一张小表：滚动归这一层，小表按内容高度渲染 -->
          <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
            <FormulaGroupCard
              v-for="group in groups"
              :key="group.key"
              :title="group.label"
              :items="group.items"
              :view="view"
              @usages="usages.open($event)"
              @edit="ops.openEdit($event)"
              @toggle="ops.toggleEnabled($event)"
              @restore="ops.restorePreset($event)"
              @remove="ops.removeFormula($event)"
            />
          </div>
        </DtPageState>
      </div>
    </div>

    <FormulaFormDialog
      v-model="ops.isFormOpen.value"
      :formula="ops.editing.value"
      @saved="ops.afterSaved($event)"
    />

    <FormulaUsagesDialog
      :model-value="usages.target.value !== null"
      :title="usages.target.value?.name ?? ''"
      :rows="usages.rows.value"
      :loading="usages.loading.value"
      :error="usages.error.value"
      @update:model-value="usages.close()"
      @retry="usages.reload()"
    />
  </AppShell>
</template>
