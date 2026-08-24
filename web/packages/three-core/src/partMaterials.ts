/**
 * @fileoverview 部件的材质记账：克隆一份独占的材质，记下基线，再按外观反复套。
 *
 * ⚠ 必须先**克隆**再改：GLB 里的材质常被几十个网格共用，直接改原材质会把毫不
 * 相干的部位一起染了，而画面上完全看不出是谁干的。克隆件由本类持有并释放。
 * ⚠ 每次都从**基线**重算、绝不在当前值上叠加：叠加会让颜色随帧数一路漂移，
 * 表现是「放着不动，颜色越来越深」。
 * ⚠ 换 `transparent` / `depthWrite` 要触发着色器重编，所以只在真的变了时才写；
 * 每帧无脑写一遍会让部件一多就掉帧，而这与「配了染色」看起来毫无关系。
 * ⚠ 释放时必须把**原材质装回网格**再释放克隆件：不装回去的话，下一次重建克隆的
 * 是「已经被改过的那一份」，基线跟着一起变——每改一次配置，透明度与颜色就更偏
 * 一层；更糟的是那份材质已经 `dispose` 过了，却还挂在网格上继续画。
 */
import * as THREE from 'three'

/** 低于它就当成需要透明通道；浮点误差下 1 未必等于 1。 */
const NEARLY_OPAQUE = 0.999

/** 一个部件这一刻的材质外观，颜色已经解析成 `THREE.Color`。 */
export interface PartLook {
  /** 不透明度倍率 [0,1]，乘在材质基线上。 */
  opacity: number
  /** 染色；null = 保持原色。 */
  color: THREE.Color | null
  /** 染色浓度 [0,1]。 */
  blend: number
  /** 自发光强度；0 或没有染色时还原成基线。 */
  glow: number
}

/** 有基础色通道的材质。⚠ `MeshBasicMaterial` 有色但没有自发光，两者要分开判。 */
interface ColoredMaterial extends THREE.Material {
  color: THREE.Color
}

/** 有自发光通道的材质。 */
interface GlowingMaterial extends THREE.Material {
  emissive: THREE.Color
  emissiveIntensity: number
}

function isColored(material: THREE.Material): material is ColoredMaterial {
  return 'color' in material && material.color instanceof THREE.Color
}

function isGlowing(material: THREE.Material): material is GlowingMaterial {
  return (
    'emissive' in material &&
    material.emissive instanceof THREE.Color &&
    'emissiveIntensity' in material &&
    typeof material.emissiveIntensity === 'number'
  )
}

/** 一份材质被改动前的样子，每次套外观都从它重算。 */
interface Baseline {
  material: THREE.Material
  opacity: number
  transparent: boolean
  depthWrite: boolean
  color: THREE.Color | null
  emissive: THREE.Color | null
  emissiveIntensity: number
}

/** 一块网格原来挂的是哪份材质（单个或一组）。 */
interface Owner {
  mesh: THREE.Mesh
  original: THREE.Material | THREE.Material[]
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material]
}

function baselineOf(material: THREE.Material): Baseline {
  return {
    material,
    opacity: material.opacity,
    transparent: material.transparent,
    depthWrite: material.depthWrite,
    color: isColored(material) ? material.color.clone() : null,
    emissive: isGlowing(material) ? material.emissive.clone() : null,
    emissiveIntensity: isGlowing(material) ? material.emissiveIntensity : 1,
  }
}

/** 两次外观一样吗；一样就整份跳过，不去碰任何材质。 */
function sameLook(left: PartLook | null, right: PartLook): boolean {
  if (left === null) return false
  return (
    left.opacity === right.opacity &&
    left.blend === right.blend &&
    left.glow === right.glow &&
    (left.color === null
      ? right.color === null
      : right.color !== null && left.color.equals(right.color))
  )
}

/**
 * 一个部件名下全部网格的材质。构造时即克隆并记基线。
 * ⚠ 只给**真的要改外观**的部件建：没配透明度也没配染色的部件建一份，等于白白
 * 多占一份显存，而它不会有任何可见的差别。
 */
export class PartMaterials {
  private readonly baselines: Baseline[] = []
  /** 网格 → 它原来那份材质，释放时装回去。 */
  private readonly owners: Owner[] = []
  private applied: PartLook | null = null

  constructor(meshes: readonly THREE.Mesh[]) {
    for (const mesh of meshes) {
      this.owners.push({ mesh, original: mesh.material })
      const clones = materialsOf(mesh).map((material) => material.clone())
      const single = clones[0]
      // ⚠ 单材质的 mesh 要还原成单个而不是长度 1 的数组：three 按数组材质走
      //   分组绘制，几何上没有分组时整块网格会直接不画
      mesh.material =
        clones.length === 1 && single !== undefined ? single : clones
      for (const clone of clones) this.baselines.push(baselineOf(clone))
    }
  }

  /**
   * 套一次外观。与上次相同即整份跳过。
   * @param look 这一刻的材质外观
   */
  apply(look: PartLook): void {
    if (sameLook(this.applied, look)) return
    this.applied = { ...look, color: look.color?.clone() ?? null }
    for (const base of this.baselines) {
      applyOpacity(base, look.opacity)
      applyColor(base, look)
    }
  }

  /**
   * 装回原材质并释放克隆件。
   * ⚠ 顺序不可换：先装回去、再释放。反过来的话，中间那一瞬网格挂着的是已经
   * 释放掉的材质；而克隆件本身没人替我们收——模型卸载时释放的是原始那一份。
   */
  dispose(): void {
    for (const owner of this.owners) owner.mesh.material = owner.original
    this.owners.length = 0
    for (const base of this.baselines) base.material.dispose()
    this.baselines.length = 0
    this.applied = null
  }
}

/** 不透明度按基线成比例缩；只在跨过「要不要透明通道」时才动着色器状态。 */
function applyOpacity(base: Baseline, factor: number): void {
  const { material } = base
  material.opacity = base.opacity * factor
  const transparent = base.transparent || material.opacity < NEARLY_OPAQUE
  // ⚠ 半透明还写深度会让自己挡住自己，表现是「透明部件里面是空的」
  const depthWrite = base.depthWrite && material.opacity >= NEARLY_OPAQUE
  if (
    material.transparent === transparent &&
    material.depthWrite === depthWrite
  )
    return
  material.transparent = transparent
  material.depthWrite = depthWrite
  material.needsUpdate = true
}

/** 基础色与自发光；没有染色时两者都还原到基线。 */
function applyColor(base: Baseline, look: PartLook): void {
  const { material } = base
  if (base.color !== null && isColored(material)) {
    material.color.copy(base.color)
    if (look.color !== null) material.color.lerp(look.color, look.blend)
  }
  if (base.emissive === null || !isGlowing(material)) return
  if (look.color === null || look.glow === 0) {
    material.emissive.copy(base.emissive)
    material.emissiveIntensity = base.emissiveIntensity
    return
  }
  material.emissive.copy(look.color)
  material.emissiveIntensity = look.glow
}
