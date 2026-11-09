/** @fileoverview 信息牌范围投影到屏幕，并在齐次坐标中裁剪视锥。 */
import * as THREE from 'three'

const PLANES: readonly (readonly [number, number, number, number])[] = [
  [1, 0, 0, 1],
  [-1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, -1, 0, 1],
  [0, 0, 1, 1],
  [0, 0, -1, 1],
]

function clip(
  points: THREE.Vector4[],
  plane: readonly [number, number, number, number],
): THREE.Vector4[] {
  const distance = (point: THREE.Vector4) =>
    point.x * plane[0] +
    point.y * plane[1] +
    point.z * plane[2] +
    point.w * plane[3]
  if (points.every((point) => distance(point) >= 0)) return points
  const result: THREE.Vector4[] = []
  let previous = points.at(-1)
  if (previous === undefined) return result
  let previousDistance = distance(previous)
  for (const point of points) {
    const currentDistance = distance(point)
    if (currentDistance >= 0 !== previousDistance >= 0)
      result.push(
        previous
          .clone()
          .lerp(point, previousDistance / (previousDistance - currentDistance)),
      )
    if (currentDistance >= 0) result.push(point)
    previous = point
    previousDistance = currentDistance
  }
  return result
}

export function projectPanel(
  matrix: THREE.Matrix4,
  width: number,
  height: number,
): string {
  let points = [
    new THREE.Vector4(-0.5, -0.5, 0, 1),
    new THREE.Vector4(0.5, -0.5, 0, 1),
    new THREE.Vector4(0.5, 0.5, 0, 1),
    new THREE.Vector4(-0.5, 0.5, 0, 1),
  ].map((point) => point.applyMatrix4(matrix))
  for (const plane of PLANES) points = clip(points, plane)
  if (points.length < 3 || points.some((point) => point.w <= 0)) return ''
  return points
    .map(
      (point) =>
        `${(((point.x / point.w) * 0.5 + 0.5) * width).toFixed(3)},${((0.5 - (point.y / point.w) * 0.5) * height).toFixed(3)}`,
    )
    .join(' ')
}

/** 尖角处外扩的上限倍数；再尖的角也不把背板拉出一根长刺。 */
const MAX_MITER = 4

/**
 * 把屏幕多边形的每条边往外平移 `px`，顶点取相邻两条平移边的交点（斜接）。
 * @param points `projectPanel` 给的 "x,y x,y …"；空串原样返回
 * @param px 外扩的像素
 */
export function expandPolygon(points: string, px: number): string {
  if (points === '') return ''
  const vertices = points.split(' ').map((pair) => {
    const [x = 0, y = 0] = pair.split(',').map(Number)
    return new THREE.Vector2(x, y)
  })
  let area = 0
  vertices.forEach((point, index) => {
    const next = vertices[(index + 1) % vertices.length] ?? point
    area += point.x * next.y - next.x * point.y
  })
  // 按环绕方向定外法向：顶点顺逆两种次序都往外扩
  const outward = area >= 0 ? 1 : -1
  const normalOf = (from: THREE.Vector2, to: THREE.Vector2): THREE.Vector2 =>
    new THREE.Vector2(to.y - from.y, from.x - to.x)
      .normalize()
      .multiplyScalar(outward)
  return vertices
    .map((point, index) => {
      const prev = vertices[(index + vertices.length - 1) % vertices.length]
      const next = vertices[(index + 1) % vertices.length]
      if (prev === undefined || next === undefined) return point
      const n1 = normalOf(prev, point)
      const n2 = normalOf(point, next)
      const miter = Math.min(1 / Math.max(1 + n1.dot(n2), 1e-6), MAX_MITER)
      return n1
        .add(n2)
        .multiplyScalar(px * miter)
        .add(point)
    })
    .map((point) => `${point.x.toFixed(3)},${point.y.toFixed(3)}`)
    .join(' ')
}
