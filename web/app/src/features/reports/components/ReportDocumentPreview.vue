<script setup lang="ts">
/** @fileoverview Word 原件预览，原生图表在原段落或单元格内显示。 */
import { onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { DtSpinner } from '@dt/ui'
import DocumentPreviewDocx from '@/components/documents/DocumentPreviewDocx.vue'
import { useRacedFetch } from '@/composables/useRacedFetch'
import {
  locateWordCharts,
  prepareInlineWordCharts,
  type ReportPreviewDocument,
} from '../scripts/inlineWordCharts'
import ReportChart from './ReportChart.vue'

const props = defineProps<{ blob: Blob }>()
const document = shallowRef<ReportPreviewDocument | null>(null)
const anchors = shallowRef<ReturnType<typeof locateWordCharts>>([])
const failure = ref('')
const loading = ref(false)
const raced = useRacedFetch()
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : '报告无法预览，请下载原件'
}
watch(
  () => props.blob,
  async (blob) => {
    anchors.value = []
    document.value = null
    failure.value = ''
    loading.value = true
    await raced.run(() => prepareInlineWordCharts(blob), {
      ok: (value) => {
        document.value = value
      },
      fail: (error) => {
        failure.value = describeError(error)
      },
      settled: () => {
        loading.value = false
      },
    })
  },
  { immediate: true },
)
function rendered(host: HTMLElement): void {
  try {
    anchors.value = locateWordCharts(host, document.value?.charts ?? [])
  } catch (error) {
    failure.value = describeError(error)
  }
}
onBeforeUnmount(raced.cancel)
</script>
<template>
  <div class="report-document">
    <p v-if="failure" role="alert">{{ failure }}</p>
    <DocumentPreviewDocx
      v-else-if="document"
      :blob="document.blob"
      @rendered="rendered"
    />
    <DtSpinner v-else-if="loading" />
    <Teleport
      v-for="anchor in anchors"
      :key="anchor.chart.marker"
      :to="anchor.target"
    >
      <ReportChart
        :node="anchor.chart.node"
        paper
        :style="{ height: '100%' }"
      />
    </Teleport>
  </div>
</template>
