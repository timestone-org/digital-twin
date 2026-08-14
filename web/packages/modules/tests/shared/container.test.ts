/**
 * @fileoverview 守容器内容区的几何：缺 `showTitle` 一律按**没有**标题条算。
 * ⚠ 回落成「有标题条」会凭空留出 28px，把容器里所有子节点整体往下顶，
 * 而配置里根本没有这一项——错位只在子节点位置上看得出来，没有任何报错。
 */
import { describe, expect, it } from 'vitest'

import {
  CONTAINER_CONFIG_KEY,
  CONTAINER_PAD_DEFAULT_PX,
  SHOW_TITLE_CONFIG_KEY,
  TITLE_BAR_HEIGHT_PX,
  readContainerLayout,
  resolveContentInset,
} from '../../src/shared/container'

describe('容器内部布局', () => {
  it('内边距原样取回', () => {
    expect(readContainerLayout({ pad: 16 })).toEqual({ pad: 16 })
  })

  it('缺键与脏值都回落到缺省内边距', () => {
    expect(readContainerLayout(undefined)).toEqual({ pad: 8 })
    expect(readContainerLayout({ pad: '16' })).toEqual({ pad: 8 })
    expect(CONTAINER_PAD_DEFAULT_PX).toBe(8)
  })

  it('内边距为 0 时不被当成缺省顶掉', () => {
    expect(readContainerLayout({ pad: 0 })).toEqual({ pad: 0 })
  })
})

describe('内容区内缩', () => {
  it('空配置不留标题条的高度', () => {
    expect(resolveContentInset({})).toEqual({
      top: 8,
      right: 8,
      bottom: 8,
      left: 8,
    })
  })

  it('显式关掉标题条同样不留高度', () => {
    expect(resolveContentInset({ [SHOW_TITLE_CONFIG_KEY]: false }).top).toBe(8)
  })

  it('开了标题条才在顶部加出条的高度', () => {
    expect(resolveContentInset({ [SHOW_TITLE_CONFIG_KEY]: true })).toEqual({
      top: 8 + TITLE_BAR_HEIGHT_PX,
      right: 8,
      bottom: 8,
      left: 8,
    })
  })

  it('四边内缩跟着内边距走', () => {
    expect(
      resolveContentInset({ [CONTAINER_CONFIG_KEY]: { pad: 20 } }),
    ).toEqual({ top: 20, right: 20, bottom: 20, left: 20 })
  })

  it('标题条开关是字符串时按没开算', () => {
    expect(resolveContentInset({ [SHOW_TITLE_CONFIG_KEY]: 'true' }).top).toBe(8)
  })
})
