<script setup lang="ts">
/**
 * @fileoverview 运行态只读结构树：浏览层级、勾选显隐、点击定位。
 * ⚠ 勾选显隐只影响当前会话，不写回配置——面板上必须说出来，否则用户会以为
 * 自己刚刚改坏了这张大屏。
 */
import { DtButton, DtCheckbox } from '@dt/ui'

import type { SceneTreeNode } from './sceneTree'
import type { StructureTree } from './useStructureTree'

defineProps<{
  tree: StructureTree
  /** 这一层的节点；根层由宿主传 `tree.nodes.value`，子层递归传自己。 */
  nodes: readonly SceneTreeNode[]
  /** 当前层级深度，用来缩进。 */
  depth?: number
}>()

/** 没名字的节点按类型兜底，总比一行空白强。 */
function labelOf(node: SceneTreeNode): string {
  if (node.name !== '') return node.name
  return node.isMesh ? '（无名网格）' : '（无名分组）'
}
</script>

<template>
  <ul class="twin-tree" data-test="twin-structure-tree">
    <li v-for="node in nodes" :key="node.uid" class="twin-tree__item">
      <div
        class="twin-tree__row"
        :style="{ paddingLeft: `${(depth ?? 0) * 10}px` }"
      >
        <DtButton
          v-if="node.children.length > 0"
          variant="ghost"
          intent="neutral"
          size="sm"
          :icon="
            tree.expanded.value.has(node.uid) ? 'chevron-down' : 'chevron-right'
          "
          :aria-label="tree.expanded.value.has(node.uid) ? '收起' : '展开'"
          @click="tree.toggleExpand(node.uid)"
        />
        <span v-else class="twin-tree__leaf" aria-hidden="true" />

        <DtCheckbox
          :model-value="!tree.hidden.value.has(node.uid)"
          :aria-label="`显示 ${labelOf(node)}`"
          @update:model-value="tree.toggleVisible(node.uid)"
        />

        <DtButton
          variant="ghost"
          intent="neutral"
          size="sm"
          block
          class="twin-tree__label"
          :title="`${labelOf(node)}｜${node.triangles} 面`"
          @click="tree.locate(node.uid)"
        >
          {{ labelOf(node) }}
        </DtButton>
      </div>

      <TwinStructureTree
        v-if="tree.expanded.value.has(node.uid) && node.children.length > 0"
        :tree="tree"
        :nodes="node.children"
        :depth="(depth ?? 0) + 1"
      />
    </li>
  </ul>
</template>

<style scoped lang="scss">
.twin-tree {
  margin: 0;
  padding: 0;
  list-style: none;

  &__row {
    display: flex;
    gap: 2px;
    align-items: center;
  }

  &__leaf {
    flex: none;
    width: 20px;
  }

  &__label {
    justify-content: flex-start;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
}
</style>
