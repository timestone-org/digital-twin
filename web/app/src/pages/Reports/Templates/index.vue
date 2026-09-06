<script setup lang="ts">
/** @fileoverview 报告模板列表与创建入口。 */
import { onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  DtButton,
  DtDataView,
  DtInput,
  DtModal,
  DtNotice,
  useToast,
  useConfirm,
} from '@dt/ui'
import type { DtDataColumn, ReportTemplateSummary } from '@dt/contracts'
import * as api from '@/api/reports'
import PermGuard from '@/components/PermGuard.vue'
import { AppShell } from '@/components/layout'
import { useAsyncList, describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'
import { blankReport } from '../scripts/reportDocument'

import ImportDialog from './components/ImportDialog.vue'

const columns: readonly DtDataColumn[] = [
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
        <DtButton variant="ghost"> 生成记录 </DtButton>
      </RouterLink>
      <RouterLink to="/reports/schedules">
        <DtButton variant="ghost"> 定时规则 </DtButton>
      </RouterLink>
      <PermGuard :codes="['report:manage']">
        <DtButton variant="ghost" @click="isImportOpen = true">
          导入 Word
        </DtButton>
        <DtButton @click="isOpen = true"> 新建模板 </DtButton>
      </PermGuard>
    </template>
    <div class="flex h-full min-h-0 flex-col">
      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="columns"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        @update:page="list.goToPage"
        @retry="list.reload"
      >
        <template #cell-name="{ row }">
          <RouterLink :to="`/reports/templates/${row.id}`">{{
            row.name
          }}</RouterLink>
        </template>
        <template #cell-code="{ row }">
          {{ row.code }}
        </template>
        <template #cell-granularity="{ row }">
          {{ row.granularity }}
        </template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="['report:manage']">
            <DtButton size="sm" variant="ghost" @click="remove(row.id)">
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
        <DtInput v-model="name" label="报告名称" />
        <DtInput
          v-model="code"
          label="模板编码"
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
          @click="create"
        >
          创建并编辑
        </DtButton>
      </template>
    </DtModal>
  </AppShell>
</template>
