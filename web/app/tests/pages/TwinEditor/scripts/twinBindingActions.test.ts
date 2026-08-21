/**
 * @fileoverview 绑定页的动作落到文档态上：写、绑、解绑、删孤行、写挑到的点位。
 *
 * ⚠ 写入必须经 `commitBindings`——配置与绑定一起进退，撤销才不会把两者错开。
 * ⚠ 同 `fieldKey` 重写要沿用旧 id：重生成会让实时推送的关联键每次保存断一次。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import { createTwinBindingActions } from '@/pages/TwinEditor/scripts/twinBindingActions'
import { createTwinDoc } from '@/pages/TwinEditor/scripts/twinDoc'

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }, { id: 'a2' }],
})

function binding(fieldKey: string, over: Partial<BindingPayload> = {}) {
  return {
    id: fieldKey,
    nodeId: 'n1',
    fieldKey,
    sourceKind: 'opcua' as const,
    nodeKey: fieldKey,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '2026-08-15T00:00:00Z',
    updatedAt: '2026-08-15T00:00:00Z',
    ...over,
  }
}

function setup(bindings: BindingPayload[] = []) {
  const doc = createTwinDoc({ config: CONFIG, bindings })
  return { doc, actions: createTwinBindingActions(doc, () => 'n1') }
}

/** 某个槽当前那一条绑定。 */
function at(doc: ReturnType<typeof setup>['doc'], fieldKey: string) {
  return doc.bindings.value.find((item) => item.fieldKey === fieldKey)
}

describe('绑与解绑', () => {
  it('绑一个空槽时建的绑定挂在当前节点上，来源默认常量', () => {
    const { doc, actions } = setup()

    actions.bind('anchorValues[0].value')

    expect(at(doc, 'anchorValues[0].value')).toMatchObject({
      nodeId: 'n1',
      sourceKind: 'static',
    })
  })

  it('解绑只删这一条，别的槽原样留着', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value'),
      binding('anchorValues[1].value'),
    ])

    actions.drop('anchorValues[0].value')

    expect(doc.bindings.value.map((item) => item.fieldKey)).toEqual([
      'anchorValues[1].value',
    ])
  })

  it('每一次写入都进撤销栈，撤一次退回上一份绑定', () => {
    const { doc, actions } = setup()

    actions.bind('anchorValues[0].value')
    doc.undo()

    expect(doc.bindings.value).toEqual([])
  })

  it('只动绑定不动配置：撤销之后配置还是同一份引用', () => {
    const { doc, actions } = setup()

    actions.bind('anchorValues[0].value')

    expect(doc.config.value).toBe(CONFIG)
  })
})

describe('重写一条绑定', () => {
  it('同槽重写沿用旧 id，不重新生成', () => {
    const { doc, actions } = setup([binding('anchorValues[0].value')])

    actions.write(
      binding('anchorValues[0].value', {
        id: '换了一个 id',
        sourceKind: 'static',
      }),
    )

    expect(at(doc, 'anchorValues[0].value')).toMatchObject({
      id: 'anchorValues[0].value',
      sourceKind: 'static',
    })
  })

  it('写完仍按 (fieldKey, id) 排序，与服务端一致', () => {
    const { doc, actions } = setup([binding('anchorValues[1].value')])

    actions.bind('anchorValues[0].value')

    expect(doc.bindings.value.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
      'anchorValues[1].value',
    ])
  })
})

