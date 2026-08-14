<script setup lang="ts">
/**
 * @fileoverview 卡片型模块的内容骨架：标题栏加主体插槽。
 * 卡片框本身（边框、背景、圆角）由渲染宿主提供，这里只管模块内部这两段，
 * 且标题栏走共享的 ModuleTitleBar——与 bare 模块像素级一致。
 */
import { computed } from 'vue'

import ModuleTitleBar from './ModuleTitleBar.vue'
import { readTrimmedText } from './config'

const props = defineProps<{ title?: string }>()

const heading = computed(() => readTrimmedText(props.title))
</script>

<template>
  <div class="module-panel">
    <ModuleTitleBar v-if="heading !== ''" :title="heading" />
    <div class="module-panel__body"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
.module-panel {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}

.module-panel__body {
  min-height: 0;
  flex: 1;
}
</style>
