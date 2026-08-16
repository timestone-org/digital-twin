/**
 * @fileoverview 五个覆盖层收在一处的意义：建、喂值、换体量、算距离、释放
 * 各只有一处写法。
 *
 * ⚠ 本文件真正要守的是 `applyDistanceRules` **五处一个都不许漏**。漏掉哪一类，
 * 那一类元素上配的距离规则就完全不生效——不报错、不告警，配置里还好好写着，
 * 只是永远不起作用。加第六层时这条会红。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { afterEach, describe, expect, it } from 'vitest'

import type { DistanceContext } from '../src/distanceContext'
import { buildNodeIndex } from '../src/nodeIndex'
import { SceneLayers, type SceneLayerValues } from '../src/sceneLayers'

const EMPTY_VALUES: SceneLayerValues = {
  anchors: {},
  arrows: {},
  panels: {},
  flows: {},
}

let built: SceneLayers[] = []
let hosts: HTMLElement[] = []

afterEach(() => {
  for (const layer of built) layer.dispose()
  for (const element of hosts) element.remove()
  built = []
  hosts = []
})

function host(): HTMLElement {
  const element = document.createElement('div')
  element.style.setProperty('--accent-primary', '#00cefc')
  document.body.append(element)
  hosts.push(element)
  return element
}

/** 造一台摆在指定位置的相机；朝向断言不看它，只有信息牌摆朝向要用。 */
function cameraAt(x: number, y = 0, z = 0): THREE.Camera {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(x, y, z)
  return camera
}

/** 相机远在 x 轴上；下面每一类都配了「远于 5 就隐藏」。 */
function farAway(): DistanceContext {
  return {
    cameraPosition: new THREE.Vector3(500, 0, 0),
    orbitTarget: new THREE.Vector3(0, 0, 0),
    camera: cameraAt(500, 0, 0),
  }
}

function nearby(): DistanceContext {
  return {
    cameraPosition: new THREE.Vector3(1, 0, 0),
    orbitTarget: new THREE.Vector3(0, 0, 0),
    camera: cameraAt(1, 0, 0),
  }
}

/** 五类元素各一个，且都配了同一条远距隐藏。 */
function everything(): TwinConfig {
  const hideAbove = { visibility: { hideAbove: { ref: 'orbit', value: 5 } } }
  return normalizeTwinConfig({
    parts: [{ id: 'pt1', nodes: ['pump'], ...hideAbove }],
    anchors: [
      { id: 'a1', position: [0, 0, 0], ...hideAbove },
      { id: 'a2', position: [1, 0, 0], ...hideAbove },
    ],
    panels: [{ id: 'pn1', anchorId: 'a1', ...hideAbove }],
    arrows: [{ id: 'ar1', ...hideAbove }],
    flows: [{ id: 'f1', pathAnchors: ['a1', 'a2'], ...hideAbove }],
  })
}

function model(): THREE.Object3D {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
  )
  mesh.name = 'pump'
  root.add(mesh)
  root.updateMatrixWorld(true)
  return root
}

function layersOf(config: TwinConfig): {
  layers: SceneLayers
  root: THREE.Object3D
} {
  const element = host()
  const layers = new SceneLayers(element)
  built.push(layers)
  const root = model()
  layers.addTo(new THREE.Scene())
  layers.build(config, EMPTY_VALUES, buildNodeIndex(root))
  return { layers, root }
}

/** 一层里所有对象都藏起来了吗。 */
function allHidden(group: THREE.Object3D): boolean {
  return group.children.length > 0 && group.children.every((c) => !c.visible)
}

describe('距离规则一处都不许漏', () => {
  it('远到阈值之外时，五类元素全部隐藏', () => {
    const { layers, root } = layersOf(everything())

    layers.applyDistanceRules(farAway())

    expect(allHidden(layers.anchors.group)).toBe(true)
    expect(allHidden(layers.arrows.group)).toBe(true)
    expect(allHidden(layers.panels.group)).toBe(true)
    expect(allHidden(layers.flows.group)).toBe(true)
    expect(root.getObjectByName('pump')?.visible).toBe(false)
  })

  it('回到阈值内时五类又都显示出来', () => {
    const { layers, root } = layersOf(everything())

    layers.applyDistanceRules(farAway())
    layers.applyDistanceRules(nearby())

    expect(layers.anchors.group.children.every((c) => c.visible)).toBe(true)
    expect(layers.arrows.group.children.every((c) => c.visible)).toBe(true)
    expect(layers.panels.group.children.every((c) => c.visible)).toBe(true)
    expect(layers.flows.group.children.every((c) => c.visible)).toBe(true)
    expect(root.getObjectByName('pump')?.visible).toBe(true)
  })

  // 一条距离规则都没配时，镜头飞到天边也不该让东西消失
  it('没配规则时距离再远也不隐藏', () => {
    const { layers, root } = layersOf(
      normalizeTwinConfig({
        parts: [{ id: 'pt1', nodes: ['pump'] }],
        anchors: [{ id: 'a1' }],
        arrows: [{ id: 'ar1' }],
      }),
    )

    layers.applyDistanceRules(farAway())

    expect(layers.anchors.group.children.every((c) => c.visible)).toBe(true)
    expect(layers.arrows.group.children.every((c) => c.visible)).toBe(true)
    expect(root.getObjectByName('pump')?.visible).toBe(true)
  })

  it('一个元素都没有时不出错', () => {
    const { layers } = layersOf(normalizeTwinConfig({}))

    expect(() => layers.applyDistanceRules(farAway())).not.toThrow()
  })
})

describe('喂值与释放仍各只有一处', () => {
  it('setValues 不会把距离规则算出来的显隐冲掉', () => {
    const { layers } = layersOf(everything())
    layers.applyDistanceRules(farAway())

    layers.setValues(EMPTY_VALUES)

    expect(allHidden(layers.flows.group)).toBe(true)
  })

  it('dispose 之后各层都空了', () => {
    const { layers } = layersOf(everything())

    layers.dispose()

    expect(layers.anchors.group.children).toHaveLength(0)
    expect(layers.arrows.group.children).toHaveLength(0)
    expect(layers.panels.group.children).toHaveLength(0)
    expect(layers.flows.group.children).toHaveLength(0)
  })
})
