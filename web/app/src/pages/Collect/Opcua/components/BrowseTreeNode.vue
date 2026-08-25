<script setup lang="ts">
/**
 * @fileoverview 地址空间树的一个节点，递归渲染自己。
 *
 * ⚠ 上层节点的勾选框**不是把它自己建成点位**（对象节点建成点位就是一个永远
 * 读不到值的配置），而是「把它下面的变量全勾上」。两种语义长得一样、后果差
 * 很远，所以它的可读名称写死成「全选 xxx 下的点位」。
 *
 * ⚠ 半选（`some`）与全选（`all`）必须画成两个样子：上层显示全选时，用户就
 * 不会再往下看——而下面很可能还有没拉回来的层。
 *
 * ⚠ 缩进列与折叠钮同宽、且都不许收缩：宽度不等，有箭头的行与没箭头的行就错开
 * 一格；可收缩的话，同一层里名字长的那几行会被挤得比兄弟行更靠左——两样都让
 * 「谁挂在谁下面」彻底读不出来。
 */
import { computed } from 'vue'
import { DtButton, DtCheckbox, DtTag } from '@dt/ui'

import type { NodeSelection, TreeNode } from '../scripts/browseTree'

const props = defineProps<{
  node: TreeNode
  depth: number
  /** 每个节点的勾选态，按寻址串查。 */
  states: ReadonlyMap<string, NodeSelection>
  /** 已经建过点位的寻址串，标出来免得重复建。 */
  taken: ReadonlySet<string>
}>()
const emit = defineEmits<{
  expand: [address: string]
  toggle: [address: string]
}>()

const state = computed<NodeSelection>(
  () => props.states.get(props.node.address) ?? 'none',
)

/** 上层节点也给勾选框；没有子节点的非变量节点没什么可勾的。 */
const hasBox = computed(() => props.node.isVariable || props.node.hasChildren)

/** 已经建过点位的变量不必再勾。上层节点照常可勾——它会跳过这些。 */
const isLocked = computed(
  () => props.node.isVariable && props.taken.has(props.node.address),
)

const boxLabel = computed(() =>
  props.node.isVariable
    ? props.node.name
    : `全选「${props.node.name}」下的点位`,
)

function onExpand(): void {
  emit('expand', props.node.address)
}
</script>

<template>
  <li class="list-none">
    <div class="tree-row">
      <!-- 每一层祖先留一条竖线：只缩进不画线的话，几十行的一层里看不出哪些是
           兄弟。线走缩进列的中线，正对着父节点的折叠钮 -->
      <span
        v-for="level in depth"
        :key="level"
        class="tree-guide"
        aria-hidden="true"
      />

      <div class="tree-main">
        <DtButton
          v-if="node.hasChildren"
          class="tree-caret"
          variant="ghost"
          size="xs"
          :icon="node.isOpen ? 'chevron-down' : 'chevron-right'"
          :loading="node.isLoading"
          :aria-label="node.isOpen ? '收起' : '展开'"
          @click="onExpand"
        />
        <span v-else class="tree-caret" aria-hidden="true" />

        <!-- ⚠ 变量节点的名字放进勾选框的插槽（它仍在 `<label>` 里，因此仍是这个
             框的可读名称）：另起一个平级的 span 当标题的话，读屏读到的勾选框
             没有名称，只会念一声「复选框」 -->
        <DtCheckbox
          v-if="hasBox"
          class="tree-box"
          :model-value="state === 'all'"
          :indeterminate="state === 'some'"
          :disabled="isLocked"
          :aria-label="node.isVariable ? undefined : boxLabel"
          @update:model-value="emit('toggle', node.address)"
        >
          <span v-if="node.isVariable" class="tree-leaf-name truncate">
            {{ node.name }}
          </span>
        </DtCheckbox>
        <span
          v-if="!node.isVariable"
          class="truncate text-sm"
          :class="{ 'font-medium': node.hasChildren }"
        >
          {{ node.name }}
        </span>

        <DtTag v-if="node.isVariable" class="shrink-0" size="sm" intent="info">
          变量
        </DtTag>
        <DtTag v-if="taken.has(node.address)" class="shrink-0" size="sm">
          已建
        </DtTag>
        <!-- ⚠ 寻址串这一列吃掉剩下的宽度并由它先截断（`flex-1` 的 basis 是 0，
             收缩权重也是 0）：与名字平摊收缩的话，一行里两样一起截，而名字才是
             人在树上找点位的依据 -->
        <span
          class="min-w-0 flex-1 truncate font-mono text-2xs text-text-secondary"
        >
          {{ node.address }}
        </span>
      </div>
    </div>

    <div v-if="node.error" class="tree-row">
      <span
        v-for="level in depth + 1"
        :key="level"
        class="tree-guide"
        aria-hidden="true"
      />
      <div class="tree-main">
        <p class="m-0 truncate text-xs text-state-danger">{{ node.error }}</p>
      </div>
    </div>

    <ul v-if="node.children && node.isOpen" class="m-0 p-0">
      <BrowseTreeNode
        v-for="child in node.children"
        :key="child.address"
        :node="child"
        :depth="depth + 1"
        :states="states"
        :taken="taken"
        @expand="emit('expand', $event)"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>

<style scoped lang="scss">
.tree-row {
  // 折叠钮的边长，同时也是一级缩进：两者不等，竖线就对不上父节点的箭头
  --tree-caret: 1.25rem;

  display: flex;
  // ⚠ 不许改成 center：竖线靠缩进列撑满行高才能上下接成一条，居中对齐会让它们
  // 退回自身内容高度（0），画出来是一截一截的
  align-items: stretch;
  min-width: 0;
}

// 缩进列。⚠ `flex-shrink` 必须是 0：默认值会让名字长的行把缩进挤掉，同一层的
// 兄弟于是各缩各的，看着像深浅不一的好几层
.tree-guide {
  position: relative;
  flex: 0 0 var(--tree-caret);

  &::before {
    content: '';
    position: absolute;
    inset-block: 0;
    inset-inline-start: calc(var(--tree-caret) / 2);
    border-inline-start: 1px solid var(--border-default);
  }
}

// ⚠ 行高留白只能加在这层：加在 .tree-row 上的话，缩进列被 stretch 到的是内容
// 盒，上下 padding 成了两行之间的空档，竖线会断
.tree-main {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  padding-block: 3px;
}

// 「没有箭头」也占同一格，否则叶子节点会比有子节点的兄弟行少缩一格
.tree-caret {
  flex: 0 0 var(--tree-caret);
}

// 勾选框整块要能收缩，里面的名字才轮得到 truncate——不然长名字把整行撑开
.tree-box {
  min-width: 0;
}

// 与 DtCheckbox 自带的 label 同款；名字进了插槽就不再走那条样式
.tree-leaf-name {
  font-size: 13px;
  color: var(--text-secondary);
}
</style>
