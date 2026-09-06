<script setup lang="ts">
/** @fileoverview 报告试算结果，缺失与截断显式可见。 */
import { DtCard, DtNotice } from '@dt/ui'
import type { ReportPreview } from '@dt/contracts'
import ReportChart from './ReportChart.vue'
import ReportTable from './ReportTable.vue'
defineProps<{ preview: ReportPreview }>()
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
        v-for="(node, path) in preview.nodes"
        :key="path"
        :title="node.title || node.text || '数据节点'"
        padding="sm"
      >
        <ReportChart v-if="node.series?.length" :node="node" />
        <ReportTable v-if="node.rows?.length" :node="node" />
      </DtCard>
    </div>
  </DtCard>
</template>
