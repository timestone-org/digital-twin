/**
 * @fileoverview 把后端那份**扁平**节点表归一成渲染用的树视图：按 `parentId` 组装、
 * 按 `(zIndex, id)` 定序、清单缺省铺进配置（docs/DASHBOARD_DESIGN.md §5.1）。
 * ⚠ 清单靠**注入的** `getManifest` 解析，不在这里 import 注册表：少了它 `isContainer`
 * 恒为 false，容器不渲染内容区，**它的子节点全部静默消失**。
 */
import type {
  BindingView,
  DashboardNodeView,
  ModuleManifest,
} from '@dt/contracts'
import { configDefaults } from '@dt/modules'

import type { NodeBox } from './dashboardGeometry'

/** 注入式清单解析器：应用壳传 `@dt/modules` 的 `getModule`，测试传自己的假清单。 */
export type GetModuleManifest = (
  moduleType: string,
) => ModuleManifest | undefined

/** 树视图里的一个节点。 */
export interface RuntimeNode {
  id: string
  moduleType: string
  /** 本层坐标系里的绝对像素。 */
  box: NodeBox
  zIndex: number
  isVisible: boolean
  /** 容器模块：子节点由运行时递归注入它的默认插槽。 */
  isContainer: boolean
  /** 清单缺省铺底后的配置。 */
  config: Record<string, unknown>
  bindings: readonly BindingView[]
  children: readonly RuntimeNode[]
}

/** 归一结果。 */
export interface NodeTreeView {
  /** 顶层节点，已按 `(zIndex, id)` 定序。 */
  roots: readonly RuntimeNode[]
  /**
   * 没能进树的节点 id：`parentId` 指向不存在的节点，或父子成环。
   * ⚠ 它们**不**被当成顶层节点悄悄画出来——静默改父子关系正是本仓要消灭的
   * 那类降级（ADR-0012 四）；调用方据此报错或提示。
   */
  detachedIds: readonly string[]
}

type NodesByParent = Map<string | null, DashboardNodeView[]>

/**
 * 清单缺省铺底 + 用户配置覆盖。
 * ⚠ 幂等：对已经铺过缺省的配置再调一次结果不变，所以归一与渲染两处调用它是安全的。
 * @param manifest 该模块的清单；缺失则只有用户配置
 * @param config 节点落库的 `configJson`
 */
export function resolveModuleConfig(
  manifest: ModuleManifest | undefined,
  config: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...configDefaults(manifest?.configSchema ?? []),
    ...(config ?? {}),
  }
}

/**
 * 扁平节点表 → 树视图。
 * @param nodes 一张大屏的全部节点
 * @param getManifest 注入式清单解析器；不传则一个容器都认不出来
 */
export function buildNodeTree(
  nodes: readonly DashboardNodeView[],
  getManifest?: GetModuleManifest,
): NodeTreeView {
  const byParent = groupByParent(nodes)
  const attached = new Set<string>()
  const roots = buildLevel(null, byParent, attached, getManifest)
  return {
    roots,
    detachedIds: nodes
      .map((node) => node.id)
      .filter((id) => !attached.has(id))
      .sort(),
  }
}

/** 按父节点分桶，桶内定序。 */
function groupByParent(nodes: readonly DashboardNodeView[]): NodesByParent {
  const byParent: NodesByParent = new Map()
  for (const node of nodes) {
    const bucket = byParent.get(node.parentId)
    if (bucket === undefined) byParent.set(node.parentId, [node])
    else bucket.push(node)
  }
  for (const bucket of byParent.values()) bucket.sort(byLayerOrder)
  return byParent
}

/** 同层顺序 `(zIndex, id)`：两次读取同一张未修改的大屏渲染顺序逐字相同。 */
function byLayerOrder(
  left: DashboardNodeView,
  right: DashboardNodeView,
): number {
  return left.zIndex - right.zIndex || left.id.localeCompare(right.id)
}

/** 建一层。已进过树的 id 不再进第二次，脏数据成环因此不会无限递归。 */
function buildLevel(
  parentId: string | null,
  byParent: NodesByParent,
  attached: Set<string>,
  getManifest: GetModuleManifest | undefined,
): RuntimeNode[] {
  const level: RuntimeNode[] = []
  for (const payload of byParent.get(parentId) ?? []) {
    if (attached.has(payload.id)) continue
    attached.add(payload.id)
    level.push(toRuntimeNode(payload, byParent, attached, getManifest))
  }
  return level
}

function toRuntimeNode(
  payload: DashboardNodeView,
  byParent: NodesByParent,
  attached: Set<string>,
  getManifest: GetModuleManifest | undefined,
): RuntimeNode {
  const manifest = getManifest?.(payload.moduleType)
  return {
    id: payload.id,
    moduleType: payload.moduleType,
    box: { x: payload.x, y: payload.y, w: payload.w, h: payload.h },
    zIndex: payload.zIndex,
    isVisible: payload.isVisible,
    isContainer: manifest?.isContainer === true,
    config: resolveModuleConfig(manifest, payload.configJson),
    bindings: payload.bindings,
    children: buildLevel(payload.id, byParent, attached, getManifest),
  }
}

/**
 * 裁出以 `rootId` 为根的整棵子树并把根搬到 (0,0)：节点弹窗的内容就是它。
 * 根的 `isVisible` 强制为真——弹窗目标通常配成初始不可见（免得屏上弹窗各一份），
 * 不掀开的话弹窗里就是一片空白。找不到根时给空数组。
 */
export function buildModalSubtree(
  nodes: readonly DashboardNodeView[],
  rootId: string,
  getManifest?: GetModuleManifest,
): readonly RuntimeNode[] {
  const root = nodes.find((node) => node.id === rootId)
  if (root === undefined) return []
  const wanted = new Set<string>([rootId])
  let grew = true
  while (grew) {
    grew = false
    for (const node of nodes) {
      if (node.parentId === null || wanted.has(node.id)) continue
      if (!wanted.has(node.parentId)) continue
      wanted.add(node.id)
      grew = true
    }
  }
  const subtree = nodes
    .filter((node) => wanted.has(node.id))
    .map((node) =>
      node.id === rootId
        ? { ...node, parentId: null, x: 0, y: 0, isVisible: true }
        : node,
    )
  return buildNodeTree(subtree, getManifest).roots
}
