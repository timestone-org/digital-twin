<script setup lang="ts">
/**
 * @fileoverview 左栏大纲树：搜索框 + 置顶「场景」区 + 七个实体分组（夹视图与
 * 散行）。管搜索、折叠、选中、增删复制重排与文件夹；它自己不改文档，只抛
 * 事件，改配置一律由页面交给 `entityOps` / `folderOps`。
 * ⚠ 行上标的序号就是文档序，而文档序决定数组绑定的对齐（`anchorValues[2]`
 * 喂第 3 个锚点）——上移下移会连带改变相邻两行的取值来源，进出文件夹则不会。
 */
import type { TwinConfig } from '@dt/twin-config'
import { DtButton, DtEmpty } from '@dt/ui'
import { computed, ref, watch } from 'vue'

import { filterTwinOutline } from '../scripts/outlineFilter'
import type {
  TwinOutlineFolderRowView,
  TwinOutlineSectionView,
} from '../scripts/outlineFilter'
import type { OutlineRowAction } from '../scripts/outlineMenus'
import {
  TWIN_SCENE_ENTRIES,
  buildTwinOutline,
  twinRemoveImpactText,
} from '../scripts/outlineNodes'
import type { TwinOutlineRow } from '../scripts/outlineNodes'
import { isSameSelection } from '../scripts/types'
import type { TwinEntityKind, TwinSelection } from '../scripts/types'
import { useOutlineDrag } from '../scripts/useOutlineDrag'
import OutlineFolderRow from './OutlineFolderRow.vue'
import OutlineRow from './OutlineRow.vue'
import OutlineSceneList from './OutlineSceneList.vue'
import OutlineSearchBox from './OutlineSearchBox.vue'
import OutlineSectionHeader from './OutlineSectionHeader.vue'

const props = withDefaults(
  defineProps<{
    config: TwinConfig
    selection: TwinSelection | null
    /** 有诊断问题的实体 id 集合，树上打红点。 */
    flaggedIds: ReadonlySet<string>
    // ⚠ 显式 `| undefined`：exactOptionalPropertyTypes 下上游原样转发自己的
    // 可选 prop 时必然带着 undefined，不接就整条 typecheck 红（同 DtButton.size）
    /** 刚建出来的夹 id：上层置它，这里立刻进入就地重命名。 */
    renamingFolderId?: string | null | undefined
  }>(),
  { renamingFolderId: null },
)

const emit = defineEmits<{
  select: [TwinSelection]
  add: [TwinEntityKind]
  /** 从模型节点批量建部件。 */
  bulkAdd: []
  remove: [{ kind: TwinEntityKind; id: string }]
  duplicate: [{ kind: TwinEntityKind; id: string }]
  move: [{ kind: TwinEntityKind; id: string; delta: number }]
  /** 只切编辑视口显隐，不改右栏「初始可见」。 */
  toggleEditorVisible: [{ kind: TwinEntityKind; id: string }]
  addFolder: [TwinEntityKind]
  renameFolder: [{ id: string; name: string }]
  removeFolder: [string]
  moveIntoFolder: [{ folderId: string; id: string }]
  removeFromFolder: [string]
  /** 新建夹并把这一行移进去（一笔撤销）。 */
  createFolderWithItem: [{ kind: TwinEntityKind; id: string }]
}>()

const query = ref('')
const collapsed = ref<ReadonlySet<string>>(new Set())
/** 正在等二次确认的那一行；同一时刻只有一行。 */
const pendingRemoveKey = ref<string | null>(null)
/** 正在就地重命名的夹。 */
const renamingId = ref<string | null>(null)

const view = computed(() =>
  filterTwinOutline(
    buildTwinOutline(props.config, props.flaggedIds),
    TWIN_SCENE_ENTRIES,
    query.value,
  ),
)

const drag = useOutlineDrag((folderId, id) =>
  emit('moveIntoFolder', { folderId, id }),
)

watch(
  () => props.renamingFolderId,
  (id) => {
    if (id !== null) renamingId.value = id
  },
)

/** 搜索态一律按展开算、不写折叠集：清词后用户自己的折叠状态原样回来。 */
function isCollapsed(key: string): boolean {
  return view.value.active ? false : collapsed.value.has(key)
}

function toggleCollapse(key: string): void {
  const next = new Set(collapsed.value)
  if (!next.delete(key)) next.add(key)
  collapsed.value = next
}

function isRowSelected(row: TwinOutlineRow): boolean {
  return isSameSelection(props.selection, { kind: row.kind, id: row.id })
}

function sectionCount(sectionView: TwinOutlineSectionView): string {
  const total = sectionView.section.count
  return view.value.active ? `${sectionView.hitCount}/${total}` : `${total}`
}

function folderCount(folderView: TwinOutlineFolderRowView): string {
  const total = folderView.folder.rows.length
  if (view.value.active) return `${folderView.rows.length}/${total}`
  return total === 0 ? '空' : `${total}`
}

function removeImpact(row: TwinOutlineRow): string {
  return twinRemoveImpactText(props.config, row.kind, row.id)
}

function confirmTextFor(row: TwinOutlineRow): string | null {
  return pendingRemoveKey.value === row.key ? removeImpact(row) : null
}

/** 有连带影响才就地二次确认；没有就直接删，靠撤销兜底。 */
function requestRemove(row: TwinOutlineRow): void {
  if (removeImpact(row) === '') {
    emit('remove', { kind: row.kind, id: row.id })
    return
  }
  pendingRemoveKey.value = row.key
}

