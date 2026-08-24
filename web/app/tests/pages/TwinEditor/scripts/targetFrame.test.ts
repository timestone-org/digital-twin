/**
 * @fileoverview 契约：编辑视口与画中画都按大屏格子的宽高比留边。
 *
 * ⚠ 比例框必须两条边同时夹住——只夹一条时 flex 会把另一条压回去，
 * 比例被悄悄改掉且不报任何错，而「留边」这件事看着是做了的。
 */
import { describe, expect, it } from 'vitest'

import {
  isUsableTargetSize,
  previewBoxOf,
  targetFrameVars,
} from '@/pages/TwinEditor/scripts/targetFrame'

describe('isUsableTargetSize', () => {
  it('两条边都为正才算数', () => {
    expect(isUsableTargetSize({ width: 1280, height: 720 })).toBe(true)
  })

  it.each([
    ['没给', undefined],
    ['宽是 0', { width: 0, height: 720 }],
    ['高是负数', { width: 1280, height: -1 }],
  ])('%s 时当没给', (_name, size) => {
    expect(isUsableTargetSize(size)).toBe(false)
  })
})

describe('targetFrameVars', () => {
  it('把宽高原样交给样式表', () => {
    expect(targetFrameVars({ width: 1280, height: 720 })).toEqual({
      '--twin-frame-w': '1280',
      '--twin-frame-h': '720',
    })
  })

  it('尺寸不合法就不锁比例，交给样式表铺满', () => {
    expect(targetFrameVars({ width: 0, height: 600 })).toBeUndefined()
    expect(targetFrameVars(undefined)).toBeUndefined()
  })
})

const LIMIT = { width: 320, height: 220 }

describe('previewBoxOf', () => {
  it('按更紧的那条边缩，比例不变', () => {
    expect(previewBoxOf({ width: 1280, height: 720 }, LIMIT)).toEqual({
      width: 320,
      height: 180,
      scale: 0.25,
    })
  })

  it('竖长的格子按高度缩，不是按宽度', () => {
    expect(previewBoxOf({ width: 400, height: 800 }, LIMIT)).toEqual({
      width: 110,
      height: 220,
      scale: 0.275,
    })
  })

  // ⚠ 守的是比例而不是「绝不放大」：小格子按 1:1 摆在角落里根本看不清
  it('格子比上限框还小就放大', () => {
    expect(previewBoxOf({ width: 160, height: 110 }, LIMIT)).toEqual({
      width: 320,
      height: 220,
      scale: 2,
    })
  })
})
