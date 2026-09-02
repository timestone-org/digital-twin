<script setup lang="ts">
/**
 * @fileoverview 列选择器：从上游台账的列里勾几列。
 *
 * ⚠ 勾中的顺序**跟着台账的列序**，不按点击先后：按点击顺序存的话，同一份选择
 * 在两个人手里会存出两份不同的图，比对流水线时满屏都是无意义的差异。
 * ⚠ 列不出候选时要说清是**哪一种**空：还没选台账、台账真没有列、还是权限不够。
 */
import { DtCheckbox, DtField, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

import type { LedgerColumn } from '../scripts/useLedgerOptions'

const props = defineProps<{
  modelValue: readonly string[]
  columns: readonly LedgerColumn[]
  label: string
  hint: string
  /** 没有候选时要显示的那句人话。 */
  note: string
  isReadonly: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

/** 超过这么多列才给搜索框——三五列时它只是多占一行。 */
const SEARCH_FROM = 8

const keyword = ref('')

const picked = computed(() => new Set(props.modelValue))
const matched = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return props.columns
  return props.columns.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.key.toLowerCase().includes(needle),
  )
})

/** 按台账列序重排一份选择。 */
function ordered(keys: ReadonlySet<string>): string[] {
  return props.columns.filter((item) => keys.has(item.key)).map((i) => i.key)
}

function toggle(key: string, isOn: boolean): void {
  const next = new Set(picked.value)
  if (isOn) next.add(key)
  else next.delete(key)
  emit('update:modelValue', ordered(next))
}

function pickAll(): void {
  emit(
    'update:modelValue',
    matched.value.map((item) => item.key),
  )
}
</script>

<template>
  <DtField :label="props.label" :hint="props.hint">
    <p v-if="props.columns.length === 0" class="dt-ml-cols__note">
      {{ props.note }}
    </p>
    <template v-else>
      <div class="dt-ml-cols__bar">
        <DtInput
          v-if="props.columns.length >= SEARCH_FROM"
          v-model="keyword"
          type="search"
          size="sm"
          placeholder="搜列名"
          aria-label="搜列名"
        />
        <button
          type="button"
          class="dt-ml-cols__act"
          :disabled="props.isReadonly"
          @click="pickAll"
        >
          全选
        </button>
        <button
          type="button"
          class="dt-ml-cols__act"
          :disabled="props.isReadonly"
          @click="emit('update:modelValue', [])"
        >
          清空
        </button>
      </div>
      <div class="dt-ml-cols__list">
        <DtCheckbox
          v-for="column in matched"
          :key="column.key"
          :model-value="picked.has(column.key)"
          :label="column.name || column.key"
          :disabled="props.isReadonly"
          @update:model-value="toggle(column.key, $event)"
        />
      </div>
      <p class="dt-ml-cols__note">
        已选 {{ props.modelValue.length }} 列，留空表示取全部列
      </p>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
.dt-ml-cols {
  &__bar {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  &__act {
    padding: 0.125rem 0.5rem;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-base);
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-sm);
    cursor: pointer;

    &:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
