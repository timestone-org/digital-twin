/**
 * @fileoverview 漫游轨迹的时间线：把一串视点摊成「飞一段、停一会儿」的序列，
 * 再按喂进来的时长推进出「这一刻镜头该在哪」。纯逻辑，不碰 Vue / three / DOM，
 * 单测直接喂 dt 就能驱动完整一圈。
 */
import { clampedOr } from './normalizeShared'
import { applyRoamEasing, interpTwinPose, type TwinPose } from './roamPose'
import type { TwinCamera, TwinRoamTour } from './types'

/**
 * 单步推进的上限，ms。
 * ⚠ 标签页切走再回来时一帧的间隔能有几十秒，不夹的话一帧就把整条轨迹走完——
 * 用户切回来只看到镜头已经瞬移到了终点。与 `@dt/three-core` 帧钟的 `MAX_FRAME_S`
 * 同值（本包不许依赖 three-core，两者一致由那边的契约用例守着）。
 */
export const MAX_ROAM_STEP_MS = 100

/** 轨迹上的一段：从一个视点飞到下一个，到站再停一会儿。 */
export interface TwinRoamSegment {
  /** 本段起始视点 id；逐段覆盖按它取。 */
  fromId: string
  /** 本段落点视点 id；编辑器拿它显示「A → B」。 */
  toId: string
  from: TwinPose
  to: TwinPose
  /** 飞行时长 ms。 */
  flyMs: number
  /** 到站后的停留时长 ms。 */
  holdMs: number
}

/** 时间线此刻在干什么。`idle` = 非循环轨迹已经走完，停在终点上。 */
export type TwinRoamPhase = 'flying' | 'holding' | 'idle'

/**
 * 轨迹上能解析出的视点，按 `items` 的顺序。
 * ⚠ 指向已删视点的 id 直接跳过、不占位：留着会让镜头飞向一个不存在的位姿。
 * 悬空 id 本身不在这里清理，由 `collectTwinConfigIssues` 报出来。
 * @param cameras 归一化后的视点
 * @param tour 归一化后的漫游配置
 */
export function roamTourStops(
  cameras: readonly TwinCamera[],
  tour: TwinRoamTour,
): TwinCamera[] {
  const byId = new Map(cameras.map((camera) => [camera.id, camera]))
  return tour.items
    .map((id) => byId.get(id))
    .filter((camera): camera is TwinCamera => camera !== undefined)
}

function poseOf(camera: TwinCamera): TwinPose {
  return {
    position: camera.position,
    target: camera.target,
    fov: camera.fov,
  }
}

/**
 * 一段的两个时长：逐段覆盖优先，缺省取全局值。
 * ⚠ 停留取的是**刚飞完那一段**的设置，也就是起始视点那一条——停留属于前一段
 * 的尾巴，按目的地去取会整体错开一站。
 */
function segmentOf(
  tour: TwinRoamTour,
  from: TwinCamera,
  to: TwinCamera,
): TwinRoamSegment {
  const override = tour.segmentSettings[from.id]
  return {
    fromId: from.id,
    toId: to.id,
    from: poseOf(from),
    to: poseOf(to),
    flyMs: Math.max(0, override?.segmentMs ?? tour.segmentMs),
    holdMs: Math.max(0, override?.pauseMs ?? tour.pauseMs),
  }
}

/**
 * 把轨迹摊成一段段。可用视点不足两个时给空数组——那不是「播 0 秒」，是这条
 * 轨迹根本不成立，运行态与预览都不该起播。
 * @param cameras 归一化后的视点
 * @param tour 归一化后的漫游配置
 */
export function buildRoamSegments(
  cameras: readonly TwinCamera[],
  tour: TwinRoamTour,
): TwinRoamSegment[] {
  const stops = roamTourStops(cameras, tour)
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (first === undefined || last === undefined || stops.length < 2) return []
  const out = stops.flatMap((stop, index) => {
    const next = stops[index + 1]
    return next === undefined ? [] : [segmentOf(tour, stop, next)]
  })
  // 循环时补一段「末站飞回首站」，否则每圈结尾都要瞬移回起点
  if (tour.loop) out.push(segmentOf(tour, last, first))
  return out
}

/**
 * 一条轨迹的播放状态机。宿主每帧喂一次 `advance`，拿到的位姿直接落到相机上。
 * ⚠ 它自己不持有任何计时器：时间从外面喂进来，测试才能把一整圈压进几次调用里。
 */
