<script setup lang="ts">
/**
 * @fileoverview 「起个名字」的通用弹窗：建/改车间、建/改房间共用一个。
 * 文案与提交由调用方按任务形态给，见同目录的 `spaceTask.ts`。
 */
import { ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtNotice } from '@dt/ui'

const props = defineProps<{
  modelValue: boolean
  title: string
  description: string
  initial: string
  isBusy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [name: string]
}>()

const name = ref('')

watch(
  () => props.modelValue,
  (open) => {
    if (open) name.value = props.initial
  },
  // ⚠ immediate：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次
  // 都不会跑，输入框会是空的。
  { immediate: true },
)

function onSubmit(): void {
  const trimmed = name.value.trim()
  if (trimmed !== '') emit('submit', trimmed)
}
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    :title="props.title"
    :description="props.description"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="onSubmit">
      <DtInput v-model="name" label="名称" required @enter="onSubmit" />
      <DtNotice v-if="props.error" intent="danger">{{ props.error }}</DtNotice>
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
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
