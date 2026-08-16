/**
 * @fileoverview 运行态的自动漫游：把时间线接上渲染循环与相机，并管好「用户一动
 * 就停、闲置到点再开」这两条。
 *
 * ⚠ 计时器与轨道控制器的监听都成对装卸——大屏一开就是几天，漏一个就是一次
 * 持续累积的泄漏。
 */
import {
  RoamTimeline,
  buildRoamSegments,
  type TwinConfig,
  type TwinPose,
  type TwinRoamSegment,
  type TwinRoamTour,
} from '@dt/twin-config'
import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue'

import { applyCameraPose, type SceneCore } from './sceneCore'

export interface RoamTourDeps {
  /** 场景内核；WebGL 不可用时一直是 null。 */
  core: () => SceneCore | null
  /** ⚠ 必须是 `normalizeTwinConfig` 的输出：这里按引用比对，就地改字段不重建轨迹。 */
  config: () => TwinConfig
  /** 模型包围盒对角线；剪裁面要罩得住星空那一层壳。 */
  span: () => number
}

/** 宿主要用到的四个动作与两个状态。 */
export interface RoamTourController {
  /** 运行态该不该画播放控件。 */
  showControls: ComputedRef<boolean>
  playing: Ref<boolean>
  /** 场景内核装配好之后调一次：装监听、按配置决定要不要开播。 */
  attach: () => void
  /** 每帧推进；宿主把帧钟的时长换成毫秒喂进来。 */
  advance: (deltaMs: number) => void
  toggle: () => void
  next: () => void
  prev: () => void
  /** 停在当前位姿上。⚠ 手动切视点时必须先叫它，否则下一帧轨迹又把镜头拽走。 */
  pause: () => void
}

/**
 * 漫游的可变状态与动作。与 Vue 生命周期无关的那一半收在这里，组合式函数只做装配。
 */
class RoamRunner {
  readonly playing = ref(false)

  private readonly deps: RoamTourDeps
  private readonly tour: ComputedRef<TwinRoamTour>
  private readonly segments: ComputedRef<readonly TwinRoamSegment[]>
  private timeline: RoamTimeline
  private idleTimer = 0
  private attached: SceneCore | null = null

  constructor(
    deps: RoamTourDeps,
    tour: ComputedRef<TwinRoamTour>,
    segments: ComputedRef<readonly TwinRoamSegment[]>,
  ) {
    this.deps = deps
    this.tour = tour
    this.segments = segments
    this.timeline = new RoamTimeline(segments.value, tour.value.loop)
  }

  /** 装上轨道控制器的监听，并按配置决定开播还是等闲置。 */
  attach(): void {
    const core = this.deps.core()
    if (core === null || this.attached !== null) return
    this.attached = core
    core.controls.addEventListener('start', this.onUserInput)
    if (this.tour.value.enabled && this.tour.value.autoplay) this.play()
    else this.armIdleTimer()
  }

  /** 卸载收口：计时器、监听与时间线一起停。 */
  dispose(): void {
    this.clearIdleTimer()
    this.attached?.controls.removeEventListener('start', this.onUserInput)
    this.attached = null
    this.timeline.stop()
    this.playing.value = false
  }

  advance(deltaMs: number): void {
    this.applyPose(this.timeline.advance(deltaMs))
    // 非循环轨迹会自己走到头，播放态得跟着回落，否则控件一直显示「暂停」
    if (this.playing.value !== this.timeline.isPlaying) {
      this.playing.value = this.timeline.isPlaying
    }
  }

  play(): void {
    this.timeline.play()
    this.playing.value = this.timeline.isPlaying
  }

  pause(): void {
    this.timeline.pause()
    this.playing.value = false
  }

  toggle(): void {
    if (this.timeline.isPlaying) this.pause()
    else this.play()
  }

  /** 跳一站并立刻落位姿；`delta` 为正是下一站。 */
  step(delta: number): void {
    if (delta > 0) this.timeline.next()
    else this.timeline.prev()
    this.applyPose(this.timeline.pose())
  }

  /** 换一条时间线：段时长与站点顺序都在里面，接着用旧的会按旧轨迹飞。 */
  retime(segments: readonly TwinRoamSegment[]): void {
    const wasPlaying = this.timeline.isPlaying
    this.timeline = new RoamTimeline(segments, this.tour.value.loop)
    this.playing.value = false
    if (wasPlaying) this.play()
    else if (this.attached !== null) this.armIdleTimer()
  }

  private applyPose(pose: TwinPose | null): void {
    const core = this.deps.core()
    if (core === null || pose === null) return
    applyCameraPose(core, pose, this.deps.span())
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== 0) window.clearTimeout(this.idleTimer)
    this.idleTimer = 0
  }

  /** 闲置到点自动开播；没开这一档就一个计时器都不留。 */
  private armIdleTimer(): void {
    this.clearIdleTimer()
    const tour = this.tour.value
    if (!tour.enabled || !tour.idleAutoplay) return
    if (this.segments.value.length === 0) return
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = 0
      this.play()
    }, tour.idleAutoplayDelayMs)
  }

  // ⚠ 立刻停播、不等这一段飞完：用户已经在手动看别处了，镜头还自己往前飞
  // 会变成两个人抢方向盘
  private readonly onUserInput = (): void => {
    this.pause()
    this.armIdleTimer()
  }
}

/**
 * 装上自动漫游。
 * @param deps 取场景内核与配置的两个口子
 */
export function useRoamTour(deps: RoamTourDeps): RoamTourController {
  const tour = computed(() => deps.config().roamTour)
  const segments = computed(() =>
    buildRoamSegments(deps.config().cameras, tour.value),
  )
  const showControls = computed(
    () =>
      tour.value.enabled &&
      tour.value.showControls &&
      segments.value.length > 0,
  )
  const runner = new RoamRunner(deps, tour, segments)

  watch(segments, (value) => runner.retime(value))
  onBeforeUnmount(() => runner.dispose())

  return {
    showControls,
    playing: runner.playing,
    attach: () => runner.attach(),
    advance: (ms) => runner.advance(ms),
    toggle: () => runner.toggle(),
    next: () => runner.step(1),
    prev: () => runner.step(-1),
    pause: () => runner.pause(),
  }
}
