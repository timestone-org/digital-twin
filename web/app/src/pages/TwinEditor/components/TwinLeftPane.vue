<script setup lang="ts">
/**
 * @fileoverview 左栏：按文档序平铺场上的一切。
 *
 * ⚠ 行上的序号**就是**数组绑定的对齐位次：这一栏里挪一下，绑定行跟着走。
 * ⚠ 大纲的搜索态是它的本地状态。
 */
import type { TwinConfig } from '@dt/twin-config'

import type { TwinEntityKind, TwinSelection } from '../scripts/types'
import TwinOutline from './TwinOutline.vue'

withDefaults(
  defineProps<{
    config: TwinConfig
    selection: TwinSelection | null
    /** 有诊断问题的实体 id 集合，行上拿它打红点。 */
    flaggedIds: ReadonlySet<string>
    /** 刚建出来的夹 id，大纲拿它立刻进入就地重命名。 */
    renamingFolderId?: string | null
  }>(),
  { renamingFolderId: null },
)

const emit = defineEmits<{
  select: [TwinSelection]
  add: [TwinEntityKind]
  bulkAdd: []
  remove: [{ kind: TwinEntityKind; id: string }]
  duplicate: [{ kind: TwinEntityKind; id: string }]
  move: [{ kind: TwinEntityKind; id: string; delta: number }]
  toggleEditorVisible: [{ kind: TwinEntityKind; id: string }]
  addFolder: [TwinEntityKind]
  renameFolder: [{ id: string; name: string }]
  removeFolder: [string]
  moveIntoFolder: [{ folderId: string; id: string }]
  removeFromFolder: [string]
  createFolderWithItem: [{ kind: TwinEntityKind; id: string }]
}>()
</script>

<template>
  <div class="flex min-h-0 flex-col" data-test="twin-left-pane">
    <div class="min-h-0 flex-1 overflow-y-auto">
      <TwinOutline
        :config="config"
        :selection="selection"
        :flagged-ids="flaggedIds"
        :renaming-folder-id="renamingFolderId"
        @select="emit('select', $event)"
        @add="emit('add', $event)"
        @bulk-add="emit('bulkAdd')"
        @remove="emit('remove', $event)"
        @duplicate="emit('duplicate', $event)"
        @move="emit('move', $event)"
        @toggle-editor-visible="emit('toggleEditorVisible', $event)"
        @add-folder="emit('addFolder', $event)"
        @rename-folder="emit('renameFolder', $event)"
        @remove-folder="emit('removeFolder', $event)"
        @move-into-folder="emit('moveIntoFolder', $event)"
        @remove-from-folder="emit('removeFromFolder', $event)"
        @create-folder-with-item="emit('createFolderWithItem', $event)"
      />
    </div>
  </div>
</template>
