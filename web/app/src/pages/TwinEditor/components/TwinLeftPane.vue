<script setup lang="ts">
/**
 * @fileoverview 左栏：按文档序平铺场上的一切。
 *
 * ⚠ 行上的序号**就是**数组绑定的对齐位次：这一栏里挪一下，绑定行跟着走。
 * ⚠ 大纲的搜索态是它的本地状态。
 */
import type { BindingPayload } from '@dt/contracts'
import type { ModelAnimationEntry } from '@dt/three-core'
import { DtButton, DtSelect } from '@dt/ui'
import { computed, ref, watch, nextTick } from 'vue'
import {
  OUTLINE_KINDS,
  type OutlineKind,
  type OutlineStatus,
} from '../scripts/outlineScope'
import { TWIN_ENTITY_LABELS } from '../scripts/types'
import TwinAnimationList from './TwinAnimationList.vue'
import type { TwinConfig } from '@dt/twin-config'

import type { OutlinePlacement } from '../scripts/outlinePlacement'
import type { TwinEntityKind, TwinSelection } from '../scripts/types'
import TwinOutline from './TwinOutline.vue'

const props = withDefaults(
  defineProps<{
    config: TwinConfig
    bindings?: readonly BindingPayload[]
    animations?: {
      clips: readonly ModelAnimationEntry[]
      selected: string | null
      status: string
    }
    selection: TwinSelection | null
    /** 有诊断问题的实体 id 集合，行上拿它打红点。 */
    flaggedIds: ReadonlySet<string>
    /** 刚建出来的夹 id，大纲拿它立刻进入就地重命名。 */
    renamingFolderId?: string | null
  }>(),
  { renamingFolderId: null, bindings: () => [] },
)

const emit = defineEmits<{
  select: [TwinSelection]
  selectAnimation: [string]
  add: [TwinEntityKind]
  addInFolder: [{ kind: TwinEntityKind; folderId: string }]
  place: [OutlinePlacement]
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
const animationList = ref<{ reveal: () => void } | null>(null)
const kind = ref<OutlineKind>('all')
const status = ref<OutlineStatus>('all')
const outline = ref<{ revealSelected: () => void } | null>(null)
const kindOptions = computed(() =>
  OUTLINE_KINDS.map((value) => {
    if (value === 'all') return { value, label: '全部类别' }
    if (value === 'scene') return { value, label: '场景设置' }
    if (value === 'animations')
      return { value, label: `动画 · ${props.animations?.clips.length ?? 0}` }
    return {
      value,
      label: `${TWIN_ENTITY_LABELS[value]} · ${props.config[value].length}`,
    }
  }),
)
const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'issues', label: '配置问题' },
  { value: 'unbound', label: '未绑定点位' },
]
function pickKind(value: string): void {
  const next = OUTLINE_KINDS.find((item) => item === value)
  if (next) kind.value = next
  if (next === 'scene' || next === 'animations') status.value = 'all'
}
function pickStatus(value: string): void {
  if (value === 'all' || value === 'issues' || value === 'unbound')
    status.value = value
}
function resetFilters(): void {
  kind.value = 'all'
  status.value = 'all'
}
watch(
  () => props.selection,
  (selection) => {
    if (selection === null || kind.value === 'all') return
    kind.value = 'id' in selection ? selection.kind : 'scene'
    status.value = 'all'
  },
)
watch(
  () => props.animations?.selected,
  (selected) => {
    if (selected != null && kind.value !== 'all') kind.value = 'animations'
  },
)
function reveal(): void {
  resetFilters()
  if (props.animations?.selected != null)
    void nextTick(() => animationList.value?.reveal())
  else outline.value?.revealSelected()
}
</script>

<template>
  <div class="flex min-h-0 flex-col" data-test="twin-left-pane">
    <div class="flex shrink-0 flex-col gap-1 border-b border-border-subtle p-1">
      <DtSelect
        :model-value="kind"
        :options="kindOptions"
        size="sm"
        aria-label="对象类别"
        @update:model-value="pickKind"
      />
      <div class="flex items-center gap-1">
        <DtSelect
          class="min-w-0 flex-1"
          :model-value="status"
          :options="statusOptions"
          :disabled="kind === 'animations' || kind === 'scene'"
          size="sm"
          aria-label="配置状态筛选"
          @update:model-value="pickStatus"
        />
        <DtButton size="xs" variant="ghost" @click="reveal">定位选中</DtButton>
      </div>
    </div>
    <TwinAnimationList
      v-if="animations"
      v-show="kind === 'all' || kind === 'animations'"
      ref="animationList"
      :clips="animations.clips"
      :config="config.model.animations"
      :selected="animations.selected"
      :status="animations.status"
      @select="emit('selectAnimation', $event)"
    />
    <div v-show="kind !== 'animations'" class="min-h-0 flex-1 overflow-y-auto">
      <TwinOutline
        ref="outline"
        :kind="kind"
        :status="kind === 'scene' ? 'all' : status"
        :bindings="props.bindings"
        :config="config"
        :selection="selection"
        :flagged-ids="flaggedIds"
        :renaming-folder-id="renamingFolderId"
        @reset-filters="resetFilters"
        @select="emit('select', $event)"
        @add="emit('add', $event)"
        @add-in-folder="emit('addInFolder', $event)"
        @place="emit('place', $event)"
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
