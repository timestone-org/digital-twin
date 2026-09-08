/**
 * @fileoverview 单屏主题的读取与宿主注入；未配置时继承系统主题。
 */
import { applyScopedTheme, listThemes } from '@dt/tokens'
import { inject, watchEffect, type InjectionKey, type Ref } from 'vue'

type DashboardThemeSource = () => Record<string, unknown> | undefined

export const DASHBOARD_THEME_KEY: InjectionKey<DashboardThemeSource> =
  Symbol('dashboard-theme')

/** 读取已登记的单屏主题，缺失或失效的配置跟随系统。 */
export function dashboardThemeId(
  themeJson: Record<string, unknown> | undefined,
): string | null {
  const id = themeJson?.__base
  return typeof id === 'string' && listThemes().some((theme) => theme.id === id)
    ? id
    : null
}

/**
 * 随配置与宿主变化应用局部主题，卸载时释放覆盖。
 * @param host 画布、预览或运行页的主题宿主
 * @param themeJson 缺省时读取编辑器注入的草稿
 */
export function useDashboardTheme(
  host: Ref<HTMLElement | null>,
  themeJson: DashboardThemeSource = inject(
    DASHBOARD_THEME_KEY,
    () => undefined,
  ),
): void {
  watchEffect(
    (onCleanup) => {
      const el = host.value
      const id = dashboardThemeId(themeJson())
      if (el === null) return
      applyScopedTheme(el, id)
      onCleanup(() => applyScopedTheme(el, null))
    },
    { flush: 'post' },
  )
}
