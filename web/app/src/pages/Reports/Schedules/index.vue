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
import EditScheduleDialog from './components/EditScheduleDialog.vue'
import {
  emptyScheduleErrors,
  validateScheduleFields,
} from './scripts/scheduleForm'

const COLUMNS: readonly DtDataColumn[] = [
  { key: 'name', label: '规则名称', card: 'title' },
  { key: 'granularity', label: '周期' },
  { key: 'delay', label: '期末延迟' },
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
const isCreating = ref(false)
const createError = ref('')
const fieldErrors = ref(emptyScheduleErrors())
const editing = ref<ReportSchedule | null>(null)
const isEditOpen = ref(false)
const name = ref('')
const templateId = ref('')
const delay = ref('24')
const templates = ref<ReportTemplateSummary[]>([])
const error = ref('')
const busyIds = ref<string[]>([])
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
  if (isCreating.value || !template) return
  const checked = validateScheduleFields(name.value, delay.value)
  fieldErrors.value = checked.errors
  createError.value = ''
  if (!checked.fields) return
  isCreating.value = true
  try {
    await api.createReportSchedule({
      template_id: template.id,
      ...checked.fields,
      granularity: template.granularity,
      is_enabled: true,
    })
    isOpen.value = false
    await list.reload()
  } catch (caught) {
    createError.value = describeError(caught)
  } finally {
    isCreating.value = false
  }
}
function openCreate(): void {
  createError.value = ''
  fieldErrors.value = emptyScheduleErrors()
  isOpen.value = true
}
function openEdit(row: ReportSchedule): void {
  if (busyIds.value.includes(row.id)) return
  editing.value = row
  isEditOpen.value = true
}
function beginAction(id: string): boolean {
  if (busyIds.value.includes(id)) return false
  busyIds.value = [...busyIds.value, id]
  error.value = ''
  return true
}
function finishAction(id: string): void {
  busyIds.value = busyIds.value.filter((busyId) => busyId !== id)
}
async function toggle(row: ReportSchedule): Promise<void> {
  if (!beginAction(row.id)) return
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
  } finally {
    finishAction(row.id)
  }
}
async function remove(id: string): Promise<void> {
  if (!beginAction(id)) return
  try {
    if (
      !(await confirm.ask({
        title: '删除定时规则',
        message: '删除后规则无法恢复。已有生成历史的规则请停用。',
        danger: true,
      }))
    )
      return
    await api.deleteReportSchedule(id)
    await list.reload()
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    finishAction(id)
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
      <DtButton
        variant="ghost"
        size="sm"
        icon="refresh-cw"
        @click="list.reload"
      >
        刷新
      </DtButton>
      <PermGuard :codes="['report:schedule']">
        <DtButton
          size="sm"
          icon="plus"
          :disabled="isCreating"
          @click="openCreate"
        >
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
        <template #cell-delay="{ row }">{{ row.delay_hours }} 小时</template>
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
              icon="pencil"
              :disabled="busyIds.includes(row.id)"
              @click="openEdit(row)"
            >
              编辑
            </DtButton>
            <DtButton
              size="sm"
              variant="ghost"
              :icon="row.is_enabled ? 'toggle-left' : 'toggle-right'"
              :disabled="busyIds.includes(row.id)"
              @click="toggle(row)"
            >
              {{ row.is_enabled ? '停用' : '启用' }}
            </DtButton>
            <DtButton
              size="sm"
              variant="ghost"
              intent="danger"
              icon="trash"
              :disabled="busyIds.includes(row.id)"
              @click="remove(row.id)"
            >
              删除
            </DtButton>
          </PermGuard>
        </template>
      </DtDataView>
    </div>
    <DtModal
      :model-value="isOpen"
      title="新建定时规则"
      :close-on-backdrop="!isCreating"
      @update:model-value="!isCreating && (isOpen = $event)"
    >
      <div class="flex flex-col gap-3">
        <DtNotice v-if="createError" intent="danger">{{
          createError
        }}</DtNotice>
        <DtInput
          v-model="name"
          label="规则名称"
          size="sm"
          :disabled="isCreating"
          :error="fieldErrors.name"
        />
        <DtSelect
          v-model="templateId"
          :options="options"
          label="报告模板"
          size="sm"
          :disabled="isCreating"
        />
        <DtInput
          v-model="delay"
          label="期末延迟小时数"
          size="sm"
          hint="0～720 的整数；24 表示报告期结束后等待一天"
          :disabled="isCreating"
          :error="fieldErrors.delayHours"
          inputmode="numeric"
        />
      </div>
      <template #footer>
        <DtButton
          :disabled="!name || !templateId"
          :loading="isCreating"
          size="sm"
          icon="plus"
          @click="create"
        >
          创建规则
        </DtButton>
      </template>
    </DtModal>
    <EditScheduleDialog
      v-model="isEditOpen"
      :record="editing"
      :templates="templates"
      @saved="list.reload"
    />
  </AppShell>
</template>
