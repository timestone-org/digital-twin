<script setup lang="ts">
/** @fileoverview 图表与表格的数据来源、字段与序列，台账和第三方 API 同一套选法。 */
import { computed, watch } from 'vue'
import { DtButton, DtCheckbox, DtIconButton, DtInput, DtSelect } from '@dt/ui'
import {
  PERIOD_OFFSETS,
  X_AXES,
  isApiSource,
  type NodeForm,
  type SeriesRow,
} from '../scripts/nodeForm'
import type { SourceColumn, SourceOption } from '../scripts/useReportSources'
const props = defineProps<{
  form: NodeForm
  sources: SourceOption[]
  columnsOf: (source: string) => SourceColumn[]
  labelOf: (source: string) => string
  makeId: () => string
}>()
const emit = defineEmits<{
  patch: [value: Partial<NodeForm>]
  need: [source: string]
}>()
const isTable = computed(() => props.form.kind === 'dsTable')
const columns = computed(() => props.columnsOf(props.form.source))
const numberOptions = computed(() =>
  columns.value
    .filter((column) => column.dataType === 'number')
    .map((column) => ({ value: column.key, label: column.name })),
)
const categoryOptions = computed(() =>
  columns.value.map((column) => ({ value: column.key, label: column.name })),
)
const isApi = computed(() => isApiSource(props.form.source))
const mixed = computed(
  () => new Set(props.form.series.map((row) => row.table)).size > 1,
)
// 目录晚于弹窗到达时也要补拉列清单，故把来源数量一起盯住。
watch(
  () => [
    props.sources.length,
    props.form.source,
    ...props.form.series.map((row) => row.table),
  ],
  () => {
    const wanted = [
      props.form.source,
      ...props.form.series.map((row) => row.table),
    ]
    for (const source of new Set(wanted)) if (source) emit('need', source)
  },
  { immediate: true },
)
function changeSource(source: string): void {
  const first = props
    .columnsOf(source)
    .find((column) => column.dataType === 'number')
  emit('patch', {
    source,
    keys: [],
    categoryKey: '',
    series: first ? [row(source, first.key)] : [],
  })
}
function row(table: string, key: string, offset = 0): SeriesRow {
  return { id: props.makeId(), table, key, name: '', offset }
}
function toggleKey(key: string, checked: boolean): void {
  emit('patch', {
    keys: checked
      ? [...props.form.keys, key]
      : props.form.keys.filter((item) => item !== key),
  })
}
function updateRow(id: string, patch: Partial<SeriesRow>): void {
  emit('patch', {
    series: props.form.series.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    ),
  })
}
function addRow(): void {
  const used = new Set(props.form.series.map((item) => item.key))
  const next =
    numberOptions.value.find((option) => !used.has(option.value)) ??
    numberOptions.value[0]
  emit('patch', {
    series: [...props.form.series, row(props.form.source, next?.value ?? '')],
  })
}
function rowOptions(item: SeriesRow) {
  return props
    .columnsOf(item.table)
    .filter((column) => column.dataType === 'number')
    .map((column) => ({ value: column.key, label: column.name }))
}
function changeAxis(value: string): void {
  const axis = X_AXES.find((option) => option.value === value)?.value
  if (axis) emit('patch', { xAxis: axis })
}
function periodOptions(item: SeriesRow) {
  const value = String(item.offset)
  return PERIOD_OFFSETS.some((option) => option.value === value)
    ? PERIOD_OFFSETS
    : [...PERIOD_OFFSETS, { value, label: `偏移 ${value} 期` }]
}
watch(numberOptions, (options) => {
  const first = options[0]
  if (isTable.value || props.form.series.length || !first) return
  emit('patch', { series: [row(props.form.source, first.value)] })
})
function removeRow(id: string): void {
  emit('patch', { series: props.form.series.filter((item) => item.id !== id) })
}
</script>
<template>
  <DtSelect
    :model-value="props.form.source"
    class="dt-form-grid__wide"
    label="数据来源"
    size="sm"
    :options="props.sources"
    hint="台账与「第三方 API 数据」里配置的接口都可以直接选用"
    @update:model-value="changeSource"
  />
  <template v-if="props.form.source">
    <div v-if="isTable" class="dt-form-grid__wide flex flex-col gap-2">
      <p class="text-sm text-secondary">要显示的列（按勾选顺序排列）</p>
      <div class="flex flex-wrap gap-x-4 gap-y-1">
        <DtCheckbox
          v-for="column in columns"
          :key="column.key"
          :model-value="props.form.keys.includes(column.key)"
          :label="column.name"
          @update:model-value="toggleKey(column.key, $event)"
        />
      </div>
    </div>
    <template v-else>
      <DtSelect
        :model-value="props.form.xAxis"
        label="横轴"
        size="sm"
        :options="X_AXES"
        :hint="
          isApi
            ? '列表型接口（每一项一个数）请选「按数据字段」'
            : '趋势用「按时间」，对比用「按数据字段」'
        "
        @update:model-value="changeAxis"
      />
      <DtSelect
        v-if="props.form.xAxis === 'category'"
        :model-value="props.form.categoryKey"
        label="分类字段"
        size="sm"
        :options="categoryOptions"
        hint="同一分类的多行按下方「聚合」合并"
        @update:model-value="emit('patch', { categoryKey: $event })"
      />
      <div class="dt-form-grid__wide flex flex-col gap-2">
        <p class="text-sm text-secondary">
          {{
            props.form.xAxis === 'field'
              ? '数据项（每项是图上的一根柱/一块扇区）'
              : '数据序列（每条是一根线/一组柱）'
          }}
        </p>
        <div
          v-for="item in props.form.series"
          :key="item.id"
          class="flex flex-wrap items-end gap-2"
        >
          <DtSelect
            class="min-w-40 flex-1"
            :model-value="item.key"
            :label="mixed ? props.labelOf(item.table) : '字段'"
            size="sm"
            :options="rowOptions(item)"
            @update:model-value="updateRow(item.id, { key: $event })"
          />
          <DtInput
            class="w-32"
            :model-value="item.name"
            label="显示名称"
            size="sm"
            placeholder="缺省用字段名"
            @update:model-value="updateRow(item.id, { name: $event })"
          />
          <DtSelect
            v-if="!isApiSource(item.table)"
            class="w-36"
            :model-value="String(item.offset)"
            label="报告期"
            size="sm"
            :options="periodOptions(item)"
            @update:model-value="updateRow(item.id, { offset: Number($event) })"
          />
          <DtIconButton
            icon="trash"
            label="移除这一项"
            :disabled="props.form.series.length <= 1"
            @click="removeRow(item.id)"
          />
        </div>
        <DtButton
          size="sm"
          variant="outline"
          icon="plus"
          :disabled="!numberOptions.length"
          @click="addRow"
        >
          添加{{ props.form.xAxis === 'field' ? '数据项' : '序列' }}
        </DtButton>
        <p v-if="!numberOptions.length" class="text-sm text-secondary">
          该来源没有数值字段；图表只能使用数值字段。
        </p>
      </div>
    </template>
  </template>
</template>
