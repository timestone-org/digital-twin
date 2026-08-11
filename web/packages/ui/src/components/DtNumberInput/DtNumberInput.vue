<script setup lang="ts">
/**
 * @fileoverview DtNumberInput —— 数字步进输入（v-model:number|undefined）。
 * 换算全在 ./number.ts；这里只管显示态与事件。
 */
import { computed, nextTick, ref, useAttrs, watch } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE, DT_CONTROL_ICON_PX } from '@dt/contracts'
import type { DtNumberRange, DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import { formatValue, normalize, parseInput, stepFrom } from './number'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: number | undefined
    /** 上下限、步长与小数位。 */
    range?: DtNumberRange | undefined
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    unit?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
    /** 关掉 +/- 键。窄栏里两个键要吃掉约 76px，方向键仍可增减。 */
    steppers?: boolean | undefined
  }>(),
  {
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    steppers: true,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: number | undefined] }>()

const range = computed<DtNumberRange>(() => props.range ?? {})
const display = ref('')

// immediate 兼作初值：在 setup 根作用域直接读 props 会丢响应性
watch(
  () => props.modelValue,
  (value) => {
    // 已经等价就不动，否则会把用户正敲到一半的 '1.' 抹成 '1'
    if (parseInput(display.value) !== value) {
      display.value = formatValue(value, range.value)
    }
  },
  { immediate: true },
)

/** 步进基准优先取当前文本：它比 modelValue 新。 */
const stepBase = computed(() => {
  const typed = parseInput(display.value) ?? props.modelValue
  return typed ?? range.value.min ?? 0
})

const attrs = useAttrs()

/**
 * ⚠ `readonly` 经 $attrs 进来，它只挡得住键入——步进键与上下方向键是另外两条
 * 改值路径，不在这里一起挡住的话，只读的数字框仍然点得动、按得动。
 */
const isLocked = computed(
  () => props.disabled === true || (attrs.readonly ?? false) !== false,
)

const canDecrease = computed(() => {
  const { min } = range.value
  return !isLocked.value && (min === undefined || stepBase.value > min)
})

const canIncrease = computed(() => {
  const { max } = range.value
  return !isLocked.value && (max === undefined || stepBase.value < max)
})

const iconPx = computed(() => DT_CONTROL_ICON_PX[props.size])

/**
 * ⚠ 落定后要按父组件**实际回写**的值刷新显示：父组件校验不通过、不回写时
 * 组件不会重渲染，输入框会留着刚才那个被拒的值，看着像已经生效了。
 */
function settle(): void {
  void nextTick(() => {
    display.value = formatValue(props.modelValue, range.value)
  })
}

function commit(raw: number): void {
  const next = normalize(raw, range.value)
  display.value = formatValue(next, range.value)
  emit('update:modelValue', next)
  settle()
}

function step(direction: 1 | -1): void {
  if (isLocked.value) return
  commit(stepFrom(stepBase.value, direction, range.value))
}

function onInput(event: Event): void {
  display.value = (event.target as HTMLInputElement).value
}

/** 提交时才归一：键入过程中夹取会让「先删一位再补」变成不可能。 */
function onChange(): void {
  const parsed = parseInput(display.value)
  if (parsed !== undefined) {
    commit(parsed)
    return
  }
  if (display.value.trim() === '') {
    emit('update:modelValue', undefined)
    settle()
    return
  }
  // 键入 'abc' 这类解析不出的，回滚到上一个合法值而不是清空
  display.value = formatValue(props.modelValue, range.value)
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
        class="dt-number"
        :class="[
          `dt-number--${size}`,
          { 'dt-number--disabled': disabled, 'dt-number--invalid': invalid },
        ]"
      >
        <!-- ⚠ tabindex=-1：步进键不进 Tab 序，否则每个数字输入都要按三下才能跳过 -->
        <button
          v-if="steppers"
          type="button"
          class="dt-number__step"
          aria-label="减少"
          tabindex="-1"
          :disabled="!canDecrease"
          @click="step(-1)"
        >
          <DtIcon name="minus" :size="iconPx" />
        </button>
        <input
          :id="id"
          v-bind="$attrs"
          class="dt-number__el"
          type="text"
          inputmode="decimal"
          role="spinbutton"
          :value="display"
          :disabled="disabled"
          :required="required"
          :aria-valuenow="modelValue"
          :aria-valuemin="range?.min"
          :aria-valuemax="range?.max"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          @input="onInput"
          @change="onChange"
          @keydown.up.prevent="step(1)"
          @keydown.down.prevent="step(-1)"
        />
        <span v-if="unit" class="dt-number__unit">{{ unit }}</span>
        <button
          v-if="steppers"
          type="button"
          class="dt-number__step"
          aria-label="增加"
          tabindex="-1"
          :disabled="!canIncrease"
          @click="step(1)"
        >
          <DtIcon name="plus" :size="iconPx" />
        </button>
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-number {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 6px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:focus-within {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
  }

  &--invalid {
    border-color: var(--state-danger);

    &:focus-within {
      box-shadow: 0 0 0 3px rgba(var(--state-danger-rgb), 0.2);
    }
  }

  &--disabled {
    opacity: 0.5;
  }

  &__el {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    outline: none;
    color: var(--text-primary);
    font: inherit;
    text-align: center;

    &::placeholder {
      color: var(--text-disabled);
    }
  }

  &__unit {
    flex-shrink: 0;
    color: var(--text-secondary);
    font-size: var(--ctl-hint-fs-md);
  }

  &__step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 26px;
    height: 26px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition:
      background-color 0.18s ease,
      color 0.18s ease;

    &:hover:not(:disabled) {
      background: rgba(var(--neutral-fg-rgb), 0.12);
      color: var(--text-primary);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  }
}

@each $size in ctl.$sizes {
  .dt-number--#{$size} {
    height: var(--ctl-h-#{$size});
    border-radius: var(--ctl-r-#{$size});
  }

  .dt-number--#{$size} .dt-number__el {
    @include ctl.control-font($size);
  }
}

@include ctl.reduced-motion {
  .dt-number,
  .dt-number__step {
    transition: none;
  }
}
</style>
