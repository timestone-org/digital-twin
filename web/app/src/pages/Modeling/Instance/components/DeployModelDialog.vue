<script setup lang="ts">
/** @fileoverview 部署指定模型版本并交付仅显示一次的调用密钥。 */
import type { ModelDeployment, ModelingVersionSummary } from '@dt/contracts'
import {
  DtButton,
  DtInput,
  DtModal,
  DtNotice,
  DtNumberInput,
  DtTextarea,
} from '@dt/ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { onBeforeRouteLeave, RouterLink } from 'vue-router'
import { deployInstance } from '@/api/modelingTemplates'
import { createModelApiKey } from '@/api/modeling'
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
const plaintext = ref('')
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
    plaintext.value = ''
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
function deploymentError(caught: unknown): string {
  return `${deployment.value ? '部署已创建，密钥生成失败，可再次生成：' : ''}${describeModelingError(caught)}`
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
    const created =
      deployment.value ??
      (await deployInstance(instanceId, deploymentInput(versionId)))
    if (!isCurrent()) return
    deployment.value = created
    const key = await createModelApiKey(created.id, {
      name: '首次接入密钥',
    })
    if (!isCurrent()) return
    plaintext.value = key.plaintext
    emit('deployed')
  } catch (caught) {
    if (!isCurrent()) return
    error.value = deploymentError(caught)
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
    :dirty="code !== '' && !plaintext"
    :close-on-backdrop="!busy"
    @update:model-value="!busy && emit('close')"
  >
    <div class="flex flex-col gap-4">
      <DtNotice intent="info">
        {{ version?.name }} · v{{
          version?.version
        }}。部署固定此版本，重新训练不会自动替换线上服务。
      </DtNotice>

      <template v-if="!plaintext">
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
          模型已部署。请保存调用密钥，关闭后无法再次读取明文。
        </DtNotice>

        <DtInput
          :model-value="`/api/v1/platform/open-models/${deployment?.code}`"
          label="服务地址"
          readonly
        />

        <DtTextarea
          :model-value="plaintext"
          label="调用密钥（仅显示一次）"
          :rows="3"
          readonly
        />

        <RouterLink to="/modeling/services">
          前往部署服务查看签名、调用示例与密钥管理
        </RouterLink>
      </template>

      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
    </div>

    <template #footer>
      <DtButton variant="ghost" :disabled="busy" @click="emit('close')">
        {{ plaintext ? '完成' : '取消' }}
      </DtButton>

      <DtButton
        v-if="!plaintext"
        :disabled="!valid || busy"
        @click="void deploy()"
      >
        {{
          busy ? '正在部署…' : deployment ? '重新生成密钥' : '部署并生成密钥'
        }}
      </DtButton>
    </template>
  </DtModal>
</template>
