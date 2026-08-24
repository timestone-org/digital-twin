/**
 * @fileoverview 契约：`styles/chrome.scss` 里几条「写错了也全绿」的画法约束。
 *
 * ⚠ 这条闸补的洞是 chrome 这一层特有的：变量照常注入、类名照常挂上、单测与 typecheck
 * 全绿，但那一笔在屏幕上根本不出现——`overflow: hidden` 把它裁没了，或半透明底色让
 * 底下那层整片透了上来。表现全都是「面板上调了没有任何变化」，没有任何一处报错。
 *
 * 真实案例：四角角标的偏移只要为负，大屏一格的 `overflow: hidden` 就会把角标连同辉光
 * 整个裁到框外，用户看见的只有一团糊在角上的光——「角标形状 / 尺寸 / 透明度」三个旋钮
 * 怎么调都没反应。
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

/** 同一个选择器可能既出现在成组归零的规则里、又有自己那条规则，故取全部。 */
function ruleBodies(selector: string): string[] {
  const bodies: string[] = []
  for (let at = STYLES.indexOf(selector); at > -1;) {
    const open = STYLES.indexOf('{', at)
    bodies.push(STYLES.slice(open, STYLES.indexOf('\n  }', open)))
    at = STYLES.indexOf(selector, at + selector.length)
  }
  expect(bodies.length, `chrome.scss 里找不到 ${selector}`).toBeGreaterThan(0)
  return bodies
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

describe('四角角标：缺省档是一圈方形辉光', () => {
  it('辉光挂 box-shadow 而不是 drop-shadow', () => {
    const body = ruleBody('.dt-corners > .dt-corner-b::after {')

    // 投影的形状取自盒子轮廓，缺省档那一圈方形柔光正是这么来的；drop-shadow 取的是
    // 渲染后的 alpha，而缺省档一笔不画 —— 换过去四角会整个消失
    expect(STYLES).toContain(
      'box-shadow: 0 0 var(--card-corner-glow, 5px) var(--card-corner-color)',
    )
    expect(body).not.toContain('drop-shadow')
  })

  it('基类一笔不描，硬描边只属于另外两档', () => {
    const body = ruleBody('.dt-corners > .dt-corner-b::after {')

    // 基类描了边，缺省档就成了硬边小方框，与参考项目的柔光观感差一大截
    expect(body).toContain('border: 0 solid var(--card-corner-color)')
  })

  it.each([
    ['.dt-corners--bracket::before {', ['top', 'left']],
    ['.dt-corners--bracket::after {', ['top', 'right']],
    ['.dt-corners--bracket > .dt-corner-b::before {', ['bottom', 'left']],
    ['.dt-corners--bracket > .dt-corner-b::after {', ['bottom', 'right']],
  ])('L 形档 %s 描的是朝外的那两条边', (selector, sides) => {
    const drawn = ruleBodies(selector).some((body) =>
      sides.every((side) => body.includes(`border-${side}-width: 1px`)),
    )

    expect(drawn).toBe(true)
  })

  it('小方点档靠底色填实，不靠四边各描 1px', () => {
    const body = ruleBody('.dt-corners--dot > .dt-corner-b::after {')

    // 描边法只在 4px 这一档看着像实心，尺寸一调大就露出中间的空心
    expect(body).toContain('background: var(--card-corner-color)')
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
