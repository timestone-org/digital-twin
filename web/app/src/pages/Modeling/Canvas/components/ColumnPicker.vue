<script setup lang="ts">
/**
 * @fileoverview 列选择器：从上游帧的列里勾几列。
 *
 * ⚠ 勾中的顺序**跟着台账的列序**，不按点击先后：按点击顺序存的话，同一份选择
 * 在两个人手里会存出两份不同的图，比对流水线时满屏都是无意义的差异。
 * ⚠ 列不出候选时要说清是**哪一种**空：还没选台账、台账真没有列、还是上游取数
 * 把列挑窄了。
 * ⚠ 勾着却已经不在候选里的列要**单独列出来**，不能直接不画：上游取数改窄之后
 * 那几列会从选择器里消失，而保存与运行仍被后端拦下——用户看得见的只有一句
 * 报错，界面上却找不到该动哪里。
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
const known = computed(() => new Set(props.columns.map((item) => item.key)))
/** 勾着、但上游已经不产出的那些列。 */
const strays = computed(() =>
  props.modelValue.filter((key) => !known.value.has(key)),
)
const matched = computed(() => {
  const needle = keyword.value.trim().toLowerCase()
  if (needle === '') return props.columns
  return props.columns.filter(
    (item) =>
      item.name.toLowerCase().includes(needle) ||
      item.key.toLowerCase().includes(needle),
  )
})

/** 按台账列序重排一份选择；候选之外的那几列排在最后，直到被显式取消。 */
function ordered(keys: ReadonlySet<string>): string[] {
  const inOrder = props.columns
    .filter((item) => keys.has(item.key))
    .map((item) => item.key)
  return [...inOrder, ...strays.value.filter((key) => keys.has(key))]
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

/** 只丢掉上游没有的那几列，已勾的正常列原样留着。 */
function dropStrays(): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((key) => known.value.has(key)),
  )
}
</script>

<template>
  <DtField :label="props.label" :hint="props.hint">
    <p
      v-if="props.columns.length === 0 && strays.length === 0"
      class="dt-ml-cols__note"
    >
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
        <button
          v-if="strays.length > 0"
          type="button"
          class="dt-ml-cols__act dt-ml-cols__act--warn"
          :disabled="props.isReadonly"
          @click="dropStrays"
        >
          清掉上游没有的 {{ strays.length }} 列
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
        <DtCheckbox
          v-for="key in strays"
          :key="key"
          class="dt-ml-cols__stray"
          :model-value="true"
          :label="`${key}（上游没有这一列）`"
          :disabled="props.isReadonly"
          @update:model-value="toggle(key, $event)"
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
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
    margin-bottom: 0.25rem;
  }

  &__act {
    height: var(--ctl-h-sm);
    padding: 0 0.5rem;
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

    &--warn {
      border-color: var(--state-warning);
      color: var(--state-warning);
    }
  }

  &__list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    max-height: 12rem;
    overflow-y: auto;
  }

  &__stray {
    color: var(--state-warning);
  }

  &__note {
    margin: 0.25rem 0 0;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-sm);
  }
}
</style>
