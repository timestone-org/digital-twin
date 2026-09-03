<script setup lang="ts">
/**
 * @fileoverview 「这一步的结果」那个弹窗：摘要 + 全量结果的下载入口。
 *
 * ⚠ 摘要那一份**有硬上限**（200 行）：它是给人看一眼的，不是数据。想把处理好的
 * 数据拿走要走下载链接，且那条要另一个权限码
 * （docs/MODELING_PLATFORM_DESIGN.md D12）。
 */
import { DtModal } from '@dt/ui'

import ResultView from './ResultView.vue'

const props = defineProps<{
  payload: Record<string, unknown> | null
  labels: Record<string, string>
  /** 这次运行的 id 与开着的那个节点，只用来拼下载地址。 */
  runId: string | undefined
  nodeId: string | null
  /** 留下了全量结果的那些端口。没留过就是空，那时不摆下载链接。 */
  exportedPorts: readonly string[]
}>()

const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <DtModal
    :model-value="props.payload !== null"
    title="这一步的结果"
    width="56rem"
    @update:model-value="emit('close')"
  >
    <ResultView
      v-if="props.payload"
      :payload="props.payload"
      :labels="props.labels"
      :run-id="props.runId"
      :node-id="props.nodeId ?? undefined"
      :exported-ports="props.exportedPorts"
    />
  </DtModal>
</template>
