<script setup lang="ts">
/**
 * @fileoverview DtSelect —— 自定义 listbox 下拉，带可选的搜索框。
 *
 * 不用原生 `<select>`：它的选项列表由系统绘制，皮肤跟不上本项目的深色工业风，
 * 也塞不进搜索框。代价是键盘与读屏要自己实现完整，见下面的 onKeydown 与 aria-*。
 */
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { DT_CONTROL_DEFAULT_SIZE } from '@dt/contracts'
import type { DtSelectOption, DtSize } from '@dt/contracts'
import DtField from '../DtField/DtField.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtSelectMenu from './DtSelectMenu.vue'
import { computeMenuPosition, resolveOverlayZIndex } from './placement'
import {
  SEARCHABLE_THRESHOLD,
  filterOptions,
  firstEnabled,
  indexOfValue,
  lastEnabled,
  nextEnabled,
} from './options'

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: readonly DtSelectOption[]
    label?: string | undefined
    hint?: string | undefined
    error?: string | undefined
    placeholder?: string | undefined
    /** 没有可见 label 时（紧凑工具条）用它给触发器补可读名称。 */
    ariaLabel?: string | undefined
    size?: DtSize | undefined
    disabled?: boolean | undefined
    required?: boolean | undefined
    /**
     * 要不要搜索框。`'auto'`（缺省）按选项数量决定，≥8 才给。
     * ⚠ 不能写成「可选 boolean，未传即 undefined」：Vue 对 Boolean 型 prop 有
     * 自动强制转换，没传时拿到的是 `false` 而不是 `undefined`，`??` 永远不触发。
     */
    searchable?: boolean | 'auto'
    searchPlaceholder?: string | undefined
    emptyText?: string | undefined
    /** 首选展开方向；空间不足时运行时翻到对侧。 */
    placement?: 'bottom' | 'top' | undefined
  }>(),
  {
    size: DT_CONTROL_DEFAULT_SIZE,
    disabled: false,
    required: false,
    searchable: 'auto',
    searchPlaceholder: '搜索…',
    emptyText: '无匹配项',
    placement: 'bottom',
  },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const menuId = useId()
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const menuStyle = ref<Record<string, string>>({})
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
/**
 * 浮层暴露出来的那几件事。
 * ⚠ 不写 `InstanceType<typeof DtSelectMenu>`：`.vue` 导出的类型 typescript-eslint
 * 解析不出来，整段会被当成 any 报一片 unsafe。
 */
interface MenuHandle {
  el: HTMLElement | null
  focusSearch: () => void
  scrollActiveIntoView: () => void
}

const menu = ref<MenuHandle | null>(null)
const menuHost = ref<string | HTMLElement>('body')

const visible = computed(() => filterOptions(props.options, query.value))
const selectedOption = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
)
const showSearch = computed(() =>
  props.searchable === 'auto'
    ? props.options.length >= SEARCHABLE_THRESHOLD
    : props.searchable,
)
const displayLabel = computed(
  () => selectedOption.value?.label ?? props.placeholder ?? '请选择',
)

function updatePosition(): void {
  const rect = root.value?.getBoundingClientRect()
  if (!open.value || rect === undefined) return
  const position = computeMenuPosition({
    trigger: rect,
    menuHeight: menu.value?.el?.offsetHeight ?? 0,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    placement: props.placement,
  })
  menuStyle.value = {
    ...position.style,
    zIndex: String(resolveOverlayZIndex(root.value)),
  }
}

function stopTracking(): void {
  // ⚠ capture 传 true 才收得到内层滚动容器的事件；移除时也必须带同一个 true，
  // 否则移除的是另一个监听器，浮层关掉了监听还留着。
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
  document.removeEventListener('pointerdown', onPointerDown)
}

function close(): void {
  if (!open.value) return
  open.value = false
  query.value = ''
  stopTracking()
}

/**
 * 浮层挂到哪。
 * ⚠ 在 DtModal 里必须挂进弹窗面板：挂 body 的话浮层是面板的**兄弟节点**，
 * 一来焦点跑出弹窗的焦点陷阱（再按 Tab 直接离开弹窗），二来面板挂着
 * `aria-modal="true"`，读屏会忽略面板之外的一切，整个选项列表对读屏不存在。
 * 面板没有 transform / filter，fixed 定位仍然相对视口，也不会被它的 overflow 裁掉。
 */
function resolveHost(): string | HTMLElement {
  return root.value?.closest<HTMLElement>('.dt-modal__panel') ?? 'body'
}

