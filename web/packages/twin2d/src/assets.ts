/**
 * @fileoverview 素材引用 `asset:<uuid>` → 可取回地址的注入槽。收**两个**函数：
 * 图元的 `ico.src` 走图标那一条、画布底图走图片那一条。真源由应用壳在启动期注入，
 * 本包不认识部署前缀（`/oss/`）。口径见 docs/MODULE_TWIN_2D_DESIGN.md §11.4。
 *
 * ⚠ 拆两条正是因为 `assetUrl` 的 `kind` 决定对象键前缀（`icons/<id>` 与
 * `images/<id>`）：一个函数服务两种 kind 时，装错的表现是**图标 404**（碎图或空白），
 * 零报错——图还在、连线还在，只是那几枚图标不见了。
 * ⚠ 未注入时一律回空串，不是凭空造一条必然 404 的地址：图元的 `asset` 一档随即落成
 * `{kind:'none'}` 整枝不画，底图那一层一条声明都不产。
 */

/** 两种 kind 各一条解析；解析不出的一律给空串。 */
export interface Twin2dAssetPorts {
  /** 图元 `ico.src` 的 `asset` 一档，对象键前缀 `icons/`。 */
  resolveIcon: (assetRef: string) => string
  /** `canvas.background` 的 `asset:<uuid>`，对象键前缀 `images/`。 */
  resolveImage: (assetRef: string) => string
}

/** 未注入那一档：两条都回空串。 */
const NOT_CONFIGURED: Twin2dAssetPorts = {
  resolveIcon: () => '',
  resolveImage: () => '',
}

let ports: Twin2dAssetPorts = NOT_CONFIGURED

/**
 * 装上真实的两条解析，通常是应用壳里那两条拼 `ASSET_BASE_URL` 的函数。
 * @param next 两种 kind 各一条
 */
export function configureTwin2dAssets(next: Twin2dAssetPorts): void {
  ports = next
}

/** 摘掉两条解析，退回空串。⚠ 只给测试用，生产路径调它等于把素材图全断掉。 */
export function __resetTwin2dAssets(): void {
  ports = NOT_CONFIGURED
}

/**
 * 两条解析装上了没有。
 * ⚠ 「装没装」是**装配**状态，诊断跑在配置上一辈子看不见它：不问一次的表现是整张图
 * 的自带图标与画布底图一起消失，而配置一字没错、控制台一声不吭。装配处据此说出口。
 */
export function twin2dAssetsConfigured(): boolean {
  return ports !== NOT_CONFIGURED
}

/**
 * 图标那一条：`asset:<uuid>` → `icons/<id>` 的取回地址；未注入或解析不出给空串。
 * @param assetRef 配置里落的引用串
 */
export function twin2dIconUrl(assetRef: string): string {
  return ports.resolveIcon(assetRef)
}

/**
 * 底图那一条：`asset:<uuid>` → `images/<id>` 的取回地址；未注入或解析不出给空串。
 * @param assetRef 配置里落的引用串
 */
export function twin2dImageUrl(assetRef: string): string {
  return ports.resolveImage(assetRef)
}
