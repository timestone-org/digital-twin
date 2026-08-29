/**
 * @fileoverview 契约：四档的判定与那句话。自报 `ownsStatusDisplay` 的模块共用这一份。
 *
 * ⚠ 合成一档的代价是现场断了的那一格与从没配过的那一格在墙上是同一个「—」，
 * 而这两件事运维要做的动作完全不同（DASHBOARD_DESIGN §4.3）。
 */
import { describe, expect, it } from 'vitest'

import {
  CELL_STATES,
  REASONS,
  cellState,
  reasonOf,
} from '../../src/shared/slotState'

describe('落在哪一档', () => {
  it('下发了结论就照它说的', () => {
    expect(cellState({ state: 'error' }, undefined, true)).toBe('error')
    expect(cellState({ state: 'pending' }, undefined, true)).toBe('pending')
    expect(cellState({ state: 'ok' }, 1, true)).toBe('ok')
  })

  // ⚠ 没接过来源的槽不在表里：缺席即「没配来源」，不是「取不到」
  it('下发了结论但这一槽不在表里，就是没配来源', () => {
    expect(cellState(undefined, 42, true)).toBe('unbound')
  })

  // ⚠ 设计态画布与独立挂载走这里：把注进来的演示值判成没配来源的话，整块是一片「—」
  it('压根没下发结论时退回「有没有值」这一条判据', () => {
    expect(cellState(undefined, 42, false)).toBe('ok')
    expect(cellState(undefined, undefined, false)).toBe('unbound')
  })
})

describe('那句话', () => {
  it('有值时没有话说', () => {
    expect(reasonOf('ok', undefined)).toBe('')
  })

  it('三个没有值的档各有各的话', () => {
    const said = new Set(CELL_STATES.map((state) => reasonOf(state, undefined)))

    expect(said.size).toBe(CELL_STATES.length)
  })

  // ⚠ 只说「取不到」查不动：取数侧给的原因才是能接着往下查的那一句
  it('取数侧给了原因就接在后面', () => {
    expect(reasonOf('error', { state: 'error', message: '通道断了' })).toBe(
      `${REASONS.error}：通道断了`,
    )
  })

  it('没给原因时只说本档那句', () => {
    expect(reasonOf('error', { state: 'error' })).toBe(REASONS.error)
  })
})
