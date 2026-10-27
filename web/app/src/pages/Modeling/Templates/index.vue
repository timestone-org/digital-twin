<script setup lang="ts">
/** @fileoverview 已发布模板库，按固定版本快速建模。 */
import type { DtDataColumn, ModelingTemplate } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtInput,
  DtTag,
  useConfirm,
  useToast,
} from '@dt/ui'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import * as api from '@/api/modelingTemplates'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'
import ModelingNav from '../components/ModelingNav.vue'
import CreateModelDialog from './components/CreateModelDialog.vue'

const columns: readonly DtDataColumn[] = [
  { key: 'name', label: '模板名称', card: 'title' },
  { key: 'description', label: '用途', card: 'meta' },
  { key: 'version', label: '版本', width: '6rem' },
  { key: 'node_count', label: '算子数', width: '6rem' },
  { key: 'is_enabled', label: '状态', width: '6rem' },
  { key: 'created_at', label: '发布时间', width: '12rem' },
  { key: 'actions', label: '操作', width: '15rem', card: 'actions' },
]
const keyword = ref('')
const appliedKeyword = ref('')
const selected = ref<ModelingTemplate | null>(null)
const list = useAsyncList((query, signal) =>
  api.listTemplates({ ...query, q: appliedKeyword.value }, signal),
)
const view = useViewMode('modeling-template-library', 'card')
const toast = useToast()
const confirm = useConfirm()
const busyId = ref('')
async function toggle(row: ModelingTemplate): Promise<void> {
  if (busyId.value) return
  if (
    row.is_enabled &&
    !(await confirm.ask({
      title: '停用此模板版本？',
      message: '停用后不能用它创建新模型，已有模型和部署继续可用。',
      danger: true,
      confirmText: '停用模板',
    }))
  )
    return
  busyId.value = row.id
  try {
    await api.setTemplateEnabled(row.id, !row.is_enabled)
    await list.reload()
    toast.success('模板状态已更新')
  } catch (caught) {
    toast.error(describeError(caught))
  } finally {
    busyId.value = ''
  }
}
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: appliedKeyword.value !== '',
    subject: '模板',
    keyword: appliedKeyword.value,
    blank: {
      title: '还没有已发布模板',
      hint: '在建模工作台中打开流水线，保存后发布为模板，即可供第三方重复使用。',
    },
  }),
)
async function search(): Promise<void> {
  appliedKeyword.value = keyword.value.trim()
  await list.reloadFromFirstPage()
}
onMounted(() => void list.reload())
</script>

<template>
  <AppShell
    title="已发布模板"
    subtitle="供第三方快捷创建模型使用；设计和日常运行请前往建模工作台"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <ModelingNav />

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="columns"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="emptyState"
        :layout="{ cardColumns: 3, cardMinWidth: '22rem', minWidth: '65rem' }"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
        @retry="void list.reload()"
      >
        <template #toolbar>
          <form class="flex gap-2" @submit.prevent="void search()">
            <DtInput
              v-model="keyword"
              label="搜索模板"
              type="search"
              size="sm"
              placeholder="按名称或编码搜索"
            />

            <DtButton type="submit" size="sm" variant="ghost"> 搜索 </DtButton>
          </form>
        </template>

        <template #cell-name="{ row }">{{ row.name }}</template>
        <template #cell-description="{ row }">{{
          row.description || '—'
        }}</template>
        <template #cell-node_count="{ row }">{{ row.node_count }}</template>
        <template #cell-version="{ row }"> v{{ row.version }} </template>

        <template #cell-is_enabled="{ row }">
          <DtTag :intent="row.is_enabled ? 'success' : 'neutral'">
            {{ row.is_enabled ? '可使用' : '已停用' }}
          </DtTag>
        </template>

        <template #cell-created_at="{ row }">
          {{ formatDateTime(row.created_at) }}
        </template>

        <template #cell-actions="{ row }">
          <PermGuard :codes="[PERMISSION_CODES.modelingRun]">
            <DtButton
              size="sm"
              :disabled="!row.is_enabled"
              @click="selected = row"
            >
              创建模型
            </DtButton>
          </PermGuard>

          <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
            <RouterLink :to="`/modeling/pipelines/${row.pipeline_id}`">
              <DtButton size="sm" variant="ghost"> 设计 </DtButton>
            </RouterLink>

            <DtButton
              size="sm"
              variant="ghost"
              :disabled="busyId !== ''"
              @click="void toggle(row)"
            >
              {{ row.is_enabled ? '停用' : '启用' }}
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
    </div>

    <CreateModelDialog :template="selected" @close="selected = null" />
  </AppShell>
</template>
