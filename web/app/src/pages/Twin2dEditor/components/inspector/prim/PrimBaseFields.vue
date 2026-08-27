<script setup lang="ts">
/**
 * @fileoverview 四种图元共有的那十五项：摆位、尺寸、层与不透明、渲染条件、动效、
 * 变换与指针。四个分档面各自把它嵌在自己最前面。
 *
 * ⚠ 「不动」写回的是 `anim: null` 而不是 `{ kind: 'none' }`：两者渲染完全一样，
 *   留两种写法会让同一份样式序列化出两种 JSON，而 diff 上看着像有人改过。
 * ⚠ `anim` 与 `transition` 是两件事，不能互相顶：前者是循环播放，后者是属性变化的
 *   补间。少配一个的表现是「哪儿都能配、就是手感不一样」，没有一处报错。
 * ⚠ `z` 与文档序是两条线：文档序是 DOM 序，`z` 落成 CSS `z-index`，两者不一致时看到
 *   的是 `z` 说了算——「上移一层没反应」通常就是这一格里配了数。
 * ⚠ 等比缩放不许压到 0：0 会让整枝塌成一个点，而归一化只会把它顶回 1，用户看到的是
 *   「填了没生效」。下限钉在 0.01。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import {
  TWIN_2D_ANIM_KINDS,
  TWIN_2D_POINTER_EVENTS,
  sanitizeCssValue,
} from '@dt/twin2d'
import type {
  Twin2dAnimKind,
  Twin2dCondition,
  Twin2dLen,
  Twin2dPlacement,
  Twin2dPointerEvents,
  Twin2dPrimBase,
  Twin2dTransition,
} from '@dt/twin2d'
import { DtCheckbox, DtInput, DtNumberInput, DtSelect } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import {
  TWIN_2D_UNIT_RANGE,
  enumOptions,
} from '../../../scripts/inspectorFields'
import PlacementField from '../../fields/PlacementField.vue'
import TransitionField from '../../fields/TransitionField.vue'
import ConditionField from './ConditionField.vue'
import LenField from './LenField.vue'

const props = defineProps<{ modelValue: Twin2dPrimBase }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dPrimBase]
  blur: []
}>()

/** 与 `normalizeBase` 的 `originOr`、渲染层的 `DEFAULT_TRANSFORM_ORIGIN` 逐字相同。 */
const CENTER_ORIGIN = '50% 50%'

/** 「不动」那一档；它写回的是 null。 */
const NO_ANIM = ''

/** 一轮动画的缺省时长，与 `normalizeAnim` 的兜底逐字相同。 */
const ANIM_MS = 1000

/** 动画时长下限 1ms：0 与负数在归一化里一律回缺省，给不出「不动」这个意思。 */
const ANIM_RANGE = { min: 1, max: 60_000, step: 100 }

/** 等比缩放：0 会让整枝塌成一个点。 */
const SCALE_RANGE = { min: 0.01, step: 0.05 }

/** 层号可正可负，一格一层。 */
const Z_RANGE = { step: 1 }

/** 旋转一格 15 度，与节点四档旋转对得上。 */
const ROTATE_RANGE = { step: 15 }

const ANIM_LABELS: Readonly<Record<Twin2dAnimKind, string>> = {
  none: '不动',
  pulse: '脉冲',
  blink: '闪烁',
  breathe: '呼吸',
  dash: '流动虚线',
}

const POINTER_LABELS: Readonly<Record<Twin2dPointerEvents, string>> = {
  auto: '照常吃指针事件',
  none: '不吃指针事件（整枝穿透）',
}

/** ⚠ 「不动」只留一档：`none` 与 `null` 渲染相同，两档并存会存出两种 JSON。 */
const ANIM_OPTIONS = [
  { value: NO_ANIM, label: ANIM_LABELS.none },
  ...TWIN_2D_ANIM_KINDS.filter((kind) => kind !== 'none').map((value) => ({
    value,
    label: ANIM_LABELS[value],
  })),
]

const POINTER_OPTIONS = enumOptions(TWIN_2D_POINTER_EVENTS, POINTER_LABELS)

/** 变换基点框里的原文；文档里存的是它消毒之后的样子。 */
const origin = ref(CENTER_ORIGIN)

/** 焦点还在变换基点那一格里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue.transformOrigin,
  (value) => {
    if (!focused.value) origin.value = value
  },
  { immediate: true },
)

const animValue = computed(() => {
  const anim = props.modelValue.anim
  return anim === null || anim.kind === 'none' ? NO_ANIM : anim.kind
})

function write(patch: Partial<Twin2dPrimBase>): void {
  emit('update:modelValue', { ...props.modelValue, ...patch })
}

function writeSize(key: 'w' | 'h', len: Twin2dLen | null): void {
  if (len === null) return
  write({ size: { ...props.modelValue.size, [key]: len } })
}

/**
 * 换一档循环动画；「不动」写回 null。
 * @param next 下拉当前值
 */
function writeAnim(next: string): void {
  if (next === NO_ANIM) {
    write({ anim: null })
    return
  }
  const kind = TWIN_2D_ANIM_KINDS.find((item) => item === next)
  if (kind === undefined) return
  write({
    anim: { kind, durationMs: props.modelValue.anim?.durationMs ?? 1000 },
  })
}

