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
import { layerRows } from '../scripts/layerTree'
import type { LayerRow } from '../scripts/layerTree'
import { useLayerDrag } from '../scripts/useLayerDrag'

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
}>()

const drag = useLayerDrag(
  () => props.nodes,
  (nodeId, parentId, at) => {
    if (at === undefined) emit('move', nodeId, parentId)
    else emit('move', nodeId, parentId, at)
  },
)

const collapsed = ref<ReadonlySet<string>>(new Set())
const renamingId = ref<string | null>(null)
const renameDraft = ref('')
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
</script>

<template>
  <ul class="m-0 list-none p-0">
    <li v-for="row in rows" :key="row.id">
      <div
        class="dt-layer__row"
        :class="[
          isSelected(row.id) ? 'dt-layer__row--on' : '',
          row.isDimmed ? 'dt-layer__row--dim' : '',
          drag.dropAt.value !== null && drag.dropAt.value.id === row.id
            ? `dt-layer__row--${drag.dropAt.value.pos}`
            : '',
        ]"
        :style="{ paddingLeft: `${row.depth * 12 + 6}px` }"
        draggable="true"
        data-test="layer-row"
        @click="onSelect(row.id, $event)"
        @dragstart="drag.onDragStart($event, row.id)"
        @dragover="drag.onDragOver($event, row)"
        @drop="drag.onDrop($event, row)"
      >
        <button
          v-if="row.hasChildren"
          type="button"
          class="dt-layer__fold"
          :aria-label="collapsed.has(row.id) ? '展开子层' : '折叠子层'"
          :aria-expanded="!collapsed.has(row.id)"
          @click.stop="toggleFold(row.id)"
        >
          <DtIcon
            :name="collapsed.has(row.id) ? 'chevron-right' : 'chevron-down'"
            :size="12"
          />
        </button>
        <span v-else class="dt-layer__fold" />
        <DtIcon :name="row.icon" :size="13" class="shrink-0" />
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
        <template v-else>
          <span
            class="min-w-0 flex-1 truncate"
            title="单击选中（Shift 累积），双击重命名"
            @dblclick.stop="startRename(row)"
          >
            {{ row.label }}
          </span>
          <!-- 类型贴在名字后面：同类模块摆好几个时，只看名字分不出这一行是什么 -->
          <span class="dt-layer__type">{{ row.node.moduleType }}</span>
        </template>
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="home"
          class="dt-layer__act"
          aria-label="定位到此节点"
          title="定位到此节点"
          @click.stop="emit('center', row.id)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          :intent="row.node.isVisible ? 'neutral' : 'warning'"
          :icon="row.node.isVisible ? 'eye' : 'eye-off'"
          class="dt-layer__act"
          :class="{ 'dt-layer__act--pinned': !row.node.isVisible }"
          :aria-label="row.node.isVisible ? '隐藏这个节点' : '显示这个节点'"
          :title="row.node.isVisible ? '隐藏这个节点' : '显示这个节点'"
          @click.stop="emit('toggle', row.id, !row.node.isVisible)"
        />
        <DtButton
          size="xs"
          variant="ghost"
          intent="danger"
          icon="trash"
          class="dt-layer__act"
          aria-label="删除这个节点"
          title="删除这个节点"
          @click.stop="emit('remove', row.id)"
        />
      </div>
    </li>
    <li
      class="dt-layer__root text-2xs"
      data-test="layer-root-drop"
      @dragover.prevent
      @drop="drag.onRootDrop"
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
  // 12px 的行内字号：整行是密集工具面板，不走控件档位
  font-size: 12px;

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

// 折叠键：16px 的裸图标键，无背景、无边框。
// ⚠ 左栏只有 15rem，用控件档位（sm = 32px 见方）摆五个键就把名字挤没了，
// 那正是「看不出这一行是什么模块」的原因——行内动作键走 DtButton 的 xs 档。
.dt-layer__fold {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  cursor: pointer;

  &:hover {
    color: var(--accent-primary);
  }
}

.dt-layer__act {
  flex: none;
  // 静息态藏起来，一行不被按钮占满；键盘走焦点时要现身，否则 Tab 到的是看不见的键
  opacity: 0;
  transition: opacity 0.15s ease;

  // 已隐藏的节点：这个键是当前状态的唯一提示，不能跟着藏
  &--pinned {
    opacity: 1;
  }
}

.dt-layer__row:hover .dt-layer__act,
.dt-layer__row:focus-within .dt-layer__act,
.dt-layer__row--on .dt-layer__act {
  opacity: 1;
}

// 类型名让位给节点名：先被压缩，压到没有为止
.dt-layer__type {
  min-width: 0;
  overflow: hidden;
  color: var(--text-disabled);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
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
