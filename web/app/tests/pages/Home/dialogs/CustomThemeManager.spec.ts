/**
 * @fileoverview 契约：自定义主题的增删改各自抛对事件，新建/编辑表单能打开并按
 * 已有主题回填，落库载荷只带登记过的那几色（不把整套 token 焊死进主题）。
 *
 * ⚠ 直接挂子组件测：套在弹窗里、且 `Teleport` 打了桩时，父组件每次重渲染都会
 * 重建它，编辑态因此会丢——那是桩的行为，不是这个组件的契约。
 */
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { DEFAULT_THEME_ID, getTheme } from '@dt/tokens'
import type { ProjectThemePayload } from '@dt/contracts'

import CustomThemeManager from '@/pages/Home/components/CustomThemeManager.vue'

const DEFAULTS = getTheme(DEFAULT_THEME_ID).tokens

const THEME: ProjectThemePayload = {
  id: 'c1',
  name: '园区蓝',
  mode: 'dark',
  tokens: { accent: { primary: '#00aaff' } },
}

function mountManager(themes: ProjectThemePayload[] = [THEME]) {
  return mount(CustomThemeManager, { props: { themes, busy: false } })
}

async function clickText(
  wrapper: ReturnType<typeof mountManager>,
  label: string,
): Promise<void> {
  const hit = wrapper
    .findAll('button')
    .find((button) => button.text().includes(label))
  expect(hit, `没有文案含「${label}」的按钮`).toBeDefined()
  await hit?.trigger('click')
}

describe('列表', () => {
  it('列出已有主题的名字与明暗档', () => {
    const wrapper = mountManager()

    expect(wrapper.text()).toContain('园区蓝')
    expect(wrapper.text()).toContain('dark')
  })

  it('一套都没有时给一句话，而不是留一片空白', () => {
    expect(mountManager([]).text()).toContain('还没有自定义主题')
  })

  it('点删除把整条主题抛出去，由上层去问「这几张屏会换回默认配色」', async () => {
    const wrapper = mountManager()

    await wrapper.find('[aria-label="删除主题"]').trigger('click')

    expect(wrapper.emitted('delete')).toEqual([[THEME]])
  })
})

describe('新建', () => {
  it('点新建主题会把表单打开', async () => {
    const wrapper = mountManager([])

    await clickText(wrapper, '新建主题')

    expect(wrapper.find('input[placeholder="主题名称"]').exists()).toBe(true)
    expect(wrapper.findAll('input[type="color"]')).toHaveLength(7)
  })

  it('名字空着时创建键点不动', async () => {
    const wrapper = mountManager([])
    await clickText(wrapper, '新建主题')

    await clickText(wrapper, '创建')

    expect(wrapper.emitted('create')).toBeUndefined()
  })

  it('创建时抛 create，载荷只带登记过的那几色', async () => {
    const wrapper = mountManager([])
    await clickText(wrapper, '新建主题')
    await wrapper.find('input[placeholder="主题名称"]').setValue('  新配色  ')

    await clickText(wrapper, '创建')

    expect(wrapper.emitted('create')?.[0]?.[0]).toEqual({
      name: '新配色',
      mode: 'dark',
      tokens: {
        accent: {
          primary: DEFAULTS.accent.primary,
          secondary: DEFAULTS.accent.secondary,
        },
        surface: { base: DEFAULTS.surface.base },
        text: { primary: DEFAULTS.text.primary },
        state: {
          success: DEFAULTS.state.success,
          warning: DEFAULTS.state.warning,
          danger: DEFAULTS.state.danger,
        },
      },
    })
  })

  it('点取消收起表单，不抛 create', async () => {
    const wrapper = mountManager([])
    await clickText(wrapper, '新建主题')

    await clickText(wrapper, '取消')

    expect(wrapper.find('input[placeholder="主题名称"]').exists()).toBe(false)
    expect(wrapper.emitted('create')).toBeUndefined()
  })
})

describe('编辑', () => {
  it('点编辑按已有主题回填名字与主色', async () => {
    const wrapper = mountManager()

    await wrapper.find('[aria-label="编辑主题"]').trigger('click')

    expect(
      wrapper.find<HTMLInputElement>('input[placeholder="主题名称"]').element
        .value,
    ).toBe('园区蓝')
    expect(
      wrapper.find<HTMLInputElement>('input[type="color"]').element.value,
    ).toBe('#00aaff')
  })

  it('保存时抛 update，第一个参数是主题 id', async () => {
    const wrapper = mountManager()
    await wrapper.find('[aria-label="编辑主题"]').trigger('click')

    await clickText(wrapper, '保存')

    const emitted = wrapper.emitted('update')?.[0]
    expect(emitted?.[0]).toBe('c1')
    expect(emitted?.[1]).toMatchObject({
      name: '园区蓝',
      mode: 'dark',
      tokens: { accent: { primary: '#00aaff' } },
    })
  })

  it('库里没覆盖过的项按内置默认色落库，而不是写空串', async () => {
    const wrapper = mountManager()
    await wrapper.find('[aria-label="编辑主题"]').trigger('click')

    await clickText(wrapper, '保存')

    expect(wrapper.emitted('update')?.[0]?.[1]).toMatchObject({
      tokens: { state: { danger: DEFAULTS.state.danger } },
    })
  })
})
