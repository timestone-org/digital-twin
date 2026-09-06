<script setup lang="ts">
/** @fileoverview 报告模板列表与创建入口。 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  DtButton,
  DtDataView,
  DtInput,
  DtModal,
  DtNotice,
  DtTag,
  useToast,
  useConfirm,
} from '@dt/ui'
import type { DtDataColumn, ReportTemplateSummary } from '@dt/contracts'
import * as api from '@/api/reports'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList, describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { listEmptyState } from '@/utils/listEmpty'
import { blankReport, GRANULARITIES } from '../scripts/reportDocument'

import ImportDialog from './components/ImportDialog.vue'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '报告名称', card: 'title' },
  { key: 'code', label: '编码' },
  { key: 'granularity', label: '周期' },
  { key: 'actions', label: '操作', card: 'actions' },
]
const list = useAsyncList<ReportTemplateSummary>((query) =>
  api.listReports(query.page),
)
const view = useViewMode('report-templates')
const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const isOpen = ref(false)
const isImportOpen = ref(false)
const name = ref('')
const code = ref('')
const error = ref('')
const isSaving = ref(false)
const keyword = ref('')
const visibleReports = computed(() => {
  const query = keyword.value.trim().toLocaleLowerCase()
  if (!query) return list.items.value
  return list.items.value.filter(
    (report) =>
      report.name.toLocaleLowerCase().includes(query) ||
      report.code.toLocaleLowerCase().includes(query),
  )
})
const emptyState = computed(() =>
  listEmptyState({
    isFiltered: keyword.value.trim() !== '',
    subject: '报告模板',
    keyword: keyword.value,
    blank: {
      title: '还没有报告模板',
      hint: '新建模板后即可编辑正文并按报告期生成 Word。',
    },
  }),
)
onMounted(() => void list.reload())
async function create(): Promise<void> {
  isSaving.value = true
  error.value = ''
  try {
    const created = await api.createReport({
      ...blankReport(name.value),
      code: code.value,
    })
    isOpen.value = false
    await router.push(`/reports/templates/${created.id}`)
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    isSaving.value = false
  }
}
async function remove(id: string): Promise<void> {
  if (
    !(await confirm.ask({
      title: '删除报告模板',
      message: '删除后正文与指标配置无法恢复。已有生成历史的模板不能删除。',
      danger: true,
    }))
  )
    return
  try {
    await api.deleteReport(id)
    await list.reload()
  } catch (caught) {
    toast.error(describeError(caught))
  }
}
</script>
<template>
  <AppShell title="自动报告" subtitle="模板与报告期生成 Word 文档">
    <template #actions>
      <RouterLink to="/reports/renders">
        <DtButton variant="ghost" size="sm" icon="activity">生成记录</DtButton>
      </RouterLink>
      <RouterLink to="/reports/schedules">
        <DtButton variant="ghost" size="sm" icon="calendar">定时规则</DtButton>
      </RouterLink>
      <PermGuard :codes="['report:manage']">
        <DtButton
          variant="ghost"
          size="sm"
          icon="upload"
          @click="isImportOpen = true"
        >
          导入 Word
        </DtButton>
        <DtButton size="sm" icon="plus" @click="isOpen = true"
          >新建模板</DtButton
        >
      </PermGuard>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="visibleReports"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="emptyState"
        @update:page="list.goToPage"
        @retry="list.reload"
      >
        <template #toolbar>
          <DtInput
            v-model="keyword"
            class="w-64"
            size="sm"
            type="search"
            aria-label="搜索报告模板"
            placeholder="搜索名称或编码"
          />
        </template>
        <template #cell-name="{ row }">
          <RouterLink :to="`/reports/templates/${row.id}`">{{
            row.name
          }}</RouterLink>
        </template>
        <template #cell-code="{ row }">
          {{ row.code }}
        </template>
        <template #cell-granularity="{ row }">
          <DtTag intent="info">{{
            GRANULARITIES.find((item) => item.value === row.granularity)?.label
          }}</DtTag>
        </template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="['report:manage']">
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              icon="trash"
              @click="remove(row.id)"
            >
              删除
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
    </div>
    <ImportDialog
      v-model="isImportOpen"
      @created="router.push(`/reports/templates/${$event.id}`)"
    />
    <DtModal v-model="isOpen" title="新建报告模板">
      <div class="flex flex-col gap-3">
        <DtInput v-model="name" label="报告名称" size="sm" />
        <DtInput
          v-model="code"
          label="模板编码"
          size="sm"
          hint="字母开头，使用英文字母、数字、下划线"
        />
        <DtNotice v-if="error" intent="danger">
          {{ error }}
        </DtNotice>
      </div>
      <template #footer>
        <DtButton
          :loading="isSaving"
          :disabled="!name || !code"
          size="sm"
          icon="plus"
          @click="create"
        >
          创建并编辑
        </DtButton>
      </template>
    </DtModal>
  </AppShell>
</template>
