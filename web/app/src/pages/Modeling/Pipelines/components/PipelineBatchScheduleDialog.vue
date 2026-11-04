<script setup lang="ts">
/** @fileoverview 批量开启定时训练的明确配置与已有规则保留策略。 */
import { PERMISSION_CODES } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtSelect,
} from '@dt/ui'
import { computed, ref } from 'vue'
import { useAuthStore } from '@/stores/auth'
import type { PipelineBatchScheduleDraft } from '../scripts/pipelineBatchSchedule'

const props = defineProps<{ count: number; isBusy: boolean }>()
const emit = defineEmits<{
  close: []
  stop: []
  submit: [draft: PipelineBatchScheduleDraft]
}>()
const auth = useAuthStore()
const strategy = ref<'preserve' | 'replace'>('preserve')
const interval = ref<number | undefined>(1440)
const autoPublish = ref(false)
const canPublish = computed(() => auth.can([PERMISSION_CODES.modelingPublish]))
const isValid = computed(
  () =>
    interval.value !== undefined &&
    Number.isInteger(interval.value) &&
    interval.value >= 5 &&
    interval.value <= 525600 &&
    (!autoPublish.value || canPublish.value),
)
const options = [
  { value: 'preserve', label: '保留已有设置，仅为未配置的工作流使用下方设置' },
  { value: 'replace', label: '统一使用下方设置' },
]
function selectStrategy(value: string): void {
  if (value === 'preserve' || value === 'replace') strategy.value = value
}
function submit(): void {
  if (
    !isValid.value ||
    props.isBusy ||
    props.count <= 0 ||
    interval.value === undefined ||
    !auth.can([PERMISSION_CODES.modelingRun])
  )
    return
  emit('submit', {
    strategy: strategy.value,
    intervalMinutes: interval.value,
    autoPublish: autoPublish.value,
  })
}
</script>

<template>
  <DtModal
    :model-value="true"
    :title="`为 ${count} 个工作流开启定时训练`"
    width="46rem"
    :close-on-backdrop="!isBusy"
    @update:model-value="!isBusy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtSelect
        :model-value="strategy"
        label="已有定时配置"
        :options="options"
        :disabled="isBusy"
        @update:model-value="selectStrategy"
      />
      <DtNumberInput
        v-model="interval"
        label="训练间隔（分钟）"
        hint="最短 5 分钟；每天训练填写 1440，每周填写 10080。"
        :range="{ min: 5, max: 525600, step: 1 }"
        :disabled="isBusy"
      />
      <DtCheckbox
        v-model="autoPublish"
        label="训练成功后自动发布最新模型"
        :disabled="isBusy || !canPublish"
      />
      <DtNotice intent="info">
        {{
          strategy === 'preserve'
            ? '已有规则保留各自周期和自动发布选项；已经启用且配置一致的项不重复保存。未配置的工作流采用上面的设置。'
            : '所选工作流统一使用上面的周期和自动发布选项。'
        }}
        这次操作不会立即开始训练，下一次训练按保存后的周期安排。每项独立校验与保存，失败项会列明原因。
      </DtNotice>
      <DtNotice v-if="!canPublish" intent="warning"
        >已有自动发布规则需要模型发布权限才能重新开启；不会为绕过权限而清除原设置。</DtNotice
      >
    </div>
    <template #footer>
      <DtButton v-if="isBusy" variant="ghost" @click="emit('stop')"
        >停止后续操作</DtButton
      >
      <DtButton v-else variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton
        :disabled="!isValid || count === 0"
        :loading="isBusy"
        @click="submit"
        >保存并开启</DtButton
      >
    </template>
  </DtModal>
</template>
