// @vitest-environment node —— 直接读 tokens.scss 源文件，需要 import.meta.url 是 file: URL
/**
 * @fileoverview 契约：6 套预设的可读性与注入面。锁三件事——承载正文的组合过
 * WCAG AA（肉眼在霓虹配色上骗得过，算出来骗不过）、被 `rgba(var(--x-rgb), α)`
 * 消费的 token 必须是 `#hex`、引擎写的每个变量名都真的在 tokens.scss 里声明过。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { TOKEN_CSS_VAR } from '../src/themeEngine'
import { DEFAULT_PRESET, THEME_PRESETS } from '../src/themePresets'
import type { ThemeDefinition } from '../src/themeTokens'

const SCSS = readFileSync(
  fileURLToPath(new URL('../src/tokens.scss', import.meta.url)),
  'utf8',
)

/** tokens.scss 的 :root 声明表（变量名 → 字面量取值）。 */
const DECLARED = new Map<string, string>(
  [...SCSS.matchAll(/^\s{2}(--[a-z0-9-]+):\s*([^;]+);/gm)].map((found) => [
    found[1] ?? '',
    (found[2] ?? '').trim(),
  ]),
)

/** WCAG AA 正文阈值。 */
const AA_BODY = 4.5

type Rgb = [number, number, number]

function parseColor(value: string): { rgb: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)
  if (hex) {
    const digits = hex[1] ?? ''
    return {
      rgb: [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as Rgb,
      alpha: 1,
    }
  }
  const rgba =
    /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(value)
  if (!rgba) throw new Error(`无法解析颜色：${value}`)
  return {
    rgb: [1, 2, 3].map((at) => Number(rgba[at])) as Rgb,
    alpha: rgba[4] === undefined ? 1 : Number(rgba[4]),
  }
}

/** 半透明前景合成到不透明背景上，得到真正渲染出来的颜色。 */
function composite(color: string, backdrop: Rgb): Rgb {
  const { rgb, alpha } = parseColor(color)
  return rgb.map((channel, at) =>
    Math.round(channel * alpha + (backdrop[at] ?? 0) * (1 - alpha)),
  ) as Rgb
}

function luminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
  )
}

function contrast(foreground: Rgb, background: Rgb): number {
  const [high, low] = [luminance(foreground), luminance(background)].sort(
    (left, right) => right - left,
  )
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05)
}

