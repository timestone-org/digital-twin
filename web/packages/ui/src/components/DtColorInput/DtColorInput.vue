<script setup lang="ts">
/**
 * @fileoverview DtColorInput —— 颜色取值（v-model:string）：取色块 + 文本 + 预设色板。
 * 纯受控，自己不规范化取值；接受的写法与解析规则见 ./color.ts。
 */
import { computed, ref } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtInput from '../DtInput/DtInput.vue'
import { resolveColorToHex, toCssColor } from './color'

// 取值解析不出颜色时喂给原生取色器的初值。刻意用黑而不是品牌色：
// 它表示的是「没解析出来」，用主题色会让用户以为当前值就是那个色
const UNRESOLVED_HEX = '#000000'

const props = withDefaults(
  defineProps<{
    modelValue: string
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    placeholder?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
    /** 预设色板，元素是任意颜色规格（含 `--token`）；空数组不渲染。 */
    swatches?: readonly string[] | undefined
    /** 关掉右侧文本框，只留取色块。 */
    allowText?: boolean | undefined
  }>(),
  {
    placeholder: '#00cefc 或 --accent-primary',
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    allowText: true,
    swatches: () => [],
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const rootEl = ref<HTMLElement | null>(null)

const previewCss = computed(() => toCssColor(props.modelValue))
const presets = computed<readonly string[]>(() => props.swatches ?? [])

// ⚠ 原生 <input type=color> 只吃 #rrggbb：不先解析出 hex，用户一点取色器
// 就会把 token 或颜色名静默改写成回落色
const nativeHex = computed(
  () => resolveColorToHex(props.modelValue, rootEl.value) ?? UNRESOLVED_HEX,
)

function isActive(spec: string): boolean {
  return props.modelValue.trim() === spec.trim()
}

function set(value: string): void {
  if (props.disabled === true) return
  emit('update:modelValue', value)
}

function onPick(event: Event): void {
  set((event.target as HTMLInputElement).value)
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
        ref="rootEl"
        class="dt-color"
        :class="[`dt-color--${size}`, { 'dt-color--disabled': disabled }]"
      >
        <div class="dt-color__row">
          <label
            class="dt-color__swatch"
            :class="{ 'dt-color__swatch--invalid': invalid }"
          >
            <span class="dt-color__chip" :style="{ background: previewCss }" />
            <input
              :id="id"
              type="color"
              class="dt-color__native"
              :value="nativeHex"
              :disabled="disabled"
              :aria-label="label ?? '颜色'"
              :aria-invalid="invalid || undefined"
              :aria-describedby="describedby"
              @input="onPick"
            />
          </label>
          <DtInput
            v-if="allowText"
            class="dt-color__text"
            :model-value="modelValue"
            :placeholder="placeholder"
            :size="size"
            :disabled="disabled"
            spellcheck="false"
            @update:model-value="set"
          />
        </div>
        <div v-if="presets.length > 0" class="dt-color__presets">
          <button
            v-for="swatch in presets"
            :key="swatch"
            type="button"
            class="dt-color__preset"
            :class="{ 'dt-color__preset--active': isActive(swatch) }"
            :style="{ background: toCssColor(swatch) }"
            :disabled="disabled"
            :aria-label="swatch"
            :aria-pressed="isActive(swatch)"
            @click="set(swatch)"
          />
        </div>
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-color {
  display: flex;
  flex-direction: column;
  gap: 6px;

  &--disabled {
    opacity: 0.5;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  &__swatch {
    position: relative;
    flex: none;
    overflow: hidden;
    border: 1px solid var(--border-default);
    cursor: pointer;

    &--invalid {
      border-color: var(--state-danger);
    }

    &:focus-within {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
    }
  }

  &--disabled &__swatch {
    cursor: not-allowed;
  }

  &__chip {
    position: absolute;
    inset: 0;
  }

  // 原生取色器铺满色块但整块透明：看得见的是 __chip，点得动、聚得上焦的是它自己
  &__native {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    opacity: 0;
    cursor: inherit;
  }

  &__text {
    flex: 1;
    min-width: 0;
  }

  &__presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  &__preset {
    padding: 0;
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: transform 0.18s ease;

    &:hover:not(:disabled) {
      transform: scale(1.1);
    }

    &:disabled {
      cursor: not-allowed;
    }

    &--active {
      border-color: var(--accent-primary);
      box-shadow: 0 0 0 1px var(--accent-primary);
    }

    @include ctl.focus-ring;
  }
}

@each $size in ctl.$sizes {
  .dt-color--#{$size} .dt-color__swatch {
    width: var(--ctl-h-#{$size});
    height: var(--ctl-h-#{$size});
    border-radius: var(--ctl-r-#{$size});
  }

  .dt-color--#{$size} .dt-color__preset {
    width: var(--ctl-box-#{$size});
    height: var(--ctl-box-#{$size});
  }
}

@include ctl.reduced-motion {
  .dt-color__preset {
    transition: none;

    &:hover:not(:disabled) {
      transform: none;
    }
  }
}
</style>