export class RoamTimeline {
  private readonly segments: readonly TwinRoamSegment[]
  private readonly loop: boolean
  private index = 0
  private phase: TwinRoamPhase = 'flying'
  private elapsedMs = 0
  private running = false

  /**
   * @param segments `buildRoamSegments` 的输出
   * @param loop 走完最后一段是否回到第一段
   */
  constructor(segments: readonly TwinRoamSegment[], loop: boolean) {
    this.segments = segments
    this.loop = loop
  }

  get isPlaying(): boolean {
    return this.running
  }

  /** 一段都摊不出来的轨迹：宿主据此不显示控件、不起播。 */
  get isEmpty(): boolean {
    return this.segments.length === 0
  }

  /** 当前在第几段。 */
  get segmentIndex(): number {
    return this.index
  }

  get currentPhase(): TwinRoamPhase {
    return this.phase
  }

  /** 开播；非循环走完之后再调是从头再来。 */
  play(): void {
    if (this.isEmpty) return
    if (this.phase === 'idle') this.rewind()
    this.running = true
  }

  /** 停在当前位姿上，`play` 能原地续上。 */
  pause(): void {
    this.running = false
  }

  /** 停下并回到起点。 */
  stop(): void {
    this.running = false
    this.rewind()
  }

  /** 跳到下一站；在播就接着播，暂停着就停在那一站。 */
  next(): void {
    this.jump(1)
  }

  /** 跳回上一站。 */
  prev(): void {
    this.jump(-1)
  }

  /**
   * 推进一步，返回这一刻该落到相机上的位姿；没在播或轨迹不成立给 null。
   * ⚠ 单步夹在 `MAX_ROAM_STEP_MS` 内，非有限数按 0 算：拿一个几十秒的 dt
   * 直接算下去，会一帧跨完整条轨迹。
   * @param deltaMs 距上一次推进过了多久
   */
  advance(deltaMs: number): TwinPose | null {
    if (!this.running || this.isEmpty) return null
    this.consume(clampedOr(deltaMs, 0, 0, MAX_ROAM_STEP_MS))
    return this.pose()
  }

  /** 当前位姿；轨迹不成立时给 null。 */
  pose(): TwinPose | null {
    const segment = this.segments[this.index]
    if (segment === undefined) return null
    if (this.phase !== 'flying') return segment.to
    const progress = segment.flyMs > 0 ? this.elapsedMs / segment.flyMs : 1
    return interpTwinPose(segment.from, segment.to, applyRoamEasing(progress))
  }

  private rewind(): void {
    this.index = 0
    this.phase = 'flying'
    this.elapsedMs = 0
  }

  private jump(delta: number): void {
    const count = this.segments.length
    if (count === 0) return
    this.index = (((this.index + delta) % count) + count) % count
    this.phase = 'flying'
    this.elapsedMs = 0
  }

  /** 当前阶段还要多久走完。 */
  private spanMs(): number {
    const segment = this.segments[this.index]
    if (segment === undefined) return 0
    return this.phase === 'flying' ? segment.flyMs : segment.holdMs
  }

  /**
   * 把这一步的时间摊进当前阶段，跨阶段就逐个结算。
   * ⚠ 循环次数必须封顶：时长全配成 0 的轨迹（合法配置）会让「结算一个阶段」
   * 永远推不动时间，没有上限就是一次死循环，页面整个卡死。
   */
  private consume(stepMs: number): void {
    let left = this.elapsedMs + stepMs
    const limit = this.segments.length * 2 + 1
    for (let guard = 0; guard < limit; guard += 1) {
      const span = this.spanMs()
      if (left < span) break
      left -= span
      if (!this.toNextPhase()) {
        left = 0
        break
      }
    }
    this.elapsedMs = left
  }

  /** 结算完当前阶段进下一个；返回 false = 整条轨迹走完了。 */
  private toNextPhase(): boolean {
    if (this.phase === 'flying') {
      this.phase = 'holding'
      return true
    }
    const next = this.index + 1
    if (next < this.segments.length) {
      this.index = next
      this.phase = 'flying'
      return true
    }
    if (this.loop) {
      this.index = 0
      this.phase = 'flying'
      return true
    }
    // 非循环走到尾：停在终点位姿上，不弹回起点——弹回去会让人以为又要开始一圈
    this.phase = 'idle'
    this.running = false
    return false
  }
}
