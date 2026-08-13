<script setup lang="ts">
/**
 * @fileoverview 地址空间的树。DOM 是摊平的一串 `treeitem`，层级靠
 * `aria-level` / `aria-setsize` / `aria-posinset` 表达——这是 ARIA 认可的
 * flattened tree 形态，也让键盘漫游只需要在一个一维数组上移动。
 *
 * ⚠ 「父节点不在本页」的标记不许省：那一支是被分页截断后挂到根上的，
 * 不标出来会让人以为层级本来就是平的。
 *
 * ⚠ 只有一个 `treeitem` 可 tab 到（roving tabindex）。整棵树若每行都可 tab，
 * 一个几百点的地址空间会让键盘用户按几百次 Tab 才能走出这个区域。
 */
import { nextTick, ref, watch } from 'vue'

import { DtIcon, DtTag } from '@dt/ui'

import { iconOfClass } from '../nodeFacts'
import type { NodeTreeRow } from '../nodeTree'

const props = defineProps<{
  rows: readonly NodeTreeRow[]
  selectedId: string | null
}>()
const emit = defineEmits<{
  select: [nodeId: string]
  toggle: [nodeId: string]
  expand: [nodeId: string]
  collapse: [nodeId: string]
}>()

/** 键盘焦点所在行。与「选中」分开：可以先漫游再回车选。 */
const activeIndex = ref(0)
const itemRefs = ref<HTMLElement[]>([])

function iconOf(row: NodeTreeRow): string {
  return iconOfClass(row.node.node_class)
}

/** 行数变了（搜索、展开）时把焦点索引夹回有效范围。 */
watch(
  () => props.rows.length,
  (length) => {
    if (activeIndex.value >= length) activeIndex.value = Math.max(0, length - 1)
  },
)

// 选中项换了（比如从别处跳过来）就把键盘焦点也挪过去，两者不该脱节
watch(
  () => props.selectedId,
  (id) => {
    if (id === null) return
    const index = props.rows.findIndex((row) => row.node.id === id)
    if (index >= 0) activeIndex.value = index
  },
)

async function focusRow(index: number): Promise<void> {
  activeIndex.value = index
  await nextTick()
  itemRefs.value[index]?.focus()
}

/** ArrowRight：收着就展开，展开了就进第一个子节点。 */
function onRight(row: NodeTreeRow, index: number): void {
  if (row.hasChildren && !row.isExpanded) emit('expand', row.node.id)
  else if (row.hasChildren) void focusRow(index + 1)
}

/** ArrowLeft：展开着就收起，已收起就回到父节点那一行。 */
function onLeft(row: NodeTreeRow, index: number): void {
  if (row.hasChildren && row.isExpanded) {
    emit('collapse', row.node.id)
    return
  }
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = props.rows[cursor]
    if (candidate !== undefined && candidate.depth < row.depth) {
      void focusRow(cursor)
      return
    }
  }
}

function onKeydown(
  event: KeyboardEvent,
  row: NodeTreeRow,
  index: number,
): void {
  const last = props.rows.length - 1
  const handlers: Record<string, () => void> = {
    ArrowDown: () => void focusRow(Math.min(index + 1, last)),
    ArrowUp: () => void focusRow(Math.max(index - 1, 0)),
    Home: () => void focusRow(0),
    End: () => void focusRow(last),
    ArrowRight: () => onRight(row, index),
    ArrowLeft: () => onLeft(row, index),
    Enter: () => emit('select', row.node.id),
    ' ': () => emit('select', row.node.id),
  }
  const handler = handlers[event.key]
  if (handler === undefined) return
  event.preventDefault()
  handler()
}

function onClick(row: NodeTreeRow, index: number): void {
  activeIndex.value = index
  emit('select', row.node.id)
}
</script>

<template>
  <div
    role="tree"
    aria-label="地址空间"
    class="flex flex-col gap-0.5 overflow-auto"
  >
    <div
      v-for="(row, index) in rows"
      :key="row.node.id"
      ref="itemRefs"
      role="treeitem"
      class="node-row"
      :class="{ 'is-active': row.node.id === selectedId }"
      :style="{ paddingLeft: `${row.depth * 1.05 + 0.375}rem` }"
      :aria-level="row.depth + 1"
      :aria-setsize="row.setSize"
      :aria-posinset="row.posInSet"
      :aria-selected="row.node.id === selectedId"
      :aria-expanded="row.hasChildren ? row.isExpanded : undefined"
      :tabindex="index === activeIndex ? 0 : -1"
      @click="onClick(row, index)"
      @keydown="onKeydown($event, row, index)"
    >
      <!-- ⚠ 折叠钮是行内的独立热区，点它不该顺带选中——两个动作分开，
           「看看下面有什么」与「我要操作这个节点」是两回事 -->
      <span
        v-if="row.hasChildren"
        class="node-caret"
        :aria-hidden="true"
        @click.stop="emit('toggle', row.node.id)"
      >
        <DtIcon
          :name="row.isExpanded ? 'chevron-down' : 'chevron-right'"
          :size="12"
        />
      </span>
      <span v-else class="node-caret-placeholder" :aria-hidden="true" />

      <DtIcon :name="iconOf(row)" :size="12" class="shrink-0" />
      <span class="truncate">{{ row.node.browse_name }}</span>

      <DtTag v-if="row.isOrphan" intent="warning" size="sm">
        父节点不在本页
      </DtTag>
    </div>
  </div>
</template>

<style scoped lang="scss">
.node-row {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding-top: 0.25rem;
  padding-right: 0.5rem;
  padding-bottom: 0.25rem;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--surface-raised);
  }

  // ⚠ 焦点环不能省：roving tabindex 下键盘用户全靠它知道自己在哪一行
  &:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: -2px;
  }

  // 选中态与页签一致：强调色的浅色底 + 强调色文字，跨 6 套主题都成立
  &.is-active {
    background: color-mix(in srgb, var(--accent-primary) 12%, transparent);
    color: var(--text-primary);
  }
}

.node-caret,
.node-caret-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 1rem;
  height: 1rem;
}

.node-caret {
  border-radius: var(--radius-sm);

  &:hover {
    background: var(--surface-raised);
  }
}
</style>
