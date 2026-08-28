<script setup lang="ts">
/**
 * @fileoverview 样式预览：拿一个临时节点跑 `Twin2dNodeBox`，边改样式边看最终节点长
 * 什么样，并把交互态、状态四档、尺寸与示例读数摆成开关——变体配了不切换就一格都看不见。
 *
 * ⚠ 渲染件复用 `@dt/twin2d` 的 `Twin2dNodeBox`，不另画一份示意图：编辑器与大屏所见即
 *   所得靠的就是两边同一个渲染件，示意图会把「这个样式长什么样」推回给用户去试。
 * ⚠ 收的是**当下生效**的那一份样式（文档里的优先，落不到才回预置库）：喂预置库那一份
 *   会让预览里看不到自己刚落下的那份覆盖，而界面上只表现为「改了没反应」（§13.4）。
 * ⚠ 本层不挂 sprite 宿主（`Twin2dIconSprite`）：那是画布壳的活，两处都挂会让同一份
 *   symbol 在文档里重号，而重号之后浏览器只认头一个。
 * ⚠ **不喂 `idPrefix`**，让 `Twin2dNodeBox` 回落它自己那份 `useId()`：局部渐变的 DOM id
 *   是 `t2g-<前缀>-<渐变 id>`，按样式 id 拼前缀的话，同一份样式的两张预览（右栏一张、
 *   编辑面一张，开编辑面时必然同时在场）会把同一个 id 写两遍，`url(#…)` 只认头一个，
 *   于是第二张的渐变悄悄取到第一张那份。sprite 的 `<use href="#…">` 指的是**全局**
 *   symbol id、本就不带实例前缀，那一路不受影响。
 * ⚠ 图标的 `asset` 一档在这里解析不出地址（不注入 `resolveIcon`），那一枝整个不渲染，
 *   与调色板缩略图同口径。
 * ⚠ 五档交互态里只有 `hover` 有运行期驱动（`Twin2dNodeBox` 自检），另外四档舞台目前
 *   一档都不喂；这里照样摆出来，否则配了那几条变体连在编辑器里都验不了。
 */
