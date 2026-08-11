<script setup lang="ts">
/**
 * @fileoverview DtDropdownMenu —— 动作菜单，浮层与定位复用 DtPopover。
 * ⚠ 它装的是**动作**，不是取值：选一个值请用 DtSelect，两者的读屏语义不一样。
 */
import { computed, ref } from 'vue'
import type { DtMenuItem, DtSize } from '@dt/contracts'
import type { DtOverlayAlign } from '../../overlay/placement'
import DtButton from '../DtButton/DtButton.vue'
import DtIcon from '../DtIcon/DtIcon.vue'
import DtPopover from '../DtPopover/DtPopover.vue'

const props = withDefaults(
  defineProps<{
    items: readonly DtMenuItem[]
    /** 缺省触发按钮的文案；给了默认插槽就由插槽接管。 */
    label?: string
    align?: DtOverlayAlign
    size?: DtSize | undefined
    disabled?: boolean | undefined
  }>(),
  { label: '更多', align: 'end', disabled: false },
)

const emit = defineEmits<{ select: [item: DtMenuItem] }>()

const menuEl = ref<HTMLElement | null>(null)
const activeIndex = ref(-1)

const enabled = computed(() =>
  props.items.filter((item) => item.disabled !== true),
)

function itemElements(): HTMLElement[] {
  const root = menuEl.value
  if (root === null) return []
  return [...root.querySelectorAll<HTMLElement>('[role="menuitem"]')]
}

function focusAt(index: number): void {
  activeIndex.value = index
  itemElements()[index]?.focus()
}

/** 从 from 沿 step 找下一个可用项（环绕）；全禁用返回 -1。 */
function nextEnabled(from: number, step: 1 | -1): number {
  const total = props.items.length
  if (enabled.value.length === 0) return -1
  let index = from
  for (let moved = 0; moved < total; moved += 1) {
    index = (index + step + total) % total
    if (props.items[index]?.disabled !== true) return index
  }
  return -1
}

function pick(item: DtMenuItem, close: () => void): void {
  if (item.disabled === true) return
  emit('select', item)
  close()
}

function onKeydown(event: KeyboardEvent, close: () => void): void {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    const target = nextEnabled(activeIndex.value, step)
    if (target >= 0) focusAt(target)
    return
  }
  if (event.key === 'Tab') close()
}

/** 展开时高亮回到第一个可用项，免得上次的位置串到这次。 */
function onOpened(): void {
  activeIndex.value = -1
}
</script>

<template>
  <DtPopover
    :side="'bottom'"
    :align="align"
    :disabled="disabled"
    @update:open="onOpened"
  >
    <template #default="{ toggle, isOpen, panelId }">
      <slot name="trigger" :toggle="toggle" :is-open="isOpen">
        <DtButton
          variant="ghost"
          intent="neutral"
          icon="more-horizontal"
          :size="size"
          :disabled="disabled"
          :aria-label="label"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          :aria-controls="panelId"
          @click="toggle"
        />
      </slot>
    </template>

    <template #content="{ close }">
      <ul
        ref="menuEl"
        class="dt-menu"
        role="menu"
        :aria-label="label"
        @keydown="onKeydown($event, close)"
      >
        <li v-for="item in items" :key="item.value" role="none">
          <button
            type="button"
            class="dt-menu__item"
            :class="{ 'dt-menu__item--danger': item.danger === true }"
            role="menuitem"
            :disabled="item.disabled === true"
            @click="pick(item, close)"
          >
            <DtIcon v-if="item.icon" :name="item.icon" :size="14" />
            <span class="dt-menu__label">{{ item.label }}</span>
          </button>
        </li>
        <li v-if="items.length === 0" class="dt-menu__empty" role="none">
          暂无可用操作
        </li>
      </ul>
    </template>
  </DtPopover>
</template>

<style scoped lang="scss">
@use '../../styles/control' as ctl;

.dt-menu {
  min-width: 9rem;
  margin: 0;
  padding: 0;
  list-style: none;

  &__item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-secondary);
    font: inherit;
    font-size: var(--ctl-fs-sm);
    text-align: left;
    cursor: pointer;

    &:hover:not(:disabled),
    &:focus-visible {
      background: rgba(var(--accent-primary-rgb), 0.14);
      color: var(--text-primary);
      outline: none;
    }

    &:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    &--danger {
      color: var(--state-danger);

      &:hover:not(:disabled),
      &:focus-visible {
        background: rgba(var(--state-danger-rgb), 0.16);
        color: var(--state-danger);
      }
    }
  }

  &__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__empty {
    padding: 12px 10px;
    color: var(--text-disabled);
    font-size: var(--ctl-hint-fs-md);
    text-align: center;
  }
}

@include ctl.reduced-motion {
  .dt-menu__item {
    transition: none;
  }
}
</style>
