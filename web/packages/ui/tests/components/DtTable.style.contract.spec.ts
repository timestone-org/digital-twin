/**
 * @fileoverview DtTable 贴边单元格（sticky 表头、贴边列）必须是不透明底。
 * ⚠ `--surface-panel` 在多数主题里是半透明的，直接拿来当底色，滚过去的行会从
 * 表头字缝里透出来；happy-dom 不排版，故编译样式块检查声明。
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
  'DtTable',
  'DtTable.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtTable 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/** 取一条选择器（可以是选择器组里的一员）的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const alone = CSS.indexOf(`${selector} {`)
  const start = alone >= 0 ? alone : CSS.indexOf(`${selector},`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

/** 底色声明里最后一层必须是不透明的 `--surface-base`。 */
function backgroundOf(selector: string): string {
  return /background:\s*([^;]+);/.exec(ruleBody(selector))?.[1] ?? ''
}

describe('DtTable 贴边单元格底色', () => {
  it.each(['.dt-table th', '.dt-table td.is-sticky-start'])(
    '%s 垫着不透明的页面底色',
    (selector) => {
      expect(backgroundOf(selector)).toMatch(/var\(--surface-base\)\s*$/)
    },
  )
})
