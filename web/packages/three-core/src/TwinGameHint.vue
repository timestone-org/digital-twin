<script setup lang="ts">
/**
 * @fileoverview 游戏操作模式的按键提示：不吃指针事件，点击照常落到画布上。
 */
</script>

<template>
  <div class="twin-game-hint" data-test="game-navigation-hint">
    单击画面捕获鼠标 · WASD 平移 · 空格上升 · Shift 下降 · 鼠标转向 · Esc 释放
  </div>
</template>

<style scoped lang="scss">
.twin-game-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: var(--z-sticky);
  padding: 5px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  pointer-events: none;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-pill);
  transform: translateX(-50%);
}
</style>
