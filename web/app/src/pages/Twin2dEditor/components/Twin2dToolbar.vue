<script setup lang="ts">
/**
 * @fileoverview 2D 孪生编辑器的顶栏动作：撤销重做、适应画布、诊断计数与保存。
 * 挂在 `AppShell` 的 actions 插槽里，与另外两个编辑器同一处；返回入口由外壳出，
 * 这里不再自带一个，免得同一行上有两个「返回」。
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
  /**
   * 当前上屏的倍率读数；空串 = 还不知道这块在大屏上占多大，那一档整个不摆。
   * ⚠ 只收算好的一句话，不收尺寸自己算：倍率的算法归 `stageFit` 一份，工具栏
   * 再算一次的话，按钮上写的与画布角上写的迟早各说各话。
   */
  parityText: string
  /** 已经是 1:1；对齐那一下没有可做的事。 */
  parityExact: boolean
  /** 画布已经贴着内容裁好了；裁那一下没有可做的事。 */
  cropExact: boolean
  /** 按格子对齐会把内容裁到画布外；这一枚因此按不动。 */
  alignCrops: boolean
}>()

const emit = defineEmits<{
  save: []
  undo: []
  redo: []
  fit: []
  alignCell: []
  cropToContent: []
  toggleIssues: []
}>()

const hasIssues = computed(() => props.issueCount > 0)

const hasCell = computed(() => props.parityText !== '')

/** 裁那一下会做什么；它改的是画布尺寸与全图位置，不是视口缩放。 */
const cropTitle = computed(() =>
  props.cropExact
    ? '画布已经贴着内容，四周没有多余的空白'
    : '把画布裁到内容那么大，去掉四周的白边（不改图上任何一件的相对位置）',
)

/** 对齐那一下会做什么，写在悬浮提示里——它改的是画布尺寸，不是视口缩放。 */
const alignTitle = computed(() => {
  if (props.alignCrops) {
    return '按不动：这张图比大屏格子大，按格子缩画布会把外面的节点整个裁掉——先把图收小，或把大屏上这块格子调大'
  }
  return props.parityExact
    ? '画布已经按大屏格子配好，编辑的一像素就是大屏上的一像素'
    : `把画布尺寸设成 1:1 的设计尺寸（当前${props.parityText}）`
})
</script>

<template>
  <div class="dt-twin2d-bar" role="toolbar" aria-label="2D 孪生编辑器工具条">
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

    <span class="dt-twin2d-bar__sep" />

    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      icon="search"
      aria-label="适应画布"
      title="适应画布"
      data-test="fit"
      @click="emit('fit')"
    />

    <DtButton
      v-if="hasCell"
      size="sm"
      :variant="parityExact ? 'ghost' : 'soft'"
      :intent="parityExact ? 'neutral' : 'warning'"
      icon="ruler"
      :aria-label="alignTitle"
      :title="alignTitle"
      data-test="align-cell"
      :disabled="parityExact || alignCrops"
      @click="emit('alignCell')"
    >
      {{ parityExact ? '1:1' : parityText }}
    </DtButton>

    <DtButton
      size="sm"
      variant="ghost"
      intent="neutral"
      icon="magnet"
      aria-label="画布裁到内容"
      :title="cropTitle"
      data-test="crop-content"
      :disabled="cropExact"
      @click="emit('cropToContent')"
    />

    <span class="dt-twin2d-bar__sep" />

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
.dt-twin2d-bar {
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
