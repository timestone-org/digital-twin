<script setup lang="ts">
/**
 * @fileoverview 折叠态的二级导航：图标触发，二级项飞出成浮层菜单。
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { DtButton, DtIcon } from '@dt/ui'

import type { NavItem } from './navItems'
import { isGroupActive, isPathActive } from './navTree'

const props = defineProps<{ item: NavItem; currentPath: string }>()

const hovered = ref(false)
const focused = ref(false)
/** Esc 压制：指针/焦点还在这一组里时不让它自己弹回来。 */
const dismissed = ref(false)

const isOpen = computed(
  () => (hovered.value || focused.value) && !dismissed.value,
)
const groupActive = computed(() => isGroupActive(props.currentPath, props.item))

function isActive(to: string | undefined): boolean {
  return isPathActive(props.currentPath, to)
}

/**
 * 指针与焦点都离开这一组之后才解除 Esc 压制。
 * ⚠ 不能在 mouseleave 里直接解除：Esc 把焦点退回了触发按钮，按钮就在组内，
 * 一解除面板立刻又自己弹开。
 */
function releaseIfIdle(): void {
  if (!hovered.value && !focused.value) dismissed.value = false
}

function onMouseLeave(): void {
  hovered.value = false
  releaseIfIdle()
}

/** 焦点在组内部挪动（触发按钮 → 菜单项）不算离开。 */
function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget
  const group = event.currentTarget
  if (
    next instanceof Node &&
    group instanceof HTMLElement &&
    group.contains(next)
  ) {
    return
  }
  focused.value = false
  releaseIfIdle()
}

/** Esc 关闭前先把焦点退回分组按钮，否则焦点跟着隐藏的链接一起丢给 body。 */
function onEsc(event: KeyboardEvent): void {
  if (!isOpen.value) return
  event.preventDefault()
  const trigger = (
    event.currentTarget as HTMLElement
  ).querySelector<HTMLElement>('.nav-trigger button')
  trigger?.focus()
  dismissed.value = true
}
</script>

<template>
  <div
    class="nav-group relative"
    @mouseenter="hovered = true"
    @mouseleave="onMouseLeave"
    @focusin="focused = true"
    @focusout="onFocusOut"
    @keydown.esc="onEsc"
  >
    <span class="nav-trigger">
      <DtButton
        :variant="groupActive ? 'soft' : 'ghost'"
        :intent="groupActive ? 'primary' : 'neutral'"
        :icon="item.icon"
        :aria-label="item.label"
        :aria-expanded="isOpen"
        :title="item.label"
        @click="dismissed = isOpen"
      />
    </span>
    <span
      v-if="groupActive"
      class="pointer-events-none absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-accent-primary"
    />

    <!-- 外层留 10px 透明桥：指针从图标滑向面板时不断开 hover -->
    <div
      class="nav-flyout"
      :class="{ 'is-open': isOpen }"
      :aria-hidden="!isOpen"
    >
      <!-- ⚠ 刻意不用 role="menu"：那个角色要求方向键漫游焦点与 roving tabindex，
           没配套的话读屏会切进应用模式、把方向键吞掉，用户按上下毫无反应。
           这里内容本来就是一组链接，用带名称的 group 更诚实。 -->
      <div
        class="min-w-[168px] rounded-md border border-border-default bg-surface-overlay p-1 shadow-2xl"
        role="group"
        :aria-label="item.label"
      >
        <p class="m-0 px-2 py-1 text-3xs text-text-disabled">
          {{ item.label }}
        </p>
        <RouterLink
          v-for="child in item.children"
          :key="child.key"
          :to="child.to ?? '/'"
          class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs transition-colors"
          :class="
            isActive(child.to)
              ? 'bg-accent-primary/10 text-accent-primary'
              : 'text-text-secondary hover:bg-accent-primary/10 hover:text-text-primary'
          "
          :aria-current="isActive(child.to) ? 'page' : undefined"
        >
          <DtIcon :name="child.icon" :size="15" />
          <span class="whitespace-nowrap">{{ child.label }}</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
// ⚠ 显隐与 aria 必须同一个来源：早先显隐交给 CSS 的 :hover / :focus-within、
// aria 交给 script，两者会分家——Esc 之后 hover 规则特异度更高，面板仍然显示
// 在屏幕上，却挂着 aria-hidden="true"，里面的链接照样能 Tab 到（axe 的
// aria-hidden-focus，严重级）。现在一律由 isOpen 驱动。
.nav-flyout {
  position: absolute;
  left: 100%;
  top: 0;
  // 骑在边界上的折叠钮自带 z-index，不显式抬一层的话面板会被它压在下面
  z-index: var(--z-dropdown);
  padding-left: 10px; // 透明桥
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.12s ease;

  &.is-open {
    opacity: 1;
    visibility: visible;
  }
}
</style>
