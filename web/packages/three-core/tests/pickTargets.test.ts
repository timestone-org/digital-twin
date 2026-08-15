/**
 * @fileoverview 守拾取件的契约：落点按锚点优先解析、隐藏的实体不给标记、
 * 命中判定要上溯祖先链、坐标换算在退化输入下不出 NaN，以及标记重建时资源都释放到。
 */
import { normalizeTwinConfig, type TwinConfig } from '@dt/twin-config'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PickTargets,
  entityPickPoints,
  isVisibleInTree,
  ndcFromClient,
  nearestNamedName,
  partIdOfObject,
  worldUnitsPerPixel,
} from '../src/pickTargets'

function config(overrides: Record<string, unknown> = {}): TwinConfig {
  return normalizeTwinConfig({ model: { asset: '' }, ...overrides })
}

function camera(distance: number): THREE.PerspectiveCamera {
  const perspective = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  perspective.position.set(0, 0, distance)
  perspective.updateMatrixWorld()
  perspective.updateProjectionMatrix()
  return perspective
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('实体落点', () => {
  it('锚点与箭头用自己的坐标', () => {
    const points = entityPickPoints(
      config({
        anchors: [{ id: 'a1', position: [1, 2, 3] }],
        arrows: [{ id: 'w1', position: [4, 5, 6] }],
      }),
    )

    expect(points).toEqual([
      { kind: 'anchors', id: 'a1', position: [1, 2, 3] },
      { kind: 'arrows', id: 'w1', position: [4, 5, 6] },
    ])
  })

  it('信息牌锚在锚点上时用锚点坐标加偏移', () => {
    const points = entityPickPoints(
      config({
        anchors: [{ id: 'a1', position: [1, 1, 1] }],
        panels: [
          { id: 'p1', anchorId: 'a1', position: [9, 9, 9], offset: [0, 2, 0] },
        ],
      }),
    )

    expect(points[1]).toEqual({
      kind: 'panels',
      id: 'p1',
      position: [1, 3, 1],
    })
  })

  it('信息牌引用的锚点不存在时退回自带坐标', () => {
    const points = entityPickPoints(
      config({
        panels: [
          {
            id: 'p1',
            anchorId: 'missing',
            position: [5, 0, 0],
            offset: [1, 0, 0],
          },
        ],
      }),
    )

    expect(points[0]?.position).toEqual([6, 0, 0])
  })

  it('能量流落在路径锚点的中点上', () => {
    const points = entityPickPoints(
      config({
        anchors: [
          { id: 'a1', position: [0, 0, 0] },
          { id: 'a2', position: [4, 0, 2] },
        ],
        flows: [{ id: 'f1', pathAnchors: ['a1', 'a2'] }],
      }),
    )

    expect(points.at(-1)).toEqual({
      kind: 'flows',
      id: 'f1',
      position: [2, 0, 1],
    })
  })

  it('能量流路径解析不出两个点时不给标记', () => {
    const points = entityPickPoints(
      config({
        anchors: [{ id: 'a1', position: [0, 0, 0] }],
        flows: [{ id: 'f1', pathAnchors: ['a1', 'gone'] }],
      }),
    )

    expect(points.filter((point) => point.kind === 'flows')).toEqual([])
  })

  it('置为不可见的实体一律不给标记', () => {
    const points = entityPickPoints(
      config({
        anchors: [{ id: 'a1', position: [0, 0, 0], visible: false }],
        arrows: [{ id: 'w1', position: [0, 0, 0], visible: false }],
        panels: [{ id: 'p1', position: [0, 0, 0], visible: false }],
      }),
    )

    expect(points).toEqual([])
  })
})

describe('坐标换算', () => {
  it('画布中心是原点，右下角是 (1, -1)', () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 }

    expect(ndcFromClient(rect, 300, 150)).toEqual({ x: 0, y: 0 })
    expect(ndcFromClient(rect, 500, 250)).toEqual({ x: 1, y: -1 })
  })

  it('画布塌成零宽高时返回 null 而不是 NaN', () => {
    expect(
      ndcFromClient({ left: 0, top: 0, width: 0, height: 0 }, 5, 5),
    ).toBeNull()
  })

  it('距离翻倍时一个像素折合的世界单位也翻倍', () => {
    const near = worldUnitsPerPixel(camera(5), new THREE.Vector3(), 800)
    const far = worldUnitsPerPixel(camera(10), new THREE.Vector3(), 800)

    expect(far).toBeCloseTo(near * 2, 8)
  })

  it('视口高度为 0 时按 1 兜底，结果仍是有限值', () => {
    const unit = worldUnitsPerPixel(camera(5), new THREE.Vector3(), 0)

    expect(Number.isFinite(unit)).toBe(true)
    expect(unit).toBeGreaterThan(0)
  })

  it('相机与标记重合时不出 Infinity', () => {
    const unit = worldUnitsPerPixel(camera(0), new THREE.Vector3(), 800)

    expect(Number.isFinite(unit)).toBe(true)
  })
})

