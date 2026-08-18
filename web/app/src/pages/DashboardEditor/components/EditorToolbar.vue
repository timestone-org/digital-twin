<script setup lang="ts">
/**
 * @fileoverview 编辑器动作条：撤销重做、吸附控件与整理、画布缩放、
 * 快捷键帮助与保存。工具条自己不改文档，只把动作抛给页面统一编排。
 *
 * ⚠ 版本冲突时**保存被挡住**：这条路径的唯一出口是「重新加载」（ADR-0012）。
 * ⚠ 只放**任何时候都可能用**的入口。对齐与分布要先多选才成立，多选时右栏
 * 本来就摆着它们（`MultiSelectPanel`），摆在这里等于让一排常年禁用的键
 * 占着顶栏最贵的横向空间。
 */
import type { DtSegmentedOption, DtSelectOption } from '@dt/contracts'
import { DtButton, DtSegmented, DtSelect, DtTag } from '@dt/ui'
import { computed } from 'vue'

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
}>()

const emit = defineEmits<{
  undo: []
  redo: []
  save: []
  reload: []
  'update:zoom': [zoom: CanvasZoom]
  'set-snap': [patch: Partial<SnapConfig>]
  tidy: []
  help: []
  preview: []
  export: []
}>()

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
        icon="redo"
        aria-label="重做"
        title="重做"
        data-test="redo"
        :disabled="!canRedo"
        @click="emit('redo')"
      />
    </div>

    <div class="dt-toolbar__group">
      <DtButton
        size="sm"
        :variant="snap.enabled ? 'soft' : 'ghost'"
        :intent="snap.enabled ? 'primary' : 'neutral'"
        icon="magnet"
        aria-label="吸附总开关"
        title="吸附总开关"
        data-test="snap-enabled"
        :aria-pressed="snap.enabled"
        @click="emit('set-snap', { enabled: !snap.enabled })"
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
      <DtButton
        size="sm"
        :variant="snap.guides ? 'soft' : 'ghost'"
        :intent="snap.guides ? 'primary' : 'neutral'"
        icon="guides"
        aria-label="智能参考线"
        title="智能参考线"
        data-test="snap-guides"
        :aria-pressed="snap.guides"
        @click="emit('set-snap', { guides: !snap.guides })"
      />
      <!-- 整理与吸附同类：都是「让东西摆整齐」，且都不要求先选中什么 -->
      <DtButton
        size="sm"
        variant="ghost"
        intent="neutral"
        icon="layout-grid"
        aria-label="整理布局"
        title="整理布局：消重叠并钳回边界"
        data-test="tidy"
        @click="emit('tidy')"
      />
    </div>

    <div class="dt-toolbar__group">
      <!-- ⚠ 定宽：不定的话下拉宽度跟着当前档的字数走，从「适应窗口 62%」切到
           「100%」整条工具栏右半边会横着跳一下。宽度按最长的那档「适应窗口 100%」留 -->
      <DtSelect
        size="sm"
        class="w-36 shrink-0"
        aria-label="画布缩放"
        data-test="zoom"
        :model-value="zoomValue"
        :options="zoomOptions"
        :display="{ searchable: false }"
        @update:model-value="pickZoom"
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
        icon="keyboard"
        aria-label="快捷键帮助"
        title="快捷键帮助"
        data-test="help"
        @click="emit('help')"
      />
    </div>

    <!-- 文件组：出入与落盘。保存是全条唯一的实心键，它是这里的终点 -->
    <div class="dt-toolbar__group">
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
// 窄屏时横向滚动，**不换行**：顶栏是定高的一行，换行会把第二行挤出可视区，
// 于是保存键在窄屏上直接消失——而滚动至少还够得着。
.dt-toolbar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  overflow-x: auto;
  // ⚠ 必须显式写 overflow-y：只给 overflow-x 时另一轴会被算成 auto，焦点圈
  // （全局是 outline 2px + offset 2px）一露头就冒出一条竖滚动条
  overflow-y: hidden;
  // 上下各让出焦点圈那 4px，再用负外边距抵掉——否则 hidden 会把圈裁掉半边
  padding-block: 4px;
  margin-block: -4px;

  // 顶栏只有 64px 高，全局那条 10px 的滚动条在这儿太占地方
  &::-webkit-scrollbar {
    height: 6px;
  }

  &__group {
    display: flex;
    // ⚠ 不许压缩：压缩了图标键会先被挤成一条缝，而不是滚起来
    flex: none;
    gap: 4px;
    align-items: center;
  }

  // 组间那道竖线只有 16px 高、两侧各留 8px：整条边框会把每一组框成一个盒子，
  // 一排盒子挨着看反而更乱
  &__group:not(:last-child)::after {
    content: '';
    width: 1px;
    height: 16px;
    margin: 0 8px;
    background: var(--border-subtle);
  }
}
</style>
