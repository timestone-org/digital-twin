/**
 * @fileoverview 素材引用 `asset:<uuid>` → 可取回的图片地址的注入槽。
 *
 * ⚠ 本包不认识部署前缀（`/oss/`），真源由应用壳在启动期注入；没注入时一律给空串，
 * 界面上要看得见「取不到」，而不是拿一个必然 404 的地址去画。
 * ⚠ 配置里落的是引用不是 URL：换一次部署 / 换一个桶，存量配置里那条链接就 404，
 * 而没有任何一处会报错，表现只是那张屏上的图不见了（ADR-0020）。
 */
import { ASSET_REF_PREFIX } from '@dt/contracts'

/** 素材引用 → 可取回的地址；解析不出给空串。 */
export type ResolveAssetImage = (assetRef: string) => string

const NOT_CONFIGURED: ResolveAssetImage = () => ''

let resolver: ResolveAssetImage = NOT_CONFIGURED

/**
 * 装上真实的地址解析，通常是应用壳里那条拼 `ASSET_BASE_URL` 的函数。
 * @param impl 引用 → 地址
 */
export function configureAssetImages(impl: ResolveAssetImage): void {
  resolver = impl
}

/** 摘掉解析器，退回空串。⚠ 只给测试与组件展示用，生产路径调它等于把素材图全断掉。 */
export function __resetAssetImages(): void {
  resolver = NOT_CONFIGURED
}

/**
 * 这一格填的是不是素材引用。
 * @param value 配置里存的原始字符串
 */
export function isAssetRef(value: string): boolean {
  return value.trim().startsWith(ASSET_REF_PREFIX)
}

/**
 * 把配置里那一格摊成能直接用的值：素材引用换成地址，其余（URL / CSS 值 / 空）原样。
 * ⚠ 引用解析不出时给空串而不是把 `asset:…` 原样漏出去：漏出去会被当成 URL 塞进
 * `<img src>`，得到的是一个碎图图标，看着像素材坏了。
 * @param value 配置里存的原始字符串
 */
export function resolveImageValue(value: string): string {
  const text = value.trim()
  if (!isAssetRef(text)) return value
  return resolver(text).trim()
}
