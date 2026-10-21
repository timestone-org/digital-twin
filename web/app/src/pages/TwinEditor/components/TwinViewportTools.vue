<script setup lang="ts">
/** @fileoverview 视口的常用定位与临时隔离操作。 */
import { DtIconButton } from '@dt/ui'
defineProps<{ isolated: boolean; canIsolate: boolean; canBack: boolean }>()
const emit = defineEmits<{
  focus: []
  overview: []
  isolate: []
  reset: []
  back: []
}>()
</script>
<template>
  <div class="viewport-tools" role="toolbar" aria-label="模型配置快捷操作">
    <DtIconButton
      size="sm"
      variant="soft"
      intent="primary"
      icon="focus"
      label="聚焦选中"
      @click="emit('focus')"
    />
    <DtIconButton
      size="sm"
      icon="scan-eye"
      :label="isolated ? '退出隔离' : '只看选中'"
      :pressed="isolated"
      :disabled="!canIsolate"
      @click="emit('isolate')"
    />
    <DtIconButton
      size="sm"
      icon="eye"
      label="显示全部"
      @click="emit('reset')"
    />
    <DtIconButton
      size="sm"
      icon="maximize"
      label="全览"
      @click="emit('overview')"
    />
    <DtIconButton
      size="sm"
      icon="arrow-left"
      label="上一视角"
      :disabled="!canBack"
      @click="emit('back')"
    />
  </div>
</template>
<style scoped lang="scss">
.viewport-tools {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: var(--z-sticky);
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 4px;
  background: var(--surface-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
</style>
