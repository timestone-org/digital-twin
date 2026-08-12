<script setup lang="ts">
/**
 * @fileoverview 换肤面板里的一块主题瓦片：用这套主题自己的底色、面板与强调色
 * 摆一个微缩界面，比一块纯色更能说明「选了它以后整个应用长什么样」。
 */
import { computed } from 'vue'
import type { ThemeDefinition } from '@dt/tokens'
import { DtIcon } from '@dt/ui'

const props = defineProps<{ theme: ThemeDefinition; selected: boolean }>()

defineEmits<{ select: [] }>()

/**
 * 预览用的取色。这里颜色是**数据**（画的就是那套主题），故走内联 style；
 * 瓦片自身的外观仍然只用 @dt/tokens 的变量。
 */
const previewVars = computed<Record<string, string>>(() => {
  const { surface, border, text, accent } = props.theme.tokens
  return {
    '--pv-base': surface.base,
    '--pv-panel': surface.panel,
    '--pv-border': border.default,
    '--pv-title': accent.primary,
    '--pv-text': text.secondary,
    '--pv-accent': accent.secondary,
  }
})
</script>

<template>
  <button
    type="button"
    role="menuitemradio"
    :aria-checked="selected"
    class="ts-tile"
    :class="{ 'is-active': selected }"
    @click="$emit('select')"
  >
    <span class="ts-swatch" :style="previewVars" aria-hidden="true">
      <span class="ts-swatch__panel">
        <span class="ts-swatch__bar ts-swatch__bar--title" />
        <span class="ts-swatch__bar ts-swatch__bar--text" />
        <span class="ts-swatch__bar ts-swatch__bar--accent" />
      </span>
    </span>
    <span class="ts-tile__foot">
      <DtIcon :name="theme.mode === 'light' ? 'sun' : 'moon'" :size="11" />
      <span class="ts-tile__name">{{ theme.name }}</span>
      <DtIcon v-if="selected" name="check" :size="13" class="ts-tile__check" />
    </span>
  </button>
</template>

<style scoped lang="scss">
@use '@/styles/tokens-bridge' as t;

.ts-tile {
  display: block;
  width: 100%;
  padding: 5px;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font: inherit;
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

.ts-swatch {
  display: block;
  height: 42px;
  padding: 6px;
  border-radius: var(--radius-sm);
  background: var(--pv-base);
  // 描边取该主题自己的边框色：浅色预设的浅底否则会和面板底融在一起
  box-shadow: inset 0 0 0 1px var(--pv-border);
}

.ts-swatch__panel {
  display: flex;
  height: 100%;
  flex-direction: column;
  justify-content: center;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--pv-panel);
  box-shadow: inset 0 0 0 1px var(--pv-border);
  gap: 3px;
}

.ts-swatch__bar {
  display: block;
  height: 3px;
  border-radius: 2px;

  &--title {
    width: 56%;
    background: var(--pv-title);
  }

  &--text {
    width: 82%;
    height: 2px;
    background: var(--pv-text);
  }

  &--accent {
    width: 38%;
    height: 2px;
    background: var(--pv-accent);
  }
}

.ts-tile__foot {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 5px;
  font-size: var(--ctl-label-fs-md);
}

.ts-tile__name {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ts-tile__check {
  flex: none;
  color: var(--accent-primary);
}

@include t.reduced-motion {
  .ts-tile {
    transition: none;
  }
}
</style>
