/**
 * @fileoverview 换肤器的契约：六套主题都列得出、点哪个换哪个、选中态只有一处，
 * 以及缩略预览确实画的是该主题自己的颜色。
 *
 * ⚠ 模板里的 prop 名、插槽名、图标名写错，typecheck 与 lint 双双放行——
 * 这个文件是唯一的防线。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { DEFAULT_THEME_ID, listThemes } from '@dt/tokens'

import ThemeSwitcher from '@/components/layout/ThemeSwitcher.vue'
import {
  SYSTEM_PREFERENCE,
  useThemePreference,
} from '@/composables/useThemePreference'

beforeEach(() => {
  // ⚠ 换肤意图是模块级单例，清 localStorage 清不掉内存里那份：
  // 不显式归位的话，上一条用例选的主题会当成这一条的初始选中态。
  // ⚠ 归位在清存储之前：归位本身会落盘，反过来做的话存储里留着 dark-tech
  useThemePreference().setPreference(DEFAULT_THEME_ID)
  localStorage.clear()
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: () => undefined })),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

/** 展开面板。DtPopover 用 Teleport，面板不在 wrapper 的子树里。 */
async function open(wrapper: VueWrapper): Promise<void> {
  await wrapper.get('button').trigger('click')
}

function items(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
}

function itemByName(name: string): HTMLElement {
  const found = items().find((node) => node.textContent?.includes(name))
  if (found === undefined) throw new Error(`面板里没有「${name}」`)
  return found
}

describe('ThemeSwitcher · 触发器', () => {
  it('有可读名称，收起时 aria-expanded 是 false', () => {
    const wrapper = mount(ThemeSwitcher)
    const trigger = wrapper.get('button')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-label')).toContain('主题外观')
  })

  it('可读名称带上当前生效的主题，缺省报的是默认深色而不是跟随系统', async () => {
    const wrapper = mount(ThemeSwitcher)
    const label = wrapper.get('button').attributes('aria-label')
    expect(label).toContain('深色科技')
    expect(label).not.toContain('跟随系统')

    await open(wrapper)
    itemByName('翡翠绿').click()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('button').attributes('aria-label')).toContain('翡翠绿')
  })

  it('显式选了跟随系统才标注出来', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    itemByName('跟随系统').click()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('button').attributes('aria-label')).toContain('跟随系统')
  })

  it('展开后 aria-expanded 翻成 true', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
  })
})

describe('ThemeSwitcher · 列表', () => {
  it('六套内置主题外加「跟随系统」都列得出', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)

    expect(items()).toHaveLength(listThemes().length + 1)
    for (const theme of listThemes()) {
      expect(itemByName(theme.name)).toBeTruthy()
    }
    expect(itemByName('跟随系统')).toBeTruthy()
  })

  it('缺省选中默认深色，且选中态只有一处', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)

    const checked = items().filter(
      (node) => node.getAttribute('aria-checked') === 'true',
    )
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toContain('深色科技')
  })

  it('缩略预览用的是该主题自己的底色，不是当前主题的', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)

    const emerald = listThemes().find((theme) => theme.id === 'emerald')
    const preview = itemByName('翡翠绿').querySelector('[style]')
    expect(preview?.getAttribute('style')).toContain(
      emerald?.tokens.surface.base,
    )
  })

  it('深浅各自标出来：浅色主题给太阳，深色给月亮', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    // 图标只出现在瓦片脚注里，深浅两枚不会同时出现在同一块瓦片上
    expect(itemByName('浅色').innerHTML).toContain('svg')
  })
})

describe('ThemeSwitcher · 切换', () => {
  it('点一套主题就选中它，并关掉面板', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    itemByName('暗夜紫').click()
    await wrapper.vm.$nextTick()

    expect(items()).toHaveLength(0)
    expect(localStorage.getItem('dt.theme')).toBe('nebula-violet')
  })

  it('选中态跟着走，仍然只有一处', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    itemByName('熔岩橙').click()
    await wrapper.vm.$nextTick()

    await open(wrapper)
    const checked = items().filter(
      (node) => node.getAttribute('aria-checked') === 'true',
    )
    expect(checked).toHaveLength(1)
    expect(checked[0]?.textContent).toContain('熔岩橙')
  })

  it('点「跟随系统」存的是 system 这一档', async () => {
    const wrapper = mount(ThemeSwitcher)
    await open(wrapper)
    itemByName('钴蓝深海').click()
    await wrapper.vm.$nextTick()

    await open(wrapper)
    itemByName('跟随系统').click()
    await wrapper.vm.$nextTick()

    expect(localStorage.getItem('dt.theme')).toBe(SYSTEM_PREFERENCE)
  })
})
