/**
 * @fileoverview 契约：一次界面操作翻成一次文档改动 + 一个合并键——
 * 结构性改动各成一笔，连续输入按 (节点, 字段) 并成一笔，
 * 数组槽加一行会把这一行的全部子槽一次建出来（否则保存时按「索引不连续」整批被拒）。
 */
import { describe, expect, it } from 'vitest'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'

const LEAF: ModuleManifest = {
  type: 'demo-leaf',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 120, height: 60 },
  configSchema: [],
  bindings: [
    {
      key: 'rows',
      label: '多行',
      dataType: 'number',
      isArray: true,
      arrayFields: [
        { key: 'value', label: '数值', dataType: 'number' },
        { key: 'status', label: '状态', dataType: 'string' },
      ],
    },
    { key: 'title', label: '标题', dataType: 'string' },
  ],
  component: () => Promise.resolve({ default: {} }),
}

const BOX: ModuleManifest = {
  ...LEAF,
  type: 'demo-box',
  isContainer: true,
  bindings: [],
}

function getManifest(moduleType: string): ModuleManifest | undefined {
  if (moduleType === LEAF.type) return LEAF
  if (moduleType === BOX.type) return BOX
  return undefined
}

function node(
  id: string,
  over: Partial<DashboardNodePayload> = {},
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: LEAF.type,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function setup(nodes: DashboardNodePayload[] = []) {
  const editor = useDashboardEditor(getManifest)
  editor.reset(nodes)
  const actions = createEditorActions({
    editor,
    dashboardId: () => 'd1',
    getManifest,
    design: () => ({ width: 1920, height: 1080 }),
  })
  return { editor, actions }
}

describe('加模块', () => {
  it('没选中时落到顶层', () => {
    const { editor, actions } = setup()

    actions.addModule(LEAF)

    expect(editor.nodes.value).toHaveLength(1)
    expect(editor.nodes.value[0]?.parentId).toBeNull()
  })

  it('选中的是容器时落进它，判据是清单上的 isContainer', () => {
    const { editor, actions } = setup([node('box', { moduleType: BOX.type })])
    editor.select('box')

    actions.addModule(LEAF)

    expect(editor.nodes.value.find((item) => item.id !== 'box')?.parentId).toBe(
      'box',
    )
  })

  it('选中的不是容器时仍落到顶层', () => {
    const { editor, actions } = setup([node('leaf')])
    editor.select('leaf')

    actions.addModule(LEAF)

    expect(
      editor.nodes.value.find((item) => item.id !== 'leaf')?.parentId,
    ).toBeNull()
  })

  it('还没加载出大屏时不加节点', () => {
    const editor = useDashboardEditor(getManifest)
    editor.reset([])
    const actions = createEditorActions({
      editor,
      dashboardId: () => null,
      getManifest,
      design: () => ({ width: 1920, height: 1080 }),
    })

    actions.addModule(LEAF)

    expect(editor.nodes.value).toEqual([])
  })
})

describe('删节点', () => {
  it('连子树一起删，并清掉选中', () => {
    const { editor, actions } = setup([
      node('box', { moduleType: BOX.type }),
      node('kid', { parentId: 'box' }),
    ])
    editor.select('box')

    actions.removeNode('box')

    expect(editor.nodes.value).toEqual([])
    expect(editor.selectedId.value).toBeNull()
  })

  it('删的不是当前选中项时选中不变', () => {
    const { editor, actions } = setup([node('a'), node('b')])
    editor.select('a')

    actions.removeNode('b')

    expect(editor.selectedId.value).toBe('a')
  })
})

describe('几何与配置的合并', () => {
  it('拖动过程中的几笔并成一笔，一次撤销回到拖动之前', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 1, y: 0, w: 10, h: 10 }, true)
    actions.changeGeometry('a', { x: 2, y: 0, w: 10, h: 10 }, true)
    actions.changeGeometry('a', { x: 3, y: 0, w: 10, h: 10 }, false)

    editor.undo()

    expect(editor.nodes.value[0]?.x).toBe(0)
  })

  it('按下即抬起（只是点了一下节点）不置脏、不记一笔', () => {
    const { editor, actions } = setup([node('a', { x: 5, y: 6, w: 10, h: 10 })])
    editor.reset(editor.nodes.value)

    // 画布上的单击也走完整条拖动路径：位移为 0 的那一次收尾回调
    actions.changeGeometry('a', { x: 5, y: 6, w: 10, h: 10 }, false)

    expect(editor.isDirty.value).toBe(false)
    expect(editor.canUndo.value).toBe(false)
  })

  it('拖出来的小数落到节点上时已经取整，整树替换才不会被整批拒掉', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 12.3, y: 45.7, w: 10.5, h: 10 }, false)

    expect(editor.nodes.value[0]?.x).toBe(12)
    expect(editor.nodes.value[0]?.y).toBe(46)
    expect(editor.nodes.value[0]?.w).toBe(11)
  })

  it('松手那一下关掉合并窗口，下一次拖动另起一步', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 1, y: 0, w: 10, h: 10 }, false)
    actions.changeGeometry('a', { x: 2, y: 0, w: 10, h: 10 }, true)
    editor.undo()

    expect(editor.nodes.value[0]?.x).toBe(1)
  })

  it('配置的连续输入按 (节点, 字段) 合并', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.changeConfig(['title'], '北', true)
    actions.changeConfig(['title'], '北京', true)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson.title).toBeUndefined()
  })

  it('换一个字段就另起一步', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.changeConfig(['title'], '甲', true)
    actions.changeConfig(['accent'], '#fff', true)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson).toEqual({ title: '甲' })
  })

  it('没选中节点时改配置什么也不做', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeConfig(['title'], '甲', false)

    expect(editor.isDirty.value).toBe(false)
  })

  it('改显隐是结构性改动，各成一笔', () => {
    const { editor, actions } = setup([node('a')])

    actions.toggleVisible('a', false)

    expect(editor.nodes.value[0]?.isVisible).toBe(false)
    expect(editor.canUndo.value).toBe(true)
  })
})

