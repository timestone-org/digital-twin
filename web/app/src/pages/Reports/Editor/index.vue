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
import {
  DtButton,
  DtInput,
  DtNotice,
  DtSelect,
  DtCheckbox,
  useToast,
  useConfirm,
} from '@dt/ui'
import type {
  ReportBody,
  ReportDocument,
  ReportPreview,
  ReportTemplate,
} from '@dt/contracts'
import * as api from '@/api/reports'
import { AppShell } from '@/components/layout'
import PermGuard from '@/components/PermGuard.vue'
import { useAuthStore } from '@/stores/auth'
import { useUnsavedGuard } from '@/composables/useUnsavedGuard'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import MetricPanel from './components/MetricPanel.vue'
import NodeDialog from './components/NodeDialog.vue'
import PreviewPanel from './components/PreviewPanel.vue'
import PageDialog from './components/PageDialog.vue'
import {
  blankReport,
  reportDraft,
  reportUpdate,
  GRANULARITIES,
} from '../scripts/reportDocument'

const ReportEditor = defineAsyncComponent(
  () => import('./components/ReportEditor.vue'),
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
const editor = ref<{ insert: (node: ReportDocument) => void } | null>(null)
const raced = useRacedFetch()
const trials = useRacedFetch()
const saves = useRacedFetch()
const confirm = useConfirm()
const savedSnapshot = ref('')
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
watch(id, load, { immediate: true })
function load(): void {
  saves.cancel()
  trials.cancel()
  template.value = null
  preview.value = null
  error.value = ''
  isBusy.value = false
  void raced.run((signal) => api.getReport(id.value, signal), {
    ok: (value) => {
      template.value = value
      draft.value = reportDraft(value)
      savedSnapshot.value = JSON.stringify(draft.value)
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => undefined,
  })
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
  trials.cancel()
  saves.cancel()
})
async function save(): Promise<void> {
  if (!template.value) return
  isBusy.value = true
  const payload = reportUpdate(draft.value, template.value.row_version)
  const snapshot = JSON.stringify(draft.value)
  await saves.run(() => api.saveReport(id.value, payload), {
    ok: (value) => {
      template.value = value
      savedSnapshot.value = snapshot
      toast.success('模板已保存')
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      isBusy.value = false
    },
  })
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
function setGranularity(value: string): void {
  if (
    value === 'day' ||
    value === 'month' ||
    value === 'quarter' ||
    value === 'year'
  )
    draft.value.granularity = value
}
function insert(node: ReportDocument): void {
  editor.value?.insert(node)
}
</script>
<template>
  <AppShell
    title="编辑报告"
    back-to="/reports"
    subtitle="编辑后保存，再按报告期生成"
  >
    <template #actions>
      <DtInput v-model="period" aria-label="报告期" placeholder="2026-08" />
      <PermGuard :codes="['report:manage']">
        <DtButton
          :loading="isBusy"
          :disabled="!template"
          variant="ghost"
          @click="trial"
        >
          试算
        </DtButton>
        <DtButton :loading="isBusy" :disabled="!template" @click="save">
          保存模板
        </DtButton>
      </PermGuard>
      <PermGuard :codes="['report:render']">
        <DtButton :loading="isBusy" :disabled="!template" @click="generate">
          生成已保存模板
        </DtButton>
      </PermGuard>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-3">
      <DtNotice v-if="!template && !error" intent="info"
        >正在加载报告模板…</DtNotice
      >
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
      <div
        v-if="template"
        class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_20rem] gap-4"
      >
        <ReportEditor
          ref="editor"
          :model-value="draft.doc_json ?? { type: 'doc' }"
          :disabled="!canEdit || isBusy"
          @update:model-value="draft.doc_json = $event"
        />
        <aside class="flex min-h-0 flex-col gap-4 overflow-auto">
          <DtInput
            v-model="draft.name"
            label="报告名称"
            :disabled="!canEdit || isBusy"
          />
          <DtSelect
            :model-value="draft.granularity ?? 'month'"
            label="报告周期"
            :options="GRANULARITIES"
            :disabled="!canEdit || isBusy"
            @update:model-value="setGranularity"
          />
          <DtCheckbox
            :model-value="draft.is_enabled ?? true"
            label="启用模板"
            :disabled="!canEdit || isBusy"
            @update:model-value="draft.is_enabled = $event"
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
          <DtButton v-if="canEdit" @click="isNodeOpen = true">
            插入图表、表格或条件文本
          </DtButton>
          <DtButton v-if="canEdit" @click="isPageOpen = true">
            页面设置
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
    </div>
  </AppShell>
</template>
