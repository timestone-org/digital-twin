/**
 * @fileoverview 场景特效层守四样：关掉的特效一个对象都不建、资源全都收得回、
 * 尺寸与动画里出不来 NaN、色规格取不出时有兜底。
 *
 * ⚠ 「关了还建对象」和「重建不清旧的」这两样在画面上都看不出来：前者是显存与
 * draw call 白付，后者是编辑器开久了越来越卡——两者都没有任何一处报错，
 * 只能靠这里逐条钉住。
 */
import type {
  TwinLightColumn,
  TwinPedestal,
  TwinSceneEffects,
  TwinStarfield,
} from '@dt/twin-config'
import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SceneEffectsLayer } from '../src/sceneEffects'

type Renderable = THREE.Mesh | THREE.Points | THREE.Line

function starfield(overrides: Partial<TwinStarfield> = {}): TwinStarfield {
  return { enabled: false, density: 1, speed: 1, nebula: false, ...overrides }
}

function pedestal(overrides: Partial<TwinPedestal> = {}): TwinPedestal {
  return {
    enabled: false,
    color: '#00ff88',
    ring: true,
    grid: true,
    gradientGround: true,
    contactShadow: true,
    reflection: 'none',
    radius: 1.6,
    ...overrides,
  }
}

function lightColumn(
  overrides: Partial<TwinLightColumn> = {},
): TwinLightColumn {
  return {
    enabled: false,
    mode: 'beam',
    color: '#00ff88',
    intensity: 1,
    speed: 1,
    height: 1.15,
    rise: 'loop',
    ...overrides,
  }
}

function effects(overrides: Partial<TwinSceneEffects> = {}): TwinSceneEffects {
  return {
    starfield: starfield(),
    pedestal: pedestal(),
    lightColumn: lightColumn(),
    ...overrides,
  }
}

/** 三类特效全开的一份配置，用来量「全量建出来的东西全都收得回」。 */
function allOn(): TwinSceneEffects {
  return {
    starfield: starfield({ enabled: true, nebula: true }),
    pedestal: pedestal({ enabled: true }),
    lightColumn: lightColumn({ enabled: true, mode: 'dome' }),
  }
}

function isRenderable(object: THREE.Object3D): object is Renderable {
  return (
    object instanceof THREE.Mesh ||
    object instanceof THREE.Points ||
    object instanceof THREE.Line
  )
}

function objectsOf(layer: SceneEffectsLayer): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  layer.group.traverse((object: THREE.Object3D) => {
    found.push(object)
  })
  return found
}

/** ⚠ `instanceof` 之后直接 push 会踩 no-unsafe-argument，一律经带谓词的 filter。 */
function renderablesOf(layer: SceneEffectsLayer): Renderable[] {
  return objectsOf(layer).filter(isRenderable)
}

function namesOf(layer: SceneEffectsLayer): string[] {
  return renderablesOf(layer).map((object) => object.name)
}

/** 按名字取一件；取不到当场失败，别让断言在 undefined 上悄悄通过。 */
function partOf(layer: SceneEffectsLayer, name: string): Renderable {
  const found = renderablesOf(layer).find((object) => object.name === name)
  if (found === undefined) throw new Error(`这份输入本该建出 ${name}`)
  return found
}

function reflectionOf(layer: SceneEffectsLayer): Reflector {
  const reflection = partOf(layer, 'twin-pedestal-reflection')
  if (!(reflection instanceof Reflector)) {
    throw new Error('底座反射本该由 Reflector 渲染')
  }
  return reflection
}

function materialsOf(object: Renderable): THREE.Material[] {
  return Array.isArray(object.material) ? object.material : [object.material]
}

function basicColorOf(object: Renderable): string {
  const material = materialsOf(object)[0]
  if (!(material instanceof THREE.MeshBasicMaterial)) {
    throw new Error('这一件本该是基础材质')
  }
  return material.color.getHexString()
}

function uniformNumber(object: Renderable, name: string): number {
  const material = materialsOf(object)[0]
  if (!(material instanceof THREE.ShaderMaterial)) {
    throw new Error('这一件本该是着色器材质')
  }
  const uniform = material.uniforms[name]
  if (uniform === undefined) throw new Error(`没有 ${name} 这个 uniform`)
  const value: unknown = uniform.value
  if (typeof value !== 'number') throw new Error(`${name} 不是数值`)
  return value
}

function vertexCount(object: Renderable): number {
  return object.geometry.getAttribute('position').count
}

