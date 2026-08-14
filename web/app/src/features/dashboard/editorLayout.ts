/**
 * @fileoverview 画布的排版：把节点树摊成一张「每个节点在设计坐标系里的绝对矩形」表。
 * 编辑器需要绝对矩形来做命中、拖拽与选中框，而运行时是逐层递归渲染的——
 * 两套算法共用同一批几何函数（`moduleRect` / `containerGeometry`），不各写一份。
 *
 * ⚠ 容器的内缩只在**定子层原点**时加一次：再把它加进子节点坐标就是加了两次，
 * 而加两次与漏加一样看不出是谁干的（`@dt/runtime` 的 NodeTree 同一条注意）。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { resolveContentInset } from '@dt/modules'
import { containerGeometry, moduleRect, resolveModuleConfig } from '@dt/runtime'
import type { GetModuleManifest } from '@dt/runtime'

/** 一个节点在设计坐标系里的绝对位置。 */
export interface EditorFrame {
  id: string
  left: number
  top: number
  width: number
  height: number
  /** 树深，顶层是 0。图层树与画布的层叠顺序都用它。 */
  depth: number
  /** 自己与全部祖先都可见时才为真。 */
  isVisible: boolean
  zIndex: number
}

export interface EditorLayout {
  /** 按「父在子前」的先序排列，直接 v-for 即可保证子盖在父上。 */
  frames: readonly EditorFrame[]
  /** `parentId` 指向不存在的节点：它们不画，由调用方提示。 */
  detachedIds: readonly string[]
}

interface Origin {
  left: number
  top: number
}

/** 同层顺序 `(zIndex, id)`，与运行时一致。 */
function byLayerOrder(
  left: DashboardNodePayload,
  right: DashboardNodePayload,
): number {
  return left.zIndex - right.zIndex || left.id.localeCompare(right.id)
}

function groupByParent(
  nodes: readonly DashboardNodePayload[],
): Map<string | null, DashboardNodePayload[]> {
  const byParent = new Map<string | null, DashboardNodePayload[]>()
  for (const node of nodes) {
    const bucket = byParent.get(node.parentId)
    if (bucket === undefined) byParent.set(node.parentId, [node])
    else bucket.push(node)
  }
  for (const bucket of byParent.values()) bucket.sort(byLayerOrder)
  return byParent
}

/** 容器的子层原点：容器矩形左上角加上内容区内缩。 */
function childOrigin(
  node: DashboardNodePayload,
  manifest: ModuleManifest | undefined,
  frame: EditorFrame,
): Origin {
  if (manifest?.isContainer !== true) {
    return { left: frame.left, top: frame.top }
  }
  const inset = resolveContentInset(
    resolveModuleConfig(manifest, node.configJson),
  )
  return { left: frame.left + inset.left, top: frame.top + inset.top }
}

/** 容器的内容区尺寸；非容器不裁剪子节点。 */
function childBounds(
  node: DashboardNodePayload,
  manifest: ModuleManifest | undefined,
): { width: number; height: number } {
  const rect = moduleRect({ x: node.x, y: node.y, w: node.w, h: node.h })
  if (manifest?.isContainer !== true) {
    return { width: rect.width, height: rect.height }
  }
  return containerGeometry(
    rect,
    resolveContentInset(resolveModuleConfig(manifest, node.configJson)),
  )
}

/**
 * 摊平成绝对矩形表。
 * @param nodes 一张大屏的全部节点
 * @param getManifest 注入式清单解析器；不传则一个容器都认不出来
 */
export function layoutFrames(
  nodes: readonly DashboardNodePayload[],
  getManifest?: GetModuleManifest,
): EditorLayout {
  const byParent = groupByParent(nodes)
  const frames: EditorFrame[] = []
  const placed = new Set<string>()

  const walk = (
    parentId: string | null,
    origin: Origin,
    depth: number,
    isParentVisible: boolean,
  ): void => {
    for (const node of byParent.get(parentId) ?? []) {
      if (placed.has(node.id)) continue
      placed.add(node.id)
      const rect = moduleRect({ x: node.x, y: node.y, w: node.w, h: node.h })
      const frame: EditorFrame = {
        id: node.id,
        left: origin.left + rect.left,
        top: origin.top + rect.top,
        width: rect.width,
        height: rect.height,
        depth,
        isVisible: isParentVisible && node.isVisible,
        zIndex: node.zIndex,
      }
      frames.push(frame)
      const manifest = getManifest?.(node.moduleType)
      walk(
        node.id,
        childOrigin(node, manifest, frame),
        depth + 1,
        frame.isVisible,
      )
    }
  }

  walk(null, { left: 0, top: 0 }, 0, true)

  return {
    frames,
    detachedIds: nodes
      .map((node) => node.id)
      .filter((id) => !placed.has(id))
      .sort(),
  }
}

/**
 * 命中测试：给定设计坐标，取**最上面**那个可见节点的 id。
 * ⚠ 从后往前扫：`frames` 是先序，后面的画在上面，正着扫会永远命中最底下那个。
 * @param frames 排版结果
 * @param at 设计坐标系里的点
 */
export function hitTest(
  frames: readonly EditorFrame[],
  at: { x: number; y: number },
): string | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index]
    if (frame === undefined || !frame.isVisible) continue
    if (
      at.x >= frame.left &&
      at.x <= frame.left + frame.width &&
      at.y >= frame.top &&
      at.y <= frame.top + frame.height
    ) {
      return frame.id
    }
  }
  return null
}

/** 把容器的内容区尺寸交给调用方，用来夹住子节点的拖动范围。 */
export function contentSizeOf(
  node: DashboardNodePayload,
  manifest: ModuleManifest | undefined,
): { width: number; height: number } {
  return childBounds(node, manifest)
}
