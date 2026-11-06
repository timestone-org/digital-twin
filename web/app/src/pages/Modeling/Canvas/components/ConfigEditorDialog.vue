<script setup lang="ts">
/** @fileoverview 算子配置弹窗，保留字段草稿状态与关闭语义。 */
import type { ModelingGraphNode, ModelingOperator } from '@dt/contracts'
import { DtModal, DtNotice } from '@dt/ui'
import { ref, watch } from 'vue'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField, FormOptions } from '../scripts/schemaForm'

import ConfigForm from './ConfigForm.vue'
import BdmSourceConfigForm from './BdmSourceConfigForm.vue'
import EnergyRulesConfigForm from './EnergyRulesConfigForm.vue'
import ConfigDialogFooter from './ConfigDialogFooter.vue'

const props = defineProps<{
  node: ModelingGraphNode | null
  operator: ModelingOperator | undefined
  fields: readonly FormField[]
  options: FormOptions
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [key: string, value: unknown]
  status: [value: ConfigStatus]
  reloadTables: []
  close: []
}>()
const feedback = { status: ref<ConfigStatus>({ message: '', hasDraft: false }) }
watch(
  () => props.node?.id,
  () => {
    feedback.status.value = { message: '', hasDraft: false }
  },
)
function setStatus(value: ConfigStatus): void {
  if (JSON.stringify(feedback.status.value) === JSON.stringify(value)) return
  feedback.status.value = value
  emit('status', value)
}
</script>

<template>
  <DtModal
    :model-value="props.node !== null"
    :title="props.operator?.name ?? '参数'"
    :description="props.operator?.description"
    :width="props.operator?.code === 'bdm_source' ? '72rem' : '48rem'"
    @update:model-value="emit('close')"
  >
    <div class="dt-ml-dialog-body">
      <BdmSourceConfigForm
        v-if="props.node && props.operator?.code === 'bdm_source'"
        :key="`bdm:${props.node.id}`"
        :fields="props.fields"
        :config="props.node.config"
        :options="props.options"
        :is-readonly="props.isReadonly"
        @change="(key, value) => emit('change', key, value)"
        @status="setStatus"
      />
      <EnergyRulesConfigForm
        v-else-if="props.node && props.operator?.code === 'energy_rules'"
        :key="`energy:${props.node.id}`"
        :fields="props.fields"
        :schema="props.operator.config_schema"
        :config="props.node.config"
        :options="props.options"
        :is-readonly="props.isReadonly"
        @change="(key, value) => emit('change', key, value)"
        @status="setStatus"
      />
      <ConfigForm
        v-else-if="props.node && props.fields.length > 0"
        :key="`generic:${props.node.id}`"
        class="dt-ml-dialog-form"
        :fields="props.fields"
        :config="props.node.config"
        :options="props.options"
        :is-readonly="props.isReadonly"
        @change="(key, value) => emit('change', key, value)"
        @status="setStatus"
        @reload-tables="emit('reloadTables')"
      />
      <DtNotice v-else-if="props.node">
        {{
          props.operator
            ? '此算子无需额外参数，连接上游数据后即可使用。'
            : '当前系统没有此算子，请检查导入流水线所需的算子版本。'
        }}
      </DtNotice>
    </div>
    <template #footer>
      <ConfigDialogFooter
        :state="feedback"
        :is-readonly="props.isReadonly"
        @close="emit('close')"
      />
    </template>
  </DtModal>
</template>

<style scoped lang="scss">
.dt-ml-dialog-form.dt-ml-form {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr));
  align-items: start;
  gap: 16px;

  :deep(.dt-ml-form__row) {
    min-width: 0;
  }

  :deep(
    .dt-ml-form__row:not([data-widget='number']):not(
        [data-widget='integer']
      ):not([data-widget='select'])
  ) {
    grid-column: 1 / -1;
  }
}
</style>