/** 位置、缩放、旋转三样里的每一个分量。 */
function transformNumbers(layer: SceneEffectsLayer): number[] {
  return objectsOf(layer).flatMap((object) => [
    object.position.x,
    object.position.y,
    object.position.z,
    object.scale.x,
    object.scale.y,
    object.scale.z,
    object.rotation.x,
    object.rotation.y,
    object.rotation.z,
  ])
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

describe('关掉的特效不建对象', () => {
  it('三个都关时组里一个对象都没有', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects())

    expect(layer.group.children).toHaveLength(0)
    expect(renderablesOf(layer)).toHaveLength(0)
  })

  it('只开星空时只有星空的对象', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ starfield: starfield({ enabled: true }) }))

    expect(namesOf(layer)).toEqual(['twin-starfield-points'])
  })

  it('只开底座时只有底座的四片', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ pedestal: pedestal({ enabled: true }) }))

    expect([...namesOf(layer)].sort()).toEqual([
      'twin-pedestal-grid',
      'twin-pedestal-ground',
      'twin-pedestal-ring',
      'twin-pedestal-shadow',
    ])
  })

  it('只开光柱时只有光柱的对象', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ lightColumn: lightColumn({ enabled: true }) }))

    expect(namesOf(layer)).toEqual(['twin-light-beam'])
  })

  it('三个都开时三类都在', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())

    expect(namesOf(layer)).toHaveLength(7)
  })
})

describe('星空', () => {
  it('nebula 关时不建辉光层', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ starfield: starfield({ enabled: true, nebula: false }) }),
    )

    expect(namesOf(layer)).not.toContain('twin-starfield-nebula')
  })

  it('nebula 开时多一层辉光', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ starfield: starfield({ enabled: true, nebula: true }) }),
    )

    expect(namesOf(layer)).toContain('twin-starfield-nebula')
  })

  it('点数随 density 缩放', () => {
    const dense = new SceneEffectsLayer()
    dense.build(
      effects({ starfield: starfield({ enabled: true, density: 2 }) }),
    )
    const sparse = new SceneEffectsLayer()
    sparse.build(
      effects({ starfield: starfield({ enabled: true, density: 0.5 }) }),
    )

    expect(vertexCount(partOf(dense, 'twin-starfield-points'))).toBeGreaterThan(
      vertexCount(partOf(sparse, 'twin-starfield-points')),
    )
  })

  // 0 顶点的 Points 照样占一次 draw call，density 归零时干脆不建
  it('density 为 0 时不建星点，星云照建', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({
        starfield: starfield({ enabled: true, density: 0, nebula: true }),
      }),
    )

    expect(namesOf(layer)).toEqual(['twin-starfield-nebula'])
  })

  // 重建时星星整片跳位的话，改一次密度就像换了张天空
  it('同一份配置两次建出同一片星空', () => {
    const first = new SceneEffectsLayer()
    first.build(effects({ starfield: starfield({ enabled: true }) }))
    const second = new SceneEffectsLayer()
    second.build(effects({ starfield: starfield({ enabled: true }) }))
    const toArray = (layer: SceneEffectsLayer): number[] =>
      Array.from(
        partOf(layer, 'twin-starfield-points').geometry.getAttribute('position')
          .array,
      )

    expect(toArray(first)).toEqual(toArray(second))
  })

  it('星空每帧自转', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ starfield: starfield({ enabled: true, speed: 1 }) }))
    layer.update(1)
    const spun = partOf(layer, 'twin-starfield-points').parent?.rotation.y ?? 0

    expect(spun).toBeGreaterThan(0)
  })

  it('speed 为 0 时不转', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ starfield: starfield({ enabled: true, speed: 0 }) }))
    layer.update(1)
    const spun = partOf(layer, 'twin-starfield-points').parent?.rotation.y ?? 1

    expect(spun).toBe(0)
  })
})

describe('底座的四个开关各自单独关', () => {
  const PARTS: readonly {
    label: string
    name: string
    off: Partial<TwinPedestal>
  }[] = [
    { label: '光圈', name: 'twin-pedestal-ring', off: { ring: false } },
    { label: '网格', name: 'twin-pedestal-grid', off: { grid: false } },
    {
      label: '渐变地',
      name: 'twin-pedestal-ground',
      off: { gradientGround: false },
    },
    {
      label: '接触阴影',
      name: 'twin-pedestal-shadow',
      off: { contactShadow: false },
    },
  ]

  for (const part of PARTS) {
    it(`关掉${part.label}时不建它的对象，其余三片照建`, () => {
      const layer = new SceneEffectsLayer()
      layer.build(
        effects({ pedestal: pedestal({ enabled: true, ...part.off }) }),
      )

      expect(namesOf(layer)).not.toContain(part.name)
      expect(namesOf(layer)).toHaveLength(3)
    })
  }

  it('四个全关时底座一个对象都不建', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({
        pedestal: pedestal({
          enabled: true,
          ring: false,
          grid: false,
          gradientGround: false,
          contactShadow: false,
        }),
      }),
    )

    expect(renderablesOf(layer)).toHaveLength(0)
  })

  // ⚠ 四片都摊在 y = 0 上会 z-fighting，且只在特定相机角度闪
  it('四片各自抬开一点，不共面', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ pedestal: pedestal({ enabled: true }) }))
    layer.setWorldScale(10)
    const heights = renderablesOf(layer).map((object) => object.position.y)

    expect(new Set(heights).size).toBe(4)
  })
})

