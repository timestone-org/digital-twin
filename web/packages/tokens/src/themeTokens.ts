/**
 * @fileoverview 主题的数据形状：一套主题由哪些语义 token 组成，以及一套内置
 * 主题的注册项。分组沿用 tokens.scss 自己的语义分组，path → CSS 变量名的桥接
 * 表在 themeEngine.ts。
 */

export interface ThemeTokens {
  surface: {
    base: string
    sunken: string
    panel: string
    raised: string
    overlay: string
  }
  border: { subtle: string; default: string; strong: string; hover: string }
  text: {
    primary: string
    secondary: string
    /** 三级正文：空态提示 / 单位 / 次要说明，按正文口径要过 4.5:1 */
    disabled: string
    title: string
    inverse: string
    onEmphasis: string
  }
  /**
   * ⚠ accent.primary / accent.secondary / state.danger / text.title 必须给 `#hex`：
   * 引擎只在 hex 时同步 `-rgb` 伴生变量，给 rgba() 会让 `rgba(var(--x-rgb), α)`
   * 的消费方静默回落到 :root 的深色三元组——页面不报错，只是颜色不对。
   */
  /**
   * ⚠ `onSurface` 是**强调色当文字用**时的取值，与 `primary` 分开：
   * `primary` 要在实心底上配深墨前景，浅色主题里因此不能调暗；而同一个
   * 取值压在浅底上当文字只有 3.09:1，过不了 AA。两种用途拉不到同一个值上。
   */
  accent: { primary: string; secondary: string; onSurface: string }
  state: {
    success: string
    warning: string
    danger: string
    info: string
    idle: string
    offline: string
  }
  fx: {
    glowTitle: string
    cornerColor: string
    scanline: string
    gridLine: string
    scrim: string
    shadowModal: string
    shadowMenu: string
    transition: string
  }
}

export interface ThemeDefinition {
  id: string
  name: string
  mode: 'dark' | 'light'
  tokens: ThemeTokens
  /** 超出 ThemeTokens 的附加 CSS 变量；切主题时幂等 set-or-remove。 */
  extraVars?: Record<string, string>
  /** true = 取值逐项等于 tokens.scss 的 :root，注入时只做 removeProperty。 */
  isRootDefault?: boolean
}
