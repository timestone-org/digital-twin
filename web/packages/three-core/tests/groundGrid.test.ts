/**
 * @fileoverview 守地面网格的口径：开关真的建删而不是只改可见性、关掉要释放
 * GPU 资源、尺寸随模型体量、没有模型时也画得出来。
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

import { GroundGridLayer, gridScaleFor } from '../src/groundGrid'

const GRID_NAME = 'twin-ground-grid'

function layerOf(): { scene: THREE.Scene; layer: GroundGridLayer } {
  const scene = new THREE.Scene()
  return { scene, layer: new GroundGridLayer(scene, null) }
}

function gridIn(scene: THREE.Scene): THREE.GridHelper | null {
  const found = scene.getObjectByName(GRID_NAME)
  return found instanceof THREE.GridHelper ? found : null
}

describe('开关', () => {
  it('打开才建，关着不往场景里放东西', () => {
    const { scene, layer } = layerOf()

    layer.sync(false, 10)

    expect(gridIn(scene)).toBeNull()
    expect(layer.isShown).toBe(false)
  })

  it('打开后场景里有一张网格', () => {
    const { scene, layer } = layerOf()

    layer.sync(true, 10)

    expect(gridIn(scene)).not.toBeNull()
    expect(layer.isShown).toBe(true)
  })

  // ⚠ 只改 visible 的话它仍在渲染树里，且换模型时那份几何一直留着
  it('关掉是摘下来，不是留在场景里改可见性', () => {
    const { scene, layer } = layerOf()
    layer.sync(true, 10)

    layer.sync(false, 10)

    expect(gridIn(scene)).toBeNull()
    expect(scene.children).toHaveLength(0)
  })

  it('反复打开只建一张，不叠罗汉', () => {
    const { scene, layer } = layerOf()

    layer.sync(true, 10)
    layer.sync(true, 20)
    layer.sync(true, 30)

    expect(scene.children).toHaveLength(1)
  })
})

describe('释放', () => {
  it('关掉时几何与材质都 dispose 掉', () => {
    const { scene, layer } = layerOf()
    layer.sync(true, 10)
    const grid = gridIn(scene)
    if (grid === null) throw new Error('网格没建出来')
    const geometry = vi.spyOn(grid.geometry, 'dispose')
    const material = vi.spyOn(grid.material as THREE.Material, 'dispose')

    layer.sync(false, 10)

    expect(geometry).toHaveBeenCalledTimes(1)
    expect(material).toHaveBeenCalledTimes(1)
  })

  it('卸载时同样释放', () => {
    const { scene, layer } = layerOf()
    layer.sync(true, 10)
    const grid = gridIn(scene)
    if (grid === null) throw new Error('网格没建出来')
    const geometry = vi.spyOn(grid.geometry, 'dispose')

    layer.dispose()

    expect(geometry).toHaveBeenCalledTimes(1)
    expect(gridIn(scene)).toBeNull()
  })

  it('没建过就 dispose 不炸', () => {
    const { layer } = layerOf()

    expect(() => layer.dispose()).not.toThrow()
  })
})

describe('尺寸随模型体量', () => {
  it('体量取不到时按 1 倍', () => {
    expect(gridScaleFor(0)).toBe(1)
    expect(gridScaleFor(Number.NaN)).toBe(1)
    expect(gridScaleFor(-5)).toBe(1)
  })

  it('大模型放大、小模型缩小，但都夹在上下限内', () => {
    expect(gridScaleFor(400)).toBeGreaterThan(1)
    expect(gridScaleFor(4)).toBeLessThan(1)
    expect(gridScaleFor(1e9)).toBeLessThanOrEqual(8)
    expect(gridScaleFor(1e-9)).toBeGreaterThanOrEqual(0.2)
  })

  it('体量变了缩放跟着变，不用重建', () => {
    const { scene, layer } = layerOf()
    layer.sync(true, 40)
    const before = gridIn(scene)?.scale.x

    layer.sync(true, 400)

    expect(gridIn(scene)?.scale.x).not.toBe(before)
    expect(scene.children).toHaveLength(1)
  })

  // 网格是独立于模型的参考面：没挑模型时打开开关也该画得出来
  it('没有模型（体量 0）时照样画', () => {
    const { scene, layer } = layerOf()

    layer.sync(true, 0)

    expect(gridIn(scene)).not.toBeNull()
    expect(gridIn(scene)?.scale.x).toBe(1)
  })
})

describe('材质', () => {
  // 网格压在模型下面时不该把模型的像素挖掉
  it('半透明且不写深度', () => {
    const { scene, layer } = layerOf()

    layer.sync(true, 10)

    const material = gridIn(scene)?.material as THREE.Material
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.opacity).toBeLessThan(1)
  })
})