function onRowAct(row: TwinOutlineRow, action: OutlineRowAction): void {
  const target = { kind: row.kind, id: row.id }
  if (action.type === 'select') emit('select', target)
  else if (action.type === 'toggle-visible') emit('toggleEditorVisible', target)
  else if (action.type === 'duplicate') emit('duplicate', target)
  else if (action.type === 'move')
    emit('move', { ...target, delta: action.delta })
  else onRowRemoveOrFolder(row, action)
}

function onRowRemoveOrFolder(
  row: TwinOutlineRow,
  action: OutlineRowAction,
): void {
  if (action.type === 'remove-request') requestRemove(row)
  else if (action.type === 'remove-cancel') pendingRemoveKey.value = null
  else if (action.type === 'remove-confirm') {
    pendingRemoveKey.value = null
    emit('remove', { kind: row.kind, id: row.id })
  } else if (action.type === 'folder-into')
    emit('moveIntoFolder', { folderId: action.folderId, id: row.id })
  else if (action.type === 'folder-out') emit('removeFromFolder', row.id)
  else if (action.type === 'folder-new')
    emit('createFolderWithItem', { kind: row.kind, id: row.id })
}

function commitRename(id: string, name: string): void {
  renamingId.value = null
  emit('renameFolder', { id, name })
}
</script>

<template>
  <div class="flex flex-col gap-1 pb-1" data-test="twin-outline">
    <OutlineSearchBox v-model="query" />

    <OutlineSceneList
      v-if="view.scene.length > 0"
      :entries="view.scene"
      :selection="selection"
      @select="emit('select', $event)"
    />

    <template
      v-for="sectionView in view.sections"
      :key="sectionView.section.key"
    >
      <OutlineSectionHeader
        :kind="sectionView.section.kind"
        :title="sectionView.section.title"
        :slices="sectionView.slices"
        :count-text="sectionCount(sectionView)"
        :collapsed="isCollapsed(sectionView.section.key)"
        @toggle="toggleCollapse(sectionView.section.key)"
        @add="emit('add', sectionView.section.kind)"
        @bulk-add="emit('bulkAdd')"
        @folder-new="emit('addFolder', sectionView.section.kind)"
      />
      <template v-if="!isCollapsed(sectionView.section.key)">
        <DtEmpty
          v-if="!view.active && sectionView.section.count === 0"
          size="inline"
          class="px-4 py-0.5"
          :title="`还没有${sectionView.section.title}`"
          data-test="section-empty"
        >
          <button
            type="button"
            class="shrink-0 text-2xs text-accent-primary hover:underline"
            data-test="section-empty-add"
            @click="emit('add', sectionView.section.kind)"
          >
            新建
          </button>
        </DtEmpty>
        <div
          v-for="folderView in sectionView.folders"
          :key="folderView.folder.key"
          :class="
            drag.dropFolderId.value === folderView.folder.id
              ? 'rounded-[var(--radius-sm)] ring-1 ring-inset ring-accent-primary'
              : ''
          "
          @dragover="drag.over(folderView.folder, $event)"
          @drop="drag.drop(folderView.folder)"
        >
          <OutlineFolderRow
            :folder="folderView.folder"
            :collapsed="isCollapsed(folderView.folder.key)"
            :renaming="renamingId === folderView.folder.id"
            :slices="folderView.slices"
            :count-text="folderCount(folderView)"
            @toggle="toggleCollapse(folderView.folder.key)"
            @rename-start="renamingId = folderView.folder.id"
            @rename-commit="commitRename(folderView.folder.id, $event)"
            @rename-cancel="renamingId = null"
            @remove="emit('removeFolder', folderView.folder.id)"
          />
          <template v-if="!isCollapsed(folderView.folder.key)">
            <div
              v-for="rowView in folderView.rows"
              :key="rowView.row.key"
              draggable="true"
              @dragstart="drag.start(rowView.row, folderView.folder.id)"
              @dragend="drag.end()"
            >
              <OutlineRow
                :row="rowView.row"
                :selected="isRowSelected(rowView.row)"
                :searching="view.active"
                :slices="rowView.slices"
                :folders="sectionView.section.folders"
                :folder-id="folderView.folder.id"
                :confirm-text="confirmTextFor(rowView.row)"
                @act="onRowAct(rowView.row, $event)"
              />
            </div>
          </template>
        </div>
        <div
          v-for="rowView in sectionView.rows"
          :key="rowView.row.key"
          draggable="true"
          @dragstart="drag.start(rowView.row, null)"
          @dragend="drag.end()"
        >
          <OutlineRow
            :row="rowView.row"
            :selected="isRowSelected(rowView.row)"
            :searching="view.active"
            :slices="rowView.slices"
            :folders="sectionView.section.folders"
            :folder-id="null"
            :confirm-text="confirmTextFor(rowView.row)"
            @act="onRowAct(rowView.row, $event)"
          />
        </div>
      </template>
    </template>

    <DtEmpty
      v-if="
        view.active && view.scene.length === 0 && view.sections.length === 0
      "
      icon="search"
      title="没有匹配的内容"
      :hint="`没有找到「${query.trim()}」`"
      data-test="outline-search-empty"
    >
      <DtButton variant="soft" size="sm" @click="query = ''">清除搜索</DtButton>
    </DtEmpty>
  </div>
</template>
