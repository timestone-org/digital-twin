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
import type { ModelingNodeRun, ModelingOperator } from '@dt/contracts'
import { DtModal, DtPageState } from '@dt/ui'

import ReportBlocks from './ReportBlocks.vue'
import ResultView from './ResultView.vue'

const props = defineProps<{
  /** 这个节点这一次的详情；null = 还没拉回来，那时摆骨架。 */
  detail: ModelingNodeRun | null
  labels: Record<string, string>
  operator?: ModelingOperator | undefined
  /** 这次运行的 id 与开着的那个节点，只用来拼下载地址。 */
  runId: string | undefined
  nodeId: string | null
  /**
   * 这一步的参数，④ 区的公式照它代实参。
   *
   * ⚠ 要运行时冻结的那份快照：画布上现在那份在历史回看时早改过了。
   */
  config: Readonly<Record<string, unknown>>
  /** 详情没拉回来的原因；'' = 没失败。 */
  error: string
}>()

const emit = defineEmits<{ close: []; retry: [] }>()
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
      :code="props.detail.operator"
      :config="props.config"
      :operator="props.operator"
    />
    <DtPageState
      v-else-if="props.error"
      :error="props.error"
      :empty="false"
      @retry="emit('retry')"
    />
    <!-- ⚠ 占位高度按区固定：拉回来之后各区落在原处，不跳版 -->
    <ReportBlocks v-else pending />
  </DtModal>
</template>

<style scoped lang="scss">
// ⚠ 结果正文是弹窗正文的第一块：锚点条吸顶时要盖住正文上内边距（DtModal 18px 20px，
// 窄屏 12px），否则往下滚的内容从签条上方那条缝里透出来。负外边距只能放在这里，
// 训练记录的结果弹窗里它前面还有别的内容，挪过去会压住上一块
.dt-ml-result > :deep(.dt-ml-result__anchors) {
  top: -18px;
  margin: -18px -20px 0;
  padding: calc(18px + 0.25rem) 20px 0.375rem;

  @media (max-width: 640px), (max-height: 600px) {
    top: -12px;
    margin: -12px -12px 0;
    padding: calc(12px + 0.25rem) 12px 0.375rem;
  }
}
</style>
