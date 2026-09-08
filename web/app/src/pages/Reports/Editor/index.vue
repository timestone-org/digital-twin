<script setup lang="ts">
/** @fileoverview 报告模板的正文、指标和试算工作面。 */
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'
import {
  useRoute,
  useRouter,
  onBeforeRouteLeave,
  onBeforeRouteUpdate,
} from 'vue-router'
import { DtButton, DtInput, DtNotice, useToast, useConfirm } from '@dt/ui'
import type {
  ReportBody,
  ReportDocument,
  ReportPreview,
  ReportTemplate,
} from '@dt/contracts'
import * as api from '@/api/reports'
import AiDock from '@/components/ai/AiDock.vue'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useAuthStore } from '@/stores/auth'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { useAiPanel } from '@/composables/useAiPanel'
import { describeError } from '@/composables/useAsyncList'
import { nowStamp } from '@/utils/datetime'
import MetricPanel from './components/MetricPanel.vue'
import NodeDialog from './components/NodeDialog.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import PageDialog from './components/PageDialog.vue'
import TemplateSettingsCard from './components/TemplateSettingsCard.vue'
import { createReportSurface } from './scripts/aiSurface'
import { currentReportPeriod } from '../scripts/reportPeriod'
import {
  blankReport,
  reportDraft,
  reportUpdate,
} from '../scripts/reportDocument'

