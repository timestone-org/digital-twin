/**
 * @fileoverview 素材引用摊平的契约：`asset:<uuid>` 要在进画法之前换成地址。
 * ⚠ 漏摊的表现全是静默的：`<img src="asset:…">` 得到一个碎图图标、
 * `url("asset:…")` 让整层背景消失，两者看着都像素材坏了。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  __resetAssetImages,
  configureAssetImages,
  isAssetRef,
  resolveImageValue,
} from '../../src/shared/assetImage'
import { bannerBackground } from '../../src/shared/background'

const ID = '018f3a2b-4c5d-7e8f-9a0b-1c2d3e4f5a6b'
const REF = `asset:${ID}`

afterEach(() => {
  __resetAssetImages()
})

describe('引用判别', () => {
  it('只认 asset: 开头，前后空白不算数', () => {
    expect(isAssetRef(REF)).toBe(true)
    expect(isAssetRef(`  ${REF}  `)).toBe(true)
    expect(isAssetRef('https://example.com/a.png')).toBe(false)
    expect(isAssetRef('linear-gradient(#000, #fff)')).toBe(false)
    expect(isAssetRef('')).toBe(false)
  })
})

describe('摊平', () => {
  it('装了解析器就换成地址', () => {
    configureAssetImages((ref) => `/oss/images/${ref.slice('asset:'.length)}`)

    expect(resolveImageValue(REF)).toBe(`/oss/images/${ID}`)
  })

  it('URL 与 CSS 值原样过，绝不进解析器', () => {
    configureAssetImages(() => '/oss/never')

    expect(resolveImageValue('https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    )
    expect(resolveImageValue('linear-gradient(#000, #fff)')).toBe(
      'linear-gradient(#000, #fff)',
    )
    expect(resolveImageValue('')).toBe('')
  })

  // 没装解析器时给空串：拿一个必然 404 的地址去画，界面上看不出是「没装」还是「图坏了」
  it('没装解析器时给空串，不把 asset: 原样漏出去', () => {
    expect(resolveImageValue(REF)).toBe('')
  })

  it('解析器返回空串（素材已删）时也给空串', () => {
    configureAssetImages(() => '')

    expect(resolveImageValue(REF)).toBe('')
  })
})

describe('横幅铺法', () => {
  it('素材引用先摊成地址再包成整宽贴底', () => {
    configureAssetImages(() => `/oss/images/${ID}`)

    expect(bannerBackground(REF)).toBe(
      `url("/oss/images/${ID}") center bottom / 100% 100% no-repeat`,
    )
  })

  // 漏摊的话包出来的是 url("asset:…")，整层背景静默消失而配置看着完全正常
  it('摊不出地址时按没填处理，不包出一条必坏的 url()', () => {
    expect(bannerBackground(REF)).toBe('')
  })
})
