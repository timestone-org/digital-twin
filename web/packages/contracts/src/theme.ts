/**
 * @fileoverview 项目自定义主题：存在项目行的 JSONB 数组里，一项一套配色。
 */

export const PROJECT_THEME_MODES = ['dark', 'light'] as const

export type ProjectThemeMode = (typeof PROJECT_THEME_MODES)[number]

/** 一套项目自定义主题。 */
export interface ProjectThemePayload {
  id: string
  name: string
  /** 底色明暗，决定这套主题按深色还是浅色的对比度口径校验。 */
  mode: ProjectThemeMode
  /**
   * 语义 token 取值，形状即 `@dt/tokens` 的 `ThemeTokens`。
   * ⚠ 这里刻意不复述那份形状：contracts 是最底层、不许依赖 tokens，
   * 抄一份必然与 tokens 漂移。消费侧在 app 层窄化成 `ThemeTokens`。
   */
  tokens: Record<string, unknown>
}
