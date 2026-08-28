<script setup lang="ts">
/**
 * @fileoverview 画布检查器：这张图自己的坐标系（宽高）、网格、底图与四档铺法、
 * 底纹四档与它的颜色/间距/线宽。收整份配置，产出整份新配置往上抛，
 * 本组件一处都不碰文档态与撤销栈。
 *
 * ⚠ 画布宽高与大屏的 `designWidth/Height` **无关**：这是这张图自己的坐标系，上到
 *   大屏后按 §9.1 等比缩放贴进模块矩形。两者混为一谈的表现是「改了画布宽高想换大屏
 *   分辨率，结果只有图上所有线宽跟着变」，所以这一节把话写在面上。
 * ⚠ 「按格子对齐」那一下不在这里，在顶栏：它要知道这块模块在大屏上占多大，而那是
 *   页面从大屏节点上读出来的，本组件只收整份配置。
 * ⚠ 底图与底纹的取值不在这里消毒：消毒连同「被拒的值回落缺省并进诊断」是渲染层
 *   `cssValue.ts` 的事（§11.5），在这里先拦一道会让用户看不出自己填的值哪里不合口径。
 * ⚠ 文本与数字一律走合并撤销（`merge` + 焦点离开时 `endMerge`）：逐帧各记一条的话，
 *   敲一个底图地址就往撤销栈里塞进几十格，撤销键从此按不回上一步。
 * ⚠ 不生效的控件一律不摆：没配底图就没有铺法可言，底纹关着时颜色/间距/线宽同理。
 */
import {
  TWIN_2D_BACKGROUND_FITS,
  TWIN_2D_MAX_GRID,
  TWIN_2D_MIN_CANVAS_SIZE,
  TWIN_2D_MIN_GRID,
  TWIN_2D_PATTERNS,
} from '@dt/twin2d'
import type {
  Twin2dBackgroundFit,
  Twin2dCanvas,
  Twin2dConfig,
  Twin2dPattern,
} from '@dt/twin2d'
import { DtInput, DtNumberInput, DtSegmented, DtSwitch } from '@dt/ui'
import { computed } from 'vue'

import { enumOptions, fieldsChanged } from '../../scripts/inspectorFields'
import ColorField from '../fields/ColorField.vue'

const props = defineProps<{
  /** 整份配置；画布就是它的 `canvas` 那一块。 */
  config: Twin2dConfig
}>()

const emit = defineEmits<{
  /** 一次性改动，落一帧撤销。 */
  change: [config: Twin2dConfig]
  /** 连续输入：同 `key` 的连着并成一帧。 */
  merge: [config: Twin2dConfig, key: string]
  /** 焦点离开输入框，这一段连续输入到此为止。 */
  endMerge: []
}>()

const FIT_LABELS: Readonly<Record<Twin2dBackgroundFit, string>> = {
  cover: '覆盖',
  contain: '完整',
  stretch: '拉伸',
  tile: '平铺',
}

const PATTERN_LABELS: Readonly<Record<Twin2dPattern, string>> = {
  none: '无',
  weave: '编织',
  dots: '点阵',
  lines: '斜线',
}

const FIT_OPTIONS = enumOptions(TWIN_2D_BACKGROUND_FITS, FIT_LABELS)
const PATTERN_OPTIONS = enumOptions(TWIN_2D_PATTERNS, PATTERN_LABELS)

/** ⚠ 下限与归一化同一份常量：抄一个数在这里，改常量时这一格会悄悄放行更小的画布。 */
const SIZE_RANGE = { min: TWIN_2D_MIN_CANVAS_SIZE, step: 10 }
const GRID_RANGE = {
  min: TWIN_2D_MIN_GRID,
  max: TWIN_2D_MAX_GRID,
  step: 1,
  precision: 0,
}
const GAP_RANGE = { min: TWIN_2D_MIN_GRID, max: TWIN_2D_MAX_GRID, step: 1 }
const PATTERN_WIDTH_RANGE = { min: 0.5, max: 20, step: 0.5 }

const canvas = computed<Twin2dCanvas>(() => props.config.canvas)
const hasBackground = computed(() => canvas.value.background !== '')
const hasPattern = computed(() => canvas.value.pattern !== 'none')

/**
 * 这个补丁里至少有一个字段与现值不同。
 * ⚠ 数字框每次失焦都回抛一次当前值，不比一遍的话「点进去又点出来」就白记一帧撤销。
 * @param patch 待写入的字段
 */
function changed(patch: Partial<Twin2dCanvas>): boolean {
  return fieldsChanged({ ...canvas.value }, { ...patch })
}

/**
 * 把补丁落到整份配置上。
 * @param patch 待写入的字段
 */
function patched(patch: Partial<Twin2dCanvas>): Twin2dConfig {
  return { ...props.config, canvas: { ...canvas.value, ...patch } }
}

/**
 * 一次性改动。
 * @param patch 待写入的字段
 */
function write(patch: Partial<Twin2dCanvas>): void {
  if (changed(patch)) emit('change', patched(patch))
}

