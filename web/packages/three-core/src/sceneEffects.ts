/**
 * @fileoverview 场景特效层：星空、底座舞台、包裹光柱三类装饰件，三者独立开关、可叠加。
 *
 * ⚠ 关掉的特效一个 GPU 对象都不建，关掉的单项子件也不建——「先建好再
 * setVisible(false)」在画面上看不出差别，但显存与 draw call 照付，而特效恰恰是
 * 给低配机器留的那道减法。
 * ⚠ 渐变一律由着色器算，本层不建任何贴图：CanvasTexture 要一张真 canvas 的 2d
 * 上下文，无头环境里拿不到就只能退回一张空白贴图——画面上看不出错，只是没有渐变。
 */
import type {
  TwinLightColumn,
  TwinPedestal,
  TwinSceneEffects,
  TwinStarfield,
  Vec3,
} from '@dt/twin-config'
import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'

import { disposeSceneGraph } from './sceneCore'
import { resolveColorSpec } from './themeColor'

/** 色规格取不出时的兜底，只影响外观、不影响任何读数 */
const COLOR_FALLBACK = '#00cefc'
/** 星点色；星空没有色规格字段，这一档固定 */
const STAR_COLOR = '#dfe9ff'
/** 星云辉光色，同样固定 */
const NEBULA_COLOR = '#3a5cff'

/** density = 1 时的星点数 */
const BASE_STAR_COUNT = 900
/** 星点数上限：density 拉满也不许把顶点数堆成一次卡顿 */
const MAX_STAR_COUNT = 4000
/** 星壳半径相对模型对角线；取景的远剪裁面按对角线的几十倍算，这个倍数落在里面 */
const STAR_SHELL_RATIO = 6
/** 星云球略在星壳之内 */
const NEBULA_SHELL_RATIO = 5.4
/** 星点在壳内的最小相对半径，抖开一点免得看着像一层贴纸 */
const STAR_SHELL_INNER = 0.75
/** speed = 1 时的自转角速度，弧度每秒 */
const STAR_SPIN_RATE = 0.02
/** 星点尺寸，像素（不随距离衰减） */
const STAR_SIZE = 1.6
const STAR_OPACITY = 0.9
const NEBULA_OPACITY = 0.22
const NEBULA_SEGMENTS_H = 24
const NEBULA_SEGMENTS_V = 16
/** 星云在星点之后画，两者都在场景其余部分之前 */
const NEBULA_RENDER_ORDER = -20
const STAR_RENDER_ORDER = -10

/** 模型底面占地半径相对对角线的估值：只拿得到对角线，用一半当外接半径 */
const FOOTPRINT_RATIO = 0.5
/** 模型高度相对对角线的估值，同上，是有意的近似 */
const MODEL_HEIGHT_RATIO = 0.5
const MIN_STAGE_RADIUS = 0.2
/** 先封顶模型的基础占地，用户半径倍率在它之后应用。 */
const MAX_STAGE_FOOTPRINT_RADIUS = 400
/** 底座各片之间的抬升步长，相对底座半径 */
const COPLANAR_STEP = 0.002
/** 光圈内半径相对外半径 */
const RING_INNER = 0.86
const RING_SEGMENTS = 64
const GROUND_SEGMENTS = 48
const GRID_DIVISIONS = 20
const RING_OPACITY = 0.55
const GROUND_OPACITY = 0.35
const GRID_OPACITY = 0.25
const SHADOW_OPACITY = 0.45
/** 接触阴影只铺在模型脚下，比整个底座小一圈 */
const SHADOW_RADIUS_RATIO = 0.55
/** 柔和档用较小的离屏纹理，模糊采样同时压住实时反射的显存开销。 */
const SOFT_REFLECTION_SIZE = 256
const MIRROR_REFLECTION_SIZE = 512
const SOFT_REFLECTION_OPACITY = 0.3
const MIRROR_REFLECTION_OPACITY = 0.68
const SOFT_REFLECTION_BLUR = 2.4
const MIRROR_REFLECTION_BLUR = 0
const REFLECTION_CLIP_BIAS = 0.003

