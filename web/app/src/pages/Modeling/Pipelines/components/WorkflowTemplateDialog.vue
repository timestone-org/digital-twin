<script setup lang="ts">
/** @fileoverview 新建工作流时从内置模板或已保存模板中选择起点。 */
import { DtButton, DtModal, DtSegmented } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import { PIPELINE_TEMPLATES } from '../scripts/templates'
import {
  savedTemplateId,
  type WorkflowTemplateChoice,
} from '../scripts/workflowTemplateChoice'
import SavedTemplatePicker from './SavedTemplatePicker.vue'
import TemplatePicker from './TemplatePicker.vue'

const props = defineProps<{ selection: WorkflowTemplateChoice }>()
const emit = defineEmits<{
  select: [choice: WorkflowTemplateChoice]
  close: []
}>()
const source = ref('builtin')
const builtinKey = ref('regression')
const savedChoice = ref<WorkflowTemplateChoice | null>(null)
watch(
  () => props.selection,
  (selection) => {
    const isSaved = savedTemplateId(selection.key) !== null
    source.value = isSaved ? 'saved' : 'builtin'
    builtinKey.value = isSaved ? 'regression' : selection.key
    savedChoice.value = isSaved ? { ...selection } : null
  },
  { immediate: true },
)
const choice = computed<WorkflowTemplateChoice | null>(() => {
  if (source.value === 'saved') return savedChoice.value
  const template = PIPELINE_TEMPLATES.find(
    (item) => item.key === builtinKey.value,
  )
  return template ? { key: template.key, label: template.label } : null
})
const sources = [
  { value: 'builtin', label: '内置模板' },
  { value: 'saved', label: '已保存模板' },
]
</script>

<template>
  <DtModal
    :model-value="true"
    title="选择工作流模板"
    description="选择一个起点，创建后可独立调整数据、算子和参数。"
    width="64rem"
    layer="confirm"
    @update:model-value="emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtSegmented v-model="source" :options="sources" aria-label="模板来源" />
      <TemplatePicker
        v-if="source === 'builtin'"
        v-model="builtinKey"
        :disabled="false"
      />
      <SavedTemplatePicker
        v-else
        :selected-key="savedChoice?.key ?? ''"
        @select="savedChoice = $event"
      />
    </div>
    <template #footer>
      <p class="mr-auto text-sm text-text-secondary">
        {{ choice ? `已选择：${choice.label}` : '请选择一个模板' }}
      </p>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton
        :disabled="choice === null"
        @click="choice && emit('select', choice)"
        >使用所选模板</DtButton
      >
    </template>
  </DtModal>
</template>
