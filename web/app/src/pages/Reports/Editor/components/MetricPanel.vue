<script setup lang="ts">
/** @fileoverview 指标配置与插入正文，绑定选择取自台账目录。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { DtButton, DtCard, DtInput, DtNotice, DtSelect, DtTag } from '@dt/ui'
import type {
  DatasetColumn,
  DatasetTableSummary,
  ReportMetric,
} from '@dt/contracts'
import { listDatasetTables, listDatasetColumns } from '@/api/dataset'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'

const props = defineProps<{ modelValue: ReportMetric[]; disabled: boolean }>()
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
const tables = ref<DatasetTableSummary[]>([])
const columns = ref<DatasetColumn[]>([])
const error = ref('')
const raced = useRacedFetch()
const tableOptions = computed(() =>
  tables.value.map((table) => ({ value: table.id, label: table.name })),
)
const columnOptions = computed(() =>
  columns.value.map((column) => ({ value: column.key, label: column.name })),
)
const modes = [
  { value: 'window_agg', label: '期内均值' },
  { value: 'sum', label: '期内合计' },
  { value: 'latest', label: '期末最新值' },
  { value: 'expr', label: '指标表达式' },
]
onMounted(async () => {
  try {
    tables.value = (await listDatasetTables({ page: 1, size: 200 })).items
  } catch (caught) {
    error.value = describeError(caught)
  }
})
watch(tableId, (id) => {
  key.value = ''
  void raced.run(() => listDatasetColumns(id), {
    ok: (items) => {
      columns.value = items
    },
    fail: (caught) => {
      error.value = describeError(caught)
    },
    settled: () => undefined,
  })
})
onBeforeUnmount(() => raced.cancel())
function add(): void {
  error.value = ''
  if (
    !name.value ||
    props.modelValue.some((item) => item.name === name.value)
  ) {
    error.value = '请输入不重复的指标名称'
    return
  }
  const table = tables.value.find((item) => item.id === tableId.value)
  if (mode.value !== 'expr' && (!table || !key.value)) {
    error.value = '请选择台账及列'
    return
  }
  if (mode.value === 'expr' && !expression.value) {
    error.value = '请输入指标表达式'
    return
  }
  const metric = metricDraft(table)
  emit('update:modelValue', [...props.modelValue, metric])
  name.value = ''
}
function metricDraft(table: DatasetTableSummary | undefined): ReportMetric {
  return {
    name: name.value,
    table: table?.code ?? null,
    key: key.value || null,
    mode:
      mode.value === 'expr'
        ? 'expr'
        : mode.value === 'latest'
          ? 'latest'
          : 'window_agg',
    agg: mode.value === 'sum' ? 'sum' : 'avg',
    offset: Number(offset.value),
    expr: expression.value || null,
  }
}
function remove(name: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item.name !== name),
  )
}
</script>
<template>
  <DtCard title="报告指标" icon="activity" padding="sm">
    <div class="flex flex-col gap-3">
      <div
        v-for="metric in props.modelValue"
        :key="metric.name"
        class="flex items-center gap-2"
      >
        <DtTag class="flex-1" intent="info">
          {{ metric.name }}
        </DtTag>
        <DtButton
          v-if="!disabled"
          size="sm"
          variant="ghost"
          icon="plus"
          @click="emit('insert', `{${metric.name}}`)"
        >
          插入
        </DtButton>
        <DtButton
          v-if="!disabled"
          size="sm"
          variant="ghost"
          intent="danger"
          icon="trash"
          @click="remove(metric.name)"
        >
          移除
        </DtButton>
      </div>
      <template v-if="!disabled">
        <DtInput v-model="name" label="指标名称" size="sm" />
        <DtSelect v-model="mode" label="取数方式" size="sm" :options="modes" />
        <template v-if="mode !== 'expr'">
          <DtSelect
            v-model="tableId"
            label="数据台账"
            size="sm"
            :options="tableOptions"
          />
          <DtSelect
            v-model="key"
            label="台账列"
            size="sm"
            :options="columnOptions"
          />
          <DtInput
            v-model="offset"
            label="报告期偏移"
            size="sm"
            hint="0 为本期，-1 为上期"
          />
        </template>
        <DtInput
          v-else
          v-model="expression"
          label="指标表达式"
          size="sm"
          placeholder="({本期}-{上期})/{上期}*100"
        />
        <DtNotice v-if="error" intent="danger">
          {{ error }}
        </DtNotice>
        <DtButton size="sm" icon="plus" @click="add">添加指标</DtButton>
      </template>
    </div>
  </DtCard>
</template>
