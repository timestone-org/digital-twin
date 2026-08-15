/**
 * @fileoverview 部件的距离显隐、淡出，以及点击要用的部件归属与包围盒。
 *
 * ⚠ 淡出走克隆材质。不克隆的话，GLB 里被多个网格共用的那份材质会被一起调暗——
 * 画面上是「毫不相干的地方也跟着淡了」，而且看不出是谁干的。
 */
import { normalizeTwinConfig, type TwinPart } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { DistanceContext } from '../src/distanceContext'
import { buildNodeIndex } from '../src/nodeIndex'
import { PartDistanceLayer } from '../src/partDistance'

/** 相机在 x 轴上，轨道中心在原点；部件盒也在原点，故三种参考系距离都是 x。 */
function context(cameraX: number): DistanceContext {
  return {
    cameraPosition: new THREE.Vector3(cameraX, 0, 0),
    orbitTarget: new THREE.Vector3(0, 0, 0),
  }
}

/** 一根共用材质的两个网格：一个在部件里，一个不在。 */
function model(): {
  root: THREE.Object3D
  inside: THREE.Mesh
  outside: THREE.Mesh
  shared: THREE.MeshStandardMaterial
} {
  const shared = new THREE.MeshStandardMaterial({ color: '#ff0000' })
  const root = new THREE.Group()
  const holder = new THREE.Group()
  holder.name = 'pump'
  const inside = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared)
  holder.add(inside)
  const outside = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), shared)
  outside.name = 'other'
  root.add(holder, outside)
  root.updateMatrixWorld(true)
  return { root, inside, outside, shared }
}

function parts(over: Record<string, unknown> = {}): readonly TwinPart[] {
  return normalizeTwinConfig({
    parts: [{ id: 'p1', name: '泵', nodes: ['pump'], ...over }],
  }).parts
}

describe('距离显隐', () => {
  it('远于阈值时把部件命中的对象全部隐藏', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(
      buildNodeIndex(root),
      parts({ visibility: { hideAbove: { ref: 'orbit', value: 5 } } }),
    )

    layer.apply(context(50))

    expect(root.getObjectByName('pump')?.visible).toBe(false)
    layer.dispose()
  })

  it('回到阈值内又显示出来', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(
      buildNodeIndex(root),
      parts({ visibility: { hideAbove: { ref: 'orbit', value: 5 } } }),
    )

    layer.apply(context(50))
    layer.apply(context(1))

    expect(root.getObjectByName('pump')?.visible).toBe(true)
    layer.dispose()
  })

  it('没配距离规则的部件不被碰', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    layer.apply(context(9999))

    expect(root.getObjectByName('pump')?.visible).toBe(true)
    layer.dispose()
  })

  it('部件一个节点都没命中时不出错', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts({ nodes: ['不存在'] }))

    expect(() => layer.apply(context(10))).not.toThrow()
    layer.dispose()
  })
})

describe('淡出', () => {
  const FADED = {
    visibility: {
      fade: { at: { ref: 'orbit', value: 5 }, direction: 'above', opacity: 0.25 },
    },
  }

  // ⚠ 这条是本文件的要点：共用材质被就地调暗时，画面上毫不相干的地方也跟着淡
  it('只淡本部件的网格，共用同一份材质的别处不受影响', () => {
    const { root, inside, outside, shared } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts(FADED))

    layer.apply(context(50))

    expect(inside.material).not.toBe(shared)
    expect(outside.material).toBe(shared)
    expect(shared.opacity).toBe(1)
    layer.dispose()
  })

  it('淡出时按配的不透明度缩，回到阈值内恢复', () => {
    const { root, inside } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts(FADED))

    layer.apply(context(50))
    const faded = inside.material
    expect(faded).toBeInstanceOf(THREE.Material)
    if (!(faded instanceof THREE.Material)) throw new Error('材质没被克隆')
    expect(faded.opacity).toBeCloseTo(0.25)

    layer.apply(context(1))
    expect(faded.opacity).toBeCloseTo(1)
    layer.dispose()
  })

  it('没配淡出的部件不克隆材质，省下这份开销', () => {
    const { root, inside, shared } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(inside.material).toBe(shared)
    layer.dispose()
  })

  // 克隆件没人替我们收：模型卸载时释放的是它自己那份原始材质
  it('释放时把克隆出来的材质一起 dispose', () => {
    const { root, inside } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts(FADED))
    const clone = inside.material
    if (!(clone instanceof THREE.Material)) throw new Error('材质没被克隆')
    let disposed = false
    clone.addEventListener('dispose', () => {
      disposed = true
    })

    layer.dispose()

    expect(disposed).toBe(true)
  })
})

describe('点击要用的归属与包围盒', () => {
  // ⚠ 命中的是网格，而部件寻址的是它的祖先节点名；只比对象本身就永远找不到部件
  it('从命中的子网格顺着父链找得到部件', () => {
    const { root, inside } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.partAt(inside)?.id).toBe('p1')
    layer.dispose()
  })

  it('不属于任何部件的对象给 null', () => {
    const { root, outside } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.partAt(outside)).toBeNull()
    layer.dispose()
  })

  it('给得出部件的中心与包围盒', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.centerOf('p1')).toBeInstanceOf(THREE.Vector3)
    expect(layer.boxOf('p1')?.isEmpty()).toBe(false)
    layer.dispose()
  })

  it('没命中任何节点的部件，中心与包围盒都是 null', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts({ nodes: ['不存在'] }))

    expect(layer.centerOf('p1')).toBeNull()
    expect(layer.boxOf('p1')).toBeNull()
    layer.dispose()
  })

  it('重建之后不再认得上一份配置里的部件', () => {
    const { root } = model()
    const layer = new PartDistanceLayer()
    layer.build(buildNodeIndex(root), parts())

    layer.build(buildNodeIndex(root), [])

    expect(layer.centerOf('p1')).toBeNull()
    layer.dispose()
  })
})
