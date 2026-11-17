<script setup lang="ts">
/** @fileoverview 报告节点薄壳，将内容委托给应用宿主。 */
import type { ModuleMeta } from '@dt/contracts'
import { computed } from 'vue'
import ModulePanel from '../../shared/ModulePanel.vue'
import { readNumber, readText } from '../../shared/config'
import { reportHost } from './host'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()
const host = reportHost()
const title = computed(() => readText(props.config.title))
const templateCode = computed(() => readText(props.config.templateCode).trim())
const refreshSeconds = computed(() =>
  Math.max(0, Math.min(3600, readNumber(props.config.refreshSeconds, 30))),
)
</script>
<template>
  <ModulePanel :title="title">
    <component
      :is="host"
      v-if="host"
      :template-code="templateCode"
      :refresh-seconds="refreshSeconds"
    />
    <p v-else class="report-view__empty">当前环境未提供报告展示能力</p>
  </ModulePanel>
</template>
<style scoped lang="scss">
.report-view__empty {
  display: grid;
  height: 100%;
  place-items: center;
  color: var(--text-secondary);
  font-size: 14px;
}
</style>
