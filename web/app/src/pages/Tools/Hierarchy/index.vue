<script setup lang="ts">
/** @fileoverview 工具中的层级图项目与标准出图工作面。 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DtMenuItem } from '@dt/contracts'
import type { ExportFormat, NodeKind } from './scripts/types'
import {
  DtButton,
  DtCheckbox,
  DtFilePicker,
  DtInput,
  DtModal,
  DtNotice,
  DtResizableLayout,
  DtSegmented,
  DtDropdownMenu,
  DtEmpty,
  DtIcon,
} from '@dt/ui'
import { AppShell } from '@/components/layout'
import HierarchyCanvas from './components/HierarchyCanvas.vue'
import HierarchyProjects from './components/HierarchyProjects.vue'
import HierarchyInspector from './components/HierarchyInspector.vue'
import HierarchyToolbar from './components/HierarchyToolbar.vue'
import HierarchyPreview from './components/HierarchyPreview.vue'
import HierarchyHistory from './components/HierarchyHistory.vue'
import { useHierarchyPage } from './scripts/useHierarchyPage'
const showProjects = ref(true),
  showInspector = ref(true)
const page = useHierarchyPage()
const {
  editor,
  saving,
  projects,
  compute,
  canEdit,
  available,
  checking,
  availabilityError,
  mode,
  drawing,
  busy,
  status,
  outdated,
  isHistoryOpen,
  isNewOpen,
  newTitle,
  useSample,
} = page
const { document } = editor
const workspace = ref<HTMLElement | null>(null)
const workspaceWidth = ref(0)
const compactPane = ref('canvas')
const isCompact = computed(
  () => workspaceWidth.value > 0 && workspaceWidth.value < 760,
)
const projectsVisible = computed(() =>
  isCompact.value ? compactPane.value === 'projects' : showProjects.value,
)
const inspectorVisible = computed(() =>
  isCompact.value ? compactPane.value === 'inspector' : showInspector.value,
)
const compactOptions = computed(() => [
  { value: 'projects', label: '我的项目', icon: 'folder' },
  {
    value: 'canvas',
    label: mode.value === 'drawing' ? '图纸预览' : '编辑画布',
    icon: 'network',
  },
  ...(document.value
    ? [{ value: 'inspector', label: '配置', icon: 'settings' }]
    : []),
])
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!workspace.value) return
  workspaceWidth.value = workspace.value.clientWidth
  observer = new ResizeObserver(([entry]) => {
    if (entry) workspaceWidth.value = entry.contentRect.width
  })
  observer.observe(workspace.value)
})
onBeforeUnmount(() => observer?.disconnect())
watch([() => saving.projectId.value, mode], () => {
  compactPane.value = 'canvas'
})
const panes = computed(() => [
  ...(projectsVisible.value
    ? [{ id: 'projects', label: '层级图项目', size: 19, minSize: 210 }]
    : []),
  ...(!isCompact.value ||
  compactPane.value === 'canvas' ||
  (!document.value && compactPane.value === 'inspector')
    ? [{ id: 'canvas', label: '层级图画布', size: 55, minSize: 320 }]
    : []),
  ...(document.value && inspectorVisible.value
    ? [{ id: 'inspector', label: '层级图配置', size: 26, minSize: 270 }]
    : []),
])
function toggleProjects() {
  if (isCompact.value) compactPane.value = 'projects'
  else showProjects.value = !showProjects.value
}
function toggleInspector() {
  if (isCompact.value) compactPane.value = 'inspector'
  else showInspector.value = !showInspector.value
}
const projectActions = computed<DtMenuItem[]>(() => [
  { value: 'history', label: '历史版本', icon: 'layers' },
  ...(canEdit.value
    ? [
        { value: 'duplicate', label: '复制', icon: 'copy' },
        { value: 'remove', label: '删除项目', icon: 'trash', danger: true },
      ]
    : []),
])
function projectAction(item: DtMenuItem) {
  const actions: Record<string, () => Promise<unknown>> = {
    history: page.history,
    duplicate: page.duplicate,
    remove: page.remove,
  }
  const action = actions[item.value]
  if (action) void page.safe(action)
}
function startProject(sample = false) {
  useSample.value = sample
  newTitle.value = sample ? '蒸汽计量系统' : '未命名层级图'
  isNewOpen.value = true
}
const canvas = ref<InstanceType<typeof HierarchyCanvas> | null>(null)
function onAddNode(kind: NodeKind) {
  void page.safe(() => addNode(kind))
}
async function addNode(kind: NodeKind) {
  mode.value = 'edit'
  compactPane.value = 'canvas'
  showInspector.value = true
  await nextTick()
  canvas.value?.add(kind)
  if (isCompact.value) compactPane.value = 'inspector'
}
async function draw() {
  await page.draw()
  if (!compute.error.value) compactPane.value = 'canvas'
}
async function arrange() {
  compactPane.value = 'canvas'
  await page.arrange()
  canvas.value?.fit()
}
async function focus(id: string) {
  mode.value = 'edit'
  showInspector.value = true
  compactPane.value = 'canvas'
  await nextTick()
  canvas.value?.focus(id)
}
function onImport(files: File[]) {
  void page.safe(() => page.importFiles(files))
}
function onOpen(id: string) {
  void page.safe(async () => {
    await page.open(id)
    compactPane.value = 'canvas'
  })
}
function onExport(format: ExportFormat) {
  void page.safe(() => page.exportFile(format))
}
function onRestore(revision: number) {
  void page.safe(async () => {
    if (await projects.restore(revision)) {
      mode.value = 'edit'
      drawing.value = null
    }
  })
}
</script>
<template>
  <AppShell
    class="hierarchy-shell"
    title="层级图"
    subtitle="计量关系编排与标准图纸"
  >
    <template #actions>
      <div v-if="available" class="hierarchy-actions flex items-center gap-2">
        <span
          v-if="document"
          class="save-status"
          role="status"
          :data-pending="saving.dirty.value"
          :data-error="!!saving.error.value"
        >
          <DtIcon
            :name="
              saving.error.value
                ? 'alert-circle'
                : saving.dirty.value
                  ? 'pencil'
                  : 'check'
            "
            :size="14"
          />
          <span class="compact-label">
            {{ canEdit ? status : '只读模式' }}
          </span>
        </span>
        <template v-if="canEdit">
          <DtButton
            size="sm"
            :disabled="busy"
            variant="outline"
            @click="startProject()"
          >
            <template #leading><DtIcon name="plus" :size="14" /></template>
            新建项目
          </DtButton>
          <DtFilePicker
            label="导入配置"
            accept=".json,.xlsx"
            size="sm"
            :disabled="busy"
            @select="onImport"
          />
          <DtButton
            size="sm"
            variant="solid"
            :disabled="!document || busy || saving.saving.value"
            @click="page.safe(saving.flush)"
          >
            <template #leading><DtIcon name="save" :size="14" /></template
            ><span class="compact-label"> 保存 </span>
          </DtButton>
        </template>
        <DtDropdownMenu
          :items="projectActions"
          label="项目操作"
          :disabled="!document || busy"
          @select="projectAction"
        />
      </div>
    </template>
    <div
      ref="workspace"
      class="hierarchy-page flex h-full min-h-0 flex-col gap-3"
    >
      <DtNotice v-if="checking"> 正在检查层级图服务… </DtNotice>
      <DtNotice v-else-if="!available" intent="warning">
        层级图服务尚未启用或暂时不可用。{{ availabilityError }}
        <DtButton variant="ghost" size="sm" @click="page.initialize">
          重新检查
        </DtButton>
      </DtNotice>
      <template v-else>
        <DtNotice v-if="saving.error.value" intent="danger">
          {{ saving.error.value }}。可先导出 JSON 保留草稿。
          <DtButton
            size="sm"
            variant="outline"
            :disabled="busy || saving.saving.value"
            @click="page.safe(page.reload)"
          >
            重新加载服务器版本
          </DtButton>
        </DtNotice>
        <DtNotice v-if="compute.error.value" intent="danger">
          {{ compute.error.value }}
          <DtButton
            v-for="issue in compute.issues.value"
            :key="issue.message"
            size="sm"
            variant="ghost"
            @click="issue.nodeId && focus(issue.nodeId)"
          >
            {{ issue.message }}
          </DtButton>
        </DtNotice>
        <HierarchyToolbar
          v-if="document"
          :editor="editor"
          :readonly="!canEdit"
          :busy="busy"
          :mode="mode"
          :panels="{ projects: projectsVisible, inspector: inspectorVisible }"
          @add="onAddNode"
          @projects="toggleProjects"
          @inspector="toggleInspector"
          @arrange="page.safe(arrange)"
          @draw="page.safe(draw)"
          @edit="mode = 'edit'"
          @export="onExport"
        />
        <DtSegmented
          v-if="isCompact"
          v-model="compactPane"
          :options="compactOptions"
          block
          aria-label="工作区面板"
        />
        <DtResizableLayout
          class="hierarchy-layout min-h-0 flex-1"
          storage-key="dt.hierarchy.layout"
          :panes="panes"
        >
          <template #projects>
            <HierarchyProjects
              style="width: 100%; flex: 1"
              :projects="projects"
              :selected="saving.projectId.value"
              @open="onOpen"
            />
          </template>
          <template #canvas>
            <div
              v-if="document"
              class="canvas-panel flex min-h-0 min-w-0 flex-1 flex-col"
            >
              <DtNotice v-if="outdated && mode === 'drawing'" intent="warning">
                配置已更新，当前预览尚未刷新。
                <DtButton
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="page.safe(draw)"
                >
                  重新生成预览
                </DtButton>
              </DtNotice>
              <HierarchyCanvas
                v-show="mode === 'edit'"
                ref="canvas"
                :editor="editor"
                :readonly="!canEdit || busy"
                @save="page.safe(saving.flush)"
              />
              <HierarchyPreview
                v-if="mode === 'drawing' && drawing"
                :drawing="drawing"
              />
            </div>
            <div
              v-else
              class="canvas-panel flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto p-6"
            >
              <DtEmpty
                icon="network"
                title="从一张层级图开始"
                :hint="
                  canEdit
                    ? '建立计量关系，生成清晰的标准图纸。可从空白项目、示例或配置文件开始。'
                    : '暂无可查看的项目。已有项目可在左侧搜索打开。'
                "
              />
              <div
                v-if="canEdit"
                class="mt-4 flex flex-wrap justify-center gap-3"
              >
                <DtButton :disabled="busy" @click="startProject()">
                  创建空白项目
                </DtButton>
                <DtButton
                  variant="outline"
                  :disabled="busy"
                  @click="startProject(true)"
                >
                  从示例开始
                </DtButton>
              </div>

              <p v-if="canEdit" class="text-xs text-text-secondary">
                已有配置？使用右上角“导入配置”，支持 JSON / Excel。
              </p>
            </div>
          </template>
          <template #inspector>
            <HierarchyInspector
              style="width: 100%; min-height: 0; flex: 1"
              :editor="editor"
              :readonly="!canEdit || busy"
              :mode="mode"
              @focus="focus"
              @apply="page.safe(editor.applyDrafts)"
            />
          </template>
        </DtResizableLayout>
      </template>
    </div>
    <DtModal v-model="isNewOpen" title="新建层级图项目" width="28rem">
      <div class="flex flex-col gap-4">
        <DtInput v-model="newTitle" label="项目名称" :maxlength="80" />
        <DtCheckbox
          v-model="useSample"
          label="使用蒸汽计量示例（33 个计量节点）"
        />
      </div>
      <template #footer>
        <DtButton variant="ghost" @click="isNewOpen = false"> 取消 </DtButton>
        <DtButton
          :disabled="busy || !newTitle.trim()"
          @click="page.safe(page.create)"
        >
          创建项目
        </DtButton>
      </template>
    </DtModal>
    <HierarchyHistory
      v-model="isHistoryOpen"
      :versions="projects.versions.value"
      :readonly="!canEdit || busy"
      @restore="onRestore"
    />
  </AppShell>
</template>

<style scoped lang="scss">
.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--state-success);
}
.save-status[data-pending='true'] {
  color: var(--state-warning);
}
.save-status[data-error='true'] {
  color: var(--state-danger);
}
.canvas-panel {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-panel);
}
@media (max-width: 640px) {
  .hierarchy-shell :deep(header:has(.hierarchy-actions)) {
    flex-direction: column;
    align-items: stretch;
  }
  .hierarchy-actions {
    gap: 4px;
  }
  .compact-label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
}
</style>
