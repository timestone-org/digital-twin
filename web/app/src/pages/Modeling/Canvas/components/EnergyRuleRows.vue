<script setup lang="ts">
/** @fileoverview 可视编辑分类计量和能源流向；完整有效的行自动写回配置。 */
import { DtButton, DtNotice } from '@dt/ui'
import { computed, ref, watch } from 'vue'
import EnergyRuleRow from './EnergyRuleRow.vue'

import type { ConfigStatus } from '../scripts/configValues'
import type { EnergyRow, EnergyRowsMode } from '../scripts/energyRuleRows'
import {
  defaultEnergyRows,
  energyPayload,
  energyRowOf,
  energyRowsError,
} from '../scripts/energyRuleRows'

const props = defineProps<{
  mode: EnergyRowsMode
  modelValue: unknown
  columns: readonly { key: string; name: string }[]
  isReadonly: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: Record<string, string>[]]
  status: [value: ConfigStatus]
}>()
let nextId = 0
const rows = ref<EnergyRow[]>([])
const isDefault = computed(
  () => !Array.isArray(props.modelValue) || props.modelValue.length === 0,
)
function load(value: unknown): void {
  const values: readonly unknown[] =
    Array.isArray(value) && value.length > 0
      ? value
      : defaultEnergyRows(props.mode)
  if (
    JSON.stringify(energyPayload(rows.value, props.mode)) ===
    JSON.stringify(values)
  )
    return
  rows.value = values.map((item) =>
    energyRowOf(item, `energy-row-${++nextId}`, props.mode),
  )
}
watch(
  () => JSON.stringify(props.modelValue),
  () => load(props.modelValue),
  { immediate: true },
)
const error = computed(() => energyRowsError(rows.value, props.mode))
const hasDraft = computed(() => {
  const value =
    Array.isArray(props.modelValue) && props.modelValue.length > 0
      ? props.modelValue
      : defaultEnergyRows(props.mode)
  return (
    JSON.stringify(energyPayload(rows.value, props.mode)) !==
    JSON.stringify(value)
  )
})
watch(
  [error, hasDraft],
  () =>
    emit(
      'status',
      props.isReadonly
        ? { message: '', hasDraft: false }
        : {
            message: error.value,
            hasDraft: hasDraft.value && error.value !== '',
          },
    ),
  { immediate: true },
)
function publish(): void {
  if (!props.isReadonly && !error.value)
    emit('update:modelValue', energyPayload(rows.value, props.mode))
}
function change(id: string, key: keyof EnergyRow, value: string): void {
  if (props.isReadonly) return
  rows.value = rows.value.map((row) =>
    row.id === id ? { ...row, [key]: value } : row,
  )
  publish()
}
function add(): void {
  if (props.isReadonly || rows.value.length >= 32) return
  rows.value = [
    ...rows.value,
    energyRowOf({}, `energy-row-${++nextId}`, props.mode),
  ]
}
function remove(id: string): void {
  if (props.isReadonly) return
  rows.value = rows.value.filter((row) => row.id !== id)
  if (rows.value.length === 0) reset()
  else publish()
}
function reset(): void {
  if (props.isReadonly) return
  rows.value = defaultEnergyRows(props.mode).map((item) =>
    energyRowOf(item, `energy-row-${++nextId}`, props.mode),
  )
  emit('update:modelValue', [])
}
</script>

<template>
  <div class="energy-rows">
    <p class="energy-rows__hint">
      {{
        props.mode === 'meters'
          ? '每列只归集一次；单位与折标系数应由业务确认。'
          : '每行代表一条有向能流；计量值是来源端同期间能量，效率用 0～1 的数表示。'
      }}
      {{
        isDefault
          ? '当前显示系统默认配置，修改后自动使用自定义配置。'
          : '完整有效的行会自动更新到画布草稿。'
      }}
    </p>
    <EnergyRuleRow
      v-for="(row, index) in rows"
      :key="row.id"
      :row="row"
      :mode="props.mode"
      :number="index + 1"
      :columns="props.columns"
      :is-readonly="props.isReadonly"
      @change="change"
      @remove="remove(row.id)"
    />
    <DtNotice v-if="error" intent="warning"
      >{{ error }}；修正后会自动应用，未完成的行不会覆盖原配置。</DtNotice
    >
    <div v-if="!props.isReadonly" class="energy-rows__actions">
      <DtButton
        variant="outline"
        size="sm"
        :disabled="rows.length >= 32"
        @click="add"
        >{{ props.mode === 'meters' ? '添加计量' : '添加流向' }}</DtButton
      >
      <DtButton variant="ghost" size="sm" @click="reset"
        >恢复默认{{ props.mode === 'meters' ? '计量' : '流向' }}</DtButton
      >
      <span>{{ rows.length }} / 32 行</span>
    </div>
    <p v-if="props.columns.length === 0" class="energy-rows__hint">
      先在上游配置数据源并连接此算子，便可选择现场计量列。
    </p>
  </div>
</template>

<style scoped lang="scss">
.energy-rows {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  &__hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
    line-height: 1.6;
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    font-size: var(--font-size-compact);
  }
}
</style>
