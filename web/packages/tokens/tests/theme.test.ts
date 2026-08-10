/**
 * @fileoverview 锁住 token 的运行时读取面：变量缺席时回落兜底值，
 * 而不是把空串灌进样式。
 */
import { describe, expect, it } from 'vitest'

import { CONTROL_SIZE_PX, readToken } from '../src/theme'

describe('CONTROL_SIZE_PX', () => {
  it('三档与 tokens.scss 的 --ctl-h-* 同值', () => {
    expect(CONTROL_SIZE_PX).toEqual({ sm: 32, md: 40, lg: 48 })
  })
})

describe('readToken', () => {
  it('变量缺席时返回兜底值', () => {
    expect(readToken('--nope', 'fallback')).toBe('fallback')
  })

  it('读得到时返回计算值', () => {
    document.documentElement.style.setProperty('--probe', '#fff')
    expect(readToken('--probe', 'fallback')).toBe('#fff')
    document.documentElement.style.removeProperty('--probe')
  })

  it('可以指定宿主元素读级联', () => {
    const host = document.createElement('div')
    host.style.setProperty('--probe', 'red')
    document.body.appendChild(host)
    expect(readToken('--probe', 'fallback', host)).toBe('red')
    host.remove()
  })
})
