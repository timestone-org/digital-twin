<script setup lang="ts">
/** @fileoverview 实例节点的共享配置表单与既有业务 JSON 编辑适配。 */
import type { ModelingParameterNode } from '@dt/contracts'
import { computed } from 'vue'
import SharedConfigForm from '@/features/modeling-config/components/ConfigForm.vue'
import type { ConfigStatus } from '@/features/modeling-config/scripts/configValues'
import { instanceFields, instanceOptions } from '../scripts/instanceFormFields'
import { parameterFields } from '../scripts/parameters'
import ParameterField from './ParameterField.vue'

const props = defineProps<{
  node: ModelingParameterNode
  config: Record<string, unknown>
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  error: [key: string, message: string]
}>()
const fields = computed(() => instanceFields(props.node))
const options = computed(() => instanceOptions(props.node))
const hasLegacyBusinessForm = computed(() =>
  ['bdm_source', 'energy_rules'].includes(props.node.operator.code),
)
const legacyFields = computed(() =>
  parameterFields(props.node.operator.config_schema),
)
function setStatus(status: ConfigStatus): void {
  emit(
    'error',
    `${props.node.id}.__form`,
    status.message || (status.hasDraft ? '参数草稿尚未应用' : ''),
  )
}
</script>
<template>
  <div v-if="hasLegacyBusinessForm" class="dt-form-grid">
    <ParameterField
      v-for="field in legacyFields"
      :key="field.key"
      :class="{ 'dt-form-grid__wide': field.kind === 'json' }"
      :field="field"
      :value="props.config[field.key]"
      :disabled="props.disabled"
      @change="emit('change', field.key, $event)"
      @error="emit('error', `${props.node.id}.${field.key}`, $event)"
    />
  </div>
  <SharedConfigForm
    v-else
    class="instance-node-config"
    :fields="fields"
    :config="props.config"
    :options="options"
    :is-readonly="props.disabled"
    @change="(key, value) => emit('change', key, value)"
    @status="setStatus"
  />
</template>
<style scoped lang="scss">
.instance-node-config.dt-ml-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
  gap: 1rem;
  align-items: start;
  :deep(.dt-ml-form__row) {
    min-width: 0;
  }
  :deep(.dt-ml-form__row[data-widget='json']),
  :deep(.dt-ml-form__row[data-widget='columns']),
  :deep(.dt-ml-form__row[data-widget$='-list']),
  :deep(.dt-ml-form__row[data-widget='column-aggregations']) {
    grid-column: 1 / -1;
  }
}
</style>
