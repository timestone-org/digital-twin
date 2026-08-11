<script setup lang="ts">
/**
 * @fileoverview DtRadioGroup —— 单选组（v-model:string），外壳复用 DtField。
 * 方向键在可用项之间环绕移动并即时选中，键盘契约见 tests/components/DtRadio。
 */
import { computed, ref } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtRadioOption, DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtRadio from './DtRadio.vue'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: readonly DtRadioOption[]
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
    orientation?: 'vertical' | 'horizontal' | undefined
    /** 可见 label 由宿主画在别处时用它命名整组。 */
    ariaLabel?: string | undefined
  }>(),
  {
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    orientation: 'vertical',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const ARROW_STEP: Record<string, 1 | -1> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
}

const groupEl = ref<HTMLElement | null>(null)

function isDisabled(option: DtRadioOption | undefined): boolean {
  if (option === undefined) return true
  return Boolean(props.disabled) || Boolean(option.disabled)
}

/** roving：选中项可 Tab 进入，其余 -1；无选中时让首个可用项接管。 */
const rovingIndex = computed(() => {
  const selected = props.options.findIndex(
    (option) => option.value === props.modelValue && !isDisabled(option),
  )
  if (selected >= 0) return selected
  return props.options.findIndex((option) => !isDisabled(option))
})

function radioElements(): HTMLElement[] {
  const root = groupEl.value
  if (root === null) return []
  return [...root.querySelectorAll<HTMLElement>('[role="radio"]')]
}

/**
 * ⚠ 导航起点取当前**焦点**所在项，不取 modelValue 推出的 rovingIndex：
 * 受控父组件拒绝或异步回写时两者会脱节，焦点会卡在原地反复 emit 同一个值。
 */
function currentIndex(): number {
  const active = document.activeElement
  const focused = radioElements().findIndex((node) => node === active)
  return focused >= 0 ? focused : Math.max(rovingIndex.value, 0)
}

/** 从 from 沿 step 找第一个可用项（环绕）；全禁用返回 -1。 */
function nextEnabled(from: number, step: 1 | -1): number {
  const total = props.options.length
  if (total === 0) return -1
  let index = from
  for (let moved = 0; moved < total; moved += 1) {
    index = (index + step + total) % total
    if (!isDisabled(props.options[index])) return index
  }
  return -1
}

function select(value: string): void {
  if (value !== props.modelValue) emit('update:modelValue', value)
}

function onKeydown(event: KeyboardEvent): void {
  const step = ARROW_STEP[event.key]
  if (step === undefined) return
  event.preventDefault()
  const target = nextEnabled(currentIndex(), step)
  const option = props.options[target]
  if (option === undefined) return
  select(option.value)
  radioElements()[target]?.focus()
}
</script>

<template>
  <DtField
    :label="label"
    :hint="hint"
    :error="error"
    :required="required"
    :size="size"
  >
    <template #default="{ describedby, invalid }">
      <div
        ref="groupEl"
        class="dt-radio-group"
        :class="`dt-radio-group--${orientation}`"
        role="radiogroup"
        :aria-label="ariaLabel ?? label"
        :aria-orientation="orientation"
        :aria-describedby="describedby"
        :aria-invalid="invalid || undefined"
        :aria-required="required || undefined"
        :aria-disabled="disabled || undefined"
        @keydown="onKeydown"
      >
        <DtRadio
          v-for="(option, index) in options"
          :key="option.value"
          :value="option.value"
          :label="option.label"
          :checked="option.value === modelValue"
          :disabled="isDisabled(option)"
          :size="size"
          :tabindex="index === rovingIndex ? 0 : -1"
          @select="select"
        />
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
.dt-radio-group {
  display: flex;
  gap: 10px;
  outline: none;

  &--vertical {
    flex-direction: column;
  }

  // 横排的相邻项在同一行上，靠太近会读成一组，列间距单独放宽
  &--horizontal {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    column-gap: 20px;
  }
}
</style>
