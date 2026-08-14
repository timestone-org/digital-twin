/**
 * @fileoverview 守 3D 取色的契约：hex 直接认、token 到宿主级联里取、
 * 取不出一律 null——不回落成默认色，否则「token 名写错」看起来像「配对了」。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { ACCENT_COLOR_TOKEN, resolveColorSpec } from '../src/themeColor'

let hosts: HTMLElement[] = []

function hostWith(token: string, value: string): HTMLElement {
  const element = document.createElement('div')
  element.style.setProperty(token, value)
  document.body.append(element)
  hosts.push(element)
  return element
}

afterEach(() => {
  for (const host of hosts) host.remove()
  hosts = []
})

describe('颜色规格解析', () => {
  it('六位 hex 逐通道解析', () => {
    expect(resolveColorSpec('#3f8aa6', null)?.getHexString()).toBe('3f8aa6')
  })

  it('三位缩写 hex 也认', () => {
    expect(resolveColorSpec('#0f8', null)?.getHexString()).toBe('00ff88')
  })

  it('两端空白不影响解析', () => {
    expect(resolveColorSpec('  #112233  ', null)?.getHexString()).toBe('112233')
  })

  it('token 从宿主的级联里取值', () => {
    const host = hostWith(ACCENT_COLOR_TOKEN, '#00cefc')

    expect(resolveColorSpec(ACCENT_COLOR_TOKEN, host)?.getHexString()).toBe(
      '00cefc',
    )
  })

  it('token 的取值是 rgb() 函数式时同样认', () => {
    const host = hostWith('--probe', 'rgb(0, 128, 255)')

    expect(resolveColorSpec('--probe', host)?.getHexString()).toBe('0080ff')
  })

  it('没有宿主时 token 取不出，返回 null', () => {
    expect(resolveColorSpec(ACCENT_COLOR_TOKEN, null)).toBeNull()
  })

  it('宿主上没定义这个 token 时返回 null', () => {
    const host = hostWith('--probe', '#00cefc')

    expect(resolveColorSpec('--missing', host)).toBeNull()
  })

  it('取值不是颜色时返回 null，不硬塞给 setStyle', () => {
    const host = hostWith('--probe', 'not-a-color')

    expect(resolveColorSpec('--probe', host)).toBeNull()
  })

  it('既不是 hex 也不是 token 的字符串返回 null', () => {
    expect(resolveColorSpec('red', null)).toBeNull()
    expect(resolveColorSpec('', null)).toBeNull()
  })
})
