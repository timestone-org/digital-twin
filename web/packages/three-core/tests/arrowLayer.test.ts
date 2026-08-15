/**
 * @fileoverview 箭头层守三样：GPU 资源与 DOM 都能收干净、朝向不出 NaN、
 * 读数取不到时说取不到。
 *
 * ⚠ 泄漏是这一层最贵的错：编辑器一开就是几天，每次重建都漏一份几何与材质时，
 * 表现是「用久了越来越卡」，而没有任何一处报错。CSS2D 的 DOM 尤其容易漏——
 * 从场景图上摘下对象带不走它，标签会留在页面上飘着。
 */
import type { TwinArrow } from '@dt/twin-config'
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { ArrowLayer } from '../src/arrowLayer'

function arrow(overrides: Partial<TwinArrow> = {}): TwinArrow {
  return {
    id: 'a1',
    name: '进气',
    position: [0, 0, 0],
    direction: [0, 1, 0],
    length: 1,
    width: 1,
    labelText: '',
    prefix: '',
    unit: 'm/s',
    decimals: 1,
    color: '#00ff00',
    visibility: { visible: true, hideBelow: null, hideAbove: null, fade: null },
    ...overrides,
  }
}

function labelTexts(layer: ArrowLayer): string[] {
  return layer.group.children
    .filter((child) => child.type === 'Object3D' && 'element' in child)
    .map((child) => {
      const element = (child as unknown as { element: HTMLElement }).element
      return element.textContent ?? ''
    })
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return object instanceof THREE.Mesh
}

function meshesOf(layer: ArrowLayer): THREE.Mesh[] {
  const found: THREE.Object3D[] = []
  layer.group.traverse((object: THREE.Object3D) => {
    found.push(object)
  })
  return found.filter(isMesh)
}

/** 第一个网格；一个都没有时当场失败，别让断言在 undefined 上悄悄通过。 */
function firstMesh(layer: ArrowLayer): THREE.Mesh {
  const mesh = meshesOf(layer)[0]
  if (mesh === undefined) throw new Error('这份输入本该建出网格')
  return mesh
}

describe('建与清', () => {
  it('一支箭头建一根杆加一个锥头', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow()])

    expect(meshesOf(layer)).toHaveLength(2)
  })

  it('看不见的箭头一个对象都不建', () => {
    const layer = new ArrowLayer(null)
    layer.build([
      arrow({
        visibility: {
          visible: false,
          hideBelow: null,
          hideAbove: null,
          fade: null,
        },
      }),
    ])

    expect(meshesOf(layer)).toHaveLength(0)
  })

  it('重建先清旧的，不叠加', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ id: 'a1' }), arrow({ id: 'a2' })])
    layer.build([arrow({ id: 'a3' })])

    expect(meshesOf(layer)).toHaveLength(2)
  })

  it('两份几何全场共用，不是一支箭头一份', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ id: 'a1' }), arrow({ id: 'a2' })])
    const geometries = new Set(meshesOf(layer).map((mesh) => mesh.geometry))

    expect(geometries.size).toBe(2)
  })
})

describe('释放', () => {
  it('几何与材质都 dispose 掉', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow()])
    const mesh = firstMesh(layer)
    const material = mesh.material
    if (Array.isArray(material)) throw new Error('箭头只用一份材质')
    const geometrySpy = vi.spyOn(mesh.geometry, 'dispose')
    const materialSpy = vi.spyOn(material, 'dispose')

    layer.dispose()

    expect(geometrySpy).toHaveBeenCalled()
    expect(materialSpy).toHaveBeenCalled()
  })

  // ⚠ 从场景图上摘下对象带不走 CSS2D 的 DOM，漏了它标签会留在页面上飘着
  it('标签的 DOM 从页面上摘掉', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const layer = new ArrowLayer(null)
    layer.build([arrow({ labelText: '进气' })])
    const element = layer.group.children.find(
      (child) => 'element' in child,
    ) as unknown as { element: HTMLElement }
    host.append(element.element)

    layer.dispose()

    expect(element.element.isConnected).toBe(false)
    host.remove()
  })

  it('清完之后组里什么都不剩', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow()])
    layer.dispose()

    expect(layer.group.children).toHaveLength(0)
  })
})

describe('朝向', () => {
  it('朝 +Y 时不旋转', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ direction: [0, 1, 0] })])
    const pivot = layer.group.children[0]

    expect(pivot?.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0)
  })

  // ⚠ 与 +Y 完全相反时叉积是零向量，setFromUnitVectors 会给出一个不确定的
  // 旋转——那一支箭头指向随机方向，且只在这一个角度上发生
  it('朝 -Y 这个退化角度上也给出确定的翻转', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ direction: [0, -1, 0] })])
    const pivot = layer.group.children[0]
    const tip = new THREE.Vector3(0, 1, 0).applyQuaternion(
      pivot?.quaternion ?? new THREE.Quaternion(),
    )

    expect(tip.y).toBeCloseTo(-1)
    expect(Number.isNaN(tip.x)).toBe(false)
  })

  it('斜向也能对上', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ direction: [1, 0, 0] })])
    const pivot = layer.group.children[0]
    const tip = new THREE.Vector3(0, 1, 0).applyQuaternion(
      pivot?.quaternion ?? new THREE.Quaternion(),
    )

    expect(tip.x).toBeCloseTo(1)
  })
})

describe('读数', () => {
  it('没有值时显示固定文案', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ labelText: '进气' })])

    expect(labelTexts(layer)).toEqual(['进气'])
  })

  it('固定文案与读数拼在一起', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ labelText: '进气' })])
    layer.setValues({ a1: { value: 3.14 } })

    expect(labelTexts(layer)).toEqual(['进气 3.1 m/s'])
  })

  it('两样都空时说取不到，不留一块空白', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ labelText: '', unit: '' })])

    expect(labelTexts(layer)).toEqual(['—'])
  })

  it('非有限数不上屏', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow({ labelText: '进气' })])
    layer.setValues({ a1: { value: Number.NaN } })

    expect(labelTexts(layer)).toEqual(['进气 m/s'])
  })
})

describe('随模型体量缩放', () => {
  it('大模型上箭头跟着变长', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow()])
    layer.setWorldScale(100)
    const big = firstMesh(layer).scale.y
    layer.setWorldScale(1)
    const small = firstMesh(layer).scale.y

    expect(big).toBeGreaterThan(small)
  })

  it('对角线取不到时按 1 算，不产出 NaN 尺寸', () => {
    const layer = new ArrowLayer(null)
    layer.build([arrow()])
    layer.setWorldScale(Number.NaN)

    expect(Number.isNaN(firstMesh(layer).scale.y)).toBe(false)
  })
})
