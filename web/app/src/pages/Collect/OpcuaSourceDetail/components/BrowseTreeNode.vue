<script setup lang="ts">
/**
 * @fileoverview 地址空间树的一个节点，递归渲染自己。
 *
 * ⚠ 勾选框只给变量节点：对象节点建成点位就是一个永远读不到值的配置，而它
 * 与「设备暂时没上报」在界面上分不开。
 */
import { DtButton, DtCheckbox, DtIcon, DtSpinner, DtTag } from '@dt/ui'

import type { TreeNode } from '../browseTree'

const props = defineProps<{
  node: TreeNode
  depth: number
  selected: ReadonlySet<string>
  /** 已经建过点位的寻址串，标出来免得重复建。 */
  taken: ReadonlySet<string>
}>()
const emit = defineEmits<{
  expand: [address: string]
  toggle: [address: string]
}>()

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
        :aria-label="node.children === null ? '展开' : '收起'"
        @click="onExpand"
      >
        <DtSpinner v-if="node.isLoading" :size="12" />
        <DtIcon
          v-else
          :name="node.children === null ? 'chevron-right' : 'chevron-down'"
          :size="14"
        />
      </DtButton>
      <span v-else class="inline-block w-6" />

      <!-- ⚠ 名字就是勾选框的 label：另起一个 span 当标题的话，读屏读到的
           勾选框没有名称，只会念一声「复选框」 -->
      <DtCheckbox
        v-if="node.isVariable"
        :model-value="selected.has(node.address)"
        :disabled="taken.has(node.address)"
        :label="node.name"
        @update:model-value="emit('toggle', node.address)"
      />
      <span v-else class="truncate text-sm">{{ node.name }}</span>

      <DtTag v-if="node.isVariable" size="sm" intent="info">变量</DtTag>
      <DtTag v-if="taken.has(node.address)" size="sm">已建</DtTag>
      <span class="truncate font-mono text-2xs text-muted">
        {{ node.address }}
      </span>
    </div>

    <p
      v-if="node.error"
      class="m-0 py-0.5 text-xs text-danger"
      :style="{ paddingInlineStart: `${(depth + 1) * 1.1}rem` }"
    >
      {{ node.error }}
    </p>

    <ul v-if="node.children" class="m-0 p-0">
      <BrowseTreeNode
        v-for="child in node.children"
        :key="child.address"
        :node="child"
        :depth="depth + 1"
        :selected="selected"
        :taken="taken"
        @expand="emit('expand', $event)"
        @toggle="emit('toggle', $event)"
      />
    </ul>
  </li>
</template>
