<script setup lang="ts">
/**
 * @fileoverview container 的渲染壳：背景、可选标题条、内容区。
 * ⚠ 标题条的显隐判定必须与 `resolveContentInset` 逐字一致：一边画了条、另一边
 * 没留出 28px，表现是这个容器里所有子节点整体错位，而没有任何一处报错。
 */
import type { ModuleMeta } from '@dt/contracts'
import { computed, type CSSProperties } from 'vue'

import { readBoolean, readText } from '../../shared/config'
import {
  CONTAINER_CONFIG_KEY,
  SHOW_TITLE_CONFIG_KEY,
  TITLE_BAR_HEIGHT_PX,
  readContainerLayout,
} from '../../shared/container'

const props = defineProps<{
  config: Record<string, unknown>
  values: Record<string, unknown>
  meta?: ModuleMeta
}>()

const title = computed(() => readText(props.config.title))
const isTitleShown = computed(() =>
  readBoolean(props.config[SHOW_TITLE_CONFIG_KEY]),
)
const accent = computed(() =>
  readText(props.config.accent, 'var(--accent-primary)'),
)
const background = computed(() => readText(props.config.background))
const backgroundImage = computed(() => readText(props.config.backgroundImage))
const showDotGrid = computed(() => readBoolean(props.config.showDotGrid, true))
const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    '--dt-container-accent': accent.value,
    '--dt-container-bar-height': `${TITLE_BAR_HEIGHT_PX}px`,
  }
  // 背景色与背景图各写各的：填了渐变而没填底色时，底色仍该透出大屏背景
  if (background.value !== '') style.backgroundColor = background.value
  if (backgroundImage.value !== '') {
    style.backgroundImage = backgroundImage.value
  }
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div class="dt-container" :style="shellStyle">
    <div v-if="isTitleShown" class="dt-container__bar">
      <span class="dt-container__accent" />
      <span class="dt-container__title">{{ title }}</span>
    </div>
    <div
      class="dt-container__content"
      :class="{ 'dt-container__content--dotted': showDotGrid }"
      :style="contentStyle"
    >
      <slot />
    </div>
  </div>
</template>

<style scoped lang="scss">
.dt-container {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--radius-sm);
}

.dt-container__bar {
  display: flex;
  height: var(--dt-container-bar-height);
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
}

.dt-container__accent {
  width: 3px;
  height: 13px;
  flex: none;
  border-radius: var(--radius-pill);
  background: var(--dt-container-accent);
  box-shadow: 0 0 6px var(--dt-container-accent);
}

.dt-container__title {
  overflow: hidden;
  min-width: 0;
  flex: 1;
  color: var(--card-title-color, var(--text-title));
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.025em;
  white-space: nowrap;
  text-overflow: ellipsis;
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次
.dt-container__content {
  position: relative;
  min-height: 0;
  flex: 1;
}

// 点阵只是「这里能放东西」的示意，画在背景上，不占位也不接指针事件
.dt-container__content--dotted {
  background-image: radial-gradient(
    circle at 1px 1px,
    color-mix(in srgb, var(--dt-container-accent) 12%, transparent) 1px,
    transparent 0
  );
  background-size: 16px 16px;
}
</style>
