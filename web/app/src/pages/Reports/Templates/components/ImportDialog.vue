<script setup lang="ts">
/** @fileoverview Word 导入、转换进度及丢失清单确认。 */
import { useFormDirty } from '@/composables/useFormDirty'
import { onBeforeUnmount, ref, watch } from 'vue'
import { DtButton, DtFilePicker, DtInput, DtModal, DtNotice } from '@dt/ui'
import type { ReportSchemas, ReportTemplate } from '@dt/contracts'
import * as api from '@/api/reports'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import { blankReport } from '../../scripts/reportDocument'
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
const dirty = useFormDirty([name, code], () => props.modelValue)
const raced = useRacedFetch()
let timer: ReturnType<typeof setTimeout> | undefined
function stop(): void {
  raced.cancel()
  if (timer) clearTimeout(timer)
  busy.value = false
}
onBeforeUnmount(stop)
watch(
  () => props.modelValue,
  (open) => {
    if (!open) stop()
  },
)
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
  imported.value = null
  error.value = ''
  status.value = '正在上传原件'
  name.value = file.name.replace(/\.docx$/i, '')
  await raced.run((signal) => api.importReport(file, signal), {
    ok: (job) => {
      status.value = '正在转换 Word'
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
    ok: (job) => {
      if (job.status === 'succeeded') {
        imported.value = job.imported ?? null
        busy.value = false
        status.value = '转换完成，请检查以下提示后创建模板'
      } else if (job.status === 'failed') {
        error.value = job.error ?? '导入失败'
        busy.value = false
      } else timer = setTimeout(() => void poll(id), 2000)
    },
    fail: (caught) => {
      error.value = describeError(caught)
      busy.value = false
    },
    settled: () => undefined,
  })
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
      <p>
        {{ status }}
      </p>
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
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
