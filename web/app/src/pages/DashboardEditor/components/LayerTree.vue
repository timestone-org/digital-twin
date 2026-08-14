<script setup lang="ts">
/**
 * @fileoverview 图层树：把排版摊平表按缩进列成一张扁平清单，管多选、显隐、
 * 重命名、层序与拖拽换父。它只抛事件，改文档一律由页面交给 `editorActions`。
 * ⚠ 行的 key 用节点 id：用索引的话，删掉中间一层会让其余行的展开态与选中态
 * 整体错位，而错位一眼看不出是错的。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import type { GetModuleManifest } from '@dt/runtime'
import { DtButton, DtIcon, DtInput } from '@dt/ui'
import { computed, ref } from 'vue'

import type { EditorFrame } from '@/features/dashboard/editorLayout'
import { dropPosition, layerRows, resolveDrop } from '../layerTree'
import type { DropPos, DropTarget, LayerRow } from '../layerTree'

const props = defineProps<{
  frames: readonly EditorFrame[]
  nodes: readonly DashboardNodePayload[]
  selectedIds: readonly string[]
  getManifest: GetModuleManifest
}>()

const emit = defineEmits<{
  select: [nodeId: string, additive: boolean]
  toggle: [nodeId: string, isVisible: boolean]
  remove: [nodeId: string]
  rename: [nodeId: string, name: string]
  move: [nodeId: string, parentId: string | null, at?: number]
  center: [nodeId: string]
  front: [nodeId: string]
  back: [nodeId: string]
}>()

/**
 * 图层树自己的拖拽载荷类型：用自定义 MIME 而不是 text/plain，
 * 否则从别处拖进来的任意文本都会被当成一次换父。
 */
const LAYER_DRAG_MIME = 'application/x-dt-layer-node'

const ROW_ACTIONS = [
  { key: 'center', icon: 'home', label: '移到画布中心' },
  { key: 'front', icon: 'chevron-up', label: '置顶' },
  { key: 'back', icon: 'chevron-down', label: '置底' },
] as const

const collapsed = ref<ReadonlySet<string>>(new Set())
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
const dragId = ref<string | null>(null)
const dropAt = ref<{ id: string; pos: DropPos } | null>(null)
// 输入法组合期（拼音选词）的回车只是确认候选词，值还没定稿
let isComposing = false

const rows = computed(() =>
  layerRows(props.frames, props.nodes, props.getManifest, collapsed.value),
)

function isSelected(nodeId: string): boolean {
  return props.selectedIds.includes(nodeId)
}

function toggleFold(nodeId: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(nodeId)) next.add(nodeId)
  collapsed.value = next
}

function onSelect(nodeId: string, event: MouseEvent): void {
  emit('select', nodeId, event.shiftKey || event.metaKey || event.ctrlKey)
}

function runRowAction(key: 'center' | 'front' | 'back', nodeId: string): void {
  if (key === 'center') emit('center', nodeId)
  else if (key === 'front') emit('front', nodeId)
  else emit('back', nodeId)
}

function setComposing(value: boolean): void {
  isComposing = value
}

function startRename(row: LayerRow): void {
  renamingId.value = row.id
  renameDraft.value = row.label
}

function commitRename(nodeId: string): void {
  if (renamingId.value !== nodeId || isComposing) return
  renamingId.value = null
  emit('rename', nodeId, renameDraft.value)
}

/** 组合期的 Esc 是「取消候选词」，放行给输入法。 */
function onRenameKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || isComposing) return
  event.preventDefault()
  renamingId.value = null
}

/** 指针落在这一行的哪一段；行高得当场量，happy-dom 之外才有真实布局。 */
function posOf(event: DragEvent, row: LayerRow): DropPos {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return dropPosition(event.clientY - box.top, box.height, row.isContainer)
}

/** 这一次落点换算成 `move` 的入参；没在拖或落点不合法都是 null。 */
function targetOf(row: LayerRow, pos: DropPos): DropTarget | null {
  const moving = dragId.value
  if (moving === null) return null
  return resolveDrop(
    props.nodes,
    moving,
    { id: row.id, parentId: row.node.parentId },
    pos,
  )
}

