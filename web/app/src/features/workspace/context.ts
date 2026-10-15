/** @fileoverview 工作页签的会话与页面注入契约。 */
import { hasInjectionContext, inject, type InjectionKey, type Ref } from 'vue'
import type {
  RouteLocationNormalized,
  RouteLocationNormalizedLoaded,
} from 'vue-router'

export interface WorkspaceTab {
  key: string
  route: RouteLocationNormalizedLoaded
  title: string
  cached: boolean
  dirty: boolean
  generation: number
}

export interface Workspace {
  tabs: Readonly<Ref<readonly WorkspaceTab[]>>
  activeKey: Readonly<Ref<string>>
  closing: Readonly<Ref<boolean>>
  canRetain: (to: RouteLocationNormalized) => boolean
  close: (key: string) => Promise<void>
  closeAll: () => Promise<void>
  update: (
    key: string,
    patch: Partial<Pick<WorkspaceTab, 'title' | 'dirty'>>,
  ) => void
  registerGuard: (
    key: string,
    guard: () => boolean | Promise<boolean>,
  ) => () => void
  recordDashboard: (id: string, version: number, origin: string) => void
}

export interface WorkspacePage {
  key: string
  active: Readonly<Ref<boolean>>
  cached: boolean
}

export const WORKSPACE_KEY: InjectionKey<Workspace> = Symbol('workspace')
export const WORKSPACE_PAGE_KEY: InjectionKey<WorkspacePage> =
  Symbol('workspace-page')

export function useWorkspace(): Workspace | null {
  return hasInjectionContext() ? inject(WORKSPACE_KEY, null) : null
}

export function useWorkspacePage(): WorkspacePage | null {
  return hasInjectionContext() ? inject(WORKSPACE_PAGE_KEY, null) : null
}
