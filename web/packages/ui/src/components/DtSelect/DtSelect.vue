<script setup lang="ts">
/**
 * @fileoverview DtSelect —— 自定义 listbox 下拉，带可选的搜索框。
 *
 * 不用原生 `<select>`：它的选项列表由系统绘制，皮肤跟不上本项目的深色工业风，
 * 也塞不进搜索框。代价是键盘与读屏要自己实现完整，见下面的 onKeydown 与 aria-*。
 */
import { computed, ref, useId, watch } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSelectOption, DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtSelectMenu from './DtSelectMenu.vue'
import { useSelectMenu } from './useSelectMenu'
import { resolveKey } from './keyboard'
import type { SelectAction } from './keyboard'
import {
  SEARCHABLE_THRESHOLD,
  filterOptions,
  firstEnabled,
  indexOfValue,
  lastEnabled,
  nextEnabled,
} from './options'

/**
 * 下拉「怎么显示」的一组取值：未选时的占位、搜索、空态与展开方向。
 *
 * ⚠ 这里刻意不写 `| undefined`：开着 exactOptionalPropertyTypes 时「省略」
 * 与「显式传 undefined」是两回事，只允许前者，下面那句
 * `{ ...DISPLAY_DEFAULTS, ...props.display }` 才不会被 undefined 盖掉默认值。
 * `searchable` 用三态而不是可选 boolean：Vue 对 Boolean 型 prop 有自动强制
 * 转换，没传时拿到的是 `false` 而不是 `undefined`。
 */
export interface DtSelectDisplay {
  placeholder?: string
  /** 要不要搜索框。`'auto'`（缺省）按选项数量决定，≥8 才给。 */
  searchable?: boolean | 'auto'
  searchPlaceholder?: string
  emptyText?: string
  /** 首选展开方向；空间不足时运行时翻到对侧。 */
  placement?: 'bottom' | 'top'
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: readonly DtSelectOption[]
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    /** 没有可见 label 时（紧凑工具条）用它给触发器补可读名称。 */
    ariaLabel?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
    display?: DtSelectDisplay | undefined
  }>(),
  {
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    display: undefined,
  },
)

const DISPLAY_DEFAULTS = {
  placeholder: '请选择',
  searchable: 'auto',
  searchPlaceholder: '搜索…',
  emptyText: '无匹配项',
  placement: 'bottom',
} as const satisfies Required<DtSelectDisplay>

const display = computed(() => ({ ...DISPLAY_DEFAULTS, ...props.display }))

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const menuId = useId()
const trigger = ref<HTMLButtonElement | null>(null)

const panel = useSelectMenu({
  placement: () => display.value.placement,
  hasSearch: () => showSearch.value,
  initialIndex: () => {
    const selected = indexOfValue(visible.value, props.modelValue)
    return selected >= 0 ? selected : firstEnabled(visible.value)
  },
})
const { isOpen: open, query, activeIndex, root, menu } = panel

const menuProps = computed(() => ({
  id: menuId,
  options: visible.value,
  selected: props.modelValue,
  activeIndex: activeIndex.value,
  style: panel.style.value,
  search: {
    enabled: showSearch.value,
    query: query.value,
    placeholder: display.value.searchPlaceholder,
    emptyText: display.value.emptyText,
  },
  to: panel.host.value,
}))

const visible = computed(() => filterOptions(props.options, query.value))
const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)
const showSearch = computed(() =>
  display.value.searchable === 'auto'
    ? props.options.length >= SEARCHABLE_THRESHOLD
    : display.value.searchable,
)
const displayLabel = computed(
  () => selectedOption.value?.label ?? display.value.placeholder,
)
// 有搜索框时焦点在输入框上，活动项由输入框的 aria-activedescendant 表达
const activeDescendant = computed(() =>
  open.value && !showSearch.value && activeIndex.value >= 0
    ? `${menuId}-o${activeIndex.value}`
    : undefined,
)

const close = panel.close

function openMenu(): void {
  if (props.disabled !== true) panel.open()
}

function pick(option: DtSelectOption): void {
  if (option.disabled === true) return
  emit('update:modelValue', option.value)
  close()
  // 点 li 之后焦点会落到 body，Tab 顺序就断了；还给触发器
  trigger.value?.focus()
}

function move(delta: number): void {
  if (!open.value) {
    openMenu()
    return
  }
  activeIndex.value = nextEnabled(visible.value, activeIndex.value, delta)
}

function jumpTo(to: 'first' | 'last'): void {
  activeIndex.value =
    to === 'first' ? firstEnabled(visible.value) : lastEnabled(visible.value)
}

function pickActive(): void {
  const option = visible.value[activeIndex.value]
  if (option !== undefined) pick(option)
}

function toggle(): void {
  if (open.value) close()
  else openMenu()
}

function apply(action: SelectAction): void {
  switch (action.kind) {
    case 'open':
      openMenu()
      return
    case 'move':
      move(action.delta)
      return
    case 'jump':
      jumpTo(action.to)
      return
    case 'pick':
      pickActive()
      return
    case 'clear-query':
      query.value = ''
      return
    case 'toggle':
      toggle()
      return
    case 'close':
      close()
      trigger.value?.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled === true) return
  const action = resolveKey(event.key, {
    isOpen: open.value,
    hasSearch: showSearch.value,
    hasQuery: query.value !== '',
  })
  if (action === null) return
  event.preventDefault()
  if (action.kind === 'close' && action.stop) event.stopPropagation()
  apply(action)
}

// 过滤后列表变短时收回越界的高亮，否则 aria-activedescendant 指向不存在的节点
watch(visible, (options) => {
  if (!open.value) return
  if (activeIndex.value > options.length - 1 || activeIndex.value < 0) {
    activeIndex.value = firstEnabled(options)
  }
})

// 展开着被禁用（提交中锁表单）时关掉，免得还能点选项触发写入
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled === true) close()
  },
)
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
        ref="root"
        class="dt-select"
        :class="[
          `dt-select--${size}`,
          {
            'dt-select--disabled': disabled,
            'dt-select--invalid': invalid,
            'is-open': open,
          },
        ]"
      >
        <button
          :id="id"
          ref="trigger"
          type="button"
          class="dt-select__trigger"
          role="combobox"
          :disabled="disabled"
          :aria-expanded="open"
          :aria-controls="menuId"
          aria-haspopup="listbox"
          :aria-label="ariaLabel"
          :aria-invalid="invalid || undefined"
          :aria-describedby="describedby"
          :aria-activedescendant="activeDescendant"
          @click="open ? close() : openMenu()"
          @keydown="onKeydown"
        >
          <span
            class="dt-select__value"
            :class="{ 'is-placeholder': !selectedOption }"
          >
            {{ displayLabel }}
          </span>
          <DtIcon
            class="dt-select__caret"
            :name="open ? 'chevron-up' : 'chevron-down'"
            :size="14"
          />
        </button>

        <DtSelectMenu
          v-if="open"
          ref="menu"
          v-bind="menuProps"
          :labelledby="label ? id : undefined"
          @pick="pick"
          @hover="activeIndex = $event"
          @update:query="query = $event"
          @keydown="onKeydown"
        />
      </div>
    </template>
  </DtField>
</template>

<style scoped lang="scss">
@use './select';
</style>
