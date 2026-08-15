/**
 * @fileoverview 配置里填的那一格「图」怎么变成一条能用的 CSS `background` 值。
 * 用户可能填的是一整条 CSS 简写（渐变、`var(--fx-decor-topbg) …`），也可能只是一个
 * 图片地址；两者的画法完全不同，混着当一种处理必然有一种是坏的。
 */

// CSS background 简写的开头：url() / *-gradient() / var()
const CSS_VALUE_HEAD = /^(?:url\(|[a-z-]*gradient\(|var\()/i

/** 图片值的来源。 */
export type ImageSourceKind = 'empty' | 'css' | 'url'

/**
 * 这个值该按哪一种来源画。
 * ⚠ CSS 值与 URL 必须分开：`<img src="linear-gradient(…)">` 只会得到一个碎图图标，
 * 看着像素材坏了，其实是画法用错了。
 * @param value 配置里存的原始字符串
 */
export function imageSourceKind(value: string): ImageSourceKind {
  const text = value.trim()
  if (text === '') return 'empty'
  return CSS_VALUE_HEAD.test(text) ? 'css' : 'url'
}

/**
 * 铺满整宽、贴住底边的横幅铺法，页头底图用的就是它。
 * ⚠ 包 `url("…")` 前要剔掉引号 / 反斜杠 / 换行：留着的话用户填的地址会把这条声明
 * 从中间截断，结果是整层背景静默消失，而配置看上去完全正常。
 * @param value 配置里存的原始字符串；CSS 简写原样返回，地址包成整宽贴底
 */
export function bannerBackground(value: string): string {
  const text = value.trim()
  const kind = imageSourceKind(text)
  if (kind === 'empty') return ''
  if (kind === 'css') return text
  return `url("${text.replace(/["\\\r\n]/g, '')}") center bottom / 100% 100% no-repeat`
}