function onDragStart(event: DragEvent, nodeId: string): void {
  dragId.value = nodeId
  if (event.dataTransfer === null) return
  event.dataTransfer.setData(LAYER_DRAG_MIME, nodeId)
  event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(event: DragEvent, row: LayerRow): void {
  const pos = posOf(event, row)
  if (targetOf(row, pos) === null) {
    dropAt.value = null
    return
  }
  event.preventDefault()
  dropAt.value = { id: row.id, pos }
}

function onDrop(event: DragEvent, row: LayerRow): void {
  event.preventDefault()
  const moving = dragId.value
  const target = targetOf(row, posOf(event, row))
  dropAt.value = null
  dragId.value = null
  if (moving === null || target === null) return
  if (target.at === null) emit('move', moving, target.parentId)
  else emit('move', moving, target.parentId, target.at)
}

function onRootDrop(event: DragEvent): void {
  event.preventDefault()
  const moving = dragId.value
  dropAt.value = null
  dragId.value = null
  if (moving !== null) emit('move', moving, null)
}
</script>

<template>
  <ul class="m-0 list-none p-0">
    <li v-for="row in rows" :key="row.id">
      <div
        class="dt-layer__row"
        :class="[
          isSelected(row.id) ? 'dt-layer__row--on' : '',
          row.isDimmed ? 'dt-layer__row--dim' : '',
          dropAt !== null && dropAt.id === row.id
            ? `dt-layer__row--${dropAt.pos}`
            : '',
        ]"
        :style="{ paddingLeft: `${row.depth * 12 + 6}px` }"
        draggable="true"
        data-test="layer-row"
        @click="onSelect(row.id, $event)"
        @dragstart="onDragStart($event, row.id)"
        @dragover="onDragOver($event, row)"
        @drop="onDrop($event, row)"
      >
        <DtButton
          v-if="row.hasChildren"
          size="sm"
          variant="ghost"
          :icon="collapsed.has(row.id) ? 'chevron-right' : 'chevron-down'"
          :aria-label="collapsed.has(row.id) ? '展开子层' : '折叠子层'"
          @click.stop="toggleFold(row.id)"
        />
        <span v-else class="inline-block w-6 shrink-0" />
        <DtIcon :name="row.icon" :size="14" />
        <DtInput
          v-if="renamingId === row.id"
          size="sm"
          class="min-w-0 flex-1"
          aria-label="重命名节点"
          :model-value="renameDraft"
          @update:model-value="renameDraft = $event"
          @click.stop
          @enter="commitRename(row.id)"
          @blur="commitRename(row.id)"
          @keydown="onRenameKeydown"
          @compositionstart="setComposing(true)"
          @compositionend="setComposing(false)"
        />
        <span
          v-else
          class="flex-1 truncate"
          title="单击选中（Shift 累积），双击重命名"
          @dblclick.stop="startRename(row)"
        >
          {{ row.label }}
        </span>
        <DtButton
          v-for="action in ROW_ACTIONS"
          :key="action.key"
          size="sm"
          variant="ghost"
          :icon="action.icon"
          :aria-label="action.label"
          @click.stop="runRowAction(action.key, row.id)"
        />
        <DtButton
          size="sm"
          variant="ghost"
          :icon="row.node.isVisible ? 'eye' : 'eye-off'"
          :aria-label="row.node.isVisible ? '隐藏这个节点' : '显示这个节点'"
          @click.stop="emit('toggle', row.id, !row.node.isVisible)"
        />
        <DtButton
          size="sm"
          variant="ghost"
          intent="danger"
          icon="trash"
          aria-label="删除这个节点"
          @click.stop="emit('remove', row.id)"
        />
      </div>
    </li>
    <li
      class="dt-layer__root text-2xs"
      data-test="layer-root-drop"
      @dragover.prevent
      @drop="onRootDrop"
    >
      拖到此处移出容器
    </li>
  </ul>
</template>

<style scoped lang="scss">
.dt-layer__row {
  display: flex;
  gap: 4px;
  align-items: center;
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    background: var(--surface-raised);
  }

  &--on {
    background: var(--surface-raised);
    color: var(--accent-on-surface);
  }

  &--dim {
    opacity: 0.55;
  }

  &--before {
    box-shadow: inset 0 2px 0 var(--accent-primary);
  }

  &--after {
    box-shadow: inset 0 -2px 0 var(--accent-primary);
  }

  &--inside {
    box-shadow: inset 0 0 0 1px var(--accent-primary);
  }
}

.dt-layer__root {
  margin-top: 4px;
  padding: 6px;
  border: 1px dashed var(--border-default);
  border-radius: var(--radius-sm);
  color: var(--text-disabled);
  text-align: center;
}
</style>
