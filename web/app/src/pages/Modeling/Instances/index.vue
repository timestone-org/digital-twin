<script setup lang="ts">
/** @fileoverview 从模板创建的独立模型与最近训练状态。 */
import type { DtDataColumn } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtDataView, DtInput, DtTag } from '@dt/ui'
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { listInstances } from '@/api/modelingTemplates'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { formatDateTime } from '@/utils/datetime'
import { listEmptyState } from '@/utils/listEmpty'
import ModelingNav from '../components/ModelingNav.vue'
import { runLabel } from '../scripts/instancePresentation'

const columns: readonly DtDataColumn[] = [
  { key: 'name', label: '模型名称', card: 'title' },
  { key: 'code', label: '编码', card: 'meta' },
  { key: 'template_name', label: '来源工作流' },
  { key: 'revision', label: '配置版本', width: '7rem' },
  { key: 'status', label: '最近训练', width: '8rem' },
  { key: 'updated_at', label: '最近配置', width: '12rem' },
  { key: 'actions', label: '操作', width: '8rem', card: 'actions' },
]
const keyword = ref('')
const appliedKeyword = ref('')
const list = useAsyncList((query, signal) =>
  listInstances({ ...query, q: appliedKeyword.value }, signal),
)
const view = useViewMode('modeling-instances')
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: appliedKeyword.value !== '',
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
        :layout="{ minWidth: '60rem', cardColumns: 3, cardMinWidth: '22rem' }"
        @update:page="void list.goToPage($event)"
        @update:size="void list.setSize($event)"
        @retry="void list.reload()"
      >
        <template #toolbar>
          <form class="flex gap-2" @submit.prevent="void search()">
            <DtInput
              v-model="keyword"
              label="搜索模型"
              type="search"
              size="sm"
              placeholder="按名称或编码搜索"
            />

            <DtButton type="submit" size="sm" variant="ghost"> 搜索 </DtButton>
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
