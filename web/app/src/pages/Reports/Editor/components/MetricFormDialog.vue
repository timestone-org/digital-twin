<script setup lang="ts">
/**
 * @fileoverview 添加或编辑一条报告指标的弹窗。
 * 表单不挂在指标列表里：指标多时列表末尾远在视口之外，点了编辑看不到表单。
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DtButton, DtInput, DtModal, DtNotice, DtSelect } from '@dt/ui'
import type {
  DatasetTableSummary,
  ReportBody,
  ReportMetric,
} from '@dt/contracts'
import { listDatasetColumns } from '@/api/dataset'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import {
  AGGREGATIONS,
  PERIODS,
  TEXT_MODES,
  metricFields,
} from '../scripts/metricModes'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 正在编辑的指标；null 为添加。 */
    metric: ReportMetric | null
    metrics: ReportMetric[]
    tables: DatasetTableSummary[]
    apiSources?: NonNullable<ReportBody['api_sources']>
  }>(),
  { apiSources: () => [] },
)
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  save: [value: ReportMetric[]]
}>()
const name = ref('')
const tableId = ref('')
const key = ref('')
const expression = ref('')
const mode = ref('window_agg')
const offset = ref('0')
const unit = ref('')
const columns = ref<{ key: string; name: string }[]>([])
const error = ref('')
const isLoading = ref(false)
const initial = ref('')
const raced = useRacedFetch()
let pendingKey = ''
const editing = computed(() => props.metric?.name ?? null)
const isApi = computed(() => tableId.value.startsWith('api:'))
const tableOptions = computed(() => [
  ...props.tables.map((table) => ({
    value: table.id,
    label: `台账 · ${table.name}`,
  })),
  ...props.apiSources.map((source) => ({
    value: `api:${source.code}`,
    label: `API · ${source.name}`,
  })),
])
const columnOptions = computed(() =>
  columns.value.map((column) => ({ value: column.key, label: column.name })),
)
const isTextApiField = computed(() => {
  const source = props.apiSources.find(
    (item) => `api:${item.code}` === tableId.value,
  )
  const type =
    source?.columns.find((column) => column.key === key.value)?.data_type ??
    'number'
  return type !== 'number'
})
const availableModes = computed(() =>
  isTextApiField.value
    ? AGGREGATIONS.filter((item) => TEXT_MODES.has(item.value))
    : AGGREGATIONS,
)
const snapshot = computed(() =>
  JSON.stringify([
    name.value,
    tableId.value,
    key.value,
    expression.value,
    mode.value,
    offset.value,
    unit.value,
  ]),
)
const isDirty = computed(
  () => props.modelValue && snapshot.value !== initial.value,
)
watch(isTextApiField, (text) => {
  if (text && !TEXT_MODES.has(mode.value)) mode.value = 'latest'
})
watch(tableId, (id) => {
  key.value = ''
  columns.value = []
  error.value = ''
  if (!id) {
    raced.cancel()
    isLoading.value = false
    return
  }
  if (id.startsWith('api:')) {
    raced.cancel()
    columns.value =
      props.apiSources.find((source) => `api:${source.code}` === id)?.columns ??
      []
    takePendingKey()
    isLoading.value = false
    return
  }
  isLoading.value = true
  void raced.run(() => listDatasetColumns(id), {
    ok: (items) => {
      columns.value = items
      takePendingKey()
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => {
      isLoading.value = false
    },
  })
})
watch(
  () => props.modelValue,
  (open) => {
    if (open) load(props.metric)
  },
  { immediate: true },
)
onBeforeUnmount(() => raced.cancel())
/** 换来源会清空字段；打开编辑时的那次换来源要把原字段放回去。 */
function takePendingKey(): void {
  const restoring = pendingKey !== ''
  key.value = pendingKey
  pendingKey = ''
  if (restoring) initial.value = snapshot.value
}
function existingSource(metric: ReportMetric): string {
  if (metric.table?.startsWith('api:')) return metric.table
  return props.tables.find((table) => table.code === metric.table)?.id ?? ''
}
/**
 * 每次打开都把全部字段写一遍，上一次编辑的来源与方式不会带进下一条。
 * @param metric 要编辑的指标；null 为空白表单
 */
function load(metric: ReportMetric | null): void {
  const fields = metricFields(metric)
  error.value = ''
  name.value = fields.name
  expression.value = fields.expression
  mode.value = fields.mode
  offset.value = fields.offset
  unit.value = fields.unit
  const next = metric ? existingSource(metric) : ''
  pendingKey = fields.key
  if (tableId.value === next) takePendingKey()
  tableId.value = next
  initial.value = snapshot.value
}
function save(): void {
  const table = props.tables.find((item) => item.id === tableId.value)
  error.value = nameError() || bindingError(table)
  if (error.value) return
  const metric = metricDraft(table)
  emit(
    'save',
    editing.value
      ? props.metrics.map((item) =>
          item.name === editing.value ? metric : item,
        )
      : [...props.metrics, metric],
  )
  emit('update:modelValue', false)
}
function nameError(): string {
  if (
    !name.value.trim() ||
    props.metrics.some(
      (item) => item.name === name.value.trim() && item.name !== editing.value,
    )
  )
    return '请输入不重复的指标名称'
  return ''
}
function bindingError(table: DatasetTableSummary | undefined): string {
  if (mode.value === 'expr')
    return expression.value.trim() ? '' : '请输入指标表达式'
  if (!table && !isApi.value) return '请选择数据来源及有效字段'
  if (!columns.value.some((column) => column.key === key.value))
    return '请选择数据来源及有效字段'
  if (
    !isApi.value &&
    (!/^-?\d+$/.test(offset.value) || Math.abs(Number(offset.value)) > 120)
  )
    return '报告期偏移必须为 -120 到 120 的整数'
  return ''
}
function aggregation(): NonNullable<ReportMetric['agg']> {
  switch (mode.value) {
    case 'sum':
      return 'sum'
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'count':
      return 'count'
    case 'delta':
      return 'delta'
    case 'first':
      return 'first'
    case 'last':
      return 'last'
    default:
      return 'avg'
  }
}
function selectedMode(): NonNullable<ReportMetric['mode']> {
  if (mode.value === 'expr') return 'expr'
  if (mode.value === 'at_bucket') return 'at_bucket'
  return mode.value === 'latest' ? 'latest' : 'window_agg'
}
function metricDraft(table: DatasetTableSummary | undefined): ReportMetric {
  const expressionMode = mode.value === 'expr'
  return {
    ...props.metric,
    name: name.value.trim(),
    table: expressionMode
      ? null
      : isApi.value
        ? tableId.value
        : (table?.code ?? null),
    key: expressionMode ? null : key.value,
    mode: selectedMode(),
    agg: aggregation(),
    offset: isApi.value ? 0 : Number(offset.value),
    expr: expressionMode ? expression.value : null,
    unit: unit.value || null,
    ...(isApi.value ? { window: null, anchor: 'period' } : {}),
  }
}
</script>
<template>
  <DtModal
    width="32rem"
    :model-value="modelValue"
    :title="editing ? `编辑指标 · ${editing}` : '添加指标'"
    :dirty="isDirty"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3">
      <DtInput
        v-model="name"
        label="指标名称"
        size="sm"
        :disabled="editing !== null"
        :hint="
          editing
            ? '名称用于正文和公式引用，编辑时保留名称'
            : '例如 本期用电量、上期用电量'
        "
      />
      <DtSelect
        v-model="mode"
        label="取数方式"
        size="sm"
        :options="availableModes"
      />
      <template v-if="mode !== 'expr'">
        <DtSelect
          v-model="tableId"
          label="数据来源"
          size="sm"
          :options="tableOptions"
        />
        <DtSelect
          v-model="key"
          label="数据字段"
          size="sm"
          :options="columnOptions"
          :disabled="isLoading || !tableId"
        />
        <DtNotice v-if="isApi" intent="info">
          报告期由 API 数据源配置；本指标使用该次响应中的数据。
        </DtNotice>
        <template v-else>
          <DtSelect
            v-model="offset"
            label="常用报告期"
            size="sm"
            :options="PERIODS"
          />
          <DtInput
            v-model="offset"
            label="报告期偏移"
            size="sm"
            hint="0 为本期，-1 为上期；也可填写其他整数"
          />
        </template>
      </template>
      <DtInput
        v-else
        v-model="expression"
        label="指标表达式"
        size="sm"
        placeholder="({本期}-{上期})/{上期}*100"
      />
      <DtInput
        v-model="unit"
        label="单位（可选）"
        size="sm"
        placeholder="例如 kWh、%、万元"
      />
      <DtNotice v-if="error" intent="danger">
        {{ error }}
      </DtNotice>
    </div>
    <template #footer>
      <DtButton
        size="sm"
        variant="ghost"
        @click="emit('update:modelValue', false)"
      >
        {{ editing ? '取消编辑' : '取消' }}
      </DtButton>
      <DtButton size="sm" icon="check" :disabled="isLoading" @click="save">
        {{ editing ? '保存指标修改' : '确认添加' }}
      </DtButton>
    </template>
  </DtModal>
</template>
