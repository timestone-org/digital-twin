<script setup lang="ts">
/**
 * @fileoverview 报告指标列表：检索、分批显示、插入与删除；添加和编辑走弹窗。
 * 一份模板可能有数百条指标，列表只渲染一批，避免整栏卡顿。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  DtButton,
  DtCard,
  DtInput,
  DtNotice,
  DtTag,
  DtIconButton,
} from '@dt/ui'
import type {
  DatasetTableSummary,
  ReportBody,
  ReportMetric,
} from '@dt/contracts'
import { listDatasetTables } from '@/api/dataset'
import { useRacedFetch } from '@/composables/useRacedFetch'
import { describeError } from '@/composables/useAsyncList'
import {
  AGGREGATIONS,
  existingMode,
  filterMetrics,
} from '../scripts/metricModes'
import MetricFormDialog from './MetricFormDialog.vue'

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
/** 每批显示的指标条数。 */
const PAGE_SIZE = 50
/** 超过这么多条才显示检索框。 */
const SEARCH_THRESHOLD = 10
const tables = ref<DatasetTableSummary[]>([])
const error = ref('')
const query = ref('')
const shown = ref(PAGE_SIZE)
const formOpen = ref(false)
const editingMetric = ref<ReportMetric | null>(null)
const catalog = useRacedFetch()
const matched = computed(() =>
  filterMetrics(props.modelValue, query.value, describe),
)
const visible = computed(() => matched.value.slice(0, shown.value))
watch(query, () => {
  shown.value = PAGE_SIZE
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
onBeforeUnmount(() => catalog.cancel())
function openForm(metric: ReportMetric | null): void {
  editingMetric.value = metric
  formOpen.value = true
}
function remove(metric: ReportMetric): void {
  emit(
    'update:modelValue',
    props.modelValue.filter((item) => item.name !== metric.name),
  )
}
function sourceName(metric: ReportMetric): string {
  const api = props.apiSources.find(
    (source) => `api:${source.code}` === metric.table,
  )
  const table = tables.value.find((item) => item.code === metric.table)
  return api?.name ?? table?.name ?? metric.table ?? '未配置来源'
}
/**
 * 报告期偏移的说法。API 来源的偏移配在来源上，指标自己的恒为 0。
 * @param metric 指标定义
 */
function periodLabel(metric: ReportMetric): string {
  const api = props.apiSources.find(
    (source) => `api:${source.code}` === metric.table,
  )
  const offset = api ? (api.offset ?? 0) : (metric.offset ?? 0)
  if (offset === 0) return '本期'
  if (offset === -1) return '上期'
  return `偏移 ${offset} 期`
}
/**
 * 列表里一条指标的说明；本期与上期、单位都要说出来，否则两条读起来一模一样。
 * @param metric 指标定义
 */
function describe(metric: ReportMetric): string {
  if (metric.mode === 'expr') return metric.expr ?? '指标表达式'
  const label =
    AGGREGATIONS.find((item) => item.value === existingMode(metric))?.label ??
    '期内均值'
  return [
    sourceName(metric),
    metric.key ?? '',
    label,
    periodLabel(metric),
    ...(metric.unit ? [metric.unit] : []),
  ].join(' · ')
}
</script>
<template>
  <DtCard title="报告指标" icon="activity" padding="sm">
    <div class="flex flex-col gap-3">
      <p class="text-sm text-secondary">
        从台账或下方 API 数据源选择字段，配置一次后可在正文中重复插入。
      </p>
      <DtButton
        v-if="!disabled"
        size="sm"
        variant="outline"
        icon="plus"
        @click="openForm(null)"
      >
        添加指标
      </DtButton>
      <DtNotice v-if="error" intent="danger">{{ error }}</DtNotice>
      <DtInput
        v-if="props.modelValue.length > SEARCH_THRESHOLD"
        v-model="query"
        size="sm"
        aria-label="检索指标"
        placeholder="按名称、字段或来源检索"
        :hint="`共 ${props.modelValue.length} 条，匹配 ${matched.length} 条`"
      />
      <div
        v-for="metric in visible"
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
            @click="openForm(metric)"
          />
          <DtIconButton
            v-if="!disabled"
            size="sm"
            variant="ghost"
            intent="danger"
            icon="trash"
            :label="`移除指标 ${metric.name}`"
            @click="remove(metric)"
          />
        </div>
        <p class="break-words text-sm text-secondary">{{ describe(metric) }}</p>
      </div>
      <p
        v-if="query && !matched.length"
        class="text-center text-sm text-secondary"
      >
        没有匹配的指标
      </p>
      <DtButton
        v-if="matched.length > shown"
        size="sm"
        variant="ghost"
        @click="shown += PAGE_SIZE"
      >
        再显示 {{ Math.min(PAGE_SIZE, matched.length - shown) }} 条（还剩
        {{ matched.length - shown }} 条）
      </DtButton>
    </div>
    <MetricFormDialog
      v-model="formOpen"
      :metric="editingMetric"
      :metrics="props.modelValue"
      :tables="tables"
      :api-sources="props.apiSources"
      @save="emit('update:modelValue', $event)"
    />
  </DtCard>
</template>
