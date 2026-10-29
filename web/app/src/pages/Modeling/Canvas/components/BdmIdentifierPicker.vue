<script setup lang="ts">
/** @fileoverview 从 BDM 分页目录选择取数标识，并保留手填与跨页选择。 */
import type { ModelingBdmCatalogItem } from '@dt/contracts'
import {
  DtButton,
  DtCheckbox,
  DtField,
  DtInput,
  DtNotice,
  DtPagination,
  DtSelect,
  DtTag,
} from '@dt/ui'
import { computed, ref, watch } from 'vue'

import type { ConfigStatus } from '../scripts/configValues'
import type { FormField } from '../scripts/schemaForm'
import { useBdmCatalog } from '../scripts/useBdmCatalog'
import { useBdmSelection } from '../scripts/useBdmSelection'
import ArrayConfigInput from './ArrayConfigInput.vue'
import BdmIndicatorPicker from './BdmIndicatorPicker.vue'

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
  searchBy,
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
const searchLabel = computed(() =>
  kind.value === 'point'
    ? ({ code: '完整点位编码', keyword: '点位关键词' }[searchBy.value] ??
      '点位名称')
    : kind.value === 'raw'
      ? '属性名称'
      : '公式名称',
)
const searchModes = [
  { value: 'name', label: '按名称' },
  { value: 'keyword', label: '按关键词（编码／名称／表描述）' },
  { value: 'code', label: '按完整编码' },
]
const selection = useBdmSelection(
  () => kind.value,
  () => items.value,
  () => props.modelValue,
)
const { selected } = selection
const isIndicatorOpen = ref(false)
watch(kind, () => {
  isIndicatorOpen.value = false
})
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
  if (props.isReadonly) return
  emit(
    'update:modelValue',
    values.filter((value): value is string => typeof value === 'string'),
  )
}

function addProperty(item: ModelingBdmCatalogItem): void {
  if (
    props.isReadonly ||
    props.modelValue.includes(item.identifier) ||
    props.modelValue.length >= limit.value
  )
    return
  selection.remember(item)
  emit('update:modelValue', [...props.modelValue, item.identifier])
}
</script>

<template>
  <div class="dt-bdm-picker">
    <DtSelect
      v-if="kind === 'point'"
      v-model="searchBy"
      label="查找方式"
      :options="searchModes"
      :disabled="props.isReadonly"
    />
    <div class="dt-bdm-picker__search">
      <DtInput
        v-model="name"
        :label="searchLabel"
        :placeholder="
          searchBy === 'code'
            ? '填写完整编码，精确匹配'
            : '输入名称或关键词片段'
        "
        :maxlength="searchBy === 'code' ? 200 : 100"
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
      <span> 正在读取系统分类… </span>
    </DtNotice>
    <DtNotice v-if="systemsError" intent="warning">
      <span> 系统分类读取失败：{{ systemsError }} </span>
    </DtNotice>
    <DtButton v-if="systemsError" variant="ghost" @click="catalog.loadSystems">
      <span> 重试系统分类 </span>
    </DtButton>
    <DtNotice v-if="error" intent="danger">
      {{ error }}
    </DtNotice>
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
            <span>
              {{ item.name }}
            </span>
            <span class="dt-bdm-picker__code">
              {{ item.code }}
            </span>
            <span v-if="item.details" class="dt-bdm-picker__note">
              {{ item.details }}
            </span>
            <span v-if="item.note" class="dt-bdm-picker__note">
              {{ item.note }}
            </span>
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
    <section class="dt-bdm-picker__selected" aria-label="已选数据">
      <div class="dt-bdm-picker__heading">
        <strong> 已选数据 </strong>
        <DtTag
          :intent="props.modelValue.length === limit ? 'warning' : 'neutral'"
        >
          {{ props.modelValue.length }} / {{ limit }}
        </DtTag>
        <DtButton
          v-if="props.modelValue.length"
          variant="ghost"
          :disabled="props.isReadonly"
          @click="emit('update:modelValue', [])"
        >
          清空选择
        </DtButton>
      </div>
      <p v-if="!selected.length" class="dt-bdm-picker__note">
        从目录勾选数据，每项会成为下游的一列。
      </p>
      <ul v-else class="dt-bdm-picker__selected-list">
        <li v-for="item in selected" :key="item.identifier">
          <div>
            <strong>
              {{ item.name }}
            </strong>
            <span class="dt-bdm-picker__note">
              {{ item.identifier }}{{ item.unit ? ` · ${item.unit}` : ''
              }}{{ item.hasName ? '' : ' · 尚未加载目录名称' }}
            </span>
          </div>
          <DtButton
            variant="ghost"
            icon="close"
            :aria-label="`移除 ${item.name}`"
            :disabled="props.isReadonly"
            @click="toggle(item.identifier, false)"
          />
        </li>
      </ul>
    </section>
    <DtButton
      v-if="kind === 'raw'"
      variant="ghost"
      :aria-expanded="isIndicatorOpen"
      @click="isIndicatorOpen = !isIndicatorOpen"
    >
      {{ isIndicatorOpen ? '收起指标绑定' : '从指标绑定选择属性' }}
    </DtButton>
    <BdmIndicatorPicker
      v-if="kind === 'raw' && isIndicatorOpen"
      :selected="props.modelValue"
      :is-readonly="props.isReadonly"
      @select="addProperty"
    />
    <details class="dt-bdm-picker__manual">
      <summary>高级：手动填写标识</summary>
      <ArrayConfigInput
        :field="manualField"
        :model-value="props.modelValue"
        :is-readonly="props.isReadonly"
        @update:model-value="input"
        @status="emit('status', $event)"
      />
    </details>
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
.dt-bdm-picker__heading {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.dt-bdm-picker__selected {
  padding: 0.75rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-sunken);
}
.dt-bdm-picker__selected-list {
  display: grid;
  gap: 0.5rem;
  max-height: 12rem;
  overflow: auto;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
  li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  li > div {
    display: grid;
    min-width: 0;
    overflow-wrap: anywhere;
  }
}
.dt-bdm-picker__manual {
  summary {
    cursor: pointer;
    color: var(--text-secondary);
    padding-block: 0.5rem;
  }
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
