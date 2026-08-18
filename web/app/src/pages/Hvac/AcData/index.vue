<script setup lang="ts">
/**
 * @fileoverview 一台空调的原始数据：按时间段看表格或折线。
 *
 * 这是台账的详情页，**不进 NAV_ITEMS**（那张表里每一项都要有静态路径），
 * 靠 AppShell 的 backTo 回台账。
 * ⚠ 换时间段会同时触发两条取数，各自防竞态：慢的那次后返回会把界面刷成上一段
 * 时间的数据，而且不报任何错。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { AcDataset, DtSelectOption } from '@dt/contracts'
import { DtNotice, DtPageState } from '@dt/ui'

import * as hvac from '@/api/hvac'
import { AppShell } from '@/components/layout'
import { describeError } from '@/composables/useAsyncList'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  RANGE_PRESETS,
  defaultMetrics,
  recentRange,
  rangeProblem,
  toggleMetric,
} from './scripts/acDataQuery'
import { describeAcDataError } from './scripts/acDataError'
import { toSampleColumns, toSampleRow } from './scripts/sampleTable'
import { useAcDataView } from './scripts/useAcDataView'
import { useCursorList } from '@/composables/useCursorList'
import { useRawSeries } from './scripts/useRawSeries'
import AcDataToolbar from './components/AcDataToolbar.vue'
import RawSampleTable from './components/RawSampleTable.vue'
import RawSeriesChart from './components/RawSeriesChart.vue'

const route = useRoute()
const acUnitId = computed(() => String(route.params.acUnitId ?? ''))

const view = useAcDataView()
const catalog = useRacedFetch()
const datasets = ref<AcDataset[]>([])
const datasetKey = ref('')
const catalogError = ref<string | null>(null)
const selected = ref<string[]>([])

const opening = recentRange(RANGE_PRESETS[1]?.hours ?? 6)
const from = ref(opening.from)
const to = ref(opening.to)

const dataset = computed(() =>
  datasets.value.find((item) => item.key === datasetKey.value),
)
const metrics = computed(() => dataset.value?.metrics ?? [])
const datasetOptions = computed<DtSelectOption[]>(() =>
  datasets.value.map((item) => ({ value: item.key, label: item.name })),
)
const columns = computed(() => toSampleColumns(metrics.value))

const samples = useCursorList(
  (after) =>
    hvac.listRawSamples(acUnitId.value, {
      from: from.value,
      to: to.value,
      ...(after === null ? {} : { after }),
    }),
  describeAcDataError,
)
const series = useRawSeries(() =>
  hvac.getRawSeries(acUnitId.value, {
    from: from.value,
    to: to.value,
    metrics: selected.value,
  }),
)

const rows = computed(() =>
  samples.items.value.map((item) => toSampleRow(item, metrics.value)),
)
/** 只看当前视图那条路径的失败，另一条的错不该盖住正在看的东西。 */
const problem = computed(() =>
  view.value === 'table' ? samples.problem.value : series.problem.value,
)
// 本地就看得出的区间问题；它同时是「能不能发请求」的闸
const localRangeError = computed(() =>
  rangeProblem({ from: from.value, to: to.value }),
)
// 后端的 41613 也归到区间控件上——那是用户唯一改得动的地方
const rangeError = computed(() =>
  problem.value?.kind === 'range'
    ? problem.value.message
    : localRangeError.value,
)
const tableError = computed(() =>
  problem.value?.kind === 'other' ? problem.value.message : null,
)
const isBlocked = computed(
  () =>
    problem.value?.kind === 'unbound' || problem.value?.kind === 'unavailable',
)

function reloadAll(): void {
  if (localRangeError.value !== null || datasetKey.value === '') return
  void samples.reload()
  // 表格视图下不去拉序列：那是另一条端点，看不见的时候拉纯属浪费外库的查询
  if (view.value === 'chart' && selected.value.length > 0) {
    void series.load(metrics.value)
  }
}

async function loadCatalog(): Promise<void> {
  await catalog.run(() => hvac.listAcDatasets(), {
    ok: (found) => {
      datasets.value = found
      datasetKey.value = found[0]?.key ?? ''
      selected.value = defaultMetrics(found[0]?.metrics ?? [])
      catalogError.value = null
    },
    fail: (caught) => (catalogError.value = describeError(caught)),
    settled: () => undefined,
  })
}

function applyPreset(hours: number): void {
  const next = recentRange(hours)
  from.value = next.from
  to.value = next.to
}

function onToggle(metric: string): void {
  selected.value = toggleMetric(selected.value, metric)
  if (selected.value.length > 0) void series.load(metrics.value)
}

function onMore(): void {
  void samples.loadMore()
}

watch([from, to, datasetKey], () => reloadAll())
watch(view, (next) => {
  if (next === 'chart' && selected.value.length > 0) {
    void series.load(metrics.value)
  }
})

// ⚠ 不在这里再调一次 reloadAll：目录回来时 datasetKey 从空串变成第一个 key，
// 下面那个 watch 已经会触发取数，再调一次就是每次进页面都发两遍同样的请求。
onMounted(() => {
  void loadCatalog()
})
</script>

<template>
  <AppShell
    title="空调原始数据"
    :subtitle="dataset?.description"
    back-to="/hvac/units"
    back-label="返回台账"
  >
    <div class="flex h-full min-h-0 flex-col gap-4">
      <AcDataToolbar
        :dataset-options="datasetOptions"
        :dataset-key="datasetKey"
        :from="from"
        :to="to"
        :view="view"
        :presets="RANGE_PRESETS"
        :range-error="rangeError"
        @update:dataset-key="datasetKey = $event"
        @update:from="from = $event"
        @update:to="to = $event"
        @update:view="view = $event"
        @preset="applyPreset"
      />

      <DtNotice v-if="catalogError" intent="danger">{{
        catalogError
      }}</DtNotice>

      <DtPageState
        v-if="isBlocked"
        :empty="problem?.kind === 'unbound'"
        :error="problem?.kind === 'unavailable' ? problem.message : null"
        empty-title="还没有绑定数据源"
        :empty-hint="problem?.message"
        @retry="reloadAll"
      />

      <RawSampleTable
        v-else-if="view === 'table'"
        :columns="columns"
        :rows="rows"
        :loading="samples.loading.value"
        :loading-more="samples.loadingMore.value"
        :has-more="samples.hasMore.value"
        :error="tableError"
        @more="onMore"
        @retry="reloadAll"
      />

      <RawSeriesChart
        v-else
        :metrics="metrics"
        :selected="selected"
        :series="series.series.value"
        :interval-minutes="series.intervalMinutes.value"
        :loading="series.loading.value"
        @toggle="onToggle"
      />
    </div>
  </AppShell>
</template>
