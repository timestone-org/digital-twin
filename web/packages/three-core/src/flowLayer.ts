/**
 * @fileoverview 能量流层：沿一串锚点铺一根管线，再让若干小球在管线上循环推进。
 *
 * ⚠ 强度与帧间隔都是外部数，任何一个非有限数乘进相位，就是一整条流的粒子集体
 * 变成 NaN 坐标——NaN 让包围盒失效、整条流被剔除出画面，而且不报任何错。
 * 所以外部数一律经 `toFiniteNumber` 与 `usableStep` 进来。
 */
import type { TwinAnchor, TwinFlowLink, TwinFlowValues } from '@dt/twin-config'
import { toFiniteNumber } from '@dt/twin-config'
import * as THREE from 'three'

import { resolveColorSpec } from './themeColor'

/** 种类不认得时的兜底色，只影响外观、不影响任何读数 */
const COLOR_FALLBACK = '#00cefc'
/** 停流时的灰显色 */
const INACTIVE_COLOR = '#6b7686'
/** 各能源种类的内置配色；主题里配了 `--flow-<kind>` 时以主题为准 */
const KIND_COLORS: Readonly<Record<string, string>> = {
  water: '#4cc9ff',
  steam: '#dde5f2',
  electricity: '#ffd166',
  power: '#ffd166',
  gas: '#f78c6b',
  oil: '#c9a227',
  heat: '#ff6b6b',
  cold: '#8ecae6',
  air: '#8fe3a5',
}
/** 只有这个形状的种类名才拿去拼 CSS 变量名 */
const KIND_TOKEN_RE = /^[a-z0-9-]+$/
/** 停流时的透明度，两种材质共用 */
const INACTIVE_OPACITY = 0.12
const TUBE_OPACITY = 0.28
const PARTICLE_OPACITY = 0.95
const TUBE_RADIAL_SEGMENTS = 6
const PARTICLE_SEGMENTS_H = 8
const PARTICLE_SEGMENTS_V = 6
/** 管线沿路径每个途经点切几段 */
const TUBE_SEGMENTS_PER_POINT = 12
const MAX_TUBE_SEGMENTS = 240
/** 管线半径相对模型对角线 */
const TUBE_RADIUS_RATIO = 0.0025
const MIN_TUBE_RADIUS = 0.006
const MAX_TUBE_RADIUS = 0.25
/** 粒子半径相对管线半径 */
const PARTICLE_RADIUS_RATIO = 2.2
/** 每单位路径长度上的粒子数 */
const PARTICLES_PER_UNIT = 0.25
const MIN_PARTICLES = 4
const MAX_PARTICLES = 40
/** 强度为 1 时每秒走过的世界单位相对模型对角线 */
const SPEED_RATIO = 0.12
/** 相邻两点近到这个距离以内就当成同一个点 */
const MIN_SEGMENT = 1e-6
/** 单帧最多推进的秒数 */
const MAX_STEP_SECONDS = 0.1
/** 能量流压在模型之上，与锚点同档 */
const FLOW_RENDER_ORDER = 910
/** 空串/'0'/'false'/'off'/'no' 都当停流 */
const INACTIVE_TEXTS = new Set(['', '0', 'false', 'off', 'no'])

