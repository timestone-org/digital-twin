/**
 * @fileoverview 接点在画布上的坐标：由节点位置 + 实测尺寸 + 接点序号算出来。
 *
 * ⚠ 尺寸必须实测不能写死：卡片带一行错误文案时会变高，写死高度会让所有边在
 * 出错那一刻集体错位，而那正是用户最需要看清连线的时候。
 */
import type { ModelingGraph, ModelingOperator } from '@dt/contracts'
import { onBeforeUnmount, reactive, shallowRef } from 'vue'

import type { NodeRect } from './nodeLayout'
import type { CanvasPoint, CanvasRect } from './useCanvasViewport'

/** 卡片没量到尺寸时的兜底，与样式表里的宽度一致。 */
const FALLBACK_SIZE = { width: 224, height: 88 }

type Side = 'in' | 'out'
type Size = { width: number; height: number }
type Sizes = Map<string, Size>

/** 一个算子的某一侧接点里，这个名字排第几、一共几个。 */
function rankOf(
  spec: ModelingOperator | undefined,
  side: Side,
  port: string,
): { index: number; total: number } {
  const ports = (side === 'in' ? spec?.inputs : spec?.outputs) ?? []
  const index = ports.findIndex((item) => item.name === port)
  return { index: index < 0 ? 0 : index, total: ports.length || 1 }
}

/** 接点相对卡片左上角的偏移。同侧的多个接点在边上等距分布。 */
function offsetIn(
  size: Size,
  side: Side,
  port: ReturnType<typeof rankOf>,
): CanvasPoint {
  return {
    left: side === 'in' ? 0 : size.width,
    top: (size.height * (port.index + 1)) / (port.total + 1),
  }
}

/** 某个节点的外接矩形（画布坐标）。「适应视图」按它算。 */
function rectIn(
  sizes: Sizes,
  graph: ModelingGraph,
  id: string,
): CanvasRect | null {
  const node = graph.nodes.find((item) => item.id === id)
  if (node === undefined) return null
  return { ...node.position, ...(sizes.get(id) ?? FALLBACK_SIZE) }
}

/** 一批节点的带身份矩形。对齐、分布与吸附都吃它。 */
function rectsIn(
  sizes: Sizes,
  graph: ModelingGraph,
  ids?: readonly string[],
): NodeRect[] {
  const wanted = ids === undefined ? null : new Set(ids)
  return graph.nodes
    .filter((node) => wanted === null || wanted.has(node.id))
    .map((node) => ({
      id: node.id,
      ...node.position,
      ...(sizes.get(node.id) ?? FALLBACK_SIZE),
    }))
}

/** 某个接点的坐标（画布坐标）。认不出这个节点时给 null。 */
function anchorIn(
  sizes: Sizes,
  graph: ModelingGraph,
  operators: ReadonlyMap<string, ModelingOperator>,
  at: { node: string; port: string; side: Side },
): CanvasPoint | null {
  const node = graph.nodes.find((item) => item.id === at.node)
  if (node === undefined) return null
  const size = sizes.get(at.node) ?? FALLBACK_SIZE
  const rank = rankOf(operators.get(node.operator), at.side, at.port)
  const offset = offsetIn(size, at.side, rank)
  return {
    left: node.position.left + offset.left,
    top: node.position.top + offset.top,
  }
}

function watcher(sizes: Sizes, watched: Map<Element, string>): ResizeObserver {
  return new ResizeObserver((entries) => {
    for (const entry of entries) {
      const id = watched.get(entry.target)
      if (id === undefined) continue
      const box = entry.contentRect
      sizes.set(id, { width: box.width, height: box.height })
    }
  })
}

/**
 * 退订某个节点先前绑过的元素。
 *
 * ⚠ 元素被换掉时 Vue 会先用 `null` 调一次 `:ref`，那一次必须退订，否则卡片
 * 删掉之后它的尺寸还留在表里，边会画向一个不存在的节点。
 */
function unbind(
  id: string,
  sizes: Sizes,
  watched: Map<Element, string>,
  observer: ResizeObserver | null,
): void {
  for (const [node, bound] of watched) {
    if (bound !== id) continue
    observer?.unobserve(node)
    watched.delete(node)
  }
  sizes.delete(id)
}

/** 盯着画布上每个节点卡片的实测尺寸，并据此算接点坐标。 */
export function useNodeAnchors() {
  const sizes = reactive<Sizes>(new Map())
  const observer = shallowRef<ResizeObserver | null>(null)
  const watched = new Map<Element, string>()

  /** 挂到节点卡片的根元素上（`:ref`）。 */
  function bind(id: string, element: Element | null): void {
    if (element === null) return unbind(id, sizes, watched, observer.value)
    if (watched.get(element) === id) return
    observer.value ??= watcher(sizes, watched)
    watched.set(element, id)
    observer.value.observe(element)
  }

  onBeforeUnmount(() => {
    observer.value?.disconnect()
    observer.value = null
    watched.clear()
    sizes.clear()
  })

  return {
    bind,
    rectOf: (graph: ModelingGraph, id: string) => rectIn(sizes, graph, id),
    rectsOf: (graph: ModelingGraph, ids?: readonly string[]) =>
      rectsIn(sizes, graph, ids),
    anchorOf: (
      graph: ModelingGraph,
      operators: ReadonlyMap<string, ModelingOperator>,
      at: { node: string; port: string; side: Side },
    ) => anchorIn(sizes, graph, operators, at),
    /** 各卡片的实测尺寸。一键整理按它算版面。 */
    sizes,
  }
}
