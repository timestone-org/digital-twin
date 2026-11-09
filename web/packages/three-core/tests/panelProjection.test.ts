/** @fileoverview 卡片投影在相机近面、屏幕边缘及背后的裁剪。 */
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { expandPolygon, projectPanel } from '../src/panelProjection'

it('标准平面投影与 CSS 像素对齐', () => {
  expect(projectPanel(new THREE.Matrix4(), 100, 100)).toBe(
    '25.000,75.000 75.000,75.000 75.000,25.000 25.000,25.000',
  )
})

it('屏幕边缘裁剪后坐标保持有限且在视口内', () => {
  const points = projectPanel(new THREE.Matrix4().makeScale(4, 4, 1), 100, 100)
  expect(points).not.toBe('')
  for (const coordinate of points.split(/[ ,]/).map(Number)) {
    expect(coordinate).toBeGreaterThanOrEqual(0)
    expect(coordinate).toBeLessThanOrEqual(100)
  }
})

it('视锥外与相机背后返回空投影', () => {
  expect(
    projectPanel(new THREE.Matrix4().makeTranslation(10, 0, 0), 100, 100),
  ).toBe('')
  const camera = new THREE.PerspectiveCamera(45, 1, 1, 10)
  const matrix = camera.projectionMatrix
    .clone()
    .multiply(new THREE.Matrix4().makeTranslation(0, 0, 3))
  expect(projectPanel(matrix, 100, 100)).toBe('')
})

it('穿过近裁剪面的牌保留仍可见的部分', () => {
  const camera = new THREE.PerspectiveCamera(90, 1, 1, 10)
  const world = new THREE.Matrix4()
    .makeRotationY(Math.PI / 4)
    .setPosition(0, 0, -1)
  const points = projectPanel(
    camera.projectionMatrix.clone().multiply(world),
    100,
    100,
  )
  expect(points).not.toBe('')
  expect(points).not.toMatch(/NaN|Infinity/)
})

function parse(points: string): [number, number][] {
  return points.split(' ').map((pair) => {
    const [x = NaN, y = NaN] = pair.split(',').map(Number)
    return [x, y]
  })
}

// ⚠ 背板裁剪与 WebGL 挖洞在同一条边上各自抗锯齿：边上的像素两层都半透明，
//   透出底下的背景色，亮处就是一圈细灰线。背板多铺出去一点，洞边下面就是实的
it('背板的裁剪多边形每条边都往外让出给定的像素', () => {
  const wide = '0,0 400,0 400,100 0,100'

  const grown = parse(expandPolygon(wide, 2))

  expect(grown).toHaveLength(4)
  const xs = grown.map(([x]) => x)
  const ys = grown.map(([, y]) => y)
  expect(Math.min(...xs)).toBeCloseTo(-2)
  expect(Math.max(...xs)).toBeCloseTo(402)
  expect(Math.min(...ys)).toBeCloseTo(-2)
  expect(Math.max(...ys)).toBeCloseTo(102)
})

it('顶点顺序反过来也往外扩，不往里缩', () => {
  const grown = parse(expandPolygon('0,100 400,100 400,0 0,0', 2))

  expect(Math.min(...grown.map(([x]) => x))).toBeCloseTo(-2)
})

it('空投影原样给空', () => {
  expect(expandPolygon('', 2)).toBe('')
})
