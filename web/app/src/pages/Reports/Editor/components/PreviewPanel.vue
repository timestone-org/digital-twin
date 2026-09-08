<script setup lang="ts">
/** @fileoverview 报告试算结果，缺失与截断显式可见。 */
import { computed } from 'vue'
import { DtCard, DtNotice } from '@dt/ui'
import type { ReportPreview } from '@dt/contracts'
import ReportChart from './ReportChart.vue'
import ReportTable from './ReportTable.vue'
const props = defineProps<{ preview: ReportPreview }>()
const DATA_NODE_KINDS = new Set(['line', 'bar', 'dsChart', 'dsTable'])
const nodeViews = computed(() =>
  Object.entries(props.preview.nodes).map(([path, node]) => {
    const hasChartData =
      node.series?.some((series) =>
        series.points.some((point) => point.value !== null),
      ) ?? false
    const hasTableData = (node.rows?.length ?? 0) > 0
    return {
      path,
      node,
      hasChartData,
      hasTableData,
      isEmpty:
        DATA_NODE_KINDS.has(node.kind) &&
        !hasChartData &&
        !hasTableData &&
        !node.text,
    }
  }),
)
</script>
<template>
  <DtCard title="试算结果" icon="activity" padding="sm">
    <div class="flex flex-col gap-3">
      <p>报告期 {{ preview.period }} · {{ preview.timezone }}</p>
      <DtNotice
        v-for="warning in preview.warnings"
        :key="warning"
        intent="warning"
      >
        {{ warning }}
      </DtNotice>
      <div v-for="metric in preview.metrics" :key="metric.name">
        <strong> {{ metric.name }} </strong>：{{ metric.value ?? '—' }}
        <span v-if="metric.is_truncated"> （数据已截断） </span>
      </div>
      <DtCard
        v-for="view in nodeViews"
        :key="view.path"
        :title="view.node.title || view.node.text || '数据节点'"
        padding="sm"
      >
        <ReportChart v-if="view.hasChartData" :node="view.node" />
        <ReportTable v-if="view.hasTableData" :node="view.node" />
        <DtNotice v-if="view.isEmpty" intent="info">
          当前报告期暂无可展示数据
        </DtNotice>
      </DtCard>
    </div>
  </DtCard>
</template>
