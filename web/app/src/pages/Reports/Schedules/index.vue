<script setup lang="ts">
/** @fileoverview 定时生成规则与真实运行开关。 */
import { computed, onMounted, ref } from 'vue'
import {
  DtButton,
  DtDataView,
  DtInput,
  DtModal,
  DtNotice,
  DtSelect,
  DtTag,
  useConfirm,
} from '@dt/ui'
import type {
  DtDataColumn,
  ReportSchedule,
  ReportTemplateSummary,
} from '@dt/contracts'
import * as api from '@/api/reports'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useAsyncList, describeError } from '@/composables/useAsyncList'
import { useViewMode } from '@/composables/useViewMode'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '规则名称', card: 'title' },
  { key: 'granularity', label: '周期' },
  { key: 'enabled', label: '状态' },
  { key: 'last', label: '已生成至' },
  { key: 'actions', label: '操作', card: 'actions' },
]
const list = useAsyncList<ReportSchedule>((query) =>
  api.listReportSchedules(query.page),
)
const view = useViewMode('report-schedules')
const runtime = ref<boolean | null>(null)
const isOpen = ref(false)
const name = ref('')
const templateId = ref('')
const delay = ref('24')
const templates = ref<ReportTemplateSummary[]>([])
const error = ref('')
const confirm = useConfirm()
const CREATE_LABEL = '新建规则'
const options = computed(() =>
  templates.value.map((row) => ({ value: row.id, label: row.name })),
)
onMounted(async () => {
  await list.reload()
  try {
    runtime.value = (await api.reportRuntime()).is_schedule_enabled
    templates.value = await api.listReportChoices()
  } catch (caught) {
    error.value = describeError(caught)
  }
})
async function create(): Promise<void> {
  const template = templates.value.find((row) => row.id === templateId.value)
  if (!template) return
  try {
    await api.createReportSchedule({
      template_id: template.id,
      name: name.value,
      granularity: template.granularity,
      delay_hours: Number(delay.value),
      is_enabled: true,
    })
    isOpen.value = false
    await list.reload()
  } catch (caught) {
    error.value = describeError(caught)
  }
}
async function toggle(row: ReportSchedule): Promise<void> {
  try {
    await api.saveReportSchedule(row.id, {
      name: row.name,
      granularity: row.granularity,
      delay_hours: row.delay_hours,
      is_enabled: !row.is_enabled,
      expected_version: row.row_version,
    })
    await list.reload()
  } catch (caught) {
    error.value = describeError(caught)
  }
}
async function remove(id: string): Promise<void> {
  if (
    !(await confirm.ask({
      title: '删除定时规则',
      message: '删除后规则无法恢复。已有生成历史的规则请停用。',
      danger: true,
    }))
  )
    return
  try {
    await api.deleteReportSchedule(id)
    await list.reload()
  } catch (caught) {
    error.value = describeError(caught)
  }
}
</script>
<template>
  <AppShell
    title="报告定时规则"
    back-to="/reports"
    subtitle="报告期结束后延迟生成，等待台账数据齐备"
  >
    <template #actions>
      <PermGuard :codes="['report:schedule']">
        <DtButton size="sm" icon="plus" @click="isOpen = true">
          {{ CREATE_LABEL }}
        </DtButton>
      </PermGuard>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="runtime === false" intent="warning">
        定时生成总开关已关闭。规则会保存，开启后才自动运行。
      </DtNotice>
      <DtNotice v-if="runtime === true" intent="info">
        定时生成已启用。
      </DtNotice>
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
      <DtDataView
        v-model:view="view"
        class="min-h-0 flex-1"
        :columns="COLUMNS"
        :rows="list.items.value"
        :loading="list.loading.value"
        :error="list.error.value"
        :pagination="list.pager.value"
        :empty="{
          title: '还没有定时规则',
          hint: '配置完成后，系统会在报告期结束并等待指定小时数后自动生成。',
        }"
        @update:page="list.goToPage"
        @retry="list.reload"
      >
        <template #cell-name="{ row }"> {{ row.name }} </template>
        <template #cell-granularity="{ row }">
          <DtTag intent="info">{{ row.granularity }}</DtTag>
        </template>
        <template #cell-enabled="{ row }">
          <DtTag :intent="row.is_enabled ? 'success' : 'neutral'">
            {{ row.is_enabled ? '已启用' : '已停用' }}
          </DtTag>
        </template>
        <template #cell-last="{ row }">{{
          row.last_run_period ?? '尚未生成'
        }}</template>
        <template #cell-actions="{ row }">
          <PermGuard :codes="['report:schedule']">
            <DtButton
              size="sm"
              variant="ghost"
              :icon="row.is_enabled ? 'toggle-left' : 'toggle-right'"
              @click="toggle(row)"
            >
              {{ row.is_enabled ? '停用' : '启用' }}
            </DtButton>
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
    <DtModal v-model="isOpen" title="新建定时规则">
      <div class="flex flex-col gap-3">
        <DtInput v-model="name" label="规则名称" size="sm" />
        <DtSelect
          v-model="templateId"
          :options="options"
          label="报告模板"
          size="sm"
        />
        <DtInput
          v-model="delay"
          label="期末延迟小时数"
          size="sm"
          hint="例如 24 表示月末结束后等待一天"
        />
      </div>
      <template #footer>
        <DtButton
          :disabled="!name || !templateId"
          size="sm"
          icon="plus"
          @click="create"
        >
          创建规则
        </DtButton>
      </template>
    </DtModal>
  </AppShell>
</template>
