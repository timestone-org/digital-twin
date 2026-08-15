/**
 * @fileoverview 契约：钻取节点检查器整份写回、上一层候选里没有自己的子树、
 * 图标名写错当场标出来，以及「取景快照优先于预设视点」这条必须摆在界面上。
 * ⚠ 关联 3D 节点不许只能手打：候选与视口拾取两条路都要在。
 */
import type { DtSelectOption } from '@dt/contracts'
import { normalizeTwinConfig, type TwinHierNode } from '@dt/twin-config'
import { DtSelect } from '@dt/ui'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import IconPicker from '@/pages/TwinEditor/components/fields/IconPicker.vue'
import NodePicker from '@/pages/TwinEditor/components/fields/NodePicker.vue'
import HierNodeInspector from '@/pages/TwinEditor/components/inspector/HierNodeInspector.vue'

const TREE = [
  { id: 'plant', name: '厂区' },
  { id: 'shopA', parentId: 'plant', name: 'A 车间' },
  { id: 'pump', parentId: 'shopA', name: '泵组', fields: [{ key: 'p' }] },
]

function nodesOf(raw: unknown[] = TREE): TwinHierNode[] {
  return normalizeTwinConfig({ hierNodes: raw }).hierNodes
}

function render(id = 'shopA', raw: unknown[] = TREE, picking = false) {
  const nodes = nodesOf(raw)
  const modelValue = nodes.find((item) => item.id === id)
  if (modelValue === undefined) throw new Error(`没有 ${id} 这个节点`)
  return mount(HierNodeInspector, {
    props: {
      modelValue,
      nodes,
      cameras: normalizeTwinConfig({
        cameras: [{ id: 'cam1', name: '总览' }],
      }).cameras,
      nodeNames: ['Pump_01', 'Shop_A'],
      picking,
    },
  })
}

type Wrapper = ReturnType<typeof render>

function lastWrite(wrapper: Wrapper): TwinHierNode {
  const events = wrapper.emitted('update:modelValue')
  if (!events?.length) throw new Error('没有整份写回节点')
  return events[events.length - 1]?.[0] as TwinHierNode
}

function selectByLabel(wrapper: Wrapper, label: string) {
  const found = wrapper
    .findAllComponents(DtSelect)
    .find((item) => item.props('ariaLabel') === label)
  if (found === undefined) throw new Error(`没有标签为「${label}」的下拉`)
  return found
}

function optionsOf(wrapper: Wrapper, label: string): readonly DtSelectOption[] {
  return selectByLabel(wrapper, label).props('options')
}

describe('上一层', () => {
  it('候选里没有自己，也没有自己的子树', () => {
    const options = optionsOf(render('shopA'), '上一层')

    expect(options.map((item) => item.value)).toEqual(['', 'plant'])
  })

  it('候选标签用完整钻取路径，重名的两层才分得开', () => {
    const options = optionsOf(render('pump'), '上一层')

    expect(options.map((item) => item.label)).toEqual([
      '（顶层）',
      '厂区',
      '厂区 / A 车间',
    ])
  })

  it('根节点的整棵子树都被排除后，只剩「（顶层）」一项', () => {
    const options = optionsOf(render('plant'), '上一层')

    expect(options.map((item) => item.value)).toEqual([''])
  })

  it('选「（顶层）」写回的是 null，不是空串', async () => {
    const wrapper = render('shopA')

    await selectByLabel(wrapper, '上一层').setValue('')

    expect(lastWrite(wrapper).parentId).toBeNull()
  })

  it('选一层写回它的 id', async () => {
    const wrapper = render('shopA')

    await selectByLabel(wrapper, '上一层').setValue('plant')

    expect(lastWrite(wrapper).parentId).toBe('plant')
  })
})

