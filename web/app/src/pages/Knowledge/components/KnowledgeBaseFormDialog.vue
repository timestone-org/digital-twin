<script setup lang="ts">
/**
 * @fileoverview 「新建知识库」弹窗：名字必填、描述选填；策略固定混合，不给选。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'

const props = defineProps<{
  modelValue: boolean
  isBusy: boolean
  /** 上一次创建失败时后端那句话；空串表示没有。 */
  error: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [name: string, description: string]
}>()

const name = ref('')
const description = ref('')

const isDirty = computed(
  () => name.value.trim() !== '' || description.value.trim() !== '',
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = ''
      description.value = ''
    }
  },
)

function onSubmit(): void {
  const trimmed = name.value.trim()
  if (trimmed === '' || props.isBusy) return
  emit('submit', trimmed, description.value.trim())
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    title="新建知识库"
    description="建好后往里传手册与规程；检索走关键词与向量两路的混合策略。"
    :dirty="isDirty"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="name"
        label="名字"
        required
        placeholder="例如：锅炉运维手册"
        @enter="onSubmit"
      />
      <DtTextarea
        v-model="description"
        label="描述"
        hint="选填，说一句这个库装的是什么资料。"
        autosize
      />
      <DtNotice v-if="props.error !== ''" intent="danger">
        {{ props.error }}
      </DtNotice>
    </form>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton
        :loading="props.isBusy"
        :disabled="name.trim() === ''"
        @click="onSubmit"
      >
        创建
      </DtButton>
    </template>
  </DtModal>
</template>