const ReportEditor = defineAsyncComponent(() =>
  import('./components/ReportEditor.vue').then((module) => module.default),
)
const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const toast = useToast()
const template = ref<ReportTemplate | null>(null)
const draft = ref<ReportBody>(blankReport())
const period = ref('')
const isPageOpen = ref(false)
const preview = ref<ReportPreview | null>(null)
const error = ref('')
const isBusy = ref(false)
const isNodeOpen = ref(false)
const editor = ref<{ insert: (node: ReportDocument) => boolean } | null>(null)
const raced = useRacedFetch()
const periods = useRacedFetch()
const trials = useRacedFetch()
const saves = useRacedFetch()
const confirm = useConfirm()
const savedSnapshot = ref('')
const periodTimezone = ref<string | null>(null)
const periodWarning = ref('')
const canDefaultPeriod = ref(true)
const LOADING_MESSAGE = '正在加载报告模板…'
const isDirty = computed(
  () =>
    template.value !== null &&
    JSON.stringify(draft.value) !== savedSnapshot.value,
)
useUnsavedGuard(() => isDirty.value)
onBeforeRouteLeave(confirmLeave)
onBeforeRouteUpdate(confirmLeave)
const canEdit = computed(() => auth.can(['report:manage']))
const id = computed(() => String(route.params['templateId'] ?? ''))
const ai = useAiPanel({
  surface: () =>
    createReportSurface({
      templateId: () => id.value,
      draft: () => draft.value,
      setDraft: (value) => {
        draft.value = value
      },
      canEdit: () => canEdit.value,
      insert: insertForAssistant,
      validate: api.validateReport,
      preview: previewForAssistant,
      showPreview: (value) => {
        preview.value = value
      },
    }),
  refId: () => id.value || null,
})
watch(id, load, { immediate: true })
function load(): void {
  saves.cancel()
  trials.cancel()
  periods.cancel()
  template.value = null
  preview.value = null
  period.value = ''
  periodTimezone.value = null
  periodWarning.value = ''
  canDefaultPeriod.value = true
  error.value = ''
  isBusy.value = false
  void raced.run((signal) => api.getReport(id.value, signal), {
    ok: (value) => {
      template.value = value
      draft.value = reportDraft(value)
      savedSnapshot.value = JSON.stringify(draft.value)
      loadCurrentPeriod()
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => undefined,
  })
}
function loadCurrentPeriod(): void {
  void periods.run((signal) => api.reportRuntime(signal), {
    ok: (runtime) => {
      periodTimezone.value = runtime.timezone
      if (canDefaultPeriod.value) {
        period.value = currentReportPeriod(
          draft.value.granularity ?? 'month',
          runtime.timezone,
          nowStamp(),
        )
        canDefaultPeriod.value = false
      }
    },
    fail: () => {
      periodTimezone.value = null
      periodWarning.value = '未能读取业务时区，请手动填写报告期'
    },
    settled: () => undefined,
  })
}
function changeGranularity(value: ReportTemplate['granularity']): void {
  draft.value.granularity = value
  const timezone = periodTimezone.value
  canDefaultPeriod.value = timezone === null
  period.value = timezone
    ? currentReportPeriod(value, timezone, nowStamp())
    : ''
}
function changePeriod(value: string): void {
  canDefaultPeriod.value = false
  period.value = value
}
async function confirmLeave(): Promise<boolean> {
  if (!isDirty.value) return true
  return await confirm.ask({
    title: '尚有未保存的报告修改',
    message: '离开后将丢失本次正文与指标修改。是否离开？',
    danger: true,
  })
}
onBeforeUnmount(() => {
  raced.cancel()
  periods.cancel()
  trials.cancel()
  saves.cancel()
})
async function save(): Promise<boolean> {
  if (!template.value) return false
  isBusy.value = true
  let isSaved = false
  const payload = reportUpdate(draft.value, template.value.row_version)
  const snapshot = JSON.stringify(draft.value)
  await saves.run(() => api.saveReport(id.value, payload), {
    ok: (value) => {
      template.value = value
      savedSnapshot.value = snapshot
      isSaved = true
      toast.success('模板已保存')
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      isBusy.value = false
    },
  })
  return isSaved
}
async function trial(): Promise<void> {
  if (!template.value) return
  isBusy.value = true
  await trials.run(
    (signal) => api.previewReport(id.value, period.value, draft.value, signal),
    {
      ok: (value) => {
        preview.value = value
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        isBusy.value = false
      },
    },
  )
}
async function generate(): Promise<void> {
  if (!template.value) return
  isBusy.value = true
  try {
    await api.generateReport(id.value, period.value)
    await router.push('/reports/renders')
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    isBusy.value = false
  }
}
function insert(node: ReportDocument): void {
  editor.value?.insert(node)
}
function insertForAssistant(node: ReportDocument): void {
  if (editor.value === null) throw new Error('报告编辑器尚未就绪')
  if (!editor.value.insert(node)) throw new Error('正文插入失败，请稍后再试')
}
async function previewForAssistant(
  nextPeriod: string,
  body: ReportBody,
): Promise<ReportPreview> {
  const result = await api.previewReport(id.value, nextPeriod, body)
  canDefaultPeriod.value = false
  period.value = nextPeriod
  return result
}
</script>
<template>
  <AppShell
    title="编辑报告"
    back-to="/reports"
    subtitle="编辑后保存，再按报告期生成"
  >
    <template #actions>
      <DtInput
        :model-value="period"
        class="w-36"
        size="sm"
        aria-label="报告期"
        placeholder="按模板周期填写"
        @update:model-value="changePeriod"
      />
      <PermGuard :codes="['report:manage']">
        <DtButton
          :loading="isBusy"
          :disabled="!template"
          variant="ghost"
          size="sm"
          icon="activity"
          @click="trial"
        >
          试算
        </DtButton>
        <DtButton
          :loading="isBusy"
          :disabled="!template"
          size="sm"
          icon="save"
          @click="save"
        >
          保存模板
        </DtButton>
      </PermGuard>
      <PermGuard :codes="['report:render']">
        <DtButton
          :loading="isBusy"
          :disabled="!template"
          size="sm"
          icon="play"
          @click="generate"
        >
          生成已保存模板
        </DtButton>
      </PermGuard>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-4">
      <DtNotice v-if="!template && !error" intent="info">
        {{ LOADING_MESSAGE }}
      </DtNotice>
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
      <DtNotice v-if="periodWarning" intent="warning">
        {{ periodWarning }}
      </DtNotice>
      <div
        v-if="template"
        class="grid min-h-0 flex-1 grid-rows-[minmax(38rem,1fr)_auto] gap-4 overflow-y-auto xl:grid-cols-[minmax(0,1fr)_21rem] xl:grid-rows-1 xl:overflow-hidden"
      >
        <ReportEditor
          ref="editor"
          :model-value="draft.doc_json ?? { type: 'doc' }"
          :page="draft.page_json ?? {}"
          :title="draft.name"
          :disabled="!canEdit || isBusy"
          :save-document="save"
          @update:model-value="draft.doc_json = $event"
          @update:page="draft.page_json = $event"
        />
        <aside class="flex min-h-0 flex-col gap-4 overflow-auto pr-1">
          <TemplateSettingsCard
            :name="draft.name"
            :granularity="draft.granularity ?? 'month'"
            :enabled="draft.is_enabled ?? true"
            :disabled="!canEdit || isBusy"
            :can-edit="canEdit"
            @update:name="draft.name = $event"
            @update:granularity="changeGranularity"
            @update:enabled="draft.is_enabled = $event"
            @open-page="isPageOpen = true"
          />
          <MetricPanel
            :model-value="draft.metrics ?? []"
            :disabled="!canEdit || isBusy"
            @update:model-value="draft.metrics = $event"
            @insert="
              insert({
                type: 'metricRef',
                attrs: { expr: $event, precision: 2 },
              })
            "
          />
          <DtButton
            v-if="canEdit"
            size="sm"
            icon="plus"
            @click="isNodeOpen = true"
          >
            插入数据内容
          </DtButton>
          <PreviewPanel v-if="preview" :preview="preview" />
        </aside>
      </div>
      <PageDialog
        v-model="isPageOpen"
        :page="draft.page_json ?? {}"
        @save="draft.page_json = $event"
      />
      <NodeDialog
        v-model="isNodeOpen"
        :metrics="draft.metrics ?? []"
        @insert="insert"
      />
      <AiDock
        v-if="template"
        :ai="ai"
        surface-label="报告模板编辑器"
        hint="助手只修改未保存草稿；请审阅、校验后再手动保存。"
        :starters="[
          '帮我根据现有台账设计这份月报的指标和正文',
          '检查当前模板结构并试算本期数据',
          '把页面设置成适合正式汇报的版式',
        ]"
      />
    </div>
  </AppShell>
</template>
