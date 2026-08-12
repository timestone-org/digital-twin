<script setup lang="ts">
/**
 * @fileoverview 人工排除的填写弹窗：一次开机 + 一条原因。
 * ⚠ 排除不是删除——事件仍然留在列表里置灰显示，原因也一并显示出来。
 */
import { computed, ref, watch } from 'vue'
import { STARTUP_EXCLUSION_REASON_MAX } from '@dt/contracts'
import { DtButton, DtModal, DtNotice, DtTextarea } from '@dt/ui'

const props = defineProps<{
  modelValue: boolean
  startedAt: string
  busy: boolean
  error: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  submit: [reason: string]
}>()

const reason = ref('')
const canSubmit = computed(
  () =>
    reason.value.trim() !== '' &&
    reason.value.trim().length <= STARTUP_EXCLUSION_REASON_MAX,
)

// immediate 兼作初值：组件在「已经是打开态」时被挂载时，只监听变化的 watch 一次都不跑
watch(
  () => props.modelValue,
  (open) => {
    if (open) reason.value = ''
  },
  { immediate: true },
)
</script>

<template>
  <DtModal
    :model-value="props.modelValue"
    title="排除这次开机"
    description="被排除的事件不参与训练，但仍留在列表里置灰显示"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs text-text-secondary">起始时刻 {{ startedAt }}</p>
      <DtTextarea
        v-model="reason"
        label="排除原因"
        required
        :maxlength="STARTUP_EXCLUSION_REASON_MAX"
        hint="写清为什么这次不该用于训练，例如现场检修、传感器异常"
      />
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    </div>

    <template #footer>
      <DtButton
        variant="ghost"
        intent="neutral"
        @click="emit('update:modelValue', false)"
      >
        取消
      </DtButton>
      <DtButton
        :loading="busy"
        :disabled="!canSubmit"
        @click="emit('submit', reason.trim())"
      >
        确认排除
      </DtButton>
    </template>
  </DtModal>
</template>
