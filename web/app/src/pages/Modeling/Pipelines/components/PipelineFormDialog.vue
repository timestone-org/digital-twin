<script setup lang="ts">
/**
 * @fileoverview 建 / 改一条流水线。
 *
 * ⚠ 编码只在新建时可填：它是模型版本与公式绑定共同的引用键，改一次会让存量
 * 绑定集体指空（MODELING_DESIGN §5.2）。
 */
import { DtButton, DtInput, DtModal, DtSelect, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { useFormDirty } from '@/composables/useFormDirty'

import { PIPELINE_TEMPLATES } from '../scripts/templates'
import type { PipelineDraft } from '../scripts/usePipelineOps'

const props = defineProps<{
  draft: PipelineDraft | null
  isSaving: boolean
}>()

const emit = defineEmits<{
  /** ⚠ 第二个实参是模板键，只在新建时非空。 */
  submit: [draft: PipelineDraft, templateKey: string]
  close: []
}>()

const form = ref<PipelineDraft>({
  id: null,
  code: '',
  name: '',
  description: '',
})

// 新建时套哪张模板。⚠ 只在新建时给：改一条已有流水线时套模板等于把画布上
// 已经搭好的图整个换掉，而那不是「改名称」这个动作该干的事
const templateKey = ref('regression')
const TEMPLATE_OPTIONS = PIPELINE_TEMPLATES.map((item) => ({
  value: item.key,
  label: item.label,
}))
const templateHint = computed(
  () =>
    PIPELINE_TEMPLATES.find((item) => item.key === templateKey.value)?.hint ??
    '',
)

const isCreate = computed(() => form.value.id === null)
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

// ⚠ 弹窗里有三个输入，关掉前必须问一句：直接关等于把刚填的一整屏悄悄丢掉。
// ⚠ 回填与拍快照的先后不能靠 isOpen 那条通路——换一条记录时弹窗一直开着，
// 那次跳变根本不发生，故这里回填完自己调 markClean()
const dirty = useFormDirty(() => form.value)

watch(
  () => props.draft,
  (next) => {
    if (next === null) return
    form.value = { ...next }
    dirty.markClean()
  },
  { immediate: true, flush: 'post' },
)
</script>

<template>
  <DtModal
    :model-value="props.draft !== null"
    :title="isCreate ? '新建流水线' : '改流水线'"
    width="28rem"
    :dirty="dirty.isDirty.value"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-3">
      <DtInput
        v-model="form.code"
        label="编码"
        :hint="
          isCreate
            ? '模型版本与公式绑定都按它引用，建后不可改'
            : '编码建后不可改'
        "
        :error="codeError"
        :disabled="!isCreate"
        required
      />
      <DtInput v-model="form.name" label="名称" required />
      <DtSelect
        v-if="isCreate"
        v-model="templateKey"
        label="从哪儿起步"
        :hint="templateHint"
        :options="TEMPLATE_OPTIONS"
      />
      <DtTextarea v-model="form.description" label="说明" :rows="3" />
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton
        :disabled="!canSubmit"
        :loading="props.isSaving"
        @click="emit('submit', form, isCreate ? templateKey : '')"
      >
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
