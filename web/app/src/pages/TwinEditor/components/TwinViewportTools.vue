<script setup lang="ts">
/** @fileoverview 视口的常用定位与临时隔离操作。 */
import { DtButton } from '@dt/ui'
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
    <DtButton size="xs" variant="soft" @click="emit('focus')"
      >聚焦选中</DtButton
    >
    <DtButton
      size="xs"
      variant="ghost"
      :disabled="!canIsolate"
      @click="emit('isolate')"
      >{{ isolated ? '退出隔离' : '只看选中' }}</DtButton
    >
    <DtButton size="xs" variant="ghost" @click="emit('reset')"
      >显示全部</DtButton
    >
    <DtButton size="xs" variant="ghost" @click="emit('overview')"
      >全览</DtButton
    >
    <DtButton
      size="xs"
      variant="ghost"
      :disabled="!canBack"
      @click="emit('back')"
      >上一视角</DtButton
    >
  </div>
</template>
<style scoped lang="scss">
.viewport-tools {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: var(--z-sticky);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  max-width: calc(100% - 16px);
  padding: 4px;
  background: var(--surface-base);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
}
</style>