const MIN_COLUMN_HEIGHT = 0.2
const MAX_COLUMN_HEIGHT = 800
/** 细光柱半径相对底面占地 */
const BEAM_RADIUS_RATIO = 0.09
/** 能量罩略大于模型占地，才有包裹感 */
const DOME_RADIUS_RATIO = 1.05
const BEAM_SEGMENTS = 24
const DOME_SEGMENTS_H = 32
const DOME_SEGMENTS_V = 16
/** intensity = 1 时的基准不透明度 */
const COLUMN_BASE_OPACITY = 0.5
/** speed = 1 时扫描走完一趟要多少秒的倒数 */
const SCAN_RATE = 0.35

/**
 * ⚠ 这两个必须是 type 而不是 interface：interface 没有隐式索引签名，
 * 塞不进 `ShaderMaterial` 的 `uniforms`（那里要的是索引签名对象）。
 * 自己留一份带类型的引用是为了改 uniform 时不经 `uniforms['x'].value` 那条
 * `any` 通道——那条路上写错名字既不报错也没有任何画面提示。
 */
type GlowUniforms = {
  uColor: { value: THREE.Color }
  uOpacity: { value: number }
}

type ScanUniforms = {
  uColor: { value: THREE.Color }
  uOpacity: { value: number }
  uProgress: { value: number }
}

const VERTEX_SHADER = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/** 圆面径向淡出：中心实、边缘透明。渐变地与接触阴影共用。 */
const RADIAL_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float edge = clamp(distance(vUv, vec2(0.5)) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(uColor, (1.0 - smoothstep(0.0, 1.0, edge)) * uOpacity);
}
`

/** 球壳辉光：赤道亮、两极暗，当星空的底噪。 */
const NEBULA_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float band = 1.0 - clamp(abs(vUv.y - 0.5) * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(uColor, pow(band, 3.0) * uOpacity);
}
`

/** 光柱：底实顶虚，外加一条随 uProgress 上移的扫描带。 */
const COLUMN_FRAGMENT = `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uProgress;
varying vec2 vUv;
void main() {
  float fade = 1.0 - vUv.y;
  float band = smoothstep(0.12, 0.0, abs(vUv.y - uProgress));
  float alpha = uOpacity * (fade * 0.45 + band * 0.9);
  gl_FragColor = vec4(uColor, clamp(alpha, 0.0, 1.0));
}
`

const REFLECTION_VERTEX = `
uniform mat4 textureMatrix;
varying vec4 vReflectionUv;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vReflectionUv = textureMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}
`

/**
 * 五点采样让柔和档拥有真实的低成本模糊；镜面档的 uBlur 为 0，五次采样会落在
 * 同一像素上，保留清晰轮廓。透明度留给底座地面、网格和反射自然叠加。
 */
