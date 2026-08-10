/**
 * @fileoverview 锁住「同一枚标志的两份实现」：组件 AppLogo.vue 与 favicon 用的
 * public/logo.svg。
 * ⚠ 两边漂移完全静默——页面上换了标志、浏览器标签上还是旧的，没有任何报错。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// ⚠ 用 cwd 而不是 import.meta.url：happy-dom 环境下后者不是 file: URL
const WORKSPACE = process.cwd()

const COMPONENT = readFileSync(
  join(WORKSPACE, 'app/src/components/brand/AppLogo.vue'),
  'utf8',
)
const STATIC_FILE = readFileSync(join(WORKSPACE, 'app/public/logo.svg'), 'utf8')
const INDEX_HTML = readFileSync(join(WORKSPACE, 'app/index.html'), 'utf8')

/** 取出全部 path 的 `d`，顺序即绘制顺序。 */
function pathData(source: string): string[] {
  return [...source.matchAll(/\sd="([^"]+)"/g)].map((match) => match[1] ?? '')
}

/** 取出全部 circle 的几何，忽略着色。 */
function circleGeometry(source: string): string[] {
  return [...source.matchAll(/<circle\b([^>]*)>/g)].map((match) => {
    const attrs = match[1] ?? ''
    return ['cx', 'cy', 'r']
      .map((name) => new RegExp(`${name}="([^"]+)"`).exec(attrs)?.[1] ?? '')
      .join(',')
  })
}

describe('标志的两份实现', () => {
  it('路径几何逐条一致', () => {
    expect(pathData(COMPONENT)).toEqual(pathData(STATIC_FILE))
    expect(pathData(COMPONENT).length).toBeGreaterThan(8)
  })

  it('顶点圆几何逐个一致', () => {
    expect(circleGeometry(COMPONENT)).toEqual(circleGeometry(STATIC_FILE))
    expect(circleGeometry(COMPONENT).length).toBeGreaterThan(4)
  })

  it('组件只用语义 token，不写死色值——否则换肤时它是第一个出问题的', () => {
    expect(COMPONENT).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(COMPONENT).toContain('var(--accent-primary)')
  })

  it('静态件必须自带取值：浏览器渲染 favicon 时读不到页面的 CSS 变量', () => {
    expect(STATIC_FILE).not.toContain('var(--')
  })

  it('index.html 挂着这枚 favicon', () => {
    expect(INDEX_HTML).toContain('href="/logo.svg"')
  })
})
