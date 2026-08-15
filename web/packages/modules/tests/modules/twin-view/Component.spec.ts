/**
 * @fileoverview 守孪生模块的渲染契约：配置归一后按引用交给 3D 宿主、数组绑定按
 * **文档序**缝回锚点、标题浮层钉在配置的那个角、取不到数时把原因说出来。
 * ⚠ 数组行错位一格既不报错也不空白：每条曲线都有值，只是全都接错了对象。
 */
import { TWIN_CONFIG_KEY } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Component from '../../../src/modules/twin-view/Component.vue'

const scene = vi.hoisted(() => ({
  TwinScene: {
    name: 'TwinSceneStub',
    props: {
      config: { type: Object, required: true },
      anchorValues: { type: Object, default: undefined },
    },
    template: '<div class="scene-stub" />',
  },
}))

vi.mock('@dt/three-core', () => scene)

const TWIN = {
  model: { asset: 'asset:0192f0aa-0000-7000-8000-000000000001' },
  anchors: [
    { id: 'inlet', name: '进口' },
    { id: 'outlet', name: '出口' },
  ],
}

async function render(
  config: Record<string, unknown>,
  values: Record<string, unknown> = {},
) {
  const wrapper = mount(Component, { props: { config, values } })
  await flushPromises()
  return wrapper
}

describe('孪生场景的装配', () => {
  it('3D 宿主拿到的是归一化后的配置', async () => {
    const wrapper = await render({ [TWIN_CONFIG_KEY]: TWIN })

    expect(wrapper.getComponent(scene.TwinScene).props('config')).toMatchObject(
      { version: 1, model: { asset: TWIN.model.asset } },
    )
  })

  it('没配孪生场景时也交出一份合法的空配置', async () => {
    const wrapper = await render({})

    expect(wrapper.getComponent(scene.TwinScene).props('config')).toMatchObject(
      { version: 1, parts: [], anchors: [] },
    )
  })

  it('three 到挂载时才加载，模块自己不静态依赖它', async () => {
    const wrapper = await render({})

    expect(wrapper.find('.scene-stub').exists()).toBe(true)
  })
})

describe('数组绑定按文档序缝合', () => {
  it('锚点行第 i 行对上文档序第 i 个锚点', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN },
      { anchorValues: [{ value: 36.5 }, { value: 21 }] },
    )

    expect(wrapper.getComponent(scene.TwinScene).props('anchorValues')).toEqual(
      { inlet: { value: 36.5 }, outlet: { value: 21 } },
    )
  })

  it('没有绑定值时交出空映射而不是编造的行', async () => {
    const wrapper = await render({ [TWIN_CONFIG_KEY]: TWIN })

    expect(wrapper.getComponent(scene.TwinScene).props('anchorValues')).toEqual(
      {},
    )
  })
})

describe('画布上的浮层', () => {
  it('缺 title 时不叠标题', async () => {
    const wrapper = await render({ [TWIN_CONFIG_KEY]: TWIN })

    expect(wrapper.find('.dt-twin__title').exists()).toBe(false)
  })

  it('填了 title 就叠在画布上', async () => {
    const wrapper = await render({ title: '厂区总览' })

    expect(wrapper.get('.dt-twin__title').text()).toBe('厂区总览')
  })
})

describe('浮层的落点与尺寸', () => {
  async function titleStyle(config: Record<string, unknown>): Promise<string> {
    const wrapper = await render({ title: '厂区总览', ...config })
    return wrapper.get('.dt-twin__title').attributes('style') ?? ''
  }

  it('缺省钉在左上角、16px 字号，与写死那版逐字相同', async () => {
    const style = await titleStyle({})

    expect(style).toContain('top: 12px')
    expect(style).toContain('left: 16px')
    expect(style).toContain('font-size: 16px')
  })

  it('标题换一个角就换一对边距，不留下上一个角的偏移', async () => {
    const style = await titleStyle({ titlePosition: 'bottom-right' })

    expect(style).toContain('bottom: 12px')
    expect(style).toContain('right: 16px')
    expect(style).not.toContain('top:')
    expect(style).not.toContain('left:')
  })

  it('清单里没有的角回落左上，不让脏值把标题甩出画布', async () => {
    expect(await titleStyle({ titlePosition: 'middle' })).toContain('top: 12px')
  })

  it('标题字号按配置上屏，越界先夹回区间', async () => {
    expect(await titleStyle({ titleFontSize: 28 })).toContain('font-size: 28px')
    expect(await titleStyle({ titleFontSize: 999 })).toContain(
      'font-size: 72px',
    )
    expect(await titleStyle({ titleFontSize: 0 })).toContain('font-size: 8px')
  })
})

describe('取不到就说取不到', () => {
  it('取数失败时把原因写在画布上', async () => {
    const wrapper = mount(Component, {
      props: {
        config: {},
        values: {},
        meta: { status: 'error', errorMessage: '点位不存在' },
      },
    })
    await flushPromises()

    expect(wrapper.get('.dt-twin__error').text()).toBe('点位不存在')
  })

  it('失败但没给原因时也不留白', async () => {
    const wrapper = mount(Component, {
      props: { config: {}, values: {}, meta: { status: 'error' } },
    })
    await flushPromises()

    expect(wrapper.get('.dt-twin__error').text()).toBe('孪生数据取不到')
  })

  it('状态正常时不画提示条', async () => {
    const wrapper = mount(Component, {
      props: { config: {}, values: {}, meta: { status: 'connected' } },
    })
    await flushPromises()

    expect(wrapper.find('.dt-twin__error').exists()).toBe(false)
  })
})
