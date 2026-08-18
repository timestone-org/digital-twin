/**
 * @fileoverview 项目自定义主题里可编辑的那几个语义 token：路径、标签与回落值，
 * 以及草稿与 `ProjectThemePayload.tokens` 之间的搬运。
 *
 * ⚠ 只编辑核心几色、其余 token 一律不写进去：把整套 token 都落库，等于把这套
 * 主题从内置预设上焊死，之后预设改了任何一项这套主题都不会跟着走。
 * ⚠ 回落值取自内置默认主题而不是抄一份字面量：抄一份必然与 `@dt/tokens` 漂移。
 */
import type { DtSelectOption } from '@dt/contracts'
import { DEFAULT_THEME_ID, getTheme } from '@dt/tokens'

export interface ThemeColorField {
  /** `<组>.<键>`，与 `ThemeTokens` 的嵌套形状一致。 */
  path: string
  label: string
  fallback: string
}

export const MODE_OPTIONS: readonly DtSelectOption[] = [
  { value: 'dark', label: '深色' },
  { value: 'light', label: '浅色' },
]

const DEFAULT_TOKENS = getTheme(DEFAULT_THEME_ID).tokens

/** 一套主题里最影响观感的几色，其余留给内置预设。 */
export const THEME_COLOR_FIELDS: readonly ThemeColorField[] = [
  {
    path: 'accent.primary',
    label: '主色',
    fallback: DEFAULT_TOKENS.accent.primary,
  },
  {
    path: 'accent.secondary',
    label: '辅助色',
    fallback: DEFAULT_TOKENS.accent.secondary,
  },
  {
    path: 'surface.base',
    label: '背景',
    fallback: DEFAULT_TOKENS.surface.base,
  },
  {
    path: 'text.primary',
    label: '主文字',
    fallback: DEFAULT_TOKENS.text.primary,
  },
  {
    path: 'state.success',
    label: '正常',
    fallback: DEFAULT_TOKENS.state.success,
  },
  {
    path: 'state.warning',
    label: '警告',
    fallback: DEFAULT_TOKENS.state.warning,
  },
  {
    path: 'state.danger',
    label: '告警',
    fallback: DEFAULT_TOKENS.state.danger,
  },
]

/** 普通对象（不含数组与 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 按 `<组>.<键>` 路径读一个字符串取值；形状对不上就当没覆盖。 */
function readPath(
  tokens: Record<string, unknown> | undefined,
  path: string,
): string | undefined {
  const [group, key] = path.split('.')
  if (tokens === undefined || group === undefined || key === undefined) {
    return undefined
  }
  const bucket = tokens[group]
  if (!isRecord(bucket)) return undefined
  const value = bucket[key]
  return typeof value === 'string' ? value : undefined
}

/** 把落库的 tokens 摊成「路径 → 取值」的编辑草稿；没覆盖过的用回落值。 */
export function readColors(
  tokens: Record<string, unknown> | undefined,
): Record<string, string> {
  const draft: Record<string, string> = {}
  for (const field of THEME_COLOR_FIELDS) {
    draft[field.path] = readPath(tokens, field.path) ?? field.fallback
  }
  return draft
}

/** 把编辑草稿收敛回嵌套的 tokens 形状。只写登记过的那几项。 */
export function buildTokens(
  draft: Record<string, string>,
): Record<string, unknown> {
  const tokens: Record<string, Record<string, string>> = {}
  for (const field of THEME_COLOR_FIELDS) {
    const [group, key] = field.path.split('.')
    if (group === undefined || key === undefined) continue
    const bucket = tokens[group] ?? {}
    bucket[key] = draft[field.path] ?? field.fallback
    tokens[group] = bucket
  }
  return tokens
}

/** 列表里那个色点用的主色。 */
export function themeAccent(tokens: Record<string, unknown>): string {
  return readPath(tokens, 'accent.primary') ?? DEFAULT_TOKENS.accent.primary
}

/** 从任意 JSON blob 里读一个字符串字段；不是字符串就当没写过。 */
export function readText(blob: Record<string, unknown>, key: string): string {
  const value = blob[key]
  return typeof value === 'string' ? value : ''
}
