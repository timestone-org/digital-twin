<script setup lang="ts">
/**
 * @fileoverview 编辑器动作条：撤销重做、对齐分布与整理、吸附控件、画布缩放、
 * 快捷键帮助与保存。工具条自己不改文档，只把动作抛给页面统一编排。
 * ⚠ 版本冲突时**保存被挡住**：这条路径的唯一出口是「重新加载」（ADR-0012）。
 */
import type { DtSegmentedOption, DtSelectOption } from '@dt/contracts'
import { DtButton, DtSegmented, DtSelect, DtSwitch, DtTag } from '@dt/ui'
import { computed } from 'vue'

import ToolbarArrange from './ToolbarArrange.vue'

import type { AlignKind } from '@/features/dashboard/canvasAlign'
import { SNAP_STEP_PRESETS } from '@/features/dashboard/canvasSnap'
import type { SnapConfig } from '@/features/dashboard/canvasSnap'
import { ZOOM_PRESETS, zoomPercent } from '@/features/dashboard/canvasZoom'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'

const props = defineProps<{
  isDirty: boolean
  canUndo: boolean
  canRedo: boolean
  saving: boolean
  hasConflict: boolean
  /** null = 跟随适应窗口。 */
  zoom: CanvasZoom
  /** 适应窗口的实际倍率，「适应」那一档要显示它才知道被压到了多少。 */
  fitScale: number
  snap: SnapConfig
  /** 同层级选中 ≥2 个。 */
  alignReady: boolean
  /** 同层级选中 ≥3 个。 */
  distributeReady: boolean
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  save: []
  reload: []
  'update:zoom': [zoom: CanvasZoom]
  'set-snap': [patch: Partial<SnapConfig>]
  align: [kind: AlignKind]
  distribute: [axis: 'x' | 'y']
  tidy: []
  help: []
  preview: []
  export: []
}>()

/** 对齐六键：文字取一个字，读屏与悬浮提示读全名。 */
const SNAP_MODES: readonly DtSegmentedOption[] = [
  { value: 'grid', label: '栅格' },
  { value: 'px', label: '像素' },
]

const STEP_OPTIONS: readonly DtSelectOption[] = SNAP_STEP_PRESETS.map(
  (step) => ({ value: String(step), label: `${step}px` }),
)

/** 适应档要显示**真实** letterbox 倍率，否则用户不知道自己被压到了多少。 */
const zoomOptions = computed<DtSelectOption[]>(() => [
  { value: 'fit', label: `适应窗口 ${zoomPercent(props.fitScale)}` },
  ...ZOOM_PRESETS.map((preset) => ({
    value: String(preset),
    label: zoomPercent(preset),
  })),
])

const zoomValue = computed(() =>
  props.zoom === null ? 'fit' : String(props.zoom),
)

function pickZoom(value: string): void {
  emit('update:zoom', value === 'fit' ? null : Number(value))
}

function pickMode(value: string): void {
  emit('set-snap', { mode: value === 'px' ? 'px' : 'grid' })
}

function pickStep(value: string): void {
  emit('set-snap', { step: Number(value) })
}
</script>

<template>
  <div class="dt-toolbar" role="toolbar" aria-label="编辑器工具条">
    <div class="dt-toolbar__group">
      <DtButton
        size="sm"
        variant="ghost"
        icon="chevron-left"
        aria-label="撤销"
        title="撤销"
        data-test="undo"
        :disabled="!canUndo"
        @click="emit('undo')"
      />
      <DtButton
        size="sm"
        variant="ghost"
        icon="chevron-right"
        aria-label="重做"
        title="重做"
        data-test="redo"
        :disabled="!canRedo"
        @click="emit('redo')"
      />
    </div>

    <div class="dt-toolbar__group">
      <ToolbarArrange
        :align-ready="alignReady"
        :distribute-ready="distributeReady"
        @align="emit('align', $event)"
        @distribute="(axis) => emit('distribute', axis)"
        @tidy="emit('tidy')"
      />
    </div>

    <div class="dt-toolbar__group">
      <DtSwitch
        size="sm"
        label="吸附"
        aria-label="吸附总开关"
        data-test="snap-enabled"
        :model-value="snap.enabled"
        @update:model-value="emit('set-snap', { enabled: $event })"
      />
      <DtSegmented
        size="sm"
        aria-label="吸附模式"
        data-test="snap-mode"
        :model-value="snap.mode"
        :options="SNAP_MODES"
        @update:model-value="pickMode"
      />
      <DtSelect
        size="sm"
        aria-label="像素步进"
        data-test="snap-step"
        :model-value="String(snap.step)"
        :options="STEP_OPTIONS"
        :disabled="snap.mode !== 'px'"
        @update:model-value="pickStep"
      />
      <DtSwitch
        size="sm"
        label="参考线"
        aria-label="智能参考线"
        data-test="snap-guides"
        :model-value="snap.guides"
        @update:model-value="emit('set-snap', { guides: $event })"
      />
    </div>

    <div class="dt-toolbar__group">
      <DtSelect
        size="sm"
        aria-label="画布缩放"
        data-test="zoom"
        :model-value="zoomValue"
        :options="zoomOptions"
        @update:model-value="pickZoom"
      />
      <DtButton
        size="sm"
        variant="ghost"
        icon="circle-question"
        aria-label="快捷键帮助"
        title="快捷键帮助"
        data-test="help"
        @click="emit('help')"
      />
      <DtButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="play"
        aria-label="预览"
        title="预览"
        data-test="preview"
        @click="emit('preview')"
      />
      <DtButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="download"
        aria-label="导出 JSON"
        title="导出 JSON"
        data-test="export"
        @click="emit('export')"
      />
      <DtTag v-if="hasConflict" size="sm" intent="danger">版本已过期</DtTag>
      <DtTag v-else-if="isDirty" size="sm" intent="warning">未保存</DtTag>
      <DtButton
        size="sm"
        variant="outline"
        icon="refresh-cw"
        data-test="reload"
        @click="emit('reload')"
      >
        重新加载
      </DtButton>
      <DtButton
        size="sm"
        icon="check"
        data-test="save"
        :loading="saving"
        :disabled="hasConflict || !isDirty"
        @click="emit('save')"
      >
        保存
      </DtButton>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;

  &__group {
    display: flex;
    gap: 4px;
    align-items: center;
    padding-right: 8px;
    border-right: 1px solid var(--border-subtle);

    &:last-child {
      padding-right: 0;
      border-right: 0;
    }
  }
}
</style>
