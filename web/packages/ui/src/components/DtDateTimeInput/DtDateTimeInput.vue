<script setup lang="ts">
/**
 * @fileoverview DtDateTimeInput —— 到分钟的时刻输入。
 * 对外取值一律 UTC RFC3339，原生 `datetime-local` 只认本地时，
 * 两者的换算在 shared/datetime.ts —— 这就是本组件存在的理由。
 */
import { computed } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import { fromLocalMinuteInput, toLocalMinuteInput } from '../../shared/datetime'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    /** UTC RFC3339 时刻；空串表示没选。 */
    modelValue?: string
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    /** 可选下界，同样是 UTC RFC3339。 */
    min?: string | undefined
    /** 可选上界，同样是 UTC RFC3339。 */
    max?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
  }>(),
  {
    modelValue: '',
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// ⚠ 显示的是本地时、对外给的是 UTC：这一层换算漏掉就是静默差一个时区
const localValue = computed(() => toLocalMinuteInput(props.modelValue))
const localMin = computed(() => toLocalMinuteInput(props.min ?? ''))
const localMax = computed(() => toLocalMinuteInput(props.max ?? ''))

/** 清空与形状不合法都归一成空串，不把半成品抛给上层。 */
function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update:modelValue', fromLocalMinuteInput(raw))
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
        class="dt-datetime"
        :class="[
          `dt-datetime--${size}`,
          {
            'dt-datetime--disabled': disabled,
            'dt-datetime--invalid': invalid,
          },
        ]"
      >
        <input
          :id="id"
          v-bind="$attrs"
          class="dt-datetime__el"
          type="datetime-local"
          step="60"
          :value="localValue"
          :min="localMin || undefined"
          :max="localMax || undefined"
          :disabled="disabled"
          :required="required"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          @input="onInput"
        />
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-datetime {
  display: flex;
  align-items: center;
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

    // 原生日历图标在深色底上是黑的，反相一下才看得见
    &::-webkit-calendar-picker-indicator {
      filter: invert(1);
      opacity: 0.6;
      cursor: pointer;
    }
  }
}

@each $size in ctl.$sizes {
  .dt-datetime--#{$size} {
    @include ctl.control-box($size);
  }

  .dt-datetime--#{$size} .dt-datetime__el {
    @include ctl.control-font($size);
  }
}

@include ctl.reduced-motion {
  .dt-datetime {
    transition: none;
  }
}
</style>
