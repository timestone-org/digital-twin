/**
 * @fileoverview 守锚点层的契约：只建可见锚点、读数取不到时显示占位符而不是空白、
 * 标签文本只走 textContent（不给注入留口子）、dispose 连 CSS2D 的 DOM 一起带走。
 */
import type {
  TwinAnchor,
  TwinVisibilityRule,
  TwinAnchorValues,
} from '@dt/twin-config'
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AnchorLayer } from '../src/anchorLayer'

let hosts: HTMLElement[] = []
let layers: AnchorLayer[] = []

function host(): HTMLElement {
  const element = document.createElement('div')
  element.style.setProperty('--accent-primary', '#00cefc')
  document.body.append(element)
  hosts.push(element)
  return element
}

function layerOn(element: HTMLElement | null): AnchorLayer {
  const layer = new AnchorLayer(element)
  layers.push(layer)
  return layer
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const layer of layers) layer.dispose()
  layers = []
  for (const element of hosts) element.remove()
  hosts = []
})

function anchor(overrides: Partial<TwinAnchor> = {}): TwinAnchor {
  return {
    id: 'a1',
    name: '出口温度',
    position: [1, 2, 3],
    label: '',
    unit: '℃',
    decimals: 1,
    visibility: visibility(true),
    ...overrides,
  }
}

/** 只置基线显隐的一份规则；距离那几条不在本层的关注范围里。 */
function visibility(visible: boolean): TwinVisibilityRule {
  return { visible, hideBelow: null, hideAbove: null, fade: null }
}

function labelTexts(layer: AnchorLayer): string[] {
  return layer.group.children
    .filter(
      (child): child is THREE.Object3D & { element: HTMLElement } =>
        'element' in child,
    )
    .map((child) => child.element.textContent ?? '')
}

describe('建锚点', () => {
  it('每个可见锚点建一个小球加一张标签', () => {
    const layer = layerOn(host())

    layer.build([anchor(), anchor({ id: 'a2', name: '回水温度' })])

    expect(layer.group.children).toHaveLength(4)
  })

  it('不可见的锚点一个对象都不建', () => {
    const layer = layerOn(host())

    layer.build([anchor({ visibility: visibility(false) })])

    expect(layer.group.children).toHaveLength(0)
  })

  it('小球落在锚点的世界坐标上', () => {
    const layer = layerOn(host())

    layer.build([anchor()])
    const dot = layer.group.children.find(
      (child): child is THREE.Mesh => child instanceof THREE.Mesh,
    )

    expect(dot?.position.toArray()).toEqual([1, 2, 3])
  })

  it('小球取 token 色，宿主拿不到 token 时用装饰兜底色', () => {
    const themed = layerOn(host())
    const bare = layerOn(null)

    themed.build([anchor()])
    bare.build([anchor()])
    const themedDot = themed.group.children[0] as THREE.Mesh
    const bareDot = bare.group.children[0] as THREE.Mesh

    expect(
      (themedDot.material as THREE.MeshBasicMaterial).color.getHexString(),
    ).toBe('00cefc')
    expect(
      (bareDot.material as THREE.MeshBasicMaterial).color.getHexString(),
    ).toBe('00cefc')
  })

  it('重建时先清干净，旧锚点的材质随之释放', () => {
    const layer = layerOn(host())
    layer.build([anchor(), anchor({ id: 'a2' })])
    const stale = layer.group.children[0] as THREE.Mesh
    const materialDispose = vi.spyOn(
      stale.material as THREE.Material,
      'dispose',
    )

    layer.build([anchor()])

    expect(layer.group.children).toHaveLength(2)
    expect(materialDispose).toHaveBeenCalledTimes(1)
  })
})

