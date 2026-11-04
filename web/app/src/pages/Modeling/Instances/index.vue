<script setup lang="ts">
/** @fileoverview 从模板创建的独立模型与最近训练状态。 */
import type { DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtInput, DtSelect, DtTag } from '@dt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { listInstances } from '@/api/modelingTemplates'
import type { InstanceArchiveFilter } from '@/api/modelingTemplates'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'
import { runLabel } from '../scripts/instancePresentation'
import { taskLabel } from '../scripts/taskPresentation'
import ModelingBatchBar from '../components/ModelingBatchBar.vue'
import { useInstanceBatch } from './scripts/useInstanceBatch'
import { reloadModelingPage } from '../scripts/reloadModelingPage'

const columns: readonly DtDataColumn[] = [
  { key: 'name', label: '模型名称', card: 'title' },
  { key: 'code', label: '编码', card: 'meta' },
  { key: 'template_name', label: '来源工作流' },
  { key: 'task', label: '模型类型', width: '8rem' },
  { key: 'revision', label: '配置版本', width: '7rem' },
  { key: 'status', label: '最近训练', width: '8rem' },
  { key: 'archive', label: '归档状态', width: '8rem' },
  { key: 'updated_at', label: '最近配置', width: '12rem' },
  { key: 'actions', label: '操作', width: '8rem', card: 'actions' },
]
const keyword = ref('')
const appliedKeyword = ref('')
const archived = ref<InstanceArchiveFilter>('active')
const archiveOptions = [
  { value: 'active', label: '在用实例' },
  { value: 'archived', label: '已归档实例' },
  { value: 'all', label: '全部实例' },
]
const list = useAsyncList((query, signal) =>
  listInstances(
    {
      ...query,
      q: appliedKeyword.value,
      ...(archived.value === 'active' ? {} : { archived: archived.value }),
    },
    signal,
  ),
)
const operations = useInstanceBatch(
  () => list.items.value,
  () =>
    JSON.stringify([
      list.pager.value.page,
      list.pager.value.size,
      appliedKeyword.value,
      archived.value,
    ]),
  () => reloadModelingPage(list),
  () => list.loading.value || list.error.value !== null,
)
const batch = operations.batch
const view = useViewMode('modeling-instances')
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: appliedKeyword.value !== '' || archived.value !== 'active',
    subject: '模型',
    keyword: appliedKeyword.value,
    blank: {
      title: '创建第一个模型',
      hint: '选择模板 → 配置输入输出与参数 → 训练 → 发布版本并部署',
    },
  }),
)
async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}
function setArchiveFilter(value: string): void {
  if (value === 'active' || value === 'archived' || value === 'all')
    archived.value = value
}
watch(archived, () => void list.reloadFromFirstPage())
onMounted(() => void list.reload())
</script>

<template>
  <AppShell
    title="模型实例"
    subtitle="查看系统与第三方创建的模型，集中配置、训练、发布和部署"
  >
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
        <RouterLink to="/modeling/templates">
          <DtButton icon="plus"> 通过工作流创建模型 </DtButton>
        </RouterLink>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingBatchBar
        :selected-count="batch.selectedCount.value"
        :state="batch.state.value"
        @clear="batch.clear"
        @stop="batch.stop"
      >
        <template v-if="operations.allowed.value">
          <DtButton
            size="sm"
            :disabled="!batch.canRun.value"
            @click="void operations.train()"
          >
            批量提交训练
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            :disabled="!batch.canRun.value"
            @click="void operations.archive(true)"
          >
            批量归档实例
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            :disabled="!batch.canRun.value"
            @click="void operations.archive(false)"
          >
            批量恢复实例
          </DtButton>
        </template>
      </ModelingBatchBar>
      <p
        v-if="
          batch.state.value.label === '批量提交训练' &&
          batch.state.value.total > 0
        "
        class="m-0 text-caption text-text-secondary"
      >
        训练提交成功不代表训练完成，请查看训练记录。
      </p>
      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="columns"
        :rows="list.items.value"
        :selection="operations.selection.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="emptyState"
        :layout="{ minWidth: '68rem', cardColumns: 3, cardMinWidth: '22rem' }"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
        @update:selected-ids="batch.selectedIds.value = $event"
        @retry="void list.reload()"
      >
        <template #toolbar>
          <form
            class="flex flex-wrap items-end gap-2"
            @submit.prevent="void search()"
          >
            <DtInput
              v-model="keyword"
              label="搜索模型"
              type="search"
              size="sm"
              placeholder="按名称或编码搜索"
              :maxlength="128"
            />

            <DtButton type="submit" size="sm" variant="ghost"> 搜索 </DtButton>
            <DtSelect
              :model-value="archived"
              :options="archiveOptions"
              label="归档状态"
              size="sm"
              @update:model-value="setArchiveFilter"
            />
          </form>
        </template>

        <template #cell-name="{ row }">
          <RouterLink
            class="text-accent-primary"
            :to="`/modeling/instances/${row.id}`"
          >
            {{ row.name }}
          </RouterLink>
        </template>

        <template #cell-code="{ row }">{{ row.code }}</template>
        <template #cell-template_name="{ row }">
          {{ row.template_name }} · v{{ row.template_version }}
        </template>

        <template #cell-revision="{ row }"> r{{ row.revision }} </template>
        <template #cell-archive="{ row }">{{
          row.archived_at ? '已归档' : '在用'
        }}</template>
        <template #cell-task="{ row }">{{ taskLabel(row.task) }}</template>

        <template #cell-status="{ row }">
          <DtTag
            :intent="
              row.latest_run?.status === 'succeeded' ? 'success' : 'neutral'
            "
          >
            {{ runLabel(row.latest_run?.status) }}
          </DtTag>
        </template>

        <template #cell-updated_at="{ row }">
          {{ formatDateTime(row.updated_at) }}
        </template>

        <template #cell-actions="{ row }">
          <RouterLink :to="`/modeling/instances/${row.id}`">
            <DtButton variant="ghost" size="sm"> 打开模型 </DtButton>
          </RouterLink>
        </template>
      </DtDataView>
    </div>
  </AppShell>
</template>
