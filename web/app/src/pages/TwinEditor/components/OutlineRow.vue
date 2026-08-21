<script setup lang="ts">
/**
 * @fileoverview 大纲树的一行：文档序号 + 名字 + meta + 红点，行内「眼睛 + ⋯」。
 * 所有动作归成一个 `act` 事件抛给上层；删除的二次确认条也画在这里
 * （上层只在有连带影响时才把 `confirmText` 递进来）。
 */
import type { DtMenuItem } from '@dt/contracts'
import { DtButton, DtDropdownMenu } from '@dt/ui'
import { computed } from 'vue'

import { ROW_MENU_INTO_PREFIX, outlineRowMenu } from '../scripts/outlineMenus'
import type { OutlineRowAction } from '../scripts/outlineMenus'
import { OUTLINE_ACT_HIDDEN } from '../scripts/outlineStyles'
import type { TwinTextSlices } from '../scripts/outlineFilter'
import type { TwinOutlineRow } from '../scripts/outlineNodes'

const props = defineProps<{
  row: TwinOutlineRow
  selected: boolean
  /** 搜索态：菜单里的上移/下移禁用。 */
  searching: boolean
  /** 名字的高亮切片；null = 名字没命中（可能按 id 命中或整段放行）。 */
  slices: TwinTextSlices | null
  /** 同段全部夹，「移入」菜单项逐夹生成。 */
  folders: readonly { id: string; label: string }[]
  /** 行当前所在夹；null = 散行。 */
  folderId: string | null
  /** 非 null = 正在等二次确认，值是连带影响文案。 */
  confirmText: string | null
}>()

const emit = defineEmits<{
  act: [action: OutlineRowAction]
}>()

const menu = computed(() =>
  outlineRowMenu({
    searching: props.searching,
    canMoveUp: props.row.canMoveUp,
    canMoveDown: props.row.canMoveDown,
    folders: props.folders,
    folderId: props.folderId,
  }),
)

/** 夹内行比散行多缩一档；散行自己缩进 12px。 */
const indentPx = computed(() => (props.folderId === null ? '12px' : '24px'))

/** 选中行的动作键常驻；其余静息隐藏、悬停 / 焦点现身。 */
const hiddenClass = computed(() => (props.selected ? '' : OUTLINE_ACT_HIDDEN))

function onMenu(item: DtMenuItem): void {
  const value = item.value
  if (value === 'move-up') emit('act', { type: 'move', delta: -1 })
  else if (value === 'move-down') emit('act', { type: 'move', delta: 1 })
  else if (value === 'duplicate') emit('act', { type: 'duplicate' })
  else if (value === 'remove') emit('act', { type: 'remove-request' })
  else if (value === 'folder-out') emit('act', { type: 'folder-out' })
  else if (value === 'folder-new') emit('act', { type: 'folder-new' })
  else if (value.startsWith(ROW_MENU_INTO_PREFIX))
    emit('act', {
      type: 'folder-into',
      folderId: value.slice(ROW_MENU_INTO_PREFIX.length),
    })
}
</script>

<template>
  <div
    class="group flex items-center gap-0.5 rounded-[var(--radius-sm)] pr-1 text-xs"
    :class="
      selected
        ? 'bg-surface-raised text-accent-on-surface'
        : 'text-text-secondary hover:bg-surface-raised'
    "
    :style="{ paddingLeft: indentPx }"
    data-test="outline-row"
    :data-id="row.id"
  >
    <button
      type="button"
      class="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
      data-test="row-select"
      @click="emit('act', { type: 'select' })"
    >
      <!-- 序号不是装饰：数组绑定按这个位次对齐 -->
      <span
        class="w-4 shrink-0 text-right text-3xs tabular-nums text-text-disabled"
        title="文档序号，数组绑定按它对齐"
      >
        {{ row.index }}
      </span>
      <span class="min-w-0 flex-1 truncate">
        <template v-if="slices !== null"
          >{{ slices.before
          }}<mark class="rounded-[2px] bg-accent-primary/25 text-inherit">{{
            slices.match
          }}</mark
          >{{ slices.after }}</template
        >
        <template v-else>{{ row.label }}</template>
      </span>
      <span v-if="row.meta !== ''" class="shrink-0 text-3xs text-text-disabled">
        {{ row.meta }}
      </span>
      <span
        v-if="row.flagged"
        class="h-1.5 w-1.5 shrink-0 rounded-full bg-state-danger"
        title="这一项有配置问题"
        data-test="row-flag"
      />
    </button>
    <!-- 已隐藏时 eye-off 用警示色常驻：这个键是当前状态的唯一提示，不能跟着藏 -->
    <DtButton
      v-if="row.visible !== null"
      size="xs"
      variant="ghost"
      :intent="row.visible ? 'neutral' : 'warning'"
      :class="row.visible ? hiddenClass : ''"
      :icon="row.visible ? 'eye' : 'eye-off'"
      :aria-label="`${row.visible ? '隐藏' : '显示'}${row.label}`"
      data-test="row-visible"
      @click="emit('act', { type: 'toggle-visible' })"
    />
    <DtDropdownMenu
      :items="menu"
      :label="`${row.label}的更多操作`"
      @select="onMenu"
    >
      <template #trigger="{ toggle, isOpen }">
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="more-horizontal"
          :class="isOpen ? '' : hiddenClass"
          :aria-label="`${row.label}的更多操作`"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          data-test="row-menu"
          @click="toggle"
        />
      </template>
    </DtDropdownMenu>
  </div>
  <!-- 二次确认就地展开：连带影响写在这里，弹窗会把它挪出用户的视线 -->
  <div
    v-if="confirmText !== null"
    class="flex flex-wrap items-center gap-1 rounded-[var(--radius-sm)] bg-surface-raised px-2 py-1 text-3xs text-text-secondary"
    data-test="row-remove-confirm"
  >
    <span>删除「{{ row.label }}」？</span>
    <span class="text-state-danger">{{ confirmText }}</span>
    <button
      type="button"
      class="rounded-[var(--radius-sm)] px-1.5 py-0.5 text-state-danger hover:bg-state-danger/10"
      data-test="row-remove-yes"
      @click="emit('act', { type: 'remove-confirm' })"
    >
      确认删除
    </button>
    <button
      type="button"
      class="rounded-[var(--radius-sm)] px-1.5 py-0.5 hover:text-text-primary"
      data-test="row-remove-no"
      @click="emit('act', { type: 'remove-cancel' })"
    >
      取消
    </button>
  </div>
</template>
