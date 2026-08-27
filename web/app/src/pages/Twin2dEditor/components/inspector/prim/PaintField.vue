<script setup lang="ts">
/**
 * @fileoverview 一格 SVG 上色：不上色 / 纯色 / 引本图元里的一个渐变。
 * `vec` 的填充与 `draw` 一档每一笔的填充共用它。
 *
 * ⚠ 引了一个本图元里没有的渐变 id 时当场标红：SVG 对 `fill="url(#缺)"` 是**整个
 *   不上色**，画面上只剩描边，看着像「填充色配错了」而不像引用断了（`dangling-gradient`）。
 * ⚠ 一个渐变都还没建时，渐变那一档禁用而不是从表里删掉；引空了的那个 id 也照样
 *   摆进下拉——两处都是同一个理由：看不见当下这一档，用户连改回去都无从改起。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import { TWIN_2D_PAINT_KINDS } from '@dt/twin2d'
import type { Twin2dPaint, Twin2dPaintKind } from '@dt/twin2d'
import { DtSelect } from '@dt/ui'
import { computed } from 'vue'

import ColorField from '../../fields/ColorField.vue'

const props = defineProps<{
  modelValue: Twin2dPaint
  /** 本图元里已建的渐变 id；空表时渐变那一档禁用。 */
  gradientIds?: readonly string[]
  label?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [Twin2dPaint]; blur: [] }>()

/** 与 `colorOr` 的兜底同一档：空串会让浏览器按 initial 取黑，看着像主题没生效。 */
const INHERITED_COLOR = 'currentColor'

/** 引空了的说明。 */
const DANGLING = '本图元里没有这个渐变，这一笔会整个不上色'

const KIND_LABELS: Readonly<Record<Twin2dPaintKind, string>> = {
  none: '不上色',
  color: '纯色',
  gradient: '本图元的渐变',
}

const ids = computed<readonly string[]>(() => props.gradientIds ?? [])

const kindOptions = computed(() =>
  TWIN_2D_PAINT_KINDS.map((value) => ({
    value,
    label: KIND_LABELS[value],
    disabled: value === 'gradient' && ids.value.length === 0,
  })),
)

// ⚠ 各档取值一律在 script 里解开，不靠模板里的 v-if 收窄联合类型：模板收窄失手时
// typecheck 与 lint 双双放行，只在运行期读到 undefined
const color = computed<string | null>(() =>
  props.modelValue.kind === 'color' ? props.modelValue.color : null,
)

const gradientId = computed<string | null>(() =>
  props.modelValue.kind === 'gradient' ? props.modelValue.id : null,
)

const dangling = computed(
  () => gradientId.value !== null && !ids.value.includes(gradientId.value),
)

const gradientOptions = computed(() => {
  const known = ids.value.map((value) => ({ value, label: value }))
  const at = gradientId.value
  return at === null || !dangling.value
    ? known
    : [...known, { value: at, label: `${at}（不存在）` }]
})

/**
 * 换一档；渐变档落到第一个已建的渐变上，一个都没有就落回不上色。
 * @param next 下拉当前值
 */
function writeKind(next: string): void {
  const kind = TWIN_2D_PAINT_KINDS.find((item) => item === next)
  if (kind === undefined || kind === props.modelValue.kind) return
  if (kind === 'color') {
    emit('update:modelValue', { kind, color: INHERITED_COLOR })
    return
  }
  const first = ids.value[0]
  if (kind === 'none' || first === undefined) {
    emit('update:modelValue', { kind: 'none' })
    return
  }
  emit('update:modelValue', { kind: 'gradient', id: first })
}

function writeColor(next: string): void {
  if (color.value === null) return
  emit('update:modelValue', { kind: 'color', color: next })
}

function writeGradient(id: string): void {
  if (gradientId.value === null) return
  emit('update:modelValue', { kind: 'gradient', id })
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtSelect
      :model-value="modelValue.kind"
      :options="kindOptions"
      :label="label ?? '上色'"
      size="sm"
      data-test="paint-kind"
      @update:model-value="writeKind"
    />

    <ColorField
      v-if="color !== null"
      :model-value="color"
      :fallback="INHERITED_COLOR"
      label="颜色"
      @update:model-value="writeColor"
    />

    <DtSelect
      v-if="gradientId !== null"
      :model-value="gradientId"
      :options="gradientOptions"
      label="渐变"
      size="sm"
      :error="dangling ? DANGLING : ''"
      data-test="paint-gradient"
      @update:model-value="writeGradient"
    />
  </div>
</template>
