<script setup lang="ts">
/** @fileoverview 在采集配置页提供当前数据源的只读助手。 */
import { watch } from 'vue'
import type { CollectSource } from '@dt/contracts'
import AiDock from '@/components/ai/AiDock.vue'
import { useAiPanel } from '@/composables/useAiPanel'
import { createCollectSurface } from '../scripts/aiSurface'

const props = defineProps<{ source: CollectSource | null }>()
const ai = useAiPanel({
  surface: () => createCollectSurface(() => props.source),
  refId: () => props.source?.id ?? null,
})
watch(
  () => props.source?.id,
  () => ai.chat.stop(),
)
</script>

<template>
  <AiDock
    :ai="ai"
    surface-label="采集配置页"
    hint="可查询点位、核对数据源运行状态与检索资料。"
    :starters="[
      '核对当前数据源的配置点数与最近上报点数',
      '查找当前数据源的温度点位',
    ]"
  />
</template>
