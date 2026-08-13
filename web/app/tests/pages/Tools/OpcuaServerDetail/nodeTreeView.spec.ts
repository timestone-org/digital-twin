/**
 * @fileoverview 地址空间那棵树的对外面：ARIA 结构、键盘漫游、点击分工。
 *
 * ⚠ DOM 是摊平的，屏幕阅读器无法再从嵌套推断层级——`aria-level` /
 * `aria-setsize` / `aria-posinset` 一旦漏掉，树对读屏用户就是一串平行项。
 * 这几个属性写错时 typecheck 与 lint 都不会响，只能靠这里守。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import type { OpcuaNode } from '@dt/contracts'

import NodeTree from '@/pages/Tools/OpcuaServerDetail/components/NodeTree.vue'
import {
  buildNodeTree,
  visibleRows,
} from '@/pages/Tools/OpcuaServerDetail/nodeTree'

function node(over: Partial<OpcuaNode> = {}): OpcuaNode {
  return {
    id: 'n1',
    instance_id: 'i1',
    parent_id: null,
    node_class: 'variable',
    identifier: 'T1',
    identifier_kind: 'string',
    node_id: 'ns=2;s=T1',
    browse_name: 'Temperature',
    data_type: 'double',
    value_rank: -1,
    array_dimensions: null,
    access_level: 3,
    initial_value: null,
    description: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...over,
  }
}

/** 一棵三层树：Line1 →（Temp、Sub → Deep），外加一个平行的根。 */
const NODES: OpcuaNode[] = [
  node({ id: 'a', browse_name: 'Line1', node_class: 'object' }),
  node({ id: 'a1', parent_id: 'a', browse_name: 'Temp' }),
  node({ id: 'a2', parent_id: 'a', browse_name: 'Sub', node_class: 'object' }),
  node({ id: 'a2x', parent_id: 'a2', browse_name: 'Deep' }),
  node({ id: 'b', browse_name: 'Line2', node_class: 'object' }),
]

function rowsOf(expanded: string[] = ['a', 'a2']) {
  return visibleRows(buildNodeTree(NODES), new Set(expanded))
}

function tree(over: { expanded?: string[]; selectedId?: string | null } = {}) {
  return mount(NodeTree, {
    props: {
      rows: rowsOf(over.expanded),
      selectedId: over.selectedId ?? null,
    },
    attachTo: document.body,
  })
}

enableAutoUnmount(afterEach)

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ARIA 结构', () => {
  it('外层是 tree，每行是 treeitem', () => {
    const wrapper = tree()
    expect(wrapper.find('[role="tree"]').exists()).toBe(true)
    expect(wrapper.findAll('[role="treeitem"]')).toHaveLength(5)
  })

  it('层级用 aria-level 表达，从 1 起', () => {
    const levels = tree()
      .findAll('[role="treeitem"]')
      .map((row) => row.attributes('aria-level'))
    expect(levels).toEqual(['1', '2', '2', '3', '1'])
  })

  it('⚠ 同层的总数与序号显式给出，摊平之后读屏无从推断', () => {
    const rows = tree().findAll('[role="treeitem"]')
    // 根这一层两项：Line1 是第 1 个，Line2 是第 2 个
    expect(rows[0]?.attributes('aria-setsize')).toBe('2')
    expect(rows[0]?.attributes('aria-posinset')).toBe('1')
    expect(rows[4]?.attributes('aria-posinset')).toBe('2')
    // Line1 底下两项
    expect(rows[1]?.attributes('aria-setsize')).toBe('2')
    expect(rows[2]?.attributes('aria-posinset')).toBe('2')
  })

  it('有子节点的行才有 aria-expanded，叶子不该有', () => {
    const rows = tree().findAll('[role="treeitem"]')
    expect(rows[0]?.attributes('aria-expanded')).toBe('true')
    expect(rows[1]?.attributes('aria-expanded')).toBeUndefined()
  })

  it('折叠时 aria-expanded 变 false，而不是消失', () => {
    const rows = tree({ expanded: [] }).findAll('[role="treeitem"]')
    expect(rows[0]?.attributes('aria-expanded')).toBe('false')
  })

  it('选中态同时进 aria-selected', () => {
    const rows = tree({ selectedId: 'a1' }).findAll('[role="treeitem"]')
    expect(rows[1]?.attributes('aria-selected')).toBe('true')
    expect(rows[0]?.attributes('aria-selected')).toBe('false')
  })

  it('⚠ 只有一行可 tab 到——几百个点全部可 tab 等于把键盘用户困住', () => {
    const tabindexes = tree()
      .findAll('[role="treeitem"]')
      .map((row) => row.attributes('tabindex'))
    expect(tabindexes.filter((value) => value === '0')).toHaveLength(1)
    expect(tabindexes[0]).toBe('0')
  })

  it('被截断的子树标出来，不冒充成根节点', () => {
    const orphan = [node({ id: 'x', parent_id: 'missing', browse_name: 'Orp' })]
    const wrapper = mount(NodeTree, {
      props: {
        rows: visibleRows(buildNodeTree(orphan), new Set()),
        selectedId: null,
      },
    })
    expect(wrapper.text()).toContain('父节点不在本页')
  })
})