describe('写挑到的点位', () => {
  it('实时点位写进 nodeKey', () => {
    const { doc, actions } = setup([binding('anchorValues[0].value')])

    actions.applyPickedPoint('anchorValues[0].value', 'ns=2;s=T1')

    expect(at(doc, 'anchorValues[0].value')?.nodeKey).toBe('ns=2;s=T1')
  })

  // ⚠ 写错字段的表现是「挑完了、标签也变了，但永远取不到值」
  it('历史序列写进 detailJson，并保留已配的相对窗', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value', {
        sourceKind: 'archive',
        detailJson: { nodeKey: '', range: { lastWindow: '7d' } },
      }),
    ])

    actions.applyPickedPoint('anchorValues[0].value', 'ns=2;s=T1')

    expect(at(doc, 'anchorValues[0].value')?.detailJson).toEqual({
      nodeKey: 'ns=2;s=T1',
      range: { lastWindow: '7d' },
    })
  })

  it('历史序列还没配过相对窗时给缺省最近一小时', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value', { sourceKind: 'archive' }),
    ])

    actions.applyPickedPoint('anchorValues[0].value', 'ns=2;s=T1')

    expect(at(doc, 'anchorValues[0].value')?.detailJson).toEqual({
      nodeKey: 'ns=2;s=T1',
      range: { lastWindow: '1h' },
    })
  })

  it('槽上还没有绑定时什么都不做，不凭空造一条', () => {
    const { doc, actions } = setup()

    actions.applyPickedPoint('anchorValues[0].value', 'ns=2;s=T1')

    expect(doc.bindings.value).toEqual([])
  })
})

describe('撤销粒度', () => {
  /** 一路撤到底要几步。 */
  function undoDepth(doc: ReturnType<typeof setup>['doc']): number {
    let depth = 0
    while (doc.canUndo.value) {
      doc.undo()
      depth += 1
    }
    return depth
  }

  // 同一个槽的逐键输入按 (节点, 槽) 并成一笔——逐帧各记的话撤销要按几十下
  it('同槽连续 write 并成一笔，一次撤销回到写入前', () => {
    const { doc, actions } = setup([binding('anchorValues[0].value')])

    actions.write(binding('anchorValues[0].value', { nodeKey: 'ns=2;s=T' }))
    actions.write(binding('anchorValues[0].value', { nodeKey: 'ns=2;s=T1' }))

    expect(at(doc, 'anchorValues[0].value')?.nodeKey).toBe('ns=2;s=T1')
    doc.undo()
    expect(at(doc, 'anchorValues[0].value')?.nodeKey).toBe(
      'anchorValues[0].value',
    )
    expect(doc.canUndo.value).toBe(false)
  })

  it('写完再挑点位仍是同一段——write 与 applyPickedPoint 共用槽 key', () => {
    const { doc, actions } = setup([binding('anchorValues[0].value')])

    actions.write(binding('anchorValues[0].value', { nodeKey: '手敲一半' }))
    actions.applyPickedPoint('anchorValues[0].value', 'ns=2;s=T1')

    expect(undoDepth(doc)).toBe(1)
  })

  it('换槽各成一笔，互不合并', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value'),
      binding('anchorValues[1].value'),
    ])

    actions.write(binding('anchorValues[0].value', { nodeKey: 'a' }))
    actions.write(binding('anchorValues[1].value', { nodeKey: 'b' }))

    expect(undoDepth(doc)).toBe(2)
  })

  // 增删是一次性动作：连着两笔绑定各自可撤，不许被并成一笔
  it('bind / drop / removeRow 各记各的一笔', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value'),
      binding('anchorValues[1].value'),
    ])

    actions.bind('anchorValues[2].value')
    actions.drop('anchorValues[0].value')
    actions.removeRow('anchorValues', 0)

    expect(undoDepth(doc)).toBe(3)
  })

  it('增删动作打断同槽的连续段，之后再写同槽另起一笔', () => {
    const { doc, actions } = setup([binding('anchorValues[0].value')])

    actions.write(binding('anchorValues[0].value', { nodeKey: 'a' }))
    actions.bind('anchorValues[1].value')
    actions.write(binding('anchorValues[0].value', { nodeKey: 'b' }))

    expect(undoDepth(doc)).toBe(3)
  })
})

describe('删孤行', () => {
  it('删掉那一行，其后各行整体前移一格', () => {
    const { doc, actions } = setup([
      binding('anchorValues[0].value'),
      binding('anchorValues[1].value'),
      binding('anchorValues[2].value'),
    ])

    actions.removeRow('anchorValues', 1)

    expect(doc.bindings.value.map((item) => item.nodeKey)).toEqual([
      'anchorValues[0].value',
      // 原来第 2 行的那条被删，原第 3 行搬到第 2 行——点位身份跟着它一起搬
      'anchorValues[2].value',
    ])
  })
})
