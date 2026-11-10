/**
 * @fileoverview 契约：浮层面板按内容取宽，与它被摆到哪里无关。
 * ⚠ fixed 定位的面板若按「剩余空间」收缩取宽，贴右对齐（align=end）时左坐标
 * 一靠右，面板就被压成一百来像素、每四五个字换一行；happy-dom 不排版，
 * 故编译样式检查声明。
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
  'DtPopover',
  'DtPopover.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtPopover 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('DtPopover 面板宽度', () => {
  it('按内容取宽，不随摆放位置收缩', () => {
    expect(ruleBody('.dt-popover__panel')).toMatch(/width:\s*max-content/)
  })

  it('上限同时夹住 22rem 与视口两侧留白', () => {
    expect(ruleBody('.dt-popover__panel')).toMatch(
      /max-width:\s*min\(22rem,\s*100vw - 16px\)/,
    )
  })
})
