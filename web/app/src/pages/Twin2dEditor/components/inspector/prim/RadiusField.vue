<script setup lang="ts">
/**
 * @fileoverview 一格圆角三形：一个数、药丸、或四角分别给（顺序 tl / tr / br / bl）。
 *
 * ⚠ 三形不是「一个数加两个花样」：药丸是**跟着高度走**的（CSS `9999px` 那一档），
 *   拿一个大数顶替它，盒一变高就露出直边，而每一处取值单看都对。
 * ⚠ 换形时把当下这个数带过去（四角同值 / 取第一角）：换一下就清零的话，微调圆角
 *   要从头再填一遍四个格子。
 * ⚠ 四角的次序是 tl / tr / br / bl，与 CSS `border-radius` 逐字相同——调换两项
 *   在方形上看不出来，一到长条盒就整个歪掉。
 * ⚠ 控件自己不碰文档，只 emit；合并撤销的时机由检查器定（见 `blur`）。
 */
import type { Twin2dRadius } from '@dt/twin2d'
import { DtNumberInput, DtSelect } from '@dt/ui'
import { computed } from 'vue'

const props = defineProps<{ modelValue: Twin2dRadius; label?: string }>()

const emit = defineEmits<{ 'update:modelValue': [Twin2dRadius]; blur: [] }>()

/** 三形各自的档名；`corners` 只在控件里用，文档里是一个四元组。 */
type RadiusForm = 'one' | 'pill' | 'corners'

const RANGE = { min: 0, step: 1 }

const FORM_OPTIONS = [
  { value: 'one', label: '一个数' },
  { value: 'pill', label: '药丸（跟着高度走）' },
  { value: 'corners', label: '四角分别给' },
]

/** 四角的次序与 CSS `border-radius` 逐字相同。 */
const CORNER_CELLS = [
  { key: 0, label: '左上' },
  { key: 1, label: '右上' },
  { key: 2, label: '右下' },
  { key: 3, label: '左下' },
] as const

const corners = computed<readonly number[] | null>(() =>
  Array.isArray(props.modelValue) ? props.modelValue : null,
)

const form = computed<RadiusForm>(() => {
  if (props.modelValue === 'pill') return 'pill'
  return corners.value === null ? 'one' : 'corners'
})

/** 当下这一格能带去别形的那个数：四角形取左上角。 */
const one = computed(() => {
  if (typeof props.modelValue === 'number') return props.modelValue
  return corners.value?.[0] ?? 0
})

/**
 * 换形；当下这个数跟着过去。
 * @param next 下拉当前值
 */
function writeForm(next: string): void {
  if (next === form.value) return
  const carried = one.value
  if (next === 'pill') emit('update:modelValue', 'pill')
  else if (next === 'one') emit('update:modelValue', carried)
  else if (next === 'corners') {
    emit('update:modelValue', [carried, carried, carried, carried])
  }
}

/**
 * 改四角里的一角；元组整份换，就地改下标不换引用等于没改。
 * @param seat 第几角，顺序 tl / tr / br / bl
 * @param value 新的圆角半径
 */
function writeCorner(seat: number, value: number): void {
  const at = corners.value
  if (at === null) return
  emit('update:modelValue', [
    seat === 0 ? value : (at[0] ?? 0),
    seat === 1 ? value : (at[1] ?? 0),
    seat === 2 ? value : (at[2] ?? 0),
    seat === 3 ? value : (at[3] ?? 0),
  ])
}
</script>

<template>
  <div class="flex flex-col gap-1.5" @focusout="emit('blur')">
    <DtSelect
      :model-value="form"
      :options="FORM_OPTIONS"
      :label="label ?? '圆角'"
      size="sm"
      data-test="radius-form"
      @update:model-value="writeForm"
    />

    <DtNumberInput
      v-if="form === 'one'"
      :model-value="one"
      :range="RANGE"
      label="半径"
      unit="px"
      size="sm"
      :steppers="false"
      data-test="radius-one"
      @update:model-value="emit('update:modelValue', $event ?? 0)"
    />

    <div v-if="corners !== null" class="grid grid-cols-2 gap-1.5">
      <DtNumberInput
        v-for="cell in CORNER_CELLS"
        :key="cell.key"
        :model-value="corners[cell.key] ?? 0"
        :range="RANGE"
        :label="cell.label"
        unit="px"
        size="sm"
        :steppers="false"
        :data-test="`radius-corner-${cell.key}`"
        @update:model-value="writeCorner(cell.key, $event ?? 0)"
      />
    </div>
  </div>
</template>
