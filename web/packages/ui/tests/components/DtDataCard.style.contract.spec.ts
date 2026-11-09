/**
 * @fileoverview DtDataView 卡片抬头的排版契约：长名称在抬头里截断，操作按钮
 * 留在标题行上，不被挤到下一行。
 * ⚠ DtCard 的抬头是允许换行的 flex 行，抬头区不吃满剩余宽度、又按内容定宽时，
 * 一条长名称就把整组操作顶到名称下面；happy-dom 不排版，故编译样式检查声明。
 */
import { join } from 'node:path'
import { compile } from 'sass-embedded'
import { describe, expect, it } from 'vitest'

const SHEET = join(
  process.cwd(),
  'packages',
  'ui',
  'src',
  'components',
  'DtDataView',
  '_data-card.scss',
)

const css = compile(SHEET).css

/** 取一条选择器的声明块；没有这条规则时返回空串。 */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  return css.slice(open + 1, css.indexOf('}', open))
}

describe('DtDataCard 抬头', () => {
  it('抬头区吃满操作按钮以外的宽度，且允许收窄到 0', () => {
    const body = ruleBody('.dt-data-view__card-head')
    expect(body).toMatch(/flex:\s*1 1 0/)
    expect(body).toMatch(/min-width:\s*0/)
  })

  it('名称行里不换行的内容就地裁掉，不压到右侧操作上', () => {
    const body = ruleBody('.dt-data-view__card-title')
    expect(body).toMatch(/overflow:\s*hidden/)
  })

  it('名称行四周给焦点环留出 4px，裁切不切掉链接与按钮的焦点环', () => {
    const body = ruleBody('.dt-data-view__card-title')
    expect(body).toMatch(/margin:\s*-4px/)
    expect(body).toMatch(/padding:\s*4px/)
  })

  it('副行装不下时截成省略号，而不是撑宽抬头', () => {
    const body = ruleBody('.dt-data-view__card-meta')
    expect(body).toMatch(/white-space:\s*nowrap/)
    expect(body).toMatch(/overflow:\s*hidden/)
    expect(body).toMatch(/text-overflow:\s*ellipsis/)
  })
})