const REFLECTION_FRAGMENT = `
uniform vec3 color;
uniform sampler2D tDiffuse;
uniform float uOpacity;
uniform float uBlur;
uniform vec2 uTexelSize;
varying vec4 vReflectionUv;
#include <logdepthbuf_pars_fragment>

float blendOverlay(float base, float blend) {
  return base < 0.5
    ? 2.0 * base * blend
    : 1.0 - 2.0 * (1.0 - base) * (1.0 - blend);
}

vec3 blendOverlay(vec3 base, vec3 blend) {
  return vec3(
    blendOverlay(base.r, blend.r),
    blendOverlay(base.g, blend.g),
    blendOverlay(base.b, blend.b)
  );
}

void main() {
  #include <logdepthbuf_fragment>
  vec2 projectedUv = vReflectionUv.xy / max(vReflectionUv.w, 0.00001);
  vec2 offset = uTexelSize * uBlur;
  vec4 reflected = texture2D(tDiffuse, projectedUv) * 0.4;
  reflected += texture2D(tDiffuse, projectedUv + vec2(offset.x, 0.0)) * 0.15;
  reflected += texture2D(tDiffuse, projectedUv - vec2(offset.x, 0.0)) * 0.15;
  reflected += texture2D(tDiffuse, projectedUv + vec2(0.0, offset.y)) * 0.15;
  reflected += texture2D(tDiffuse, projectedUv - vec2(0.0, offset.y)) * 0.15;
  gl_FragColor = vec4(blendOverlay(reflected.rgb, color), uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

interface EffectMaterialOptions {
  fragment: string
  uniforms: GlowUniforms | ScanUniforms
  side: THREE.Side
  /** 加色混合：暗场里发光的件用它；压暗用的接触阴影不能用，否则越叠越亮 */
  additive: boolean
}

function createEffectMaterial(
  options: EffectMaterialOptions,
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: options.uniforms,
    vertexShader: VERTEX_SHADER,
    fragmentShader: options.fragment,
    transparent: true,
    // 装饰件不写深度，否则它会把身后的模型整片挡掉
    depthWrite: false,
    side: options.side,
    blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
}

function glowUniforms(color: THREE.Color, opacity: number): GlowUniforms {
  return { uColor: { value: color }, uOpacity: { value: opacity } }
}

/** 特效件的共同形状：一个组、跟模型体量走、按帧推进。 */
interface Effect {
  readonly group: THREE.Group
  setWorldScale(diagonal: number): void
  update(step: number): void
  /** 只释放不在普通对象图属性中的 GPU 资源，例如反射的离屏渲染目标。 */
  dispose?(): void
}

/**
 * 固定种子的伪随机。
 * ⚠ 不用 `Math.random`：星空每次重建都换一片位置的话，改一次密度就像换了张天空，
 * 而用户以为自己只动了一个数。
 */
function createRandom(): () => number {
  let seed = 0x9e3779b9
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x100000000
  }
}

/** 一颗星：球壳上均匀取向，半径在壳内抖一点。 */
function fillStar(
  target: Float32Array,
  offset: number,
  random: () => number,
): void {
  const theta = random() * Math.PI * 2
  const cosPhi = random() * 2 - 1
  const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi))
  const radius = STAR_SHELL_INNER + (1 - STAR_SHELL_INNER) * random()
  target[offset] = radius * sinPhi * Math.cos(theta)
  target[offset + 1] = radius * cosPhi
  target[offset + 2] = radius * sinPhi * Math.sin(theta)
}

/** 星点云；density 小到取整为 0 时不建对象——0 顶点的 Points 照样占一次 draw call。 */
function createStars(density: number): THREE.Points | null {
  const count = Math.min(
    MAX_STAR_COUNT,
    Math.round(BASE_STAR_COUNT * Math.max(0, density)),
  )
  if (count <= 0) return null
  const random = createRandom()
  const positions = new Float32Array(count * 3)
  for (let index = 0; index < count; index += 1) {
    fillStar(positions, index * 3, random)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({
    color: new THREE.Color(STAR_COLOR),
    size: STAR_SIZE,
    // 星星在天上，不该因为相机推近就变成一团团大圆点
    sizeAttenuation: false,
    transparent: true,
    opacity: STAR_OPACITY,
    depthWrite: false,
  })
  const points = new THREE.Points(geometry, material)
  points.name = 'twin-starfield-points'
  points.renderOrder = STAR_RENDER_ORDER
  return points
}

function createNebula(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(
    1,
    NEBULA_SEGMENTS_H,
    NEBULA_SEGMENTS_V,
  )
  const mesh = new THREE.Mesh(
    geometry,
    createEffectMaterial({
      fragment: NEBULA_FRAGMENT,
      uniforms: glowUniforms(new THREE.Color(NEBULA_COLOR), NEBULA_OPACITY),
      // 相机在球心，只看得到内壁
      side: THREE.BackSide,
      additive: true,
    }),
  )
  mesh.name = 'twin-starfield-nebula'
  mesh.renderOrder = NEBULA_RENDER_ORDER
  return mesh
}

/** 星空：一层星点 + 可选的一层星云辉光，整组绕 Y 自转。 */
class StarfieldEffect implements Effect {
  readonly group = new THREE.Group()
  private readonly points: THREE.Points | null
  private readonly nebula: THREE.Mesh | null
  private readonly spin: number

  constructor(config: TwinStarfield) {
    this.group.name = 'twin-starfield'
    this.spin = config.speed * STAR_SPIN_RATE
    this.points = createStars(config.density)
    this.nebula = config.nebula ? createNebula() : null
    if (this.points !== null) this.group.add(this.points)
    if (this.nebula !== null) this.group.add(this.nebula)
  }

  setWorldScale(diagonal: number): void {
    this.points?.scale.setScalar(diagonal * STAR_SHELL_RATIO)
    this.nebula?.scale.setScalar(diagonal * NEBULA_SHELL_RATIO)
  }

  update(step: number): void {
    this.group.rotation.y += this.spin * step
  }
}

/** 底座的一片；`layer` 是共面层号。 */
interface StagePart {
  object: THREE.Object3D
  /**
   * ⚠ 四片都摊在 y = 0 上会 z-fighting：闪烁只在特定相机角度出现，
   * 换个视角一看又是好的，最难归因。按半径给每一片抬一个极小的量。
   */
  layer: number
}

/** 平躺的圆面：圆/环几何本身立在 XY 面上，不转过来就是一堵墙。 */
function layFlat<T extends THREE.Mesh>(mesh: T): T {
  mesh.rotation.x = -Math.PI / 2
  return mesh
}

function createReflection(
  mode: TwinPedestal['reflection'],
  color: THREE.Color,
): Reflector | null {
  if (mode === 'none') return null

  const soft = mode === 'soft'
  const textureSize = soft ? SOFT_REFLECTION_SIZE : MIRROR_REFLECTION_SIZE
  const reflector = layFlat(
    new Reflector(new THREE.CircleGeometry(1, GROUND_SEGMENTS), {
      color,
      textureWidth: textureSize,
      textureHeight: textureSize,
      clipBias: REFLECTION_CLIP_BIAS,
      // 柔和档由着色器做模糊，不再为它支付多重采样；镜面档保留清晰边缘。
      multisample: soft ? 0 : 4,
      shader: {
        name: 'TwinPedestalReflection',
        uniforms: {
          color: { value: null },
          tDiffuse: { value: null },
          textureMatrix: { value: null },
          uOpacity: {
            value: soft ? SOFT_REFLECTION_OPACITY : MIRROR_REFLECTION_OPACITY,
          },
          uBlur: {
            value: soft ? SOFT_REFLECTION_BLUR : MIRROR_REFLECTION_BLUR,
          },
          uTexelSize: {
            value: new THREE.Vector2(1 / textureSize, 1 / textureSize),
          },
        },
        vertexShader: REFLECTION_VERTEX,
        fragmentShader: REFLECTION_FRAGMENT,
      },
    }),
  )
  reflector.name = 'twin-pedestal-reflection'
  const material = reflector.material
  if (material instanceof THREE.ShaderMaterial) {
    material.transparent = true
    material.depthWrite = false
    material.side = THREE.DoubleSide
  }
  return reflector
}

function createRing(color: THREE.Color): THREE.Mesh {
  const mesh = layFlat(
    new THREE.Mesh(
      new THREE.RingGeometry(RING_INNER, 1, RING_SEGMENTS),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: RING_OPACITY,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    ),
  )
  mesh.name = 'twin-pedestal-ring'
  return mesh
}

function createGround(color: THREE.Color): THREE.Mesh {
  const mesh = layFlat(
    new THREE.Mesh(
      new THREE.CircleGeometry(1, GROUND_SEGMENTS),
      createEffectMaterial({
        fragment: RADIAL_FRAGMENT,
        uniforms: glowUniforms(color.clone(), GROUND_OPACITY),
        side: THREE.DoubleSide,
        additive: true,
      }),
    ),
  )
  mesh.name = 'twin-pedestal-ground'
  return mesh
}

function createContactShadow(): THREE.Mesh {
  const mesh = layFlat(
    new THREE.Mesh(
      new THREE.CircleGeometry(SHADOW_RADIUS_RATIO, GROUND_SEGMENTS),
      createEffectMaterial({
        fragment: RADIAL_FRAGMENT,
        uniforms: glowUniforms(new THREE.Color(0x000000), SHADOW_OPACITY),
        side: THREE.DoubleSide,
        additive: false,
      }),
    ),
  )
  mesh.name = 'twin-pedestal-shadow'
  return mesh
}

function createGrid(color: THREE.Color): THREE.GridHelper {
  // 边长 2 = 单位半径，缩放时与其它几片同一套倍数
  const grid = new THREE.GridHelper(2, GRID_DIVISIONS, color, color)
  grid.name = 'twin-pedestal-grid'
  const material = grid.material
  if (material instanceof THREE.Material) {
    material.transparent = true
    material.opacity = GRID_OPACITY
    material.depthWrite = false
  }
  return grid
}

/**
 * 底座舞台：模型脚下那一圈。各开关决定对应子件建不建；反射关闭时也不创建
 * 离屏渲染目标，柔和与镜面档分别在性能和清晰度之间取不同平衡。
 */
class PedestalEffect implements Effect {
  readonly group = new THREE.Group()
  private readonly parts: StagePart[] = []
  private readonly radiusFactor: number
  private readonly reflection: Reflector | null

  constructor(config: TwinPedestal, host: HTMLElement | null) {
    this.group.name = 'twin-pedestal'
    this.radiusFactor = config.radius
    const color =
      resolveColorSpec(config.color, host) ?? new THREE.Color(COLOR_FALLBACK)
    this.reflection = createReflection(config.reflection, color)
    if (this.reflection !== null) this.addPart(this.reflection, 0)
    if (config.gradientGround) this.addPart(createGround(color), 1)
    if (config.grid) this.addPart(createGrid(color), 2)
    if (config.ring) this.addPart(createRing(color), 3)
    if (config.contactShadow) this.addPart(createContactShadow(), 4)
  }

  setWorldScale(diagonal: number): void {
    // ⚠ 倍率不能放进统一封顶里：毫米级模型的基础占地早已超过上限，
    // 那样滑块从 0.5 拉到 8 都会被压成同一个值。
    const footprintRadius = clamp(
      diagonal * FOOTPRINT_RATIO,
      MIN_STAGE_RADIUS,
      MAX_STAGE_FOOTPRINT_RADIUS,
    )
    const radius = Math.max(
      MIN_STAGE_RADIUS,
      footprintRadius * this.radiusFactor,
    )
    for (const part of this.parts) {
      part.object.scale.setScalar(radius)
      part.object.position.y = radius * COPLANAR_STEP * part.layer
    }
  }

  /** 底座是静态的：这一层没有随帧变化的量。 */
  update(): void {
    return
  }

  dispose(): void {
    // ShaderMaterial 的纹理藏在 uniforms 中，通用对象图释放器扫描不到这张渲染目标。
    this.reflection?.getRenderTarget().dispose()
  }

  private addPart(object: THREE.Object3D, layer: number): void {
    this.parts.push({ object, layer })
    this.group.add(object)
  }
}

function createBeam(uniforms: ScanUniforms): THREE.Mesh {
  const mesh = new THREE.Mesh(
    // 开口圆柱：光柱是一层壳，封了顶盖反而看得见一个圆片
    new THREE.CylinderGeometry(1, 1, 1, BEAM_SEGMENTS, 1, true),
    createEffectMaterial({
      fragment: COLUMN_FRAGMENT,
      uniforms,
      side: THREE.DoubleSide,
      additive: true,
    }),
  )
  mesh.name = 'twin-light-beam'
  return mesh
}

function createDome(uniforms: ScanUniforms): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(
      1,
      DOME_SEGMENTS_H,
      DOME_SEGMENTS_V,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    ),
    createEffectMaterial({
      fragment: COLUMN_FRAGMENT,
      uniforms,
      // 罩子内外都要看得见：相机可以推进罩内
      side: THREE.DoubleSide,
      additive: true,
    }),
  )
  mesh.name = 'twin-light-dome'
  return mesh
}

/** 包裹光柱 / 能量罩：一层壳加一条上升的扫描带。 */
class LightColumnEffect implements Effect {
  readonly group = new THREE.Group()
  private readonly uniforms: ScanUniforms
  private readonly mesh: THREE.Mesh
  private readonly isDome: boolean
  private readonly heightFactor: number
  private readonly rate: number
  private readonly loop: boolean
  private progress = 0

  constructor(config: TwinLightColumn, host: HTMLElement | null) {
    this.group.name = 'twin-light-column'
    const color =
      resolveColorSpec(config.color, host) ?? new THREE.Color(COLOR_FALLBACK)
    this.uniforms = {
      uColor: { value: color },
      uOpacity: { value: Math.min(1, COLUMN_BASE_OPACITY * config.intensity) },
      uProgress: { value: 0 },
    }
    this.isDome = config.mode === 'dome'
    this.heightFactor = config.height
    this.rate = config.speed * SCAN_RATE
    this.loop = config.rise === 'loop'
    this.mesh = this.isDome
      ? createDome(this.uniforms)
      : createBeam(this.uniforms)
    this.group.add(this.mesh)
  }

  setWorldScale(diagonal: number): void {
    const height = clamp(
      diagonal * MODEL_HEIGHT_RATIO * this.heightFactor,
      MIN_COLUMN_HEIGHT,
      MAX_COLUMN_HEIGHT,
    )
    const footprint = diagonal * FOOTPRINT_RATIO
    const radius = Math.max(
      MIN_STAGE_RADIUS * BEAM_RADIUS_RATIO,
      footprint * (this.isDome ? DOME_RADIUS_RATIO : BEAM_RADIUS_RATIO),
    )
    this.mesh.scale.set(radius, height, radius)
    // ⚠ 圆柱几何的原点在体中心：不抬半个高度，光柱有一半埋在地下。
    // 半球的原点在赤道上，已经正好站在地面上。
    this.mesh.position.y = this.isDome ? 0 : height / 2
  }

  update(step: number): void {
    if (this.rate === 0) return
    if (!this.loop && this.progress >= 1) return
    const next = this.progress + this.rate * step
    this.progress = this.loop ? next % 1 : Math.min(1, next)
    this.uniforms.uProgress.value = this.progress
  }
}

/** 场景特效层。一个实例绑一份场景，换配置时 `build` 重建。 */
export class SceneEffectsLayer {
  readonly group = new THREE.Group()
  private effects: Effect[] = []
  private diagonal = 1

  constructor() {
    this.group.name = 'twin-scene-effects'
  }

  /**
   * 重建全部特效；`enabled` 为假的那一类一个对象都不建。
   * @param effects 归一化后的场景特效
   * @param host 读 CSS 变量级联的宿主元素，色规格里的 token 靠它取值
   */
  build(effects: TwinSceneEffects, host: HTMLElement | null = null): void {
    this.clear()
    const { starfield, pedestal, lightColumn } = effects
    if (starfield.enabled) this.effects.push(new StarfieldEffect(starfield))
    if (pedestal.enabled) this.effects.push(new PedestalEffect(pedestal, host))
    if (lightColumn.enabled) {
      this.effects.push(new LightColumnEffect(lightColumn, host))
    }
    for (const effect of this.effects) {
      this.group.add(effect.group)
      // 建完立刻按当前体量摆一次：不摆的话，重建到下一次 setWorldScale 之间的
      // 那些帧里，底座与光柱都是单位大小的一小撮
      effect.setWorldScale(this.diagonal)
    }
  }

  /**
   * 整层挪到坐标基准的原点上：底座那一圈、光柱/能量罩的轴、星壳的球心
   * 都以它为中心。
   *
   * ⚠ 三类特效在各自组里都是绕自己的原点建的，所以位置只摆这一处；各自再摆
   * 一次的话，换基准时三者会各走各的，画面上是「底座挪了、光柱没跟上」。
   * ⚠ 不摆的话它们钉在世界原点：模型的原点离世界原点越远，底座就越是套在
   * 一片空地上，而这既不报错也不像是配错了什么。
   *
   * @param origin 基准原点，世界坐标
   */
  setOrigin(origin: Vec3): void {
    this.group.position.set(origin[0], origin[1], origin[2])
  }

  /**
   * 底座半径与光柱高度都相对模型体量，否则大模型上它们缩成一个点。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    this.diagonal =
      Number.isFinite(modelDiagonal) && modelDiagonal > 0 ? modelDiagonal : 1
    for (const effect of this.effects) effect.setWorldScale(this.diagonal)
  }

  /**
   * 推进动画。
   * @param deltaSeconds 距上一帧的秒数
   */
  update(deltaSeconds: number): void {
    // ⚠ 非有限或倒退的帧间隔一律当 0：它会乘进自转角与扫描进度，而 NaN 一旦落进
    // transform 就顺着矩阵扩散，整组特效再也画不出来，且没有任何一处报错。
    // 标签页切回来时的第一帧 delta 尤其容易是个荒唐值。
    const step =
      Number.isFinite(deltaSeconds) && deltaSeconds > 0 ? deltaSeconds : 0
    if (step === 0) return
    for (const effect of this.effects) effect.update(step)
  }

  dispose(): void {
    this.clear()
  }

  private clear(): void {
    for (const effect of this.effects) {
      this.group.remove(effect.group)
      effect.dispose?.()
      // 几何、材质、贴图的释放收口在 disposeSceneGraph，本层不另起一套
      disposeSceneGraph(effect.group)
    }
    this.effects = []
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}
