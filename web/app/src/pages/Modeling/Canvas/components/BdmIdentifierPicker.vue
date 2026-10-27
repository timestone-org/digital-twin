<script setup lang="ts">
/** @fileoverview 从 BDM 分页目录选择取数标识，并保留手填与跨页选择。 */
import { DtButton, DtCheckbox, DtField, DtInput, DtPagination } from '@dt/ui'
import { computed } from 'vue'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField } from '../scripts/schemaForm'
import { useBdmCatalog } from '../scripts/useBdmCatalog'
import ArrayConfigInput from './ArrayConfigInput.vue'

const props = defineProps<{
  kind: unknown
  field: FormField
  modelValue: readonly string[]
  isReadonly: boolean
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string[]]
  status: [value: ConfigStatus]
}>()
const kind = computed(() =>
  props.kind === 'raw' || props.kind === 'formula' ? props.kind : 'point',
)
const catalog = useBdmCatalog(() => kind.value)
const { page, keyword, items, total, hasResult, isLoading, error, progress } =
  catalog
const loadingText = computed(() =>
  progress.value === null
    ? '正在读取目录…'
    : `正在读取目录（${progress.value.loaded} / ${progress.value.total}）…`,
)
const searchLabel = computed(
  () =>
    ({ point: '查找点位', raw: '查找属性', formula: '查找公式' })[kind.value],
)
const searchPlaceholder = computed(() =>
  kind.value === 'raw' ? '设备、属性名称或标识' : '名称或编码片段',
)
const limit = computed(() => (kind.value === 'formula' ? 8 : 10))
const manualField = computed<FormField>(() => ({
  ...props.field,
  widget: 'text-list',
  maxItems: limit.value,
}))
const choices = computed(() =>
  items.value.map((item) => ({
    ...item,
    label: `${item.name}（${item.code}）`,
    checked: props.modelValue.includes(item.identifier),
    disabled:
      props.isReadonly ||
      item.history_available === false ||
      (props.modelValue.length >= limit.value &&
        !props.modelValue.includes(item.identifier)),
  })),
)

function toggle(identifier: string, checked: boolean): void {
  if (props.isReadonly) return
  if (checked && props.modelValue.includes(identifier)) return
  if (checked && props.modelValue.length >= limit.value) return
  emit(
    'update:modelValue',
    checked
      ? [...props.modelValue, identifier]
      : props.modelValue.filter((item) => item !== identifier),
  )
}

function input(values: (string | number)[]): void {
  emit(
    'update:modelValue',
    values.filter((value): value is string => typeof value === 'string'),
  )
}
</script>

<template>
  <div class="dt-bdm-picker">
    <ArrayConfigInput
      :field="manualField"
      :model-value="props.modelValue"
      :is-readonly="props.isReadonly"
      @update:model-value="input"
      @status="emit('status', $event)"
    />
    <div class="dt-bdm-picker__search">
      <DtInput
        v-model="keyword"
        :label="searchLabel"
        :placeholder="searchPlaceholder"
        :disabled="props.isReadonly"
        @keydown.enter="catalog.search"
      />
      <DtButton
        :disabled="props.isReadonly || isLoading"
        @click="catalog.search"
      >
        查询
      </DtButton>
      <DtButton
        variant="ghost"
        :disabled="props.isReadonly || isLoading"
        @click="catalog.refresh"
      >
        刷新目录
      </DtButton>
    </div>
    <p v-if="kind !== 'point'" class="dt-bdm-picker__note">
      按完整目录搜索，选项跨页保留；点击“刷新目录”可重新读取。
    </p>
    <p v-if="error" role="alert" class="dt-bdm-picker__note">{{ error }}</p>
    <DtButton
      v-if="error"
      variant="ghost"
      :disabled="isLoading"
      @click="catalog.load"
    >
      重试目录
    </DtButton>
    <p v-if="isLoading" role="status">{{ loadingText }}</p>
    <DtField
      v-else-if="hasResult"
      label="目录候选"
      :hint="`已选 ${props.modelValue.length} / ${limit} 项`"
    >
      <div class="dt-bdm-picker__choices">
        <DtCheckbox
          v-for="item in choices"
          :key="item.identifier"
          :model-value="item.checked"
          :label="item.label"
          :disabled="item.disabled"
          @update:model-value="toggle(item.identifier, $event)"
        />
        <p v-if="choices.length === 0">本页没有可选项。</p>
      </div>
    </DtField>
    <DtPagination
      v-if="hasResult"
      v-model:page="page"
      :size="50"
      :size-options="[50]"
      :total="total"
      aria-label="BDM 目录分页"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-bdm-picker {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}
.dt-bdm-picker__search {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.5rem;
}
.dt-bdm-picker__choices {
  display: grid;
  gap: 0.5rem;
  max-height: 18rem;
  overflow: auto;
  overflow-wrap: anywhere;
}
.dt-bdm-picker__note {
  margin: 0;
  color: var(--text-secondary);
}
</style>