describe('底座反射', () => {
  it('不反射时不建额外渲染对象', () => {
    const layer = new SceneEffectsLayer()

    layer.build(
      effects({
        pedestal: pedestal({ enabled: true, reflection: 'none' }),
      }),
    )

    expect(namesOf(layer)).not.toContain('twin-pedestal-reflection')
  })

  it('柔和与镜面都建真实反射，镜面更清晰也更强', () => {
    const soft = new SceneEffectsLayer()
    soft.build(
      effects({
        pedestal: pedestal({ enabled: true, reflection: 'soft' }),
      }),
    )
    const mirror = new SceneEffectsLayer()
    mirror.build(
      effects({
        pedestal: pedestal({ enabled: true, reflection: 'mirror' }),
      }),
    )
    const softReflection = reflectionOf(soft)
    const mirrorReflection = reflectionOf(mirror)

    expect(mirrorReflection.getRenderTarget().width).toBeGreaterThan(
      softReflection.getRenderTarget().width,
    )
    expect(uniformNumber(mirrorReflection, 'uOpacity')).toBeGreaterThan(
      uniformNumber(softReflection, 'uOpacity'),
    )
    expect(uniformNumber(softReflection, 'uBlur')).toBeGreaterThan(
      uniformNumber(mirrorReflection, 'uBlur'),
    )
  })

  it('重建时销毁反射的离屏渲染目标', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({
        pedestal: pedestal({ enabled: true, reflection: 'mirror' }),
      }),
    )
    const reflection = reflectionOf(layer)
    const dispose = vi.spyOn(reflection.getRenderTarget(), 'dispose')

    layer.build(effects())

    expect(dispose).toHaveBeenCalledOnce()
  })
})

describe('光柱', () => {
  it('beam 画细光柱', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, mode: 'beam' }) }),
    )

    expect(namesOf(layer)).toEqual(['twin-light-beam'])
  })

  it('dome 画包裹的半球罩', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, mode: 'dome' }) }),
    )

    expect(namesOf(layer)).toEqual(['twin-light-dome'])
  })

  // ⚠ 圆柱几何的原点在体中心，不抬半高就有一半埋在地下
  it('细光柱抬起半个高度站在地面上，半球罩不抬', () => {
    const beam = new SceneEffectsLayer()
    beam.build(
      effects({ lightColumn: lightColumn({ enabled: true, mode: 'beam' }) }),
    )
    beam.setWorldScale(10)
    const mesh = partOf(beam, 'twin-light-beam')
    const dome = new SceneEffectsLayer()
    dome.build(
      effects({ lightColumn: lightColumn({ enabled: true, mode: 'dome' }) }),
    )
    dome.setWorldScale(10)

    expect(mesh.position.y).toBeCloseTo(mesh.scale.y / 2)
    expect(partOf(dome, 'twin-light-dome').position.y).toBe(0)
  })

  it('intensity 越大越不透明', () => {
    const strong = new SceneEffectsLayer()
    strong.build(
      effects({ lightColumn: lightColumn({ enabled: true, intensity: 2 }) }),
    )
    const weak = new SceneEffectsLayer()
    weak.build(
      effects({ lightColumn: lightColumn({ enabled: true, intensity: 0.4 }) }),
    )

    expect(
      uniformNumber(partOf(strong, 'twin-light-beam'), 'uOpacity'),
    ).toBeGreaterThan(
      uniformNumber(partOf(weak, 'twin-light-beam'), 'uOpacity'),
    )
  })

  it('不透明度封顶在 1', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, intensity: 2 }) }),
    )

    expect(
      uniformNumber(partOf(layer, 'twin-light-beam'), 'uOpacity'),
    ).toBeLessThanOrEqual(1)
  })

  it('扫描随帧推进', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ lightColumn: lightColumn({ enabled: true }) }))
    layer.update(1)

    expect(
      uniformNumber(partOf(layer, 'twin-light-beam'), 'uProgress'),
    ).toBeGreaterThan(0)
  })

  it('speed 为 0 时扫描不动', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, speed: 0 }) }),
    )
    layer.update(10)

    expect(uniformNumber(partOf(layer, 'twin-light-beam'), 'uProgress')).toBe(0)
  })

  it('loop 走到头会绕回来', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, rise: 'loop' }) }),
    )
    for (let frame = 0; frame < 40; frame += 1) layer.update(0.5)
    const progress = uniformNumber(
      partOf(layer, 'twin-light-beam'),
      'uProgress',
    )

    expect(progress).toBeGreaterThanOrEqual(0)
    expect(progress).toBeLessThan(1)
  })

  it('once 只走一趟，停在终点', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ lightColumn: lightColumn({ enabled: true, rise: 'once' }) }),
    )
    for (let frame = 0; frame < 40; frame += 1) layer.update(0.5)

    expect(uniformNumber(partOf(layer, 'twin-light-beam'), 'uProgress')).toBe(1)
  })
})

