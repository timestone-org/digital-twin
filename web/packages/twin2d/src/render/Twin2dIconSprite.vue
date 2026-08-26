<script setup lang="ts">
/**
 * @fileoverview 内置图标 sprite 的挂载点：把 `icons.svg` 的 11 枚 `<symbol>` 内联进
 * 当前 DOM 文档，此后本文档内任意 `<svg viewBox="0 0 48 48"><use href="#ico-…"/></svg>`
 * 才解析得到图标（见 MODULE_TWIN_2D_DESIGN.md §5）。
 *
 * ⚠ 每个 DOM 文档挂一次，漏挂时图标**静默消失**：`<use>` 元素照样在 devtools 里，
 * 只是解析不到任何目标，控制台一声不吭。
 */
// 模板里那处 `v-html` 之所以放行：内容是本仓自己的静态资源 icons.svg，构建期由
// `?raw` 内联成模块常量；组件不收任何 prop 与插槽，没有半个口子能把外部内容送进去。
import iconSprite from './icons.svg?raw'
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -->
  <div class="twin2d-icon-sprite" aria-hidden="true" v-html="iconSprite" />
</template>

<style scoped>
/* 只当 symbol 的容器，零尺寸且脱离文档流，绝不参与布局 */
.twin2d-icon-sprite {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}
</style>
