<script setup lang="ts">
/** @fileoverview 流程图工作栏：保存状态、选中节点配置与辅助操作。 */
import { PERMISSION_CODES } from '@dt/contracts'
import { DtButton, DtIconButton, DtTag } from '@dt/ui'
import PermGuard from '@/components/PermGuard.vue'

defineProps<{
  state: {
    isReadonly: boolean
    isReplaying: boolean
    isDirty: boolean
    canUndo: boolean
    canRedo: boolean
    canConfigure: boolean
    nodeCount: number
    progress: string
  }
}>()
defineEmits<{
  undo: []
  redo: []
  configure: []
  history: []
  shortcuts: []
  autoLayout: []
}>()
</script>

<template>
  <div class="canvas-workspace-bar" aria-label="流程图工作栏">
    <div class="canvas-workspace-bar__group">
      <strong>流程图</strong>
      <DtTag>{{ state.nodeCount }} 个算子</DtTag>
      <DtTag v-if="state.isReplaying" intent="info">正在回看历史运行</DtTag>
      <DtTag v-else :intent="state.isDirty ? 'warning' : 'success'">{{
        state.isDirty ? '有未保存修改' : '已保存'
      }}</DtTag>
      <span
        v-if="state.progress"
        role="status"
        class="text-caption text-text-secondary"
        >{{ state.progress }}</span
      >
    </div>
    <div class="canvas-workspace-bar__group">
      <DtIconButton
        size="sm"
        variant="soft"
        icon="settings"
        label="配置选中节点"
        tooltip="配置选中节点"
        :disabled="!state.canConfigure"
        @click="$emit('configure')"
      />
      <PermGuard :codes="[PERMISSION_CODES.modelingManage]">
        <DtButton
          size="sm"
          variant="outline"
          intent="neutral"
          icon="distribute-horizontal"
          title="按数据流整理节点，支持撤销"
          :disabled="state.isReadonly || state.nodeCount === 0"
          @click="$emit('autoLayout')"
          >自动整理</DtButton
        >
        <DtIconButton
          variant="ghost"
          size="sm"
          icon="undo"
          label="撤销"
          tooltip="撤销（⌘Z）"
          :disabled="state.isReadonly || !state.canUndo"
          @click="$emit('undo')"
        />
        <DtIconButton
          variant="ghost"
          size="sm"
          icon="redo"
          label="重做"
          tooltip="重做（⌘⇧Z）"
          :disabled="state.isReadonly || !state.canRedo"
          @click="$emit('redo')"
        />
      </PermGuard>
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="list-checks"
        label="运行历史"
        tooltip="查看运行历史"
        @click="$emit('history')"
      />
      <DtIconButton
        variant="ghost"
        size="sm"
        icon="keyboard"
        label="快捷键"
        tooltip="快捷键与手势"
        @click="$emit('shortcuts')"
      />
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.canvas-workspace-bar {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  justify-content: space-between;
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.5rem 0;
  &__group {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  strong {
    font-size: var(--font-size-body);
  }
}
</style>
