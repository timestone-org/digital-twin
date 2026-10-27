<script setup lang="ts">
/** @fileoverview 画布视口工具：缩放、适应视图、整理与吸附。 */
import { DtButton, DtIconButton } from '@dt/ui'
const props = defineProps<{
  zoom: number
  isSnapping: boolean
  isReadonly: boolean
  hasNodes: boolean
}>()
const emit = defineEmits<{
  zoomIn: []
  zoomOut: []
  resetZoom: []
  fit: []
  autoLayout: []
  toggleSnap: []
}>()
</script>

<template>
  <div class="dt-ml-tools" role="toolbar" aria-label="画布工具">
    <DtIconButton
      variant="ghost"
      size="sm"
      icon="minus"
      label="缩小"
      @click="emit('zoomOut')"
    />
    <DtButton
      variant="ghost"
      intent="neutral"
      size="sm"
      class="dt-ml-tools__zoom"
      aria-label="回到 100%"
      title="回到 100%"
      @click="emit('resetZoom')"
      >{{ Math.round(props.zoom * 100) }}%</DtButton
    >
    <DtIconButton
      variant="ghost"
      size="sm"
      icon="plus"
      label="放大"
      @click="emit('zoomIn')"
    />
    <span class="dt-ml-tools__sep" aria-hidden="true" />
    <DtIconButton
      variant="ghost"
      size="sm"
      icon="layout-grid"
      label="适应视图"
      :disabled="!hasNodes"
      @click="emit('fit')"
    />
    <DtIconButton
      variant="ghost"
      size="sm"
      icon="distribute-horizontal"
      label="一键整理"
      tooltip="按数据流方向整理节点"
      :disabled="isReadonly || !hasNodes"
      @click="emit('autoLayout')"
    />
    <DtButton
      size="sm"
      icon="magnet"
      aria-label="吸附对齐"
      title="吸附对齐（按住 Alt 临时关闭）"
      :pressed="isSnapping"
      :disabled="isReadonly"
      @click="emit('toggleSnap')"
    />
  </div>
</template>

<style scoped lang="scss">
.dt-ml-tools {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  padding: 0.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  box-shadow: var(--fx-shadow-menu);
  &__zoom {
    min-width: 3rem;
    font-family: var(--font-digit);
  }
  &__sep {
    width: 1px;
    height: 1rem;
    margin: 0 0.25rem;
    background: var(--border-subtle);
  }
}
</style>
