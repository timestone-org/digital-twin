/**
 * @fileoverview 守孪生模块的渲染契约：配置归一后按引用交给 3D 宿主、数组绑定按
 * **文档序**缝回规则与锚点、告警汇总缺省不显示、取不到数时把原因说出来。
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
      tintValues: { type: Object, default: undefined },
      anchorValues: { type: Object, default: undefined },
    },
    template: '<div class="scene-stub" />',
  },
}))

vi.mock('@dt/three-core', () => scene)

const TWIN = {
  model: { asset: 'asset:0192f0aa-0000-7000-8000-000000000001' },
  tints: [
    { id: 'pump', name: '泵组', alarmStatus: ['fault'] },
    { id: 'fan', name: '风机', alarmStatus: ['fault'] },
  ],
  anchors: [{ id: 'inlet', name: '进口' }],
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
      { version: 1, parts: [], anchors: [], tints: [] },
    )
  })

  it('three 到挂载时才加载，模块自己不静态依赖它', async () => {
    const wrapper = await render({})

    expect(wrapper.find('.scene-stub').exists()).toBe(true)
  })
})

describe('数组绑定按文档序缝合', () => {
  it('染色行第 i 行对上文档序第 i 条规则', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN },
      {
        tintValues: [
          { value: 1, status: 'run' },
          { value: 2, status: 'fault' },
        ],
      },
    )

    expect(wrapper.getComponent(scene.TwinScene).props('tintValues')).toEqual({
      pump: { value: 1, status: 'run' },
      fan: { value: 2, status: 'fault' },
    })
  })

  it('锚点行第 i 行对上文档序第 i 个锚点', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN },
      { anchorValues: [{ value: 36.5 }] },
    )

    expect(wrapper.getComponent(scene.TwinScene).props('anchorValues')).toEqual(
      {
        inlet: { value: 36.5 },
      },
    )
  })

  it('没有绑定值时交出空映射而不是编造的行', async () => {
    const wrapper = await render({ [TWIN_CONFIG_KEY]: TWIN })

    expect(wrapper.getComponent(scene.TwinScene).props('tintValues')).toEqual(
      {},
    )
  })
})

describe('画布上的浮层', () => {
  it('缺 showAlarmSummary 时不显示告警汇总', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN },
      { tintValues: [{ value: 1, status: 'fault' }] },
    )

    expect(wrapper.find('.dt-twin__alarms').exists()).toBe(false)
  })

  it('开了汇总且有规则告警时逐条列出规则名', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN, showAlarmSummary: true },
      { tintValues: [{ value: 1, status: 'fault' }] },
    )

    expect(
      wrapper.findAll('.dt-twin__alarm').map((item) => item.text()),
    ).toEqual(['泵组'])
  })

  it('开了汇总但无人告警时不占画布', async () => {
    const wrapper = await render(
      { [TWIN_CONFIG_KEY]: TWIN, showAlarmSummary: true },
      { tintValues: [{ value: 1, status: 'run' }] },
    )

    expect(wrapper.find('.dt-twin__alarms').exists()).toBe(false)
  })

  it('缺 title 时不叠标题', async () => {
    const wrapper = await render({ [TWIN_CONFIG_KEY]: TWIN })

    expect(wrapper.find('.dt-twin__title').exists()).toBe(false)
  })

  it('填了 title 就叠在画布上', async () => {
    const wrapper = await render({ title: '厂区总览' })

    expect(wrapper.get('.dt-twin__title').text()).toBe('厂区总览')
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
