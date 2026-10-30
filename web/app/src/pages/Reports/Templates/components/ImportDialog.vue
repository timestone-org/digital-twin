<script setup lang="ts">
/** @fileoverview Word 导入、转换进度及丢失清单确认。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DtButton, DtFilePicker, DtInput, DtModal, DtNotice } from '@dt/ui'
import type {
  ReportSchemas,
  ReportTemplate,
  ReportRenderDetail,
} from '@dt/contracts'
import * as api from '@/api/reports'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { blankReport } from '../../scripts/reportDocument'
import { useAuthStore } from '@/stores/auth'
import {
  readImportRecovery,
  writeImportRecovery,
} from '../scripts/importRecovery'
const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [report: ReportTemplate]
}>()
const imported = ref<ReportSchemas['ImportResultOut'] | null>(null)
const busy = ref(false)
const status = ref('选择不超过 10 MB 的 .docx 文件')
const error = ref('')
const name = ref('')
const code = ref('')
const jobId = ref<string | null>(null)
const isTerminal = ref(false)
const auth = useAuthStore()
const identity = computed(() => auth.user?.id ?? null)
const canRecover = ref(true)
const dirty = useFormDirty([name, code], () => props.modelValue)
const raced = useRacedFetch()
let timer: ReturnType<typeof setTimeout> | undefined
let isRestoring = false
function stop(): void {
  raced.cancel()
  if (timer) clearTimeout(timer)
  timer = undefined
  busy.value = false
}
onBeforeUnmount(stop)
watch(identity, restoreForAccount, { immediate: true, flush: 'sync' })
watch([jobId, name, code], persist, { flush: 'sync' })
watch(
  () => props.modelValue,
  (open) => {
    if (!open) {
      stop()
      return
    }
    if (jobId.value && !isTerminal.value) void resume()
  },
)
function persist(): void {
  if (isRestoring) return
  const record = jobId.value
    ? { jobId: jobId.value, name: name.value, code: code.value }
    : null
  canRecover.value = writeImportRecovery(identity.value, record)
}
function restoreForAccount(): void {
  const record = readImportRecovery(identity.value)
  isRestoring = true
  reset()
  if (record) {
    jobId.value = record.jobId
    name.value = record.name
    code.value = record.code
    status.value = '发现本标签页的导入任务，可继续查看转换进度'
  }
  isRestoring = false
  if (props.modelValue && record) void resume()
}
function reset(): void {
  stop()
  jobId.value = null
  imported.value = null
  isTerminal.value = false
  name.value = ''
  code.value = ''
  error.value = ''
  status.value = '选择不超过 10 MB 的 .docx 文件'
  canRecover.value = true
}
function discard(): void {
  reset()
  writeImportRecovery(identity.value, null)
}
async function select(files: File[]): Promise<void> {
  const file = files[0]
  if (!file) return
  if (
    file.size > 10 * 1024 * 1024 ||
    !file.name.toLowerCase().endsWith('.docx')
  ) {
    error.value = '请选择不超过 10 MB 的 docx 文件'
    return
  }
  busy.value = true
  if (timer) clearTimeout(timer)
  jobId.value = null
  isTerminal.value = false
  imported.value = null
  error.value = ''
  status.value = '正在上传原件'
  name.value = file.name.replace(/\.docx$/i, '')
  code.value = ''
  await raced.run((signal) => api.importReport(file, signal), {
    ok: (job) => {
      jobId.value = job.id
      status.value = '文件已上传，等待后台转换'
      void poll(job.id)
    },
    fail: (caught) => {
      error.value = describeError(caught)
      busy.value = false
    },
    settled: () => undefined,
  })
}
async function poll(id: string): Promise<void> {
  await raced.run((signal) => api.getReportRender(id, signal), {
    ok: receive,
    fail: (caught) => {
      error.value = describeError(caught)
      status.value = '暂时无法读取转换状态，可继续查询当前任务'
      busy.value = false
    },
    settled: () => undefined,
  })
}
function receive(job: ReportRenderDetail): void {
  if (job.status === 'succeeded') {
    finish(job)
    return
  }
  if (job.status === 'failed') {
    isTerminal.value = true
    error.value = job.error ?? '导入失败'
    status.value = '后台转换失败，请检查文件后重新上传'
    busy.value = false
    return
  }
  status.value =
    job.status === 'pending' ? '文件已上传，等待后台转换' : '正在转换 Word'
  timer = setTimeout(() => void poll(job.id), 2000)
}
function finish(job: ReportRenderDetail): void {
  imported.value = job.imported ?? null
  isTerminal.value = true
  busy.value = false
  if (!imported.value) {
    error.value = '转换任务未返回可用结果，请重新上传 Word'
    status.value = '转换结果不可用'
    return
  }
  status.value = '转换完成，请检查以下提示后创建模板'
}
async function resume(): Promise<void> {
  if (!jobId.value || busy.value) return
  error.value = ''
  busy.value = true
  await poll(jobId.value)
}
async function create(): Promise<void> {
  const result = imported.value
  if (!result) return
  busy.value = true
  await raced.run(
    () =>
      api.createReport({
        ...blankReport(name.value),
        code: code.value,
        doc_json: result.doc_json,
        page_json: result.page_json,
      }),
    {
      ok: (report) => {
        writeImportRecovery(identity.value, null)
        jobId.value = null
        emit('created', report)
        emit('update:modelValue', false)
      },
      fail: (caught) => {
        error.value = describeError(caught)
      },
      settled: () => {
        busy.value = false
      },
    },
  )
}
</script>
<template>
  <DtModal
    :dirty="dirty.isDirty.value"
    :model-value="modelValue"
    width="46rem"
    title="从 Word 导入报告模板"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtFilePicker
        accept=".docx"
        :disabled="busy"
        label="选择 Word 文件"
        size="sm"
        @select="select"
      />
      <p role="status" aria-live="polite">
        {{ status }}
      </p>
      <DtNotice v-if="jobId && !isTerminal" intent="info">
        关闭窗口不会取消后台任务，在本标签页再次打开可继续查看转换进度。
      </DtNotice>
      <DtNotice v-if="jobId && canRecover" intent="info">
        当前任务可在本标签页刷新后恢复，不需要重复上传。
      </DtNotice>
      <DtNotice v-if="jobId && !canRecover" intent="warning">
        浏览器未能保存恢复记录，请保持此页打开直到导入完成。
      </DtNotice>
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
      <DtButton
        v-if="jobId && !isTerminal && !busy"
        size="sm"
        variant="outline"
        icon="refresh-cw"
        @click="resume"
        >继续查看转换进度</DtButton
      >
      <div v-if="jobId" class="flex flex-col gap-1">
        <DtButton size="sm" variant="ghost" @click="discard">
          放弃此次导入
        </DtButton>
        <p class="text-sm text-secondary">
          放弃会清除本标签页的恢复记录，已提交的后台任务仍会完成。
        </p>
      </div>
      <DtNotice
        v-for="warning in imported?.dropped"
        :key="warning"
        intent="warning"
      >
        {{ warning }}
      </DtNotice>
      <template v-if="imported">
        <DtInput v-model="name" label="报告名称" size="sm" />
        <DtInput v-model="code" label="模板编码" size="sm" />
      </template>
    </div>
    <template #footer>
      <DtButton
        :disabled="!imported || !name || !code"
        :loading="busy"
        size="sm"
        icon="plus"
        @click="create"
      >
        使用导入内容创建模板
      </DtButton>
    </template>
  </DtModal>
</template>
