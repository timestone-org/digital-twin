<script setup lang="ts">
/** @fileoverview 模型服务的调用方式与调用量。 */
import type { ModelCallStat, ModelDeployment } from '@dt/contracts'
import { DtButton, DtInput, DtModal, DtNotice, DtSpinner } from '@dt/ui'
import { computed } from 'vue'

import CallStatList from './CallStatList.vue'
import RuleResultGuide from './RuleResultGuide.vue'
import DeploymentTrial from './DeploymentTrial.vue'

const props = defineProps<{
  deployment: ModelDeployment | null
  stats: readonly ModelCallStat[]
  isLoading: boolean
  error: string | null
}>()

const emit = defineEmits<{ close: [] }>()

/** 调用地址。⚠ 摆出来是为了让人直接复制，不必去翻文档。 */
const endpoint = computed(
  () =>
    `POST /api/v1/platform/open-models/${props.deployment?.code ?? ''}:predict`,
)

const detectionEndpoint = computed(
  () =>
    `POST /api/v1/platform/open-models/${props.deployment?.code ?? ''}:detect`,
)

const calculationEndpoint = computed(
  () =>
    `POST /api/v1/platform/open-models/${props.deployment?.code ?? ''}:calculate`,
)
</script>

<template>
  <DtModal
    :model-value="props.deployment !== null"
    :title="props.deployment ? `「${props.deployment.name}」的调用说明` : ''"
    width="44rem"
    @update:model-value="emit('close')"
  >
    <div class="dt-ml-keys flex flex-col gap-4">
      <p class="dt-ml-keys__endpoint">{{ endpoint }}</p>
      <p class="dt-ml-keys__endpoint">{{ detectionEndpoint }}</p>
      <p class="dt-ml-keys__endpoint">{{ calculationEndpoint }}</p>
      <p>
        异常检测模型使用 :detect，返回
        is_anomaly、score、threshold。回归与分类模型使用
        :predict。规则计算模型使用 :calculate，返回结构化结果，results
        中包含归集、核算、路径或诊断明细。三类接口均使用用户 APIKey，输入格式为
        {"rows": [{…}]}，具体字段见模型详情。
        调用频率由接入方控制，并受本服务配额限制。
      </p>
      <RuleResultGuide />

      <DtNotice intent="info">
        统一使用用户 APIKey，账号需具有 modeling:view 权限。
        每个账号在不同部署中分别计数，同账号多把 APIKey 共用配额。
      </DtNotice>
      <DtInput
        model-value="Authorization: Bearer <用户 APIKey>"
        label="请求头"
        readonly
      />
      <p class="dt-ml-keys__endpoint">
        GET /api/v1/platform/open-models/{{ props.deployment?.code }}
      </p>

      <DeploymentTrial v-if="props.deployment" :deployment="props.deployment" />

      <section>
        <h4 class="dt-ml-keys__title">近一个月的调用量</h4>
        <DtNotice v-if="props.error" intent="danger">{{
          props.error
        }}</DtNotice>
        <DtSpinner v-else-if="props.isLoading" />
        <CallStatList v-else :rows="props.stats" />
      </section>
    </div>
    <template #footer>
      <DtButton variant="ghost" @click="emit('close')">关闭</DtButton>
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-keys {
  &__endpoint {
    margin: 0;
    padding: 0.375rem 0.5rem;
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    color: var(--text-title);
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-md);
    overflow-x: auto;
  }

  &__title {
    margin: 0 0 0.375rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
