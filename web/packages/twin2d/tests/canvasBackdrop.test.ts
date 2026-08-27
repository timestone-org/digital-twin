/**
 * @fileoverview 画布底两层的求值：底图四档铺法、素材引用经解析槽落进 `url()`、消毒挡
 * 掉自己写的 `url()`，以及三档图案的取值。
 *
 * ⚠ 这一份是运行态舞台与编辑画布**共用**的那一份：谁再算一份，表现是底图偏一点、
 * 图案疏一格，而两边单看都对。这个文件是那份共用口径的锁。
 * ⚠ 素材解析不出来时整层不画，**不能**顺着落到 CSS 简写那一档：`asset:7f3a` 本身是
 * 一个「安全」的 CSS 值，注进去只会得到一条谁也解释不了的声明。
 */
import { describe, expect, it } from 'vitest'

import { canvasBackdropStyles } from '../src/canvasBackdrop'
import { normalizeCanvas } from '../src/normalize'
import type { Twin2dCanvas } from '../src/types'

/** 素材引用 → 地址那条槽的形状；两份假件都按它写。 */
type Resolve = (assetRef: string) => string

/** 解析不出任何素材的那一份，等同于「没注入」。 */
const NO_ASSETS: Resolve = () => ''

/** 素材引用 → 部署前缀下的地址。 */
const OSS: Resolve = (ref) => `/oss/${ref}`

function canvasOf(patch: Record<string, unknown>): Twin2dCanvas {
  return normalizeCanvas({ width: 400, height: 200, ...patch })
}

/** 底图那一层的取值；不画时给空串。 */
function backgroundOf(
  patch: Record<string, unknown>,
  resolve: Resolve = NO_ASSETS,
): string {
  return (
    canvasBackdropStyles(canvasOf(patch), resolve).background['--t2-bg'] ?? ''
  )
}

/** 图案那一层的取值；不画时给空串。 */
function patternOf(patch: Record<string, unknown>): string {
  return (
    canvasBackdropStyles(canvasOf(patch), NO_ASSETS).pattern['--t2-pattern'] ??
    ''
  )
}

describe('底图', () => {
  it('留空时一条声明都不产', () => {
    expect(canvasBackdropStyles(canvasOf({}), NO_ASSETS).background).toEqual({})
  })

  it('素材引用经解析槽落进 url() 并带上铺法', () => {
    const value = backgroundOf(
      { background: 'asset:7f3a', backgroundFit: 'contain' },
      OSS,
    )

    expect(value).toBe(
      'url("/oss/asset:7f3a") center center / contain no-repeat',
    )
  })

  it('四档铺法各出各的', () => {
    const fits = ['cover', 'contain', 'stretch', 'tile']

    const values = fits.map((backgroundFit) =>
      backgroundOf({ background: '/pic.png', backgroundFit }),
    )

    expect(values).toEqual([
      'url("/pic.png") center center / cover no-repeat',
      'url("/pic.png") center center / contain no-repeat',
      'url("/pic.png") center center / 100% 100% no-repeat',
      'url("/pic.png") left top / auto repeat',
    ])
  })

  it('http 与 data 两种地址一样当图片用', () => {
    expect(backgroundOf({ background: 'https://cdn.example/a.png' })).toContain(
      'url("https://cdn.example/a.png")',
    )
    expect(backgroundOf({ background: 'data:image/png;base64,AA' })).toContain(
      'url("data:image/png;base64,AA")',
    )
  })

  // ⚠ 解析不出来时整层不画，不发一个必 404 的请求，也不把 `asset:…` 原样注进 CSS
  it('解析不出的素材引用一层都不画', () => {
    expect(backgroundOf({ background: 'asset:7f3a' })).toBe('')
  })

  it('CSS background 简写原样用', () => {
    const value = backgroundOf({
      background: 'linear-gradient(180deg, #04121f, #071a2c)',
    })

    expect(value).toBe('linear-gradient(180deg, #04121f, #071a2c)')
  })

  // 引号、括号与空白能把 url() 提前闭合
  it('自己写的 url() 与带引号的地址都被挡掉', () => {
    expect(
      backgroundOf({ background: 'url(https://evil.example/x.png)' }),
    ).toBe('')
    expect(backgroundOf({ background: '/a b.png' })).toBe('')
    expect(backgroundOf({ background: 'asset:x' }, () => '/oss/a").png')).toBe(
      '',
    )
  })
})

describe('图案底', () => {
  it('none 一档一条声明都不产', () => {
    expect(canvasBackdropStyles(canvasOf({}), NO_ASSETS).pattern).toEqual({})
  })

  it('斜织是两层角度对称的等距斜线', () => {
    const value = patternOf({
      pattern: 'weave',
      patternGap: 26,
      patternWidth: 1,
      patternColor: 'var(--border-default)',
    })

    expect(value).toBe(
      'repeating-linear-gradient(45deg, transparent 0 26px, var(--border-default) 26px 27px), ' +
        'repeating-linear-gradient(-45deg, transparent 0 26px, var(--border-default) 26px 27px)',
    )
  })

  it('平行线只出一层', () => {
    const value = patternOf({ pattern: 'lines', patternGap: 20 })

    expect(value).toContain('repeating-linear-gradient(0deg')
    expect(value).not.toContain('-45deg')
  })

  it('点阵靠 background-size 按格铺', () => {
    const style = canvasBackdropStyles(
      canvasOf({ pattern: 'dots', patternGap: 18, patternWidth: 2 }),
      NO_ASSETS,
    ).pattern

    expect(style['--t2-pattern']).toContain('radial-gradient(circle at 50% 50%')
    expect(style['background-size']).toBe('18px 18px')
  })

  // 图案色留空时走兜底表达式：参考项目那三个变量全仓无定义，实际生效的就是兜底
  it('没给图案色时用兜底表达式', () => {
    expect(patternOf({ pattern: 'lines' })).toContain(
      'color-mix(in srgb, var(--accent-primary) 5%, transparent)',
    )
  })

  it('图案色带括号时按脏值落回兜底', () => {
    expect(patternOf({ pattern: 'lines', patternColor: 'url(x)' })).toContain(
      'var(--accent-primary)',
    )
  })
})
