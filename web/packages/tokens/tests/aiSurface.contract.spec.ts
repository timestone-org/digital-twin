// @vitest-environment node —— 直接读 .scss 源文件，需要 import.meta.url 是 file: URL
/**
 * @fileoverview 契约：助手那块紫玻璃的可读性与自洽。
 *
 * ⚠ 助手在自己的根节点上**改写全局语义 token**，所以 `@dt/tokens` 那套预设用例
 * 一个字都管不到它——那边验的是 6 套主题，这边这套取值它根本看不见。
 *
 * ⚠ 最容易出的一类错是**改了颜色忘了改 `-rgb` 伴生变量**：仓里有 62 处
 * `rgba(var(--accent-primary-rgb), α)`，伴生变量没跟着改的话，半透明那一层
 * 仍按全局主题的青色画，而页面不报任何错、typecheck 与 lint 也一律放行。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// ⚠ 相对本文件定位而不是相对 cwd：整包跑与单文件跑的 cwd 不是同一个目录
const SCSS = readFileSync(
  fileURLToPath(new URL('../src/ai-surface.scss', import.meta.url)),
  'utf8',
)

/** `.ai-surface` 里的声明表（变量名 → 字面量取值）。 */
const DECLARED = new Map<string, string>(
  [...SCSS.matchAll(/^\s{2}(--[a-z0-9-]+):\s*([^;]+);/gm)].map((found) => [
    found[1] ?? '',
    (found[2] ?? '').replace(/\s+/g, ' ').trim(),
  ]),
)

/** WCAG AA 正文阈值。 */
const AA_BODY = 4.5

type Rgb = [number, number, number]

function valueOf(name: string): string {
  const value = DECLARED.get(name)
  if (value === undefined) throw new Error(`${name} 没有在 .ai-surface 里声明`)
  return value
}

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
  const channel = (value: number): number => {
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

/** 正文压在两种底色上：面板是半透明的，先合成到 base 才是它真正的观感。 */
function backdrops(): Rgb[] {
  const base = parseColor(valueOf('--surface-base')).rgb
  return [base, composite(valueOf('--surface-panel'), base)]
}

describe('助手配色的可读性', () => {
  it('正文三档在两种底色上都过 AA', () => {
    const body = ['--text-primary', '--text-secondary', '--text-disabled']
    for (const backdrop of backdrops()) {
      for (const name of body) {
        expect(
          contrast(composite(valueOf(name), backdrop), backdrop),
        ).toBeGreaterThanOrEqual(AA_BODY)
      }
    }
  })

  it('强调色当文字用也过 AA', () => {
    for (const backdrop of backdrops()) {
      expect(
        contrast(composite(valueOf('--accent-on-surface'), backdrop), backdrop),
      ).toBeGreaterThanOrEqual(AA_BODY)
    }
  })

  it('强调实心底上的前景过 AA', () => {
    // @dt/ui 的实心按钮与标签恒配 --text-on-emphasis 作前景
    const fills = ['--accent-primary', '--state-success', '--state-danger']
    for (const fill of fills) {
      expect(
        contrast(
          parseColor(valueOf('--text-on-emphasis')).rgb,
          parseColor(valueOf(fill)).rgb,
        ),
      ).toBeGreaterThanOrEqual(AA_BODY)
    }
    // warning 实心底配的是 --text-inverse，不是 --text-on-emphasis
    expect(
      contrast(
        parseColor(valueOf('--text-inverse')).rgb,
        parseColor(valueOf('--state-warning')).rgb,
      ),
    ).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('用户气泡的每一档渐变上正文都过 AA', () => {
    // 气泡是实心渐变，正文压在它身上——两端都要能读
    const stops = [...valueOf('--ai-grad-user').matchAll(/#[0-9a-f]{6}/gi)]
    expect(stops.length).toBeGreaterThanOrEqual(2)
    for (const stop of stops) {
      expect(
        contrast(
          parseColor(valueOf('--text-primary')).rgb,
          parseColor(stop[0]).rgb,
        ),
      ).toBeGreaterThanOrEqual(AA_BODY)
    }
  })

  it('次要文字明显强于三级文字', () => {
    const base = parseColor(valueOf('--surface-base')).rgb
    expect(
      contrast(composite(valueOf('--text-secondary'), base), base),
    ).toBeGreaterThan(
      contrast(composite(valueOf('--text-disabled'), base), base),
    )
  })

  it('离线与空闲状态色可读', () => {
    const base = parseColor(valueOf('--surface-base')).rgb
    for (const name of ['--state-offline', '--state-idle']) {
      expect(
        contrast(composite(valueOf(name), base), base),
      ).toBeGreaterThanOrEqual(4)
    }
  })
})

describe('助手配色的自洽', () => {
  // 仓里被 rgba(var(--x-rgb), α) 消费的那几个
  const COMPANIONS = [
    '--accent-primary',
    '--accent-secondary',
    '--state-danger',
    '--state-warning',
    '--state-success',
    '--text-title',
  ]

  it.each(COMPANIONS)('%s 的 -rgb 伴生变量与它自己对得上', (name) => {
    const { rgb } = parseColor(valueOf(name))
    expect(valueOf(`${name}-rgb`)).toBe(rgb.join(', '))
  })

  it('中性前景的三元组是亮色', () => {
    // ⚠ 不改写它的话，浅色主题下它是深墨色，铺在这块紫底上什么都画不出来
    const [red, green, blue] = valueOf('--neutral-fg-rgb')
      .split(',')
      .map((part) => Number(part.trim())) as Rgb
    expect(luminance([red, green, blue])).toBeGreaterThan(0.5)
  })
})
