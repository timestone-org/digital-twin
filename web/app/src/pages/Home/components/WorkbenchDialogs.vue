<script setup lang="ts">
/**
 * @fileoverview 工作台十个弹窗的挂载点：按 `openName` 决定开哪一个，改完库只发
 * `changed`，列表由页面自己重拉。
 *
 * ⚠ 聚合而不是让页面各挂一遍：`index.vue` 有 300 行硬上限，十个弹窗各带五六个
 * prop 必然把它撑爆。同一条上限也管着本文件，所以落库那几步都在 `use*Flow` 里，
 * 这儿只做接线。
 * ⚠ 「用这个模板新建」与「导完发现有绑定没接上」这两条链路要连开两个弹窗，而
 * `openName` 由页面持有——这两处用本地开关接力，不回头去改页面的状态。
 */
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useToast } from '@dt/ui'
import { PERMISSION_CODES } from '@dt/contracts'
import type { DashboardTemplateSummary } from '@dt/contracts'

import type { DashboardSummary, ProjectSummary } from '@/api/dashboardWire'
import { useAuthStore } from '@/stores/auth'
import type { WorkbenchDialogName } from '../dialogs'
import type {
  NewDashboardPayload,
  NewProjectPayload,
  ProjectSettingsPayload,
} from '../payloads'
import ImportDashboardDialog from './ImportDashboardDialog.vue'
import ImportFilePicker from './ImportFilePicker.vue'
import NewDashboardDialog from './NewDashboardDialog.vue'
import NewProjectDialog from './NewProjectDialog.vue'
import ProjectSettingsDialog from './ProjectSettingsDialog.vue'
import RuntimeParamsDialog from './RuntimeParamsDialog.vue'
import SaveAsTemplateDialog from './SaveAsTemplateDialog.vue'
import ShareDashboardDialog from './ShareDashboardDialog.vue'
import TemplateLibraryDialog from './TemplateLibraryDialog.vue'
import UnresolvedBindingsDialog from './UnresolvedBindingsDialog.vue'
import ValidateBindingsDialog from './ValidateBindingsDialog.vue'
import { useDashboardDialogFlow } from './useDashboardDialogFlow'
import { useProjectDialogFlow } from './useProjectDialogFlow'
import { useCopySources } from './useCopySources'
import { useProjectThemes } from './useProjectThemes'
import {
  useTemplateDialogFlow,
  type TemplateDraft,
} from './useTemplateDialogFlow'
import { groupByProject, hasNameClash, toImportTargets } from './workbenchViews'
import type { ImportChoice } from './workbenchWrites'

const props = defineProps<{
  openName: WorkbenchDialogName | null
  target: DashboardSummary | null
  projects: readonly ProjectSummary[]
  selectedProjectId: string | null
  dashboards: readonly DashboardSummary[]
}>()

const emit = defineEmits<{
  close: []
  changed: [scope: 'projects' | 'dashboards']
  'select-project': [projectId: string]
}>()

const router = useRouter()
const toast = useToast()
const auth = useAuthStore()
const project = useProjectDialogFlow()
const themes = useProjectThemes(() => props.selectedProjectId)
const dashboard = useDashboardDialogFlow()
const template = useTemplateDialogFlow()
const copySources = useCopySources()

const library = ref<InstanceType<typeof TemplateLibraryDialog> | null>(null)
const picked = ref<{ id: string; name: string } | null>(null)

const newDashboardOpen = computed(
  () => isOpen('new-dashboard') || picked.value !== null,
)

const canManage = computed(() => auth.can([PERMISSION_CODES.dashboardManage]))
const canEdit = computed(() => auth.can([PERMISSION_CODES.dashboardEdit]))

const selectedProject = computed(
  () =>
    props.projects.find((item) => item.id === props.selectedProjectId) ?? null,
)

// 候选拉到了就用跨项目那份；拉不到退回页面已有的（只有当前项目那些）
const byProject = computed(() =>
  groupByProject(
    copySources.items.value.length > 0
      ? copySources.items.value
      : props.dashboards,
  ),
)
const importTargets = computed(() => toImportTargets(props.dashboards))
const importConflict = computed(() =>
  hasNameClash(props.dashboards, dashboard.payload.value?.name),
)

function isOpen(name: WorkbenchDialogName): boolean {
  return props.openName === name
}

function onToggle(open: boolean): void {
  if (!open) emit('close')
}

// 主题、自检、复制来源都是额外一次请求，等要用它的弹窗真开了再发
watch(
  () => props.openName,
  (name) => {
    if (name !== 'import') dashboard.clearPayload()
    if (name === 'project-settings') void themes.load()
    if (name === 'new-dashboard') void copySources.load()
    const dash = props.target
    if (name === 'validate' && dash !== null) void dashboard.validate(dash.id)
  },
  { immediate: true },
)

async function onNewProject(input: NewProjectPayload): Promise<void> {
  const id = await project.create(input)
  if (id === null) return
  emit('changed', 'projects')
  emit('select-project', id)
  emit('close')
}