describe('几何合并键按维度细分', () => {
  it('面板改 X 再改 W 各成一笔：第一次撤销只退 W', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 30, y: 0, w: 10, h: 10 }, true, 'x')
    actions.changeGeometry('a', { x: 30, y: 0, w: 80, h: 10 }, true, 'w')

    editor.undo()
    expect(editor.nodes.value[0]).toMatchObject({ x: 30, w: 10 })

    editor.undo()
    expect(editor.nodes.value[0]).toMatchObject({ x: 0, w: 10 })
  })

  it('同一维的连续输入仍并成一笔', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 1, y: 0, w: 10, h: 10 }, true, 'x')
    actions.changeGeometry('a', { x: 2, y: 0, w: 10, h: 10 }, true, 'x')
    editor.undo()

    expect(editor.nodes.value[0]?.x).toBe(0)
  })

  it('拖拽路径不传维度用整体键，与面板的维度键互不并笔', () => {
    const { editor, actions } = setup([node('a')])

    actions.changeGeometry('a', { x: 5, y: 0, w: 10, h: 10 }, true, 'x')
    actions.changeGeometry('a', { x: 9, y: 0, w: 10, h: 10 }, true)

    editor.undo()
    expect(editor.nodes.value[0]?.x).toBe(5)
  })
})

describe('批量改配置', () => {
  it('多选且全同类型：一次写到全部选中节点', () => {
    const { editor, actions } = setup([node('a'), node('b')])
    editor.setSelection(['a', 'b'])

    actions.changeConfig(['title'], '批', false)

    expect(editor.nodes.value[0]?.configJson.title).toBe('批')
    expect(editor.nodes.value[1]?.configJson.title).toBe('批')
  })

  it('批量写是一次 apply 一步撤销：撤销后全体退回', () => {
    const { editor, actions } = setup([
      node('a', { configJson: { title: '甲' } }),
      node('b', { configJson: { title: '乙' } }),
    ])
    editor.setSelection(['a', 'b'])

    actions.changeConfig(['title'], '批', false)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson.title).toBe('甲')
    expect(editor.nodes.value[1]?.configJson.title).toBe('乙')
  })

  it('混合类型多选只写主选中（选中集末位）', () => {
    const { editor, actions } = setup([
      node('a'),
      node('box', { moduleType: BOX.type }),
    ])
    editor.setSelection(['a', 'box'])

    actions.changeConfig(['title'], '主', false)

    expect(editor.nodes.value.find((n) => n.id === 'a')?.configJson).toEqual({})
    expect(
      editor.nodes.value.find((n) => n.id === 'box')?.configJson.title,
    ).toBe('主')
  })

  it('批量的连续输入按 multi:路径 并成一笔', () => {
    const { editor, actions } = setup([node('a'), node('b')])
    editor.setSelection(['a', 'b'])

    actions.changeConfig(['title'], '北', true)
    actions.changeConfig(['title'], '北京', true)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson.title).toBeUndefined()
    expect(editor.nodes.value[1]?.configJson.title).toBeUndefined()
  })

  it('选中集一变合并窗口就关：换选中后的输入另起一步', () => {
    const { editor, actions } = setup([node('a'), node('b')])
    editor.setSelection(['a', 'b'])
    actions.changeConfig(['title'], '一', true)

    editor.setSelection(['b', 'a'])
    actions.changeConfig(['title'], '二', true)
    editor.undo()

    expect(editor.nodes.value[0]?.configJson.title).toBe('一')
  })

  it('批量改显隐一次落一笔，撤销一步全体退回', () => {
    const { editor, actions } = setup([node('a'), node('b')])

    actions.setVisibleBatch(['a', 'b'], false)

    expect(editor.nodes.value.every((n) => !n.isVisible)).toBe(true)
    editor.undo()
    expect(editor.nodes.value.every((n) => n.isVisible)).toBe(true)
  })

  it('全体已是目标值时不置脏也不记撤销', () => {
    const { editor, actions } = setup([node('a'), node('b')])

    actions.setVisibleBatch(['a', 'b'], true)

    expect(editor.isDirty.value).toBe(false)
    expect(editor.canUndo.value).toBe(false)
  })
})

