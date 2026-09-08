/**
 * @fileoverview 助手入口的贴边几何、唤醒方式与命中范围契约。
 * ⚠ happy-dom 不排版，因此编译 scoped SCSS 后检查这组用户可见行为。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileString } from 'sass-embedded'
import { describe, expect, it } from 'vitest'

const COMPONENT = join(
  process.cwd(),
  'app',
  'src',
  'components',
  'ai',
  'AiDock.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('AiDock 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/**
 * 取编译后 CSS 中指定选择器的声明块。
 * @param selector 目标选择器
 * @param source 要搜索的 CSS 片段
 */
function ruleBody(selector: string, source = CSS): string {
  const start = source.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} 这条规则没了`)
  const open = source.indexOf('{', start + selector.length)
  let depth = 1
  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index]
    if (character === '{') depth += 1
    if (character !== '}') continue
    depth -= 1
    if (depth === 0) return source.slice(open + 1, index)
  }
  throw new Error(`${selector} 的声明块没有闭合`)
}

describe('AiDock 贴边布局契约', () => {
  it('收起态只在屏幕内留 28px', () => {
    const body = ruleBody('.ai-dock.is-peeking')

    expect(body).toMatch(/^\s*right:\s*0;$/m)
    expect(body).toMatch(
      /^\s*transform:\s*translateX\(calc\(100% - 28px\)\);$/m,
    )
  })

  it('指针悬停或键盘聚焦时完整露出', () => {
    const hoverMedia = ruleBody('@media (hover: hover)')

    expect(ruleBody('.ai-dock.is-peeking:hover', hoverMedia)).toMatch(
      /^\s*transform:\s*translateX\(0\);$/m,
    )
    expect(ruleBody('.ai-dock.is-peeking:focus-within')).toMatch(
      /^\s*transform:\s*translateX\(0\);$/m,
    )
  })

  it('光晕不命中底下的页面操作', () => {
    expect(ruleBody('.ai-dock__call::before')).toMatch(
      /^\s*pointer-events:\s*none;$/m,
    )
  })

  it('减弱动效时关掉贴边过渡', () => {
    const reducedMotionMedia = ruleBody(
      '@media (prefers-reduced-motion: reduce)',
    )

    expect(reducedMotionMedia).toMatch(
      /\.ai-dock,\s*\.ai-dock__call\s*{\s*transition:\s*none;/,
    )
    expect(
      ruleBody(
        '.ai-dock.is-peeking:hover .ai-dock__call::before',
        reducedMotionMedia,
      ),
    ).toMatch(/^\s*animation:\s*none;$/m)
  })
})
