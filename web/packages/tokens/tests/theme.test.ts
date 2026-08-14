/**
 * @fileoverview 锁住 token 的运行时读取面：变量缺席时回落兜底值，
 * 而不是把空串灌进样式；以及换肤侦测覆盖整条祖先链、取消后不再回调。
 */
import { describe, expect, it, vi } from 'vitest'

import { CONTROL_SIZE_PX, observeThemeChange, readToken } from '../src/theme'

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

/** 造一条 `stage > host` 的挂载链，返回两端与拆链函数。 */
function mountChain(): {
  stage: HTMLElement
  host: HTMLElement
  remove: () => void
} {
  const stage = document.createElement('div')
  const host = document.createElement('div')
  stage.appendChild(host)
  document.body.appendChild(stage)
  return { stage, host, remove: () => stage.remove() }
}

describe('observeThemeChange', () => {
  it('祖先改内联变量时回调', async () => {
    const { stage, host, remove } = mountChain()
    const onChange = vi.fn()
    const stop = observeThemeChange(host, onChange)
    stage.style.setProperty('--accent-primary', 'red')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    stop()
    remove()
  })

  it('文档根换 class 也算换肤', async () => {
    const { host, remove } = mountChain()
    const onChange = vi.fn()
    const stop = observeThemeChange(host, onChange)
    document.documentElement.classList.add('theme-light')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    stop()
    document.documentElement.classList.remove('theme-light')
    remove()
  })

  it('改 host 自己不回调——写变量的是舞台根不是它', async () => {
    const { stage, host, remove } = mountChain()
    const onChange = vi.fn()
    const stop = observeThemeChange(host, onChange)
    host.style.setProperty('--accent-primary', 'red')
    stage.style.setProperty('--accent-primary', 'blue')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled())
    expect(onChange).toHaveBeenCalledTimes(1)
    stop()
    remove()
  })

  // 用「另一个还活着的观察者」当完成信号：它回调了，说明这批变更已经派发完
  it('取消后不再回调', async () => {
    const { stage, host, remove } = mountChain()
    const stopped = vi.fn()
    const alive = vi.fn()
    observeThemeChange(host, stopped)()
    const keep = observeThemeChange(host, alive)

    stage.style.setProperty('--accent-primary', 'red')
    await vi.waitFor(() => expect(alive).toHaveBeenCalled())

    expect(stopped).not.toHaveBeenCalled()
    keep()
    remove()
  })

  it('没有 MutationObserver 的环境返回一个能安全调用的空函数', () => {
    const { host, remove } = mountChain()
    vi.stubGlobal('MutationObserver', undefined)
    const stop = observeThemeChange(host, vi.fn())
    expect(() => stop()).not.toThrow()
    vi.unstubAllGlobals()
    remove()
  })
})
