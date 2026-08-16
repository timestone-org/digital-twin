<script setup lang="ts">
/**
 * @fileoverview DtCheckbox —— 勾选框（v-model:boolean），可选第三态「半选」。
 * 用原生 input 承载语义与键盘，视觉靠伪元素叠加。
 *
 * ⚠ `indeterminate` 只能用 DOM **属性**设，不能用 HTML attribute：写成
 * `:indeterminate="x"` 会被渲染成一个无效属性，视觉与读屏都毫无反应——而
 * 模板里看着完全正常。所以这里拿 ref 显式赋值。
 */
import { onMounted, ref, useId, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    // ⚠ 显式 `| undefined`：exactOptionalPropertyTypes 下，上游转发自己的可选
    // 值时必然带着 undefined，不写就在调用点报一个与本意无关的类型错（同 DtInput）
    label?: string | undefined
    disabled?: boolean | undefined
    /**
     * 半选：勾了一部分。⚠ 它不是第三种「值」——`modelValue` 仍然是布尔，
     * 半选只是**显示**上的第三态，点下去照样按「当前不是全选」处理。
     */
    indeterminate?: boolean | undefined
    /**
     * 无可见 label 时的可访问名称。
     * ⚠ 必须落到 `<input>` 上：透传到外层 `<label>` 只是给标签起了个名，
     * 读屏念到那个勾选框时仍然只有一声「复选框」。
     */
    ariaLabel?: string | undefined
  }>(),
  { disabled: false, indeterminate: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const id = useId()
const inputEl = ref<HTMLInputElement | null>(null)

function applyIndeterminate(): void {
  if (inputEl.value !== null) inputEl.value.indeterminate = props.indeterminate
}

// ⚠ 挂载时先设一次，再监听后续变化：只写 watchEffect 的话，首次求值时模板 ref
// 还是 null，半选要等下一拍才生效——首帧画出来的是「没勾」
onMounted(applyIndeterminate)
watch(() => props.indeterminate, applyIndeterminate)

function onChange(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).checked)
}
</script>

<template>
  <label class="dt-checkbox" :class="{ 'dt-checkbox--disabled': disabled }">
    <input
      :id="id"
      ref="inputEl"
      type="checkbox"
      class="dt-checkbox__input"
      :checked="modelValue"
      :disabled="disabled"
      :aria-label="ariaLabel"
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
    width: var(--ctl-box-md);
    height: var(--ctl-box-md);
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

  // 半选画一条横杠。⚠ 与全选是两种长相：画成一样的话，「这一层下面还有没勾的」
  // 这条信息就没了，而那正是半选唯一要表达的东西
  &__input:indeterminate + &__box {
    background: var(--accent-primary);
    border-color: var(--accent-primary);

    &::after {
      content: '';
      position: absolute;
      left: 3px;
      top: 6px;
      width: 8px;
      height: 2px;
      background: var(--text-on-emphasis);
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
