<script setup lang="ts">
/**
 * @fileoverview 编辑器顶部的动作条：撤销 / 重做 / 保存，以及未保存与版本冲突的提示。
 * ⚠ 版本冲突时**保存被挡住**：留着保存键等于让用户再点一次、再失败一次，
 * 而这条路径的正确出口只有「重新加载」（ADR-0012）。
 */
import { DtButton, DtTag } from '@dt/ui'

defineProps<{
  isDirty: boolean
  canUndo: boolean
  canRedo: boolean
  saving: boolean
  hasConflict: boolean
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  save: []
  reload: []
}>()
</script>

<template>
  <div class="flex items-center gap-2">
    <DtTag v-if="hasConflict" size="sm" intent="danger">版本已过期</DtTag>
    <DtTag v-else-if="isDirty" size="sm" intent="warning">未保存</DtTag>
    <DtButton
      size="sm"
      variant="ghost"
      icon="chevron-left"
      :disabled="!canUndo"
      @click="emit('undo')"
    >
      撤销
    </DtButton>
    <DtButton
      size="sm"
      variant="ghost"
      icon="chevron-right"
      :disabled="!canRedo"
      @click="emit('redo')"
    >
      重做
    </DtButton>
    <DtButton
      size="sm"
      variant="outline"
      icon="refresh-cw"
      @click="emit('reload')"
    >
      重新加载
    </DtButton>
    <DtButton
      size="sm"
      icon="check"
      :loading="saving"
      :disabled="hasConflict || !isDirty"
      @click="emit('save')"
    >
      保存
    </DtButton>
  </div>
</template>
