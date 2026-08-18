/**
 * @fileoverview 项目自定义主题的增删改查。
 *
 * ⚠ 一组主题整体存在项目行的 JSONB 数组里，故每次增删改之后整组重拉一次，
 * 而不是就地改本地数组——两个人同时加主题时，本地那份会与库里越差越远。
 */
import { onUnmounted, ref, type Ref } from 'vue'
import { useToast } from '@dt/ui'
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

export interface ProjectThemes {
  items: Ref<ProjectThemePayload[]>
  busy: Ref<boolean>
  load: () => Promise<void>
  add: (input: ProjectThemeCreateInput) => Promise<void>
  edit: (themeId: string, patch: ProjectThemePatchInput) => Promise<void>
  drop: (theme: ProjectThemePayload) => Promise<void>
}

/**
 * @param projectId 当前项目 id 的读取口；没选项目时给 null，各操作直接跳过
 */
export function useProjectThemes(
  projectId: () => string | null,
): ProjectThemes {
  const toast = useToast()
  const items = ref<ProjectThemePayload[]>([])
  const busy = ref(false)
  let isAlive = true

  // ⚠ 卸载之后不许再写状态。持有它的是 WorkbenchDialogs，**关掉设置弹窗并不会
  // 卸载它**——真正卸载的是切走整个工作台；那一刻在途的请求回来照样会写 items
  // 与 busy，写进一棵已经没人看的树
  onUnmounted(() => {
    isAlive = false
  })

  /** 读不到不算错：设置弹窗的其余两档照常能用，只是主题列表空着。 */
  async function load(): Promise<void> {
    const id = projectId()
    if (id === null) return
    busy.value = true
    try {
      const rows = await listProjectThemes(id)
      if (isAlive) items.value = rows
    } catch {
      if (isAlive) items.value = []
    } finally {
      if (isAlive) busy.value = false
    }
  }

  async function run(task: (id: string) => Promise<unknown>): Promise<void> {
    const id = projectId()
    if (id === null) return
    busy.value = true
    try {
      await task(id)
      const rows = await listProjectThemes(id)
      if (isAlive) items.value = rows
    } catch (caught) {
      if (isAlive) toast.error(describeError(caught))
    } finally {
      if (isAlive) busy.value = false
    }
  }

  return {
    items,
    busy,
    load,
    add: (input) => run((id) => createProjectTheme(id, input)),
    edit: (themeId, patch) =>
      run((id) => updateProjectTheme(id, themeId, patch)),
    drop: (theme) => run((id) => deleteProjectTheme(id, theme.id)),
  }
}
