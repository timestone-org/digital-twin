/**
 * @fileoverview 颜色解析的取值口径。
 * ⚠ 解析不出 hex 时原生取色器只能拿回落色开场，用户一点就把 token 静默改写成
 * 那个回落色——所以「哪些写法解析得出」这条边界必须逐个钉住。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  expandHex,
  resolveColorToHex,
  rgbToHex,
  toCssColor,
} from '../../../src/components/DtColorInput/color'

function hostWith(vars: Record<string, string>): HTMLElement {
  const host = document.createElement('div')
  for (const [name, value] of Object.entries(vars)) {
    host.style.setProperty(name, value)
  }
  document.body.appendChild(host)
  return host
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('expandHex', () => {
  it.each([
    ['#abc', '#aabbcc'],
    ['#ABC', '#aabbcc'],
    ['#00cefc', '#00cefc'],
    ['#00CEFC', '#00cefc'],
    ['  #fff  ', '#ffffff'],
  ])('把 %j 规范成 %j', (raw, expected) => {
    expect(expandHex(raw)).toBe(expected)
  })

  it.each(['', 'abc', '#ab', '#abcd', '#abcde', '#gggggg', 'rgb(1,2,3)'])(
    '%j 不是 hex',
    (raw) => {
      expect(expandHex(raw)).toBeNull()
    },
  )
})

describe('rgbToHex', () => {
  it('逗号分隔的 rgb() 解析得出', () => {
    expect(rgbToHex('rgb(0, 206, 252)')).toBe('#00cefc')
  })

  it('⚠ 空格分隔的现代写法也要认：getComputedStyle 两种都会给', () => {
    expect(rgbToHex('rgb(0 206 252)')).toBe('#00cefc')
  })

  it('rgba() 的透明度丢弃，取色器无从表达它', () => {
    expect(rgbToHex('rgba(255, 0, 0, 0.5)')).toBe('#ff0000')
  })

  it('单通道值补足两位', () => {
    expect(rgbToHex('rgb(1, 2, 3)')).toBe('#010203')
  })

  it('小数通道四舍五入', () => {
    expect(rgbToHex('rgb(0.6, 1.4, 2.5)')).toBe('#010103')
  })

  it('越界通道夹回 0–255', () => {
    expect(rgbToHex('rgb(-20, 300, 128)')).toBe('#00ff80')
  })

  it.each(['', '#00cefc', 'rgb(1,2)', 'rgb(., ., .)'])(
    '%j 解析不出 rgb',
    (raw) => {
      expect(rgbToHex(raw)).toBeNull()
    },
  )
})

describe('toCssColor', () => {
  it('裸 token 补成 var()', () => {
    expect(toCssColor('--accent-primary')).toBe('var(--accent-primary)')
  })

  it.each(['var(--accent-primary)', '#00cefc', 'red'])(
    '%j 原样交给浏览器',
    (raw) => {
      expect(toCssColor(raw)).toBe(raw)
    },
  )

  it.each([undefined, null, '', '   '])('%j 渲染成透明', (raw) => {
    expect(toCssColor(raw)).toBe('transparent')
  })
})

describe('resolveColorToHex', () => {
  it('hex 直接过', () => {
    expect(resolveColorToHex('#abc', null)).toBe('#aabbcc')
  })

  it('rgb() 直接过', () => {
    expect(resolveColorToHex('rgb(0,206,252)', null)).toBe('#00cefc')
  })

  it('空串解析不出', () => {
    expect(resolveColorToHex('  ', null)).toBeNull()
  })

  it('没有宿主时 token 解析不出，不猜一个色', () => {
    expect(resolveColorToHex('--accent-primary', null)).toBeNull()
  })

  it('裸 token 从宿主的级联里取值', () => {
    const host = hostWith({ '--brand': '#00cefc' })
    expect(resolveColorToHex('--brand', host)).toBe('#00cefc')
  })

  it('var() 写法与裸 token 等价', () => {
    const host = hostWith({ '--brand': '#00cefc' })
    expect(resolveColorToHex('var(--brand)', host)).toBe('#00cefc')
  })

  it('token 指向另一个 token 时逐跳解析', () => {
    const host = hostWith({ '--brand': 'var(--seed)', '--seed': '#abc' })
    expect(resolveColorToHex('--brand', host)).toBe('#aabbcc')
  })

  it('未定义的 token 解析不出', () => {
    expect(resolveColorToHex('--nope', hostWith({}))).toBeNull()
  })

  it('⚠ token 原样自引用时有跳数上限，不会把调用方挂死', () => {
    // 不能真在 DOM 上摆一个 `--loop: var(--loop)`：happy-dom 读它时自己就死循环在
    // getPropertyValue 里，整个用例文件会静默挂住、连一行输出都没有。
    // 这里用 spy 直接模拟「原样把 var() 还回来」的宿主，只量本模块的跳数上限。
    const declaration = window.getComputedStyle(document.createElement('div'))
    vi.spyOn(declaration, 'getPropertyValue').mockReturnValue('var(--loop)')
    vi.spyOn(window, 'getComputedStyle').mockReturnValue(declaration)
    expect(
      resolveColorToHex('--loop', document.createElement('div')),
    ).toBeNull()
  })

  it('颜色名交给探针去算，算不出也不把探针留在 DOM 里', () => {
    const host = hostWith({})
    const before = host.childNodes.length
    resolveColorToHex('rebeccapurple', host)
    expect(host.childNodes.length).toBe(before)
  })
})
