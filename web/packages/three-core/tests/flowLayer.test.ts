/**
 * @fileoverview 能量流层守三样：GPU 资源收得干净、路径缺点时不建半条流、
 * 以及任何一个外部数都不会变成 NaN 坐标。
 *
 * ⚠ NaN 坐标是这一层最贵的错：它让包围盒失效、整条流被剔出画面，
 * 而全程没有一处报错——只能靠这里的用例守。
 * ⚠ 泄漏是第二贵的：编辑器一开就是几天，每次重建漏一份几何，
 * 表现是「用久了越来越卡」，同样不报错。
 */
import type { TwinAnchor, TwinFlowLink, Vec3 } from '@dt/twin-config'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FlowLayer } from '../src/flowLayer'

const ALWAYS_SHOWN = {
  visible: true,
  hideBelow: null,
  hideAbove: null,
  fade: null,
}

function flow(overrides: Partial<TwinFlowLink> = {}): TwinFlowLink {
  return {
    id: 'f1',
    name: '冷却水',
    kind: 'water',
    pathAnchors: ['a1', 'a2'],
    width: 1,
    reversible: false,
    visibility: ALWAYS_SHOWN,
    ...overrides,
  }
}

function anchor(id: string, position: Vec3): TwinAnchor {
  return {
    id,
    name: id,
    position,
    label: '',
    unit: '',
    decimals: null,
    visibility: ALWAYS_SHOWN,
  }
}

/** 一条从原点沿 +X 走 10 个单位的直路径 */
const LINE: TwinAnchor[] = [anchor('a1', [0, 0, 0]), anchor('a2', [10, 0, 0])]

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function meshesOf(layer: FlowLayer): THREE.Mesh[] {
  const found: THREE.Object3D[] = []
  layer.group.traverse((object: THREE.Object3D) => {
    found.push(object)
  })
  return found.filter(isMesh)
}

function tubesOf(layer: FlowLayer): THREE.Mesh[] {
  return meshesOf(layer).filter(
    (mesh) => mesh.geometry instanceof THREE.TubeGeometry,
  )
}

function particlesOf(layer: FlowLayer): THREE.Mesh[] {
  return meshesOf(layer).filter(
    (mesh) => mesh.geometry instanceof THREE.SphereGeometry,
  )
}

/** 第一根管线；一根都没有时当场失败，别让断言在 undefined 上悄悄通过。 */
function firstTube(layer: FlowLayer): THREE.Mesh {
  const tube = tubesOf(layer)[0]
  if (tube === undefined) throw new Error('这份输入本该建出管线')
  return tube
}

function firstParticle(layer: FlowLayer): THREE.Mesh {
  const particle = particlesOf(layer)[0]
  if (particle === undefined) throw new Error('这份输入本该建出粒子')
  return particle
}

function materialOf(mesh: THREE.Mesh): THREE.MeshBasicMaterial {
  const material = mesh.material
  if (Array.isArray(material) || !(material instanceof THREE.MeshBasicMaterial))
    throw new Error('这一层每条流只用一份 MeshBasicMaterial')
  return material
}

function particleCoords(layer: FlowLayer): number[] {
  return particlesOf(layer).flatMap((mesh) => [
    mesh.position.x,
    mesh.position.y,
    mesh.position.z,
  ])
}

function vertexCoords(mesh: THREE.Mesh): number[] {
  return Array.from(mesh.geometry.getAttribute('position').array)
}

function hasNaN(values: readonly number[]): boolean {
  return values.some((value) => Number.isNaN(value))
}

let hosts: HTMLElement[] = []

