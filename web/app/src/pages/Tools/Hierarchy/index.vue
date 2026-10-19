<script setup lang="ts">
/** @fileoverview 工具中的层级图项目与标准出图工作面。 */
import { nextTick, ref } from 'vue'
import type { ExportFormat } from './scripts/types'
import {
  DtButton,
  DtCheckbox,
  DtFilePicker,
  DtInput,
  DtModal,
  DtNotice,
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
const canvas = ref<InstanceType<typeof HierarchyCanvas> | null>(null)
async function arrange() {
  await page.arrange()
  canvas.value?.fit()
}
async function focus(id: string) {
  mode.value = 'edit'
  await nextTick()
  canvas.value?.focus(id)
}
function onImport(files: File[]) {
  void page.safe(() => page.importFiles(files))
}
function onOpen(id: string) {
  void page.safe(() => page.open(id))
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
  <AppShell title="层级图" subtitle="计量关系编排与标准图纸">
    <template #actions>
      <div v-if="available" class="flex items-center gap-2 overflow-x-auto">
        <span
          v-if="document"
          class="whitespace-nowrap text-xs text-text-secondary"
        >
          {{ status }}
        </span>
        <template v-if="canEdit">
          <DtButton size="sm" :disabled="busy" @click="isNewOpen = true">
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
            variant="outline"
            :disabled="!document || busy"
            @click="page.safe(saving.flush)"
          >
            保存
          </DtButton>
        </template>
        <DtButton
          size="sm"
          variant="ghost"
          :disabled="!document || busy"
          @click="page.safe(page.history)"
        >
          历史版本
        </DtButton>
        <template v-if="canEdit">
          <DtButton
            size="sm"
            variant="ghost"
            :disabled="!document || busy"
            @click="page.safe(page.duplicate)"
          >
            复制
          </DtButton>
          <DtButton
            size="sm"
            variant="ghost"
            intent="danger"
            :disabled="!document || busy"
            @click="page.safe(page.remove)"
          >
            删除项目
          </DtButton>
        </template>
      </div>
    </template>
    <div class="flex h-full min-h-0 flex-col gap-3">
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
            >重新加载服务器版本</DtButton
          >
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
          @add="canvas?.add($event)"
          @projects="showProjects = !showProjects"
          @inspector="showInspector = !showInspector"
          @arrange="page.safe(arrange)"
          @draw="page.safe(page.draw)"
          @edit="mode = 'edit'"
          @export="onExport"
        />
        <div class="flex min-h-0 flex-1 gap-3">
          <HierarchyProjects
            v-if="showProjects"
            :projects="projects"
            :selected="saving.projectId.value"
            @open="onOpen"
          />
          <div v-if="document" class="flex min-h-0 min-w-0 flex-1 flex-col">
            <DtNotice v-if="outdated && mode === 'drawing'" intent="warning">
              预览对应之前的配置，请重新生成。导出始终使用当前配置。
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
            class="flex flex-1 items-center justify-center text-text-secondary"
          >
            新建一个项目，或导入案例中的 JSON / Excel 配置。
          </div>
          <HierarchyInspector
            v-if="document && mode === 'edit' && showInspector"
            :editor="editor"
            :readonly="!canEdit || busy"
            @focus="focus"
            @apply="page.safe(editor.applyDrafts)"
          />
        </div>
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
