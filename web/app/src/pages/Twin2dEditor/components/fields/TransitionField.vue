<script setup lang="ts">
/**
 * @fileoverview 属性过渡的一格编辑面：六档闭合属性名 + 时长 + 缓动。
 *
 * ⚠ 六档一档都不勾 = **没配过渡**（`null`），与归一化「props 空表即 null」同一口径：
 *   另加一个「启用」开关会造出「开着但一档都没勾」这种文档里根本表达不出来的状态，
 *   而它存一次再读回来就自己变成了关着。
 * ⚠ 属性名是闭合六档不是任意 CSS 属性名：放开只会把消毒面撑大而收益为零。
 * ⚠ 缓动是自由 CSS 串，写回前经 `sanitizeCssValue`，缺省与渲染层的兜底逐字相同——
 *   两处不一致的表现是「编辑器里写了个非法缓动，图上却按 ease 动」，零报错。
 *   框里留用户敲的原文，失焦时拨回文档里的值。
 * ⚠ 控件自己不碰文档，只 emit；连续输入并成一帧撤销的时机由检查器定：逐键
 *   `commitMerged(next, key)`，收到本控件的 `blur` 时 `endMerge()`。
 */
import {
  TWIN_2D_TRANSITION_PROPS,
  normalizeTransition,
  sanitizeCssValue,
} from '@dt/twin2d'
import type { Twin2dTransition, Twin2dTransitionProp } from '@dt/twin2d'
import { DtCheckbox, DtInput, DtNumberInput } from '@dt/ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{ modelValue: Twin2dTransition | null }>()

const emit = defineEmits<{
  'update:modelValue': [Twin2dTransition | null]
  blur: []
}>()

/** 与渲染层 `transitionCss` 的兜底逐字相同。 */
const DEFAULT_EASING = 'ease'

/** 时长下限 1ms：0 与负数在归一化里一律回缺省，给不出「不过渡」这个意思。 */
const DURATION_RANGE = { min: 1, max: 10_000, step: 10 }

const PROP_LABELS: Readonly<Record<Twin2dTransitionProp, string>> = {
  transform: '位移缩放',
  opacity: '不透明度',
  background: '底色',
  'border-color': '边框色',
  'box-shadow': '阴影',
  filter: '滤镜',
}

/** 第一次勾上时给的那一档；其余取值由归一化补缺省。 */
const FIRST_PROP: Twin2dTransitionProp = 'opacity'

/** 缓动框里的原文；文档里存的是它消毒之后的样子。 */
const easing = ref(DEFAULT_EASING)

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue?.easing ?? DEFAULT_EASING,
  (value) => {
    if (!focused.value) easing.value = value
  },
  { immediate: true },
)

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  easing.value = props.modelValue?.easing ?? DEFAULT_EASING
  emit('blur')
}

const picked = computed<readonly Twin2dTransitionProp[]>(
  () => props.modelValue?.props ?? [],
)

function has(prop: Twin2dTransitionProp): boolean {
  return picked.value.includes(prop)
}

/** 按 `TWIN_2D_TRANSITION_PROPS` 的次序收，勾选顺序不影响文档序。 */
function nextProps(
  prop: Twin2dTransitionProp,
  on: boolean,
): Twin2dTransitionProp[] {
  return TWIN_2D_TRANSITION_PROPS.filter((item) =>
    item === prop ? on : has(item),
  )
}

function write(patch: Partial<Twin2dTransition>): void {
  const base = props.modelValue ?? { props: [FIRST_PROP] }
  emit('update:modelValue', normalizeTransition({ ...base, ...patch }))
}

function toggle(prop: Twin2dTransitionProp, on: boolean): void {
  write({ props: nextProps(prop, on) })
}

function onEasing(raw: string): void {
  easing.value = raw
  write({ easing: sanitizeCssValue(raw, DEFAULT_EASING) })
}
</script>

<template>
  <div class="flex flex-col gap-2" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="grid grid-cols-2 gap-1" role="group" aria-label="过渡属性">
      <DtCheckbox
        v-for="prop in TWIN_2D_TRANSITION_PROPS"
        :key="prop"
        :model-value="has(prop)"
        :label="PROP_LABELS[prop]"
        :data-test="`transition-prop-${prop}`"
        @update:model-value="toggle(prop, $event)"
      />
    </div>

    <p
      v-if="modelValue === null"
      class="text-xs text-text-disabled"
      data-test="transition-off-hint"
    >
      一档都没勾 = 不配过渡，属性变化立刻生效。
    </p>

    <div v-else class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        :model-value="modelValue.durationMs"
        :range="DURATION_RANGE"
        label="时长"
        unit="ms"
        size="sm"
        :steppers="false"
        data-test="transition-duration"
        @update:model-value="write({ durationMs: $event ?? 0 })"
      />
      <DtInput
        :model-value="easing"
        label="缓动"
        placeholder="ease / cubic-bezier(…)"
        size="sm"
        data-test="transition-easing"
        @update:model-value="onEasing"
      />
    </div>
  </div>
</template>
