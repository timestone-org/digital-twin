/**
 * @fileoverview 契约：取色控件的主题令牌色板——8 枚令牌名必须真实存在于
 * `@dt/tokens` 的 `TOKEN_CSS_VAR`（写错不报错、渲染成透明），点色板落库的是
 * `--token` 本身而不是解析色，换肤才跟得上。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ConfigField } from '@dt/contracts'
import { __resetConfigControls } from '@dt/modules'
import { TOKEN_CSS_VAR } from '@dt/tokens'

import { installConfigControls } from '@/features/dashboard/configControls'
import ColorControl from '@/features/dashboard/controls/ColorControl.vue'

const FIELD: ConfigField = { key: 'accent', label: '强调色', type: 'color' }

function mountColor(value: unknown = '', disabled = false) {
  return mount(ColorControl, { props: { field: FIELD, value, disabled } })
}

/** 板上每一格的令牌名（色板格的无障碍名就是令牌本身）。 */
function swatchNames(wrapper: ReturnType<typeof mountColor>): string[] {
  return wrapper
    .findAll('.dt-color__preset')
    .map((button) => button.attributes('aria-label') ?? '')
}

beforeEach(() => {
  __resetConfigControls()
  installConfigControls()
})

describe('主题令牌色板', () => {
  it('恰好 8 枚，且每一枚都真实存在于 TOKEN_CSS_VAR', () => {
    const swatches = swatchNames(mountColor())
    const known = new Set(Object.values(TOKEN_CSS_VAR))

    expect(swatches).toHaveLength(8)
    const stray = swatches.filter((name) => !known.has(name))
    expect(
      stray,
      `色板写了 TOKEN_CSS_VAR 之外的名字：${stray.join(', ')}`,
    ).toEqual([])
  })

  // 不抄字面量清单：只钉「每一枚都查得到、三个族都有代表」，令牌换名时随真源走
  it('主辅色、状态色与文字色三族都有代表', () => {
    const swatches = swatchNames(mountColor())

    for (const prefix of ['--accent-', '--state-', '--text-']) {
      expect(
        swatches.some((name) => name.startsWith(prefix)),
        `色板缺 ${prefix} 族`,
      ).toBe(true)
    }
  })

  it('点色板落库令牌本身而不是解析色，且按连续输入抛出', async () => {
    const wrapper = mountColor('#101010')

    await wrapper.find('button[aria-label="--accent-primary"]').trigger('click')

    expect(wrapper.emitted('update')).toEqual([['--accent-primary', true]])
  })

  it('当前值就是某枚令牌时那一格按已按下标出', () => {
    const pressed = mountColor('--state-danger')
      .findAll('button[aria-pressed="true"]')
      .map((button) => button.attributes('aria-label'))

    expect(pressed).toEqual(['--state-danger'])
  })

  it('禁用时点色板一笔都不抛', async () => {
    const wrapper = mountColor('', true)

    await wrapper.find('button[aria-label="--state-info"]').trigger('click')

    expect(wrapper.emitted('update')).toBeUndefined()
  })
})
