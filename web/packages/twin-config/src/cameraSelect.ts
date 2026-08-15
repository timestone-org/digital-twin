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
  return cameras.find((item) => item.isDefault) ?? cameras[0] ?? null
}
