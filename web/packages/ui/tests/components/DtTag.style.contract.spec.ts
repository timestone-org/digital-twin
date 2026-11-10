/**
 * @fileoverview 契约：DtTag 的行高给下行字母留出位置。
 * ⚠ 行高等于字号时，标签里再包一层 `truncate`（overflow: hidden）的文字会把
 * 基线以下整段裁掉——`audit_line_minute` 读成 `audit line minute`，而这串编码
 * 是要原样抄进绑定键里的；happy-dom 不排版，故编译样式检查声明。
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
  'DtTag',
  'DtTag.vue',
)
const SOURCE = readFileSync(COMPONENT, 'utf8')
const STYLE = /<style scoped lang="scss">([\s\S]*?)<\/style>/.exec(SOURCE)?.[1]
if (!STYLE) throw new Error('DtTag 的 scoped SCSS 块没了')
const CSS = compileString(STYLE, { url: pathToFileURL(COMPONENT) }).css

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = CSS.indexOf('{', start)
  return CSS.slice(open + 1, CSS.indexOf('}', open))
}

describe('DtTag 行高', () => {
  it('无单位行高至少 1.25 倍字号，裁切层里的下划线与下行字母不被切掉', () => {
    const found = /line-height:\s*([\d.]+)\s*;/.exec(ruleBody('.dt-tag'))
    expect(Number(found?.[1] ?? Number.NaN)).toBeGreaterThanOrEqual(1.25)
  })
})
