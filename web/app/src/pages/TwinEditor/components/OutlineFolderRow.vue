<script setup lang="ts">
/**
 * @fileoverview 大纲夹头行：折叠 chevron + 夹图标 + 名字（双击就地重命名）+ 计数
 * + 「⋯」菜单。删夹不删成员；重命名的 IME 组合期回车只确认候选词，不落名。
 */
import type { DtMenuItem } from '@dt/contracts'
import { DtButton, DtDropdownMenu, DtIcon, DtInput } from '@dt/ui'
import { ref, watch } from 'vue'

import { OUTLINE_FOLDER_MENU } from '../scripts/outlineMenus'
import { OUTLINE_ACT_HIDDEN } from '../scripts/outlineStyles'
import type { TwinTextSlices } from '../scripts/outlineFilter'
import type { TwinOutlineFolderView } from '../scripts/outlineNodes'

const props = defineProps<{
  folder: TwinOutlineFolderView
  collapsed: boolean
  /** true = 正在就地重命名（双击或建夹后由上层拉起）。 */
  renaming: boolean
  /** 夹名的高亮切片；null = 没命中。 */
  slices: TwinTextSlices | null
  /** 计数文案：成员数或「空」，搜索态是「命中/总数」。 */
  countText: string
}>()

const emit = defineEmits<{
  toggle: []
  renameStart: []
  renameCommit: [name: string]
  renameCancel: []
  remove: []
}>()

const draft = ref('')
// 输入法组合期（拼音选词）的回车只是确认候选词，值还没定稿
let isComposing = false

watch(
  () => props.renaming,
  (on) => {
    if (on) draft.value = props.folder.label
  },
)

function setComposing(value: boolean): void {
  isComposing = value
}

/** 上层收到 commit 会立刻清掉 renaming，随后的 blur 在这里被挡住，不会落两次。 */
function commit(): void {
  if (!props.renaming || isComposing) return
  emit('renameCommit', draft.value)
}

/** 组合期的 Esc 是「取消候选词」，放行给输入法。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing || isComposing) return
  event.preventDefault()
  emit('renameCancel')
}

function onMenu(item: DtMenuItem): void {
  if (item.value === 'rename') emit('renameStart')
  else if (item.value === 'remove') emit('remove')
}
</script>

<template>
  <div
    class="group flex items-center gap-0.5 rounded-[var(--radius-sm)] pl-3 pr-1 text-xs text-text-secondary hover:bg-surface-raised"
    data-test="outline-folder"
    :data-id="folder.id"
  >
    <button
      type="button"
      class="flex h-5 w-5 shrink-0 items-center justify-center text-text-disabled hover:text-accent-primary"
      :aria-expanded="!collapsed"
      :aria-label="`展开或折叠${folder.label}`"
      data-test="folder-toggle"
      @click="emit('toggle')"
    >
      <DtIcon :name="collapsed ? 'chevron-right' : 'chevron-down'" :size="12" />
    </button>
    <DtIcon
      :name="collapsed ? 'folder' : 'folder-open'"
      :size="12"
      class="shrink-0 text-text-disabled"
    />
    <DtInput
      v-if="renaming"
      size="sm"
      class="min-w-0 flex-1"
      aria-label="重命名文件夹"
      autofocus
      :model-value="draft"
      data-test="folder-rename"
      @update:model-value="draft = $event"
      @enter="commit"
      @blur="commit"
      @keydown="onKeydown"
      @compositionstart="setComposing(true)"
      @compositionend="setComposing(false)"
    />
    <span
      v-else
      class="min-w-0 flex-1 truncate py-1"
      title="双击重命名"
      data-test="folder-name"
      @dblclick="emit('renameStart')"
    >
      <template v-if="slices !== null"
        >{{ slices.before
        }}<mark class="rounded-[2px] bg-accent-primary/25 text-inherit">{{
          slices.match
        }}</mark
        >{{ slices.after }}</template
      >
      <template v-else>{{ folder.label }}</template>
    </span>
    <span class="shrink-0 text-3xs text-text-disabled" data-test="folder-count">
      {{ countText }}
    </span>
    <DtDropdownMenu
      :items="OUTLINE_FOLDER_MENU"
      :label="`${folder.label}的文件夹操作`"
      @select="onMenu"
    >
      <template #trigger="{ toggle, isOpen }">
        <DtButton
          size="xs"
          variant="ghost"
          intent="neutral"
          icon="more-horizontal"
          :class="isOpen ? '' : OUTLINE_ACT_HIDDEN"
          :aria-label="`${folder.label}的文件夹操作`"
          aria-haspopup="menu"
          :aria-expanded="isOpen"
          data-test="folder-menu"
          @click="toggle"
        />
      </template>
    </DtDropdownMenu>
  </div>
</template>
