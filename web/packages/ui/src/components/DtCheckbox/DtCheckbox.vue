<script setup lang="ts">
/**
 * @fileoverview DtCheckbox —— 勾选框（v-model:boolean）。
 * 用原生 input 承载语义与键盘，视觉靠伪元素叠加。
 */
import { useId } from 'vue'

withDefaults(
  defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>(),
  { disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const id = useId()

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="dt-checkbox" :class="{ 'dt-checkbox--disabled': disabled }">
    <input
      :id="id"
      type="checkbox"
      class="dt-checkbox__input"
      :checked="modelValue"
      :disabled="disabled"
      @change="onChange"
    />
    <span class="dt-checkbox__box" aria-hidden="true" />
    <span v-if="label" class="dt-checkbox__label">{{ label }}</span>
    <slot />
  </label>
</template>

<style scoped lang="scss">
.dt-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;

  &--disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  // 视觉隐藏但保留焦点与语义：display:none 会让它从无障碍树与 Tab 序里消失
  &__input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  &__box {
    position: relative;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    background: var(--surface-sunken);
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }

  &__input:checked + &__box {
    background: var(--accent-primary);
    border-color: var(--accent-primary);

    &::after {
      content: '';
      position: absolute;
      left: 4px;
      top: 1px;
      width: 5px;
      height: 9px;
      border: solid var(--text-on-emphasis);
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }
  }

  &__input:focus-visible + &__box {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  &__label {
    font-size: 13px;
    color: var(--text-secondary);
  }
}
</style>
