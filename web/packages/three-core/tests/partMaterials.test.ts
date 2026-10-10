/**
 * @fileoverview 部件材质记账：克隆、基线、反复套外观。
 *
 * ⚠ 这一层的错都不报错：不克隆就是「改一个部件染了一大片」，不从基线重算就是
 * 「放着不动颜色越来越深」，每帧写 `needsUpdate` 就是「部件一多就掉帧」。
 */
import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'

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
  it.each([
    THREE.MeshBasicMaterial,
    THREE.MeshStandardMaterial,
    THREE.MeshLambertMaterial,
    THREE.MeshPhongMaterial,
    THREE.MeshToonMaterial,
    THREE.MeshMatcapMaterial,
  ])('普通材质 %p 的半透明绘制保持平滑', (Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new Material())
    const layer = new PartMaterials([mesh])

    layer.apply(look({ opacity: 0.75 }))

    const material = mesh.material
    if (Array.isArray(material)) throw new Error('单材质被改成了数组')
    expect(material.forceSinglePass).toBe(true)
    expect(material.alphaHash).toBe(false)
    expect(material.opacity).toBe(0.75)
    layer.dispose()
  })

  it.each([
    ['原生透明', () => new THREE.MeshStandardMaterial({ transparent: true })],
    ['无深度写入', () => new THREE.MeshStandardMaterial({ depthWrite: false })],
    ['无深度测试', () => new THREE.MeshStandardMaterial({ depthTest: false })],
    [
      '加法混合',
      () => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending }),
    ],
    ['透明裁剪', () => new THREE.MeshBasicMaterial({ alphaTest: 0.5 })],
    ['哈希覆盖', () => new THREE.MeshBasicMaterial({ alphaHash: true })],
    [
      '多重采样覆盖',
      () => new THREE.MeshBasicMaterial({ alphaToCoverage: true }),
    ],
    ['物理透射', () => new THREE.MeshPhysicalMaterial({ transmission: 1 })],
    ['自定义着色器', () => new THREE.ShaderMaterial()],
  ] satisfies [string, () => THREE.Material][])(
    '%s 材质保留自身绘制方式',
    (_name, create) => {
      const material = create()
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material)
      const geometry = mesh.geometry
      const beforeRender = vi.fn()
      mesh.onBeforeRender = beforeRender
      const layer = new PartMaterials([mesh])

      layer.apply(look({ opacity: 0.75 }))

      const clone = mesh.material
      if (Array.isArray(clone)) throw new Error('单材质被改成了数组')
      expect(mesh.geometry).toBe(geometry)
      expect(mesh.onBeforeRender === beforeRender).toBe(true)
      expect(clone.forceSinglePass).toBe(material.forceSinglePass)
      layer.dispose()
    },
  )

  it('配置半透明外壳按墙面深度排序，并在还原时释放独占几何', () => {
    const { mine, material } = shared()
    const originalGeometry = mine.geometry
    const originalRender = vi.fn()
    mine.onBeforeRender = originalRender
    const layer = new PartMaterials([mine])

    layer.apply(look({ opacity: 0.75 }))

    const clone = mine.material
    if (Array.isArray(clone)) throw new Error('单材质被改成了数组')
    expect(clone.transparent).toBe(true)
    expect(clone.alphaHash).toBe(false)
    expect(clone.forceSinglePass).toBe(true)
    expect(mine.geometry).not.toBe(originalGeometry)
    const geometry = mine.geometry
    let disposed = 0
    geometry.addEventListener('dispose', () => {
      disposed += 1
    })

    layer.apply(look())

    expect(clone.forceSinglePass).toBe(material.forceSinglePass)
    expect(mine.geometry).toBe(originalGeometry)
    expect(mine.onBeforeRender === originalRender).toBe(true)
    expect(disposed).toBe(1)
    layer.dispose()
  })

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

