/**
 * @fileoverview 模块库的分组与搜索。
 * ⚠ 分组键取的是清单自己声明的 `category`，编辑器里**不出现任何模块类型字面量**：
 * 认了具体类型，第三方模块就再也进不了库（docs/DASHBOARD_DESIGN.md §5.3 陷阱 ③）。
 */
import type { ModuleManifest } from '@dt/contracts'

/** 钉位模块被钉住的那条边；不钉位为 null。可拖的永远是它的对边。 */
export type PinnedEdge = 'top' | 'bottom' | null

/** 库里的一组。 */
export interface ModuleGroup {
  category: string
  items: readonly ModuleManifest[]
}

/**
 * 组名与模块名的定序器。
 * ⚠ locale 必须钉死：`localeCompare` 不给 locale 时用运行环境的默认区域，
 * 同一份清单在 en 机器上按码位排、在 zh 机器上按拼音排——本地绿 CI 红，
 * 而用户看到的顺序还随浏览器语言变。界面是中文的，按拼音排才是对的。
 */
const COLLATOR = new Intl.Collator('zh-CN')

/** 一条清单的可搜文本。 */
function searchText(manifest: ModuleManifest): string {
  return [
    manifest.type,
    manifest.displayName,
    manifest.category,
    ...(manifest.keywords ?? []),
  ]
    .join(' ')
    .toLowerCase()
}

/**
 * 按关键字筛，再按 `category` 分组。组与组内都按名字的拼音定序，两次渲染顺序一致。
 * @param manifests 已注册的全部清单
 * @param keyword 搜索关键字，空串表示不筛
 */
export function groupModules(
  manifests: readonly ModuleManifest[],
  keyword = '',
): ModuleGroup[] {
  const needle = keyword.trim().toLowerCase()
  const matched = manifests.filter(
    (manifest) => needle === '' || searchText(manifest).includes(needle),
  )
  const byCategory = new Map<string, ModuleManifest[]>()
  for (const manifest of matched) {
    const bucket = byCategory.get(manifest.category)
    if (bucket === undefined) byCategory.set(manifest.category, [manifest])
    else bucket.push(manifest)
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((left, right) =>
        COLLATOR.compare(left.displayName, right.displayName),
      ),
    }))
    .sort((left, right) => COLLATOR.compare(left.category, right.category))
}

/**
 * 一个节点能不能接子节点：只读清单上的**声明**，不认具体类型。
 * @param manifest 该节点的模块清单
 */
export function acceptsChildren(manifest: ModuleManifest | undefined): boolean {
  return manifest?.isContainer === true
}

/**
 * 钉位模块钉住的是哪条边：页头钉顶、页脚钉底，不钉位为 null。
 * ⚠ 取值只从**契约里的区域枚举**推，编辑器仍然不认识任何模块类型；
 * 而「钉住哪条边」必须有唯一一处答案——分散在各处按坐标猜的话，
 * 手柄给的那条边与真正被钉住的那条边迟早对不上（本仓出过一次，页头拖的是上沿）。
 * @param manifest 模块清单
 */
export function pinnedEdgeOf(manifest: ModuleManifest | undefined): PinnedEdge {
  const region = manifest?.region
  if (region === undefined) return null
  return region === 'footer' ? 'bottom' : 'top'
}

/**
 * 这个模块是不是钉位模块（页头 / 页脚这类）：同样只读声明。
 * @param manifest 模块清单
 */
export function isPinnedRegion(manifest: ModuleManifest | undefined): boolean {
  return pinnedEdgeOf(manifest) !== null
}

/**
 * 模块库 → 画布拖放的 dataTransfer 类型；载荷是模块 type 字符串。
 * ⚠ 用自定义 MIME 而不是 text/plain：后者会让从别处拖进来的任意文本都被
 * 当成一次「添加模块」尝试。
 */
export const MODULE_DRAG_MIME = 'application/x-dt-module-type'
