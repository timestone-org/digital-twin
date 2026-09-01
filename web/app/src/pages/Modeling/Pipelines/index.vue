<script setup lang="ts">
/**
 * @fileoverview 分析建模的流水线列表：建、改、删，以及进画布。
 * 一条流水线 = 一张算子图 + 它历次的运行（docs/MODELING_DESIGN.md §3）。
 *
 * ⚠ 搜索是**纯客户端过滤**：流水线是业务级资源，几十条顶天（设计 §9.1）。
 */
import type { DtDataColumn, ModelingPipelineSummary } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtIcon, DtInput, DtNotice, DtTag } from '@dt/ui'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'

import * as modeling from '@/api/modeling'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'

import PipelineFormDialog from './components/PipelineFormDialog.vue'
import { usePipelineOps } from './scripts/usePipelineOps'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'code', label: '编码', width: '12rem', card: 'meta' },
  { key: 'node_count', label: '算子数', width: '6rem', align: 'right' },
  { key: 'sources', label: '取自台账', width: '16rem' },
  { key: 'updated_at', label: '最近改动', width: '12rem' },
  {
    key: 'actions',
    label: '操作',
    align: 'right',
    width: '8rem',
    card: 'actions',
  },
]

const BLANK_EMPTY = {
  title: '还没有流水线',
  hint: '流水线把「取数 → 预处理 → 特征 → 训练 → 评估」串成一张图。先建一条，再到画布上摆算子。',
}

// 后端 size 的上限。一次取满是「客户端过滤」的前提
const PAGE_SIZE = 200

const view = useViewMode('modeling-pipelines')
const keyword = ref('')

const list = useAsyncList<ModelingPipelineSummary>(
  (query) => modeling.listModelingPipelines(query),
  PAGE_SIZE,
)
const ops = usePipelineOps(() => void list.reload())

const visible = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return list.items.value
  return list.items.value.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.code.toLowerCase().includes(needle),
  )
})

// ⚠ 取回的比库里的少时必须明说：本地筛选只筛得到手上这一批
const missing = computed(() =>
  Math.max(list.total.value - list.items.value.length, 0),
)

const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '流水线',
    keyword: keyword.value,
    blank: BLANK_EMPTY,
  }),
)

onMounted(() => void list.reload())
</script>

<template>
  <AppShell title="分析建模" subtitle="算子图 · 训练 · 发布成台账公式">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.modelingView]">
        <RouterLink to="/modeling/models">
          <DtButton variant="ghost" size="sm" icon="layers">模型库</DtButton>
        </RouterLink>
      </PermGuard>
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]" explain>
        <DtButton size="sm" icon="plus" @click="ops.openCreate">
          新建流水线
        </DtButton>
      </PermGuard>
    </template>

    <!-- h-full + min-h-0 见 AppShell 的契约：main 不滚，高度由页面自己吃满 -->
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="missing > 0" intent="warning" icon="alert-triangle">
        还有 {{ missing }} 条流水线没取回来，搜索只筛得到已经列出的这
        {{ list.items.value.length }} 条。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="visible"
        :loading="list.loading.value"
        :error="list.error.value"
        :empty="emptyState"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            type="search"
            size="sm"
            placeholder="按名称或编码搜索"
          />
        </template>
        <template #cell-name="{ row }">
          <RouterLink
            class="dt-ml-list__link"
            :to="`/modeling/pipelines/${row.id}`"
          >
            {{ row.name }}
          </RouterLink>
        </template>
        <template #cell-code="{ row }">
          <DtTag intent="neutral" size="sm" mono>{{ row.code }}</DtTag>
        </template>
        <template #cell-node_count="{ row }">{{ row.node_count }}</template>
        <template #cell-sources="{ row }">
          <span v-if="row.source_table_codes.length === 0">—</span>
          <span v-else class="dt-ml-list__sources">
            {{ row.source_table_codes.join('、') }}
          </span>
        </template>
        <template #cell-updated_at="{ row }">
          {{ formatDateTime(row.updated_at) }}
        </template>
        <template #cell-actions="{ row }">
          <div class="dt-ml-list__actions">
            <RouterLink
              class="dt-ml-list__icon"
              :to="`/modeling/pipelines/${row.id}`"
              title="打开画布"
            >
              <DtIcon name="workflow" :size="16" />
            </RouterLink>
            <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
              <DtButton
                variant="ghost"
                size="xs"
                icon="pencil"
                title="改名"
                @click="ops.openEdit(row)"
              />
              <DtButton
                variant="ghost"
                size="xs"
                icon="trash"
                title="删除"
                @click="void ops.remove(row)"
              />
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <PipelineFormDialog
      :draft="ops.draft.value"
      :is-saving="ops.isSaving.value"
      @submit="(draft) => void ops.save(draft)"
      @close="ops.close"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.dt-ml-list {
  &__link {
    color: var(--accent-primary);
  }

  &__sources {
    display: block;
    overflow: hidden;
    color: var(--text-secondary);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__actions {
    display: flex;
    gap: 0.25rem;
    justify-content: flex-end;
  }

  &__icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-secondary);
  }
}
</style>
