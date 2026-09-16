/** @fileoverview 卡片投影在相机近面、屏幕边缘及背后的裁剪。 */
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { projectPanel } from '../src/panelProjection'

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
