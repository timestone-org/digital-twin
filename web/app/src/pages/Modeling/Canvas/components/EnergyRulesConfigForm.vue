<script setup lang="ts">
/** @fileoverview 按能源规则展示业务列、阈值和计量流向的可视配置。 */
import { DtNotice } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField, FormOptions } from '../scripts/schemaForm'
import {
  mappingFields,
  parameterFields,
  recordOf,
  ruleConfigError,
  ruleOf,
  textOf,
} from '../scripts/energyRuleForm'
import ConfigForm from './ConfigForm.vue'
import EnergyRuleRows from './EnergyRuleRows.vue'

const props = defineProps<{
  fields: readonly FormField[]
  schema: Record<string, unknown>
  config: Record<string, unknown>
  options: FormOptions
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  status: [value: ConfigStatus]
}>()
const kind = computed(() => textOf(props.config['kind'], 'hvac_compliance'))
const kindFields = computed(() =>
  props.fields
    .filter((field) => field.key === 'kind')
    .map((field) => ({ ...field, hint: '选择业务口径，下方只展示相关配置。' })),
)
const columns = computed(() => mappingFields(kind.value))
const parameters = computed(() => parameterFields(props.schema, kind.value))
const mappingConfig = computed(() => recordOf(props.config['fields']))
const parameterConfig = computed(() => recordOf(props.config['parameters']))
const statuses = ref<Record<string, ConfigStatus>>({})
const businessError = computed(() =>
  ruleConfigError(props.config, kind.value, props.schema),
)
const status = computed<ConfigStatus>(() => {
  if (props.isReadonly) return { message: '', hasDraft: false }
  const issues = Object.values(statuses.value)
  const first =
    issues.find((item) => item.hasDraft) ?? issues.find((item) => item.message)
  return {
    message: first?.message || businessError.value,
    hasDraft: issues.some((item) => item.hasDraft),
  }
})
watch(status, (value) => emit('status', value), { immediate: true })
watch(kind, () => {
  statuses.value = {}
})
function setStatus(key: string, value: ConfigStatus): void {
  if (JSON.stringify(statuses.value[key]) === JSON.stringify(value)) return
  statuses.value = { ...statuses.value, [key]: value }
}
function changeKind(_key: string, value: unknown): void {
  if (props.isReadonly || status.value.hasDraft) return
  emit('change', 'fields', {})
  emit('change', 'kind', value)
}
function changeNested(group: string, key: string, value: unknown): void {
  if (!props.isReadonly)
    emit('change', group, { ...recordOf(props.config[group]), [key]: value })
}
</script>

<template>
  <div class="energy-rule-form">
    <ConfigForm
      :fields="kindFields"
      :config="props.config"
      :options="props.options"
      :is-readonly="props.isReadonly || status.hasDraft"
      @change="changeKind"
      @status="setStatus('kind', $event)"
    />
    <DtNotice v-if="status.hasDraft" intent="warning"
      >请先完善或删除未完成的行，再切换规则类型。</DtNotice
    >
    <DtNotice>{{ ruleOf(kind).hint }}</DtNotice>
    <section v-if="columns.length" aria-label="业务列映射">
      <h3>业务列映射</h3>
      <ConfigForm
        :key="kind"
        class="energy-rule-form__grid"
        :fields="columns"
        :config="mappingConfig"
        :options="props.options"
        :is-readonly="props.isReadonly"
        @change="(key, value) => changeNested('fields', key, value)"
        @status="setStatus('columns', $event)"
      />
    </section>
    <section v-if="kind === 'energy_aggregation'" aria-label="分类计量">
      <h3>分类计量</h3>
      <EnergyRuleRows
        mode="meters"
        :model-value="props.config['meters']"
        :columns="props.options.columns"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', 'meters', $event)"
        @status="setStatus('rows', $event)"
      />
    </section>
    <section v-if="kind === 'energy_trace'" aria-label="能源流向">
      <h3>能源流向</h3>
      <EnergyRuleRows
        mode="topology"
        :model-value="props.config['topology']"
        :columns="props.options.columns"
        :is-readonly="props.isReadonly"
        @update:model-value="emit('change', 'topology', $event)"
        @status="setStatus('rows', $event)"
      />
    </section>
    <section aria-label="业务参数">
      <h3>业务参数</h3>
      <ConfigForm
        :key="kind"
        class="energy-rule-form__grid"
        :fields="parameters"
        :config="parameterConfig"
        :options="props.options"
        :is-readonly="props.isReadonly"
        @change="(key, value) => changeNested('parameters', key, value)"
        @status="setStatus('parameters', $event)"
      />
    </section>
    <DtNotice v-if="businessError" intent="warning">{{
      businessError
    }}</DtNotice>
  </div>
</template>

<style scoped lang="scss">
.energy-rule-form {
  display: grid;
  gap: 1.25rem;
  min-width: 0;
  section {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  h3 {
    margin: 0;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: var(--font-size-body);
    font-weight: 600;
  }
  &__grid.dt-ml-form {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    align-items: start;
    gap: 1rem;
  }
}
</style>
