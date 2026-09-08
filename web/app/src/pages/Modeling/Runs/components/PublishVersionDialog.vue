<script setup lang="ts">
/**
 * @fileoverview 把一次成功运行发布成不可变模型版本的表单。
 */
import type { ModelingRunSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { useFormDirty } from '@/composables/useFormDirty'

const props = defineProps<{
  run: ModelingRunSummary | null
  pipelineName: string
  isBusy: boolean
}>()

const emit = defineEmits<{
  submit: [draft: { name: string; description: string | null }]
  close: []
}>()

const name = ref('')
const description = ref('')
const canSubmit = computed(() => name.value.trim() !== '' && !props.isBusy)
const dirty = useFormDirty([name, description], () => props.run !== null)

watch(
  () => props.run?.id,
  (runId) => {
    if (runId === undefined) return
    name.value = props.pipelineName
    description.value = ''
  },
  { immediate: true },
)

function submit(): void {
  if (!canSubmit.value) return
  const note = description.value.trim()
  emit('submit', {
    name: name.value.trim(),
    description: note === '' ? null : note,
  })
}

function close(open: boolean): void {
  if (!open && !props.isBusy) emit('close')
}
</script>

<template>
  <DtModal
    :model-value="props.run !== null"
    title="发布模型版本"
    description="模型版本发布后不可修改；要调整参数，请重新运行并发布下一版。"
    width="32rem"
    :dirty="dirty.isDirty.value"
    :close-on-backdrop="!props.isBusy"
    @update:model-value="close"
  >
    <div class="flex flex-col gap-3">
      <DtNotice intent="info">
        本次发布来自「{{
          props.pipelineName
        }}」的成功运行；一次运行只能发布一个版本。
      </DtNotice>
      <DtInput
        v-model="name"
        label="版本名称"
        required
        :maxlength="128"
        placeholder="如：能耗预测生产版"
        @enter="submit"
      />
      <DtTextarea
        v-model="description"
        label="说明（可选）"
        :rows="3"
        :maxlength="512"
        placeholder="记录训练数据范围、用途或上线说明"
      />
    </div>
    <template #footer>
      <DtButton variant="ghost" :disabled="props.isBusy" @click="emit('close')">
        取消
      </DtButton>
      <DtButton :disabled="!canSubmit" :loading="props.isBusy" @click="submit">
        发布
      </DtButton>
    </template>
  </DtModal>
</template>
