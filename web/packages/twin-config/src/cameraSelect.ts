/**
 * @fileoverview 从视点清单里挑机位。纯选择逻辑，与归一化分开放——
 * 归一化只负责把外来 JSON 修成合法形状，挑哪个机位是运行态的决策。
 */
import type { TwinCamera } from './types'

/**
 * 打开大屏时用的机位；一个都没标默认就用文档序第一个，一个视点都没有给 null。
 * ⚠ 多个都标了只认第一个：让「最后一个赢」会让人在列表里改顺序时莫名换镜头。
 * @param cameras 归一化后的视点
 */
export function defaultCameraOf(
  cameras: readonly TwinCamera[],
): TwinCamera | null {
  const picked = cameras.find((item) => item.isDefault) ?? cameras[0] ?? null
  return picked !== null && isUsablePose(picked) ? picked : null
}

/**
 * 这个视点站得住吗——机位与注视点必须分得开。
 *
 * ⚠ 两者重合时相机在看自己：`lookAt` 的方向向量是零向量，姿态解不出来，
 * 画面要么全黑要么乱转，而配置本身完全合法（一个刚新建、还没「取当前机位」
 * 的视点，两个坐标就都是原点）。这时候该退回自动取景，而不是飞过去。
 * @param camera 归一化后的视点
 */
export function isUsablePose(camera: TwinCamera): boolean {
  const [px, py, pz] = camera.position
  const [tx, ty, tz] = camera.target
  return Math.hypot(px - tx, py - ty, pz - tz) > MIN_POSE_SPAN
}

/** 机位与注视点至少要差这么远才算两个点。 */
const MIN_POSE_SPAN = 1e-6
