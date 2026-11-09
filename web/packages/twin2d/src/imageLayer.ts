/**
 * @fileoverview 底图一层的 `url()` 取值：画布底图与盒图元的图片填充共用这一份。
 * 口径见 docs/MODULE_TWIN_2D_DESIGN.md §11.4。
 */
import type { Twin2dBackgroundFit } from './kinds'
import type { Twin2dIconResolver } from './paintText'

/** 素材引用前缀 */
const ASSET_PREFIX = 'asset:'
/** 会把 `url()` 提前闭合的字符 */
const URL_UNSAFE_RE = /["'()\\\s]/
/** 图片地址允许的前缀 */
const IMAGE_PREFIXES = ['https://', 'http://', 'data:', '/'] as const

/** 底图铺法四档的「位置 / 尺寸 平铺」 */
const IMAGE_FIT: Readonly<Record<Twin2dBackgroundFit, string>> = Object.freeze({
  cover: 'center center / cover no-repeat',
  contain: 'center center / contain no-repeat',
  stretch: 'center center / 100% 100% no-repeat',
  tile: 'left top / auto repeat',
})

/**
 * 这一串是不是图片：素材引用或白名单前缀的地址。
 * @param raw 配置里写的那一串
 */
export function isTwin2dImageRef(raw: string): boolean {
  return (
    raw.startsWith(ASSET_PREFIX) ||
    IMAGE_PREFIXES.some((prefix) => raw.startsWith(prefix))
  )
}

/**
 * 一层图片底图；画不出来给 null，由调用方整层丢弃。
 * ⚠ 素材引用解析不出来（没注入解析槽）时整层不画，不发一条必 404 的请求。
 * ⚠ 引号、括号与空白一律拒，它们能把 `url()` 提前闭合。
 * @param raw 素材引用或图片地址（先过 `isTwin2dImageRef`）
 * @param fit 铺法
 * @param resolveImage 素材解析槽
 */
export function twin2dImageLayer(
  raw: string,
  fit: Twin2dBackgroundFit,
  resolveImage: Twin2dIconResolver,
): string | null {
  const ref = raw.startsWith(ASSET_PREFIX) ? resolveImage(raw) : raw
  if (ref === '' || URL_UNSAFE_RE.test(ref)) return null
  if (!IMAGE_PREFIXES.some((prefix) => ref.startsWith(prefix))) return null
  return `url("${ref}") ${IMAGE_FIT[fit]}`
}