interface FlowEntry {
  flow: TwinFlowLink
  curve: THREE.CatmullRomCurve3
  /** 路径弧长，用来把「每秒多少世界单位」换成「每秒多少个 t」 */
  length: number
  tube: THREE.Mesh
  tubeMaterial: THREE.MeshBasicMaterial
  /** 一条流的粒子共用一份材质：灰显与调透明度只改这一处 */
  particles: THREE.Mesh[]
  particleMaterial: THREE.MeshBasicMaterial
  color: THREE.Color
  /** 粒子在路径上的当前相位，恒在 [0,1) */
  phase: number
  /** 带符号的速度因子，−1..1；0 = 静止 */
  speed: number
  active: boolean
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** 相位恒落回 [0,1)，负数也要绕回来。 */
function wrap01(value: number): number {
  return ((value % 1) + 1) % 1
}

/**
 * 锚点串 → 世界坐标点串。
 * ⚠ 悬空的锚点引用只跳过那一个点，不废掉整条流——悬空引用由
 * `collectTwinConfigIssues` 单独报出来，渲染层不替它报警。
 * ⚠ 连着的重合点必须并成一个：CatmullRom 在重合点上切线是零向量，
 * TubeGeometry 归一化它会写出 NaN 顶点，那根管线会整根从画面上消失。
 */
function pathPointsOf(
  flow: TwinFlowLink,
  anchorById: ReadonlyMap<string, TwinAnchor>,
): THREE.Vector3[] {
  const points: THREE.Vector3[] = []
  for (const anchorId of flow.pathAnchors) {
    const anchor = anchorById.get(anchorId)
    if (anchor === undefined) continue
    const point = new THREE.Vector3(...anchor.position)
    const last = points[points.length - 1]
    if (last !== undefined && last.distanceTo(point) <= MIN_SEGMENT) continue
    points.push(point)
  }
  return points
}

/** 粒子数按路径长度给，长管道才不会稀疏成几个孤点。 */
function particleCountOf(length: number): number {
  return clamp(
    Math.ceil(length * PARTICLES_PER_UNIT),
    MIN_PARTICLES,
    MAX_PARTICLES,
  )
}

function tubeSegmentsOf(curve: THREE.CatmullRomCurve3): number {
  return Math.min(
    curve.points.length * TUBE_SEGMENTS_PER_POINT,
    MAX_TUBE_SEGMENTS,
  )
}

/**
 * 激活位：只有明确给了假值才算停流。
 * ⚠ 没绑激活位（`undefined`/`null`）按在流：只绑强度不绑激活是常见配法，
 * 把它当停流会让那条流永远灰着不动。
 * ⚠ 字符串 `'false'`/`'0'` 在 JS 里是真值，直接 `Boolean()` 会把「停机」读成「在跑」。
 */
function isActive(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true
  if (typeof raw === 'string') {
    return !INACTIVE_TEXTS.has(raw.trim().toLowerCase())
  }
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== 0
  return Boolean(raw)
}

/**
 * 强度 → 带符号的速度因子。
 * ⚠ 不许反向的流拿到负强度按静止处理，而不是取绝对值：把「倒送」画成「正送」，
 * 一条实际在倒流的管线看上去会一切正常。
 */
function speedFactorOf(intensity: number, reversible: boolean): number {
  if (intensity < 0 && !reversible) return 0
  const magnitude = Math.min(Math.abs(intensity), 1)
  return intensity < 0 ? -magnitude : magnitude
}

/**
 * ⚠ 非有限或倒退的帧间隔按 0：乘进相位就是一整条流的粒子变 NaN 坐标。
 * ⚠ 上限也要卡：标签页切走再切回时 deltaSeconds 是几十秒，不卡的话粒子会
 * 一次跳过整条路径，看上去像瞬移。
 */
function usableStep(deltaSeconds: number): number {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return 0
  return Math.min(deltaSeconds, MAX_STEP_SECONDS)
}

/** 按当前相位把粒子铺回路径上，粒子在 t 上等距分布。 */
function placeParticles(entry: FlowEntry): void {
  const count = entry.particles.length
  entry.particles.forEach((particle, index) => {
    const at = wrap01(index / count + entry.phase)
    particle.position.copy(entry.curve.getPointAt(at))
  })
}

/** 颜色与透明度只有「在流」与「停流」两档。 */
function applyTone(entry: FlowEntry): void {
  entry.tubeMaterial.opacity = entry.active ? TUBE_OPACITY : INACTIVE_OPACITY
  entry.particleMaterial.opacity = entry.active
    ? PARTICLE_OPACITY
    : INACTIVE_OPACITY
  if (entry.active) {
    entry.tubeMaterial.color.copy(entry.color)
    entry.particleMaterial.color.copy(entry.color)
    return
  }
  entry.tubeMaterial.color.set(INACTIVE_COLOR)
  entry.particleMaterial.color.set(INACTIVE_COLOR)
}

/** 能量流层。一个实例绑一份场景，换配置时 `build` 重建。 */
export class FlowLayer {
  readonly group = new THREE.Group()
  private readonly host: HTMLElement | null
  private entries: FlowEntry[] = []
  /** 粒子几何全场共用：一条流一份的话，十几条流就是十几次 GPU 上传 */
  private particleGeometry: THREE.SphereGeometry | null = null
  private tubeRadius = MIN_TUBE_RADIUS
  /** 强度为 1 时每秒走过的世界单位 */
  private speedUnits = SPEED_RATIO

  constructor(host: HTMLElement | null) {
    this.host = host
    this.group.name = 'twin-flows'
  }

  /**
   * 重建全部能量流；`visible` 为假、或可解析的途经点不足两个的流不建对象。
   * @param flows 归一化后的能量流
   * @param anchors 归一化后的锚点，用来解析 `pathAnchors`
   */
  build(flows: readonly TwinFlowLink[], anchors: readonly TwinAnchor[]): void {
    this.clear()
    const anchorById = new Map(anchors.map((anchor) => [anchor.id, anchor]))
    const routes = flows
      // 只认作者直接置的显隐；随距离派生的那部分归取景层，不在这里算
      .filter((flow) => flow.visibility.visible)
      .map((flow) => ({ flow, points: pathPointsOf(flow, anchorById) }))
      // 一根管线至少要两个点，剩一个点连方向都定不出来
      .filter((route) => route.points.length >= 2)
    if (routes.length === 0) return
    const geometry = new THREE.SphereGeometry(
      1,
      PARTICLE_SEGMENTS_H,
      PARTICLE_SEGMENTS_V,
    )
    this.particleGeometry = geometry
    for (const route of routes) {
      this.entries.push(this.createEntry(route.flow, route.points, geometry))
    }
  }