import { TWIN_2D_STATES, TWIN_2D_STATUSES, Twin2dNodeBox } from '@dt/twin2d'
import type {
  Twin2dNodeSize,
  Twin2dNodeStyle,
  Twin2dState,
  Twin2dStatus,
} from '@dt/twin2d'
import { DtButton, DtNumberInput, DtSegmented, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { enumOptions } from '../scripts/inspectorFields'
import {
  TWIN_2D_PREVIEW_SAMPLE,
  TWIN_2D_PREVIEW_STATE_LABELS,
  TWIN_2D_PREVIEW_STATUS_LABELS,
  twin2dPreviewFit,
  twin2dPreviewShots,
} from '../scripts/stylePreview'

/** 缩略框最多放大几倍：接线点只有 6×6，按框铺满会糊成一大块。 */
const MAX_ZOOM = 3

/** 预览框的缺省边长（CSS 像素）。 */
const DEFAULT_BOX: Twin2dNodeSize = { w: 208, h: 132 }

/** 尺寸取值域；0 与负数画不出东西来。 */
const SIZE_RANGE = { min: 1, step: 1, precision: 0 }

/** 示例读数取值域：负数也是合法读数，所以不给上下限。 */
const SAMPLE_RANGE = { step: 1 }

/** 跟样式缺省状态走的那一档。 */
const STATUS_INHERIT = ''

const STATUS_OPTIONS = [
  { value: STATUS_INHERIT, label: '跟样式缺省' },
  ...enumOptions(TWIN_2D_STATUSES, TWIN_2D_PREVIEW_STATUS_LABELS),
]

/** 尺寸两档。 */
const SIZE_OPTIONS = [
  { value: 'style', label: '样式缺省' },
  { value: 'custom', label: '自定义' },
]

const props = defineProps<{
  /** 当下生效的那一份样式（文档 ∪ 预置库，调用方解析好）。 */
  nodeStyle: Twin2dNodeStyle
  /** 预览框的边长（CSS 像素）。 */
  box?: Twin2dNodeSize
  /** 只画一张缩略图，那排开关整个不出。 */
  compact?: boolean
}>()

// ⚠ 两项缺省都走 computed，不走 withDefaults：`defineProps` 会被提到 setup 外，
// 缺省工厂里引用不了模块里的常量；而 exactOptionalPropertyTypes 下 withDefaults
// 的读取端本来也仍是 `| undefined`，往下传照样在调用点报错
const box = computed<Twin2dNodeSize>(() => props.box ?? DEFAULT_BOX)
const compact = computed(() => props.compact ?? false)

const states = ref<Twin2dState[]>([])
const status = ref<string>(STATUS_INHERIT)
const sizeMode = ref<string>('style')
const sample = ref<number | undefined>(TWIN_2D_PREVIEW_SAMPLE)
const custom = ref<Twin2dNodeSize>({ ...DEFAULT_BOX })

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
// ⚠ 换样式时自定义尺寸跟着回到新样式的缺省：留着上一份的数，切过去第一眼看到的是
// 一个被拉伸过的符号，而尺寸格里写着的正是那两个数，看不出哪里不对
watch(
  () => props.nodeStyle.id,
  () => {
    custom.value = { ...props.nodeStyle.size }
  },
  { immediate: true },
)

const sizeOverride = computed<Twin2dNodeSize | null>(() =>
  sizeMode.value === 'custom' ? custom.value : null,
)

const shots = computed(() =>
  twin2dPreviewShots(props.nodeStyle, {
    size: sizeOverride.value,
    flipped: states.value.includes('flipped'),
    sample: sample.value ?? null,
  }),
)

const statusOverride = computed<Twin2dStatus | null>(
  () => TWIN_2D_STATUSES.find((item) => item === status.value) ?? null,
)

/**
 * 这一档交互态开着没有。
 * @param state 五档之一
 */
function isOn(state: Twin2dState): boolean {
  return states.value.includes(state)
}

/**
 * 开关一档交互态。
 * @param state 五档之一
 */
function toggle(state: Twin2dState): void {
  states.value = isOn(state)
    ? states.value.filter((item) => item !== state)
    : [...states.value, state]
}

/**
 * 换一档状态；认不出的取值退回「跟样式缺省」。
 * @param value 下拉给回来的裸字符串
 */
function setStatus(value: string): void {
  status.value =
    TWIN_2D_STATUSES.find((item) => item === value) ?? STATUS_INHERIT
}

/**
 * 换一档尺寸来源；认不出的取值当没切。
 * @param value 分段控件给回来的裸字符串
 */
function setSizeMode(value: string): void {
  const found = SIZE_OPTIONS.find((item) => item.value === value)
  if (found === undefined) return
  // ⚠ 进自定义档时按**当下**的样式缺省重新种一次：只在换样式 id 时种的话，
  //   同一份样式改完缺省尺寸再切过来，种进去的还是改之前那两个数
  if (found.value === 'custom') custom.value = { ...props.nodeStyle.size }
  sizeMode.value = found.value
}

/**
 * 改自定义尺寸的一轴，另一轴原样带着。
 * @param axis 动的是哪一轴
 * @param value 新值；空框退回样式缺省
 */
function setCustom(axis: 'w' | 'h', value: number | undefined): void {
  const fallback = props.nodeStyle.size[axis]
  custom.value =
    axis === 'w'
      ? { ...custom.value, w: value ?? fallback }
      : { ...custom.value, h: value ?? fallback }
}
</script>

<template>
  <div class="flex flex-col gap-2" data-test="style-preview">
    <div
      class="t2sp-stage"
      :style="{ '--t2sp-w': `${box.w}px`, '--t2sp-h': `${box.h}px` }"
      data-test="style-preview-stage"
    >
      <span
        v-for="shot in shots"
        :key="shot.node.id"
        class="t2sp-fit"
        :style="twin2dPreviewFit(box, shot.size, MAX_ZOOM)"
      >
        <Twin2dNodeBox
          :node="shot.node"
          :node-style="nodeStyle"
          :status="statusOverride"
          :states="states"
          :slot-values="shot.slots"
          :read-slot="shot.readSlot"
        />
      </span>
      <span class="t2sp-size" data-test="style-preview-size">
        {{ shots[0]?.size.w ?? nodeStyle.size.w }} ×
        {{ shots[0]?.size.h ?? nodeStyle.size.h }}
      </span>
    </div>

    <div v-if="!compact" class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-1" data-test="style-preview-states">
        <DtButton
          v-for="state in TWIN_2D_STATES"
          :key="state"
          size="xs"
          :pressed="isOn(state)"
          :data-test="`style-preview-state-${state}`"
          @click="toggle(state)"
        >
          {{ TWIN_2D_PREVIEW_STATE_LABELS[state] }}
        </DtButton>
      </div>

      <DtSelect
        :model-value="status"
        :options="STATUS_OPTIONS"
        label="状态"
        hint="数据线上的状态覆盖，看的是状态变体与状态点"
        size="sm"
        data-test="style-preview-status"
        @update:model-value="setStatus"
      />

      <DtSegmented
        :model-value="sizeMode"
        :options="SIZE_OPTIONS"
        size="sm"
        block
        aria-label="预览尺寸"
        data-test="style-preview-size-mode"
        @update:model-value="setSizeMode"
      />

      <div v-if="sizeMode === 'custom'" class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="custom.w"
          :range="SIZE_RANGE"
          label="宽"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="style-preview-w"
          @update:model-value="setCustom('w', $event)"
        />
        <DtNumberInput
          :model-value="custom.h"
          :range="SIZE_RANGE"
          label="高"
          unit="px"
          size="sm"
          :steppers="false"
          data-test="style-preview-h"
          @update:model-value="setCustom('h', $event)"
        />
      </div>

      <DtNumberInput
        :model-value="sample"
        :range="SAMPLE_RANGE"
        label="示例读数"
        hint="清空 = 每个槽位都出自己的占位符；配了词表的槽固定取表里头一档"
        size="sm"
        :steppers="false"
        data-test="style-preview-sample"
        @update:model-value="sample = $event"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
// 预览框：溢出的部分（画在盒外的标签这类）裁掉
.t2sp-stage {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: var(--t2sp-h);
  min-width: var(--t2sp-w);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
}

.t2sp-fit {
  position: absolute;
  top: 50%;
  left: 50%;
}

.t2sp-size {
  position: absolute;
  right: 4px;
  bottom: 2px;
  color: var(--text-disabled);
  font-size: 10px;
  pointer-events: none;
}
</style>
