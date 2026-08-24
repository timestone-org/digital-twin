/**
 * @fileoverview 部件这一层：距离显隐、透明度、状态染色，外加点击要用的包围盒。
 * 它不往场景里加任何对象，改的是模型自己的节点与材质。
 *
 * ⚠ 同一个网格被两个部件同时命中时，后建的那个部件说了算——这是配置本身的
 * 歧义，渲染层不猜，也不报错。
 * ⚠ 只有**真的要改外观**的部件才克隆材质（配了淡出 / 透明度 / 常态色 / 染色）：
 * 无差别克隆等于把整个模型的材质翻一倍，而它不会有任何可见的差别。
 */
import {
  partAppearance,
  type TwinPart,
  type TwinPartColor,
  type TwinPartValues,
} from '@dt/twin-config'
import * as THREE from 'three'

import { distanceResolver, type DistanceContext } from './distanceContext'
import { resolveVisibility } from './distanceRules'
import { meshesOfNames, objectsOfNames, type NodeIndex } from './nodeIndex'
import { PartMaterials, type PartLook } from './partMaterials'
import { ColorSpecCache } from './themeColor'

interface PartEntry {
  part: TwinPart
  objects: THREE.Object3D[]
  /** 世界包围盒；部件没命中任何东西时为 null。 */
  box: THREE.Box3 | null
  /** 包围盒中心；算不出来时为 null。 */
  center: THREE.Vector3 | null
  /** 要改外观的部件才有；其余为 null，一份材质都不克隆。 */
  materials: PartMaterials | null
  /**
   * 这个部件自己的取色暂存。
   * ⚠ 不共用一个：渐变每帧算出来的颜色是就地写进去的，共用会让所有部件都拿到
   * 最后一个部件算出的那个色。
   */
  scratch: THREE.Color
}

/** 部件的世界包围盒；一个对象都没命中时给 null。 */
function boxOf(objects: readonly THREE.Object3D[]): THREE.Box3 | null {
  if (objects.length === 0) return null
  const box = new THREE.Box3()
  for (const object of objects) box.expandByObject(object)
  return box.isEmpty() ? null : box
}

/** 这个部件会动到材质吗；不会就别克隆。 */
function changesMaterials(part: TwinPart): boolean {
  return (
    part.visibility.fade !== null ||
    part.look.opacity < 1 ||
    part.look.color !== '' ||
    part.tint !== null
  )
}

/** 部件这一层。换模型或换配置时 `build` 重建。 */
export class PartsLayer {
  private entries: PartEntry[] = []
  private values: TwinPartValues = {}
  private readonly colors: ColorSpecCache

  /**
   * @param host 读 CSS 变量级联的宿主元素；null = 只认 hex 色，token 一律解析不出
   */
  constructor(host: HTMLElement | null = null) {
    this.colors = new ColorSpecCache(host)
  }

  /**
   * 按当前模型与配置建索引。
   * @param index 模型节点索引
   * @param parts 归一化后的部件
   */
  build(index: NodeIndex, parts: readonly TwinPart[]): void {
    this.clear()
    // 换了一份配置就重解析：换肤后仍用上一套配色的话，只有染过色的部件不跟主题
    this.colors.clear()
    for (const part of parts) {
      const objects = objectsOfNames(index, part.nodes)
      const box = boxOf(objects)
      this.entries.push({
        part,
        objects,
        box,
        center: box === null ? null : box.getCenter(new THREE.Vector3()),
        materials: changesMaterials(part)
          ? new PartMaterials(meshesOfNames(index, part.nodes))
          : null,
        scratch: new THREE.Color(),
      })
    }
  }

  /**
   * 换一份部件实时值，状态染色下一帧生效。
   * @param values 按部件 id 索引的实时值
   */
  setValues(values: TwinPartValues): void {
    this.values = values
  }

  /**
   * 按这一帧的取景状态更新显隐与外观。
   * @param context 这一帧的相机与轨道中心
   */
  apply(context: DistanceContext): void {
    for (const entry of this.entries) {
      const state = resolveVisibility(
        entry.part.visibility,
        distanceResolver(context, entry.center, entry.center),
      )
      for (const object of entry.objects) object.visible = state.visible
      this.dress(entry, state.opacity)
    }
  }

  /**
   * 只套配置里的外观，不看距离、也不动显隐。
   *
   * ⚠ 编辑视口专用：那边有意不套距离规则（编辑时镜头到处飞，套上会让刚配好的
   * 东西一转镜头就不见），但透明度与染色**必须**当场看得见——看不见就等于没法配。
   * 显隐在编辑器里由左栏的眼睛单独管，这里一个字都不能碰。
   */
  applyAppearance(): void {
    for (const entry of this.entries) this.dress(entry, 1)
  }

  /**
   * 射线命中的对象属于哪个部件；顺着父链往上找。
   * ⚠ 命中的是网格，而部件寻址的是它的某个**祖先**节点名——只比对象本身的话，
   * 点在模型上永远找不到部件，表现为「点了没反应」。
   * @param object 射线命中的对象
   */
  partAt(object: THREE.Object3D): TwinPart | null {
    for (let node: THREE.Object3D | null = object; node; node = node.parent) {
      const owner = this.entries.find((entry) => entry.objects.includes(node))
      if (owner !== undefined) return owner.part
    }
    return null
  }

  /**
   * 某个部件的包围盒中心，点击门禁要用它算 `part-center` 距离。
   * @param partId 部件 id
   */
  centerOf(partId: string): THREE.Vector3 | null {
    return (
      this.entries.find((entry) => entry.part.id === partId)?.center ?? null
    )
  }

  /**
   * 某个部件的世界包围盒；`approach` 那一下要用它把镜头拉过去。
   * @param partId 部件 id
   */
  boxOf(partId: string): THREE.Box3 | null {
    return this.entries.find((entry) => entry.part.id === partId)?.box ?? null
  }

  dispose(): void {
    this.clear()
  }

  /**
   * 把外观套到这个部件的材质上。
   * ⚠ 距离淡出是**乘**在配置的透明度上，不是覆盖：写成覆盖的话，给半透明外壳
   * 配了淡出之后，一进近景它反而变得比平时更实。
   * @param fade 这一帧的距离淡出系数，1 = 不淡
   */
  private dress(entry: PartEntry, fade: number): void {
    const look = this.lookOf(entry)
    entry.materials?.apply({ ...look, opacity: look.opacity * fade })
  }

  /** 这个部件这一刻的材质外观，颜色已解析成 `THREE.Color`。 */
  private lookOf(entry: PartEntry): PartLook {
    const appearance = partAppearance(
      entry.part,
      this.values[entry.part.id]?.value,
    )
    return {
      opacity: appearance.opacity,
      color: this.colorOf(appearance.color, entry.scratch),
      blend: appearance.blend,
      glow: appearance.glow,
    }
  }

  /**
   * 取色结果 → `THREE.Color`；解析不出来给 null（= 保持原色）。
   * ⚠ 解析不出来时不许回落成某个默认色：那会让「token 名写错了」看起来像
   * 「配对了」，而 3D 里没有任何别的迹象能提示这一点。
   */
  private colorOf(
    color: TwinPartColor,
    scratch: THREE.Color,
  ): THREE.Color | null {
    if (color.kind === 'none') return null
    if (color.kind === 'solid') return this.colors.get(color.spec)
    const from = this.colors.get(color.from)
    const to = this.colors.get(color.to)
    if (from === null || to === null) return from ?? to
    return scratch.copy(from).lerp(to, color.t)
  }

  private clear(): void {
    for (const entry of this.entries) entry.materials?.dispose()
    this.entries = []
  }
}
