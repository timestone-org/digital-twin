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
 */
import { computed } from 'vue'
import { DtButton, DtCheckbox, DtIcon, DtSpinner, DtTag } from '@dt/ui'

import type { NodeSelection, TreeNode } from '../browseTree'

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
    <div
      class="flex items-center gap-1.5 py-0.5"
      :style="{ paddingInlineStart: `${depth * 1.1}rem` }"
    >
      <DtButton
        v-if="node.hasChildren"
        variant="ghost"
        size="sm"
        :aria-label="node.isOpen ? '收起' : '展开'"
        @click="onExpand"
      >
        <DtSpinner v-if="node.isLoading" :size="12" />
        <DtIcon
          v-else
          :name="node.isOpen ? 'chevron-down' : 'chevron-right'"
          :size="14"
        />
      </DtButton>
      <span v-else class="inline-block w-6" />

      <!-- ⚠ 变量节点的名字就是勾选框的 label：另起一个 span 当标题的话，读屏
           读到的勾选框没有名称，只会念一声「复选框」 -->
      <DtCheckbox
        v-if="hasBox"
        :model-value="state === 'all'"
        :indeterminate="state === 'some'"
        :disabled="isLocked"
        :label="node.isVariable ? node.name : undefined"
        :aria-label="node.isVariable ? undefined : boxLabel"
        @update:model-value="emit('toggle', node.address)"
      />
      <span
        v-if="!node.isVariable"
        class="truncate text-sm"
        :class="{ 'font-medium': node.hasChildren }"
      >
        {{ node.name }}
      </span>

      <DtTag v-if="node.isVariable" size="sm" intent="info">变量</DtTag>
      <DtTag v-if="taken.has(node.address)" size="sm">已建</DtTag>
      <span class="truncate font-mono text-2xs text-text-secondary">
        {{ node.address }}
      </span>
    </div>

    <p
      v-if="node.error"
      class="m-0 py-0.5 text-xs text-state-danger"
      :style="{ paddingInlineStart: `${(depth + 1) * 1.1}rem` }"
    >
      {{ node.error }}
    </p>

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
