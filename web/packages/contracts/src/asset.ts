/**
 * @fileoverview 素材引用与它的取回地址。浏览器侧只认这一份拼装。
 *
 * ⚠ 对象键的形状与服务端 `apps/assets/keys.py` 是**同一份契约**：两边漂了不会有
 * 任何一处报错，表现只是取回 404、大屏上那块永远转圈。跨语言一致由服务端的
 * `tests/contract/test_asset_url_contract.py` 读本文件比对钉住。
 *
 * ⚠ 业务配置里只许落 `asset:<uuid>` 引用，不许落 URL：部署地址一换、桶名一换，
 * 存量配置里那条链接就 404，而没有任何一处会报错。
 */

/** 素材类型。⚠ 与服务端 `ASSET_KINDS` 逐字一致。 */
export const ASSET_KINDS = ['model', 'image', 'icon'] as const
export type AssetKind = (typeof ASSET_KINDS)[number]

export const ASSET_REF_PREFIX = 'asset:'

/** 素材 id → 引用串。 */
export function assetRef(assetId: string): string {
  return `${ASSET_REF_PREFIX}${assetId}`
}

/**
 * 引用串 → 素材 id；形状不对给 null。
 * ⚠ 只认这一种形状：放行裸 uuid 或 URL 的话，存量里那些本该被拒的写法会一路
 * 走到取回，最后表现成 404。
 * @param ref 落库的引用串
 */
export function parseAssetRef(ref: string): string | null {
  const text = ref.trim()
  if (!text.startsWith(ASSET_REF_PREFIX)) return null
  const id = text.slice(ASSET_REF_PREFIX.length)
  return UUID_RE.test(id) ? id : null
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 某一类素材的对象键。
 * ⚠ 逐类铺满而不是拼字符串：拼出来的键在新增类型时会静默指到一个不存在的
 * 前缀，而这里少一类编译期就报错。
 * @param kind 素材类型
 * @param assetId 素材 id
 */
export function assetObjectKey(kind: AssetKind, assetId: string): string {
  const builders: Record<AssetKind, (id: string) => string> = {
    // 模型的一切都在自己的前缀下，将来的派生件（缩略图、分片清单）也在这里
    model: (id) => `models/${id}/original`,
    image: (id) => `images/${id}`,
    icon: (id) => `icons/${id}`,
  }
  return builders[kind](assetId)
}

/**
 * 引用串 → 可 fetch 的地址；引用不合法给空串。
 * @param base 取回前缀，末尾带斜杠（例 `/oss/`）
 * @param kind 素材类型
 * @param ref 落库的引用串
 */
export function assetUrl(base: string, kind: AssetKind, ref: string): string {
  const id = parseAssetRef(ref)
  if (id === null) return ''
  // ⚠ 前缀末尾补斜杠而不是假定调用方给对：少一个斜杠拼出来的是
  // `/ossmodels/...`，那是一条谁都解释不了的 404
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${assetObjectKey(kind, id)}`
}