async function onNewDashboard(payload: NewDashboardPayload): Promise<void> {
  if (!(await dashboard.create(payload))) return
  picked.value = null
  emit('changed', 'dashboards')
  emit('select-project', payload.projectId)
  emit('close')
}

/** 关新建大屏时顺手清掉预选模板，否则下次开还停在套模板那一档。 */
function onNewDashboardToggle(open: boolean): void {
  if (open) return
  picked.value = null
  emit('close')
}

async function onSaveSettings(payload: ProjectSettingsPayload): Promise<void> {
  const current = selectedProject.value
  if (current === null || !(await project.save(current.id, payload))) return
  emit('changed', 'projects')
  emit('close')
}

async function onDeleteProject(): Promise<void> {
  const current = selectedProject.value
  if (current === null || !(await project.remove(current))) return
  emit('changed', 'projects')
  emit('close')
}

async function onSaveTemplate(draft: TemplateDraft): Promise<void> {
  const dash = props.target
  if (dash === null || !(await template.save(dash, draft))) return
  emit('close')
}

/** 用模板建屏归建屏那一档的码，而模板库本身只要看的码，故在这儿再收一次。 */
function onUseTemplate(item: DashboardTemplateSummary): void {
  if (!canManage.value) {
    toast.warning('当前账号没有新建大屏的权限')
    return
  }
  picked.value = { id: item.id, name: item.name }
  void copySources.load()
  emit('close')
}

async function onDropTemplate(item: DashboardTemplateSummary): Promise<void> {
  if (await template.drop(item)) library.value?.reload()
}

async function onImport(choice: ImportChoice): Promise<void> {
  const projectId = props.selectedProjectId
  if (projectId === null || !(await dashboard.runImport(projectId, choice))) {
    return
  }
  emit('changed', 'dashboards')
  emit('close')
}

function onPreviewCreated(): void {
  const dashboardId = dashboard.created.value?.id
  dashboard.dismiss()
  if (dashboardId === undefined) return
  void router.push({ name: 'dashboard-view', params: { dashboardId } })
}
</script>

<template>
  <NewProjectDialog
    :open="isOpen('new-project')"
    :loading="project.busy.value"
    @update:open="onToggle"
    @submit="onNewProject"
  />

  <NewDashboardDialog
    :open="newDashboardOpen"
    :projects="projects"
    :current-project-id="selectedProjectId"
    :dashboards-by-project="byProject"
    :preset-template="picked"
    :loading="dashboard.busy.value"
    @update:open="onNewDashboardToggle"
    @submit="onNewDashboard"
  />

  <ProjectSettingsDialog
    :open="isOpen('project-settings')"
    :project="selectedProject"
    :can-update="canManage"
    :can-delete="canManage"
    :can-manage-theme="canEdit"
    :custom-themes="themes.items.value"
    :loading="project.busy.value"
    :theme-busy="themes.busy.value"
    @update:open="onToggle"
    @save="onSaveSettings"
    @request-delete="onDeleteProject"
    @create-theme="themes.add"
    @update-theme="themes.edit"
    @delete-theme="themes.drop"
  />

  <SaveAsTemplateDialog
    :open="isOpen('save-as-template')"
    :dashboard="target"
    :loading="template.busy.value"
    @update:open="onToggle"
    @submit="onSaveTemplate"
  />

  <TemplateLibraryDialog
    ref="library"
    :open="isOpen('template-library')"
    :can-delete="canManage"
    @update:open="onToggle"
    @use="onUseTemplate"
    @delete="onDropTemplate"
  />

  <ImportFilePicker
    :open="isOpen('import') && dashboard.payload.value === null"
    @update:open="onToggle"
    @pick="dashboard.pick"
  />

  <ImportDashboardDialog
    :open="isOpen('import') && dashboard.payload.value !== null"
    :payload="dashboard.payload.value"
    :project-name="selectedProject?.name ?? ''"
    :conflict="importConflict"
    :loading="dashboard.busy.value"
    :targets="importTargets"
    @update:open="onToggle"
    @submit="onImport"
  />

  <ShareDashboardDialog
    :open="isOpen('share')"
    :dashboard="target"
    @update:open="onToggle"
    @updated="emit('changed', 'dashboards')"
  />

  <ValidateBindingsDialog
    :open="isOpen('validate')"
    :loading="dashboard.validating.value"
    :result="dashboard.validation.value"
    :dashboard-name="target?.name ?? ''"
    @update:open="onToggle"
  />

  <RuntimeParamsDialog
    :open="isOpen('runtime-params')"
    @update:open="onToggle"
  />

  <UnresolvedBindingsDialog
    :open="dashboard.unresolved.value.length > 0"
    :count="dashboard.unresolved.value.length"
    :list="dashboard.unresolved.value"
    :dashboard-name="dashboard.created.value?.name ?? ''"
    @update:open="dashboard.dismiss"
    @preview="onPreviewCreated"
    @dismiss="dashboard.dismiss"
  />
</template>
