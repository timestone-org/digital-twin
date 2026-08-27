/**
 * @fileoverview 契约：画布上那三类（节点 / 连线 / 标注）互斥，而「正在编辑哪个样式」
 * 与它们**并行**；右栏按最后选中的那一个分派，没选中时落到画布那一段。
 *
 * ⚠ 三类不互斥的话，右栏就得同时画两种检查器，而那是没有的。
 * ⚠ 样式那条轴要是被并进去，选中一个节点就会把正在编辑的样式挤掉——而样式面板本来
 * 就要在选着节点的时候开着。
 */
import { describe, expect, it } from 'vitest'

import { createTwin2dSelection } from '@/pages/Twin2dEditor/scripts/editorSelection'
import { TWIN_2D_SELECT_CANVAS } from '@/pages/Twin2dEditor/scripts/types'

describe('画布那一条轴', () => {
  it('单选就是把整条轴换成这一个', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')

    expect(selection.pick.value).toEqual({ kind: 'nodes', ids: ['n1'] })
    expect(selection.isPicked('nodes', 'n1')).toBe(true)
  })

  it('选中连线时节点那一批一起让位', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.select('edges', 'e1')

    expect(selection.idsOf('nodes')).toEqual([])
    expect(selection.idsOf('edges')).toEqual(['e1'])
  })

  it('框选整批顶替原来的一批', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.selectMany('nodes', ['n2', 'n3'], false)

    expect(selection.idsOf('nodes')).toEqual(['n2', 'n3'])
  })

  it('框选加选取并集，重复的那个不会进两次', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.selectMany('nodes', ['n1', 'n2'], true)

    expect(selection.idsOf('nodes')).toEqual(['n1', 'n2'])
  })

  it('加选换了类别时仍然整条轴换过去', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.selectMany('marks', ['m1'], true)

    expect(selection.pick.value).toEqual({ kind: 'marks', ids: ['m1'] })
  })

  it('框选空表等于没选中', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.selectMany('nodes', [], false)

    expect(selection.pick.value).toBeNull()
  })

  it('按住修饰键点已选中的那个是取消它', () => {
    const selection = createTwin2dSelection()

    selection.selectMany('nodes', ['n1', 'n2'], false)
    selection.toggle('nodes', 'n1')

    expect(selection.idsOf('nodes')).toEqual(['n2'])
  })

  it('按住修饰键点没选中的那个是加进来', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.toggle('nodes', 'n2')

    expect(selection.idsOf('nodes')).toEqual(['n1', 'n2'])
  })

  it('按住修饰键点另一类实体，整条轴换过去', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.toggle('edges', 'e1')

    expect(selection.pick.value).toEqual({ kind: 'edges', ids: ['e1'] })
  })

  it('把最后一个也切掉就等于没选中', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.toggle('nodes', 'n1')

    expect(selection.pick.value).toBeNull()
  })

  it('点空白清掉画布那一条', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.clear()

    expect(selection.pick.value).toBeNull()
    expect(selection.isPicked('nodes', 'n1')).toBe(false)
  })
})

describe('样式那一条轴', () => {
  it('与画布那一条并行：选中节点不会挤掉正在编辑的样式', () => {
    const selection = createTwin2dSelection()

    selection.focusStyle('styles', 's1')
    selection.select('nodes', 'n1')

    expect(selection.styleFocus.value).toEqual({ kind: 'styles', id: 's1' })
    expect(selection.idsOf('nodes')).toEqual(['n1'])
  })

  it('换编辑另一个样式不动画布那一条', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.focusStyle('edgeStyles', 'es1')

    expect(selection.styleFocus.value).toEqual({
      kind: 'edgeStyles',
      id: 'es1',
    })
    expect(selection.idsOf('nodes')).toEqual(['n1'])
  })

  it('关掉样式面板只清样式那一条', () => {
    const selection = createTwin2dSelection()

    selection.select('nodes', 'n1')
    selection.focusStyle('styles', 's1')
    selection.clearStyleFocus()

    expect(selection.styleFocus.value).toBeNull()
    expect(selection.idsOf('nodes')).toEqual(['n1'])
  })
})

describe('右栏画哪一段', () => {
  it('一个都没选时落到画布那一段', () => {
    const selection = createTwin2dSelection()

    expect(selection.inspect.value).toEqual(TWIN_2D_SELECT_CANVAS)
  })

  it('多选时取最后选中的那一个', () => {
    const selection = createTwin2dSelection()

    selection.selectMany('nodes', ['n1', 'n2', 'n3'], false)

    expect(selection.inspect.value).toEqual({ kind: 'nodes', id: 'n3' })
  })

  it('清空之后又落回画布那一段', () => {
    const selection = createTwin2dSelection()

    selection.select('marks', 'm1')
    selection.clear()

    expect(selection.inspect.value).toEqual(TWIN_2D_SELECT_CANVAS)
  })
})

describe('实体被删之后', () => {
  it('悬空的 id 从画布那一条里摘掉', () => {
    const selection = createTwin2dSelection()

    selection.selectMany('nodes', ['n1', 'n2'], false)
    selection.prune((_kind, id) => id !== 'n1')

    expect(selection.idsOf('nodes')).toEqual(['n2'])
  })

  it('整批都没了就等于没选中', () => {
    const selection = createTwin2dSelection()

    selection.selectMany('nodes', ['n1', 'n2'], false)
    selection.prune(() => false)

    expect(selection.pick.value).toBeNull()
  })

  it('正在编辑的样式没了也一起摘掉', () => {
    const selection = createTwin2dSelection()

    selection.focusStyle('styles', 's1')
    selection.prune((kind) => kind !== 'styles')

    expect(selection.styleFocus.value).toBeNull()
  })

  it('样式还在就不动它', () => {
    const selection = createTwin2dSelection()

    selection.focusStyle('styles', 's1')
    selection.prune(() => true)

    expect(selection.styleFocus.value).toEqual({ kind: 'styles', id: 's1' })
  })
})
