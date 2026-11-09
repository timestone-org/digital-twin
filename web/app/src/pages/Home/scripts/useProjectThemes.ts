/**
 * @fileoverview 项目自定义主题的增删改查。
 *
 * ⚠ 一组主题整体存在项目行的 JSONB 数组里，故每次增删改之后整组重拉一次，
 * 而不是就地改本地数组——两个人同时加主题时，本地那份会与库里越差越远。
 */
import { onUnmounted, ref, type Ref } from 'vue'
import { useConfirm, useToast } from '@dt/ui'
import type { ProjectThemePayload } from '@dt/contracts'

import {
  createProjectTheme,
  deleteProjectTheme,
  listProjectThemes,
  updateProjectTheme,
  type ProjectThemeCreateInput,
  type ProjectThemePatchInput,
} from '@/api/projectThemes'
import { describeError } from '@/composables/useAsyncList'

/** 写回结果的回执：表单据此决定收起还是保留草稿。 */
export type ThemeWriteDone = (ok: boolean) => void

export interface ProjectThemes {
  items: Ref<ProjectThemePayload[]>
  busy: Ref<boolean>
  load: () => Promise<void>
  add: (input: ProjectThemeCreateInput, done?: ThemeWriteDone) => Promise<void>
  edit: (
    themeId: string,
    patch: ProjectThemePatchInput,
    done?: ThemeWriteDone,
  ) => Promise<void>
  drop: (theme: ProjectThemePayload) => Promise<void>
}

interface ThemeContext {
  projectId: () => string | null
  items: Ref<ProjectThemePayload[]>
  busy: Ref<boolean>
  isAlive: () => boolean
  toast: ReturnType<typeof useToast>
}

/** 读不到不算错：设置弹窗的其余两档照常能用，只是主题列表空着。 */
async function loadThemes(ctx: ThemeContext): Promise<void> {
  const id = ctx.projectId()
  if (id === null) return
  ctx.busy.value = true
  try {
    const rows = await listProjectThemes(id)
    if (ctx.isAlive()) ctx.items.value = rows
  } catch {
    if (ctx.isAlive()) ctx.items.value = []
  } finally {
    if (ctx.isAlive()) ctx.busy.value = false
  }
}

/**
 * 写一笔再整组重拉；写成功与否经 `done` 回报。
 * @param ctx 状态与依赖
 * @param task 以项目 id 发起的写请求
 * @param done 写回执
 */
async function writeThemes(
  ctx: ThemeContext,
  task: (id: string) => Promise<unknown>,
  done?: ThemeWriteDone,
): Promise<void> {
  const id = ctx.projectId()
  if (id === null) return
  ctx.busy.value = true
  let ok = false
  try {
    await task(id)
    ok = true
    const rows = await listProjectThemes(id)
    if (ctx.isAlive()) ctx.items.value = rows
  } catch (caught) {
    if (ctx.isAlive()) ctx.toast.error(describeError(caught))
  } finally {
    if (ctx.isAlive()) ctx.busy.value = false
  }
  if (ctx.isAlive()) done?.(ok)
}

/**
 * @param projectId 当前项目 id 的读取口；没选项目时给 null，各操作直接跳过
 */
export function useProjectThemes(
  projectId: () => string | null,
): ProjectThemes {
  const confirm = useConfirm()
  let isAlive = true
  const ctx: ThemeContext = {
    projectId,
    items: ref<ProjectThemePayload[]>([]),
    busy: ref(false),
    isAlive: () => isAlive,
    toast: useToast(),
  }

  // ⚠ 卸载之后不许再写状态。持有它的是 WorkbenchDialogs，**关掉设置弹窗并不会
  // 卸载它**——真正卸载的是切走整个工作台；那一刻在途的请求回来照样会写 items
  // 与 busy，写进一棵已经没人看的树
  onUnmounted(() => {
    isAlive = false
  })

  async function drop(theme: ProjectThemePayload): Promise<void> {
    const agreed = await confirm.ask({
      title: '删除主题',
      message: `删除「${theme.name}」后，引用它的大屏会回退到项目默认或内置配色。`,
      confirmText: '删除',
      danger: true,
    })
    if (agreed) await writeThemes(ctx, (id) => deleteProjectTheme(id, theme.id))
  }

  return {
    items: ctx.items,
    busy: ctx.busy,
    load: () => loadThemes(ctx),
    add: (input, done) =>
      writeThemes(ctx, (id) => createProjectTheme(id, input), done),
    edit: (themeId, patch, done) =>
      writeThemes(ctx, (id) => updateProjectTheme(id, themeId, patch), done),
    drop,
  }
}