function writeDuration(durationMs: number): void {
  const anim = props.modelValue.anim
  if (anim !== null) write({ anim: { ...anim, durationMs } })
}

function writePointer(next: string): void {
  const found = TWIN_2D_POINTER_EVENTS.find((item) => item === next)
  if (found !== undefined) write({ pointerEvents: found })
}

function onOriginFocusIn(): void {
  focused.value = true
}

function onOriginFocusOut(): void {
  focused.value = false
  origin.value = props.modelValue.transformOrigin
}

/** ⚠ 框里留用户敲的原文，文档里存消毒后的值；不这么做空格永远打不出来。 */
function writeOrigin(raw: string): void {
  origin.value = raw
  write({ transformOrigin: sanitizeCssValue(raw, CENTER_ORIGIN) })
}

function writeAt(at: Twin2dPlacement): void {
  write({ at })
}

function writeWhen(when: Twin2dCondition | null): void {
  write({ when })
}

function writeTransition(transition: Twin2dTransition | null): void {
  write({ transition })
}
</script>

<template>
  <div class="flex flex-col gap-3" @focusout="emit('blur')">
    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">摆位</h4>
      <PlacementField
        :model-value="modelValue.at"
        data-test="base-at"
        @update:model-value="writeAt"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">尺寸</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <LenField
          :model-value="modelValue.size.w"
          label="宽"
          data-test="base-w"
          @update:model-value="writeSize('w', $event)"
        />
        <LenField
          :model-value="modelValue.size.h"
          label="高"
          data-test="base-h"
          @update:model-value="writeSize('h', $event)"
        />
        <LenField
          :model-value="modelValue.minWidth"
          label="最小宽"
          placeholder="留空 = 不限"
          nullable
          data-test="base-min-w"
          @update:model-value="write({ minWidth: $event })"
        />
        <LenField
          :model-value="modelValue.maxWidth"
          label="最大宽"
          placeholder="留空 = 不限"
          nullable
          data-test="base-max-w"
          @update:model-value="write({ maxWidth: $event })"
        />
      </div>
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">层与不透明</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="modelValue.z"
          :range="Z_RANGE"
          label="层号"
          hint="非 0 时它压过文档序"
          size="sm"
          :steppers="false"
          data-test="base-z"
          @update:model-value="write({ z: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="modelValue.opacity"
          :range="TWIN_2D_UNIT_RANGE"
          label="不透明度"
          size="sm"
          :steppers="false"
          data-test="base-opacity"
          @update:model-value="write({ opacity: $event ?? 1 })"
        />
      </div>
      <DtCheckbox
        :model-value="modelValue.hidden"
        label="藏起这一枝"
        data-test="base-hidden"
        @update:model-value="write({ hidden: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">渲染条件</h4>
      <ConditionField
        :model-value="modelValue.when"
        data-test="base-when"
        @update:model-value="writeWhen"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">变换</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtNumberInput
          :model-value="modelValue.rotate"
          :range="ROTATE_RANGE"
          label="旋转"
          unit="°"
          size="sm"
          :steppers="false"
          data-test="base-rotate"
          @update:model-value="write({ rotate: $event ?? 0 })"
        />
        <DtNumberInput
          :model-value="modelValue.scale"
          :range="SCALE_RANGE"
          label="等比缩放"
          size="sm"
          :steppers="false"
          data-test="base-scale"
          @update:model-value="write({ scale: $event ?? 1 })"
        />
      </div>
      <div @focusin="onOriginFocusIn" @focusout="onOriginFocusOut">
        <DtInput
          :model-value="origin"
          label="变换基点"
          placeholder="50% 50%"
          hint="旋转与缩放共用这个基点"
          size="sm"
          data-test="base-origin"
          @update:model-value="writeOrigin"
        />
      </div>
      <DtCheckbox
        :model-value="modelValue.keepUpright"
        label="节点旋转时保持正立"
        data-test="base-upright"
        @update:model-value="write({ keepUpright: $event })"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">动效</h4>
      <div class="grid grid-cols-2 gap-1.5">
        <DtSelect
          :model-value="animValue"
          :options="ANIM_OPTIONS"
          label="循环动画"
          size="sm"
          data-test="base-anim"
          @update:model-value="writeAnim"
        />
        <DtNumberInput
          v-if="modelValue.anim !== null"
          :model-value="modelValue.anim.durationMs"
          :range="ANIM_RANGE"
          label="一轮时长"
          unit="ms"
          size="sm"
          :steppers="false"
          data-test="base-anim-ms"
          @update:model-value="writeDuration($event ?? ANIM_MS)"
        />
      </div>
      <TransitionField
        :model-value="modelValue.transition"
        data-test="base-transition"
        @update:model-value="writeTransition"
      />
    </section>

    <section class="flex flex-col gap-1.5">
      <h4 class="text-xs font-medium text-text-secondary">指针</h4>
      <DtSelect
        :model-value="modelValue.pointerEvents"
        :options="POINTER_OPTIONS"
        label="指针事件"
        hint="悬浮卡一类要选穿透，否则 hover 会自我抖动"
        size="sm"
        data-test="base-pointer"
        @update:model-value="writePointer"
      />
    </section>
  </div>
</template>
