<script setup lang="ts">
/** @fileoverview 创建或复制独立流水线，以及修改已有流水线的名称和说明。 */
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import { useFormDirty } from '@/composables/useFormDirty'
import type { PipelineDraft } from '../scripts/usePipelineOps'
import TemplatePicker from './TemplatePicker.vue'

const props = defineProps<{ draft: PipelineDraft | null; isSaving: boolean }>()
const emit = defineEmits<{
  submit: [draft: PipelineDraft, templateKey: string]
  close: []
}>()
const form = ref<PipelineDraft>({
  id: null,
  code: '',
  name: '',
  description: '',
})
const templateKey = ref('regression')
const isCreate = computed(() => form.value.id === null)
const isCopy = computed(() => form.value.sourcePipelineId !== undefined)
const isTemplateCreate = computed(() => isCreate.value && !isCopy.value)
const title = computed(() =>
  isCopy.value
    ? '复制流水线'
    : isCreate.value
      ? '新建流水线'
      : '编辑流水线信息',
)
const description = computed(() =>
  isCopy.value
    ? '从已保存的流水线创建独立副本，保留原流水线。'
    : isCreate.value
      ? '选择适合业务的设计模板，命名后进入流程图。'
      : '修改名称和说明，保留现有流程图。',
)
const submitText = computed(() =>
  isCopy.value
    ? '复制并进入流程图'
    : isCreate.value
      ? '创建并进入流程图'
      : '保存',
)
const codeError = computed(() => {
  if (!isCreate.value || form.value.code === '') return ''
  return /^[a-z][a-z0-9_]{1,63}$/.test(form.value.code)
    ? ''
    : '小写字母开头，只能用小写字母、数字与下划线，2–64 个字符'
})
const canSubmit = computed(
  () =>
    form.value.name.trim() !== '' &&
    (!isCreate.value || form.value.code !== '') &&
    codeError.value === '',
)
const dirty = useFormDirty(() => ({
  form: form.value,
  templateKey: templateKey.value,
}))
watch(
  () => props.draft,
  (next) => {
    if (next === null) return
    form.value = { ...next }
    templateKey.value = 'regression'
    dirty.markClean()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <DtModal
    :model-value="props.draft !== null"
    :title="title"
    :description="description"
    :width="isTemplateCreate ? '64rem' : '44rem'"
    :dirty="dirty.isDirty.value"
    :close-on-backdrop="!isSaving"
    @update:model-value="!isSaving && emit('close')"
  >
    <div class="flex flex-col gap-6">
      <TemplatePicker
        v-if="isTemplateCreate"
        v-model="templateKey"
        :disabled="isSaving"
      />
      <DtNotice v-if="isCopy" intent="info">
        复制已保存的算子、参数、连线和位置，副本可独立修改。运行记录、模型版本和部署不会复制。
      </DtNotice>
      <form
        id="pipeline-details"
        class="dt-form-grid pipeline-details"
        @submit.prevent="
          canSubmit &&
          !isSaving &&
          emit('submit', form, isTemplateCreate ? templateKey : '')
        "
      >
        <DtInput
          v-model="form.name"
          label="流水线名称"
          placeholder="例如：1 号冷机能耗预测"
          :maxlength="128"
          :disabled="isSaving"
          required
        />
        <DtInput
          v-model="form.code"
          label="编码"
          :hint="
            isCreate
              ? '已自动生成，可修改；创建后保持不变。'
              : '编码创建后保持不变。'
          "
          :error="codeError"
          :disabled="!isCreate || isSaving"
          :maxlength="64"
          required
        />
        <DtTextarea
          v-model="form.description"
          class="dt-form-grid__wide"
          label="说明（选填）"
          placeholder="记录分析目标或数据范围，方便下次继续建模"
          :rows="2"
          :disabled="isSaving"
        />
      </form>
    </div>
    <template #footer>
      <DtButton variant="ghost" :disabled="isSaving" @click="emit('close')"
        >取消</DtButton
      >
      <DtButton
        type="submit"
        form="pipeline-details"
        :disabled="!canSubmit"
        :loading="isSaving"
        :icon="isCreate ? 'arrow-right' : 'save'"
        >{{ submitText }}</DtButton
      >
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.pipeline-details {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  @media (width < 48rem) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