describe('命中判定', () => {
  it('父级被隐藏时子对象判为不可见', () => {
    const parent = new THREE.Group()
    const child = new THREE.Mesh()
    parent.add(child)
    parent.visible = false

    expect(child.visible).toBe(true)
    expect(isVisibleInTree(child)).toBe(false)
  })

  it('整条祖先链都可见才判为可见', () => {
    const parent = new THREE.Group()
    const child = new THREE.Mesh()
    parent.add(child)

    expect(isVisibleInTree(child)).toBe(true)
  })

  it('命中匿名网格时上溯到最近的有名字的祖先', () => {
    const named = new THREE.Group()
    named.name = 'pump'
    const anonymous = new THREE.Mesh()
    named.add(anonymous)

    expect(nearestNamedName(anonymous)).toBe('pump')
  })

  it('整条祖先链都没有名字时给空串', () => {
    expect(nearestNamedName(new THREE.Mesh())).toBe('')
    expect(nearestNamedName(null)).toBe('')
  })

  it('部件引用的是祖先节点名时子网格也归到这个部件', () => {
    const named = new THREE.Group()
    named.name = 'pump'
    const mesh = new THREE.Mesh()
    named.add(mesh)
    const parts = normalizeTwinConfig({
      parts: [{ id: 'part-pump', nodes: ['pump'] }],
    }).parts

    expect(partIdOfObject(mesh, parts)).toBe('part-pump')
  })

  it('没有任何部件引用这条链上的名字时给空串', () => {
    const named = new THREE.Group()
    named.name = 'valve'

    expect(partIdOfObject(named, [])).toBe('')
  })
})

describe('拾取标记', () => {
  it('射线命中标记时给出对应的实体选中', () => {
    const targets = new PickTargets(null)
    targets.build(config({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }))
    const view = camera(5)
    targets.updateForCamera(view, 800)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(0, 0), view)

    expect(targets.raycast(raycaster)).toEqual({ kind: 'anchors', id: 'a1' })
    targets.dispose()
  })

  it('射线没命中任何标记时给 null', () => {
    const targets = new PickTargets(null)
    targets.build(config({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }))
    const view = camera(5)
    targets.updateForCamera(view, 800)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(new THREE.Vector2(0.9, 0.9), view)

    expect(targets.raycast(raycaster)).toBeNull()
    targets.dispose()
  })

  it('选中的那枚标记比其余的更大更亮', () => {
    const targets = new PickTargets(null)
    targets.build(
      config({
        anchors: [
          { id: 'a1', position: [0, 0, 0] },
          { id: 'a2', position: [0, 0, 0] },
        ],
      }),
    )
    targets.setSelected({ kind: 'anchors', id: 'a1' })
    targets.updateForCamera(camera(5), 800)
    const [selected, other] = targets.group.children

    expect(selected?.scale.x).toBeGreaterThan(other?.scale.x ?? 0)
    expect((selected as THREE.Mesh).renderOrder).toBeGreaterThan(
      (other as THREE.Mesh).renderOrder,
    )
    targets.dispose()
  })

  it('重建时旧的几何与材质都释放到，标记不越堆越多', () => {
    const targets = new PickTargets(null)
    targets.build(config({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }))
    const mesh = targets.group.children[0] as THREE.Mesh
    const geometryDispose = vi.spyOn(mesh.geometry, 'dispose')
    const materialDispose = vi.spyOn(mesh.material as THREE.Material, 'dispose')

    targets.build(config({ anchors: [{ id: 'a2', position: [1, 1, 1] }] }))

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(targets.group.children).toHaveLength(1)
    targets.dispose()
  })

  it('没有可点选实体时一个标记都不建', () => {
    const targets = new PickTargets(null)

    targets.build(config())

    expect(targets.group.children).toHaveLength(0)
    targets.dispose()
  })

  it('释放后组里不再留着任何标记', () => {
    const targets = new PickTargets(null)
    targets.build(config({ anchors: [{ id: 'a1', position: [0, 0, 0] }] }))

    targets.dispose()

    expect(targets.group.children).toHaveLength(0)
  })
})
