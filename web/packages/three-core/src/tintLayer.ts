/**
 * @fileoverview 状态染色层：把 twin-config 的染色规则落到模型材质的颜色上。
 * ⚠ 直接改材质的 `color` 而不是换一份材质——换材质意味着要盯着把换下来的那份释放掉，
 * 而「已脱离对象图的旧材质」正是 `disposeSceneGraph` 触达不到的一类泄漏。
 */
import type { TwinConfig, TwinTintRule, TwinTintValues } from '@dt/twin-config'
import { tintColorSpec, tintTargetNodes } from '@dt/twin-config'
import * as THREE from 'three'

import { meshesOfNames, type NodeIndex } from './nodeIndex'
import { resolveColorSpec } from './themeColor'

/** 一个网格上可染色的颜色对象；没有 `color` 的材质（线框、深度）跳过。 */
function meshColors(mesh: THREE.Mesh): THREE.Color[] {
  const materials = Array.isArray(mesh.material)
    ? mesh.material
    : [mesh.material]
  const found: THREE.Color[] = []
  for (const material of materials) {
    if (!('color' in material)) continue
    const color = material.color
    if (color instanceof THREE.Color) found.push(color)
  }
  return found
}

/**
 * 染色层。一个实例绑一份节点索引，换模型时整个丢掉重建。
 * ⚠ 同一份材质被多个部件共用时最后一条规则赢——一期不为此克隆材质。
 */
export class TintLayer {
  private readonly index: NodeIndex
  private readonly host: HTMLElement | null
  /** 首次被染前的原色，按 Color 对象记账 */
  private readonly original = new Map<THREE.Color, number>()
  private tinted = new Set<THREE.Color>()

  constructor(index: NodeIndex, host: HTMLElement | null) {
    this.index = index
    this.host = host
  }

  /**
   * 按当前配置与实时值重算染色；这一轮没命中的部件恢复原色。
   * @param config 归一化后的孪生配置
   * @param values 缝合后的染色实时值
   */
  apply(config: TwinConfig, values: TwinTintValues): void {
    const next = new Set<THREE.Color>()
    for (const rule of config.tints) this.paintRule(config, rule, values, next)
    for (const color of this.tinted) {
      if (!next.has(color)) this.restore(color)
    }
    this.tinted = next
  }

  /** 恢复全部原色并清空记账。 */
  dispose(): void {
    for (const color of this.tinted) this.restore(color)
    this.tinted.clear()
    this.original.clear()
  }

  private paintRule(
    config: TwinConfig,
    rule: TwinTintRule,
    values: TwinTintValues,
    next: Set<THREE.Color>,
  ): void {
    const spec = tintColorSpec(rule, values[rule.id])
    if (spec === null) return
    const color = resolveColorSpec(spec, this.host)
    if (color === null) return
    const nodes = tintTargetNodes(config.parts, rule)
    for (const mesh of meshesOfNames(this.index, nodes)) {
      for (const target of meshColors(mesh)) {
        if (!this.original.has(target)) {
          this.original.set(target, target.getHex())
        }
        target.copy(color)
        next.add(target)
      }
    }
  }

  private restore(color: THREE.Color): void {
    const hex = this.original.get(color)
    if (hex !== undefined) color.setHex(hex)
  }
}