describe('读数', () => {
  it('没有值时显示占位符，不留空白', () => {
    const layer = layerOn(host())

    layer.build([anchor()])

    expect(labelTexts(layer)).toEqual(['出口温度—'])
  })

  it('注入值后按小数位与单位成文', () => {
    const layer = layerOn(host())
    layer.build([anchor()])

    layer.setValues({ a1: { value: 36.456 } })

    expect(labelTexts(layer)).toEqual(['出口温度36.5 ℃'])
  })

  it('有值但拼不出任何文本时也给占位符，不留空白', () => {
    const layer = layerOn(host())
    layer.build([anchor({ name: '', label: '', unit: '', decimals: null })])

    layer.setValues({ a1: { value: null } })

    expect(labelTexts(layer)).toEqual(['—'])
  })

  it('这一批没带这个锚点时退回占位符', () => {
    const layer = layerOn(host())
    layer.build([anchor()])
    layer.setValues({ a1: { value: 36.456 } })

    layer.setValues({})

    expect(labelTexts(layer)).toEqual(['出口温度—'])
  })

  it('锚点名与单位只进 textContent，标记不会被当成 HTML', () => {
    const layer = layerOn(host())

    layer.build([anchor({ name: '<img src=x onerror=alert(1)>' })])
    layer.setValues({ a1: { value: 1 } })
    const label = layer.group.children.find(
      (child): child is THREE.Object3D & { element: HTMLElement } =>
        'element' in child,
    )

    expect(label?.element.querySelector('img')).toBeNull()
    expect(label?.element.textContent).toContain('<img src=x onerror=alert(1)>')
  })

  it('重建之前注入的值不会串到新锚点上', () => {
    const layer = layerOn(host())
    layer.build([anchor()])
    layer.setValues({ a1: { value: 36.456 } })

    layer.build([anchor({ id: 'a2', name: '回水温度' })])

    expect(labelTexts(layer)).toEqual(['回水温度—'])
  })
})

describe('尺寸与释放', () => {
  it('小球尺寸跟模型体量走，并按上下限夹取', () => {
    const layer = layerOn(host())
    layer.build([anchor()])

    layer.setWorldScale(100)
    const dot = layer.group.children[0] as THREE.Mesh

    expect(dot.scale.x).toBeCloseTo(0.6, 6)
  })

  it('体量取不到时按 1 算，落到半径下限', () => {
    const layer = layerOn(host())
    layer.build([anchor()])

    layer.setWorldScale(Number.NaN)
    const dot = layer.group.children[0] as THREE.Mesh

    expect(dot.scale.x).toBeCloseTo(0.02, 6)
  })

  it('标签跟着小球抬高，不压在球上', () => {
    const layer = layerOn(host())
    layer.build([anchor()])

    layer.setWorldScale(100)
    const label = layer.group.children[1]

    expect(label?.position.y).toBeCloseTo(3.32, 2)
  })

  it('释放时几何与材质逐个 dispose，标签的 DOM 一并摘走', () => {
    const layer = layerOn(host())
    layer.build([anchor()])
    const dot = layer.group.children[0] as THREE.Mesh
    const label = layer.group.children[1] as THREE.Object3D & {
      element: HTMLElement
    }
    document.body.append(label.element)
    const geometryDispose = vi.spyOn(dot.geometry, 'dispose')
    const materialDispose = vi.spyOn(dot.material as THREE.Material, 'dispose')

    layer.dispose()

    expect(geometryDispose).toHaveBeenCalledTimes(1)
    expect(materialDispose).toHaveBeenCalledTimes(1)
    expect(label.element.parentElement).toBeNull()
    expect(layer.group.children).toHaveLength(0)
  })

  it('没有锚点时释放不抛错', () => {
    const layer = layerOn(host())

    expect(() => {
      layer.dispose()
    }).not.toThrow()
  })

  it('没有锚点时注入值不抛错', () => {
    const layer = layerOn(host())
    const values: TwinAnchorValues = { a1: { value: 1 } }

    expect(() => {
      layer.setValues(values)
    }).not.toThrow()
  })
})