describe('键盘漫游', () => {
  it('下箭头把可 tab 的那一行往下挪', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[0]?.trigger('keydown', {
      key: 'ArrowDown',
    })
    const tabindexes = wrapper
      .findAll('[role="treeitem"]')
      .map((row) => row.attributes('tabindex'))
    expect(tabindexes[1]).toBe('0')
    expect(tabindexes[0]).toBe('-1')
  })

  it('上箭头往回挪，到顶就停住', async () => {
    const wrapper = tree()
    const rows = wrapper.findAll('[role="treeitem"]')
    await rows[0]?.trigger('keydown', { key: 'ArrowUp' })
    expect(
      wrapper.findAll('[role="treeitem"]')[0]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('Home / End 跳到首尾', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[0]?.trigger('keydown', {
      key: 'End',
    })
    expect(
      wrapper.findAll('[role="treeitem"]')[4]?.attributes('tabindex'),
    ).toBe('0')
    await wrapper.findAll('[role="treeitem"]')[4]?.trigger('keydown', {
      key: 'Home',
    })
    expect(
      wrapper.findAll('[role="treeitem"]')[0]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('右箭头在收起的父节点上发 expand', async () => {
    const wrapper = tree({ expanded: [] })
    await wrapper.findAll('[role="treeitem"]')[0]?.trigger('keydown', {
      key: 'ArrowRight',
    })
    expect(wrapper.emitted('expand')?.[0]).toEqual(['a'])
  })

  it('右箭头在已展开的父节点上进第一个子节点，而不是再发一次 expand', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[0]?.trigger('keydown', {
      key: 'ArrowRight',
    })
    expect(wrapper.emitted('expand')).toBeUndefined()
    expect(
      wrapper.findAll('[role="treeitem"]')[1]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('右箭头在叶子上什么也不做', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[1]?.trigger('keydown', {
      key: 'ArrowRight',
    })
    expect(wrapper.emitted('expand')).toBeUndefined()
  })

  it('左箭头在展开的父节点上发 collapse', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[0]?.trigger('keydown', {
      key: 'ArrowLeft',
    })
    expect(wrapper.emitted('collapse')?.[0]).toEqual(['a'])
  })

  it('左箭头在子节点上回到父节点那一行', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[3]?.trigger('keydown', {
      key: 'ArrowLeft',
    })
    // Deep(3) 的父是 Sub(2)
    expect(
      wrapper.findAll('[role="treeitem"]')[2]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('左箭头在顶层叶子上没有父可回，安静收场', async () => {
    const flat = [node({ id: 'only', browse_name: 'Only' })]
    const wrapper = mount(NodeTree, {
      props: {
        rows: visibleRows(buildNodeTree(flat), new Set()),
        selectedId: null,
      },
    })
    await wrapper.find('[role="treeitem"]').trigger('keydown', {
      key: 'ArrowLeft',
    })
    expect(wrapper.emitted('collapse')).toBeUndefined()
  })

  it.each(['Enter', ' '])('%s 选中当前行', async (key) => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[2]?.trigger('keydown', { key })
    expect(wrapper.emitted('select')?.[0]).toEqual(['a2'])
  })

  it('不认识的键原样放过去，不吞掉浏览器的默认行为', () => {
    const wrapper = tree()
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      cancelable: true,
      bubbles: true,
    })
    wrapper.findAll('[role="treeitem"]')[0]?.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('认识的键要挡掉默认行为——空格否则会把页面滚下去', () => {
    const wrapper = tree()
    const event = new KeyboardEvent('keydown', {
      key: ' ',
      cancelable: true,
      bubbles: true,
    })
    wrapper.findAll('[role="treeitem"]')[0]?.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('点击的分工', () => {
  it('点行选中它', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[1]?.trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual(['a1'])
  })

  it('⚠ 点折叠钮只折叠，不顺带选中——「看看下面有什么」不是「我要操作它」', async () => {
    const wrapper = tree()
    await wrapper.find('.node-caret').trigger('click')
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['a'])
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('叶子行不出折叠钮，只占位对齐', () => {
    const rows = tree().findAll('[role="treeitem"]')
    expect(rows[1]?.find('.node-caret').exists()).toBe(false)
    expect(rows[1]?.find('.node-caret-placeholder').exists()).toBe(true)
  })
})

describe('外部改动同步过来', () => {
  it('选中项换成别处的节点时，键盘焦点跟着挪过去', async () => {
    const wrapper = tree()
    await wrapper.setProps({ selectedId: 'a2x' })
    expect(
      wrapper.findAll('[role="treeitem"]')[3]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('选中被清空时焦点原地不动', async () => {
    const wrapper = tree()
    await wrapper.setProps({ selectedId: 'a2x' })
    await wrapper.setProps({ selectedId: null })
    expect(
      wrapper.findAll('[role="treeitem"]')[3]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('选中一个当前不可见的节点时焦点不乱跳', async () => {
    const wrapper = tree()
    await wrapper.setProps({ selectedId: '不存在' })
    expect(
      wrapper.findAll('[role="treeitem"]')[0]?.attributes('tabindex'),
    ).toBe('0')
  })

  it('⚠ 行数变少时把焦点夹回范围内，否则 tabindex 落在不存在的行上', async () => {
    const wrapper = tree()
    await wrapper.findAll('[role="treeitem"]')[4]?.trigger('keydown', {
      key: 'End',
    })
    await wrapper.setProps({ rows: rowsOf([]) })
    const tabindexes = wrapper
      .findAll('[role="treeitem"]')
      .map((row) => row.attributes('tabindex'))
    expect(tabindexes.filter((value) => value === '0')).toHaveLength(1)
    expect(tabindexes.at(-1)).toBe('0')
  })
})
