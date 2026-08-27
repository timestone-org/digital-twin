<script setup lang="ts">
/**
 * @fileoverview 一格 CSS 颜色串：取色块 + 文本 + 预置色板。写回文档之前一律经
 * `@dt/twin2d` 的 `sanitizeCssValue`（拒 `url(` / `@import` / 反斜杠 / 控制字符 /
 * 超长），被拒回落本格缺省。
 *
 * ⚠ 判据只借 `sanitizeCssValue` 一份，绝不在这里另写一条：另写的那份一旦比它松，
 *   文档里就会存下一个渲染层照样会拒掉的取值——表现是「配了不生效」，零报错。
 * ⚠ 控件自己不碰文档，只 emit；连续输入并成一帧撤销的时机由检查器定：
 *   逐键 `commitMerged(next, key)`，收到本控件的 `blur` 时 `endMerge()`。
 * ⚠ 逐键写出去的是**消毒后**的值，框里留的是用户敲的原文（含空白）：不这么做，
 *   `rgb(0, 255, 0)` 里的空格会被 trim 后回写进 DOM，那个空格就永远打不出来。
 *   失焦时把框拨回文档里的值——框里绝不留下一个文档里并不存在的取值。
 */
import { TWIN_2D_PALETTE, sanitizeCssValue } from '@dt/twin2d'
import { DtColorInput } from '@dt/ui'
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  modelValue: string
  /** 被拒或清空时回落到什么；`''` = 「留空」本身就是合法的一档（跟随上层取色）。 */
  fallback?: string
  label?: string
  hint?: string
  /** 预置色板；不给就用 2D 孪生那七色加一个跟随换肤的强调色。 */
  swatches?: readonly string[]
}>()

const emit = defineEmits<{ 'update:modelValue': [string]; blur: [] }>()

/** 七色调色板加一个语义 token：前者与预置样式同色，后者跟随换肤。 */
const DEFAULT_SWATCHES: readonly string[] = Object.freeze([
  ...Object.values(TWIN_2D_PALETTE),
  'var(--accent-primary)',
])

// ⚠ 缺省值走 computed 不走 withDefaults：exactOptionalPropertyTypes 下
// withDefaults 出来的仍是 `string | undefined`，往下传会在每个调用点报错
const fallback = computed(() => props.fallback ?? '')
const swatches = computed(() => props.swatches ?? DEFAULT_SWATCHES)

/** 框里的原文；文档里存的是它消毒之后的样子。 */
const draft = ref('')

/** 焦点还在本控件里；在里面时不拿文档里的值去盖用户正敲着的那半截。 */
const focused = ref(false)

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue,
  (value) => {
    if (!focused.value) draft.value = value
  },
  { immediate: true },
)

/** 色板那几格也走这里，所以框里的原文跟着一起换。 */
function write(raw: string): void {
  draft.value = raw
  emit('update:modelValue', sanitizeCssValue(raw, fallback.value))
}

function onFocusIn(): void {
  focused.value = true
}

function onFocusOut(): void {
  focused.value = false
  draft.value = props.modelValue
  emit('blur')
}
</script>

<template>
  <div class="dt-t2-color" @focusin="onFocusIn" @focusout="onFocusOut">
    <DtColorInput
      :model-value="draft"
      :label="label"
      :hint="hint"
      :swatches="swatches"
      size="sm"
      @update:model-value="write"
    />
  </div>
</template>
