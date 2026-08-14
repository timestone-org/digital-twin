<script setup lang="ts">
/**
 * @fileoverview footer 的渲染壳：背景、可选标题条、内容区。
 * ⚠ 子节点走**默认插槽**由运行时注入，插槽名写错既不报错也不渲染——
 * 由 tests/modules/footer/Component.spec.ts 的插槽用例守。
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
    '--dt-footer-accent': accent.value,
    '--dt-footer-bar-height': `${TITLE_BAR_HEIGHT_PX}px`,
  }
  if (background.value !== '') style.background = background.value
  return style
})

const contentStyle = computed<CSSProperties>(() => ({
  padding: `${layout.value.pad}px`,
}))
</script>

<template>
  <div class="dt-footer" :style="shellStyle">
    <div v-if="isTitleShown" class="dt-footer__bar">
      <span class="dt-footer__title">{{ title }}</span>
    </div>
    <div class="dt-footer__content" :style="contentStyle"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
// 与页头对称：分隔线画在**顶边**，扫光也压在顶边上
.dt-footer {
  position: relative;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  overflow: hidden;
  border-top: 1px solid var(--dt-footer-accent);
}

// 顶边扫光，纯装饰；不接指针事件，否则会吃掉贴着顶边那一排子节点的点击
.dt-footer::before {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    color-mix(in srgb, var(--dt-footer-accent) 60%, transparent),
    transparent
  );
  content: '';
  pointer-events: none;
}

.dt-footer__bar {
  display: flex;
  height: var(--dt-footer-bar-height);
  flex: none;
  align-items: center;
  justify-content: center;
}

.dt-footer__title {
  color: var(--text-primary);
  font-family: var(--font-display);
  font-size: 14px;
  letter-spacing: 0.08em;
  text-shadow: var(--fx-glow-title);
}

// 子节点在这一层里绝对定位；内缩已经由 padding 让出来，运行时不要再算一次
.dt-footer__content {
  position: relative;
  min-height: 0;
  flex: 1;
}
</style>
