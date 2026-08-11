<script setup lang="ts">
/**
 * @fileoverview DtInput —— 文本输入（v-model:string）。leading / trailing
 * 具名插槽放前后置图标或密码显隐开关。
 */
import { computed, ref } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'

defineOptions({ inheritAttrs: false })

// ⚠ placeholder / name / autocomplete / readonly 刻意不声明成 prop：
// 它们是原生 input 属性，由下面的 `v-bind="$attrs"` 直接落到 <input> 上。
// 声明一遍只是把同一件事写两份，还会把 props 数量推过上限。
withDefaults(
  defineProps<{
    modelValue?: string
    label?: string
    hint?: string
    error?: string
    type?: 'text' | 'password' | 'email' | 'search' | 'tel'
    // ⚠ 显式 `| undefined`：exactOptionalPropertyTypes 下 withDefaults 不收窄读取端，
    // 上游组件原样转发自己的 size / disabled 时必然带着 undefined（同 DtField）
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean
  }>(),
  {
    modelValue: '',
    type: 'text',
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
  },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  enter: []
  keystate: [event: KeyboardEvent]
}>()

const inputEl = ref<HTMLInputElement | null>(null)
let isComposing = false

/** IME 组合输入期间不 emit，否则拼音的半成品会写进 v-model。 */
function onCompositionStart(): void {
  isComposing = true
}

function onCompositionEnd(event: Event): void {
  isComposing = false
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onInput(event: Event): void {
  if (isComposing) return
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function onKeydown(event: KeyboardEvent): void {
  emit('keystate', event)
  if (event.key === 'Enter' && !isComposing && !event.isComposing) {
    emit('enter')
  }
}

const exposed = computed(() => inputEl.value)
defineExpose({ inputEl: exposed })
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
        class="dt-input"
        :class="[
          `dt-input--${size}`,
          { 'dt-input--disabled': disabled, 'dt-input--invalid': invalid },
        ]"
      >
        <span v-if="$slots.leading" class="dt-input__affix">
          <slot name="leading" />
        </span>
        <input
          :id="id"
          ref="inputEl"
          v-bind="$attrs"
          class="dt-input__el"
          :type="type"
          :value="modelValue"
          :disabled="disabled"
          :required="required"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          @input="onInput"
          @keydown="onKeydown"
          @keyup="emit('keystate', $event)"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
        />
        <span v-if="$slots.trailing" class="dt-input__affix">
          <slot name="trailing" />
        </span>
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-input {
  display: flex;
  align-items: center;
  gap: 8px;
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

    &::placeholder {
      color: var(--text-disabled);
    }
  }

  &__affix {
    display: inline-flex;
    color: var(--text-secondary);
  }
}

@each $size in ctl.$sizes {
  .dt-input--#{$size} {
    @include ctl.control-box($size);
  }

  // 字号挂在 __el 而不是根：根还承载前后置插槽，字号只该作用于文本本身
  .dt-input--#{$size} .dt-input__el {
    @include ctl.control-font($size);
  }
}
</style>
