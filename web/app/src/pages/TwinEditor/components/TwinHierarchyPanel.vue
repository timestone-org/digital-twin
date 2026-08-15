<script setup lang="ts">
/**
 * @fileoverview 左栏「层级」页签：钻取树的建根 / 建子 / 同级挪位 / 拖拽改父子 / 点选。
 * 它自己不改文档，只抛事件，改配置一律由页面交给 `hierOps`。
 * ⚠ 拖进自己的子树会让这几层从任何根都走不到，在钻取里整片消失——所以落点
 * 在这里就先滤一遍（`canDropHierOn`），不等诊断事后报。
 */
import type { TwinConfig } from '@dt/twin-config'
import { DtButton, DtIcon } from '@dt/ui'
import { computed, ref } from 'vue'

import { buildHierRows, canDropHierOn } from '../hierRows'
import type { TwinHierRow } from '../hierRows'
import { isSameSelection } from '../types'
import type { TwinSelection } from '../types'

const props = defineProps<{
  config: TwinConfig
  selection: TwinSelection | null
  /** 有诊断问题的实体 id 集合，树上打红点。 */
  flaggedIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  select: [TwinSelection]
  add: [string | null]
  remove: [string]
  move: [{ id: string; delta: number }]
  reparent: [{ id: string; parentId: string | null }]
}>()

/** 行内图标键的样式，四个键共用一串。 */
const ACT =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-text-disabled hover:text-accent-primary disabled:cursor-not-allowed disabled:opacity-30'

/** 每一层缩进的像素数。 */
const INDENT_PX = 12

const collapsed = ref<ReadonlySet<string>>(new Set())
const draggingId = ref('')
/** 正悬在哪个落点上；`''` = 顶层落区，null = 没有。 */
const dropTarget = ref<string | null>(null)

const rows = computed(() =>
  buildHierRows(props.config.hierNodes, collapsed.value, props.flaggedIds),
)

function isSelected(row: TwinHierRow): boolean {
  return isSameSelection(props.selection, { kind: 'hierNodes', id: row.id })
}

function indentOf(row: TwinHierRow): string {
  return `${row.depth * INDENT_PX}px`
}

function toggle(id: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(id)) next.add(id)
  collapsed.value = next
}

function startDrag(id: string): void {
  draggingId.value = id
}

function endDrag(): void {
  draggingId.value = ''
  dropTarget.value = null
}

/** 落点合法才 `preventDefault`：不拦的话浏览器就不认这是一个可放置的目标。 */
function overRow(event: DragEvent, id: string | null): void {
  if (!canDropHierOn(props.config.hierNodes, draggingId.value, id)) return
  event.preventDefault()
  dropTarget.value = id ?? ''
}

function dropOn(id: string | null): void {
  const dragged = draggingId.value
  endDrag()
  if (!canDropHierOn(props.config.hierNodes, dragged, id)) return
  emit('reparent', { id: dragged, parentId: id })
  if (id !== null && collapsed.value.has(id)) toggle(id)
}

function isDropTarget(id: string | null): boolean {
  return dropTarget.value === (id ?? '')
}

const pendingRemoveKey = ref<string | null>(null)

function confirmRemove(row: TwinHierRow): void {
  pendingRemoveKey.value = null
  emit('remove', row.id)
}
</script>

