/**
 * @fileoverview 主题引擎：把一套内置主题写成宿主元素的内联 CSS 变量，覆盖
 * tokens.scss 的 :root 默认。纯 DOM 实现，不依赖任何框架；取值在 themePresets.ts。
 */
import { DEFAULT_PRESET, THEME_PRESETS } from './themePresets'
import type { ThemeDefinition, ThemeTokens } from './themeTokens'

export type { ThemeDefinition, ThemeTokens } from './themeTokens'

type TokenGroup = keyof ThemeTokens
type TokenPath = {
  [G in TokenGroup]: `${G}.${keyof ThemeTokens[G] & string}`
}[TokenGroup]

/**
 * token 路径 → CSS 变量名。键是全部 token 路径的全集，漏一个 typecheck 就红。
 * 派生变量（`--border-focus`、`--card-bg`…）不在表里：CSS 自定义属性在取用处
 * 解析，写了源变量它们自动跟随。
 */
export const TOKEN_CSS_VAR: Record<TokenPath, string> = {
  'surface.base': '--surface-base',
  'surface.sunken': '--surface-sunken',
  'surface.panel': '--surface-panel',
  'surface.raised': '--surface-raised',
  'surface.overlay': '--surface-overlay',

  'border.subtle': '--border-subtle',
  'border.default': '--border-default',
  'border.strong': '--border-strong',
  'border.hover': '--border-hover',

  'text.primary': '--text-primary',
  'text.secondary': '--text-secondary',
  'text.disabled': '--text-disabled',
  'text.title': '--text-title',
  'text.inverse': '--text-inverse',
  'text.onEmphasis': '--text-on-emphasis',

  'accent.primary': '--accent-primary',
  'accent.secondary': '--accent-secondary',
  'accent.onSurface': '--accent-on-surface',

  'state.success': '--state-success',
  'state.warning': '--state-warning',
  'state.danger': '--state-danger',
  'state.info': '--state-info',
  'state.idle': '--state-idle',
  'state.offline': '--state-offline',

  'fx.glowTitle': '--fx-glow-title',
  'fx.cornerColor': '--fx-corner-color',
  'fx.scanline': '--fx-scanline',
  'fx.gridLine': '--fx-grid-line',
  'fx.scrim': '--fx-scrim',
  'fx.shadowModal': '--fx-shadow-modal',
  'fx.shadowMenu': '--fx-shadow-menu',
  'fx.shadowInset': '--fx-shadow-inset',
  'fx.sheen': '--fx-sheen',
  'fx.transition': '--fx-transition',
}

export const DEFAULT_THEME_ID = 'dark-tech'

const THEME_BY_ID = new Map(THEME_PRESETS.map((theme) => [theme.id, theme]))

/** 全部内置主题，换肤器下拉直接消费。 */
export function listThemes(): readonly ThemeDefinition[] {
  return THEME_PRESETS
}

/**
 * 取主题定义；未知 id / null → 回退默认深色。
 * @param id 主题 id
 */
export function getTheme(id?: string | null): ThemeDefinition {
  return (id == null ? undefined : THEME_BY_ID.get(id)) ?? DEFAULT_PRESET
}

const HEX_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * `#rrggbb` / `#rgb` → `"r, g, b"`；非 hex 返回 null。
 * @param hex 待解析的颜色字面量
 */
export function hexToRgbTriplet(hex: string): string | null {
  const value = hex.trim()
  if (!HEX_PATTERN.test(value)) return null
  const digits = value.slice(1)
  const full =
    digits.length === 3 ? digits.replace(/./g, (char) => char + char) : digits
  const red = parseInt(full.slice(0, 2), 16)
  const green = parseInt(full.slice(2, 4), 16)
  const blue = parseInt(full.slice(4, 6), 16)
  return `${red}, ${green}, ${blue}`
}

/**
 * 把 ThemeTokens 摊平成 `group.key` → 取值。
 * @param tokens 一套完整的语义 token
 */
function flattenTokens(tokens: ThemeTokens): Record<string, string> {
  const { surface, border, text, accent, state, fx } = tokens
  const groups: Record<string, Record<string, string>> = {
    surface,
    border,
    text,
    accent,
    state,
    fx,
  }
  const flat: Record<string, string> = {}
  for (const [group, entries] of Object.entries(groups)) {
    for (const [key, value] of Object.entries(entries)) {
      flat[`${group}.${key}`] = value
    }
  }
  return flat
}

/**
 * 写一个 token 并同步维护它的 `-rgb` 伴生变量。
 * @param style 宿主元素的内联样式
 * @param cssVar CSS 变量名，含前导 `--`
 * @param value 缺省表示这套主题不覆盖它，回落 :root
 */
function writeToken(
  style: CSSStyleDeclaration,
  cssVar: string,
  value?: string,
): void {
  if (value === undefined) {
    style.removeProperty(cssVar)
    style.removeProperty(`${cssVar}-rgb`)
    return
  }
  style.setProperty(cssVar, value)
  const triplet = hexToRgbTriplet(value)
  // ⚠ 非 hex 必须把伴生变量清掉：留着上一套的三元组，rgba(var(--x-rgb), α)
  // 就会拿着旧主题的颜色画，页面不报错
  if (triplet === null) style.removeProperty(`${cssVar}-rgb`)
  else style.setProperty(`${cssVar}-rgb`, triplet)
}

/** 全部主题 extraVars 键的并集，切主题时以它为宇宙做 set-or-remove。 */
const EXTRA_VAR_UNIVERSE: readonly string[] = [
  ...new Set(
    THEME_PRESETS.flatMap((theme) => Object.keys(theme.extraVars ?? {})),
  ),
]

/**
 * 幂等写 extraVars：本主题没有的键一律移除，不留上一套的取值。
 * @param el 承载内联变量的宿主元素
 * @param extraVars 本主题的附加变量
 */
function applyExtraVars(
  el: HTMLElement,
  extraVars: Record<string, string>,
): void {
  for (const name of EXTRA_VAR_UNIVERSE) {
    const value = extraVars[name]
    if (value === undefined) el.style.removeProperty(name)
    else el.style.setProperty(name, value)
  }
}

/**
 * 把一套主题写成 el 的内联 CSS 变量。幂等，可重复调用。
 * @param el 承载内联变量的宿主元素
 * @param id 主题 id；未知 / null → 默认深色
 */
export function applyTheme(el: HTMLElement, id?: string | null): void {
  const theme = getTheme(id)
  // isRootDefault 的主题逐项 removeProperty，回落 tokens.scss 的 :root
  const values = theme.isRootDefault ? null : flattenTokens(theme.tokens)
  for (const [path, cssVar] of Object.entries(TOKEN_CSS_VAR)) {
    writeToken(el.style, cssVar, values?.[path])
  }
  applyExtraVars(el, theme.extraVars ?? {})
  // ⚠ color-scheme 不跟着 mode 走，浅色主题下原生滚动条 / 下拉 / 日期选择器
  // 与自动填充底色统统还是深色皮肤，而且不报任何错
  el.style.colorScheme = theme.mode
}
