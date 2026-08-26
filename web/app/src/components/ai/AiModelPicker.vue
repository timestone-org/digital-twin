<script setup lang="ts">
/**
 * @fileoverview 面板标题栏上那个「用哪一路模型」的下拉。
 *
 * ⚠ 只接了一路时整个不渲染：一个只有一项的下拉，除了占地方什么都不做。
 *
 * ⚠ 配了却没登录的那一路要**摆出来但选不了**，并说清去哪儿登录。整个藏掉的话，
 * 部署方配好了却在界面上找不到它，会以为配置没生效。
 */
import { computed } from 'vue'
import type { AssistantModelProfile, DtSelectOption } from '@dt/contracts'
import { DtSelect } from '@dt/ui'

import type { ModelChoice } from '@/composables/useAiPanel'

const props = defineProps<{
  models: readonly AssistantModelProfile[]
  choice: ModelChoice
}>()

const emit = defineEmits<{ pick: [value: ModelChoice] }>()

const isShown = computed(() => props.models.length > 1)

const profileOptions = computed<DtSelectOption[]>(() =>
  props.models.map((one) => ({
    value: one.id,
    label: one.is_ready ? one.label : `${one.label}（未登录）`,
    disabled: !one.is_ready,
  })),
)

const current = computed(() =>
  props.models.find((one) => one.id === props.choice.profile),
)

const effortOptions = computed<DtSelectOption[]>(() =>
  (current.value?.efforts ?? []).map((one) => ({ value: one, label: one })),
)

function pickProfile(value: string): void {
  // ⚠ 换路时把档位清掉：各路的档位取值不通用，带过去的那个多半不认识
  emit('pick', { profile: value, effort: '' })
}

function pickEffort(value: string): void {
  emit('pick', { profile: props.choice.profile, effort: value })
}
</script>

<template>
  <div v-if="isShown" class="ai-model">
    <DtSelect
      :model-value="choice.profile"
      :options="profileOptions"
      size="sm"
      aria-label="选模型"
      @update:model-value="pickProfile"
    />
    <DtSelect
      v-if="effortOptions.length > 0"
      :model-value="choice.effort"
      :options="effortOptions"
      size="sm"
      aria-label="选推理档位"
      @update:model-value="pickEffort"
    />
  </div>
</template>

<style scoped lang="scss">
.ai-model {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  max-width: 14rem;
}
</style>
