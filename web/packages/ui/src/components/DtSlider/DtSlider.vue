<script setup lang="ts">
/**
 * @fileoverview DtSlider —— 滑块（v-model:number），底子是原生 `<input type=range>`。
 * 用原生件是为了白拿键盘操作与读屏语义，自己画一个必然两样都缺。
 */
import { computed, nextTick } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtNumberRange, DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'

defineOptions({ inheritAttrs: false })

const DEFAULT_BOUNDS = { min: 0, max: 100, step: 1 } as const

const props = withDefaults(
  defineProps<{
    modelValue: number
    /** 上下限与步长；缺省 0–100 步长 1。 */
    range?: DtNumberRange | undefined
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    unit?: string | undefined
    size?: DtSize
    disabled?: boolean
    required?: boolean
    /** 右侧数值读出。 */
    showValue?: boolean
  }>(),
  {
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    showValue: true,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

const bounds = computed(() => ({
  min: props.range?.min ?? DEFAULT_BOUNDS.min,
  max: props.range?.max ?? DEFAULT_BOUNDS.max,
  step: props.range?.step ?? DEFAULT_BOUNDS.step,
}))

/** 填充比例。⚠ 非有限值算出的 NaN% 会让整条 linear-gradient 作废，轨道变全透明。 */
const filledPercent = computed(() => {
  const { min, max } = bounds.value
  const value = props.modelValue
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    !Number.isFinite(value)
  ) {
    return 0
  }
  const span = max - min
  if (span <= 0) return 0
  return ((Math.min(max, Math.max(min, value)) - min) / span) * 100
})

const trackStyle = computed(() => {
  const stop = `${filledPercent.value}%`
  return {
    background:
      `linear-gradient(to right, var(--accent-primary) 0%, ` +
      `var(--accent-secondary) ${stop}, var(--surface-sunken) ${stop})`,
  }
})

const readout = computed(() => `${props.modelValue}${props.unit ?? ''}`)

function onInput(event: Event): void {
  if (props.disabled === true) return
  const el = event.target as HTMLInputElement
  emit('update:modelValue', Number(el.value))
  // ⚠ 父组件夹住或拒绝这个值时不会重渲染，滑块会留在用户松手的位置——
  // 轨道渐变与读出已经按 modelValue 画好了，只有拇指对不上。
  void nextTick(() => {
    const authoritative = String(props.modelValue)
    if (el.value !== authoritative) el.value = authoritative
  })
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
    <template #default="{ id, describedby, invalid }">
      <div
        class="dt-slider"
        :class="[`dt-slider--${size}`, { 'dt-slider--disabled': disabled }]"
      >
        <input
          :id="id"
          v-bind="$attrs"
          class="dt-slider__el"
          type="range"
          :min="bounds.min"
          :max="bounds.max"
          :step="bounds.step"
          :value="modelValue"
          :disabled="disabled"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          :style="trackStyle"
          @input="onInput"
        />
        <output v-if="showValue" class="dt-slider__readout">
          {{ readout }}
        </output>
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

// 轨道高度是滑块自己的一套：它不是有主轴高度的控件，套 32/40/48 会变成一条粗带
$rails: (
  sm: 4px,
  md: 6px,
  lg: 8px,
);
$thumb: 16px;

.dt-slider {
  display: flex;
  align-items: center;
  gap: 12px;

  &--disabled {
    opacity: 0.5;

    .dt-slider__el {
      cursor: not-allowed;
    }
  }

  &__el {
    flex: 1;
    min-width: 0;
    border-radius: var(--radius-pill);
    appearance: none;
    outline: none;
    cursor: pointer;

    &:focus-visible {
      box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.25);
    }

    // ⚠ 两个引擎的拇指伪元素不能合并进一条选择器：任一个不认，整条规则一起作废
    &::-webkit-slider-thumb {
      appearance: none;
      width: $thumb;
      height: $thumb;
      border: 2px solid var(--surface-base);
      border-radius: 50%;
      background: var(--accent-primary);
      box-shadow: 0 0 8px rgba(var(--accent-primary-rgb), 0.8);
      cursor: inherit;
    }

    &::-moz-range-thumb {
      width: $thumb;
      height: $thumb;
      border: 2px solid var(--surface-base);
      border-radius: 50%;
      background: var(--accent-primary);
      box-shadow: 0 0 8px rgba(var(--accent-primary-rgb), 0.8);
      cursor: inherit;
    }
  }

  // 读出用等宽数字：不定宽的话每跳一个数字，滑块就被推着左右动
  &__readout {
    min-width: 4ch;
    text-align: right;
    font-family: var(--font-mono);
    font-size: var(--ctl-hint-fs-md);
    font-variant-numeric: tabular-nums;
    color: var(--text-title);
  }
}

@each $size, $rail in $rails {
  .dt-slider--#{$size} .dt-slider__el {
    height: $rail;
  }
}

@include ctl.reduced-motion {
  .dt-slider__el {
    transition: none;
  }
}
</style>
