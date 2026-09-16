/** @fileoverview 固定信息牌双面可读，切换观看面不改变牌面位置、旋转与实时内容。 */
import { normalizeTwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { PanelLayer } from '../src/panelLayer'
import { PanelSurface } from '../src/panelSurface'

function fixture(rotation = [0, 0, 0]) {
  const layer = new PanelLayer()
  layer.build(
    normalizeTwinConfig({
      panels: [
        {
          id: 'p',
          name: '设备 ABC 123',
          billboard: 'fixed',
          rotation,
          fields: [{ key: 'temperature', label: '温度', unit: '℃' }],
        },
      ],
    }).panels,
    [],
  )
  const surface = layer.group.children[0]
  if (!(surface instanceof PanelSurface)) throw new Error('缺少牌面')
  return { layer, surface }
}

describe('固定信息牌双面阅读', () => {
  it.each([0, 65, 180])('旋转 %s 度后正反面仍从左到右', (angle) => {
    const { layer, surface } = fixture([0, angle, 0])
    const rotation = surface.quaternion.clone()
    const position = surface.position.clone()
    const camera = new THREE.PerspectiveCamera()
    for (const side of [1, -1, 1]) {
      camera.position.set(0, 0, side * 10).applyQuaternion(rotation)
      camera.lookAt(position)
      camera.updateMatrixWorld(true)
      layer.faceCamera(camera)
      layer.setValues({ 'p::temperature': { value: side === 1 ? 25 : 30 } })
      const readingX = Number(
        surface.element.style.getPropertyValue('--tp-reading-x') || '1',
      )
      const right = new THREE.Vector3(readingX, 0, 0)
        .applyQuaternion(surface.quaternion)
        .transformDirection(camera.matrixWorldInverse)
      expect(right.x).toBeGreaterThan(0)
      expect(surface.position.equals(position)).toBe(true)
      expect(surface.quaternion.equals(rotation)).toBe(true)
      expect(surface.element.textContent).toContain(
        side === 1 ? '25 ℃' : '30 ℃',
      )
      expect(surface.element.querySelectorAll('.twin-panel')).toHaveLength(1)
    }
    layer.dispose()
  })

  it('相机和牌面带父级变换时按世界位置判断背面', () => {
    const { layer, surface } = fixture()
    layer.group.position.set(0, 0, 20)
    const parent = new THREE.Group()
    parent.position.set(0, 0, 10)
    const camera = new THREE.PerspectiveCamera()
    camera.position.z = 5
    parent.add(camera)
    layer.faceCamera(camera)
    expect(surface.element.style.getPropertyValue('--tp-reading-x')).toBe('-1')
    layer.dispose()
  })

  it('正交相机按平行视线判断背面，不随横向平移切换', () => {
    const { layer, surface } = fixture([0, 60, 0])
    const camera = new THREE.OrthographicCamera()
    camera.rotation.y = Math.PI
    for (const x of [-100, 100]) {
      camera.position.set(x, 0, -10)
      layer.faceCamera(camera)
      expect(surface.element.style.getPropertyValue('--tp-reading-x')).toBe(
        '-1',
      )
    }
    layer.dispose()
  })
})
