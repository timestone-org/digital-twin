/**
 * @fileoverview 运行态的地面网格：给大屏上的模型一个坐标参考面。
 * 由 `model.showGroundGrid` 开关控制，关掉要连同 GPU 资源一起释放；
 * 中心线落在当前坐标基准的原点上（`model.coordFrame`）。
 *
 * ⚠ 与编辑视口那圈网格是两回事：编辑器的恒显（没有参考系就没法摆坐标），
 * 这一层才是用户配的那个开关。
 */
import type { Vec3 } from '@dt/twin-config'
import * as THREE from 'three'

import { resolveColorSpec } from './themeColor'

/** 网格边长与格数；随模型体量整体缩放，不重建几何。 */
const GRID_SIZE = 40
const GRID_DIVISIONS = 40
/** 压暗到不抢模型：网格是参考物，不是画面主体。 */
const GRID_OPACITY = 0.35
/** 缩放上下限，模型极大或极小时网格仍要看得见。 */
const MIN_SCALE = 0.2
const MAX_SCALE = 8

// 网格没有自己的配色字段，跟随主题的描边轴：中心线用重的那档，格线用轻的
const CENTER_LINE_TOKEN = '--border-strong'
const LINE_TOKEN = '--border-subtle'
/** token 取不出时的兜底色：网格没有别的迹象能提示取色失败，宁可画出来。 */
const CENTER_FALLBACK = 0x2c5a8a
const LINE_FALLBACK = 0x123040

function colorOf(
  token: string,
  fallback: number,
  host: HTMLElement | null,
): THREE.Color {
  return resolveColorSpec(token, host) ?? new THREE.Color(fallback)
}

/**
 * 网格随模型体量缩放；体量取不到时按 1 倍。
 * @param span 模型包围盒对角线长度
 */
export function gridScaleFor(span: number): number {
  if (!Number.isFinite(span) || span <= 0) return 1
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, span / GRID_SIZE))
}

/**
 * 地面网格层。宿主每次配置或模型变化调一次 `sync`，卸载时 `dispose`。
 *
 * ⚠ 关掉开关要真的把 `GridHelper` 摘下来并释放几何与材质：只 `visible = false`
 * 的话它仍在渲染树里，且换模型时那份几何一直留着——一整轮编辑下来就是一串泄漏。
 */
export class GroundGridLayer {
  private readonly scene: THREE.Scene
  private readonly host: HTMLElement | null
  private grid: THREE.GridHelper | null = null

  /**
   * @param scene 挂载目标
   * @param host 读 CSS 变量级联的宿主元素
   */
  constructor(scene: THREE.Scene, host: HTMLElement | null) {
    this.scene = scene
    this.host = host
  }

  /** 当前是否画着网格；测试与宿主据此断言。 */
  get isShown(): boolean {
    return this.grid !== null
  }

  /**
   * 按开关建或删，把体量落到缩放上，并把网格挪到基准原点。
   * @param show `model.showGroundGrid`
   * @param span 模型包围盒对角线长度
   * @param origin 当前坐标基准的原点（世界坐标）；网格的中心线就画在这里
   */
  sync(show: boolean, span: number, origin: Vec3): void {
    if (!show) return this.clear()
    if (this.grid === null) this.create()
    const scale = gridScaleFor(span)
    this.grid?.scale.setScalar(scale)
    // 网格是坐标参考面：中心线落在基准原点上，否则「坐标 0」在画面上没有落点
    this.grid?.position.set(...origin)
  }

  private create(): void {
    const grid = new THREE.GridHelper(
      GRID_SIZE,
      GRID_DIVISIONS,
      colorOf(CENTER_LINE_TOKEN, CENTER_FALLBACK, this.host),
      colorOf(LINE_TOKEN, LINE_FALLBACK, this.host),
    )
    grid.name = 'twin-ground-grid'
    const material = grid.material as THREE.Material
    material.transparent = true
    material.opacity = GRID_OPACITY
    // 不写深度：网格压在模型下面时不该把模型的像素挖掉
    material.depthWrite = false
    this.scene.add(grid)
    this.grid = grid
  }

  private clear(): void {
    const grid = this.grid
    if (grid === null) return
    this.scene.remove(grid)
    grid.geometry.dispose()
    ;(grid.material as THREE.Material).dispose()
    this.grid = null
  }

  dispose(): void {
    this.clear()
  }
}
