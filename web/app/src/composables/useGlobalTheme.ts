/**
 * @fileoverview 把生效中的主题写到文档根，让整个应用（含不套壳的登录页与错误页）
 * 跟着换肤。根上的内联变量覆盖 tokens.scss 的 :root 默认，级联到所有后代。
 */

import { watchEffect } from 'vue'
import { applyTheme } from '@dt/tokens'

import { useThemePreference } from './useThemePreference'
import { useEmbedContext } from '@/features/embed/context'

export function useGlobalTheme(): void {
  const { resolvedId } = useThemePreference()
  const embed = useEmbedContext()
  watchEffect(() => {
    applyTheme(
      document.documentElement,
      embed.isEmbedded.value ? embed.themeId.value : resolvedId.value,
    )
  })
}
