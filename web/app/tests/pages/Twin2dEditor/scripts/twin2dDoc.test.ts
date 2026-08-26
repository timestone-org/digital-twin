/**
 * @fileoverview 契约：撤销栈，以及「写配置必定重派绑定」这条不变量。
 *
 * ⚠ 重派那条是本页最要紧的一条：漏了之后删一个实体，它后面每一条绑定都会改喂
 * 前一个实体——界面上一切正常、读数照常刷新，只是全接错了对象。
 * ⚠ 一帧装配置与绑定两样：只把配置进退，撤销一次就让行号回到旧配置、绑定却停在
 * 新行号上。
 */
import type { BindingPayload } from '@dt/contracts'
import { normalizeTwin2dConfig, statusRowFieldKey } from '@dt/twin2d'
import type { Twin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import {
  TWIN_2D_HISTORY_LIMIT,
  createTwin2dDoc,
} from '@/pages/Twin2dEditor/scripts/twin2dDoc'

function binding(fieldKey: string): BindingPayload {
  return {
    id: fieldKey,
    nodeId: 'host',
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

/** 三个节点，各占一行 `nodeStatus`。 */
function configWith(ids: readonly string[]): Twin2dConfig {
  return normalizeTwin2dConfig({
    nodes: ids.map((id) => ({ id, styleId: 'heat-exchanger' })),
  })
}

const THREE = configWith(['n1', 'n2', 'n3'])

function docWithThreeNodes() {
  return createTwin2dDoc({
    config: THREE,
    bindings: [
      binding(statusRowFieldKey(0)),
      binding(statusRowFieldKey(1)),
      binding(statusRowFieldKey(2)),
    ],
  })
}

function keysOf(bindings: readonly BindingPayload[]): string[] {
  return bindings.map((item) => item.fieldKey)
}

describe('写入', () => {
  it('commit 之后配置换成新的', () => {
    const doc = docWithThreeNodes()

    doc.commit(configWith(['n1']))

    expect(doc.config.value.nodes).toHaveLength(1)
    expect(doc.canUndo.value).toBe(true)
    expect(doc.isDirty.value).toBe(true)
  })

  // 同一个引用再 commit 一次不该白占一格撤销栈
  it('引用没变的 commit 直接忽略', () => {
    const doc = docWithThreeNodes()

    doc.commit(doc.config.value)

    expect(doc.canUndo.value).toBe(false)
    expect(doc.isDirty.value).toBe(false)
  })
})

describe('绑定跟着实体走', () => {
  it('删掉中间那个节点，后面的绑定整体前移', () => {
    const doc = docWithThreeNodes()

    doc.commit(configWith(['n1', 'n3']))

    expect(keysOf(doc.bindings.value)).toEqual([
      statusRowFieldKey(0),
      statusRowFieldKey(1),
    ])
    // n3 那条搬到了第 1 行；留在第 2 行的话它从此喂给一个不存在的节点
    expect(doc.bindings.value[1]?.id).toBe(statusRowFieldKey(2))
  })

  it('实体没了的那条绑定整条丢弃，不占行号', () => {
    const doc = docWithThreeNodes()

    doc.commit(configWith(['n1', 'n2']))

    expect(doc.bindings.value).toHaveLength(2)
  })

  // ⚠ 同一个节点上还挂着别的模块槽，当成「找不到实体」删掉就是静默吃数据
  it('认不出的 fieldKey 原样留着', () => {
    const doc = createTwin2dDoc({
      config: THREE,
      bindings: [binding('title'), binding(statusRowFieldKey(2))],
    })

    doc.commit(configWith(['n1', 'n2', 'n3']))

    expect(keysOf(doc.bindings.value)).toContain('title')
  })

  it('撤销回去，绑定跟着回到旧行号', () => {
    const doc = docWithThreeNodes()
    doc.commit(configWith(['n1', 'n3']))

    doc.undo()

    expect(keysOf(doc.bindings.value)).toHaveLength(3)
    expect(doc.config.value.nodes).toHaveLength(3)
  })
})

describe('合并写入', () => {
  it('同一段连续动作只占一格撤销栈', () => {
    const doc = docWithThreeNodes()

    doc.commitMerged(configWith(['n1', 'n2']), 'drag:n3')
    doc.commitMerged(configWith(['n1']), 'drag:n3')
    doc.undo()

    expect(doc.config.value.nodes).toHaveLength(3)
  })

  it('换一段动作就另起一帧', () => {
    const doc = docWithThreeNodes()

    doc.commitMerged(configWith(['n1', 'n2']), 'drag:n3')
    doc.commitMerged(configWith(['n1']), 'drag:n2')
    doc.undo()

    expect(doc.config.value.nodes).toHaveLength(2)
  })

  it('endMerge 之后同一个 key 也重新开一帧', () => {
    const doc = docWithThreeNodes()

    doc.commitMerged(configWith(['n1', 'n2']), 'drag:n3')
    doc.endMerge()
    doc.commitMerged(configWith(['n1']), 'drag:n3')
    doc.undo()

    expect(doc.config.value.nodes).toHaveLength(2)
  })

  it('中间插一笔普通写入就断段', () => {
    const doc = docWithThreeNodes()

    doc.commitMerged(configWith(['n1', 'n2']), 'drag:n3')
    doc.commit(configWith(['n2', 'n3']))
    doc.commitMerged(configWith(['n1']), 'drag:n3')
    doc.undo()

    expect(doc.config.value.nodes.map((item) => item.id)).toEqual(['n2', 'n3'])
  })

  it('引用没变的合并写入也直接忽略', () => {
    const doc = docWithThreeNodes()

    doc.commitMerged(doc.config.value, 'drag:n3')

    expect(doc.canUndo.value).toBe(false)
  })
})

describe('只改绑定', () => {
  it('一次性写入自成一帧', () => {
    const doc = docWithThreeNodes()

    doc.commitBindings([binding(statusRowFieldKey(0))])

    expect(doc.bindings.value).toHaveLength(1)
    expect(doc.canUndo.value).toBe(true)
    expect(doc.config.value.nodes).toHaveLength(3)
  })

  it('同 key 的连续写入并成一笔撤销', () => {
    const doc = docWithThreeNodes()

    doc.commitBindings([binding('a')], 'binding:n1:v')
    doc.commitBindings([binding('ab')], 'binding:n1:v')
    doc.undo()

    expect(doc.bindings.value).toHaveLength(3)
  })

  it('换一个槽就另起一帧', () => {
    const doc = docWithThreeNodes()

    doc.commitBindings([binding('a')], 'binding:n1:v')
    doc.commitBindings([binding('ab')], 'binding:n2:v')
    doc.undo()

    expect(keysOf(doc.bindings.value)).toEqual(['a'])
  })
})

describe('撤销与重做', () => {
  it('一开始既不能撤销也不能重做', () => {
    const doc = docWithThreeNodes()

    expect(doc.canUndo.value).toBe(false)
    expect(doc.canRedo.value).toBe(false)
  })

  it('撤销之后能重做回去', () => {
    const doc = docWithThreeNodes()
    doc.commit(configWith(['n1']))

    doc.undo()
    expect(doc.canRedo.value).toBe(true)
    doc.redo()

    expect(doc.config.value.nodes).toHaveLength(1)
  })

  it('到头了再撤销 / 再重做都是空操作', () => {
    const doc = docWithThreeNodes()

    doc.undo()
    doc.redo()

    expect(doc.config.value.nodes).toHaveLength(3)
    expect(doc.isDirty.value).toBe(false)
  })

  // 撤销之后再改，被撤掉的那些帧就此丢弃
  it('撤销之后再写，重做入口关掉', () => {
    const doc = docWithThreeNodes()
    doc.commit(configWith(['n1']))
    doc.undo()

    doc.commit(configWith(['n2']))

    expect(doc.canRedo.value).toBe(false)
  })
})

describe('脏标记', () => {
  it('存过之后当前这一帧成为干净基准', () => {
    const doc = docWithThreeNodes()
    doc.commit(configWith(['n1']))

    doc.markSaved()

    expect(doc.isDirty.value).toBe(false)
  })

  it('存过之后再撤销回去仍然算脏', () => {
    const doc = docWithThreeNodes()
    doc.commit(configWith(['n1']))
    doc.markSaved()

    doc.undo()

    expect(doc.isDirty.value).toBe(true)
  })

  // ⚠ 已保存那一帧被撤销栈挤掉之后，「回到已保存状态」就无从判断了，只能一律算脏
  it('已保存那一帧被挤出撤销栈后一律算脏', () => {
    const doc = docWithThreeNodes()

    for (let step = 0; step <= TWIN_2D_HISTORY_LIMIT; step += 1) {
      doc.commit(configWith(['n1', `extra${step}`]))
    }
    for (let step = 0; step < TWIN_2D_HISTORY_LIMIT; step += 1) doc.undo()

    expect(doc.isDirty.value).toBe(true)
  })

  it('撤销栈不会无限长', () => {
    const doc = docWithThreeNodes()

    for (let step = 0; step <= TWIN_2D_HISTORY_LIMIT * 2; step += 1) {
      doc.commit(configWith(['n1', `extra${step}`]))
    }
    let depth = 0
    while (doc.canUndo.value) {
      doc.undo()
      depth += 1
    }

    expect(depth).toBe(TWIN_2D_HISTORY_LIMIT - 1)
  })
})