function hostWith(token: string, value: string): HTMLElement {
  const element = document.createElement('div')
  element.style.setProperty(token, value)
  document.body.append(element)
  hosts.push(element)
  return element
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('建与清', () => {
  it('一条流建一根管线加一串粒子', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)

    expect(tubesOf(layer)).toHaveLength(1)
    expect(particlesOf(layer).length).toBeGreaterThan(1)
  })

  it('可解析的点不足两个就不建对象', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ pathAnchors: ['a1'] })], LINE)

    expect(meshesOf(layer)).toHaveLength(0)
  })

  it('悬空的锚点引用只跳过那个点，剩下的点仍然成线', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ pathAnchors: ['a1', 'ghost', 'a2'] })], LINE)

    expect(tubesOf(layer)).toHaveLength(1)
    expect(hasNaN(vertexCoords(firstTube(layer)))).toBe(false)
  })

  it('全是悬空引用时一个对象都不建', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ pathAnchors: ['ghost1', 'ghost2'] })], LINE)

    expect(meshesOf(layer)).toHaveLength(0)
  })

  // ⚠ CatmullRom 在重合点上切线是零向量，TubeGeometry 归一化它会写出 NaN 顶点，
  // 那根管线会整根从画面上消失
  it('连着的重合点并成一个点，并不了两点就不建', () => {
    const layer = new FlowLayer(null)
    const same: TwinAnchor[] = [
      anchor('a1', [1, 2, 3]),
      anchor('a2', [1, 2, 3]),
    ]
    layer.build([flow()], same)

    expect(meshesOf(layer)).toHaveLength(0)
  })

  it('重合点被并掉后剩下的路径不出 NaN 顶点', () => {
    const layer = new FlowLayer(null)
    const path: TwinAnchor[] = [
      anchor('a1', [0, 0, 0]),
      anchor('a2', [0, 0, 0]),
      anchor('a3', [10, 0, 0]),
    ]
    layer.build([flow({ pathAnchors: ['a1', 'a2', 'a3'] })], path)

    expect(hasNaN(vertexCoords(firstTube(layer)))).toBe(false)
  })

  it('看不见的流一个对象都不建', () => {
    const layer = new FlowLayer(null)
    layer.build(
      [
        flow({
          visibility: {
            visible: false,
            hideBelow: null,
            hideAbove: null,
            fade: null,
          },
        }),
      ],
      LINE,
    )

    expect(meshesOf(layer)).toHaveLength(0)
  })

  it('重建先清旧的，不叠加', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ id: 'f1' }), flow({ id: 'f2' })], LINE)
    layer.build([flow({ id: 'f3' })], LINE)

    expect(tubesOf(layer)).toHaveLength(1)
  })

  it('粒子几何全场共用，不是一条流一份', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ id: 'f1' }), flow({ id: 'f2' })], LINE)
    const geometries = new Set(particlesOf(layer).map((mesh) => mesh.geometry))

    expect(geometries.size).toBe(1)
  })

  it('粒子建完就在路径上，不等第一帧', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)

    expect(hasNaN(particleCoords(layer))).toBe(false)
    expect(firstParticle(layer).position.x).toBeCloseTo(0)
  })
})

describe('释放', () => {
  it('管线几何、粒子几何与两份材质都 dispose 掉', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    const tube = firstTube(layer)
    const particle = firstParticle(layer)
    const spies = [
      vi.spyOn(tube.geometry, 'dispose'),
      vi.spyOn(particle.geometry, 'dispose'),
      vi.spyOn(materialOf(tube), 'dispose'),
      vi.spyOn(materialOf(particle), 'dispose'),
    ]

    layer.dispose()

    for (const spy of spies) expect(spy).toHaveBeenCalled()
  })

  it('清完之后组里什么都不剩', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.dispose()

    expect(layer.group.children).toHaveLength(0)
  })

  it('重建时旧的管线几何也 dispose 掉', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    const spy = vi.spyOn(firstTube(layer).geometry, 'dispose')

    layer.build([flow()], LINE)

    expect(spy).toHaveBeenCalled()
  })

  it('改体量时被换掉的管线几何也 dispose 掉', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    const spy = vi.spyOn(firstTube(layer).geometry, 'dispose')

    layer.setWorldScale(50)

    expect(spy).toHaveBeenCalled()
  })
})

describe('强度与激活', () => {
  it('正强度让粒子往前走', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeGreaterThan(0)
  })

  it('强度大的走得更远', () => {
    const fast = new FlowLayer(null)
    fast.build([flow()], LINE)
    fast.setValues({ f1: { intensity: 1, active: true } })
    fast.update(0.1)
    const slow = new FlowLayer(null)
    slow.build([flow()], LINE)
    slow.setValues({ f1: { intensity: 0.2, active: true } })
    slow.update(0.1)

    expect(firstParticle(fast).position.x).toBeGreaterThan(
      firstParticle(slow).position.x,
    )
  })

  it('数字字符串的强度也认', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: '1', active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeGreaterThan(0)
  })

  it('取不到这条流的值时静止', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ other: { intensity: 1, active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
    expect(hasNaN(particleCoords(layer))).toBe(false)
  })

  it('强度是 NaN 时静止，位置里也没有 NaN', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: Number.NaN, active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
    expect(hasNaN(particleCoords(layer))).toBe(false)
  })

  it('强度是一段读不出数的文本时静止', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: '未知', active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
  })

  it('active 为假时静止且灰显', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: false } })
    layer.update(0.1)
    const material = materialOf(firstParticle(layer))

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
    expect(material.color.getHexString()).toBe('6b7686')
    expect(material.opacity).toBeLessThan(0.2)
  })

  it('active 为 0 同样当停流', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: 0 } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
  })

  // ⚠ 字符串 'false' 在 JS 里是真值，直接 Boolean() 会把「停机」读成「在跑」
  it("active 是字符串 'false' 时当停流", () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: 'false' } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
  })

  it('active 是非空文本时当在流', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: 'on' } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeGreaterThan(0)
  })

  // ⚠ 只绑强度不绑激活是常见配法，把没绑当停流会让那条流永远灰着不动
  it('只绑了强度没绑激活时照常流动', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: undefined } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeGreaterThan(0)
    expect(materialOf(firstParticle(layer)).color.getHexString()).not.toBe(
      '6b7686',
    )
  })

  it('停流之后再恢复，颜色跟着回来', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: false } })
    layer.setValues({ f1: { intensity: 1, active: true } })

    expect(materialOf(firstParticle(layer)).color.getHexString()).toBe('4cc9ff')
  })
})

