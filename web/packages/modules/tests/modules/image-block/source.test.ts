/**
 * @fileoverview 守图片来源的判别：CSS 值与 URL 分开，判错了画法就错——
 * 把渐变塞进 `<img src>` 得到的是一个碎图图标，看着像素材坏了。
 */
import { describe, expect, it } from 'vitest'

import { imageSourceKind } from '../../../src/modules/image-block/source'

describe('图片来源的判别', () => {
  it('没填与一串空白都算没填', () => {
    expect(imageSourceKind('')).toBe('empty')
    expect(imageSourceKind('   ')).toBe('empty')
  })

  it('渐变、url() 与 var() 都按 CSS 值画', () => {
    expect(imageSourceKind('linear-gradient(#000, #fff)')).toBe('css')
    expect(imageSourceKind('radial-gradient(#000, #fff)')).toBe('css')
    expect(imageSourceKind('url(/logo.png)')).toBe('css')
    expect(imageSourceKind('var(--brand-logo)')).toBe('css')
  })

  it('大小写不影响判别', () => {
    expect(imageSourceKind('URL(/logo.png)')).toBe('css')
  })

  it('地址与相对路径按 URL 画', () => {
    expect(imageSourceKind('https://example.com/a.png')).toBe('url')
    expect(imageSourceKind('/logo.png')).toBe('url')
    expect(imageSourceKind('pic/logo.png')).toBe('url')
    expect(imageSourceKind('data:image/png;base64,AAAA')).toBe('url')
  })

  it('前后空白不影响判别', () => {
    expect(imageSourceKind('  /logo.png  ')).toBe('url')
  })
})