describe('基准原点', () => {
  // 三类特效各自绕自己的原点建，位置只摆整层这一处
  it('整层挪到基准原点上，三类特效同一个中心', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())

    layer.setOrigin([12, 3, -8])

    expect(layer.group.position.toArray()).toEqual([12, 3, -8])
  })

  // ⚠ build 把子件全重建了一遍；位置挂在整层上，不该跟着回到世界原点
  it('重建特效不会把基准原点丢回世界原点', () => {
    const layer = new SceneEffectsLayer()
    layer.setOrigin([12, 3, -8])

    layer.build(allOn())

    expect(layer.group.position.toArray()).toEqual([12, 3, -8])
  })
})

describe('释放', () => {
  it('每一份几何与材质都 dispose 掉', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    const parts = renderablesOf(layer)
    const spies = parts.flatMap((object) => [
      vi.spyOn(object.geometry, 'dispose'),
      ...materialsOf(object).map((material) => vi.spyOn(material, 'dispose')),
    ])

    layer.dispose()

    expect(spies).not.toHaveLength(0)
    for (const spy of spies) expect(spy).toHaveBeenCalled()
  })

  it('清完之后组里什么都不剩', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.dispose()

    expect(layer.group.children).toHaveLength(0)
    expect(renderablesOf(layer)).toHaveLength(0)
  })

  it('重建先清旧的，不叠加', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ starfield: starfield({ enabled: true }) }))
    const stars = partOf(layer, 'twin-starfield-points')
    const spy = vi.spyOn(stars.geometry, 'dispose')

    layer.build(effects({ pedestal: pedestal({ enabled: true }) }))

    expect(spy).toHaveBeenCalled()
    expect(namesOf(layer)).not.toContain('twin-starfield-points')
    expect(renderablesOf(layer)).toHaveLength(4)
  })

  it('清完之后再 update 也没有任何事发生', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.dispose()
    layer.update(0.5)

    expect(layer.group.children).toHaveLength(0)
  })
})

