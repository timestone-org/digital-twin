<script setup lang="ts">
/**
 * @fileoverview 「这一步的结果」那个弹窗：六区结果面 + 全量结果的下载入口。
 *
 * ⚠ 摘要那一份**有硬上限**（200 行）：它是给人看一眼的，不是数据。想把处理好的
 * 数据拿走要走下载链接，且那条要另一个权限码
 * （docs/MODELING_PLATFORM_DESIGN.md D12）。
 * ⚠ 弹窗宽度由这里给：`FrameView` 的两张表写死 52rem 最小宽，56rem 的弹窗里
 * 它们今天就在横向滚。
 */
import type { ModelingNodeRun } from '@dt/contracts'
import { DtModal } from '@dt/ui'

import ReportBlocks from './ReportBlocks.vue'
import ResultView from './ResultView.vue'

const props = defineProps<{
  /** 这个节点这一次的详情；null = 还没拉回来，那时摆骨架。 */
  detail: ModelingNodeRun | null
  labels: Record<string, string>
  /** 这次运行的 id 与开着的那个节点，只用来拼下载地址。 */
  runId: string | undefined
  nodeId: string | null
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <DtModal
    :model-value="props.nodeId !== null"
    title="这一步的结果"
    width="min(72rem, 92vw)"
    @update:model-value="emit('close')"
  >
    <ResultView
      v-if="props.detail !== null"
      :payload="props.detail.preview"
      :labels="props.labels"
      :run-id="props.runId"
      :node-id="props.nodeId ?? undefined"
      :exported-ports="props.detail.exported_ports"
      :report="props.detail.report"
      :is-preview-truncated="props.detail.is_preview_truncated"
    />
    <!-- ⚠ 占位高度按区固定：拉回来之后各区落在原处，不跳版 -->
    <ReportBlocks v-else pending />
  </DtModal>
</template>
