/**
 * @fileoverview 守设备状态归一化的诚实口径：缺值恒为「无数据」，
 * ⚠ 连显式传进来的 fallback 都不许把它顶成「运行」——现场看着正常、通道其实已断，
 * 是这套系统里代价最大的一种谎。
 */
import { describe, expect, it } from 'vitest'

import {
  DEVICE_STATUSES,
  STATUS_LABEL,
  toDeviceStatus,
} from '../../src/shared/status'

describe('toDeviceStatus', () => {
  it('缺值恒为 unknown，fallback 也顶不掉', () => {
    expect(toDeviceStatus(null)).toBe('unknown')
    expect(toDeviceStatus(undefined)).toBe('unknown')
    expect(toDeviceStatus(null, 'running')).toBe('unknown')
  })

  it('名单内的字符串原样取回', () => {
    for (const status of DEVICE_STATUSES) {
      expect(toDeviceStatus(status)).toBe(status)
    }
  })

  it('名单外的字符串走回落', () => {
    expect(toDeviceStatus('bogus')).toBe('unknown')
    expect(toDeviceStatus('bogus', 'offline')).toBe('offline')
  })

  it('数值走兜底映射', () => {
    expect(toDeviceStatus(0)).toBe('offline')
    expect(toDeviceStatus(1)).toBe('running')
    expect(toDeviceStatus(2)).toBe('standby')
    expect(toDeviceStatus(3)).toBe('alarm')
  })

  it('映射外的数值走回落', () => {
    expect(toDeviceStatus(4)).toBe('unknown')
    expect(toDeviceStatus(99, 'offline')).toBe('offline')
  })

  it('其它类型走回落', () => {
    expect(toDeviceStatus(true)).toBe('unknown')
    expect(toDeviceStatus({})).toBe('unknown')
    expect(toDeviceStatus([], 'standby')).toBe('standby')
  })
})

describe('STATUS_LABEL', () => {
  it('每一档都有中文标签', () => {
    for (const status of DEVICE_STATUSES) {
      expect(STATUS_LABEL[status]).not.toBe('')
    }
  })

  it('unknown 说的是「无数据」而不是某种运行态', () => {
    expect(STATUS_LABEL.unknown).toBe('无数据')
    expect(STATUS_LABEL.offline).toBe('离线')
  })
})
