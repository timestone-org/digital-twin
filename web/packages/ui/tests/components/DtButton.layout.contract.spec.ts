/**
 * @fileoverview DtButton 的尺寸档在纵向 flex 空间不足时仍保持完整高度。
 * ⚠ happy-dom 不排版，故编译并检查防止固定高度被收缩所需的 min-height。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { compileString } from 'sass-embedded'
import { describe, expect, it } from 'vitest'

const COMPONENT = join(
  process.cwd(),
  'packages',
  'ui',
  'src',
  'components',
  'DtButton',
  'DtButton.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtButton 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`${selector} 这条规则没了`)
  const open = CSS.indexOf('{', start + selector.length)
  let depth = 1
  for (let index = open + 1; index < CSS.length; index += 1) {
    const character = CSS[index]
    if (character === '{') depth += 1
    if (character !== '}') continue
    depth -= 1
    if (depth === 0) return CSS.slice(open + 1, index)
  }
  throw new Error(`${selector} 的声明块没有闭合`)
}

describe('DtButton 高度尺寸契约', () => {
  it.each(['sm', 'md', 'lg'] as const)(
    '%s 用对应尺寸变量同时约束高度与最小高度',
    (size) => {
      const body = ruleBody(`.dt-btn--${size}`)

      expect(body).toMatch(
        new RegExp(`(^|\\s)height:\\s*var\\(--ctl-h-${size}\\);`),
      )
      expect(body).toMatch(
        new RegExp(`(^|\\s)min-height:\\s*var\\(--ctl-h-${size}\\);`),
      )
    },
  )

  it('xs 的高度与最小高度都固定为 20px', () => {
    const body = ruleBody('.dt-btn--xs')

    expect(body).toMatch(/(^|\s)height:\s*20px;/)
    expect(body).toMatch(/(^|\s)min-height:\s*20px;/)
  })
})
