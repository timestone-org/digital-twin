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
 * 现场点位真实吐出来的那些词。键一律小写且已去空白，查表前先归一。
 *
 * ⚠ 只对**字符串**生效。布尔 `true` 不许走这张表——它在现场表达的是「这个
 * 开关合着」而不是「这台设备在运行」，把两者合流之后，一个位号点会让整块
 * 设备被判成运行中。
 * ⚠ 「告警级」的那一组（warning / degraded / …）归 `standby` 不归 `alarm`：
 * 数值 2 在本仓早已钉在 `standby`（`NUMERIC_STATUSES`），同一组取值按来源
 * 分裂成两档会让同一台设备在换了绑定方式之后变一种颜色；而把「降级提示」
 * 升格成红色报警，是往墙上多添一次假警。
 */
const STATUS_WORDS: Readonly<Record<string, DeviceStatus>> = {
  running: 'running',
  run: 'running',
  on: 'running',
  ok: 'running',
  normal: 'running',
  good: 'running',
  '1': 'running',
  true: 'running',
  standby: 'standby',
  idle: 'standby',
  warning: 'standby',
  warn: 'standby',
  uncertain: 'standby',
  degraded: 'standby',
  '2': 'standby',
  alarm: 'alarm',
  alert: 'alarm',
  fault: 'alarm',
  error: 'alarm',
  bad: 'alarm',
  critical: 'alarm',
  '3': 'alarm',
  offline: 'offline',
  off: 'offline',
  down: 'offline',
  disconnected: 'offline',
  '0': 'offline',
  false: 'offline',
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
  // ⚠ 查不到要落回 readEnum 而不是直接给 fallback：`unknown` 是唯一一个
  // 不在词表里的档名（它不是现场词，是「没有数据」这个结论），少了这一跳，
  // 显式传 `unknown` 会被当成不认识的词而顶成 fallback
  if (typeof raw === 'string') {
    const word = STATUS_WORDS[raw.trim().toLowerCase()]
    if (word !== undefined) return word
  }
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
