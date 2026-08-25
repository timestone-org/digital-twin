/**
 * @fileoverview 部件材质记账：克隆、基线、反复套外观。
 *
 * ⚠ 这一层的错都不报错：不克隆就是「改一个部件染了一大片」，不从基线重算就是
 * 「放着不动颜色越来越深」，每帧写 `needsUpdate` 就是「部件一多就掉帧」。
 */
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { PartMaterials, type PartLook } from '../src/partMaterials'

const RED = new THREE.Color('#ff0000')

function look(over: Partial<PartLook> = {}): PartLook {
  return { opacity: 1, color: null, blend: 1, glow: 0, ...over }
}

/** 一份被两个网格共用的材质。 */
function shared(): {
  material: THREE.MeshStandardMaterial
  mine: THREE.Mesh
  other: THREE.Mesh
} {
  const material = new THREE.MeshStandardMaterial({ color: '#0000ff' })
  return {
    material,
    mine: new THREE.Mesh(new THREE.BoxGeometry(), material),
    other: new THREE.Mesh(new THREE.BoxGeometry(), material),
  }
}

function colorOf(mesh: THREE.Mesh): THREE.Color {
  const material = mesh.material
  if (Array.isArray(material) || !('color' in material)) {
    throw new Error('这块网格没有基础色')
  }
  const { color } = material
  if (!(color instanceof THREE.Color)) throw new Error('基础色不是颜色')
  return color
}

describe('材质克隆', () => {
  // ⚠ 不克隆的话，GLB 里共用材质的那一片会跟着变色，而画面上看不出是谁干的
  it('改本部件不影响共用同一份材质的别的网格', () => {
    const { material, mine, other } = shared()
    const layer = new PartMaterials([mine])

    layer.apply(look({ color: RED }))

    expect(colorOf(mine).getHexString()).toBe('ff0000')
    expect(colorOf(other).getHexString()).toBe('0000ff')
    expect(mine.material).not.toBe(material)
    layer.dispose()
  })

  // ⚠ 单材质还原成长度 1 的数组，three 会按分组绘制，几何上没有分组就整块不画
  it('单材质的网格拿回单个材质，不是长度 1 的数组', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])

    expect(Array.isArray(mine.material)).toBe(false)
    layer.dispose()
  })

  it('多材质的网格逐个克隆，仍是数组', () => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshStandardMaterial({ color: '#0000ff' }),
      new THREE.MeshStandardMaterial({ color: '#00ff00' }),
    ])
    const layer = new PartMaterials([mesh])

    layer.apply(look({ color: RED, blend: 1 }))

    const materials = mesh.material
    if (!Array.isArray(materials)) throw new Error('多材质被压成了单材质')
    expect(materials).toHaveLength(2)
    layer.dispose()
  })
})

