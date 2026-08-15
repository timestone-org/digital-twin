/**
 * @fileoverview 契约：两侧栏能拖到多宽。
 * ⚠ 只卡「容器的一半」是不够的——两侧各拖到一半，画布就正好归零，
 * 而那时候整个编辑器还看着一切正常，只是中间什么都没有了。
 */
import { describe, expect, it } from 'vitest'

import {
  CANVAS_MIN_PX,
  PANE_DEFAULTS,
  PANE_MIN_PX,
  SPLITTER_PX,
  clampPane,
  paneLimits,
  readPaneWidths,
  writePaneWidths,
} from '@/pages/DashboardEditor/paneWidths'

describe('取值域', () => {
  it('宽敞时上限就是容器的一半', () => {
    expect(paneLimits(2000, PANE_DEFAULTS.right).max).toBe(1000)
  })

  it('另一侧越宽，这一侧的上限越小——画布的下限不许被吃掉', () => {
    const total = 1200
    const other = 500
    const limits = paneLimits(total, other)

    expect(limits.max).toBe(total - other - CANVAS_MIN_PX - SPLITTER_PX * 2)
    expect(limits.max).toBeLessThan(Math.floor(total / 2))
  })

  it('两侧都拖到上限后，画布仍留得下最小宽度', () => {
    const total = 1400
    const left = paneLimits(total, PANE_MIN_PX).max
    const right = paneLimits(total, left).max

    expect(total - left - right - SPLITTER_PX * 2).toBeGreaterThanOrEqual(
      CANVAS_MIN_PX,
    )
  })

  // ⚠ 上限算出来比下限还小的时候，不兜底的话 clamp 会把宽度往更窄里带
  it('窗口窄到摆不开时，上限退回下限而不是负数', () => {
    const limits = paneLimits(320, PANE_MIN_PX)

    expect(limits.max).toBe(PANE_MIN_PX)
    expect(clampPane(400, limits)).toBe(PANE_MIN_PX)
  })
})

describe('收进取值域', () => {
  it('两端各自夹住，中间原样取整', () => {
    const limits = { min: 200, max: 600 }

    expect(clampPane(120, limits)).toBe(200)
    expect(clampPane(900, limits)).toBe(600)
    expect(clampPane(333.4, limits)).toBe(333)
  })

  it('脏值回下限，不产出 NaN 宽度', () => {
    expect(clampPane(Number.NaN, { min: 200, max: 600 })).toBe(200)
  })
})

describe('本地存档', () => {
  it('没存过给出厂值', () => {
    localStorage.clear()

    expect(readPaneWidths()).toEqual(PANE_DEFAULTS)
  })

  it('存过就读回来', () => {
    writePaneWidths({ left: 260, right: 420 })

    expect(readPaneWidths()).toEqual({ left: 260, right: 420 })
  })

  it('存档坏了按没存过处理，不把编辑器带崩', () => {
    localStorage.setItem('dt.editor.panes', '{ 不是 JSON')

    expect(readPaneWidths()).toEqual(PANE_DEFAULTS)
  })

  it('缺键或值不合法的那一侧单独回出厂值', () => {
    localStorage.setItem('dt.editor.panes', '{"left":-5}')

    expect(readPaneWidths()).toEqual(PANE_DEFAULTS)
  })
})
