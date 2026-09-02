<script setup lang="ts">
/**
 * @fileoverview 画布右下角那排小按钮：缩放、适应视图、一键整理、吸附开关。
 *
 * ⚠ 「适应视图」必须有个看得见的入口：图一大就很容易把节点拖出视野，而滚轮缩
 * 到能看全整张图要滚很久——回不到全景，用户只会以为节点被自己弄丢了。
 */
import { DtIcon } from '@dt/ui'

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
    <button
      type="button"
      class="dt-ml-tools__btn"
      title="缩小"
      aria-label="缩小"
      @click="emit('zoomOut')"
    >
      <DtIcon name="minus" :size="14" />
    </button>
    <button
      type="button"
      class="dt-ml-tools__zoom"
      title="回到 100%"
      aria-label="回到 100%"
      @click="emit('resetZoom')"
    >
      {{ Math.round(props.zoom * 100) }}%
    </button>
    <button
      type="button"
      class="dt-ml-tools__btn"
      title="放大"
      aria-label="放大"
      @click="emit('zoomIn')"
    >
      <DtIcon name="plus" :size="14" />
    </button>
    <span class="dt-ml-tools__sep" />
    <button
      type="button"
      class="dt-ml-tools__btn"
      title="适应视图"
      aria-label="适应视图"
      :disabled="!props.hasNodes"
      @click="emit('fit')"
    >
      <DtIcon name="layout-grid" :size="14" />
    </button>
    <button
      type="button"
      class="dt-ml-tools__btn"
      title="一键整理：按数据流方向重排"
      aria-label="一键整理"
      :disabled="props.isReadonly || !props.hasNodes"
      @click="emit('autoLayout')"
    >
      <DtIcon name="distribute-horizontal" :size="14" />
    </button>
    <button
      type="button"
      class="dt-ml-tools__btn"
      :class="{ 'dt-ml-tools__btn--on': props.isSnapping }"
      title="吸附对齐（按住 Alt 临时关掉）"
      aria-label="吸附对齐"
      :aria-pressed="props.isSnapping"
      :disabled="props.isReadonly"
      @click="emit('toggleSnap')"
    >
      <DtIcon name="magnet" :size="14" />
    </button>
  </div>
</template>

<style scoped lang="scss">
.dt-ml-tools {
  position: absolute;
  right: 0.75rem;
  bottom: 0.75rem;
  display: flex;
  gap: 0.125rem;
  align-items: center;
  padding: 0.25rem;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-panel);
  box-shadow: var(--fx-shadow-menu);

  &__btn,
  &__zoom {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 1.75rem;
    padding: 0 0.375rem;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--ctl-hint-fs-sm);
    cursor: pointer;

    &:hover:not(:disabled) {
      background: rgb(var(--accent-primary-rgb) / 0.14);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  }

  &__btn {
    width: 1.75rem;

    &--on {
      background: rgb(var(--accent-primary-rgb) / 0.2);
      color: var(--accent-primary);
    }
  }

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
