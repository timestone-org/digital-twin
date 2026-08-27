/**
 * @fileoverview WebGL 画布的快照登记处：DOM 截图方按根元素找到活着的场景，
 * 让每个场景当场出一张能被 `toDataURL` 读走的 2D 替身。
 * `withGlSubstitutes` 是截图方的统一入口——截图期间用替身顶掉 WebGL canvas，
 * 截完恢复；助手截图与保存缩略图共用这一份。
 */
import type { Camera, Object3D } from 'three'

/**
 * 快照要用的那一小截内核形状。`SceneCore` 结构兼容它。
 * ⚠ 不 import sceneCore 的类型：sceneCore 在建内核时要 import 本模块登记，
 * 反向哪怕只有类型也会被依赖图闸判成环。
 */
export interface SnapshotableCore {
  readonly scene: Object3D
  readonly camera: Camera
  readonly renderer: {
    readonly domElement: HTMLCanvasElement
    render(scene: Object3D, camera: Camera): void
  }
}

/** 一处可快照的 WebGL 画布。 */
export interface GlSnapshotSource {
  /** 被替身顶掉的那张 WebGL canvas；截图方按「在不在截图根下」筛它。 */
  host: HTMLElement
  /** 当场出一张同尺寸的 2D 快照；出不来（上下文丢了 / 被污染）给 null。 */
  snapshot: () => HTMLCanvasElement | null
}

const sources = new Set<GlSnapshotSource>()

/**
 * 登记一处快照源。
 * @param source 要登记的画布与快照函数
 * @returns 注销函数；场景销毁时必须调，否则截图方会去碰一张已经没了的画布
 */
export function registerGlSnapshot(source: GlSnapshotSource): () => void {
  sources.add(source)
  return () => {
    sources.delete(source)
  }
}

/**
 * root 下面登记过的全部快照源。
 * @param root 截图的根元素
 */
export function glSnapshotsWithin(
  root: HTMLElement,
): readonly GlSnapshotSource[] {
  return [...sources].filter((one) => root.contains(one.host))
}

/** 一处已插进 DOM 的替身，恢复时要还的三样。 */
interface PlacedSubstitute {
  host: HTMLElement
  substitute: HTMLCanvasElement
  /** host 原来的内联 visibility；恢复时原样放回。 */
  visibility: string
}

/**
 * 对 root 下每处登记过的 WebGL 画布取快照并插替身，跑完 run 再恢复原状。
 * 替身照抄 WebGL canvas 的内联样式（它们是 absolute + inset:0 铺满宿主），
 * 插成相邻兄弟；原 canvas 只临时隐藏，不动它的位置与内容。
 * 某一处快照失败（上下文丢了 / 被污染）就让那一块保持原状，不让整张截图失败。
 * @param root 截图的根元素
 * @param run 在替身就位期间要跑的截图动作
 */
export async function withGlSubstitutes<T>(
  root: HTMLElement,
  run: () => Promise<T>,
): Promise<T> {
  const placed: PlacedSubstitute[] = []
  for (const source of glSnapshotsWithin(root)) {
    const parent = source.host.parentElement
    if (parent === null) continue
    const substitute = source.snapshot()
    if (substitute === null) continue
    substitute.style.cssText = source.host.style.cssText
    parent.insertBefore(substitute, source.host.nextSibling)
    placed.push({
      host: source.host,
      substitute,
      visibility: source.host.style.visibility,
    })
    source.host.style.visibility = 'hidden'
  }
  try {
    return await run()
  } finally {
    for (const one of placed) {
      one.substitute.remove()
      one.host.style.visibility = one.visibility
    }
  }
}

/**
 * 给一套场景内核出一张 2D 快照。
 * ⚠ 必须先画一帧再取：渲染器没开 `preserveDrawingBuffer`（那是拿每帧性能换
 * 一次截图，不换），WebGL 的后备缓冲在下一帧就被清了（同 `saveScreenshot`）。
 * 任何一步失败都给 null——截图里这一块宁可空白，也不能让整张截图失败。
 * @param core 场景内核
 */
export function snapshotSceneCore(
  core: SnapshotableCore,
): HTMLCanvasElement | null {
  const gl = core.renderer.domElement
  try {
    core.renderer.render(core.scene, core.camera)
    if (gl.width === 0 || gl.height === 0) return null
    const copy = document.createElement('canvas')
    copy.width = gl.width
    copy.height = gl.height
    const context = copy.getContext('2d')
    if (context === null) return null
    context.drawImage(gl, 0, 0)
    return copy
  } catch {
    return null
  }
}

const coreUnregisters = new WeakMap<SnapshotableCore, () => void>()

/**
 * 把一套场景内核登记成快照源。`createSceneCore` 建好即调——每个场景内核
 * 天然可截图，不需要各个宿主组件自己记着登记。重复登记同一内核给回同一个
 * 注销函数，不会出双份。
 * @param core 场景内核
 * @returns 注销函数；`disposeScene` 会按 core 注销，通常不用自己攥着
 */
export function registerCoreSnapshot(core: SnapshotableCore): () => void {
  const existing = coreUnregisters.get(core)
  if (existing !== undefined) return existing
  const unregister = registerGlSnapshot({
    host: core.renderer.domElement,
    snapshot: () => snapshotSceneCore(core),
  })
  coreUnregisters.set(core, unregister)
  return unregister
}

/**
 * 按场景内核注销快照源；没登记过就什么都不做。
 * @param core 场景内核
 */
export function unregisterCoreSnapshot(core: SnapshotableCore): void {
  coreUnregisters.get(core)?.()
  coreUnregisters.delete(core)
}

/** 只给测试用：清空登记表。 */
export function __resetGlSnapshots(): void {
  sources.clear()
}
