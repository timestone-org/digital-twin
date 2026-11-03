<script setup lang="ts">
/** @fileoverview 单个分类计量项或能源流向的字段与删除操作。 */
import { DtButton, DtInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'
import type { EnergyRow, EnergyRowsMode } from '../scripts/energyRuleRows'
const props = defineProps<{
  row: EnergyRow
  mode: EnergyRowsMode
  number: number
  columns: readonly { key: string; name: string }[]
  isReadonly: boolean
}>()
const emit = defineEmits<{
  change: [id: string, key: keyof EnergyRow, value: string]
  remove: []
}>()
const columnOptions = computed(() => {
  const options = props.columns.map((column) => ({
    value: column.key,
    label: column.name || column.key,
  }))
  const current = props.row.column
  if (current && !options.some((item) => item.value === current))
    options.unshift({ value: current, label: `${current}（上游暂无此列）` })
  return options
})
</script>
<template>
  <article class="energy-rows__item">
    <header>
      <strong
        >{{ props.mode === 'meters' ? '计量项' : '流向' }}
        {{ props.number }}</strong
      >
      <DtButton
        v-if="!props.isReadonly"
        variant="ghost"
        size="xs"
        :aria-label="`删除第 ${props.number} 行`"
        @click="emit('remove')"
        >删除</DtButton
      >
    </header>
    <div class="energy-rows__grid">
      <DtInput
        v-if="props.mode === 'meters'"
        :model-value="props.row.category"
        label="归集类别"
        placeholder="如：生产"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', props.row.id, 'category', $event)"
      />
      <template v-else>
        <DtInput
          :model-value="props.row.source"
          label="来源节点"
          placeholder="如：进线"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', props.row.id, 'source', $event)"
        />
        <DtInput
          :model-value="props.row.target"
          label="去向节点"
          placeholder="如：配电中心"
          :disabled="props.isReadonly"
          @update:model-value="emit('change', props.row.id, 'target', $event)"
        />
      </template>
      <DtSelect
        :model-value="props.row.column"
        :options="columnOptions"
        :display="{ searchable: true, placeholder: '选择计量列' }"
        label="计量列"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', props.row.id, 'column', $event)"
      />
      <DtInput
        :model-value="props.row.unit"
        label="计量单位"
        placeholder="如：kWh"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', props.row.id, 'unit', $event)"
      />
      <DtInput
        :model-value="props.row.decimal"
        :label="
          props.mode === 'meters'
            ? '折标系数（kgce/计量单位）'
            : '传输效率（0～1）'
        "
        inputmode="decimal"
        :disabled="props.isReadonly"
        @update:model-value="emit('change', props.row.id, 'decimal', $event)"
      />
    </div>
  </article>
</template>
<style scoped lang="scss">
.energy-rows {
  &__item {
    padding: 0.75rem;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    min-width: 0;
  }
  &__item header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    color: var(--text-primary);
    font-size: var(--font-size-compact);
  }
  &__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
    align-items: start;
    gap: 0.75rem;
  }
}
</style>
