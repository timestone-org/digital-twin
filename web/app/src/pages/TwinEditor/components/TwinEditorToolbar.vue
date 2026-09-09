<script setup lang="ts">
/**
 * @fileoverview 孪生编辑器的顶栏动作：撤销重做、诊断计数与保存。
 * 挂在 `AppShell` 的 actions 插槽里，与大屏编辑器同一处；返回入口由外壳出，
 * 这里不再自带一个，免得同一行上有两个「返回」。
 * 工具栏自己不改文档，只把动作抛给页面统一编排。
 */
import type { TwinNavigationMode } from '@dt/twin-config'
import { DtButton, DtSegmented, DtTag } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{
  isDirty: boolean
  isSaving: boolean
  canUndo: boolean
  canRedo: boolean
  issueCount: number
  navigationMode: TwinNavigationMode
}>()

const emit = defineEmits<{
  save: []
  undo: []
  redo: []
  toggleIssues: []
  'update:navigationMode': [mode: TwinNavigationMode]
}>()

const hasIssues = computed(() => props.issueCount > 0)
const NAVIGATION_OPTIONS = [
  { value: 'orbit', label: '轨道操作' },
  { value: 'game', label: '游戏操作' },
] as const

/** 分段控件给回来的是裸字符串；只接受已声明的两档。 */
function onNavigationMode(value: string): void {
  const option = NAVIGATION_OPTIONS.find((item) => item.value === value)
  if (option !== undefined) emit('update:navigationMode', option.value)
}
</script>

<template>
  <div class="dt-twin-bar" role="toolbar" aria-label="孪生编辑器工具条">
    <DtSegmented
      :model-value="navigationMode"
      :options="NAVIGATION_OPTIONS"
      size="sm"
      aria-label="编辑视口操作模式"
      @update:model-value="onNavigationMode"
    />

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

  &__sep {
    width: 1px;
    height: 16px;
    margin: 0 4px;
    background: var(--border-subtle);
  }
}
</style>
