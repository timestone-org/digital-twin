<script setup lang="ts">
/** @fileoverview 以原规则的行版本更新名称和延迟，保留周期与启停状态。 */
import type { ReportSchedule, ReportTemplateSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtTag } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import * as api from '@/api/reports'
import { describeError } from '@/composables/useAsyncList'
import { useFormDirty } from '@/composables/useFormDirty'
import {
  emptyScheduleErrors,
  validateScheduleFields,
} from '../scripts/scheduleForm'

const props = defineProps<{
  modelValue: boolean
  record: ReportSchedule | null
  templates: readonly ReportTemplateSummary[]
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()
const name = ref('')
const delay = ref('')
const error = ref('')
const fieldErrors = ref(emptyScheduleErrors())
const isSaving = ref(false)
const dirty = useFormDirty([name, delay], () => props.modelValue)
const templateLabel = computed(
  () =>
    props.templates.find((row) => row.id === props.record?.template_id)?.name ??
    `模板目录未提供（${props.record?.template_id ?? ''}）`,
)
watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.record) return
    name.value = props.record.name
    delay.value = String(props.record.delay_hours)
    error.value = ''
    fieldErrors.value = emptyScheduleErrors()
  },
  { immediate: true },
)

function close(open: boolean): void {
  if (!isSaving.value) emit('update:modelValue', open)
}
async function save(): Promise<void> {
  const row = props.record
  if (!row || isSaving.value) return
  const checked = validateScheduleFields(name.value, delay.value)
  fieldErrors.value = checked.errors
  error.value = ''
  if (!checked.fields) return
  isSaving.value = true
  try {
    await api.saveReportSchedule(row.id, {
      ...checked.fields,
      granularity: row.granularity,
      is_enabled: row.is_enabled,
      expected_version: row.row_version,
    })
    emit('update:modelValue', false)
    emit('saved')
  } catch (caught) {
    error.value = describeError(caught)
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <DtModal
    :model-value="modelValue"
    title="编辑定时规则"
    :dirty="dirty.isDirty.value"
    :close-on-backdrop="!isSaving"
    @update:model-value="close"
  >
    <div class="flex flex-col gap-3">
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtInput
        v-model="name"
        label="规则名称"
        size="sm"
        :error="fieldErrors.name"
        :disabled="isSaving"
      />
      <DtInput
        :model-value="templateLabel"
        label="报告模板"
        size="sm"
        disabled
        hint="报告模板和周期沿用原规则，启停可在列表操作"
      />
      <div class="flex flex-wrap gap-2">
        <DtTag>周期：{{ record?.granularity }}</DtTag>
        <DtTag>{{ record?.is_enabled ? '已启用' : '已停用' }}</DtTag>
      </div>
      <DtInput
        v-model="delay"
        label="期末延迟小时数"
        size="sm"
        inputmode="numeric"
        :error="fieldErrors.delayHours"
        :disabled="isSaving"
        hint="0～720 的整数；24 表示报告期结束后等待一天"
      />
    </div>
    <template #footer>
      <DtButton
        variant="ghost"
        size="sm"
        :disabled="isSaving"
        @click="close(false)"
      >
        取消
      </DtButton>
      <DtButton size="sm" :loading="isSaving" @click="save">保存规则</DtButton>
    </template>
  </DtModal>
</template>
