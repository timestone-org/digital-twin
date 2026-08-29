/**
 * @fileoverview 配置里填的那一格「图」怎么变成一条能用的 CSS `background` 值。
 * 用户可能填的是一整条 CSS 简写（渐变、`var(--fx-decor-topbg) …`），也可能只是一个
 * 图片地址或一条素材引用；三者的画法完全不同，混着当一种处理必然有一种是坏的。
 */
import { resolveImageValue } from './assetImage'

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
 * @param value 配置里存的原始字符串；CSS 简写原样返回，地址与素材引用包成整宽贴底
 */
export function bannerBackground(value: string): string {
  // 素材引用先摊成地址：漏进下面那条 url("…") 的话包出来的是 url("asset:…")，
  // 整层背景静默消失，而配置看上去完全正常
  const text = resolveImageValue(value).trim()
  const kind = imageSourceKind(text)
  if (kind === 'empty') return ''
  if (kind === 'css') return text
  return `url("${text.replace(/["\\\r\n]/g, '')}") center bottom / 100% 100% no-repeat`
}

/** 一层背景图，摊成能直接写进 style 的几个键。缺图时 `image` 是空串。 */
export interface BackgroundLayer {
  /** `background-image` 的值。 */
  image: string
  /**
   * `background-size`；空串 = 不写这条，用浏览器默认。
   * ⚠ 只有素材引用与图片地址那条路才给尺寸与不平铺：CSS 值那条路上，用户写的
   * `repeating-linear-gradient(…)` 或小图平铺靠的正是默认的 `repeat`，
   * 替他钉成 `no-repeat` 就把存量大屏里的底纹改成了一张孤零零的图。
   */
  size: string
  /** `background-position`；空串 = 不写这条。 */
  position: string
  /** `background-repeat`；空串 = 不写这条。 */
  repeat: string
}

/** 没有图的那一层。 */
const NO_LAYER: BackgroundLayer = Object.freeze({
  image: '',
  size: '',
  position: '',
  repeat: '',
})

/**
 * 盖满整块的铺法：素材引用与图片地址包成 `url(…)` 并按 cover 居中不平铺，
 * CSS 值原样返回、铺法留空。通用容器这类方块用它（页头页脚的整宽贴底用
 * `bannerBackground`）。
 * @param value 配置里存的原始字符串
 */
export function coverBackground(value: string): BackgroundLayer {
  // 素材引用先摊成地址，漏进下面那条 url("…") 的话包出来的是 url("asset:…")
  const text = resolveImageValue(value).trim()
  const kind = imageSourceKind(text)
  if (kind === 'empty') return NO_LAYER
  if (kind === 'css') return { ...NO_LAYER, image: text }
  return {
    // 引号 / 反斜杠 / 换行会把这条声明从中间截断，整层背景随即静默消失
    image: `url("${text.replace(/["\\\r\n]/g, '')}")`,
    size: 'cover',
    position: 'center',
    repeat: 'no-repeat',
  }
}