describe('图标', () => {
  // ⚠ 手输框在这里不可接受：DtIcon 拿到未登记的名字既不报错也什么都不画
  it('图标只能从选择器里挑，没有手输框', () => {
    const wrapper = render('shopA')

    expect(wrapper.findComponent(IconPicker).exists()).toBe(true)
    expect(wrapper.find('input[aria-label="图标"]').exists()).toBe(false)
  })

  it('挑一个图标整份写回节点', async () => {
    const wrapper = render('shopA')
    await wrapper.get('[data-test="icon-toggle"]').trigger('click')

    await wrapper
      .get('[data-test="icon-option"][data-name="folder"]')
      .trigger('click')

    expect(lastWrite(wrapper).icon).toBe('folder')
  })

  it('存量里的非法图标名当场标出来', () => {
    const wrapper = render('shopA', [
      { id: 'shopA', name: 'A 车间', icon: '不存在的图标' },
    ])

    expect(wrapper.text()).toContain('不在图标表里')
  })

  it('图标名合法时不报警', () => {
    const wrapper = render('shopA', [
      { id: 'shopA', name: 'A 车间', icon: 'folder' },
    ])

    expect(wrapper.text()).not.toContain('不在图标表里')
  })
})

describe('关联节点', () => {
  it('能从模型节点候选里挑，不必手打', () => {
    const picker = render('shopA').findComponent(NodePicker)

    expect(picker.props('candidates')).toEqual(['Pump_01', 'Shop_A'])
  })

  it('还给一条从视口拾取的路，省得对着 GLB 里的名字硬记', async () => {
    const wrapper = render('shopA')
    const button = wrapper
      .findAll('button')
      .find((item) => item.text() === '从视口拾取')
    await button?.trigger('click')

    expect(wrapper.emitted('requestPickNode')).toHaveLength(1)
  })

  it('留空时把「取子孙并集」这条说出来，并报出当前有效个数', () => {
    const wrapper = render('shopA', [
      { id: 'shopA' },
      { id: 'pump', parentId: 'shopA', nodes: ['Pump_01'] },
    ])

    expect(wrapper.text()).toContain('取全部下级节点的并集（当前 1 个）')
  })

  it('拾取中时按钮文案切成可取消', () => {
    expect(render('shopA', TREE, true).text()).toContain('取消')
  })
})

describe('进入取景', () => {
  it('没配取景时说清「不动镜头」', () => {
    expect(render('shopA').text()).toContain('不动镜头')
  })

  it('「取当前机位」把节点 id 抛给页面去拿快照', async () => {
    const wrapper = render('shopA')

    await wrapper.get('[data-test="hier-capture-view"]').trigger('click')

    expect(wrapper.emitted('captureView')?.[0]).toEqual(['shopA'])
  })

  it('清除取景写回 null', async () => {
    const wrapper = render('shopA', [
      {
        id: 'shopA',
        view: { position: [1, 2, 3], target: [0, 0, 0], fov: 45 },
      },
    ])

    await wrapper.get('[data-test="hier-clear-view"]').trigger('click')

    expect(lastWrite(wrapper).view).toBeNull()
  })

  it('取景与预设视点都配了时，摆明预设视点不生效', () => {
    const wrapper = render('shopA', [
      {
        id: 'shopA',
        cameraId: 'cam1',
        view: { position: [1, 2, 3], target: [0, 0, 0], fov: 45 },
      },
    ])

    expect(wrapper.text()).toContain('取景快照优先')
  })
})

describe('钻取页', () => {
  it('标题留空时提示会用整条钻取路径', () => {
    expect(render('pump').text()).toContain('厂区 / A 车间 / 泵组')
  })

  it('叶子层不给「隐藏子项列表」开关——它本来就没有子项', () => {
    expect(render('pump').text()).toContain('这是一个叶子层')
  })

  it('有子层时才给「隐藏子项列表」，并说清隐藏后只能点 3D', () => {
    expect(render('shopA').text()).toContain('只能靠点 3D 上的部件')
  })
})

describe('同级次序', () => {
  it('只读显示，并指路到左栏层级页签', () => {
    expect(render('shopA').text()).toContain('在左栏「层级」页签里拖')
  })
})
