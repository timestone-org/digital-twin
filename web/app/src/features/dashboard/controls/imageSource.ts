/**
 * @fileoverview 图片值的来源判别：是 CSS background 简写、可直接取回的 URL，还是没填。
 * 判别单独成函数是留给后续来源（素材库引用之类）的扩展位——多一种来源只加一条分支，
 * 控件的模板不用跟着改。
 */

/** 图片值的来源。 */
export type ImageSourceKind = 'empty' | 'css' | 'url'

// CSS background 简写的开头：url() / *-gradient() / var()
const CSS_VALUE_HEAD = /^(?:url\(|[a-z-]*gradient\(|var\()/i

/**
 * 这个值该按哪一种来源处理。
 * ⚠ CSS 值与 URL 必须分开：`<img src="var(--x)">` 只会得到一个碎图图标，
 * 看着像素材坏了，而其实是预览用错了画法。
 * @param value 配置里存的原始字符串
 */
export function imageSourceKind(value: string): ImageSourceKind {
  const text = value.trim()
  if (text === '') return 'empty'
  return CSS_VALUE_HEAD.test(text) ? 'css' : 'url'
}
