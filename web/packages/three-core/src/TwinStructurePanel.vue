<script setup lang="ts">
/**
 * @fileoverview 结构树的浮层外壳：定位、滚动与那句必须说出来的提示。
 * ⚠ 与递归的树体分开：树体自己调用自己，套上浮层样式会让每一层都画一个框。
 */
import TwinStructureTree from './TwinStructureTree.vue'
import type { StructureTree } from './useStructureTree'

defineProps<{ tree: StructureTree }>()
</script>

<template>
  <div class="twin-structure" data-test="twin-structure-panel">
    <!-- ⚠ 必须说出来：勾掉只影响当前会话，否则用户会以为自己改坏了这张大屏 -->
    <p class="twin-structure__note text-2xs">
      勾选显隐只影响当前会话，不写回配置
    </p>
    <TwinStructureTree :tree="tree" :nodes="tree.nodes.value" />
  </div>
</template>

<style scoped lang="scss">
.twin-structure {
  position: absolute;
  bottom: 12px;
  left: 12px;
  width: 15rem;
  max-height: 40%;
  overflow-y: auto;
  background: var(--surface-sunken);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);

  &__note {
    margin: 0;
    padding: 4px 6px;
    color: var(--text-disabled);
  }
}
</style>
