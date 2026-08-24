/**
 * @fileoverview 守 3D 取色的契约：hex 直接认、token 到宿主级联里取、
 * 取不出一律 null——不回落成默认色，否则「token 名写错」看起来像「配对了」。
 */
import { afterEach, describe, expect, it } from 'vitest'

import {
  ACCENT_COLOR_TOKEN,
  ColorSpecCache,
  resolveColorSpec,
} from '../src/themeColor'

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

describe('颜色规格的记忆表', () => {
  // ⚠ token 要走 getComputedStyle 读级联，每帧给每个部件解析一次会直接吃掉帧预算
  it('同一个规格只解析一次', () => {
    const host = hostWith('--probe', '#00cefc')
    const cache = new ColorSpecCache(host)

    const first = cache.get('--probe')

    expect(cache.get('--probe')).toBe(first)
  })

  it('解析不出来的规格也记住，不每帧重试一遍', () => {
    const cache = new ColorSpecCache(null)

    expect(cache.get('--missing')).toBeNull()
    expect(cache.get('--missing')).toBeNull()
  })

  it('空串一律 null，不进表', () => {
    expect(new ColorSpecCache(null).get('')).toBeNull()
  })

  // 不清的话，换肤之后只有染过色的部件还是上一套配色
  it('清空之后重新解析，换肤能跟上', () => {
    const host = hostWith('--probe', '#00cefc')
    const cache = new ColorSpecCache(host)
    const before = cache.get('--probe')

    host.style.setProperty('--probe', '#ff0000')
    cache.clear()

    expect(cache.get('--probe')).not.toBe(before)
    expect(cache.get('--probe')?.getHexString()).toBe('ff0000')
  })
})
