/**
 * @fileoverview 文档态：撤销栈，以及「写配置必定重派绑定」这条不变量。
 *
 * ⚠ 重派那条是本页最要紧的一条：漏了之后删一个实体，它后面每一条绑定都会
 * 改喂前一个实体——界面上一切正常、读数照常刷新，只是全接错了对象。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { describe, expect, it } from 'vitest'

import {
  TWIN_HISTORY_LIMIT,
  createTwinDoc,
} from '@/pages/TwinEditor/scripts/twinDoc'

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

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
})

function docWithThreeAnchors() {
  return createTwinDoc({
    config: CONFIG,
    bindings: [
      binding('anchorValues[0].value'),
      binding('anchorValues[1].value'),
      binding('anchorValues[2].value'),
    ],
  })
}

describe('写入', () => {
  it('commit 之后配置换成新的', () => {
    const doc = docWithThreeAnchors()
    const next = normalizeTwinConfig({ anchors: [{ id: 'a1' }] })

    doc.commit(next)

    expect(doc.config.value.anchors).toHaveLength(1)
  })

  // 同一个引用再 commit 一次不该白占一格撤销栈
  it('引用没变的 commit 直接忽略', () => {
    const doc = docWithThreeAnchors()

    doc.commit(doc.config.value)

    expect(doc.canUndo.value).toBe(false)
    expect(doc.isDirty.value).toBe(false)
  })
})

describe('绑定跟着实体走', () => {
  it('删掉中间那个锚点，后面的绑定整体前移', () => {
    const doc = docWithThreeAnchors()

    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }, { id: 'a3' }] }))

    expect(doc.bindings.value.map((item) => item.fieldKey)).toEqual([
      'anchorValues[0].value',
      'anchorValues[1].value',
    ])
    // 原来喂 a3 的那条现在在第 1 行，来源不变
    expect(doc.bindings.value[1]?.nodeKey).toBe('anchorValues[2].value')
  })

  it('被删实体自己那条绑定整条丢掉', () => {
    const doc = docWithThreeAnchors()

    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a2' }, { id: 'a3' }] }))

    expect(doc.bindings.value).toHaveLength(2)
  })

  it('撤销之后绑定也跟着回到上一帧', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))

    doc.undo()

    expect(doc.bindings.value).toHaveLength(3)
  })
})

describe('撤销与重做', () => {
  it('撤销回到上一帧，重做再回来', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))

    doc.undo()
    expect(doc.config.value.anchors).toHaveLength(3)

    doc.redo()
    expect(doc.config.value.anchors).toHaveLength(1)
  })

  it('第一帧上撤销无效，末帧上重做无效', () => {
    const doc = docWithThreeAnchors()

    doc.undo()
    doc.redo()

    expect(doc.config.value.anchors).toHaveLength(3)
    expect(doc.canUndo.value).toBe(false)
    expect(doc.canRedo.value).toBe(false)
  })

  // 所有编辑器的既定行为：撤销之后再改，被撤掉的那些帧就此丢弃
  it('撤销之后再写一次，重做链断掉', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))
    doc.undo()

    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a2' }] }))

    expect(doc.canRedo.value).toBe(false)
    expect(doc.config.value.anchors[0]?.id).toBe('a2')
  })
})

describe('脏标记', () => {
  it('写一次就脏，撤销回已保存那一帧就不脏', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))
    expect(doc.isDirty.value).toBe(true)

    doc.undo()

    expect(doc.isDirty.value).toBe(false)
  })

  it('markSaved 之后当前帧成为新的干净基准', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))

    doc.markSaved()

    expect(doc.isDirty.value).toBe(false)
    doc.undo()
    expect(doc.isDirty.value).toBe(true)
  })
})

describe('撤销栈封顶', () => {
  it('超过上限时从头砍，栈不再增长', () => {
    const doc = docWithThreeAnchors()
    for (let index = 0; index < TWIN_HISTORY_LIMIT + 20; index += 1) {
      doc.commit(normalizeTwinConfig({ anchors: [{ id: `a${index}` }] }))
    }

    let depth = 0
    while (doc.canUndo.value) {
      doc.undo()
      depth += 1
    }

    expect(depth).toBe(TWIN_HISTORY_LIMIT - 1)
  })

  // 「已保存」那一帧被挤掉之后，无从判断还脏不脏——只能一律算脏，不许假装干净
  it('已保存的那一帧被挤出栈之后一律算脏', () => {
    const doc = docWithThreeAnchors()
    doc.markSaved()
    for (let index = 0; index < TWIN_HISTORY_LIMIT + 5; index += 1) {
      doc.commit(normalizeTwinConfig({ anchors: [{ id: `a${index}` }] }))
    }

    while (doc.canUndo.value) doc.undo()

    expect(doc.isDirty.value).toBe(true)
  })
})

describe('只改绑定', () => {
  it('commitBindings 换掉绑定、不动配置，并且可撤销', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings([binding('anchorValues[0].value')])

    expect(doc.bindings.value).toHaveLength(1)
    expect(doc.config.value.anchors).toHaveLength(3)

    doc.undo()
    expect(doc.bindings.value).toHaveLength(3)
  })
})

describe('连续动作的并帧', () => {
  it('同 key 的 commitMerged 替换当前帧，一次撤销回到拖动前', () => {
    const doc = docWithThreeAnchors()

    doc.commitMerged(normalizeTwinConfig({ anchors: [{ id: 'g1' }] }), 'gizmo')
    doc.commitMerged(normalizeTwinConfig({ anchors: [{ id: 'g2' }] }), 'gizmo')

    expect(doc.config.value.anchors[0]?.id).toBe('g2')
    doc.undo()
    expect(doc.config.value.anchors).toHaveLength(3)
    expect(doc.canUndo.value).toBe(false)
  })
})

describe('绑定写入的并帧', () => {
  const ONE = [binding('anchorValues[0].value')]
  const TWO = [
    binding('anchorValues[0].value'),
    binding('anchorValues[1].value'),
  ]

  /** 一路撤到底要几步。 */
  function undoDepth(doc: ReturnType<typeof docWithThreeAnchors>): number {
    let depth = 0
    while (doc.canUndo.value) {
      doc.undo()
      depth += 1
    }
    return depth
  }

  it('同 key 的连续写入替换当前帧，一次撤销整段回退', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.commitBindings(TWO, 'binding:n1:slot')

    expect(doc.bindings.value).toHaveLength(2)
    doc.undo()
    expect(doc.bindings.value).toHaveLength(3)
    expect(doc.canUndo.value).toBe(false)
  })

  it('换 key 断段另起一帧，各成一笔撤销', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE, 'binding:n1:a')
    doc.commitBindings(TWO, 'binding:n1:b')

    expect(undoDepth(doc)).toBe(2)
  })

  // ⚠ 不带 key 也要断段：它还得把 mergeKey 清掉，否则随后的同 key
  //   commitMerged 会把这笔绑定写入连同它自己的帧一起并掉
  it('不带 key 的写入永远各成一帧', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE)
    doc.commitBindings(TWO)

    expect(undoDepth(doc)).toBe(2)
  })

  it('同 key 段被一笔不带 key 的写入打断后，再写同 key 是新的一帧', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.commitBindings(TWO)
    doc.commitBindings(ONE, 'binding:n1:slot')

    expect(undoDepth(doc)).toBe(3)
  })

  it('普通 commit 打断绑定并帧段', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'a1' }] }))
    doc.commitBindings(TWO, 'binding:n1:slot')

    expect(undoDepth(doc)).toBe(3)
  })

  it('endMerge 结束一段，再写同 key 另起一帧', () => {
    const doc = docWithThreeAnchors()

    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.endMerge()
    doc.commitBindings(TWO, 'binding:n1:slot')

    expect(undoDepth(doc)).toBe(2)
  })

  // ⚠ gizmo 连拖是 commitMerged 的合并段；中途插进一笔绑定写入必须把它打断，
  //   否则随后的拖动帧会把绑定改动一起并掉——撤销一步连绑定也没了
  it('gizmo 拖动中插一笔绑定写入，随后的拖动帧不并进原段', () => {
    const doc = docWithThreeAnchors()

    doc.commitMerged(normalizeTwinConfig({ anchors: [{ id: 'g1' }] }), 'gizmo')
    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.commitMerged(normalizeTwinConfig({ anchors: [{ id: 'g2' }] }), 'gizmo')

    // 三帧各自独立：拖动一 / 绑定写入 / 拖动二
    expect(undoDepth(doc)).toBe(3)
  })

  it('并帧只替换当前帧，不吃掉更早的历史', () => {
    const doc = docWithThreeAnchors()
    doc.commit(normalizeTwinConfig({ anchors: [{ id: 'x' }] }))

    doc.commitBindings(ONE, 'binding:n1:slot')
    doc.commitBindings(TWO, 'binding:n1:slot')

    doc.undo()
    expect(doc.config.value.anchors[0]?.id).toBe('x')
    doc.undo()
    expect(doc.config.value.anchors).toHaveLength(3)
  })
})