/**
 * 连续输入：同一格里连着敲并成一帧撤销。
 * @param patch 待写入的字段
 * @param field 这一格的名字，参与合并键
 */
function writeMerged(patch: Partial<Twin2dCanvas>, field: string): void {
  if (changed(patch)) emit('merge', patched(patch), `canvas:${field}`)
}

function endMerge(): void {
  emit('endMerge')
}

function writeFit(next: string): void {
  const found = TWIN_2D_BACKGROUND_FITS.find((item) => item === next)
  if (found !== undefined) write({ backgroundFit: found })
}

function writePattern(next: string): void {
  const found = TWIN_2D_PATTERNS.find((item) => item === next)
  if (found !== undefined) write({ pattern: found })
}

/**
 * 网格步长；空框落回下限而不是 0——0 会让吸附整个静默失效。
 * @param next 新值
 */
function writeGrid(next: number | undefined): void {
  writeMerged({ grid: next ?? TWIN_2D_MIN_GRID }, 'grid')
}
</script>

<template>
  <div
    class="flex flex-col gap-4"
    data-test="canvas-inspector"
    @focusout="endMerge"
  >
    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">尺寸</h3>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="canvas.width"
          :range="SIZE_RANGE"
          label="宽"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="canvas-width"
          @update:model-value="
            writeMerged({ width: $event ?? TWIN_2D_MIN_CANVAS_SIZE }, 'width')
          "
        />
        <DtNumberInput
          :model-value="canvas.height"
          :range="SIZE_RANGE"
          label="高"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="canvas-height"
          @update:model-value="
            writeMerged({ height: $event ?? TWIN_2D_MIN_CANVAS_SIZE }, 'height')
          "
        />
      </div>
      <p class="text-xs text-text-disabled" data-test="canvas-size-hint">
        这是这张图自己的坐标系，与大屏分辨率无关：上到大屏后整张图等比缩放贴进模块的
        矩形。想让这里的一像素就是大屏上的一像素，用顶栏那枚标尺按钮按格子对齐一次。
      </p>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">网格</h3>
      <DtSwitch
        :model-value="canvas.showGrid"
        label="显示网格"
        size="sm"
        data-test="canvas-show-grid"
        @update:model-value="write({ showGrid: $event })"
      />
      <DtNumberInput
        :model-value="canvas.grid"
        :range="GRID_RANGE"
        label="网格步长"
        unit="px"
        size="sm"
        :steppers="false"
        data-test="canvas-grid"
        @update:model-value="writeGrid"
      />
      <p class="text-xs text-text-disabled">
        网格步长也是吸附的步长，关掉显示不影响吸附。
      </p>
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">底图</h3>
      <DtInput
        :model-value="canvas.background"
        label="底图"
        placeholder="asset:… / https://… / data:… / CSS 简写"
        size="sm"
        data-test="canvas-background"
        @update:model-value="writeMerged({ background: $event }, 'background')"
      />
      <p class="text-xs text-text-disabled">
        四种写法：素材库的 asset:编号、图片网址、data: 内联图，或一段 CSS
        background
        简写（渐变写在这里）。前三种是图片，下面那档铺法对它们生效；CSS
        简写自带铺法。
      </p>
      <DtSegmented
        v-if="hasBackground"
        :model-value="canvas.backgroundFit"
        :options="FIT_OPTIONS"
        aria-label="底图铺法"
        block
        data-test="canvas-background-fit"
        @update:model-value="writeFit"
      />
    </section>

    <section class="flex flex-col gap-2">
      <h3 class="text-xs font-medium text-text-secondary">底纹</h3>
      <DtSegmented
        :model-value="canvas.pattern"
        :options="PATTERN_OPTIONS"
        aria-label="底纹图案"
        block
        data-test="canvas-pattern"
        @update:model-value="writePattern"
      />
      <template v-if="hasPattern">
        <ColorField
          :model-value="canvas.patternColor"
          label="底纹颜色"
          hint="留空 = 一层很淡的强调色"
          @update:model-value="
            writeMerged({ patternColor: $event }, 'patternColor')
          "
          @blur="endMerge"
        />
        <div class="grid grid-cols-2 gap-1.5">
          <DtNumberInput
            :model-value="canvas.patternGap"
            :range="GAP_RANGE"
            label="间距"
            unit="px"
            size="sm"
            :steppers="false"
            data-test="canvas-pattern-gap"
            @update:model-value="
              writeMerged({ patternGap: $event ?? TWIN_2D_MIN_GRID }, 'gap')
            "
          />
          <DtNumberInput
            :model-value="canvas.patternWidth"
            :range="PATTERN_WIDTH_RANGE"
            label="线宽"
            unit="px"
            size="sm"
            :steppers="false"
            data-test="canvas-pattern-width"
            @update:model-value="
              writeMerged({ patternWidth: $event ?? 1 }, 'patternWidth')
            "
          />
        </div>
      </template>
    </section>
  </div>
</template>
