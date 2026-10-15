/** @fileoverview 工作页签实例的增删、关闭确认与大屏版本失效。 */
import { computed, ref, shallowRef, type ComputedRef, type Ref } from 'vue'
import type { RouteLocationNormalized, Router } from 'vue-router'
import type { Workspace, WorkspaceTab } from './context'
import { isWorkspaceRoute, shouldCacheRoute } from './routePolicy'

export interface WorkspaceAccess {
  enabled: Readonly<Ref<boolean>>
  canAccess: (route: RouteLocationNormalized) => boolean
  reportError: (message: string) => void
}

export class WorkspaceTabs implements Workspace {
  readonly tabs = shallowRef<readonly WorkspaceTab[]>([])
  readonly closing = ref(false)
  readonly activeKey: ComputedRef<string>
  private readonly guards = new Map<string, () => boolean | Promise<boolean>>()
  private readonly dashboardVersions = new Map<string, number>()
  private nextGeneration = 0

  constructor(
    private readonly router: Router,
    private readonly access: WorkspaceAccess,
  ) {
    this.activeKey = computed(() =>
      access.enabled.value && isWorkspaceRoute(router.currentRoute.value)
        ? router.currentRoute.value.path
        : '',
    )
  }

  canRetain(to: RouteLocationNormalized): boolean {
    return (
      this.access.enabled.value &&
      (isWorkspaceRoute(to) || to.name === 'dashboard-view')
    )
  }

  visit(): void {
    const route = this.router.currentRoute.value
    if (
      !this.access.enabled.value ||
      !isWorkspaceRoute(route) ||
      !this.access.canAccess(route)
    )
      return
    const existing = this.tabs.value.find((tab) => tab.key === route.path)
    if (existing !== undefined) {
      this.tabs.value = this.tabs.value.map((tab) =>
        tab === existing ? { ...tab, route } : tab,
      )
      return
    }
    this.tabs.value = [
      ...this.tabs.value,
      {
        key: route.path,
        route,
        title: route.meta.title ?? '页面',
        cached: shouldCacheRoute(route),
        dirty: false,
        generation: this.nextGeneration++,
      },
    ]
  }

  update(
    key: string,
    patch: Partial<Pick<WorkspaceTab, 'title' | 'dirty'>>,
  ): void {
    this.tabs.value = this.tabs.value.map((tab) =>
      tab.key === key ? { ...tab, ...patch } : tab,
    )
  }

  close(key: string): Promise<void> {
    return this.closeKeys([key])
  }

  closeAll(): Promise<void> {
    const otherKeys = this.tabs.value
      .filter((tab) => tab.key !== this.activeKey.value)
      .map((tab) => tab.key)
    return this.closeKeys([...otherKeys, this.activeKey.value])
  }

  registerGuard(
    key: string,
    guard: () => boolean | Promise<boolean>,
  ): () => void {
    this.guards.set(key, guard)
    return () => {
      if (this.guards.get(key) === guard) this.guards.delete(key)
    }
  }

  recordDashboard(id: string, version: number, origin: string): void {
    const previous = this.dashboardVersions.get(id)
    if (previous !== undefined && previous >= version) return
    this.dashboardVersions.set(id, version)
    if (previous === undefined) return
    this.tabs.value = this.tabs.value.map((tab) => {
      if (
        tab.key === origin ||
        !tab.cached ||
        tab.dirty ||
        tab.route.params['dashboardId'] !== id
      )
        return tab
      // ⚠ 子编辑器推进整屏版本；干净的旧页须重读，脏草稿绝不覆盖。
      return { ...tab, generation: this.nextGeneration++ }
    })
  }

  reset(): void {
    this.tabs.value = []
    this.guards.clear()
    this.dashboardVersions.clear()
  }

  prune(): void {
    this.tabs.value = this.tabs.value.filter((tab) =>
      this.access.canAccess(tab.route),
    )
    const route = this.router.currentRoute.value
    if (
      this.access.enabled.value &&
      isWorkspaceRoute(route) &&
      !this.access.canAccess(route)
    ) {
      void this.router.replace({ name: 'forbidden' })
    }
  }

  private async approveClose(tab: WorkspaceTab): Promise<boolean> {
    if ((await this.guards.get(tab.key)?.()) === false) return false
    return this.tabs.value.some(
      (entry) => entry.key === tab.key && entry.generation === tab.generation,
    )
  }

  private async leaveCurrent(key: string): Promise<boolean> {
    const index = this.tabs.value.findIndex((entry) => entry.key === key)
    const neighbor = this.tabs.value[index - 1] ?? this.tabs.value[index + 1]
    const target = neighbor?.route.fullPath ?? '/'
    const failure = await this.router.push(target)
    return (
      failure === undefined &&
      this.router.currentRoute.value.fullPath === target
    )
  }

  private async remove(key: string): Promise<boolean> {
    const tab = this.tabs.value.find((entry) => entry.key === key)
    if (tab === undefined || key === '/') return true
    if (!(await this.approveClose(tab))) return false
    if (this.activeKey.value === key && !(await this.leaveCurrent(key)))
      return false
    this.tabs.value = this.tabs.value.filter((entry) => entry.key !== key)
    this.guards.delete(key)
    return true
  }

  private async closeKeys(keys: readonly string[]): Promise<void> {
    if (this.closing.value) return
    this.closing.value = true
    try {
      for (const key of keys) {
        if (!(await this.remove(key))) break
      }
    } catch (error) {
      this.access.reportError(
        error instanceof Error ? error.message : '关闭页面失败',
      )
    } finally {
      this.closing.value = false
    }
  }
}
