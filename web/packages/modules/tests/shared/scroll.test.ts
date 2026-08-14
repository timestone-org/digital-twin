/**
 * @fileoverview 守自动滚动的公共配置：缺省即开、速度必须为正
 * （0 或负数落到动画时长上是「一帧滚完」，看起来就是整列表在闪）。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_SCROLL_SPEED,
  readScrollSettings,
  scrollConfigFields,
} from '../../src/shared/scroll'

describe('readScrollSettings', () => {
  it('缺省是开着的加缺省速度', () => {
    expect(readScrollSettings()).toEqual({
      autoScroll: true,
      scrollSpeed: DEFAULT_SCROLL_SPEED,
    })
    expect(readScrollSettings({})).toEqual({
      autoScroll: true,
      scrollSpeed: DEFAULT_SCROLL_SPEED,
    })
  })

  it('只有真正的 false 才关', () => {
    expect(readScrollSettings({ autoScroll: false }).autoScroll).toBe(false)
    expect(readScrollSettings({ autoScroll: 0 }).autoScroll).toBe(true)
    expect(readScrollSettings({ autoScroll: 'false' }).autoScroll).toBe(true)
  })

  it('合法速度原样取回', () => {
    expect(readScrollSettings({ scrollSpeed: 8 }).scrollSpeed).toBe(8)
    expect(readScrollSettings({ scrollSpeed: 0.5 }).scrollSpeed).toBe(0.5)
  })

  it('非正与非数的速度都回落', () => {
    expect(readScrollSettings({ scrollSpeed: 0 }).scrollSpeed).toBe(
      DEFAULT_SCROLL_SPEED,
    )
    expect(readScrollSettings({ scrollSpeed: -5 }).scrollSpeed).toBe(
      DEFAULT_SCROLL_SPEED,
    )
    expect(readScrollSettings({ scrollSpeed: '8' }).scrollSpeed).toBe(
      DEFAULT_SCROLL_SPEED,
    )
    expect(
      readScrollSettings({ scrollSpeed: Number.POSITIVE_INFINITY }).scrollSpeed,
    ).toBe(DEFAULT_SCROLL_SPEED)
  })

  it('回落速度可以由模块自己定', () => {
    expect(readScrollSettings({}, 12).scrollSpeed).toBe(12)
    expect(readScrollSettings({ scrollSpeed: -1 }, 12).scrollSpeed).toBe(12)
  })
})

describe('scrollConfigFields', () => {
  it('两个字段，速度依赖开关', () => {
    const fields = scrollConfigFields()

    expect(fields.map((field) => field.key)).toEqual([
      'autoScroll',
      'scrollSpeed',
    ])
    expect(fields[1]?.when).toEqual({ key: 'autoScroll', in: [true] })
    expect(fields[1]?.default).toBe(DEFAULT_SCROLL_SPEED)
  })

  it('缺省速度可改', () => {
    expect(scrollConfigFields(9)[1]?.default).toBe(9)
  })

  it('缺省分段是「滚动」', () => {
    for (const field of scrollConfigFields()) {
      expect(field.group).toBe('滚动')
    }
  })

  it('分段名传空串时字段上根本没有这个键', () => {
    for (const field of scrollConfigFields(3, '')) {
      expect('group' in field).toBe(false)
    }
  })

  it('开关缺省是开着的，与读取侧一致', () => {
    expect(scrollConfigFields()[0]?.default).toBe(true)
  })
})
