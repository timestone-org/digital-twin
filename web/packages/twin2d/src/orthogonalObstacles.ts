/** @fileoverview 绕过正交连线两端的设备外接盒。 */
import { sideNormal } from './geometry'
import type { Box, Pt } from './geometry'
import type { Twin2dSide } from './kinds'

/** 设备和绕行段之间的默认留白。 */
const CLEARANCE = 8

export interface OrthogonalEnd {
  point: Pt
  side: Twin2dSide
  box: Box
}

interface Bounds {
  left: number
  right: number
  top: number
  bottom: number
}

function bounds(box: Box, gap = 0): Bounds {
  return {
    left: box.x - box.w / 2 - gap,
    right: box.x + box.w / 2 + gap,
    top: box.y - box.h / 2 - gap,
    bottom: box.y + box.h / 2 + gap,
  }
}

function inside(p: Pt, b: Bounds): boolean {
  return p.x > b.left && p.x < b.right && p.y > b.top && p.y < b.bottom
}

function crosses(a: Pt, b: Pt, box: Bounds): boolean {
  if (a.x === b.x)
    return (
      a.x > box.left &&
      a.x < box.right &&
      Math.min(a.y, b.y) < box.bottom &&
      Math.max(a.y, b.y) > box.top
    )
  return (
    a.y > box.top &&
    a.y < box.bottom &&
    Math.min(a.x, b.x) < box.right &&
    Math.max(a.x, b.x) > box.left
  )
}

/** 首段沿端口声明的方向离开。 */
function leaves(end: OrthogonalEnd, next: Pt): boolean {
  const { point, side } = end
  const normal = sideNormal(side)
  const x = next.x - point.x
  const y = next.y - point.y
  return normal.x === 0
    ? x === 0 && y * normal.y > 0
    : y === 0 && x * normal.x > 0
}

/** 检查原走线的线段及圆角是否避开两台设备。 */
function canKeep(
  points: readonly Pt[],
  start: OrthogonalEnd,
  end: OrthogonalEnd,
  radius: number,
): boolean {
  const first = points[1]
  const last = points.at(-2)
  if (
    first === undefined ||
    last === undefined ||
    !leaves(start, first) ||
    !leaves(end, last)
  )
    return false
  const source = bounds(start.box)
  const target = bounds(end.box)
  const safeSource = bounds(start.box, radius)
  const safeTarget = bounds(end.box, radius)
  return points.every((point, index) => {
    const prev = points[index - 1]
    if (prev === undefined) return true
    if (prev.x !== point.x && prev.y !== point.y) return false
    if (index > 1 && crosses(prev, point, source)) return false
    if (index < points.length - 1 && crosses(prev, point, target)) return false
    return (
      index === points.length - 1 ||
      (!inside(point, safeSource) && !inside(point, safeTarget))
    )
  })
}

/** 端口沿出线方向延伸至设备盒外。 */
function lead(end: OrthogonalEnd, gap: number): Pt {
  const { point, side, box } = end
  const b = bounds(box, gap)
  switch (side) {
    case 'left':
      return { x: Math.min(b.left, point.x - gap), y: point.y }
    case 'right':
      return { x: Math.max(b.right, point.x + gap), y: point.y }
    case 'top':
      return { x: point.x, y: Math.min(b.top, point.y - gap) }
    case 'bottom':
      return { x: point.x, y: Math.max(b.bottom, point.y + gap) }
  }
}

function gridPoints(
  leads: readonly [Pt, Pt],
  obstacles: readonly Bounds[],
): Set<Pt> {
  const [start, end] = leads
  const xs = new Set([
    start.x,
    end.x,
    ...obstacles.flatMap((box) => [box.left, box.right]),
  ])
  const ys = new Set([
    start.y,
    end.y,
    ...obstacles.flatMap((box) => [box.top, box.bottom]),
  ])
  const points = new Set<Pt>(leads)
  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y }
      if (samePoint(start, point) || samePoint(end, point)) continue
      if (!obstacles.some((box) => inside(point, box))) points.add(point)
    }
  }
  return points
}

function samePoint(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y
}

