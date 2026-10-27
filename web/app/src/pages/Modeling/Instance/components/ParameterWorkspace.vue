<script setup lang="ts">
/** @fileoverview 按算子节点组织完整参数表单。 */
import type {
  ModelingConfiguration,
  ModelingParameterNode,
} from '@dt/contracts'
import { DtButton } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import { parameterFields } from '../scripts/parameters'
import ParameterField from './ParameterField.vue'
const props = defineProps<{
  nodes: ModelingParameterNode[]
  configuration: ModelingConfiguration | null
  disabled: boolean
}>()
const emit = defineEmits<{
  change: [node: string, key: string, value: unknown]
  error: [key: string, message: string]
}>()
const selected = ref('')
const fields = computed(() =>
  props.nodes.map((node) => ({
    ...node,
    fields: parameterFields(node.operator.config_schema),
  })),
)
watch(
  fields,
  (nodes) => {
    if (!nodes.some((node) => node.id === selected.value))
      selected.value = nodes[0]?.id ?? ''
  },
  { immediate: true },
)
</script>
<template>
  <div class="parameter-workspace">
    <nav class="parameter-nodes" aria-label="模型参数节点">
      <DtButton
        v-for="node in fields"
        :key="node.id"
        variant="ghost"
        :pressed="selected === node.id"
        @click="selected = node.id"
      >
        {{ node.alias || node.operator.name }}
      </DtButton>
    </nav>

    <div class="parameter-editors">
      <div
        v-for="node in fields"
        v-show="selected === node.id"
        :key="node.id"
        class="parameter-panel"
      >
        <h3>
          {{ node.alias || node.operator.name }}
        </h3>

        <p>
          {{ node.operator.description }}
        </p>

        <div class="dt-form-grid">
          <ParameterField
            v-for="field in node.fields"
            :key="field.key"
            :class="{ 'dt-form-grid__wide': field.kind === 'json' }"
            :field="field"
            :value="configuration?.nodes[node.id]?.[field.key]"
            :disabled="disabled || !configuration"
            @change="emit('change', node.id, field.key, $event)"
            @error="emit('error', `${node.id}.${field.key}`, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>
<style scoped lang="scss">
.parameter-workspace {
  display: grid;
  grid-template-columns: 13rem minmax(0, 1fr);
  gap: 1.25rem;
}
.parameter-nodes {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.35rem;
}
.parameter-panel {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}
.parameter-panel h3 {
  font-weight: 600;
}
.parameter-panel > p {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}
@media (max-width: 900px) {
  .parameter-workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .parameter-nodes {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
