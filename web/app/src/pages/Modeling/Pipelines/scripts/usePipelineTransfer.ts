/** @fileoverview 工作流 JSON 文件预检、导入表单与下载状态。 */
import type {
  ModelingImportInspection,
  ModelingPipelineSummary,
  ModelingPipelineImportInput,
} from '@dt/contracts'
import { useToast } from '@dt/ui'
import { computed, onBeforeUnmount, ref } from 'vue'

import * as transfer from '@/api/modelingTransfer'
import { newIdempotencyKey } from '@/api/idempotency'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { downloadJson } from '@/utils/downloadJson'
import {
  describeImportError,
  jsonFingerprint,
  readDocument,
} from './pipelineTransferFile'

function useImportForm() {
  const isOpen = ref(false)
  const isReading = ref(false)
  const isSaving = ref(false)
  const inspection = ref<ModelingImportInspection | null>(null)
  const error = ref('')
  const code = ref('')
  const name = ref('')
  const description = ref('')
  const fileName = ref('')
  const reading = useRacedFetch()
  const saving = useRacedFetch()
  const attempt = ref<{ payload: string; key: string } | null>(null)
  const codeError = computed(() =>
    code.value !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code.value)
      ? '1–64 个字母、数字、点、下划线或短横线，首位为字母或数字'
      : '',
  )
  const canSubmit = computed(
    () =>
      inspection.value?.can_import === true &&
      code.value.trim() !== '' &&
      codeError.value === '' &&
      name.value.trim() !== '' &&
      name.value.trim().length <= 128 &&
      !isReading.value &&
      !isSaving.value,
  )

  return {
    isOpen,
    isReading,
    isSaving,
    inspection,
    error,
    code,
    name,
    description,
    fileName,
    reading,
    saving,
    attempt,
    codeError,
    canSubmit,
  }
}

type ImportForm = ReturnType<typeof useImportForm>

function submissionKey(
  form: ImportForm,
  input: ModelingPipelineImportInput,
): string {
  const payload = jsonFingerprint(input)
  if (form.attempt.value?.payload !== payload) {
    form.attempt.value = { payload, key: newIdempotencyKey() }
  }
  return form.attempt.value.key
}

function closeImport(form: ImportForm): void {
  if (form.isSaving.value) return
  form.reading.cancel()
  form.isReading.value = false
  form.isOpen.value = false
  form.inspection.value = null
  form.error.value = ''
  form.fileName.value = ''
}

async function selectImport(form: ImportForm, files: File[]): Promise<void> {
  const file = files[0]
  if (!file || form.isSaving.value) return
  form.inspection.value = null
  form.error.value = ''
  form.fileName.value = file.name
  form.isReading.value = true
  await form.reading.run(
    async (signal) => {
      const document = await readDocument(file)
      if (signal.aborted) throw new Error('已取消')
      return await transfer.inspectPipelineImport(document, signal)
    },
    {
      ok: (result) => {
        form.inspection.value = result
        form.code.value = result.document.pipeline.code
        form.name.value = result.document.pipeline.name
        form.description.value = result.document.pipeline.description ?? ''
      },
      fail: (caught) => {
        form.error.value = describeImportError(caught)
      },
      settled: () => {
        form.isReading.value = false
      },
    },
  )
}

async function submitImport(
  form: ImportForm,
  onImported: (id: string) => void,
): Promise<void> {
  if (!form.canSubmit.value || !form.inspection.value) return
  form.isSaving.value = true
  form.error.value = ''
  const input = {
    document: form.inspection.value.document,
    code: form.code.value.trim(),
    name: form.name.value.trim(),
    description: form.description.value.trim() || null,
  }
  await form.saving.run(
    (signal) =>
      transfer.importPipeline(input, submissionKey(form, input), signal),
    {
      ok: (created) => {
        form.isSaving.value = false
        closeImport(form)
        useToast().success('工作流已导入，请核对数据源并校验后运行')
        onImported(created.id)
      },
      fail: (caught) => {
        form.error.value = describeError(caught)
      },
      settled: () => {
        form.isSaving.value = false
      },
    },
  )
}

function usePipelineExport() {
  const exportingId = ref<string | null>(null)
  const exporting = useRacedFetch()
  const toast = useToast()

  async function exportSaved(row: ModelingPipelineSummary): Promise<void> {
    if (exportingId.value !== null) return
    exportingId.value = row.id
    await exporting.run((signal) => transfer.exportPipeline(row.id, signal), {
      ok: (document) => {
        downloadJson(document, `${row.code}_工作流`)
        toast.success('已导出已保存的工作流定义')
      },
      fail: (caught) => toast.error(describeError(caught)),
      settled: () => {
        exportingId.value = null
      },
    })
  }

  onBeforeUnmount(exporting.cancel)
  return { exportingId, exportSaved }
}

export function usePipelineTransfer(onImported: (id: string) => void) {
  const form = useImportForm()
  onBeforeUnmount(form.reading.cancel)
  onBeforeUnmount(form.saving.cancel)
  return {
    ...form,
    ...usePipelineExport(),
    close: () => closeImport(form),
    select: (files: File[]) => selectImport(form, files),
    submit: () => submitImport(form, onImported),
    setName: (value: string) => {
      form.name.value = value
    },
    setCode: (value: string) => {
      form.code.value = value
    },
    setDescription: (value: string) => {
      form.description.value = value
    },
  }
}
