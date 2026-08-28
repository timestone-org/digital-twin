/**
 * @fileoverview 契约：`ModuleStatusOverlay.vue` 里三条「写错了也全绿」的画法约束。
 *
 * ⚠ 角标是浮在模块内容之上的一层，而挂载测试看不出这一层的定位与命中行为——
 * scoped 样式在用例里根本不注入，`getComputedStyle` 永远读不到它们。少一条
 * `position: absolute` 角标就会把模块的内容顶下去，少一条 `pointer-events: none`
 * 它就会吃掉整块可点模块的点击，两种表现都不报错。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 刻意不用 new URL('字面量', import.meta.url)：Vite 会把它静态改写成资源 URL
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(
  path.resolve(HERE, '../src/ModuleStatusOverlay.vue'),
  'utf-8',
)

/**
 * 取一条顶层规则的声明块，注释剥掉——讲这条声明为什么这么写的注释里
 * 正好也有那个词，不剥就会拿注释当声明。
 * @param selector 规则的选择器
 */
function ruleBody(selector: string): string {
  const at = SOURCE.indexOf(`${selector} {`)
  expect(at, `样式里找不到 ${selector}`).toBeGreaterThan(-1)
  const open = SOURCE.indexOf('{', at)
  return SOURCE.slice(open, SOURCE.indexOf('\n}', open)).replace(
    /^\s*\/\/.*$/gm,
    '',
  )
}

describe('扫描器确实读到了源码', () => {
  it('扫空会让下面每条断言假绿', () => {
    expect(SOURCE).toContain('.dt-module-status--badge')
  })
})

describe('角标不许挡住模块自己的内容', () => {
  it('基类给了绝对定位与不吃指针，角标与薄纱都继承这两条', () => {
    const base = ruleBody('.dt-module-status')

    expect(base).toContain('position: absolute')
    expect(base).toContain('pointer-events: none')
  })

  it('薄纱铺满整格，同样不吃指针', () => {
    const veil = ruleBody('.dt-module-status__veil')

    expect(veil).toContain('position: absolute')
    expect(veil).toContain('inset: 0')
    expect(veil).toContain('pointer-events: none')
  })

  it('角标钉在右上角，且不许铺满整格', () => {
    const badge = ruleBody('.dt-module-status--badge')

    expect(badge).toMatch(/\btop:/)
    expect(badge).toMatch(/\bright:/)
    expect(badge).not.toContain('inset: 0')
  })

  it('角标走 --state-warning，不写死颜色', () => {
    const badge = ruleBody('.dt-module-status--badge')

    expect(badge).toContain('var(--state-warning)')
  })
})
