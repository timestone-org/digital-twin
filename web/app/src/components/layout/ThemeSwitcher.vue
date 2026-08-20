<script setup lang="ts">
/**
 * @fileoverview 顶栏的换肤入口：列出内置主题，每项用该主题自己的颜色画一块缩略预览。
 * 选中即写进 useThemePreference 的单例，根注入随即重绘整个应用。
 */
import { computed } from 'vue'
import { DtIcon, DtPopover } from '@dt/ui'

import {
  SYSTEM_PREFERENCE,
  useThemePreference,
  type ThemePreference,
} from '@/composables/useThemePreference'

import ThemeOption from './ThemeOption.vue'

const { preference, resolvedId, setPreference, options } = useThemePreference()

const activeName = computed(
  () =>
    options.value.find((theme) => theme.id === resolvedId.value)?.name ?? '',
)

const triggerLabel = computed(() =>
  preference.value === SYSTEM_PREFERENCE
    ? `主题外观 · 跟随系统（${activeName.value}）`
    : `主题外观 · ${activeName.value}`,
)

function pick(id: ThemePreference, close: () => void): void {
  setPreference(id)
  close()
}
</script>

<template>
  <DtPopover side="bottom" align="end">
    <template #default="{ toggle, isOpen, panelId }">
      <button
        type="button"
        class="ts-trigger"
        :class="{ 'is-open': isOpen }"
        aria-haspopup="menu"
        :aria-expanded="isOpen"
        :aria-controls="panelId"
        :aria-label="triggerLabel"
        :title="triggerLabel"
        @click="toggle"
      >
        <DtIcon name="palette" :size="16" />
      </button>
    </template>

    <template #content="{ close }">
      <div class="ts-panel" role="menu" aria-label="主题外观">
        <p class="ts-panel__head">
          <DtIcon name="sparkles" :size="12" />
          <span>主题外观</span>
        </p>

        <button
          type="button"
          role="menuitemradio"
          :aria-checked="preference === SYSTEM_PREFERENCE"
          class="ts-follow"
          :class="{ 'is-active': preference === SYSTEM_PREFERENCE }"
          @click="pick(SYSTEM_PREFERENCE, close)"
        >
          <span class="ts-follow__glyph" aria-hidden="true">
            <DtIcon name="sun" :size="11" />
            <DtIcon name="moon" :size="11" />
          </span>
          <span class="ts-follow__body">
            <span class="ts-follow__name">跟随系统</span>
            <span class="ts-follow__meta">随系统深浅自动切换</span>
          </span>
          <DtIcon
            v-if="preference === SYSTEM_PREFERENCE"
            name="check"
            :size="14"
            class="ts-check"
          />
        </button>

        <ul class="ts-grid">
          <li v-for="theme in options" :key="theme.id">
            <ThemeOption
              :theme="theme"
              :selected="preference === theme.id"
              @select="pick(theme.id, close)"
            />
          </li>
        </ul>
      </div>
    </template>
  </DtPopover>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

// 与顶栏返回入口同一个形状（--ctl-h-sm 的圆形），一行摆开才齐平
.ts-trigger {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--ctl-h-sm);
  height: var(--ctl-h-sm);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  background: transparent;
  // 图标恒为强调色：强调色本身就随主题变，它就是当前主题的活指示
  color: var(--accent-primary);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease;

  &:hover,
  &.is-open {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.12);
  }
}

// 两列瓦片 + 一行「跟随系统」，定宽让面板不随主题名长短伸缩
.ts-panel {
  width: 236px;
}

.ts-panel__head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 8px;
  padding: 0 2px;
  color: var(--accent-primary);
  font-size: var(--ctl-label-fs-md);
  font-weight: 600;
}

.ts-follow {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  margin-bottom: 8px;
  padding: 6px 7px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    color 0.15s ease;

  &:hover {
    border-color: var(--border-hover);
    color: var(--text-primary);
  }

  &.is-active {
    border-color: var(--accent-primary);
    background: rgba(var(--accent-primary-rgb), 0.12);
    color: var(--text-primary);
  }
}

.ts-follow__glyph {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 1px;
  width: 34px;
  height: 26px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-sunken);
  color: var(--accent-primary);
}

.ts-follow__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 1px;
}

.ts-follow__name {
  font-size: var(--ctl-fs-sm);
  line-height: 1.25;
}

.ts-follow__meta {
  color: var(--text-disabled);
  font-size: var(--ctl-hint-fs-md);
}

.ts-grid {
  display: grid;
  margin: 0;
  padding: 0;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
  list-style: none;
}

.ts-check {
  flex: none;
  color: var(--accent-primary);
}

@include t.reduced-motion {
  .ts-trigger,
  .ts-follow {
    transition: none;
  }
}
</style>
