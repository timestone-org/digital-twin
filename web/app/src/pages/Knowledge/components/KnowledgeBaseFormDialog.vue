<script setup lang="ts">
/**
 * @fileoverview 知识库名称与描述表单。
 */
import { computed, ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'

const props = defineProps<{
  modelValue: boolean
  isBusy: boolean
  initial?: { name: string; description: string }
  /** 服务端返回的保存失败原因。 */
  error: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [name: string, description: string]
}>()

const name = ref('')
const description = ref('')

const isDirty = computed(() =>
  props.initial
    ? name.value !== props.initial.name ||
      description.value !== props.initial.description
    : name.value.trim() !== '' || description.value.trim() !== '',
)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      name.value = props.initial?.name ?? ''
      description.value = props.initial?.description ?? ''
    }
  },
  { immediate: true },
)

function onSubmit(): void {
  const trimmed = name.value.trim()
  if (trimmed === '' || props.isBusy || (props.initial && !isDirty.value))
    return
  emit(
    'submit',
    trimmed,
    props.initial ? description.value : description.value.trim(),
  )
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="props.initial ? '编辑知识库' : '新建知识库'"
    :description="
      props.initial
        ? undefined
        : '建好后往里传手册与规程；检索走关键词与向量两路的混合策略。'
    "
    :dirty="isDirty"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 回车交给表单的隐式提交：再接一个 @enter，同一个请求就发两遍 -->
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput
        v-model="name"
        label="名字"
        :maxlength="120"
        required
        placeholder="例如：锅炉运维手册"
      />
      <DtTextarea
        v-model="description"
        label="描述"
        :maxlength="1000"
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
        :disabled="name.trim() === '' || Boolean(props.initial && !isDirty)"
        @click="onSubmit"
      >
        {{ props.initial ? '保存' : '创建' }}
      </DtButton>
    </template>
  </DtModal>
</template>
