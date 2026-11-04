<script setup lang="ts">
/** @fileoverview 修改已发布模型的固定版本与调用配额。 */
import type { ModelDeployment } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNumberInput } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { useFormDirty } from '@/composables/useFormDirty'
import DeploymentVersionPicker from './DeploymentVersionPicker.vue'

// 配额的两个上限，与库上的 CHECK 同一份口径
const MAX_ROWS = 1000
const MAX_RATE = 6000
const props = defineProps<{
  deployment: ModelDeployment
  isBusy: boolean
}>()

const emit = defineEmits<{
  submit: [
    payload: {
      model_version_id: string
      name: string
      max_rows_per_call: number
      rate_limit_per_minute: number
    },
  ]
  close: []
}>()

interface DeploymentForm {
  name: string
  versionId: string
  maxRows: number
  rateLimit: number
}

const form = ref<DeploymentForm>({
  name: '',
  versionId: '',
  maxRows: 0,
  rateLimit: 0,
})

const versionReady = ref(false)

const canSubmit = computed(
  () =>
    versionReady.value &&
    form.value.name.trim() !== '' &&
    form.value.versionId !== '',
)

// ⚠ 这个弹窗有五个输入，关掉前必须问一句：直接关等于把刚填的一整屏悄悄丢掉
const dirty = useFormDirty(() => form.value)

/** 按部署当前版本与配额回填。 */
function refill(row: ModelDeployment): DeploymentForm {
  return {
    name: row.name,
    versionId: row.model_version_id,
    maxRows: row.max_rows_per_call,
    rateLimit: row.rate_limit_per_minute,
  }
}

watch(
  () => props.deployment,
  () => {
    form.value = refill(props.deployment)
    dirty.markClean()
  },
  { immediate: true, flush: 'post' },
)

function submit(): void {
  if (props.isBusy || !canSubmit.value) return
  emit('submit', {
    model_version_id: form.value.versionId,
    name: form.value.name.trim(),
    max_rows_per_call: form.value.maxRows,
    rate_limit_per_minute: form.value.rateLimit,
  })
}
</script>

<template>
  <DtModal
    :model-value="true"
    title="改对外服务"
    width="46rem"
    :dirty="dirty.isDirty.value"
    @update:model-value="emit('close')"
  >
    <div class="dt-form-grid">
      <DtInput
        :model-value="props.deployment.code"
        label="对外标识"
        hint="已发布入口的固定标识，创建后不可修改"
        disabled
      />
      <DtInput v-model="form.name" label="名称" :maxlength="128" required />
      <DeploymentVersionPicker
        v-model="form.versionId"
        class="dt-form-grid__wide"
        :deployment="deployment"
        :disabled="isBusy"
        @ready="versionReady = $event"
      />
      <!-- ⚠ 数值用 DtNumberInput 不是 DtInput：后者的 modelValue 是 string，
           `v-model.number` 会把一个 number 塞进 string 里 -->
      <DtNumberInput
        v-model="form.maxRows"
        label="单次最多算几行"
        :range="{ min: 1, max: MAX_ROWS }"
        hint="超过就 400 并说清上限"
      />
      <DtNumberInput
        v-model="form.rateLimit"
        label="每分钟最多调几次"
        :range="{ min: 1, max: MAX_RATE }"
        hint="按用户账号与当前部署分别计数；边缘另按来源 IP 限流"
      />
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">取消</DtButton>
      <DtButton :disabled="!canSubmit" :loading="props.isBusy" @click="submit">
        保存
      </DtButton>
    </template>
  </DtModal>
</template>
