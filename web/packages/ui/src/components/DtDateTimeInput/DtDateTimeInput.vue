<script setup lang="ts">
/**
 * @fileoverview DtDateTimeInput —— 到分钟的时刻输入：可键入的字段 + 日历浮层。
 *
 * 对外取值一律 UTC RFC3339，而键入面与日历都按本地时走，两者的换算集中在
 * shared/datetime.ts —— 这就是本组件存在的理由，也是它唯一不能出错的地方。
 * ⚠ 输入框保留 `type="datetime-local"`：分段编辑、键盘、读屏与 min/max 夹取
 * 都由浏览器保证，换成自己解析的文本框等于把这几件一起重写。原生那颗日历图标
 * 由样式隐去，日历改由右侧那颗按钮开。
 */
import { computed } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE, DT_CONTROL_ICON_PX } from '@dt/contracts'
import type { DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtPopover from '../DtPopover/DtPopover.vue'
import DateTimePanel from './DateTimePanel.vue'
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
const iconPx = computed(() => DT_CONTROL_ICON_PX[props.size])

/** 清空与形状不合法都归一成空串，不把半成品抛给上层。 */
function onInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  emit('update:modelValue', fromLocalMinuteInput(raw))
}

/** 日历给的是本地时，换回 UTC 再抛出去，与键入走同一条路。 */
function onPick(local: string): void {
  emit('update:modelValue', fromLocalMinuteInput(local))
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
      <DtPopover :disabled="disabled" side="bottom" align="start">
        <template #default="{ toggle, isOpen, panelId }">
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
            <!-- 与 DtNumberInput 的步进键同一档：field 内的附件用原生按钮，
               DtButton 的档位盒子会把 32px 的字段撑开 -->
            <button
              type="button"
              class="dt-datetime__picker"
              aria-label="选择日期时间"
              tabindex="-1"
              :disabled="disabled"
              :aria-expanded="isOpen"
              :aria-controls="panelId"
              @click="toggle"
            >
              <DtIcon name="calendar" :size="iconPx" />
            </button>
          </div>
        </template>

        <template #content="{ close }">
          <DateTimePanel
            :value="localValue"
            :min="localMin"
            :max="localMax"
            :size="size"
            @pick="(onPick($event), close())"
          />
        </template>
      </DtPopover>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

// DtPopover 的根节点承载触发区，字段要吃满可用宽度就得从这里放开
.dt-popover {
  display: flex;
  width: 100%;
}

.dt-datetime {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
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

    // 原生那颗日历图标连着一块不小的点击区，档位再小也压不下去；
    // 日历改由 __picker 开，这里整个藏掉
    &::-webkit-calendar-picker-indicator {
      display: none;
    }
  }

  &__picker {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;

    &:hover:not(:disabled) {
      color: var(--text-primary);
    }

    &:disabled {
      cursor: not-allowed;
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

  .dt-datetime--#{$size} .dt-datetime__picker {
    width: var(--ctl-box-#{$size});
    height: var(--ctl-box-#{$size});
  }
}

@include ctl.reduced-motion {
  .dt-datetime {
    transition: none;
  }
}
</style>