describe('随模型体量缩放', () => {
  it('大模型上底座跟着变大', () => {
    const layer = new SceneEffectsLayer()
    layer.build(effects({ pedestal: pedestal({ enabled: true }) }))
    layer.setWorldScale(100)
    const big = partOf(layer, 'twin-pedestal-ring').scale.x
    layer.setWorldScale(1)
    const small = partOf(layer, 'twin-pedestal-ring').scale.x

    expect(big).toBeGreaterThan(small)
  })

  it('build 之前设的体量在 build 时就生效', () => {
    const layer = new SceneEffectsLayer()
    layer.setWorldScale(100)
    layer.build(effects({ pedestal: pedestal({ enabled: true }) }))

    expect(partOf(layer, 'twin-pedestal-ring').scale.x).toBeGreaterThan(1)
  })

  it('radius 倍数越大底座越大', () => {
    const wide = new SceneEffectsLayer()
    wide.build(effects({ pedestal: pedestal({ enabled: true, radius: 4 }) }))
    wide.setWorldScale(10)
    const narrow = new SceneEffectsLayer()
    narrow.build(
      effects({ pedestal: pedestal({ enabled: true, radius: 0.5 }) }),
    )
    narrow.setWorldScale(10)

    expect(partOf(wide, 'twin-pedestal-ring').scale.x).toBeGreaterThan(
      partOf(narrow, 'twin-pedestal-ring').scale.x,
    )
  })

  it('毫米级大模型重建底座时 radius 仍然能改变尺寸', () => {
    const layer = new SceneEffectsLayer()
    layer.setWorldScale(10_000)
    layer.build(effects({ pedestal: pedestal({ enabled: true, radius: 0.5 }) }))
    const narrow = partOf(layer, 'twin-pedestal-ring').scale.x

    layer.build(effects({ pedestal: pedestal({ enabled: true, radius: 8 }) }))
    const wide = partOf(layer, 'twin-pedestal-ring').scale.x

    expect(wide).toBeGreaterThan(narrow)
  })

  it('height 倍数越大光柱越高', () => {
    const tall = new SceneEffectsLayer()
    tall.build(
      effects({ lightColumn: lightColumn({ enabled: true, height: 4 }) }),
    )
    tall.setWorldScale(10)
    const low = new SceneEffectsLayer()
    low.build(
      effects({ lightColumn: lightColumn({ enabled: true, height: 0.2 }) }),
    )
    low.setWorldScale(10)

    expect(partOf(tall, 'twin-light-beam').scale.y).toBeGreaterThan(
      partOf(low, 'twin-light-beam').scale.y,
    )
  })

  for (const diagonal of [Number.NaN, 0, -12, Number.POSITIVE_INFINITY]) {
    it(`对角线是 ${String(diagonal)} 时按 1 算，不产出 NaN 尺寸`, () => {
      const layer = new SceneEffectsLayer()
      layer.build(allOn())
      layer.setWorldScale(diagonal)

      for (const value of transformNumbers(layer)) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(partOf(layer, 'twin-pedestal-ring').scale.x).toBeGreaterThan(0)
    })
  }

  it('体量小到极点也不缩成 0', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.setWorldScale(0.0001)

    expect(partOf(layer, 'twin-pedestal-ring').scale.x).toBeGreaterThan(0)
    expect(partOf(layer, 'twin-light-dome').scale.y).toBeGreaterThan(0)
  })

  it('体量大到极点也有封顶', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.setWorldScale(1e9)

    for (const value of transformNumbers(layer)) {
      expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('帧间隔的兜底', () => {
  // ⚠ NaN 一旦落进 transform 就顺着矩阵扩散，整组特效再也画不出来且不报错
  for (const delta of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
    it(`update(${String(delta)}) 不把 NaN 写进任何 transform`, () => {
      const layer = new SceneEffectsLayer()
      layer.build(allOn())
      layer.setWorldScale(8)
      layer.update(0.016)
      layer.update(delta)

      for (const value of transformNumbers(layer)) {
        expect(Number.isFinite(value)).toBe(true)
      }
      expect(
        Number.isFinite(
          uniformNumber(partOf(layer, 'twin-light-dome'), 'uProgress'),
        ),
      ).toBe(true)
    })
  }

  it('倒退的帧间隔不把动画拉回去', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.update(1)
    const before = uniformNumber(partOf(layer, 'twin-light-dome'), 'uProgress')
    layer.update(-5)

    expect(uniformNumber(partOf(layer, 'twin-light-dome'), 'uProgress')).toBe(
      before,
    )
  })

  it('0 帧间隔什么都不动', () => {
    const layer = new SceneEffectsLayer()
    layer.build(allOn())
    layer.update(0)

    expect(uniformNumber(partOf(layer, 'twin-light-dome'), 'uProgress')).toBe(0)
  })
})

describe('取色', () => {
  it('hex 色规格直接用', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ pedestal: pedestal({ enabled: true, color: '#123456' }) }),
    )

    expect(basicColorOf(partOf(layer, 'twin-pedestal-ring'))).toBe('123456')
  })

  it('token 从宿主的级联里取', () => {
    const host = hostWith('--stage-tone', '#00ff88')
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ pedestal: pedestal({ enabled: true, color: '--stage-tone' }) }),
      host,
    )

    expect(basicColorOf(partOf(layer, 'twin-pedestal-ring'))).toBe('00ff88')
  })

  // 取不出的色规格不许把整层带崩：外观退到兜底色，配置错另有校验去报
  it('色规格取不到时用兜底色', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({
        pedestal: pedestal({ enabled: true, color: 'rebeccapurple' }),
        lightColumn: lightColumn({ enabled: true, color: 'rebeccapurple' }),
      }),
    )

    expect(basicColorOf(partOf(layer, 'twin-pedestal-ring'))).toBe('00cefc')
    expect(namesOf(layer)).toContain('twin-light-beam')
  })

  it('没有宿主时 token 取不出，同样退到兜底色', () => {
    const layer = new SceneEffectsLayer()
    layer.build(
      effects({ pedestal: pedestal({ enabled: true, color: '--stage-tone' }) }),
    )

    expect(basicColorOf(partOf(layer, 'twin-pedestal-ring'))).toBe('00cefc')
  })
})
