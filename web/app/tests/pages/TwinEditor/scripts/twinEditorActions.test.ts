/**
 * @fileoverview 动作集：大纲树发上来的增删改移落到文档态上。
 * ⚠ 这一层要守的是「所有写入都过 doc.commit」——绕开它，删一个实体就会让
 * 它后面的每一条绑定改喂前一个实体，而界面上完全看不出来。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it, vi } from 'vitest'

import { createTwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'
import { createTwinEditorActions } from '@/pages/TwinEditor/scripts/twinEditorActions'

function binding(fieldKey: string): BindingPayload {
  return {
    id: fieldKey,
    nodeId: 'n1',
    fieldKey,
    sourceKind: 'opcua',
    nodeKey: fieldKey,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
  }
}

function setup(raw: Record<string, unknown>, bindings: BindingPayload[] = []) {
  const doc = createTwinDoc({
    config: normalizeTwinConfig(raw),
    bindings,
  })
  const select = vi.fn()
  return { doc, select, actions: createTwinEditorActions(doc, select) }
}

describe('新增', () => {
  it('新增之后选中挪到新实体上', () => {
    const { actions, select, doc } = setup({})

    actions.add('anchors')

    const created = doc.config.value.anchors[0]
    expect(created).toBeDefined()
    expect(select).toHaveBeenCalledWith({ kind: 'anchors', id: created?.id })
  })
})

describe('按拾取点落牌', () => {
  it('新牌的中心落在给定坐标上，选中挪过去', () => {
    const { actions, select, doc } = setup({})

    actions.addPanelAt([3, 2, 1])

    const created = doc.config.value.panels[0]
    expect(created?.position).toEqual([3, 2, 1])
    expect(select).toHaveBeenCalledWith({ kind: 'panels', id: created?.id })
  })

  // 建牌 + 落点必须是一笔：分两笔的话撤销一步只退回落点，留下一张原点上的牌
  it('撤销一步就回到「没这张牌」', () => {
    const { actions, doc } = setup({})

    actions.addPanelAt([3, 2, 1])
    doc.undo()

    expect(doc.config.value.panels).toHaveLength(0)
  })
})

describe('手柄改动落盘', () => {
  it('信息牌的旋转跟着位置一起落', () => {
    const { actions, doc } = setup({
      panels: [{ id: 'n1', position: [0, 0, 0] }],
    })

    actions.transformEntity({
      kind: 'panels',
      id: 'n1',
      position: [1, 2, 3],
      direction: null,
      rotation: [0, 45, 0],
    })
    actions.endTransform()

    const panel = doc.config.value.panels[0]
    expect(panel?.position).toEqual([1, 2, 3])
    expect(panel?.rotation).toEqual([0, 45, 0])
  })

  it('平移改动不带旋转时，原有旋转不动', () => {
    const { actions, doc } = setup({
      panels: [{ id: 'n1', position: [0, 0, 0], rotation: [0, 30, 0] }],
    })

    actions.transformEntity({
      kind: 'panels',
      id: 'n1',
      position: [5, 0, 0],
      direction: null,
      rotation: null,
    })
    actions.endTransform()

    expect(doc.config.value.panels[0]?.rotation).toEqual([0, 30, 0])
  })
})

describe('删除与重排会连带搬绑定', () => {
  it('删中间那个锚点，后面的绑定整体前移', () => {
    const { actions, doc } = setup(
      { anchors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] },
      [binding('anchorValues[2].value')],
    )

    actions.remove('anchors', 'a2')

    expect(doc.bindings.value[0]?.fieldKey).toBe('anchorValues[1].value')
  })

  it('上移一个锚点，绑定跟着它走', () => {
    const { actions, doc } = setup({ anchors: [{ id: 'a1' }, { id: 'a2' }] }, [
      binding('anchorValues[1].value'),
    ])

    actions.move('anchors', 'a2', -1)

    expect(doc.bindings.value[0]?.fieldKey).toBe('anchorValues[0].value')
  })
})

describe('复制', () => {
  it('复制之后选中挪到副本上', () => {
    const { actions, select, doc } = setup({ anchors: [{ id: 'a1' }] })

    actions.duplicate('anchors', 'a1')

    const copy = doc.config.value.anchors[1]
    expect(copy).toBeDefined()
    expect(select).toHaveBeenCalledWith({ kind: 'anchors', id: copy?.id })
  })

  it('复制不存在的实体时不动文档、也不改选中', () => {
    const { actions, select, doc } = setup({ anchors: [{ id: 'a1' }] })

    actions.duplicate('anchors', 'nope')

    expect(doc.canUndo.value).toBe(false)
    expect(select).not.toHaveBeenCalled()
  })
})

describe('单例段', () => {
  it('patchConfig 换掉模型那一段', () => {
    const { actions, doc } = setup({})

    actions.patchConfig({
      model: { ...doc.config.value.model, scale: 2 },
    })

    expect(doc.config.value.model.scale).toBe(2)
  })
})

describe('钻取树', () => {
  it('建根之后选中挪到新节点上', () => {
    const { actions, select, doc } = setup({})

    actions.addHier(null)

    const created = doc.config.value.hierNodes[0]
    expect(created?.name).toBe('区域 1')
    expect(select).toHaveBeenCalledWith({
      kind: 'hierNodes',
      id: created?.id,
    })
  })

  it('建子层挂在指定的上一层下', () => {
    const { actions, doc } = setup({ hierNodes: [{ id: 'plant' }] })

    actions.addHier('plant')

    expect(doc.config.value.hierNodes[1]?.parentId).toBe('plant')
  })

  it('同级挪位走 commit，撤销栈上留得下一步', () => {
    const { actions, doc } = setup({
      hierNodes: [
        { id: 'a', order: 0 },
        { id: 'b', order: 1 },
      ],
    })

    actions.moveHier('b', -1)

    expect(doc.canUndo.value).toBe(true)
    expect(doc.config.value.hierNodes.find((it) => it.id === 'b')?.order).toBe(
      0,
    )
  })

  it('改父子走 commit', () => {
    const { actions, doc } = setup({
      hierNodes: [{ id: 'a' }, { id: 'b' }],
    })

    actions.reparentHier('b', 'a')

    expect(doc.config.value.hierNodes[1]?.parentId).toBe('a')
  })

  // ⚠ 拖进自己的子树会成环，而成环的那几层在钻取里整片消失
  it('拖进自己的子树被挡下，撤销栈上不留空帧', () => {
    const { actions, doc } = setup({
      hierNodes: [{ id: 'a' }, { id: 'b', parentId: 'a' }],
    })

    actions.reparentHier('a', 'b')

    expect(doc.canUndo.value).toBe(false)
  })
})

describe('文件夹', () => {
  const FOLDERED = {
    anchors: [{ id: 'a1' }, { id: 'a2' }],
    folders: [{ id: 'f1', kind: 'anchors', name: '温度组', itemIds: ['a1'] }],
  }

  it('建夹返回夹 id，供上层立刻进入就地重命名', () => {
    const { actions, doc } = setup({})

    const id = actions.addFolder('anchors')

    expect(doc.config.value.folders[0]?.id).toBe(id)
    expect(doc.canUndo.value).toBe(true)
  })

  it('重命名走 commit，可撤销', () => {
    const { actions, doc } = setup(FOLDERED)

    actions.renameFolder('f1', '进水段')

    expect(doc.config.value.folders[0]?.name).toBe('进水段')
    doc.undo()
    expect(doc.config.value.folders[0]?.name).toBe('温度组')
  })

  // 改名弹框原样确认不该白吃一步撤销
  it('名字没变时不记帧', () => {
    const { actions, doc } = setup(FOLDERED)

    actions.renameFolder('f1', ' 温度组 ')

    expect(doc.canUndo.value).toBe(false)
  })

  it('删夹后成员回散行，实体数组不动', () => {
    const { actions, doc } = setup(FOLDERED)

    actions.removeFolder('f1')

    expect(doc.config.value.folders).toEqual([])
    expect(doc.config.value.anchors.map((item) => item.id)).toEqual([
      'a1',
      'a2',
    ])
  })

  it('移入与移出各记一步，可分别撤销', () => {
    const { actions, doc } = setup(FOLDERED)

    actions.moveIntoFolder('f1', 'a2')
    expect(doc.config.value.folders[0]?.itemIds).toEqual(['a1', 'a2'])

    actions.removeFromFolder('a1')
    expect(doc.config.value.folders[0]?.itemIds).toEqual(['a2'])

    doc.undo()
    expect(doc.config.value.folders[0]?.itemIds).toEqual(['a1', 'a2'])
  })

  it('建夹并移入是一笔：撤销一步就回到「没这个夹」', () => {
    const { actions, doc } = setup({ anchors: [{ id: 'a1' }] })

    const id = actions.addFolderWithItem('anchors', 'a1')

    expect(doc.config.value.folders[0]).toMatchObject({
      id,
      itemIds: ['a1'],
    })
    doc.undo()
    expect(doc.config.value.folders).toEqual([])
    expect(doc.canUndo.value).toBe(false)
  })

  it('进出夹不搬绑定：文档序没变，绑定行原地不动', () => {
    const { actions, doc } = setup(FOLDERED, [binding('anchorValues[1].value')])

    actions.moveIntoFolder('f1', 'a2')

    expect(doc.bindings.value[0]?.fieldKey).toBe('anchorValues[1].value')
  })
})
