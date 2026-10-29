<script setup lang="ts">
/** @fileoverview 部署指定模型版本并展示统一账号鉴权的调用方式。 */
import type { ModelDeployment, ModelingVersionSummary } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtNumberInput } from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import { deployInstance } from '@/api/modelingTemplates'
import { describeModelingError } from '../../scripts/instancePresentation'
const props = defineProps<{
  instanceId: string
  version: ModelingVersionSummary | null
}>()
const emit = defineEmits<{ close: []; deployed: [] }>()
const code = ref('')
const name = ref('')
const maxRows = ref<number | undefined>(200)
const rate = ref<number | undefined>(60)
const busy = ref(false)
const error = ref('')
const deployment = ref<ModelDeployment | null>(null)
let isDisposed = false
onBeforeUnmount(() => {
  isDisposed = true
})
onBeforeRouteLeave(() => !busy.value)
const valid = computed(
  () =>
    /^[a-z0-9][a-z0-9-]{1,62}$/.test(code.value) &&
    name.value.trim() !== '' &&
    maxRows.value !== undefined &&
    rate.value !== undefined,
)
watch(
  () => props.version,
  (version) => {
    name.value = version?.name ?? ''
    code.value = ''
    error.value = ''
    deployment.value = null
  },
  { immediate: true },
)
function deploymentInput(versionId: string) {
  return {
    code: code.value,
    name: name.value,
    model_version_id: versionId,
    max_rows_per_call: maxRows.value ?? 200,
    rate_limit_per_minute: rate.value ?? 60,
  }
}
async function deploy(): Promise<void> {
  if (!props.version || !valid.value || busy.value) return
  const versionId = props.version.id
  const instanceId = props.instanceId
  const isCurrent = () =>
    !isDisposed &&
    props.version?.id === versionId &&
    props.instanceId === instanceId
  busy.value = true
  error.value = ''
  try {
    const created = await deployInstance(instanceId, deploymentInput(versionId))
    if (!isCurrent()) return
    deployment.value = created
    emit('deployed')
  } catch (caught) {
    if (!isCurrent()) return
    error.value = describeModelingError(caught)
  } finally {
    if (isCurrent()) busy.value = false
  }
}
</script>
<template>
  <DtModal
    :model-value="version !== null"
    title="部署模型"
    width="48rem"
    :dirty="code !== '' && !deployment"
    :close-on-backdrop="!busy"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="info">
        {{ version?.name }} · v{{
          version?.version
        }}。部署固定此版本，重新训练不会自动替换线上服务。
      </DtNotice>

      <template v-if="!deployment">
        <DtInput
          v-model="name"
          label="服务名称"
          :disabled="deployment !== null || busy"
          required
        />

        <DtInput
          v-model="code"
          label="服务编码"
          placeholder="例如：chiller-01-energy"
          hint="2–63 位小写字母、数字或连字符；用于稳定调用地址。"
          :disabled="deployment !== null || busy"
          required
        />

        <div class="dt-form-grid">
          <DtNumberInput
            v-model="maxRows"
            label="单次最大行数"
            :range="{ min: 1, max: 1000 }"
            :disabled="busy || deployment !== null"
          />

          <DtNumberInput
            v-model="rate"
            label="每分钟调用次数"
            :range="{ min: 1, max: 6000 }"
            :disabled="busy || deployment !== null"
          />
        </div>
      </template>

      <template v-else>
        <DtNotice intent="success">
          模型已部署。统一使用用户 APIKey 调用，账号需具有 modeling:view 权限。
        </DtNotice>

        <DtInput
          :model-value="`/api/v1/platform/open-models/${deployment?.code}`"
          label="服务地址"
          readonly
        />

        <DtInput
          model-value="Authorization: Bearer <用户 APIKey>"
          label="请求头"
          readonly
        />

        <RouterLink to="/modeling/services">
          前往部署服务查看调用说明与统计
        </RouterLink>
      </template>

      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
    </div>

    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="emit('close')">
        {{ deployment ? '完成' : '取消' }}
      </DtButton>

      <DtButton
        v-if="!deployment"
        :disabled="!valid || busy"
        @click="void deploy()"
      >
        {{ busy ? '正在部署…' : '部署模型' }}
      </DtButton>
    </template>
  </DtModal>
</template>
