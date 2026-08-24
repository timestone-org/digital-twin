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
@use 'sass:map';
@use '../../styles/control' as ctl;

// 色块内衬。颜色是装在槽里的内容而不是控件本身，留出这一圈边框与焦点环才压不住；
// sm 只留 2px，32px 的格子再吃一圈内圈圆角就只剩 1px，方角套在圆框里
$chip-insets: (
  sm: 2px,
  md: 3px,
  lg: 3px,
);

// 预设色块边长。不用 --ctl-box-*：那是勾选框与单选点的边长（14–18px），表达的是
// 状态点；这里是要点中的靶子，再小一档连排起来就点不准
$preset-sizes: (
  sm: 20px,
  md: 24px,
  lg: 28px,
);

.dt-color {
  display: flex;
  flex-direction: column;
  // 比 DtField 的 6px 宽：选中预设那圈外扩的环贴着上一行会糊在一起
  gap: 8px;

  &--disabled {
    opacity: 0.5;
  }

  &__row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  // 与 DtInput 同壳：同一层沉底、同一道边框、同一组过渡与焦点环
  &__swatch {
    position: relative;
    flex: none;
    overflow: hidden;
    background: var(--surface-sunken);
    border: 1px solid var(--border-default);
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease;

    // 棋盘格垫底：空值与半透明取值都预览成透明，没有这层格子它们跟实色长得一样
    &::before {
      content: '';
      position: absolute;
      background: repeating-conic-gradient(
          rgba(var(--neutral-fg-rgb), 0.1) 0% 25%,
          transparent 0% 50%
        )
        0 0 / 10px 10px;
    }

    &--invalid {
      border-color: var(--state-danger);
    }

    &:focus-within {
      border-color: var(--border-focus);
      box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
    }

    &--invalid:focus-within {
      box-shadow: 0 0 0 3px rgba(var(--state-danger-rgb), 0.2);
    }
  }

  &--disabled &__swatch {
    cursor: not-allowed;
  }

  &__chip {
    position: absolute;
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
    // 选中环外扩 4px：间距再小，相邻两块的环就连成一条
    gap: 8px;
  }

  &__preset {
    padding: 0;
    // 描边不许被填色顶掉（padding-box）：深色预设压在深色面板上，靠的就是这道
    // 压在面板底色上的线才看得出边
    background-clip: padding-box;
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition:
      border-color 0.18s ease,
      box-shadow 0.18s ease;

    &:hover:not(:disabled) {
      border-color: var(--border-hover);
      box-shadow: 0 0 8px -3px rgba(var(--accent-primary-rgb), 0.8);
    }

    &:disabled {
      cursor: not-allowed;
    }

    // ⚠ 选中环与色块之间必须留空档：预设自己就可能是强调色，描边贴着画就跟填色糊成
    // 一块。用 outline 而不是 box-shadow——空档直接透出面板底色，不必猜背景填什么
    &--active {
      outline: 2px solid var(--accent-primary);
      outline-offset: 2px;
      box-shadow: 0 0 10px -2px rgba(var(--accent-primary-rgb), 0.7);
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

  // 内圈圆角 = 外圈减内衬，两处同源；各写各的会让色块四角比槽多出一圈直角
  .dt-color--#{$size} .dt-color__chip,
  .dt-color--#{$size} .dt-color__swatch::before {
    inset: map.get($chip-insets, $size);
    border-radius: calc(
      var(--ctl-r-#{$size}) - #{map.get($chip-insets, $size)}
    );
  }

  .dt-color--#{$size} .dt-color__preset {
    width: map.get($preset-sizes, $size);
    height: map.get($preset-sizes, $size);
  }
}

@include ctl.reduced-motion {
  .dt-color__swatch,
  .dt-color__preset {
    transition: none;
  }
}
</style>
