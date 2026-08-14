<script setup lang="ts">
/**
 * @fileoverview header 的渲染壳：背景、可选标题条、内容区。
 * ⚠ 子节点走**默认插槽**由运行时注入，插槽名写错既不报错也不渲染——
 * 由 tests/modules/header/Component.spec.ts 的插槽用例守。
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
const layout = computed(() =>
  readContainerLayout(props.config[CONTAINER_CONFIG_KEY]),
)

const shellStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    '--dt-header-accent': accent.value,
    '--dt-header-bar-height': `${TITLE_BAR_HEIGHT_PX}px`,
  }
  if (background.value !== '') style.background = background.value
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div class="dt-header" :style="shellStyle">
    <div v-if="isTitleShown" class="dt-header__bar">
      <span class="dt-header__title">{{ title }}</span>
    </div>
    <div class="dt-header__content" :style="contentStyle"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
.dt-header {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-bottom: 1px solid var(--dt-header-accent);
}

.dt-header__bar {
  display: flex;
  height: var(--dt-header-bar-height);
  flex: none;
  align-items: center;
  justify-content: center;
}

.dt-header__title {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 18px;
  letter-spacing: 0.08em;
  text-shadow: var(--fx-glow-title);
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次
.dt-header__content {
  position: relative;
  min-height: 0;
  flex: 1;
}
</style>
