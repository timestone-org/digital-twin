<script setup lang="ts">
/** @fileoverview 报告指标的来源、聚合与可编辑配置。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DtButton,
  DtCard,
  DtInput,
  DtNotice,
  DtSelect,
  DtTag,
  DtIconButton,
} from '@dt/ui'
import type {
  DatasetTableSummary,
  ReportBody,
  ReportMetric,
} from '@dt/contracts'
import { listDatasetTables, listDatasetColumns } from '@/api/dataset'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'

const props = withDefaults(
  defineProps<{
    modelValue: ReportMetric[]
    disabled: boolean
    apiSources?: NonNullable<ReportBody['api_sources']>
  }>(),
  { apiSources: () => [] },
)
const emit = defineEmits<{
  'update:modelValue': [value: ReportMetric[]]
  insert: [expression: string]
}>()
const name = ref('')
const tableId = ref('')
const key = ref('')
const expression = ref('')
const mode = ref('window_agg')
const offset = ref('0')
const unit = ref('')
const editing = ref<string | null>(null)
const formOpen = ref(false)
const tables = ref<DatasetTableSummary[]>([])
const columns = ref<{ key: string; name: string }[]>([])
const error = ref('')
const isLoading = ref(false)
const raced = useRacedFetch()
const catalog = useRacedFetch()
let pendingKey = ''
const isApi = computed(() => tableId.value.startsWith('api:'))
const tableOptions = computed(() => [
  ...tables.value.map((table) => ({
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
const AGGREGATIONS = [
  { value: 'window_agg', label: '期内均值' },
  { value: 'sum', label: '期内合计' },
  { value: 'min', label: '期内最小值' },
  { value: 'max', label: '期内最大值' },
  { value: 'count', label: '有效数据条数' },
  { value: 'delta', label: '期末减期初' },
  { value: 'latest', label: '期末最新值' },
  { value: 'at_bucket', label: '指定期最新值' },
  { value: 'first', label: '期内首个值' },
  { value: 'last', label: '期内末个值' },
  { value: 'expr', label: '指标表达式' },
]
const PERIODS = [
  { value: '0', label: '本期' },
  { value: '-1', label: '上期' },
  { value: '-12', label: '前 12 期（月报同比）' },
]
const TEXT_MODES = new Set([
  'latest',
  'at_bucket',
  'first',
  'last',
  'count',
  'expr',
])
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
watch(isTextApiField, (text) => {
  if (text && !TEXT_MODES.has(mode.value)) mode.value = 'latest'
})
onMounted(
  () =>
    void catalog.run(
      async () => {
        const result: DatasetTableSummary[] = []
        for (let page = 1; page <= 50; page += 1) {
          const found = await listDatasetTables({ page, size: 200 })
          result.push(...found.items)
          if (result.length >= found.total || !found.items.length) return result
        }
        throw new Error('台账目录超过加载上限')
      },
      {
        ok: (items) => {
          tables.value = items
        },
        fail: (caught) => {
          error.value = describeError(caught)
        },
        settled: () => undefined,
      },
    ),
)
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
    key.value = pendingKey
    pendingKey = ''
    isLoading.value = false
    return
  }
  isLoading.value = true
  void raced.run(() => listDatasetColumns(id), {
    ok: (items) => {
      columns.value = items
      key.value = pendingKey
      pendingKey = ''
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
  () => props.apiSources,
  () => {
    if (!isApi.value) return
    columns.value =
      props.apiSources.find((source) => `api:${source.code}` === tableId.value)
        ?.columns ?? []
    if (!columns.value.some((column) => column.key === key.value))
      key.value = ''
  },
  { deep: true },
)
onBeforeUnmount(() => {
  raced.cancel()
  catalog.cancel()
})
function add(): void {
  const table = tables.value.find((item) => item.id === tableId.value)
  error.value = nameError() || bindingError(table)
  if (error.value) return
  const metric = metricDraft(table)
  emit(
    'update:modelValue',
    editing.value
      ? props.modelValue.map((item) =>
          item.name === editing.value ? metric : item,
        )
      : [...props.modelValue, metric],
  )
  reset()
}
function nameError(): string {
  if (
    !name.value.trim() ||
    props.modelValue.some(
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
function sourceCode(table: DatasetTableSummary | undefined): string | null {
  return isApi.value ? tableId.value : (table?.code ?? null)
}
function selectedMode(): NonNullable<ReportMetric['mode']> {
  if (mode.value === 'expr') return 'expr'
  if (mode.value === 'at_bucket') return 'at_bucket'
  return mode.value === 'latest' ? 'latest' : 'window_agg'
}
function metricDraft(table: DatasetTableSummary | undefined): ReportMetric {
  const previous = props.modelValue.find((item) => item.name === editing.value)
  const expressionMode = mode.value === 'expr'
  return {
    ...previous,
    name: name.value.trim(),
    table: expressionMode ? null : sourceCode(table),
    key: expressionMode ? null : key.value,
    mode: selectedMode(),
    agg: aggregation(),
    offset: isApi.value ? 0 : Number(offset.value),
    expr: expressionMode ? expression.value : null,
    unit: unit.value || null,
    ...(isApi.value ? { window: null, anchor: 'period' } : {}),
  }
}
function existingMode(metric: ReportMetric): string {
  if (
    metric.mode === 'expr' ||
    metric.mode === 'latest' ||
    metric.mode === 'at_bucket'
  )
    return metric.mode
  return metric.agg === 'avg' || !metric.agg ? 'window_agg' : metric.agg
}
function existingSource(metric: ReportMetric): string {
  if (metric.table?.startsWith('api:')) return metric.table
  return tables.value.find((table) => table.code === metric.table)?.id ?? ''
}
function edit(metric: ReportMetric): void {
  formOpen.value = true
  editing.value = metric.name
  name.value = metric.name
  expression.value = metric.expr ?? ''
  mode.value = existingMode(metric)
  offset.value = String(metric.offset ?? 0)
  unit.value = metric.unit ?? ''
  const next = existingSource(metric)
  pendingKey = metric.key ?? ''
  if (tableId.value === next) {
    key.value = pendingKey
    pendingKey = ''
  }
  tableId.value = next
}
function reset(): void {
  formOpen.value = false
  editing.value = null
  name.value = ''
  expression.value = ''
  unit.value = ''
  error.value = ''
}
function openForm(): void {
  reset()
  formOpen.value = true
}
function sourceName(metric: ReportMetric): string {
  const api = props.apiSources.find(
    (source) => `api:${source.code}` === metric.table,
  )
  const table = tables.value.find((item) => item.code === metric.table)
  return api?.name ?? table?.name ?? metric.table ?? '未配置来源'
}
function describe(metric: ReportMetric): string {
  if (metric.mode === 'expr') return metric.expr ?? '指标表达式'
  const label =
    AGGREGATIONS.find((item) => item.value === existingMode(metric))?.label ??
    '期内均值'
  return `${sourceName(metric)} · ${metric.key ?? ''} · ${label}`
}
</script>
<template>
  <DtCard title="报告指标" icon="activity" padding="sm">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-secondary">
        从台账或下方 API 数据源选择字段，配置一次后可在正文中重复插入。
      </p>
      <div
        v-for="metric in props.modelValue"
        :key="metric.name"
        class="flex flex-col gap-1 rounded border border-border-subtle p-2"
      >
        <div class="flex items-center gap-2">
          <DtTag class="flex-1" intent="info">{{ metric.name }}</DtTag>
          <DtButton
            v-if="!disabled"
            size="sm"
            variant="ghost"
            icon="plus"
            @click="emit('insert', `{${metric.name}}`)"
          >
            插入
          </DtButton>
          <DtIconButton
            v-if="!disabled"
            size="sm"
            variant="ghost"
            icon="pencil"
            :label="`编辑指标 ${metric.name}`"
            @click="edit(metric)"
          />
          <DtIconButton
            v-if="!disabled"
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            :label="`移除指标 ${metric.name}`"
            @click="
              emit(
                'update:modelValue',
                props.modelValue.filter((item) => item.name !== metric.name),
              )
            "
          />
        </div>
        <p class="break-words text-sm text-secondary">{{ describe(metric) }}</p>
      </div>
      <DtButton
        v-if="!disabled && !formOpen"
        size="sm"
        variant="outline"
        icon="plus"
        @click="openForm"
        >添加指标</DtButton
      >
      <template v-if="!disabled && formOpen">
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
        <div class="flex gap-2">
          <DtButton size="sm" icon="plus" :disabled="isLoading" @click="add">
            {{ editing ? '保存指标修改' : '添加指标' }}
          </DtButton>
          <DtButton size="sm" variant="ghost" @click="reset">
            {{ editing ? '取消编辑' : '取消' }}
          </DtButton>
        </div>
      </template>
    </div>
  </DtCard>
</template>