describe('方向', () => {
  // ⚠ 不许反向的流拿到负强度按静止处理，取绝对值会让倒送看起来一切正常
  it('reversible 为假时负强度不反向也不正向', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ reversible: false })], LINE)
    layer.setValues({ f1: { intensity: -1, active: true } })
    layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
  })

  it('reversible 为真时负强度往回流', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ reversible: true })], LINE)
    layer.setValues({ f1: { intensity: -1, active: true } })
    layer.update(0.1)

    // 从头往回走一步就绕回路径末端
    expect(firstParticle(layer).position.x).toBeGreaterThan(9)
    expect(hasNaN(particleCoords(layer))).toBe(false)
  })
})

describe('帧间隔', () => {
  it('deltaSeconds 是 NaN 时不推进，也不写出 NaN 坐标', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: true } })
    layer.update(Number.NaN)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
    expect(hasNaN(particleCoords(layer))).toBe(false)
  })

  it('deltaSeconds 为负时不倒着走', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: true } })
    layer.update(-1)

    expect(firstParticle(layer).position.x).toBeCloseTo(0)
    expect(hasNaN(particleCoords(layer))).toBe(false)
  })

  // ⚠ 标签页切走再切回时 deltaSeconds 是几十秒，不卡上限粒子会一次跳过整条路径
  it('超长的一帧按上限截断', () => {
    const capped = new FlowLayer(null)
    capped.build([flow()], LINE)
    capped.setValues({ f1: { intensity: 1, active: true } })
    capped.update(30)
    const stepped = new FlowLayer(null)
    stepped.build([flow()], LINE)
    stepped.setValues({ f1: { intensity: 1, active: true } })
    stepped.update(0.1)

    expect(firstParticle(capped).position.x).toBeCloseTo(
      firstParticle(stepped).position.x,
    )
  })

  it('相位绕满一圈之后仍留在路径上', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: true } })
    layer.setWorldScale(1000)
    for (let tick = 0; tick < 50; tick += 1) layer.update(0.1)

    expect(firstParticle(layer).position.x).toBeGreaterThanOrEqual(0)
    expect(firstParticle(layer).position.x).toBeLessThanOrEqual(10)
  })
})

describe('随模型体量缩放', () => {
  it('大模型上管线与粒子都更粗', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setWorldScale(100)
    const big = firstParticle(layer).scale.x
    layer.setWorldScale(1)
    const small = firstParticle(layer).scale.x

    expect(big).toBeGreaterThan(small)
  })

  it('体量大的模型上流速也跟着快', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setValues({ f1: { intensity: 1, active: true } })
    layer.update(0.1)
    const slow = firstParticle(layer).position.x
    layer.setWorldScale(100)
    layer.update(0.1)
    const advanced = firstParticle(layer).position.x - slow

    expect(advanced).toBeGreaterThan(slow)
  })

  it('线宽因子大的流管线更粗', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ id: 'f1', width: 4 })], LINE)
    const wide = firstParticle(layer).scale.x
    layer.build([flow({ id: 'f1', width: 1 })], LINE)

    expect(wide).toBeGreaterThan(firstParticle(layer).scale.x)
  })

  it('对角线取不到时按 1 算，不产出 NaN 尺寸', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setWorldScale(Number.NaN)

    expect(Number.isNaN(firstParticle(layer).scale.x)).toBe(false)
    expect(hasNaN(vertexCoords(firstTube(layer)))).toBe(false)
  })

  it('对角线是 0 时同样按 1 算', () => {
    const layer = new FlowLayer(null)
    layer.build([flow()], LINE)
    layer.setWorldScale(0)

    expect(firstParticle(layer).scale.x).toBeGreaterThan(0)
  })
})

describe('种类配色', () => {
  it('认得的种类用内置色', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ kind: 'electricity' })], LINE)

    expect(materialOf(firstParticle(layer)).color.getHexString()).toBe('ffd166')
  })

  it('空的种类用缺省色', () => {
    const layer = new FlowLayer(null)
    layer.build([flow({ kind: '' })], LINE)

    expect(materialOf(firstParticle(layer)).color.getHexString()).toBe('00cefc')
  })

  it('主题里配了这一种类的 token 时以主题为准', () => {
    const host = hostWith('--flow-water', '#123456')
    const layer = new FlowLayer(host)
    layer.build([flow({ kind: 'Water' })], LINE)

    expect(materialOf(firstParticle(layer)).color.getHexString()).toBe('123456')
  })

  it('种类名不是 token 形状时不去拼变量名，直接用缺省色', () => {
    const host = hostWith('--flow-water', '#123456')
    const layer = new FlowLayer(host)
    layer.build([flow({ kind: '冷却 水' })], LINE)

    expect(materialOf(firstParticle(layer)).color.getHexString()).toBe('00cefc')
  })
})
