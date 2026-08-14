/**
 * @fileoverview 项目那两个弹窗的落库：新建项目、改项目设置、删项目。
 * 事件由聚合组件发，这里只管请求、忙碌态与提示；自定义主题在 `useProjectThemes`。
 */
import { ref, type Ref } from 'vue'
import { useConfirm, useToast } from '@dt/ui'

import { createProject, deleteProject, updateProject } from '@/api/dashboard'
import type { ProjectSummary } from '@/api/dashboardWire'
import { describeError } from '@/composables/useAsyncList'
import type { NewProjectPayload, ProjectSettingsPayload } from '../payloads'

export interface ProjectDialogFlow {
  busy: Ref<boolean>
  /** 建成了给新项目 id，失败给 null。 */
  create: (input: NewProjectPayload) => Promise<string | null>
  save: (projectId: string, payload: ProjectSettingsPayload) => Promise<boolean>
  /** 问一遍再删；用户答不删或删失败都给 false。 */
  remove: (project: ProjectSummary) => Promise<boolean>
}

interface Context {
  toast: ReturnType<typeof useToast>
  confirm: ReturnType<typeof useConfirm>
  busy: Ref<boolean>
}

/** 盖上忙碌态跑一件事；失败只报错并给回落值，不让调用方各写一遍 try。 */
async function withBusy<TResult>(
  context: Context,
  task: () => Promise<TResult>,
  fallback: TResult,
): Promise<TResult> {
  context.busy.value = true
  try {
    return await task()
  } catch (caught) {
    context.toast.error(describeError(caught))
    return fallback
  } finally {
    context.busy.value = false
  }
}

async function create(
  context: Context,
  input: NewProjectPayload,
): Promise<string | null> {
  return withBusy(
    context,
    async () => {
      const made = await createProject(input)
      context.toast.success(`已创建项目「${made.name}」`)
      return made.id
    },
    null,
  )
}

async function save(
  context: Context,
  projectId: string,
  payload: ProjectSettingsPayload,
): Promise<boolean> {
  return withBusy(
    context,
    async () => {
      await updateProject(projectId, payload)
      context.toast.success('项目设置已保存')
      return true
    },
    false,
  )
}

async function remove(
  context: Context,
  project: ProjectSummary,
): Promise<boolean> {
  const agreed = await context.confirm.ask({
    title: '删除项目',
    message:
      `「${project.name}」以及它下面的 ${project.dashboardCount} 张大屏` +
      '会一并删除，此操作不可恢复。',
    confirmText: '删除',
    danger: true,
  })
  if (!agreed) return false
  return withBusy(
    context,
    async () => {
      await deleteProject(project.id)
      context.toast.success('项目已删除')
      return true
    },
    false,
  )
}

export function useProjectDialogFlow(): ProjectDialogFlow {
  const context: Context = {
    toast: useToast(),
    confirm: useConfirm(),
    busy: ref(false),
  }
  return {
    busy: context.busy,
    create: (input) => create(context, input),
    save: (projectId, payload) => save(context, projectId, payload),
    remove: (project) => remove(context, project),
  }
}
