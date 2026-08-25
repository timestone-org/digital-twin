/**
 * @fileoverview 部件这一层：距离显隐、淡出、透明度与状态染色，以及点击要用的
 * 部件归属与包围盒。
 *
 * ⚠ 改外观走克隆材质。不克隆的话，GLB 里被多个网格共用的那份材质会被一起改——
 * 画面上是「毫不相干的地方也跟着变了」，而且看不出是谁干的。
 */
import { normalizeTwinConfig, type TwinPart } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import type { DistanceContext } from '../src/distanceContext'
import { buildNodeIndex } from '../src/nodeIndex'
import { PartsLayer } from '../src/partsLayer'

// ⚠ 显式标返回类型：`instanceof` 就地收窄出来的是 Mesh<any, any, any>
function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

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
    const layer = new PartsLayer()
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
    const layer = new PartsLayer()
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
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    layer.apply(context(9999))

    expect(root.getObjectByName('pump')?.visible).toBe(true)
    layer.dispose()
  })

  it('部件一个节点都没命中时不出错', () => {
    const { root } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts({ nodes: ['不存在'] }))

    expect(() => layer.apply(context(10))).not.toThrow()
    layer.dispose()
  })
})

describe('淡出', () => {
  const FADED = {
    visibility: {
      fade: {
        at: { ref: 'orbit', value: 5 },
        direction: 'above',
        opacity: 0.25,
      },
    },
  }

  // ⚠ 这条是本文件的要点：共用材质被就地调暗时，画面上毫不相干的地方也跟着淡
  it('只淡本部件的网格，共用同一份材质的别处不受影响', () => {
    const { root, inside, outside, shared } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts(FADED))

    layer.apply(context(50))

    expect(inside.material).not.toBe(shared)
    expect(outside.material).toBe(shared)
    expect(shared.opacity).toBe(1)
    layer.dispose()
  })

  it('淡出时按配的不透明度缩，回到阈值内恢复', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
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
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(inside.material).toBe(shared)
    layer.dispose()
  })

  // 克隆件没人替我们收：模型卸载时释放的是它自己那份原始材质
  it('释放时把克隆出来的材质一起 dispose', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
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
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.partAt(inside)?.id).toBe('p1')
    layer.dispose()
  })

  it('不属于任何部件的对象给 null', () => {
    const { root, outside } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.partAt(outside)).toBeNull()
    layer.dispose()
  })

  it('给得出部件的中心与包围盒', () => {
    const { root } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    expect(layer.centerOf('p1')).toBeInstanceOf(THREE.Vector3)
    expect(layer.boxOf('p1')?.isEmpty()).toBe(false)
    layer.dispose()
  })

  it('没命中任何节点的部件，中心与包围盒都是 null', () => {
    const { root } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts({ nodes: ['不存在'] }))

    expect(layer.centerOf('p1')).toBeNull()
    expect(layer.boxOf('p1')).toBeNull()
    layer.dispose()
  })

  it('重建之后不再认得上一份配置里的部件', () => {
    const { root } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts())

    layer.build(buildNodeIndex(root), [])

    expect(layer.centerOf('p1')).toBeNull()
    layer.dispose()
  })
})

describe('常态外观', () => {
  it('配了透明度就克隆材质并按倍率缩', () => {
    const { root, inside, shared } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts({ look: { opacity: 0.3 } }))

    layer.apply(context(10))

    expect(inside.material).not.toBe(shared)
    if (!(inside.material instanceof THREE.Material)) {
      throw new Error('材质没被克隆')
    }
    expect(inside.material.opacity).toBeCloseTo(0.3)
    expect(shared.opacity).toBe(1)
    layer.dispose()
  })

  // ⚠ 淡出写成覆盖的话，半透明外壳一进近景反而比平时更实
  it('距离淡出乘在配置的透明度上，不是覆盖它', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    layer.build(
      buildNodeIndex(root),
      parts({
        look: { opacity: 0.5 },
        visibility: {
          fade: {
            at: { ref: 'orbit', value: 5 },
            direction: 'above',
            opacity: 0.4,
          },
        },
      }),
    )

    layer.apply(context(50))

    if (!(inside.material instanceof THREE.Material)) {
      throw new Error('材质没被克隆')
    }
    expect(inside.material.opacity).toBeCloseTo(0.2)
    layer.dispose()
  })

  it('配了常态色就按浓度染上去', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    layer.build(
      buildNodeIndex(root),
      parts({ look: { color: '#00ff00', blend: 1 } }),
    )

    layer.apply(context(10))

    if (!(inside.material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('材质没被克隆')
    }
    expect(inside.material.color.getHexString()).toBe('00ff00')
    layer.dispose()
  })
})

