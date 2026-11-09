/**
 * @fileoverview 契约：有序列表带序号、无序列表带圆点。
 * ⚠ Tailwind 的 preflight 把 ol/ul 的 list-style 清成 none，组件不显式恢复，
 * 步骤编号就整列消失；happy-dom 不排版，故编译样式块检查声明。
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
  'DtMarkdown',
  'DtMarkdown.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtMarkdown 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('DtMarkdown 列表标记', () => {
  it('有序列表显式给出十进制序号', () => {
    expect(ruleBody('ol.md__list')).toMatch(/list-style-type:\s*decimal/)
  })

  it('无序列表显式给出圆点', () => {
    expect(ruleBody('ul.md__list')).toMatch(/list-style-type:\s*disc/)
  })
})
