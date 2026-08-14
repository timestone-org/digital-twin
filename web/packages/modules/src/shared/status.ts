/**
 * @fileoverview 设备状态归一化：把绑定点位的原始值收敛成一档 `DeviceStatus`，
 * 列表族模块共用一份，免得每个模块各自认一套「1 是不是运行」。
 */
import { readEnum } from './config'

/** 设备运行状态；`unknown` 是「没有数据」，不是「状态未知的运行中」。 */
export const DEVICE_STATUSES = [
  'running',
  'standby',
  'alarm',
  'offline',
  'unknown',
] as const
export type DeviceStatus = (typeof DEVICE_STATUSES)[number]

// 数值兜底：声明了 enumMap 的槽早由求值层转成语义字符串，这里只接直连数值那条旁路
const NUMERIC_STATUSES: Record<number, DeviceStatus> = {
  0: 'offline',
  1: 'running',
  2: 'standby',
  3: 'alarm',
}

/**
 * 把点位原始值映射成设备状态。
 * ⚠ 缺值恒为 `unknown`，连 `fallback` 都不给用：把没有数据的设备显示成「运行」
 * 是这套系统里代价最大的一种谎——现场看着一切正常，实际上通道早断了。
 * @param raw 点位读回来的原值
 * @param fallback 认得出类型但不在名单里时的回退
 */
export function toDeviceStatus(
  raw: unknown,
  fallback: DeviceStatus = 'unknown',
): DeviceStatus {
  if (raw == null) return 'unknown'
  if (typeof raw === 'number') return NUMERIC_STATUSES[raw] ?? fallback
  return readEnum(raw, DEVICE_STATUSES, fallback)
}

/** 状态中文标签。 */
export const STATUS_LABEL: Record<DeviceStatus, string> = {
  running: '运行',
  standby: '待机',
  alarm: '报警',
  offline: '离线',
  unknown: '无数据',
}
