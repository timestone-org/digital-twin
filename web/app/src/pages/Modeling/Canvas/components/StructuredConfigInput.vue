<script setup lang="ts">
/** @fileoverview 编辑并显式应用规则的列映射、核算参数和路径明细。 */
import { DtButton, DtTextarea } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigStatus } from '../scripts/configValues'

const props = defineProps<{
  modelValue: unknown
  label: string
  hint: string
  isReadonly: boolean
  valueType?: 'object' | 'array' | undefined
}>()
const emit = defineEmits<{
  'update:modelValue': [value: object]
  status: [value: ConfigStatus]
}>()
const draft = ref('')
watch(
  () => JSON.stringify(props.modelValue),
  () => {
    draft.value = JSON.stringify(props.modelValue ?? {}, null, 2)
  },
  { immediate: true },
)

const parsed = computed<{ value: object | null; error: string }>(() => {
  try {
    const value: unknown = JSON.parse(draft.value)
    if (typeof value !== 'object' || value === null)
      return { value: null, error: '配置必须是对象或列表' }
    if (props.valueType === 'object' && Array.isArray(value))
      return { value: null, error: '配置必须是对象' }
    if (props.valueType === 'array' && !Array.isArray(value))
      return { value: null, error: '配置必须是列表' }
    return { value, error: '' }
  } catch {
    return { value: null, error: '配置格式不完整，请检查引号、逗号和括号' }
  }
})
const hasChanges = computed(
  () =>
    JSON.stringify(parsed.value.value) !==
    JSON.stringify(props.modelValue ?? {}),
)
const status = computed<ConfigStatus>(() =>
  props.isReadonly
    ? { message: '', hasDraft: false }
    : {
        message: parsed.value.error || (hasChanges.value ? '配置尚未应用' : ''),
        hasDraft: hasChanges.value,
      },
)
watch(status, (value) => emit('status', value), { immediate: true })

function apply(): void {
  if (props.isReadonly || parsed.value.value === null) return
  emit('update:modelValue', parsed.value.value)
}
</script>

<template>
  <div class="dt-ml-structured-config">
    <DtTextarea
      v-model="draft"
      :label="props.label"
      :hint="props.hint"
      :error="parsed.error"
      :disabled="props.isReadonly"
      :rows="8"
    />
    <div v-if="!props.isReadonly" class="dt-ml-structured-config__actions">
      <span>{{
        hasChanges ? '编辑内容应用后才会保存到流水线' : '已应用到流水线配置'
      }}</span>
      <DtButton
        size="xs"
        :disabled="parsed.value === null || !hasChanges"
        @click="apply"
        >应用配置</DtButton
      >
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-structured-config {
  min-width: 0;

  &__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    justify-content: space-between;
    margin-top: 0.5rem;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