<template>
  <div class="flex flex-col gap-1 p-1" data-test="twin-hierarchy">
    <div class="flex items-center gap-1 px-1">
      <span
        class="min-w-0 flex-1 truncate text-xs font-medium text-text-secondary"
      >
        钻取层级
      </span>
      <span class="text-3xs text-text-disabled">{{ rows.length }}</span>
      <button
        type="button"
        :class="ACT"
        aria-label="新建根节点"
        title="新建根节点"
        data-test="hier-add-root"
        @click="emit('add', null)"
      >
        <DtIcon name="plus" :size="12" />
      </button>
    </div>

    <div
      v-if="rows.length === 0"
      class="flex flex-col gap-2 rounded-[var(--radius-sm)] border border-dashed border-border-subtle px-2 py-3"
      data-test="hier-empty"
    >
      <p class="text-3xs leading-relaxed text-text-disabled">
        层级钻取让看屏的人从厂区一层层点进车间、设备：父层显示摘要卡片，叶子层显示完整读数。先建一个根节点。
      </p>
      <DtButton
        variant="soft"
        size="sm"
        icon="plus"
        block
        data-test="hier-empty-add"
        @click="emit('add', null)"
      >
        新建根节点
      </DtButton>
    </div>

    <template v-for="row in rows" :key="row.key">
      <div
        class="flex items-center gap-0.5 rounded-[var(--radius-sm)] pr-1 text-xs"
        :class="[
          isSelected(row)
            ? 'bg-surface-raised text-accent-on-surface'
            : 'text-text-secondary hover:bg-surface-raised',
          isDropTarget(row.id) ? 'ring-1 ring-accent-primary' : '',
        ]"
        draggable="true"
        data-test="hier-row"
        :data-id="row.id"
        :data-depth="row.depth"
        @dragstart="startDrag(row.id)"
        @dragend="endDrag"
        @dragover="overRow($event, row.id)"
        @drop="dropOn(row.id)"
      >
        <span :style="{ paddingLeft: indentOf(row) }" />
        <button
          v-if="row.hasChildren"
          type="button"
          :class="ACT"
          :aria-expanded="!row.collapsed"
          :aria-label="`展开或折叠${row.label}`"
          data-test="hier-toggle"
          @click="toggle(row.id)"
        >
          <DtIcon
            :name="row.collapsed ? 'chevron-right' : 'chevron-down'"
            :size="12"
          />
        </button>
        <span v-else class="w-5 shrink-0" />

        <button
          type="button"
          class="flex min-w-0 flex-1 items-center gap-1.5 px-1 py-1 text-left"
          data-test="hier-select"
          @click="emit('select', { kind: 'hierNodes', id: row.id })"
        >
          <DtIcon :name="row.icon" :size="12" />
          <span class="min-w-0 flex-1 truncate">{{ row.label }}</span>
          <span class="shrink-0 text-3xs text-text-disabled">{{
            row.meta
          }}</span>
          <span
            v-if="row.flagged"
            class="h-1.5 w-1.5 shrink-0 rounded-full bg-state-danger"
            title="这一项有配置问题"
            data-test="hier-flag"
          />
        </button>

        <button
          type="button"
          :class="ACT"
          :disabled="!row.canMoveUp"
          :aria-label="`上移${row.label}`"
          data-test="hier-up"
          @click="emit('move', { id: row.id, delta: -1 })"
        >
          <DtIcon name="chevron-up" :size="12" />
        </button>
        <button
          type="button"
          :class="ACT"
          :disabled="!row.canMoveDown"
          :aria-label="`下移${row.label}`"
          data-test="hier-down"
          @click="emit('move', { id: row.id, delta: 1 })"
        >
          <DtIcon name="chevron-down" :size="12" />
        </button>
        <button
          type="button"
          :class="ACT"
          :aria-label="`在${row.label}下新建子节点`"
          data-test="hier-add-child"
          @click="emit('add', row.id)"
        >
          <DtIcon name="plus" :size="12" />
        </button>
        <button
          type="button"
          :class="ACT"
          :aria-label="`删除${row.label}`"
          data-test="hier-remove"
          @click="pendingRemoveKey = row.key"
        >
          <DtIcon name="trash" :size="12" />
        </button>
      </div>

      <!-- 二次确认就地展开：连带影响写在这里，弹窗会把它挪出用户的视线 -->
      <div
        v-if="pendingRemoveKey === row.key"
        class="flex flex-wrap items-center gap-1 rounded-[var(--radius-sm)] bg-surface-raised px-2 py-1 text-3xs text-text-secondary"
        data-test="hier-remove-confirm"
      >
        <span>删除「{{ row.label }}」？</span>
        <span v-if="row.hasChildren" class="text-state-danger">
          下级会各自变成一个根，需要自己改挂
        </span>
        <button
          type="button"
          class="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-state-danger hover:bg-state-danger/10"
          data-test="hier-remove-yes"
          @click="confirmRemove(row)"
        >
          确认删除
        </button>
        <button
          type="button"
          class="rounded-[var(--radius-sm)] px-1.5 py-0.5 hover:text-text-primary"
          data-test="hier-remove-no"
          @click="pendingRemoveKey = null"
        >
          取消
        </button>
      </div>
    </template>

    <div
      v-if="rows.length > 0"
      class="rounded-[var(--radius-sm)] border border-dashed px-2 py-1.5 text-center text-3xs"
      :class="
        isDropTarget(null)
          ? 'border-accent-primary text-accent-on-surface'
          : 'border-border-subtle text-text-disabled'
      "
      data-test="hier-drop-root"
      @dragover="overRow($event, null)"
      @drop="dropOn(null)"
    >
      拖到这里提到顶层
    </div>
  </div>
</template>
