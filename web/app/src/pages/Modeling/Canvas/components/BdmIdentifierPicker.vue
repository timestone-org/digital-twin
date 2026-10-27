<script setup lang="ts">
/** @fileoverview 从 BDM 分页目录选择取数标识，并保留手填与跨页选择。 */
import {
  DtButton,
  DtCheckbox,
  DtField,
  DtInput,
  DtNotice,
  DtPagination,
  DtSelect,
} from '@dt/ui'
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
const {
  page,
  name,
  system,
  items,
  total,
  hasResult,
  isLoading,
  error,
  systemCapability,
  systemOptions,
  systemsError,
  systemsLoading,
} = catalog
const searchLabel = computed(
  () =>
    ({ point: '点位名称', raw: '属性名称', formula: '公式名称' })[kind.value],
)
const limit = computed(() => (kind.value === 'formula' ? 8 : 10))
const manualField = computed<FormField>(() => ({
  ...props.field,
  widget: 'text-list',
  label: `已选标识（${props.modelValue.length} / ${limit.value}）`,
  hint: '目录勾选后自动填入，也可粘贴真实标识；同名记录请核对编码或标识',
  maxItems: limit.value,
}))
const choices = computed(() =>
  items.value.map((item) => ({
    ...item,
    label: `${item.name}（${item.code}）`,
    note: item.history_available === false ? '无可查询的历史字段' : '',
    details: [item.system, item.table_type, item.unit]
      .filter(Boolean)
      .join(' · '),
    checked: props.modelValue.includes(item.identifier),
    disabled:
      props.isReadonly ||
      (item.history_available === false &&
        !props.modelValue.includes(item.identifier)) ||
      (props.modelValue.length >= limit.value &&
        !props.modelValue.includes(item.identifier)),
  })),
)

function toggle(identifier: string, checked: boolean): void {
  if (props.isReadonly) return
  if (checked && props.modelValue.includes(identifier)) return
  if (checked && props.modelValue.length >= limit.value) return
  if (
    checked &&
    items.value.find((item) => item.identifier === identifier)
      ?.history_available === false
  )
    return
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
    <div class="dt-bdm-picker__search">
      <DtInput
        v-model="name"
        :label="searchLabel"
        placeholder="输入名称片段，最多 100 个字符"
        :maxlength="100"
        :disabled="props.isReadonly"
        @enter="catalog.search"
      >
        <template #actions>
          <DtButton
            :disabled="props.isReadonly || isLoading"
            @click="catalog.search"
          >
            查询
          </DtButton>
          <DtButton
            variant="ghost"
            :disabled="isLoading"
            @click="catalog.refresh"
          >
            刷新目录
          </DtButton>
        </template>
      </DtInput>
    </div>
    <DtSelect
      v-if="kind === 'point' && systemCapability === true"
      v-model="system"
      label="点位所属系统"
      :options="systemOptions"
      :disabled="props.isReadonly"
      hint="选择系统后点击查询，与名称条件同时生效"
    />
    <DtInput
      v-if="kind === 'raw'"
      v-model="system"
      label="属性所属系统"
      placeholder="全部系统，或填写完整系统名称"
      :maxlength="100"
      :disabled="props.isReadonly"
      hint="系统按完整名称匹配，填写后点击查询"
      @enter="catalog.search"
    />
    <DtNotice
      v-if="kind === 'point' && systemCapability === false"
      intent="neutral"
    >
      当前数据源不支持点位系统筛选，可按名称查找。
    </DtNotice>
    <DtNotice v-if="systemsLoading" intent="neutral">
      <span>正在读取系统分类…</span>
    </DtNotice>
    <DtNotice v-if="systemsError" intent="warning">
      <span>系统分类读取失败：{{ systemsError }}</span>
    </DtNotice>
    <DtButton v-if="systemsError" variant="ghost" @click="catalog.loadSystems">
      <span>重试系统分类</span>
    </DtButton>
    <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
    <DtButton
      v-if="error"
      variant="ghost"
      :disabled="isLoading"
      @click="catalog.load"
    >
      重试目录
    </DtButton>
    <p v-if="isLoading" role="status">正在读取目录…</p>
    <DtField
      v-else-if="hasResult"
      :label="`目录候选 · 共 ${total} 项`"
      hint="已选标识跨页保留，每项输出一列数据"
    >
      <div class="dt-bdm-picker__choices">
        <DtCheckbox
          v-for="item in choices"
          :key="item.identifier"
          :model-value="item.checked"
          :aria-label="item.label"
          :disabled="item.disabled"
          @update:model-value="toggle(item.identifier, $event)"
        >
          <span class="dt-bdm-picker__item">
            <span>{{ item.name }}</span>
            <span class="dt-bdm-picker__code">{{ item.code }}</span>
            <span v-if="item.details" class="dt-bdm-picker__note">{{
              item.details
            }}</span>
            <span v-if="item.note" class="dt-bdm-picker__note">{{
              item.note
            }}</span>
          </span>
        </DtCheckbox>
        <p v-if="choices.length === 0">没有匹配项，请调整名称或系统条件。</p>
      </div>
    </DtField>
    <DtPagination
      v-if="hasResult"
      v-model:page="page"
      :size="50"
      :size-options="[50]"
      :total="total"
      aria-label="能管目录分页"
    />
    <ArrayConfigInput
      :field="manualField"
      :model-value="props.modelValue"
      :is-readonly="props.isReadonly"
      @update:model-value="input"
      @status="emit('status', $event)"
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
  min-width: 0;
}
.dt-bdm-picker__choices {
  display: grid;
  gap: 0.5rem;
  max-height: 18rem;
  overflow: auto;
  overflow-wrap: anywhere;
}
.dt-bdm-picker__item {
  display: grid;
  gap: 0.25rem;
  min-width: 0;
  padding-block: 0.25rem;
}
.dt-bdm-picker__code {
  font-family: var(--font-mono);
  font-size: var(--font-size-caption);
  color: var(--text-secondary);
}
.dt-bdm-picker__note {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-size-caption);
}
</style>