/** 把一套主题摊平成 `group.key` → 取值，与引擎的注入面一一对应。 */
function tokenValues(theme: ThemeDefinition): Record<string, string> {
  const { surface, border, text, accent, state, fx } = theme.tokens
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

/** 正文压在两种底色上：面板是半透明的，先合成到 base 才是它真正的观感。 */
function backdrops(theme: ThemeDefinition): Array<[string, Rgb]> {
  const base = parseColor(theme.tokens.surface.base).rgb
  return [
    ['surface.base', base],
    ['surface.panel', composite(theme.tokens.surface.panel, base)],
  ]
}

describe('预设的文字对比度', () => {
  it.each(THEME_PRESETS)('$name 的正文在两种底色上都过 AA', (theme) => {
    const body = [
      theme.tokens.text.primary,
      theme.tokens.text.secondary,
      theme.tokens.text.disabled,
    ]
    for (const [, backdrop] of backdrops(theme)) {
      for (const color of body) {
        expect(
          contrast(composite(color, backdrop), backdrop),
        ).toBeGreaterThanOrEqual(AA_BODY)
      }
    }
  })

  it.each(THEME_PRESETS)('$name 的强调实心底上前景过 AA', (theme) => {
    const { accent, state, text } = theme.tokens
    // 这些实心底在 @dt/ui 里恒配 --text-on-emphasis 作前景
    const onEmphasis = [accent.primary, state.success, state.danger, state.info]
    for (const fill of onEmphasis) {
      expect(
        contrast(parseColor(text.onEmphasis).rgb, parseColor(fill).rgb),
      ).toBeGreaterThanOrEqual(AA_BODY)
    }
    // warning 实心底配的是 --text-inverse，不是 --text-on-emphasis
    expect(
      contrast(parseColor(text.inverse).rgb, parseColor(state.warning).rgb),
    ).toBeGreaterThanOrEqual(AA_BODY)
  })

  it.each(THEME_PRESETS)('$name 的次要文字明显强于三级文字', (theme) => {
    const base = parseColor(theme.tokens.surface.base).rgb
    const secondary = contrast(
      composite(theme.tokens.text.secondary, base),
      base,
    )
    const disabled = contrast(composite(theme.tokens.text.disabled, base), base)
    expect(secondary).toBeGreaterThan(disabled)
  })

  it.each(THEME_PRESETS)('$name 的离线与空闲状态色可读', (theme) => {
    const base = parseColor(theme.tokens.surface.base).rgb
    for (const color of [theme.tokens.state.offline, theme.tokens.state.idle]) {
      expect(contrast(composite(color, base), base)).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('预设的取值形状', () => {
  // 引擎只在 hex 时同步 `-rgb` 伴生变量；给 rgba() 会让消费方静默回落到
  // :root 的深色三元组——页面不报错，只是颜色不对
  const RGB_CONSUMED = [
    'accent.primary',
    'accent.secondary',
    'state.danger',
    'text.title',
  ]

  it.each(THEME_PRESETS)(
    '$name 里被 rgba(var(--x-rgb)) 消费的 token 全是 #hex',
    (theme) => {
      const values = tokenValues(theme)
      for (const path of RGB_CONSUMED) {
        expect(values[path]).toMatch(/^#[0-9a-f]{6}$/)
      }
    },
  )

  it.each(THEME_PRESETS)('$name 给全了每一个 token 路径', (theme) => {
    const values = tokenValues(theme)
    for (const path of Object.keys(TOKEN_CSS_VAR)) {
      expect(values[path]).toBeTruthy()
    }
  })

  it('id 与主色是冻结集合', () => {
    expect(
      THEME_PRESETS.map((theme) => [
        theme.id,
        theme.mode,
        theme.tokens.surface.base,
        theme.tokens.accent.primary,
        theme.tokens.accent.secondary,
      ]),
    ).toEqual([
      ['dark-tech', 'dark', '#010d1e', '#00cefc', '#45d3fd'],
      ['light', 'light', '#f4f7fb', '#0098c8', '#0077a8'],
      ['nebula-violet', 'dark', '#0a0a1e', '#9d6bff', '#6f7bff'],
      ['emerald', 'dark', '#03140f', '#2ee6a6', '#36d6c2'],
      ['lava-amber', 'dark', '#1a0d05', '#ff8a3d', '#ffb454'],
      ['cobalt-deep', 'dark', '#02091a', '#3a7bff', '#4f9bff'],
    ])
  })
})

describe('注入面与 tokens.scss 对得上', () => {
  it.each(Object.entries(TOKEN_CSS_VAR))(
    '%s 写的 %s 在 tokens.scss 里声明过',
    (_path, cssVar) => {
      expect(DECLARED.has(cssVar)).toBe(true)
    },
  )

  it('全部 extraVars 的键都在 tokens.scss 里声明过', () => {
    const names = new Set(
      THEME_PRESETS.flatMap((theme) => Object.keys(theme.extraVars ?? {})),
    )
    expect([...names].filter((name) => !DECLARED.has(name))).toEqual([])
  })

  it('默认深色逐项等于 tokens.scss 的 :root', () => {
    expect(DEFAULT_PRESET.isRootDefault).toBe(true)
    const values = tokenValues(DEFAULT_PRESET)
    for (const [path, cssVar] of Object.entries(TOKEN_CSS_VAR)) {
      expect(values[path]).toBe(resolve(cssVar))
    }
  })

  /**
   * 反向那条才是「整个系统跟着换」的保证：正向只说明写出去的变量都存在，
   * 说明不了有没有哪个颜色是**任何主题都改不动**的。改不动的那个不会报错，
   * 只会在换成浅色 / 换个色相后，孤零零地留着一块深青。
   */
  it('tokens.scss 里每一个带颜色的变量都够得着，没有换不动的死色', () => {
    const injected = new Set(Object.values(TOKEN_CSS_VAR))
    const viaExtraVars = new Set(
      THEME_PRESETS.flatMap((theme) => Object.keys(theme.extraVars ?? {})),
    )
    // 引擎在取值是 hex 时同步写 `${cssVar}-rgb`
    const companions = new Set([...injected].map((name) => `${name}-rgb`))

    function reachable(name: string): boolean {
      if (injected.has(name)) return true
      if (viaExtraVars.has(name)) return true
      if (companions.has(name)) return true
      const raw = DECLARED.get(name) ?? ''
      const reference = /^var\((--[a-z0-9-]+)\)$/.exec(raw)
      // 派生变量：CSS 自定义属性在取用处解析，源变量被改写它就跟着走
      return reference !== null && reachable(reference[1] ?? '')
    }

    const colourish = [...DECLARED].filter(([, value]) => isColour(value))

    expect(
      colourish.map(([name]) => name).filter((name) => !reachable(name)),
    ).toEqual([])
  })
})

/** 字面量里带 hex / `rgb(...)`，或整条就是 `r, g, b` 三元组 → 当颜色看。 */
function isColour(value: string): boolean {
  return (
    /#[0-9a-f]{3,8}\b/i.exec(value) !== null ||
    /\brgba?\(/i.exec(value) !== null ||
    /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.exec(value) !== null
  )
}

/** 取 :root 的字面量取值，`var(--x)` 逐层解到底。 */
function resolve(cssVar: string): string {
  const raw = DECLARED.get(cssVar)
  if (raw === undefined) throw new Error(`tokens.scss 缺少 ${cssVar}`)
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(raw)
  return reference === null ? raw : resolve(reference[1] ?? '')
}
