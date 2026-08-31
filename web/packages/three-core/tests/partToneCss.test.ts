/**
 * @fileoverview 契约：装配栏连接轨的取色——没配染色给空串、档位命中给那一档的色、
 * 渐变留给 CSS 混。
 *
 * ⚠ 「没配染色」必须与「命中了正常档」分得开：给一个正常绿等于替一个从来没取过数
 * 的部件宣布它一切正常。
 */
import { normalizeTwinConfig, type TwinPart } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { partToneCss } from '../src/partToneCss'

function partOf(over: Record<string, unknown>): TwinPart {
  const part = normalizeTwinConfig({ parts: [{ id: 'p1', ...over }] }).parts[0]
  if (part === undefined) throw new Error('造不出部件')
  return part
}

const STOPS = {
  mode: 'stops',
  stops: [
    { match: 'range', from: 0, to: 60, color: '--state-success' },
    { match: 'range', from: 60, to: 200, color: '#ff4d4f' },
  ],
  fallback: '--state-offline',
}

describe('连接轨取色', () => {
  it('没配状态染色给空串，由调用方退回发丝色', () => {
    expect(partToneCss(partOf({}), { p1: { value: 42 } })).toBe('')
  })

  it('token 包一层 var()，hex 原样给', () => {
    const part = partOf({ tint: STOPS })

    expect(partToneCss(part, { p1: { value: 30 } })).toBe(
      'var(--state-success)',
    )
    expect(partToneCss(part, { p1: { value: 90 } })).toBe('#ff4d4f')
  })

  // 点位掉线时留在最后一次命中的颜色上，屏幕上没有任何迹象说明它已经陈旧
  it('取不到数时走回落色', () => {
    expect(partToneCss(partOf({ tint: STOPS }), {})).toBe(
      'var(--state-offline)',
    )
  })

  it('一档都没命中也走回落色', () => {
    expect(partToneCss(partOf({ tint: STOPS }), { p1: { value: 900 } })).toBe(
      'var(--state-offline)',
    )
  })

  // ⚠ 两端都可能是 token，token 的取值只有在有 CSS 级联的宿主里才解析得出来
  it('渐变档交给 CSS 混，不在这里算 hex', () => {
    const part = partOf({
      tint: {
        mode: 'gradient',
        gradient: {
          min: 0,
          max: 100,
          from: '--state-success',
          to: '--state-danger',
        },
      },
    })

    expect(partToneCss(part, { p1: { value: 25 } })).toBe(
      'color-mix(in srgb, var(--state-danger) 25%, var(--state-success))',
    )
  })
})
