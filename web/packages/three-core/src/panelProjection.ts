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
