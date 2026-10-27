<script setup lang="ts">
/**
 * @fileoverview 一个对外服务的密钥与调用量。两张表各自成件，这里只做编排。
 *
 * ⚠ 一把密钥对一家对接方：不做「一把钥匙开全部服务」——那把撤销的爆炸半径会
 * 放大到所有对接方（docs/MODELING_PLATFORM_DESIGN.md D13）。
 */
import type { ModelApiKey, ModelCallStat, ModelDeployment } from '@dt/contracts'
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtInput, DtModal } from '@dt/ui'
import { computed, ref } from 'vue'

import PermGuard from '@/components/PermGuard.vue'

import ApiKeyList from './ApiKeyList.vue'
import CallStatList from './CallStatList.vue'
import RuleResultGuide from './RuleResultGuide.vue'

const props = defineProps<{
  deployment: ModelDeployment | null
  keys: readonly ModelApiKey[]
  stats: readonly ModelCallStat[]
  isBusy: boolean
}>()

const emit = defineEmits<{
  mint: [name: string]
  revoke: [key: ModelApiKey]
  close: []
}>()

const newName = ref('')

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

function mint(): void {
  emit('mint', newName.value.trim())
  newName.value = ''
}
</script>

<template>
  <DtModal
    :model-value="props.deployment !== null"
    :title="props.deployment ? `「${props.deployment.name}」的密钥` : ''"
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
        中包含归集、核算、路径或诊断明细。三类接口均使用 X-Api-Key
        请求头，输入格式为 {"rows": [{…}]}，具体字段见模型详情。
        调用频率由接入方控制，并受本服务配额限制。
      </p>
      <RuleResultGuide />

      <PermGuard :codes="[PERMISSION_CODES.modelingPublish]">
        <DtInput
          v-model="newName"
          label="给这把钥匙起个用途名"
          hint="比如「MES 生产系统」。一把钥匙对一家对接方，撤销时不牵连别人"
        >
          <template #actions>
            <DtButton
              :disabled="newName.trim() === ''"
              :loading="props.isBusy"
              @click="mint"
            >
              铸一把
            </DtButton>
          </template>
        </DtInput>
      </PermGuard>

      <ApiKeyList :rows="props.keys" @revoke="(key) => emit('revoke', key)" />

      <section>
        <h4 class="dt-ml-keys__title">近一个月的调用量</h4>
        <CallStatList :rows="props.stats" />
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