describe('套外观', () => {
  it('不透明度按基线成比例缩，并打开透明通道', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ opacity: 0.8, transparent: false }),
    )
    const layer = new PartMaterials([mesh])

    layer.apply(look({ opacity: 0.5 }))

    const material = mesh.material
    if (Array.isArray(material)) throw new Error('材质被拆成了数组')
    expect(material.opacity).toBeCloseTo(0.4)
    expect(material.transparent).toBe(true)
    // ⚠ 半透明还写深度会让自己挡住自己，表现是「透明部件里面是空的」
    expect(material.depthWrite).toBe(false)
    layer.dispose()
  })

  // ⚠ 在当前值上叠加的话，同一份外观套两次颜色就更深一层，越用越偏
  it('每次都从基线重算，反复套同一份外观结果不漂', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])

    layer.apply(look({ color: RED, blend: 0.5 }))
    const once = colorOf(mine).getHexString()
    layer.apply(look({ opacity: 0.9 }))
    layer.apply(look({ color: RED, blend: 0.5 }))

    expect(colorOf(mine).getHexString()).toBe(once)
    layer.dispose()
  })

  it('浓度 0 就是完全原色，1 是完全换色', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])

    layer.apply(look({ color: RED, blend: 0 }))
    expect(colorOf(mine).getHexString()).toBe('0000ff')

    layer.apply(look({ color: RED, blend: 1 }))
    expect(colorOf(mine).getHexString()).toBe('ff0000')
    layer.dispose()
  })

  it('自发光跟着染色走，撤掉染色时还原到基线', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({ emissive: '#000000' }),
    )
    const layer = new PartMaterials([mesh])
    const material = mesh.material
    if (Array.isArray(material) || !('emissive' in material)) {
      throw new Error('这块网格没有自发光')
    }

    layer.apply(look({ color: RED, glow: 2 }))
    expect(material.emissive.getHexString()).toBe('ff0000')
    expect(material.emissiveIntensity).toBe(2)

    layer.apply(look())
    expect(material.emissive.getHexString()).toBe('000000')
    expect(material.emissiveIntensity).toBe(1)
    layer.dispose()
  })

  // 没有自发光通道的材质（如 MeshBasicMaterial）跳过，不许在这里抛
  it('没有自发光通道的材质照样能染色', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({ color: '#0000ff' }),
    )
    const layer = new PartMaterials([mesh])

    layer.apply(look({ color: RED, glow: 3 }))

    expect(colorOf(mesh).getHexString()).toBe('ff0000')
    layer.dispose()
  })

  // ⚠ needsUpdate 会触发着色器重编：每帧无脑写一遍，部件一多就掉帧。
  //   `needsUpdate` 只有 setter，读不回来；它每被写一次 `version` 加一
  it('外观没变时一次都不碰材质', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    layer.apply(look({ opacity: 0.5 }))
    const material = mine.material
    if (Array.isArray(material)) throw new Error('材质被拆成了数组')
    const version = material.version

    layer.apply(look({ opacity: 0.5 }))

    expect(material.version).toBe(version)
    layer.dispose()
  })

  it('只是不透明度变了、透明与深度写入没变时也不触发重编', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    layer.apply(look({ opacity: 0.5 }))
    const material = mine.material
    if (Array.isArray(material)) throw new Error('材质被拆成了数组')
    const version = material.version

    layer.apply(look({ opacity: 0.4 }))

    expect(material.opacity).toBeCloseTo(0.4)
    expect(material.version).toBe(version)
    layer.dispose()
  })

  it('跨过「要不要透明通道」时才重编一次', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (Array.isArray(material)) throw new Error('材质被拆成了数组')
    const version = material.version

    layer.apply(look({ opacity: 0.5 }))

    expect(material.version).toBe(version + 1)
    layer.dispose()
  })
})

describe('释放', () => {
  // ⚠ 克隆件没人替我们收：模型卸载时释放的是它自己那份原始材质
  it('把克隆出来的材质逐个 dispose', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (Array.isArray(material)) throw new Error('材质被拆成了数组')
    let disposed = 0
    material.addEventListener('dispose', () => {
      disposed += 1
    })

    layer.dispose()

    expect(disposed).toBe(1)
  })

  it('释放之后再套外观是空操作，不抛', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    layer.dispose()

    expect(() => layer.apply(look({ color: RED }))).not.toThrow()
  })
})

describe('重建', () => {
  // ⚠ 释放时不把原材质装回去的话，下一次克隆的是「已经被改过的那一份」：
  //   基线跟着变，透明度与颜色每重建一次就更偏一层，而且那份材质已经 dispose 过了
  it('释放时把原材质装回网格，重建之后基线仍是原始值', () => {
    const { mine, material } = shared()

    const first = new PartMaterials([mine])
    first.apply(look({ opacity: 0.5 }))
    first.dispose()

    expect(mine.material).toBe(material)

    const second = new PartMaterials([mine])
    second.apply(look({ opacity: 0.5 }))
    const rebuilt = mine.material
    if (Array.isArray(rebuilt)) throw new Error('材质被拆成了数组')
    expect(rebuilt.opacity).toBeCloseTo(0.5)
    second.dispose()
  })

  it('多材质的网格同样整份装回去', () => {
    const materials = [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial(),
    ]
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), materials)

    const layer = new PartMaterials([mesh])
    layer.dispose()

    expect(mesh.material).toBe(materials)
  })
})
