/**
 * @fileoverview twin2d.scss 引用的每个 `--t2-*` 都要有人注入，paint* 注入的每个也要有
 * 人消费；paint* 挂的每个类名在 scss 里都要有规则。两份清单都从文件里正则提取，不手抄。
 *
 * ⚠ 守的是一个零提示的洞：CSS 里 `var(--拼错的名字)` 解析不到就整条声明静默报废，
 * 类名对不上则那条规则永远不匹配——typecheck、eslint、全部单测一律放行，
 * 表现只有「配了不生效」四个字，而且要人眼盯着那一处才看得见。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ⚠ vitest 的 cwd 就是 web/，不要再往上退一层
const WEB_ROOT = process.cwd()
const PKG = join(WEB_ROOT, 'packages', 'twin2d', 'src')
const SCSS = join(PKG, 'render', 'twin2d.scss')
const PAINT_COMMON = join(PKG, 'paintCommon.ts')
const PAINT_TEXT = join(PKG, 'paintText.ts')

/**
 * scss 里注入 `--t2-*` 的那几处不在 paint* 一族里，逐个记下责任文件。
 * ⚠ 值是文件路径而不是一句说明：文件落地后这条契约会去读它，真的确认名字对得上；
 * 只写说明的清单会烂在这里，而烂掉的那天正是名字对不上的那天。
 */
const RENDER_INJECTED: Readonly<Record<string, string>> = Object.freeze({
  // dashoffset 终点 = dash 数组求和取负，只有连线层算得出（§7 #67）
  '--t2-dash-end': join(PKG, 'render', 'Twin2dEdgeLayer.vue'),
  // 画布底两层：舞台与编辑画布共用同一份求值，规则在 scss 里只有一处
  '--t2-bg': join(PKG, 'canvasBackdrop.ts'),
  '--t2-pattern': join(PKG, 'canvasBackdrop.ts'),
})

/**
 * 注入了但 scss 不消费的：它们进的是预置样式里的内联取值（边框色、渐变两端、
 * 状态点底色、角标底色），而颜色在本模型里是文档数据不是样式代码（§11.1）。
 */
const INLINE_ONLY: readonly string[] = [
  '--t2-accent',
  '--t2-badge',
  '--t2-fill-a',
  '--t2-fill-b',
  '--t2-status',
]

const VAR_USAGE = /var\(\s*(--t2-[a-z0-9-]+)/g
const VAR_INJECTION = /['"](--t2-[a-z0-9-]+)['"]/g
const CLASS_LITERAL = /['"](t2-[a-z0-9-]+)['"]/g
const RULE_SELECTOR = /\.(t2-[a-z0-9-]+)/g

/**
 * 先剥注释再扫。
 * ⚠ 不剥的话，文件头里解释这些变量与类名的那几行会被当成真正的注入点与用法，
 * 于是拼错反而被自己的注释兜住，这条契约就成了摆设。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/**
 * 按正则把捕获组第一组收成集合。
 * @param source 已剥注释的源码
 * @param pattern 带一个捕获组的全局正则
 */
function collect(source: string, pattern: RegExp): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    if (name !== undefined) found.add(name)
  }
  return found
}

function readStripped(path: string): string {
  return stripComments(readFileSync(path, 'utf8'))
}

const scss = readStripped(SCSS)
const scssVars = collect(scss, VAR_USAGE)
const scssSelectors = collect(scss, RULE_SELECTOR)
const injectedVars = collect(readStripped(PAINT_COMMON), VAR_INJECTION)

describe('twin2d.scss 与 paint* 的 CSS 变量契约', () => {
  it('scss 引用的每个 --t2-* 都有注入点，没有解析不到的名字', () => {
    const known = new Set([...injectedVars, ...Object.keys(RENDER_INJECTED)])
    const unresolved = [...scssVars].filter((name) => !known.has(name))
    expect(unresolved).toEqual([])
  })

  it('scss 至少真的用到了 --t2-anim-dur，否则四档动画的时长全落空', () => {
    expect(scssVars.has('--t2-anim-dur')).toBe(true)
  })

  it('paint* 注入的每个 --t2-* 都有人消费', () => {
    const consumed = new Set([...scssVars, ...INLINE_ONLY])
    const orphans = [...injectedVars].filter((name) => !consumed.has(name))
    expect(orphans).toEqual([])
  })

  it('留给内联消费的那几个确实还在被注入，没有改过名', () => {
    const stale = INLINE_ONLY.filter((name) => !injectedVars.has(name))
    expect(stale).toEqual([])
  })

  it('留给内联消费的那几个没有偷偷被 scss 用上', () => {
    // 用上了就该从清单里删掉，否则这条豁免会一直挡着上一条的检查
    const overlap = INLINE_ONLY.filter((name) => scssVars.has(name))
    expect(overlap).toEqual([])
  })

  it('渲染件负责注入的那几个，落地之后名字要对得上', () => {
    for (const [name, owner] of Object.entries(RENDER_INJECTED)) {
      expect(scssVars.has(name)).toBe(true)
      // ⚠ 渲染件与本文件同一轮落地，缺席时这一条按「还没写」跳过；
      //   文件一出现就变成真断言，名字对不上当场红
      if (!existsSync(owner)) continue
      expect(collect(readStripped(owner), VAR_INJECTION).has(name)).toBe(true)
    }
  })
})

describe('twin2d.scss 与 paint* 的类名契约', () => {
  it('paintCommon 挂的四档动画类在 scss 里都有规则', () => {
    const anim = [...collect(readStripped(PAINT_COMMON), CLASS_LITERAL)].filter(
      (name) => name.startsWith('t2-anim-'),
    )
    expect(anim).toHaveLength(4)
    expect(anim.filter((name) => !scssSelectors.has(name))).toEqual([])
  })

  it('paintText 挂的等宽数字类在 scss 里有规则', () => {
    const classes = collect(readStripped(PAINT_TEXT), CLASS_LITERAL)
    expect(classes.has('t2-digit')).toBe(true)
    expect(scssSelectors.has('t2-digit')).toBe(true)
  })
})