describe('状态染色', () => {
  // 浓度钉成 1：默认的 0.85 会把原色掺进来，断言就得写成一串看不懂的十六进制
  const TINTED = {
    look: { blend: 1 },
    tint: {
      stops: [
        { id: 'run', match: 'equals', equals: '1', color: '#00ff00' },
        { id: 'stop', match: 'equals', equals: '0', color: '#ff0000' },
      ],
      fallback: '#888888',
    },
  }

  function materialOf(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
    if (!(mesh.material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('材质没被克隆')
    }
    return mesh.material
  }

  it('实时值命中哪一档就染哪个色', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts(TINTED))

    layer.setValues({ p1: { value: 1 } })
    layer.apply(context(10))
    expect(materialOf(inside).color.getHexString()).toBe('00ff00')

    layer.setValues({ p1: { value: 0 } })
    layer.apply(context(10))
    expect(materialOf(inside).color.getHexString()).toBe('ff0000')
    layer.dispose()
  })

  // ⚠ 不回落的话，点位掉线后部件停在最后一次命中的颜色上，画面看不出那是陈旧的
  it('取不到数时走回落色', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts(TINTED))

    layer.setValues({ p1: { value: 1 } })
    layer.apply(context(10))
    layer.setValues({})
    layer.apply(context(10))

    expect(materialOf(inside).color.getHexString()).toBe('888888')
    layer.dispose()
  })

  it('渐变按值在区间里的位置插两端的色', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    layer.build(
      buildNodeIndex(root),
      parts({
        look: { blend: 1 },
        tint: {
          mode: 'gradient',
          gradient: { min: 0, max: 100, from: '#000000', to: '#ffffff' },
        },
      }),
    )

    layer.setValues({ p1: { value: 100 } })
    layer.apply(context(10))

    expect(materialOf(inside).color.getHexString()).toBe('ffffff')
    layer.dispose()
  })

  // ⚠ 每个部件各有一份取色暂存：共用一个的话，所有部件都会拿到最后一个算出的色
  it('两个部件同帧走渐变时互不串色', () => {
    const root = new THREE.Group()
    for (const name of ['a', 'b']) {
      const holder = new THREE.Group()
      holder.name = name
      holder.add(
        new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 1),
          new THREE.MeshStandardMaterial(),
        ),
      )
      root.add(holder)
    }
    root.updateMatrixWorld(true)
    const gradient = {
      mode: 'gradient',
      gradient: { min: 0, max: 100, from: '#000000', to: '#ffffff' },
    }
    const built = normalizeTwinConfig({
      parts: [
        { id: 'pa', nodes: ['a'], look: { blend: 1 }, tint: gradient },
        { id: 'pb', nodes: ['b'], look: { blend: 1 }, tint: gradient },
      ],
    }).parts
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), built)

    layer.setValues({ pa: { value: 0 }, pb: { value: 100 } })
    layer.apply(context(10))

    // ⚠ `instanceof THREE.Mesh` 收窄出来的是 Mesh<any, any, any>，三个 any 会
    //   一路漏到调用方；显式标注参数类型把它收回来
    const meshOf = (name: string): THREE.Mesh => {
      const found: THREE.Object3D | undefined =
        root.getObjectByName(name)?.children[0]
      if (found === undefined || !isMesh(found)) throw new Error('找不到网格')
      return found
    }
    expect(materialOf(meshOf('a')).color.getHexString()).toBe('000000')
    expect(materialOf(meshOf('b')).color.getHexString()).toBe('ffffff')
    layer.dispose()
  })

  // ⚠ 解析不出来时不回落成某个默认色：那会让「token 名写错了」看起来像「配对了」
  it('宿主取不到 token 时保持原色，不猜一个色', () => {
    const { root, inside } = model()
    const layer = new PartsLayer(null)
    layer.build(
      buildNodeIndex(root),
      parts({
        tint: { stops: [{ id: 'x', match: 'range', color: '--state-danger' }] },
      }),
    )

    layer.setValues({ p1: { value: 5 } })
    layer.apply(context(10))

    expect(materialOf(inside).color.getHexString()).toBe('ff0000')
    layer.dispose()
  })

  it('配了染色的部件即使还没有值也克隆材质，值一到就染得上', () => {
    const { root, inside, shared } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts(TINTED))

    expect(inside.material).not.toBe(shared)
    layer.dispose()
  })
})

describe('重建', () => {
  // ⚠ 编辑器每改一次配置都会重建这一层：不把原材质装回去的话，克隆的是上一次
  //   改过的那一份，透明度每重建一次就更暗一层，而且没有任何报错
  it('反复重建不让透明度一路往下漂', () => {
    const { root, inside } = model()
    const layer = new PartsLayer()
    const config = parts({ look: { opacity: 0.5 } })

    for (let round = 0; round < 3; round += 1) {
      layer.build(buildNodeIndex(root), config)
      layer.applyAppearance()
    }

    if (!(inside.material instanceof THREE.Material)) {
      throw new Error('材质没被克隆')
    }
    expect(inside.material.opacity).toBeCloseTo(0.5)
    layer.dispose()
  })

  it('释放之后网格拿回它自己那份材质', () => {
    const { root, inside, shared } = model()
    const layer = new PartsLayer()
    layer.build(buildNodeIndex(root), parts({ look: { opacity: 0.5 } }))

    layer.dispose()

    expect(inside.material).toBe(shared)
  })
})
