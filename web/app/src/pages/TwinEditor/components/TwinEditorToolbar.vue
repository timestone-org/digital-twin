<script setup lang="ts">
/**
 * @fileoverview 孪生编辑器顶栏：返回大屏、撤销重做、诊断计数与保存。
 * 工具栏自己不改文档，只把动作抛给页面统一编排。
 */
import { DtButton, DtTag } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  isDirty: boolean
  isSaving: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  /** 返回大屏编辑器用。 */
  backLabel: string
}>()

const emit = defineEmits<{
  save: []
  undo: []
  redo: []
  back: []
  toggleIssues: []
}>()

const hasIssues = computed(() => props.issueCount > 0)
</script>

<template>
  <div class="dt-twin-bar" role="toolbar" aria-label="孪生编辑器工具条">
    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      icon="chevron-left"
      data-test="back"
      @click="emit('back')"
    >
      {{ backLabel }}
    </DtButton>

    <span class="dt-twin-bar__sep" />

    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      icon="undo"
      aria-label="撤销"
      title="撤销"
      data-test="undo"
      :disabled="!canUndo"
      @click="emit('undo')"
    />
    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      icon="redo"
      aria-label="重做"
      title="重做"
      data-test="redo"
      :disabled="!canRedo"
      @click="emit('redo')"
    />

    <span class="dt-twin-bar__sep" />

    <!-- 计数写在按钮上：诊断面板默认收着，不写数字就没人知道它有内容 -->
    <DtButton
      size="sm"
      :variant="hasIssues ? 'soft' : 'ghost'"
      :intent="hasIssues ? 'danger' : 'neutral'"
      :icon="hasIssues ? 'alert-circle' : 'check'"
      :aria-label="`配置问题 ${issueCount} 条`"
      :title="`配置问题 ${issueCount} 条`"
      data-test="issues"
      @click="emit('toggleIssues')"
    >
      {{ issueCount }}
    </DtButton>

    <span class="dt-twin-bar__spacer" />

    <DtTag v-if="isDirty" size="sm" intent="warning">未保存</DtTag>
    <DtButton
      size="sm"
      icon="save"
      data-test="save"
      :loading="isSaving"
      :disabled="!isDirty"
      @click="emit('save')"
    >
      保存
    </DtButton>
  </div>
</template>

<style scoped lang="scss">
.dt-twin-bar {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border-subtle);

  &__sep {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--border-subtle);
  }

  &__spacer {
    flex: 1;
  }
}
</style>
