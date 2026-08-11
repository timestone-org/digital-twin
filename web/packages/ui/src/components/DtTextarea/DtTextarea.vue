<script setup lang="ts">
/**
 * @fileoverview DtTextarea —— 多行文本输入（v-model:string），外壳复用 DtField。
 * rows / placeholder / readonly 等原生属性经 `$attrs` 直落 textarea，不重复声明。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    modelValue?: string
    label?: string
    hint?: string
    error?: string
    size?: DtSize
    disabled?: boolean
    required?: boolean
    maxlength?: number
    /** 高度随内容长，去掉手动拖拽把手。 */
    autosize?: boolean
    /** 等宽字体，用于 JSON / 表达式这类要对齐缩进的内容。 */
    mono?: boolean
  }>(),
  {
    modelValue: '',
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    autosize: false,
    mono: false,
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

// 剩余字数进入这个区间才播报，否则每敲一个字都要朗读一个数字
const ANNOUNCE_REMAINING_AT = 10

const textareaEl = ref<HTMLTextAreaElement | null>(null)
let isComposing = false

/** ⚠ 必须先置 auto 再读 scrollHeight：留着旧高度时它只会变大，永远收不回去。 */
function resize(): void {
  const node = textareaEl.value
  if (node === null) return
  node.style.height = 'auto'
  node.style.height = `${node.scrollHeight}px`
}

/** IME 组合输入期间不 emit，否则拼音的半成品会写进 v-model。 */
function onCompositionStart(): void {
  isComposing = true
}

function onCompositionEnd(event: Event): void {
  isComposing = false
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
}

// 原生 input 事件在 DOM 值已经更新之后才发，这里直接量就是新高度
function onInput(event: Event): void {
  if (!isComposing) {
    emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
  }
  if (props.autosize) resize()
}

// flush: 'post' —— 要读的是渲染之后的 scrollHeight，默认的 pre 读到的是上一帧
watch(
  () => props.modelValue,
  () => {
    if (props.autosize) resize()
  },
  { flush: 'post' },
)

watch(
  () => props.autosize,
  (on) => {
    if (on) {
      resize()
      return
    }
    // 关掉时要清掉 resize 留下的行内高度，否则 rows 再也说了不算
    if (textareaEl.value !== null) textareaEl.value.style.height = ''
  },
  { flush: 'post' },
)

onMounted(() => {
  if (props.autosize) resize()
})

/** 非有限的 maxlength（NaN / Infinity）不显示计数；超长时截到 0，不露负数。 */
const remaining = computed<number | null>(() => {
  const max = props.maxlength
  if (max === undefined || !Number.isFinite(max)) return null
  return Math.max(0, max - props.modelValue.length)
})

const announcement = computed(() => {
  const left = remaining.value
  if (left === null || left > ANNOUNCE_REMAINING_AT) return ''
  return `还剩 ${left} 个字符`
})

defineExpose({ textareaEl })
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
        class="dt-textarea"
        :class="[
          `dt-textarea--${size}`,
          {
            'dt-textarea--disabled': disabled,
            'dt-textarea--invalid': invalid,
            'dt-textarea--autosize': autosize,
            'dt-textarea--mono': mono,
          },
        ]"
      >
        <textarea
          :id="id"
          ref="textareaEl"
          v-bind="$attrs"
          class="dt-textarea__el"
          :value="modelValue"
          :maxlength="maxlength"
          :disabled="disabled"
          :required="required"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
        />
        <span
          v-if="remaining !== null"
          class="dt-textarea__count"
          aria-hidden="true"
        >
          {{ remaining }}
        </span>
        <span class="dt-textarea__live" aria-live="polite">
          {{ announcement }}
        </span>
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-textarea {
  position: relative;
  display: flex;
  padding: 8px 12px;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
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
    resize: vertical;
    color: var(--text-primary);
    font: inherit;
    line-height: 1.5;

    &::placeholder {
      color: var(--text-disabled);
    }
  }

  &--autosize &__el {
    resize: none;
    overflow: hidden;
  }

  &--mono &__el {
    font-family: var(--font-mono);
    line-height: 1.6;
  }

  // 计数是给看得见的人的余光用的，读屏走下面那个 live 区，别读两遍
  &__count {
    position: absolute;
    right: 8px;
    bottom: 4px;
    font-size: var(--ctl-hint-fs-sm);
    color: var(--text-disabled);
    pointer-events: none;
  }

  &__live {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}

@each $size in ctl.$sizes {
  .dt-textarea--#{$size} .dt-textarea__el {
    @include ctl.control-font($size);
  }
}

.dt-textarea--sm {
  border-radius: var(--ctl-r-sm);
}

@include ctl.reduced-motion {
  .dt-textarea {
    transition: none;
  }
}
</style>
