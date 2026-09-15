/** @fileoverview 配置预览的隔离与恢复不损坏模型层级和资源。 */
import * as THREE from 'three'
import { expect, it } from 'vitest'
import { buildNodeIndex } from '../src/nodeIndex'
import { PreviewIsolation } from '../src/previewIsolation'
import { modelAnimationCatalog } from '../src/animationCatalog'
it('仅选中节点及祖先可见，恢复保留原始隐藏状态', () => {
  const root = new THREE.Group()
  const parent = new THREE.Group()
  parent.visible = false
  const pump = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  )
  pump.name = 'pump'
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshBasicMaterial(),
  )
  wall.name = 'wall'
  parent.add(pump)
  root.add(parent, wall)
  const isolation = new PreviewIsolation()
  const index = buildNodeIndex(root)
  expect(isolation.apply(root, index, ['pump'])?.isEmpty()).toBe(false)
  expect(parent.visible).toBe(true)
  expect(wall.visible).toBe(false)
  isolation.restore()
  expect(parent.visible).toBe(false)
  expect(wall.visible).toBe(true)
  expect(isolation.apply(root, index, ['missing'])).toBeNull()
  isolation.restore()
  pump.geometry.dispose()
  wall.geometry.dispose()
  pump.material.dispose()
  wall.material.dispose()
})
it('目录提取轨道目标、标记重复名称', () => {
  const track = new THREE.NumberKeyframeTrack(
    'pump.position[x]',
    [0, 1],
    [0, 1],
  )
  expect(
    modelAnimationCatalog([new THREE.AnimationClip('spin', 1, [track])]),
  ).toEqual([{ name: 'spin', duration: 1, nodes: ['pump'], ambiguous: false }])
  expect(
    modelAnimationCatalog([
      new THREE.AnimationClip('spin', 1, []),
      new THREE.AnimationClip('spin', 1, []),
    ])[0]?.ambiguous,
  ).toBe(true)
})