describe('条件效果叠加', () => {
  it.each([0.2, 0.6])('黑色自发光基线按配置强度 %s 高亮', (glow) => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('缺少标准材质')
    }

    layer.apply({
      ...look(),
      effect: { color: RED, blend: 1, glow, intensity: 1 },
    })

    expect(material.emissive.getHexString()).toBe('ff0000')
    expect(material.emissiveIntensity).toBe(glow)
    layer.apply({
      ...look(),
      effect: { color: RED, blend: 1, glow, intensity: 0 },
    })
    expect(material.emissive.getHexString()).toBe('000000')
    expect(material.emissiveIntensity).toBe(1)
    layer.dispose()
  })

  it('原材质有非零自发光时保留更强的强度，效果解除后完整恢复', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshStandardMaterial({
        emissive: '#00ff00',
        emissiveIntensity: 4,
      }),
    )
    const layer = new PartMaterials([mesh])
    const material = mesh.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('缺少标准材质')
    }
    const effect = { color: RED, blend: 1, glow: 0.6, intensity: 1 }

    layer.apply({ ...look(), effect })

    expect(material.emissive.getHexString()).toBe('ff0000')
    expect(material.emissiveIntensity).toBe(4)
    layer.apply({ ...look(), effect: { ...effect, intensity: 0 } })
    expect(material.emissive.getHexString()).toBe('00ff00')
    expect(material.emissiveIntensity).toBe(4)
    layer.dispose()
  })

  it('在实时染色上叠加效果，关闭后恢复原染色与自发光', () => {
    const { mine, other } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('缺少标准材质')
    }
    const base = look({ opacity: 0.5, color: RED, glow: 2 })
    const effect = {
      color: new THREE.Color('#00ff00'),
      blend: 1,
      glow: 1,
      intensity: 1,
    }

    layer.apply({ ...base, effect })

    expect(material.color.getHexString()).toBe('00ff00')
    expect(material.emissive.getHexString()).toBe('00ff00')
    expect(material.emissiveIntensity).toBe(2)
    expect(material.opacity).toBe(0.5)
    expect(colorOf(other).getHexString()).toBe('0000ff')

    layer.apply({ ...base, effect: { ...effect, intensity: 0 } })

    expect(material.color.getHexString()).toBe('ff0000')
    expect(material.emissive.getHexString()).toBe('ff0000')
    expect(material.emissiveIntensity).toBe(2)
    layer.dispose()
  })

  it('效果不指定颜色时保持当前颜色并沿用它高亮', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('缺少标准材质')
    }

    layer.apply({
      ...look({ color: RED }),
      effect: { color: null, blend: 1, glow: 3, intensity: 1 },
    })

    expect(material.color.getHexString()).toBe('ff0000')
    expect(material.emissive.getHexString()).toBe('ff0000')
    expect(material.emissiveIntensity).toBe(3)
    layer.apply(look())
    expect(material.color.getHexString()).toBe('0000ff')
    expect(material.emissive.getHexString()).toBe('000000')
    layer.dispose()
  })

  it('复用并修改效果颜色时识别新颜色，反复应用不累积染色', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const color = new THREE.Color('#ff0000')
    const effect = { color, blend: 0.5, glow: 0, intensity: 1 }
    layer.apply({ ...look(), effect })
    const first = colorOf(mine).getHexString()
    color.set('#00ff00')

    layer.apply({ ...look(), effect })

    expect(colorOf(mine).getHexString()).not.toBe(first)
    color.set('#ff0000')
    layer.apply({ ...look(), effect })
    expect(colorOf(mine).getHexString()).toBe(first)
    layer.dispose()
  })

  it('基础材质没有自发光通道时仍能显示条件变色', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial({ color: '#0000ff' }),
    )
    const layer = new PartMaterials([mesh])

    layer.apply({
      ...look(),
      effect: { color: RED, blend: 1, glow: 3, intensity: 1 },
    })

    expect(colorOf(mesh).getHexString()).toBe('ff0000')
    layer.dispose()
  })

  it('部分强度从当前染色平滑混合，重复帧保持相同外观', () => {
    const { mine } = shared()
    const layer = new PartMaterials([mine])
    const material = mine.material
    if (!(material instanceof THREE.MeshStandardMaterial)) {
      throw new Error('缺少标准材质')
    }
    const frame = {
      ...look({ color: RED }),
      effect: {
        color: new THREE.Color('#00ff00'),
        blend: 1,
        glow: 2,
        intensity: 0.5,
      },
    }

    layer.apply(frame)
    const version = material.version
    layer.apply(frame)

    expect(material.color.r).toBeCloseTo(0.5)
    expect(material.color.g).toBeCloseTo(0.5)
    expect(material.color.b).toBe(0)
    expect(material.emissive.g).toBeCloseTo(0.5)
    expect(material.emissiveIntensity).toBe(1)
    expect(material.version).toBe(version)
    layer.dispose()
  })

  it('没有颜色和自发光通道的自定义材质保留自身外观', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.ShaderMaterial(),
    )
    const layer = new PartMaterials([mesh])

    expect(() =>
      layer.apply({
        ...look(),
        effect: { color: null, blend: 1, glow: 3, intensity: 1 },
      }),
    ).not.toThrow()
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
