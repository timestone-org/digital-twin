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

describe('toDeviceStatus 的现场词表', () => {
  it.each([
    ['run', 'running'],
    ['on', 'running'],
    ['ok', 'running'],
    ['normal', 'running'],
    ['good', 'running'],
    ['1', 'running'],
    ['true', 'running'],
    ['idle', 'standby'],
    ['warning', 'standby'],
    ['warn', 'standby'],
    ['uncertain', 'standby'],
    ['degraded', 'standby'],
    ['2', 'standby'],
    ['alert', 'alarm'],
    ['fault', 'alarm'],
    ['error', 'alarm'],
    ['bad', 'alarm'],
    ['critical', 'alarm'],
    ['3', 'alarm'],
    ['off', 'offline'],
    ['down', 'offline'],
    ['disconnected', 'offline'],
    ['0', 'offline'],
    ['false', 'offline'],
  ] as const)('%s 归 %s', (word, expected) => {
    expect(toDeviceStatus(word)).toBe(expected)
  })

  it('大小写与前后空白都吃得下', () => {
    expect(toDeviceStatus('  RUNNING ')).toBe('running')
    expect(toDeviceStatus('Fault')).toBe('alarm')
  })

  it('告警级的那一组归 standby，与数值 2 同档', () => {
    expect(toDeviceStatus('warning')).toBe(toDeviceStatus(2))
  })

  // ⚠ 位号点吐的是「开关合着」不是「设备在运行」；两者合流会让一个开关量
  // 把整台设备判成运行中
  it('布尔不走词表', () => {
    expect(toDeviceStatus(true)).toBe('unknown')
    expect(toDeviceStatus(false)).toBe('unknown')
    expect(toDeviceStatus(true, 'offline')).toBe('offline')
  })

  it('unknown 不在词表里，但显式传它仍取回自己', () => {
    expect(toDeviceStatus('unknown', 'running')).toBe('unknown')
  })

  it('词表外的字符串照旧走回落', () => {
    expect(toDeviceStatus('bogus', 'offline')).toBe('offline')
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
