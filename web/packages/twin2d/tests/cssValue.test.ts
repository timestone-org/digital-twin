/**
 * @fileoverview 锁住 CSS 值消毒的判据与强调色兜底链：`url(` 的各种变形、`@import`、
 * 反斜杠、控制字符、超长必须被拒并回落缺省，`var()` / `color-mix()` / `calc()` 必须放行，
 * 兜底链是字符串拼接且恒以 `--accent-primary` 收底。漏一条就是外链请求或整条声明失效。
 */
import { describe, expect, it } from 'vitest'

import {
  CSS_VALUE_MAX_LEN,
  cssVarChain,
  isSafeCssValue,
  resolveAccent,
  sanitizeCssValue,
} from '../src/cssValue'

/** 判据里的长度上限 */
const MAX_LEN = 200

describe('CSS_VALUE_MAX_LEN', () => {
  it('长度上限就是 200，改它等于改判据', () => {
    expect(CSS_VALUE_MAX_LEN).toBe(MAX_LEN)
  })
})

describe('isSafeCssValue 拒的那些', () => {
  it('原样的 url( 被拒——它能把请求打到外部', () => {
    expect(isSafeCssValue('url(https://evil.example/x.png)')).toBe(false)
  })

  it('大写与括号前的空白挡不住判据', () => {
    expect(isSafeCssValue('URL (#x)')).toBe(false)
  })

  it('字母之间塞空白也当 url 拦下', () => {
    expect(isSafeCssValue('u r l ( #x )')).toBe(false)
  })

  it('字母之间塞控制字符同样被拒', () => {
    expect(isSafeCssValue('u\rl(#x)')).toBe(false)
  })

  it('@import 被拒', () => {
    expect(isSafeCssValue('@import "evil.css"')).toBe(false)
  })

  it('@ 与 import 之间的空白同样挡不住', () => {
    expect(isSafeCssValue('@ IMPORT "evil.css"')).toBe(false)
  })

  it('反斜杠被拒——转义能把判据绕过去', () => {
    expect(isSafeCssValue('u\\rl(#x)')).toBe(false)
  })

  it('控制字符区的首尾两端都被拒', () => {
    expect(isSafeCssValue('red\u0000')).toBe(false)
    expect(isSafeCssValue('red\u001f')).toBe(false)
  })

  it('DEL 也算控制字符', () => {
    expect(isSafeCssValue('red\u007f')).toBe(false)
  })

  it('超过 200 字符被拒', () => {
    expect(isSafeCssValue('a'.repeat(MAX_LEN + 1))).toBe(false)
  })
})

describe('isSafeCssValue 放的那些', () => {
  it('恰好 200 字符放行——上限是闭区间', () => {
    expect(isSafeCssValue('a'.repeat(MAX_LEN))).toBe(true)
  })

  it('var() 放行', () => {
    expect(isSafeCssValue('var(--accent-primary)')).toBe(true)
  })

  it('color-mix() 放行', () => {
    expect(
      isSafeCssValue('color-mix(in srgb, var(--t2-accent) 40%, transparent)'),
    ).toBe(true)
  })

  it('calc() 放行', () => {
    expect(isSafeCssValue('calc(100% - 12px)')).toBe(true)
  })

  it('普通颜色与多层渐变放行', () => {
    expect(isSafeCssValue('#62ff8a')).toBe(true)
    expect(isSafeCssValue('linear-gradient(150deg, #101820, #1b2a33)')).toBe(
      true,
    )
  })

  it('空串本身不是不安全的——空不空由 sanitizeCssValue 判', () => {
    expect(isSafeCssValue('')).toBe(true)
  })
})

describe('sanitizeCssValue', () => {
  it('合法值 trim 后原样返回', () => {
    expect(sanitizeCssValue('  #62ff8a  ', 'red')).toBe('#62ff8a')
  })

  it('非字符串回落缺省', () => {
    expect(sanitizeCssValue(42, 'red')).toBe('red')
    expect(sanitizeCssValue(null, 'red')).toBe('red')
  })

  it('空串与纯空白回落缺省', () => {
    expect(sanitizeCssValue('', 'red')).toBe('red')
    expect(sanitizeCssValue('   ', 'red')).toBe('red')
  })

  it('被判据拒掉的值回落缺省，而不是原样注入', () => {
    expect(sanitizeCssValue('url(https://evil.example/x.png)', 'red')).toBe(
      'red',
    )
  })
})

describe('cssVarChain', () => {
  it('三段拼成嵌套的 var 兜底链', () => {
    expect(cssVarChain('--a', '--b', '--c')).toBe(
      'var(--a, var(--b, var(--c)))',
    )
  })

  it('单段也带上 var() 包裹', () => {
    expect(cssVarChain('--a')).toBe('var(--a)')
  })

  it('一段都没有时是空串', () => {
    expect(cssVarChain()).toBe('')
  })

  it('空段与纯空白段直接跳过，不会拼出空的兜底位', () => {
    expect(cssVarChain('--a', '', '   ', '--c')).toBe('var(--a, var(--c))')
  })

  it('已经是单参 var() 引用的段会被补上兜底', () => {
    expect(cssVarChain('var(--a)', 'var(--accent-primary)')).toBe(
      'var(--a, var(--accent-primary))',
    )
  })

  it('自带兜底的 var() 视为字面值终点——它不会解析失败', () => {
    expect(cssVarChain('var(--a, red)', '--c')).toBe('var(--a, red)')
  })

  it('字面值段终止其后的尾链，但上层仍然嵌在它前面', () => {
    expect(cssVarChain('--a', '#62ff8a', '--c')).toBe('var(--a, #62ff8a)')
  })
})

describe('resolveAccent 三级兜底链', () => {
  it('节点 accent 在最前，样式 accent 在中间，语义 token 收底', () => {
    expect(resolveAccent('--t2-node', '--t2-style')).toBe(
      'var(--t2-node, var(--t2-style, var(--accent-primary)))',
    )
  })

  it('节点没配时链只剩样式与 token 两级', () => {
    expect(resolveAccent('', 'var(--t2-style)')).toBe(
      'var(--t2-style, var(--accent-primary))',
    )
  })

  it('两级都没配时是纯 token', () => {
    expect(resolveAccent('', '')).toBe('var(--accent-primary)')
  })

  it('被消毒拒掉的 accent 不进链，由下一级顶上', () => {
    expect(resolveAccent('url(https://evil.example/x.png)', '--t2-style')).toBe(
      'var(--t2-style, var(--accent-primary))',
    )
  })

  it('凡是 var 引用打头的，产出的串始终含 --accent-primary 收底', () => {
    const heads = ['', '--t2-node', 'var(--t2-node)', 'url(x)', '@import x']
    for (const head of heads) {
      expect(resolveAccent(head, 'var(--t2-style)')).toContain(
        '--accent-primary',
      )
      expect(resolveAccent(head, '')).toContain('--accent-primary')
    }
  })

  it('字面色打头时链在它那里结束——塞进 var() 头位会让整条声明非法', () => {
    expect(resolveAccent('#62ff8a', 'var(--t2-style)')).toBe('#62ff8a')
  })

  it('拼的是字符串，不读 token 取值——产出里原样留着变量名', () => {
    expect(resolveAccent('--t2-node', '')).toBe(
      'var(--t2-node, var(--accent-primary))',
    )
  })
})
