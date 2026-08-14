/**
 * @fileoverview 模块库的分组与搜索。
 * ⚠ 分组键取的是清单自己声明的 `category`，编辑器里**不出现任何模块类型字面量**：
 * 认了具体类型，第三方模块就再也进不了库（docs/DASHBOARD_DESIGN.md §5.3 陷阱 ③）。
 */
import type { ModuleManifest } from '@dt/contracts'

/** 库里的一组。 */
export interface ModuleGroup {
  category: string
  items: readonly ModuleManifest[]
}

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
 * 按关键字筛，再按 `category` 分组。组与组内都按名字定序，两次渲染顺序一致。
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
        left.displayName.localeCompare(right.displayName),
      ),
    }))
    .sort((left, right) => left.category.localeCompare(right.category))
}

/**
 * 一个节点能不能接子节点：只读清单上的**声明**，不认具体类型。
 * @param manifest 该节点的模块清单
 */
export function acceptsChildren(manifest: ModuleManifest | undefined): boolean {
  return manifest?.isContainer === true
}

/**
 * 这个模块是不是钉位模块（页头 / 页脚这类）：同样只读声明。
 * ⚠ 只判断「有没有声明」，不判断声明的是哪一个区域——一比具体取值，
 * 编辑器就又认识某个具体模块了。
 * @param manifest 模块清单
 */
export function isPinnedRegion(manifest: ModuleManifest | undefined): boolean {
  return manifest?.region !== undefined
}

/**
 * 模块库 → 画布拖放的 dataTransfer 类型；载荷是模块 type 字符串。
 * ⚠ 用自定义 MIME 而不是 text/plain：后者会让从别处拖进来的任意文本都被
 * 当成一次「添加模块」尝试。
 */
export const MODULE_DRAG_MIME = 'application/x-dt-module-type'