describe('绑定', () => {
  it('绑一个槽会建出一条常量绑定', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.bindSlot('title')

    expect(editor.nodes.value[0]?.bindings).toHaveLength(1)
    expect(editor.nodes.value[0]?.bindings[0]?.fieldKey).toBe('title')
  })

  it('解绑只删那个槽', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')
    actions.bindSlot('title')

    actions.dropSlot('title')

    expect(editor.nodes.value[0]?.bindings).toEqual([])
  })

  it('数组槽加一行会把这一行的全部子槽一次建出来', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.addBindingRow('rows')

    expect(
      editor.nodes.value[0]?.bindings.map((item) => item.fieldKey),
    ).toEqual(['rows[0].status', 'rows[0].value'])
  })

  it('再加一行时行号紧接现有行', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.addBindingRow('rows')
    actions.addBindingRow('rows')

    expect(
      editor.nodes.value[0]?.bindings.map((item) => item.fieldKey),
    ).toContain('rows[1].value')
  })

  it('删中间一行时其后整体前移，行号仍从 0 起且连续', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')
    actions.addBindingRow('rows')
    actions.addBindingRow('rows')

    actions.removeBindingRow('rows', 0)

    expect(
      editor.nodes.value[0]?.bindings.map((item) => item.fieldKey),
    ).toEqual(['rows[0].status', 'rows[0].value'])
  })

  it('清单里没有这个数组槽时什么也不做', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.addBindingRow('nope')

    expect(editor.nodes.value[0]?.bindings).toEqual([])
  })

  it('挑到的点位写进实时绑定的 nodeKey，且沿用原 id', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')
    actions.bindSlot('title')
    const originalId = editor.nodes.value[0]?.bindings[0]?.id
    const current = editor.nodes.value[0]?.bindings[0]
    if (current === undefined) throw new Error('绑定没建出来')
    actions.writeBinding({ ...current, sourceKind: 'opcua' })

    actions.applyPickedPoint('title', 's1:temp')

    expect(editor.nodes.value[0]?.bindings[0]?.nodeKey).toBe('s1:temp')
    expect(editor.nodes.value[0]?.bindings[0]?.id).toBe(originalId)
  })

  it('历史绑定挑点写进 detailJson，并保留已配的时间窗', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')
    actions.bindSlot('title')
    const current = editor.nodes.value[0]?.bindings[0]
    if (current === undefined) throw new Error('绑定没建出来')
    actions.writeBinding({
      ...current,
      sourceKind: 'archive',
      detailJson: { nodeKey: '', range: { lastWindow: '7d' } },
    })

    actions.applyPickedPoint('title', 's1:temp')

    expect(editor.nodes.value[0]?.bindings[0]?.detailJson).toEqual({
      nodeKey: 's1:temp',
      range: { lastWindow: '7d' },
    })
  })

  it('槽上还没有绑定时挑点什么也不做', () => {
    const { editor, actions } = setup([node('a')])
    editor.select('a')

    actions.applyPickedPoint('title', 's1:temp')

    expect(editor.nodes.value[0]?.bindings).toEqual([])
  })
})

describe('钉位与落点', () => {
  const PINNED: ModuleManifest = {
    ...LEAF,
    type: 'demo-header',
    region: 'header',
    bindings: [],
  }
  const resolve = (moduleType: string): ModuleManifest | undefined =>
    moduleType === PINNED.type ? PINNED : getManifest(moduleType)

  function setupPinned(nodes: DashboardNodePayload[] = []) {
    const editor = useDashboardEditor(resolve)
    editor.reset(nodes)
    const actions = createEditorActions({
      editor,
      dashboardId: () => 'd1',
      getManifest: resolve,
      design: () => ({ width: 1920, height: 1080 }),
    })
    return { editor, actions }
  }

  it('钉位模块横向铺满钉在顶上', () => {
    const { editor, actions } = setupPinned()

    expect(actions.addModule(PINNED)).toBe(true)

    const added = editor.nodes.value[0]
    expect(added?.x).toBe(0)
    expect(added?.y).toBe(0)
    expect(added?.w).toBe(1920)
    expect(added?.h).toBe(60)
  })

  it('同区域第二个被拒并返回 false', () => {
    const { editor, actions } = setupPinned([
      node('h', { moduleType: 'demo-header' }),
    ])

    expect(actions.addModule(PINNED)).toBe(false)
    expect(editor.nodes.value).toHaveLength(1)
  })

  it('落点添加落在指定位置与指定父层', () => {
    const { editor, actions } = setupPinned([
      node('box', { moduleType: BOX.type }),
    ])

    expect(actions.addModuleAt(LEAF, { parentId: 'box', x: 40, y: 30 })).toBe(
      true,
    )

    const added = editor.nodes.value.find((item) => item.parentId === 'box')
    expect(added?.x).toBe(40)
    expect(added?.y).toBe(30)
    expect(added?.w).toBe(120)
  })
})