function openMenu(): void {
  if (props.disabled === true || open.value) return
  menuHost.value = resolveHost()
  open.value = true
  query.value = ''
  const selected = indexOfValue(visible.value, props.modelValue)
  activeIndex.value = selected >= 0 ? selected : firstEnabled(visible.value)
  // fixed 定位不跟随祖先滚动，必须逐帧重算
  window.addEventListener('scroll', updatePosition, true)
  window.addEventListener('resize', updatePosition)
  document.addEventListener('pointerdown', onPointerDown)
  updatePosition()
  void nextTick(() => {
    updatePosition()
    if (showSearch.value) menu.value?.focusSearch()
    menu.value?.scrollActiveIntoView()
  })
}

function pick(option: DtSelectOption): void {
  if (option.disabled === true) return
  emit('update:modelValue', option.value)
  close()
  // 点 li 之后焦点会落到 body，Tab 顺序就断了；还给触发器
  trigger.value?.focus()
}

function onPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  // 浮层 teleport 在 body 下，不在 root 子树里——点它不算点外面
  const inside =
    root.value?.contains(target) === true ||
    menu.value?.el?.contains(target) === true
  if (!inside) close()
}

function move(delta: number): void {
  if (!open.value) {
    openMenu()
    return
  }
  activeIndex.value = nextEnabled(visible.value, activeIndex.value, delta)
}

function onKeydown(event: KeyboardEvent): void {
  if (props.disabled === true) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Home' || event.key === 'End') {
    if (!open.value) return
    event.preventDefault()
    activeIndex.value =
      event.key === 'Home'
        ? firstEnabled(visible.value)
        : lastEnabled(visible.value)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    if (!open.value) {
      openMenu()
      return
    }
    const option = visible.value[activeIndex.value]
    if (option !== undefined) pick(option)
  } else if (event.key === ' ' && !showSearch.value) {
    // 有搜索框时空格是正常输入，不能拿去开合
    event.preventDefault()
    if (open.value) close()
    else openMenu()
  } else if (event.key === 'Escape') {
    if (!open.value) return
    event.preventDefault()
    // ⚠ 只在关闭时才 stopPropagation：外层 DtModal 也监听 Esc，
    // 一律拦下会让「弹窗里的下拉已经关着，再按 Esc 关不掉弹窗」。
    if (query.value !== '') {
      query.value = ''
    } else {
      event.stopPropagation()
      close()
      trigger.value?.focus()
    }
  } else if (event.key === 'Tab') {
    if (!open.value) return
    // ⚠ 焦点这时可能在浮层的搜索框里，而浮层马上要被卸载：不先收回触发器的话
    // 焦点会掉到 body，下一次 Tab 从页首重来，而不是走到表单的下一个字段。
    event.preventDefault()
    close()
    trigger.value?.focus()
  }
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

// ⚠ 卸载时必须摘干净：浮层开着的时候路由跳走，监听会留在 window 上持续累积
onBeforeUnmount(stopTracking)
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
          :aria-activedescendant="
            open && !showSearch && activeIndex >= 0
              ? `${menuId}-o${activeIndex}`
              : undefined
          "
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
          :id="menuId"
          ref="menu"
          :options="visible"
          :selected="modelValue"
          :active-index="activeIndex"
          :style="menuStyle"
          :searchable="showSearch"
          :query="query"
          :search-placeholder="searchPlaceholder"
          :empty-text="emptyText"
          :labelledby="label ? id : undefined"
          :to="menuHost"
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
@use '../../styles/control' as ctl;

.dt-select {
  position: relative;
  display: flex;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  transition:
    border-color 0.18s ease,
    box-shadow 0.18s ease;

  &:focus-within,
  &.is-open {
    border-color: var(--border-focus);
    box-shadow: 0 0 0 3px rgba(var(--accent-primary-rgb), 0.18);
  }

  &--invalid {
    border-color: var(--state-danger);
  }

  &--disabled {
    opacity: 0.5;
  }

  &__trigger {
    display: flex;
    flex: 1;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    border: 0;
    background: transparent;
    color: var(--text-primary);
    font: inherit;
    text-align: left;
    cursor: pointer;

    &:disabled {
      cursor: not-allowed;
    }

    // 焦点环由外框的 :focus-within 给，这里再来一圈会套两层
    &:focus-visible {
      outline: none;
    }
  }

  &__value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;

    &.is-placeholder {
      color: var(--text-disabled);
    }
  }

  &__caret {
    flex-shrink: 0;
    color: var(--text-disabled);
  }
}

@each $size in ctl.$sizes {
  .dt-select--#{$size} {
    @include ctl.control-box($size);

    padding: 0;
  }

  .dt-select--#{$size} .dt-select__trigger {
    @include ctl.control-font($size);

    padding: 0 var(--ctl-px-#{$size});
    border-radius: var(--ctl-r-#{$size});
  }
}
</style>
