/**
 * @fileoverview 锁住主题注入引擎的三条铁律：默认深色注入后元素上零残留、
 * 切主题时上一套的 extraVars 被清干净、`-rgb` 伴生变量与 color-scheme 跟着走。
 */
import { describe, expect, it } from 'vitest'

import {
  applyTheme,
  DEFAULT_THEME_ID,
  getTheme,
  hexToRgbTriplet,
  listThemes,
  TOKEN_CSS_VAR,
} from '../src/themeEngine'

const THEME_VARS = Object.values(TOKEN_CSS_VAR)
const EXTRA_VARS = ['--neutral-fg-rgb', '--card-corner-display']

function host(): HTMLElement {
  return document.createElement('div')
}

/** 元素上所有主题相关内联变量的当前取值（含 `-rgb` 伴生与 extraVars）。 */
function injected(el: HTMLElement): Record<string, string> {
  const names = [
    ...THEME_VARS,
    ...THEME_VARS.map((name) => `${name}-rgb`),
    ...EXTRA_VARS,
  ]
  const found: Record<string, string> = {}
  for (const name of names) {
    const value = el.style.getPropertyValue(name)
    if (value !== '') found[name] = value
  }
  return found
}

describe('默认深色的注入结果', () => {
  it.each([DEFAULT_THEME_ID, null, 'no-such-theme'])(
    'applyTheme(el, %s) 后元素上不留任何主题变量',
    (id) => {
      const el = host()
      applyTheme(el, id)
      expect(injected(el)).toEqual({})
    },
  )

  it('从彩色主题切回默认深色时逐项清空', () => {
    const el = host()
    applyTheme(el, 'emerald')
    expect(Object.keys(injected(el)).length).toBeGreaterThan(0)

    applyTheme(el, DEFAULT_THEME_ID)
    expect(injected(el)).toEqual({})
  })

  it('外部预置的伴生变量也被清掉', () => {
    const el = host()
    el.style.setProperty('--accent-primary-rgb', '1, 2, 3')
    applyTheme(el, DEFAULT_THEME_ID)
    expect(el.style.getPropertyValue('--accent-primary-rgb')).toBe('')
  })
})

describe('extraVars 的幂等', () => {
  it('切到没有该键的主题时上一套的 extraVars 被清掉', () => {
    const el = host()
    applyTheme(el, 'light')
    expect(el.style.getPropertyValue('--card-corner-display')).toBe('none')

    applyTheme(el, 'emerald')
    expect(el.style.getPropertyValue('--card-corner-display')).toBe('')
    expect(el.style.getPropertyValue('--neutral-fg-rgb')).toBe('234, 255, 247')
  })

  it('切到默认深色时 extraVars 全部回落', () => {
    const el = host()
    applyTheme(el, 'light')
    applyTheme(el, DEFAULT_THEME_ID)
    expect(el.style.getPropertyValue('--neutral-fg-rgb')).toBe('')
    expect(el.style.getPropertyValue('--card-corner-display')).toBe('')
  })

  it('重复注入同一套主题结果不变', () => {
    const el = host()
    applyTheme(el, 'lava-amber')
    const once = injected(el)
    applyTheme(el, 'lava-amber')
    expect(injected(el)).toEqual(once)
  })

  it('绕一圈切回同一套主题结果不变', () => {
    const el = host()
    applyTheme(el, 'cobalt-deep')
    const before = injected(el)
    applyTheme(el, 'light')
    applyTheme(el, 'cobalt-deep')
    expect(injected(el)).toEqual(before)
  })
})

describe('`-rgb` 伴生变量', () => {
  it('hex 取值同步写出三元组', () => {
    const el = host()
    applyTheme(el, 'emerald')
    expect(el.style.getPropertyValue('--accent-primary-rgb')).toBe(
      '46, 230, 166',
    )
    expect(el.style.getPropertyValue('--state-danger-rgb')).toBe('255, 95, 107')
  })

  it('rgba 取值把伴生三元组移除', () => {
    const el = host()
    el.style.setProperty('--border-default-rgb', '1, 2, 3')
    applyTheme(el, 'emerald')
    expect(el.style.getPropertyValue('--border-default')).toBe(
      'rgba(46, 230, 166, 0.2)',
    )
    expect(el.style.getPropertyValue('--border-default-rgb')).toBe('')
  })

  it('阴影这类非颜色取值不产生伴生变量', () => {
    const el = host()
    applyTheme(el, 'light')
    expect(el.style.getPropertyValue('--fx-shadow-menu-rgb')).toBe('')
  })
})

describe('color-scheme 跟着 mode 走', () => {
  it('浅色主题写 light', () => {
    const el = host()
    applyTheme(el, 'light')
    expect(el.style.colorScheme).toBe('light')
  })

  it('切回深色主题写 dark', () => {
    const el = host()
    applyTheme(el, 'light')
    applyTheme(el, 'nebula-violet')
    expect(el.style.colorScheme).toBe('dark')
  })

  it('默认深色也显式写 dark', () => {
    const el = host()
    applyTheme(el, DEFAULT_THEME_ID)
    expect(el.style.colorScheme).toBe('dark')
  })
})

describe('hexToRgbTriplet', () => {
  it.each([
    ['#00cefc', '0, 206, 252'],
    ['#FFFFFF', '255, 255, 255'],
    ['#fff', '255, 255, 255'],
    ['#0a1', '0, 170, 17'],
    ['  #010d1e  ', '1, 13, 30'],
  ])('%s → %s', (input, expected) => {
    expect(hexToRgbTriplet(input)).toBe(expected)
  })

  it.each([
    'rgba(0, 0, 0, 0.5)',
    'red',
    '#12345',
    '#',
    '',
    '0 12px 32px rgba(0, 0, 0, 0.45)',
  ])('非 hex 的 %s 返回 null', (input) => {
    expect(hexToRgbTriplet(input)).toBeNull()
  })
})

describe('主题注册表', () => {
  it('内置 6 套且 id 互不重复', () => {
    const themes = listThemes()
    expect(themes).toHaveLength(6)
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(6)
  })

  it('下拉顺序以默认深色打头', () => {
    expect(listThemes().map((theme) => theme.id)).toEqual([
      'dark-tech',
      'light',
      'nebula-violet',
      'emerald',
      'lava-amber',
      'cobalt-deep',
    ])
  })

  it('DEFAULT_THEME_ID 指向唯一一套 isRootDefault 的深色主题', () => {
    const fallback = getTheme(DEFAULT_THEME_ID)
    expect(fallback.id).toBe(DEFAULT_THEME_ID)
    expect(fallback.mode).toBe('dark')
    expect(listThemes().filter((theme) => theme.isRootDefault)).toEqual([
      fallback,
    ])
  })

  it.each([null, undefined, '', 'no-such-theme'])(
    'getTheme(%s) 回退默认深色',
    (id) => {
      expect(getTheme(id).id).toBe(DEFAULT_THEME_ID)
    },
  )

  it('已知 id 取到对应主题', () => {
    expect(getTheme('light').mode).toBe('light')
    expect(getTheme('lava-amber').name).toBe('熔岩橙')
  })
})
