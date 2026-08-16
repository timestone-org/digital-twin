/**
 * @fileoverview GLB 自带动画的播放层：按配置决定播哪几段、多快，每帧推进。
 *
 * ⚠ 动画剪辑属于模型，换模型必须整层重建；只换配置则原地开关，
 * 重建会让动画从头跳一下。
 */
import type { TwinModelAnimations } from '@dt/twin-config'
import * as THREE from 'three'

/** 没配 clips 时播全部，这是「留空 = 全播」的落点。 */
function activeNames(
  config: TwinModelAnimations,
  available: readonly string[],
): Set<string> {
  if (config.clips.length === 0) return new Set(available)
  // ⚠ 只留模型里真有的那些：配置里留着已改名的旧 clip 名不该让整段配置失效
  return new Set(config.clips.filter((name) => available.includes(name)))
}

/**
 * 一个模型的动画播放。宿主在装载后建、每帧 `update`、配置变了 `apply`、卸载 `dispose`。
 */
export class ModelAnimations {
  private readonly mixer: THREE.AnimationMixer | null
  private readonly actions = new Map<string, THREE.AnimationAction>()

  /**
   * @param root 模型根
   * @param clips GLB 里的动画剪辑；空数组时整层是个空壳
   */
  constructor(root: THREE.Object3D, clips: readonly THREE.AnimationClip[]) {
    if (clips.length === 0) {
      this.mixer = null
      return
    }
    const mixer = new THREE.AnimationMixer(root)
    for (const clip of clips) {
      const action = mixer.clipAction(clip)
      action.setLoop(THREE.LoopRepeat, Number.POSITIVE_INFINITY)
      this.actions.set(clip.name, action)
    }
    this.mixer = mixer
  }

  /** 模型里有几段动画；宿主据此决定要不要每帧推进。 */
  get clipNames(): readonly string[] {
    return [...this.actions.keys()]
  }

  /** 当前正在播的那些。 */
  get playingNames(): readonly string[] {
    return [...this.actions.entries()]
      .filter(([, action]) => action.isRunning())
      .map(([name]) => name)
  }

  /**
   * 按配置开关每一段并调速。
   * ⚠ 停的那些要 `stop()` 而不是只把权重调 0：权重 0 的 action 仍在被 mixer
   * 每帧求值，十几段动画的模型上白烧一份 CPU。
   * @param config 归一化后的动画配置
   */
  apply(config: TwinModelAnimations): void {
    if (this.mixer === null) return
    const wanted = config.enabled
      ? activeNames(config, this.clipNames)
      : new Set<string>()
    for (const [name, action] of this.actions) {
      action.timeScale = config.speed
      if (wanted.has(name)) {
        if (!action.isRunning()) action.reset().play()
      } else if (action.isRunning()) {
        action.stop()
      }
    }
  }

  /**
   * 推进一帧。
   * @param deltaS 距上一帧过了多少秒
   */
  update(deltaS: number): void {
    this.mixer?.update(deltaS)
  }

  dispose(): void {
    // ⚠ `stopAllAction` 之外还要 uncache：mixer 内部按 clip 缓存着求值器，
    // 反复换模型时那份缓存会一直涨
    this.mixer?.stopAllAction()
    for (const action of this.actions.values()) {
      this.mixer?.uncacheAction(action.getClip())
    }
    this.actions.clear()
  }
}
