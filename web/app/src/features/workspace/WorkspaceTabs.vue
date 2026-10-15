<script setup lang="ts">
/** @fileoverview 顶栏与内容交界处的居中页签，超宽滚动及关闭全部确认。 */
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { RouterLink } from 'vue-router'
import { DtButton, useConfirm } from '@dt/ui'
import { useWorkspace } from './context'

withDefaults(defineProps<{ maxWidth?: string }>(), { maxWidth: '48rem' })
const workspace = useWorkspace()
const confirm = useConfirm()
const strip = ref<HTMLElement | null>(null)
const isConfirming = ref(false)
const confirmAnchor = shallowRef<HTMLElement | null>(null)
const items = computed(() => workspace?.tabs.value ?? [])
const canCloseAll = computed(() => items.value.some((tab) => tab.key !== '/'))

function revealActive(): void {
  strip.value
    ?.querySelector('[aria-current="page"]')
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

function scrollTabs(event: WheelEvent): void {
  const element = strip.value
  if (element === null || element.scrollWidth <= element.clientWidth) return
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  element.scrollLeft += event.deltaY
  event.preventDefault()
}

async function closeAll(event: MouseEvent): Promise<void> {
  if (workspace === null || workspace.closing.value) return
  if (isConfirming.value) {
    cancelOwnConfirmation()
    return
  }
  isConfirming.value = true
  confirmAnchor.value =
    event.currentTarget instanceof HTMLElement ? event.currentTarget : null
  try {
    const accepted = await confirm.ask(
      {
        title: '关闭全部页签',
        message: '关闭所有已打开的页面并返回工作台。未保存的改动会另行确认。',
        confirmText: '关闭全部',
        cancelText: '取消',
        danger: true,
      },
      confirmAnchor.value ?? undefined,
    )
    if (accepted) await workspace.closeAll()
  } finally {
    isConfirming.value = false
    confirmAnchor.value = null
  }
}

function cancelOwnConfirmation(): void {
  if (
    confirmAnchor.value !== null &&
    confirm.anchor.value === confirmAnchor.value
  )
    confirm.resolve(false)
}
onDeactivated(cancelOwnConfirmation)
onBeforeUnmount(cancelOwnConfirmation)

onMounted(revealActive)
onActivated(revealActive)
watch(() => workspace?.activeKey.value, revealActive, { flush: 'post' })
</script>

<template>
  <div
    v-if="workspace && items.length"
    class="workspace-tabs"
    :style="{ '--workspace-tabs-max-width': maxWidth }"
  >
    <nav
      ref="strip"
      aria-label="已打开页面"
      class="workspace-tabs__list"
      @wheel="scrollTabs"
    >
      <div
        v-for="tab in items"
        :key="tab.key"
        class="workspace-tabs__item"
        :class="{ 'is-active': tab.key === workspace.activeKey.value }"
      >
        <RouterLink
          :to="tab.route.fullPath"
          :aria-current="
            tab.key === workspace.activeKey.value ? 'page' : undefined
          "
          :title="tab.title"
          class="workspace-tabs__link"
        >
          <span
            v-if="tab.dirty"
            aria-label="未保存"
            class="workspace-tabs__dirty"
          />
          <span class="truncate">{{ tab.title }}</span>
        </RouterLink>
        <DtButton
          v-if="tab.key !== '/'"
          icon="close"
          variant="ghost"
          size="xs"
          intent="neutral"
          class="workspace-tabs__close"
          :aria-label="'关闭 ' + tab.title"
          :disabled="workspace.closing.value"
          @click="void workspace.close(tab.key)"
        />
      </div>
    </nav>
    <div class="workspace-tabs__actions">
      <DtButton
        icon="tabs-close"
        variant="ghost"
        size="sm"
        intent="neutral"
        class="workspace-tabs__close-all"
        aria-label="关闭全部页签"
        title="关闭全部页签"
        :disabled="!canCloseAll || workspace.closing.value"
        aria-haspopup="dialog"
        :aria-expanded="isConfirming"
        @click="void closeAll($event)"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.workspace-tabs {
  position: absolute;
  z-index: 35;
  top: 0;
  left: 50%;
  display: flex;
  align-items: center;
  width: max-content;
  max-width: min(var(--workspace-tabs-max-width), calc(100% - 2rem));
  padding: 3px 4px;
  border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in srgb, var(--surface-panel) 90%, transparent);
  box-shadow:
    0 5px 18px color-mix(in srgb, var(--surface-base) 35%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--text-primary) 5%, transparent);
  backdrop-filter: blur(18px) saturate(1.3);
  transform: translate(-50%, -50%);

  &__list {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    min-width: 0;
    gap: 2px;
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    border-radius: var(--radius-pill);

    &::-webkit-scrollbar {
      display: none;
    }
  }

  &__item {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    height: 24px;
    padding-right: 4px;
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    transition:
      background 160ms ease,
      color 160ms ease,
      box-shadow 160ms ease;

    &:hover {
      color: var(--text-primary);
      background: color-mix(in srgb, var(--text-primary) 5%, transparent);
    }

    &.is-active {
      color: var(--accent-on-surface);
      background: color-mix(
        in srgb,
        var(--accent-primary) 14%,
        var(--surface-panel)
      );
      box-shadow: inset 0 0 0 1px
        color-mix(in srgb, var(--accent-primary) 18%, transparent);
    }

    &:hover .workspace-tabs__close,
    &:focus-within .workspace-tabs__close,
    &.is-active .workspace-tabs__close {
      opacity: 1;
    }
  }

  &__link {
    display: flex;
    align-items: center;
    max-width: 14rem;
    height: 100%;
    gap: 7px;
    padding: 0 8px 0 10px;
    border-radius: var(--radius-pill);
    font-size: 12px;
    font-weight: 500;
    line-height: 1;
    white-space: nowrap;

    &:focus-visible {
      outline: 2px solid var(--accent-primary);
      outline-offset: -2px;
    }
  }

  &__dirty {
    flex-shrink: 0;
    width: 5px;
    height: 5px;
    border-radius: var(--radius-pill);
    background: var(--state-warning);
  }

  &__close {
    width: 20px;
    min-width: 20px;
    height: 20px;
    min-height: 20px;
    padding: 0;
    border-radius: var(--radius-pill);
    color: inherit;
    opacity: 0;
    transition:
      opacity 140ms ease,
      background 140ms ease;
  }

  &__actions {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    margin-left: 5px;
    padding-left: 5px;
    border-left: 1px solid
      color-mix(in srgb, var(--text-primary) 10%, transparent);
  }

  &__close-all {
    width: 24px;
    min-width: 24px;
    height: 24px;
    min-height: 24px;
    padding: 0;
    border-radius: var(--radius-pill);
    color: var(--text-secondary);
    transition:
      color 160ms ease,
      background 160ms ease;

    &:enabled:hover {
      color: var(--state-danger);
      background: color-mix(in srgb, var(--state-danger) 10%, transparent);
    }
  }
}

@media (hover: none) {
  .workspace-tabs__close {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-tabs__item,
  .workspace-tabs__close,
  .workspace-tabs__close-all {
    transition: none;
  }
}
</style>
