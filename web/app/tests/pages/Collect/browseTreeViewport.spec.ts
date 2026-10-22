/** @fileoverview 万点地址空间的有界挂载、尾部访问与分页交互。 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  enableAutoUnmount,
  flushPromises,
  mount,
  type VueWrapper,
} from '@vue/test-utils'
import BrowseTreeViewport from '@/pages/Collect/components/BrowseTreeViewport.vue'
import BrowseTreeNode from '@/pages/Collect/components/BrowseTreeNode.vue'
import { toNodes } from '@/pages/Collect/scripts/browseTree'

function nodes(count: number) {
  return toNodes(
    Array.from({ length: count }, (_, index) => ({
      address: `ns=2;s=Point${index}`,
      name: `Point${index}`,
      has_children: false,
      is_variable: true,
      data_type: 'float',
    })),
  )
}

function render(count = 10000) {
  return mount(BrowseTreeViewport, {
    props: {
      roots: nodes(count),
      nextToken: null,
      loadingMore: false,
      states: new Map(),
      taken: new Set<string>(),
    },
  })
}

function viewport(wrapper: VueWrapper): HTMLElement {
  const element = wrapper.get('[role="tree"]').element
  if (!(element instanceof HTMLElement)) throw new Error('缺少树容器')
  return element
}

enableAutoUnmount(afterEach)
afterEach(() => vi.restoreAllMocks())

describe('虚拟浏览树', () => {
  it('万点目录首屏和滚动到尾部的挂载数量都小于 100，尾部点位可选择', async () => {
    const wrapper = render()
    expect(wrapper.findAllComponents(BrowseTreeNode).length).toBeLessThan(100)
    expect(wrapper.text()).toContain('Point0')
    expect(wrapper.text()).not.toContain('Point9999')

    viewport(wrapper).scrollTop = 320000 - 480
    await wrapper.trigger('scroll')

    expect(wrapper.findAllComponents(BrowseTreeNode).length).toBeLessThan(100)
    expect(wrapper.text()).toContain('Point9999')
    expect(wrapper.text()).not.toContain('ns=2;s=Point0')
    const last = wrapper
      .findAll('label.dt-checkbox')
      .find((one) => one.text() === 'Point9999')
    await last?.find('input').setValue(true)
    expect(wrapper.emitted('toggle')).toEqual([['ns=2;s=Point9999']])
  })

  it('根与子层的加载更多按钮传回各自父地址', async () => {
    const roots = nodes(1)
    const root = roots[0]
    if (root === undefined) throw new Error('节点夹具为空')
    root.isOpen = true
    root.isVariable = false
    root.hasChildren = true
    root.isIncomplete = true
    root.error = '读取失败'
    const wrapper = mount(BrowseTreeViewport, {
      props: {
        roots,
        nextToken: 'root-next',
        loadingMore: false,
        states: new Map(),
        taken: new Set<string>(),
      },
    })
    expect(wrapper.text()).toContain('读取失败')
    await wrapper
      .get('button[aria-label="继续浏览「Point0」"]')
      .trigger('click')
    await wrapper
      .get('button[aria-label="继续浏览「根节点」"]')
      .trigger('click')
    expect(wrapper.emitted('loadMore')).toEqual([['ns=2;s=Point0'], [null]])
  })

  it('键盘翻页与首尾定位可以访问虚拟窗口以外的点位', async () => {
    const wrapper = render()
    await wrapper.trigger('keydown', { key: 'End' })
    expect(wrapper.text()).toContain('Point9999')
    await wrapper.trigger('keydown', { key: 'Home' })
    expect(wrapper.text()).toContain('Point0')
    await wrapper.trigger('keydown', { key: 'PageDown' })
    expect(wrapper.text()).toContain('Point20')
    await wrapper.trigger('keydown', { key: 'PageUp' })
    expect(wrapper.text()).toContain('Point0')
    await wrapper.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.trigger('keydown', { key: 'ArrowUp' })
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(viewport(wrapper).scrollTop).toBe(0)
  })

  it('窗口按宿主高度调整，卸载时解除尺寸观察', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(96)
    const disconnect = vi.spyOn(ResizeObserver.prototype, 'disconnect')
    const wrapper = render()
    await flushPromises()
    expect(wrapper.findAllComponents(BrowseTreeNode)).toHaveLength(9)
    wrapper.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })

  it('数据缩短后把滚动夹回有效范围，根分页追加保留当前位置', async () => {
    const wrapper = render()
    viewport(wrapper).scrollTop = 320000 - 480
    await wrapper.trigger('scroll')
    await wrapper.setProps({ roots: nodes(2) })
    expect(wrapper.text()).toContain('Point0')
    expect(viewport(wrapper).scrollTop).toBe(0)
    await wrapper.setProps({ roots: nodes(50) })
    viewport(wrapper).scrollTop = 320
    await wrapper.trigger('scroll')
    await wrapper.setProps({ roots: nodes(100) })
    expect(viewport(wrapper).scrollTop).toBe(320)
  })

  it('共享点位的父目录折叠后保留另一条路径，虚拟窗口外仍能按地址选择', async () => {
    const roots = nodes(40)
    const first = roots[0]
    const second = roots[1]
    if (first === undefined || second === undefined)
      throw new Error('父节点夹具为空')
    first.isOpen = true
    second.isOpen = true
    first.children = toNodes([
      {
        address: 'shared',
        name: '甲目录共享点位',
        has_children: false,
        is_variable: true,
        data_type: 'float',
      },
    ])
    second.children = toNodes([
      {
        address: 'shared',
        name: '乙目录共享点位',
        has_children: false,
        is_variable: true,
        data_type: 'float',
      },
    ])
    const warnings = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined)
    const wrapper = mount(BrowseTreeViewport, {
      props: {
        roots,
        nextToken: null,
        loadingMore: false,
        states: new Map(),
        taken: new Set<string>(),
      },
    })
    expect(wrapper.text()).toContain('甲目录共享点位')
    expect(wrapper.text()).toContain('乙目录共享点位')
    viewport(wrapper).scrollTop = 32 * 8
    await wrapper.trigger('scroll')
    await wrapper.trigger('keydown', { key: 'Home' })
    const next = [...roots]
    next[0] = { ...first, isOpen: false }
    await wrapper.setProps({ roots: next })
    expect(wrapper.text()).not.toContain('甲目录共享点位')
    expect(wrapper.text()).toContain('乙目录共享点位')
    const shared = wrapper
      .findAll('label.dt-checkbox')
      .find((one) => one.text() === '乙目录共享点位')
    if (shared === undefined) throw new Error('另一条共享点位路径消失')
    await shared.find('input').setValue(true)
    expect(wrapper.emitted('toggle')).toEqual([['shared']])
    expect(
      warnings.mock.calls
        .flat()
        .some((message) => String(message).includes('Duplicate keys')),
    ).toBe(false)
  })
})
