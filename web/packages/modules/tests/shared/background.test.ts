/**
 * @fileoverview 契约：配置里那一格「图」怎么变成 CSS `background`。
 * ⚠ 两条静默的坑由这里钉住——CSS 简写被当成地址会包成 `url("var(…)")`（必然 404，
 * 而背景层照样渲染，只是空的）；地址里的引号不剔掉会把整条声明从中间截断。
 */
import { describe, expect, it } from 'vitest'

import { bannerBackground, imageSourceKind } from '../../src/shared/background'

describe('来源判别', () => {
  it('空与纯空白都是没填', () => {
    expect(imageSourceKind('')).toBe('empty')
    expect(imageSourceKind('   ')).toBe('empty')
  })

  it('url / 渐变 / var 开头的按 CSS 值处理', () => {
    expect(imageSourceKind('url(/a.png)')).toBe('css')
    expect(imageSourceKind('linear-gradient(90deg, red, blue)')).toBe('css')
    expect(imageSourceKind('var(--fx-decor-topbg) center bottom')).toBe('css')
  })

  it('其余当作可直接取回的地址', () => {
    expect(imageSourceKind('/assets/a.png')).toBe('url')
    expect(imageSourceKind('https://x/a.png')).toBe('url')
  })
})

describe('整宽贴底的横幅铺法', () => {
  it('没填就给空串，调用方据此不渲染这一层', () => {
    expect(bannerBackground('  ')).toBe('')
  })

  it('CSS 简写原样透传，不再包一层', () => {
    const value = 'var(--fx-decor-topbg) center bottom / 100% 100% no-repeat'

    expect(bannerBackground(value)).toBe(value)
  })

  it('地址包成整宽贴底', () => {
    expect(bannerBackground('/a.png')).toBe(
      'url("/a.png") center bottom / 100% 100% no-repeat',
    )
  })

  it('地址里的引号 / 反斜杠 / 换行一律剔掉，免得截断声明', () => {
    expect(bannerBackground('a".png')).toContain('url("a.png")')
    expect(bannerBackground('a\n.png')).toContain('url("a.png")')
    expect(bannerBackground('a\\.png')).toContain('url("a.png")')
  })
})