/** 在引出点和设备盒边界构成的网格上找最短可行路径。 */
function shortestPath(
  start: Pt,
  end: Pt,
  obstacles: readonly Bounds[],
  sides: readonly [Twin2dSide, Twin2dSide],
): Pt[] | null {
  if (obstacles.some((box) => inside(start, box) || inside(end, box)))
    return null
  if (samePoint(start, end)) return [start]
  const leads: readonly [Pt, Pt] = [start, end]
  const pending = gridPoints(leads, obstacles)
  const distances = new Map<Pt, number>([[start, 0]])
  const previous = new Map<Pt, Pt>()
  const search = { pending, obstacles, distances, previous, leads, sides }
  while (pending.size > 0) {
    const closest = nearestUnvisited(search)
    if (closest === null) return null
    if (closest.point === end) return pathTo(end, previous)
    pending.delete(closest.point)
    relaxNeighbors(closest.point, closest.distance, search)
  }
  return null
}

function nearestUnvisited(
  search: Search,
): { point: Pt; distance: number } | null {
  let point: Pt | null = null
  let distance = Infinity
  for (const candidate of search.pending) {
    const cost = search.distances.get(candidate) ?? Infinity
    if (cost >= distance) continue
    point = candidate
    distance = cost
  }
  return point === null ? null : { point, distance }
}

function pathTo(end: Pt, previous: ReadonlyMap<Pt, Pt>): Pt[] {
  const points = [end]
  for (let at = previous.get(end); at !== undefined; at = previous.get(at))
    points.push(at)
  return points.reverse()
}

interface Search {
  pending: ReadonlySet<Pt>
  obstacles: readonly Bounds[]
  distances: Map<Pt, number>
  previous: Map<Pt, Pt>
  sides: readonly [Twin2dSide, Twin2dSide]
  leads: readonly [Pt, Pt]
}

function reverses(side: Twin2dSide, from: Pt, to: Pt): boolean {
  const normal = sideNormal(side)
  return (to.x - from.x) * normal.x + (to.y - from.y) * normal.y < 0
}

function followsLead(at: Pt, next: Pt, search: Search): boolean {
  const [start, end] = search.leads
  return (
    (at.x === next.x || at.y === next.y) &&
    (at !== start || !reverses(search.sides[0], at, next)) &&
    (next !== end || !reverses(search.sides[1], next, at))
  )
}

function relaxNeighbors(at: Pt, distance: number, search: Search): void {
  for (const next of search.pending) {
    if (!followsLead(at, next, search)) continue
    const cost = distance + Math.abs(next.x - at.x) + Math.abs(next.y - at.y)
    if (cost >= (search.distances.get(next) ?? Infinity)) continue
    if (search.obstacles.some((box) => crosses(at, next, box))) continue
    search.distances.set(next, cost)
    search.previous.set(next, at)
  }
}

/** 略去折线途中同向共线的点。 */
function turns(points: readonly Pt[]): Pt[] {
  return points.filter((point, index) => {
    const a = points[index - 1]
    const b = points[index + 1]
    if (a === undefined || b === undefined) return true
    if (a.x === point.x && point.x === b.x)
      return (point.y - a.y) * (b.y - point.y) < 0
    if (a.y === point.y && point.y === b.y)
      return (point.x - a.x) * (b.x - point.x) < 0
    return true
  })
}

function around(
  start: OrthogonalEnd,
  end: OrthogonalEnd,
  gap: number,
): Pt[] | null {
  const s = lead(start, gap)
  const t = lead(end, gap)
  if (
    crosses(start.point, s, bounds(end.box)) ||
    crosses(end.point, t, bounds(start.box))
  )
    return null
  const middle = shortestPath(
    s,
    t,
    [bounds(start.box, gap), bounds(end.box, gap)],
    [start.side, end.side],
  )
  return middle === null ? null : turns([start.point, ...middle, end.point])
}

/** 保持两端出线方向，绕过接线设备。 */
export function avoidEndpointBoxes(
  points: Pt[],
  start: OrthogonalEnd,
  end: OrthogonalEnd,
  radius: number,
): { points: Pt[]; radius: number } {
  if (canKeep(points, start, end, radius)) return { points, radius }
  for (const gap of [CLEARANCE, 1, 0.1]) {
    const path = around(start, end, gap)
    if (path !== null) return { points: path, radius: Math.min(radius, gap) }
  }
  // 设备相叠时，引出线可能已被对侧设备挡住。
  const s = lead(start, CLEARANCE)
  const t = lead(end, CLEARANCE)
  return {
    points: [start.point, s, { x: t.x, y: s.y }, t, end.point],
    radius: 0,
  }
}
