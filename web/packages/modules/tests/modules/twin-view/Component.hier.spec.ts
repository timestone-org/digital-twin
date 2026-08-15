/**
 * @fileoverview 契约：孪生模块把钻取字段按文档序缝回、点部件同时上抛联动与打开钻取、
 * 钻进一层时按这一层的取景搬镜头。
 * ⚠ 联动事件与钻取是并行的两件事：钻取绝不能把联动掐掉，否则给部件配上钻取会让
 * 同屏别的模块静默失联。
 */
import { TWIN_CONFIG_KEY } from '@dt/twin-config'
import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'

import Component from '../../../src/modules/twin-view/Component.vue'

// ⚠ 用 `defineComponent` 而不是裸对象：裸对象的 `vm` 是 any，`$emit` 与 `props()`
// 全都退化成不可检查的调用，测试里写错 emit 名一样静默放行
const TwinSceneStub = defineComponent({
  name: 'TwinSceneStub',
  props: {
    config: { type: Object, required: true },
    focusView: { type: Object, default: null },
  },
  emits: { partClick: (part: { partId: string }) => typeof part === 'object' },
  template: '<div class="scene-stub" />',
})

const TwinHierDrillStub = defineComponent({
  name: 'TwinHierDrillStub',
  props: {
    nodes: { type: Array, required: true },
    nodeId: { type: String, required: true },
    values: { type: Object, required: true },
  },
  emits: {
    'update:nodeId': (id: string) => typeof id === 'string',
    close: () => true,
  },
  template: '<div class="drill-stub" />',
})

// ⚠ 组件只在挂载时才动态 import three-core，所以工厂跑在这两个常量初始化之后
vi.mock('@dt/three-core', () => ({
  TwinScene: TwinSceneStub,
  TwinHierDrill: TwinHierDrillStub,
}))

const TWIN = {
  model: { asset: 'asset:0192f0aa-0000-7000-8000-000000000001' },
  parts: [
    { id: 'pump-part', name: '泵', clickHierNode: 'pump' },
    { id: 'plain-part', name: '外壳' },
    { id: 'broken-part', name: '坏的', clickHierNode: 'gone' },
  ],
  cameras: [
    {
      id: 'cam1',
      name: '总览',
      position: [9, 9, 9],
      target: [1, 1, 1],
      fov: 30,
    },
  ],
  hierNodes: [
    { id: 'plant', name: '厂区', fields: [{ key: 'p', label: '总功率' }] },
    {
      id: 'pump',
      parentId: 'plant',
      name: '泵组',
      cameraId: 'cam1',
      fields: [{ key: 'p', label: '功率' }],
    },
  ],
}

async function render(values: Record<string, unknown> = {}) {
  const wrapper = mount(Component, {
    props: { config: { [TWIN_CONFIG_KEY]: TWIN }, values },
  })
  await flushPromises()
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof render>>

async function clickPart(wrapper: Wrapper, partId: string): Promise<void> {
  wrapper.getComponent(TwinSceneStub).vm.$emit('partClick', { partId })
  await flushPromises()
}

function drill(wrapper: Wrapper) {
  return wrapper.getComponent(TwinHierDrillStub)
}

describe('钻取字段缝合', () => {
  it('第 i 行喂扁平化后的第 i 个字段', async () => {
    const wrapper = await render({ hierValues: [{ value: 100 }, { value: 7 }] })
    await clickPart(wrapper, 'pump-part')

    expect(drill(wrapper).props('values')).toEqual({
      'plant::p': { value: 100 },
      'pump::p': { value: 7 },
    })
  })
})

describe('点部件打开钻取', () => {
  it('钻取面板默认不出现', async () => {
    expect((await render()).find('.drill-stub').exists()).toBe(false)
  })

  it('点挂了钻取节点的部件就落到那一层', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    expect(drill(wrapper).props('nodeId')).toBe('pump')
  })

  it('联动事件照发不误，钻取不替代它', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    expect(wrapper.emitted('interaction')?.[0]).toEqual([
      { event: 'click', value: 'pump-part' },
    ])
  })

  it('没挂钻取节点的部件只上抛联动，不开面板', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'plain-part')

    expect(wrapper.emitted('interaction')).toHaveLength(1)
    expect(wrapper.find('.drill-stub').exists()).toBe(false)
  })

  it('指到已删掉的层时什么都不开，不留一个空壳面板', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'broken-part')

    expect(wrapper.find('.drill-stub').exists()).toBe(false)
  })

  it('面板抛关闭时收起来', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    drill(wrapper).vm.$emit('close')
    await flushPromises()

    expect(wrapper.find('.drill-stub').exists()).toBe(false)
  })

  it('面板自己往上钻时宿主跟着换层', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    drill(wrapper).vm.$emit('update:nodeId', 'plant')
    await flushPromises()

    expect(drill(wrapper).props('nodeId')).toBe('plant')
  })
})

describe('钻取取景', () => {
  it('没开钻取时不给取景，镜头不动', async () => {
    expect(
      (await render()).getComponent(TwinSceneStub).props('focusView'),
    ).toBeNull()
  })

  it('这一层没配快照时退回它引用的预设视点', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    expect(wrapper.getComponent(TwinSceneStub).props('focusView')).toEqual({
      position: [9, 9, 9],
      target: [1, 1, 1],
      fov: 30,
    })
  })

  it('这一层什么都没配时不动镜头', async () => {
    const wrapper = await render()
    await clickPart(wrapper, 'pump-part')

    drill(wrapper).vm.$emit('update:nodeId', 'plant')
    await flushPromises()

    expect(wrapper.getComponent(TwinSceneStub).props('focusView')).toBeNull()
  })
})
