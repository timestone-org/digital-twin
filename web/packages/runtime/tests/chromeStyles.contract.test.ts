/**
 * @fileoverview 契约：`styles/chrome.scss` 里几条「写错了也全绿」的画法约束。
 *
 * ⚠ 这条闸补的洞是 chrome 这一层特有的：变量照常注入、类名照常挂上、单测与 typecheck
 * 全绿，但那一笔在屏幕上根本不出现——`overflow: hidden` 把它裁没了，或半透明底色让
 * 底下那层整片透了上来。表现全都是「面板上调了没有任何变化」，没有任何一处报错。
 *
 * 真实案例：四角角标的偏移兜底是 -1px（照搬自 `@dt/ui` 的 DtCard，那只盒子不裁剪），
 * 而大屏一格是 `overflow: hidden`，于是 L 形的两条笔画连同辉光整个被裁到框外，
 * 用户看见的只有一团糊在角上的光——「角标形状 / 尺寸 / 透明度」三个旋钮怎么调都没反应。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 刻意不用 new URL('字面量', import.meta.url)：Vite 会把它静态改写成资源 URL
const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLES = readFileSync(
  path.resolve(HERE, '../src/styles/chrome.scss'),
  'utf-8',
)

/**
 * 取一条规则的声明块，用于只在这一档里断言。
 * ⚠ 注释要剥掉：本文件的断言找的是「有没有写这条声明」，而讲这条声明为什么这么写的
 * 注释里正好也有那个词，不剥就会拿注释当声明。
 */
function ruleBody(selector: string): string {
  const at = STYLES.indexOf(selector)
  expect(at, `chrome.scss 里找不到 ${selector}`).toBeGreaterThan(-1)
  const open = STYLES.indexOf('{', at)
  return STYLES.slice(open, STYLES.indexOf('\n  }', open)).replace(
    /^\s*\/\/.*$/gm,
    '',
  )
}

describe('扫描器确实读到了源码', () => {
  it('扫空会让下面每条断言假绿', () => {
    expect(STYLES).toContain('.dt-corners::before')
  })
})

describe('四角角标：负偏移等于不画', () => {
  it('定位一律走夹过的 --dt-corner-off，不直接读原始偏移', () => {
    const positioned = STYLES.match(
      /^\s*(?:top|left|right|bottom):\s*var\(--card-corner-off/gm,
    )
    expect(
      positioned,
      '角标定位直接读了 --card-corner-off：负值会被 overflow:hidden 整个裁掉',
    ).toBeNull()
  })

  it('--dt-corner-off 夹在 0 及以上', () => {
    expect(STYLES).toContain('--dt-corner-off: max(0px, var(--card-corner-off')
  })

  it('没有任何负数的角标偏移兜底', () => {
    expect(STYLES.match(/var\(--card-corner-off,\s*-/g)).toBeNull()
  })
})

describe('四角角标：辉光要贴着形状走', () => {
  it('辉光挂 drop-shadow 而不是 box-shadow', () => {
    const body = ruleBody('.dt-corners > .dt-corner-b::after {')
    expect(STYLES).toContain('filter: drop-shadow(')
    // 角标只描了 10×10 盒子的两条边，box-shadow 描的却是整只盒子的方形轮廓
    expect(body).not.toContain('box-shadow')
  })
})

describe('切角边框：半透明底色下的渐变描边', () => {
  it('不用 border-box 背景层描边', () => {
    // 卡片底色是半透明的，垫在下面的 border-box 层会整片透上来糊满整张卡
    expect(STYLES.match(/\)\s*\n?\s*border-box/g)).toBeNull()
  })
})

describe('角括号：四角只画一遍', () => {
  it('这一档关掉 .dt-corners 的小角标', () => {
    const body = ruleBody('.dt-module__border.dt-card-border--bracket {')
    expect(body).toContain('--card-corner-display: none')
  })

  it('括号长度接角标尺寸旋钮', () => {
    const body = ruleBody('.dt-module__border.dt-card-border--bracket {')
    expect(body).toContain('--dt-bracket-len: var(--card-corner-size')
  })
})