  /**
   * 按流 id 取强度与激活位，换算成速度与明暗。
   * @param values 缝合后的能量流实时值
   */
  setValues(values: TwinFlowValues): void {
    for (const entry of this.entries) {
      const value = values[entry.flow.id]
      // 取不到条目按「没读数」：在流，但强度为 0 故静止
      const intensity =
        value === undefined ? 0 : (toFiniteNumber(value.intensity) ?? 0)
      entry.active = value === undefined ? true : isActive(value.active)
      entry.speed = entry.active
        ? speedFactorOf(intensity, entry.flow.reversible)
        : 0
      applyTone(entry)
    }
  }

  /**
   * 管线粗细、粒子大小与流速都跟模型体量走，否则大模型上它细成一根发丝、
   * 小模型上粗到盖住整个场景。
   * @param modelDiagonal 模型包围盒对角线长度
   */
  setWorldScale(modelDiagonal: number): void {
    const usable =
      Number.isFinite(modelDiagonal) && modelDiagonal > 0 ? modelDiagonal : 1
    this.tubeRadius = clamp(
      usable * TUBE_RADIUS_RATIO,
      MIN_TUBE_RADIUS,
      MAX_TUBE_RADIUS,
    )
    this.speedUnits = usable * SPEED_RATIO
    for (const entry of this.entries) this.applyEntryScale(entry)
  }

  /**
   * 推进粒子。
   * @param deltaSeconds 距上一帧的秒数
   */
  update(deltaSeconds: number): void {
    const step = usableStep(deltaSeconds)
    if (step === 0) return
    for (const entry of this.entries) {
      if (entry.speed === 0) continue
      // 每秒多少世界单位 → 每秒多少个 t：长短管道的视觉速度才一致
      const advance = (this.speedUnits * entry.speed * step) / entry.length
      entry.phase = wrap01(entry.phase + advance)
      placeParticles(entry)
    }
  }

  dispose(): void {
    this.clear()
  }

  private createEntry(
    flow: TwinFlowLink,
    points: THREE.Vector3[],
    particleGeometry: THREE.SphereGeometry,
  ): FlowEntry {
    const curve = new THREE.CatmullRomCurve3(points)
    const color = this.colorOf(flow.kind)
    const tubeMaterial = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: TUBE_OPACITY,
      depthWrite: false,
    })
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: color.clone(),
      transparent: true,
      opacity: PARTICLE_OPACITY,
      depthTest: false,
    })
    // 占位几何在 applyEntryScale 里立刻换成按当前体量算好的管线
    const tube = new THREE.Mesh(new THREE.BufferGeometry(), tubeMaterial)
    tube.renderOrder = FLOW_RENDER_ORDER
    const particles = makeParticles(
      particleCountOf(curve.getLength()),
      particleGeometry,
      particleMaterial,
    )
    this.group.add(tube, ...particles)
    const entry: FlowEntry = {
      flow,
      curve,
      length: curve.getLength(),
      tube,
      tubeMaterial,
      particles,
      particleMaterial,
      color,
      phase: 0,
      speed: 0,
      active: true,
    }
    this.applyEntryScale(entry)
    placeParticles(entry)
    return entry
  }

  /** 管线与粒子的尺寸都按「基准 × 本条流的线宽因子」算。 */
  private applyEntryScale(entry: FlowEntry): void {
    const radius = this.tubeRadius * entry.flow.width
    entry.tube.geometry.dispose()
    entry.tube.geometry = new THREE.TubeGeometry(
      entry.curve,
      tubeSegmentsOf(entry.curve),
      radius,
      TUBE_RADIAL_SEGMENTS,
      false,
    )
    const particleRadius = radius * PARTICLE_RADIUS_RATIO
    for (const particle of entry.particles) {
      particle.scale.setScalar(particleRadius)
    }
  }

  /** 种类配色：主题 token 优先，其次内置色，都没有就用缺省色。 */
  private colorOf(kind: string): THREE.Color {
    const key = kind.trim().toLowerCase()
    const themed = KIND_TOKEN_RE.test(key)
      ? resolveColorSpec(`--flow-${key}`, this.host)
      : null
    return themed ?? new THREE.Color(KIND_COLORS[key] ?? COLOR_FALLBACK)
  }

  // ⚠ 管线几何是一条流一份（形状就是那条路径，共用不了），漏掉它的 dispose
  // 表现是「编辑器开久了越来越卡」，而全程没有任何一处报错
  private clear(): void {
    for (const entry of this.entries) {
      this.group.remove(entry.tube, ...entry.particles)
      entry.tube.geometry.dispose()
      entry.tubeMaterial.dispose()
      entry.particleMaterial.dispose()
    }
    this.particleGeometry?.dispose()
    this.particleGeometry = null
    this.entries = []
  }
}

function makeParticles(
  count: number,
  geometry: THREE.SphereGeometry,
  material: THREE.MeshBasicMaterial,
): THREE.Mesh[] {
  const particles: THREE.Mesh[] = []
  for (let index = 0; index < count; index += 1) {
    const particle = new THREE.Mesh(geometry, material)
    particle.renderOrder = FLOW_RENDER_ORDER + 1
    particles.push(particle)
  }
  return particles
}
