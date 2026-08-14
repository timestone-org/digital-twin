<script setup lang="ts">
/**
 * @fileoverview 大屏列表：新建 / 改名 / 删除 / 进编辑器。
 * ⚠ 大屏挂在项目下，新建必须先选项目：`project_id` 是必填的，
 * 没项目时给一条明确的提示，而不是让创建按钮点下去收一个 422。
 */
import type { DtDataColumn, DtSelectOption } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtDataView,
  DtIcon,
  DtInput,
  DtNotice,
  DtSelect,
  useConfirm,
  useToast,
} from '@dt/ui'
import { computed, onMounted, ref } from 'vue'

import * as dashboards from '@/api/dashboard'
import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { describeError, useAsyncList } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import DashboardFormDialog from './components/DashboardFormDialog.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '名称', card: 'title' },
  { key: 'size', label: '设计尺寸', width: '10rem', card: 'meta' },
  { key: 'nodes', label: '节点数', width: '6rem', card: 'meta' },
  { key: 'version', label: '版本', width: '6rem' },
  { key: 'actions', label: '操作', align: 'right', width: '14rem', card: 'actions' },
]

const toast = useToast()
const confirm = useConfirm()

const keyword = ref('')
const projectId = ref('')
const projects = ref<ProjectSummary[]>([])
const projectError = ref<string | null>(null)
const view = useViewMode('dashboards')
const formOpen = ref(false)
const editing = ref<DashboardSummary | null>(null)

const list = useAsyncList<DashboardSummary>((query) =>
  dashboards.listDashboards({
    projectId: projectId.value === '' ? undefined : projectId.value,
    q: keyword.value === '' ? undefined : keyword.value,
    ...query,
  }),
)

const projectOptions = computed<DtSelectOption[]>(() => [
  { value: '', label: '全部项目' },
  ...projects.value.map((item) => ({ value: item.id, label: item.name })),
])

const canCreate = computed(() => projects.value.length > 0)

async function loadProjects(): Promise<void> {
  try {
    const page = await dashboards.listProjects({ page: 1, size: 100 })
    projects.value = page.items
    projectError.value = null
  } catch (caught) {
    projectError.value = describeError(caught)
  }
}

function openCreate(): void {
  editing.value = null
  formOpen.value = true
}

function openRename(dashboard: DashboardSummary): void {
  editing.value = dashboard
  formOpen.value = true
}

/** 新建落在当前筛选的项目上；没筛就落在第一个项目上。 */
function targetProjectId(): string | null {
  if (projectId.value !== '') return projectId.value
  return projects.value[0]?.id ?? null
}

async function create(input: {
  name: string
  designWidth: number
  designHeight: number
}): Promise<void> {
  const target = targetProjectId()
  if (target === null) return
  try {
    await dashboards.createDashboard({ ...input, projectId: target })
    formOpen.value = false
    toast.success('大屏已创建')
    await list.reloadFromFirstPage()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function rename(input: { name: string }): Promise<void> {
  const target = editing.value
  if (target === null) return
  try {
    await dashboards.updateDashboard(target.id, { name: input.name })
    formOpen.value = false
    toast.success('大屏已重命名')
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

async function remove(dashboard: DashboardSummary): Promise<void> {
  const ok = await confirm.ask({
    title: '删除大屏',
    message:
      `删除「${dashboard.name}」会一并删掉它的 ${dashboard.nodeCount} 个节点` +
      '与全部绑定，且此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await dashboards.deleteDashboard(dashboard.id)
    toast.success('大屏已删除')
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}

onMounted(() => {
  void loadProjects()
  void list.reload()
})
</script>

<template>
  <AppShell title="大屏" subtitle="组态大屏与实时看板">
    <template #actions>
      <PermGuard :codes="[PERMISSION_CODES.dashboardEdit]">
        <DtButton
          size="sm"
          icon="plus"
          :disabled="!canCreate"
          @click="openCreate"
        >
          新建大屏
        </DtButton>
      </PermGuard>
    </template>

    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="projectError" intent="danger" icon="alert-triangle">
        项目列表没取到：{{ projectError }}
      </DtNotice>
      <DtNotice
        v-else-if="!canCreate"
        intent="warning"
        icon="alert-triangle"
      >
        还没有任何项目，大屏必须挂在项目下——先建一个项目再回来。
      </DtNotice>

      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :layout="{ minWidth: '52rem', cardColumns: 3, cardMinWidth: '20rem' }"
        @update:page="list.goToPage"
        @update:size="list.setSize"
        @retry="list.reload()"
      >
        <template #toolbar>
          <DtSelect
            v-model="projectId"
            class="w-48"
            :options="projectOptions"
            size="sm"
            aria-label="项目"
            @update:model-value="list.reloadFromFirstPage()"
          />
          <DtInput
            v-model="keyword"
            class="w-64"
            size="sm"
            placeholder="搜索大屏名称"
            @enter="list.reloadFromFirstPage()"
          >
            <template #leading><DtIcon name="search" :size="14" /></template>
          </DtInput>
          <DtButton
            variant="outline"
            size="sm"
            @click="list.reloadFromFirstPage()"
          >
            查询
          </DtButton>
        </template>

        <template #summary>共 {{ list.total.value }} 张大屏</template>

        <template #cell-name="{ row }">
          <RouterLink
            class="font-medium text-accent-on-surface"
            :to="`/dashboards/${row.id}/edit`"
          >
            {{ row.name }}
          </RouterLink>
          <p v-if="row.description" class="m-0 mt-1 text-2xs text-text-disabled">
            {{ row.description }}
          </p>
        </template>

        <template #cell-size="{ row }">
          <span class="font-mono text-xs">
            {{ row.designWidth }} × {{ row.designHeight }}
          </span>
        </template>

        <template #cell-nodes="{ row }">
          <span class="font-mono">{{ row.nodeCount }}</span>
        </template>

        <template #cell-version="{ row }">
          <span class="font-mono text-xs">v{{ row.rowVersion }}</span>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex items-center justify-end gap-1">
            <RouterLink :to="`/dashboards/${row.id}/edit`">
              <DtButton size="sm" variant="ghost">编辑</DtButton>
            </RouterLink>
            <PermGuard :codes="[PERMISSION_CODES.dashboardEdit]">
              <DtButton size="sm" variant="ghost" @click="openRename(row)">
                重命名
              </DtButton>
              <DtButton
                size="sm"
                variant="ghost"
                intent="danger"
                @click="remove(row)"
              >
                删除
              </DtButton>
            </PermGuard>
          </div>
        </template>
      </DtDataView>
    </div>

    <DashboardFormDialog
      v-model="formOpen"
      :dashboard="editing"
      @create="create"
      @rename="rename"
    />
  </AppShell>
</template>
