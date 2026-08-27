/**
 * @fileoverview 契约：绑定页的四个动作落到文档态那一份绑定上，挑点弹窗的开关与
 * 「挑到的点位写回哪一条」串在一起。
 *
 * ⚠ 全部写入都经 `commitBindings`：配置与绑定同帧进退，绕开它直接改的表现是撤销一次
 * 退回了配置、绑定却停在新行号上。
 * ⚠ 落库的是 `node_key`（点位在设备上的身份）不是 `code`：写成 code 的表现是标签上有
 * 点位名、推送方却永远匹配不到这个键，读数一直是占位符。
 * ⚠ 文档还没读出来时全部动作都必须是空操作，而不是抛异常把整页带白。
 */
import type { BindingPayload, CollectPoint } from '@dt/contracts'
import { nodeRowFieldKey, normalizeTwin2dConfig } from '@dt/twin2d'
import { describe, expect, it } from 'vitest'

import { createTwin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'
import type { Twin2dDoc } from '@/pages/Twin2dEditor/scripts/twin2dDoc'
import { useTwin2dBindings } from '@/pages/Twin2dEditor/scripts/useTwin2dBindings'

/** 水箱有两个有效槽位，于是这一个节点就占了 `nodeValues` 的头两行。 */
const CONFIG = normalizeTwin2dConfig({
  nodes: [{ id: 'n1', styleId: 'water-tank', x: 10, y: 10 }],
})

const FIRST = nodeRowFieldKey(0)
const SECOND = nodeRowFieldKey(1)

const POINT: CollectPoint = {
  id: 'pt-1',
  source_id: 'src-1',
  node_key: 'ns=2;s=T1',
  code: 'T1',
  name: '1 号温度',
  address: 'ns=2;s=T1',
  data_type: 'float',
  unit: '℃',
  sampling_interval_ms: 1000,
  deadband: 0,
  archive_enabled: true,
  archive_max_interval_ms: 60_000,
  archive_retention_days: null,
  created_at: '',
  updated_at: '',
}

function docOf(bindings: readonly BindingPayload[] = []): Twin2dDoc {
  return createTwin2dDoc({ config: CONFIG, bindings })
}

function bindingsOf(doc: Twin2dDoc | null) {
  return useTwin2dBindings(
    () => doc,
    () => 'host',
  )
}

/** 一条已经挑好点位的绑定，用来铺垫「换来源」「删行」这类动作。 */
function archiveBinding(fieldKey: string): BindingPayload {
  return {
    id: fieldKey,
    nodeId: 'host',
    fieldKey,
    sourceKind: 'archive',
    nodeKey: null,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '2026-08-20T00:00:00Z',
    updatedAt: '2026-08-20T00:00:00Z',
  }
}

describe('接到文档态上', () => {
  it('绑一个槽之后绑定表里就有它', () => {
    const api = bindingsOf(docOf())

    api.bind(FIRST)

    expect(api.bindings.value.map((item) => item.fieldKey)).toEqual([FIRST])
  })

  it('解绑之后就没了', () => {
    const api = bindingsOf(docOf())
    api.bind(FIRST)

    api.drop(FIRST)

    expect(api.bindings.value).toEqual([])
  })

  // ⚠ 重生成 id 会让实时推送的关联键每次保存断一次
  it('写同一个槽时沿用原来那一条的 id', () => {
    const doc = docOf()
    const api = bindingsOf(doc)
    api.bind(FIRST)
    const before = api.bindings.value[0]

    api.write({ ...archiveBinding(FIRST), id: 'brand-new' })

    expect(api.bindings.value[0]?.id).toBe(before?.id)
    expect(api.bindings.value[0]?.sourceKind).toBe('archive')
  })

  it('写一个还没绑过的槽是追加', () => {
    const api = bindingsOf(docOf())

    api.write(archiveBinding(SECOND))

    expect(api.bindings.value.map((item) => item.fieldKey)).toEqual([SECOND])
  })

  // ⚠ 行号必须连续且从 0 起，服务端会校验；删中间一行是整体前移而不是留个洞
  it('删掉一行让它后面的整体前移一格', () => {
    const api = bindingsOf(
      docOf([archiveBinding(FIRST), archiveBinding(SECOND)]),
    )

    api.removeRow('nodeValues', 0)

    expect(api.bindings.value.map((item) => item.fieldKey)).toEqual([FIRST])
  })
})

describe('挑点弹窗', () => {
  it('挑完把点位身份写进那一条绑定，并把弹窗关上', () => {
    const api = bindingsOf(docOf())
    api.bind(FIRST)
    api.pickingFieldKey.value = FIRST

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.nodeKey).toBe('ns=2;s=T1')
    expect(api.pickingFieldKey.value).toBeNull()
  })

  // ⚠ 历史序列的点位身份在 detailJson 里；写进 nodeKey 的表现是标签变了却取不到值
  it('历史序列的绑定把点位身份写进取数说明', () => {
    const api = bindingsOf(docOf([archiveBinding(FIRST)]))
    api.pickingFieldKey.value = FIRST

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.detailJson).toEqual({
      nodeKey: 'ns=2;s=T1',
      range: { lastWindow: '1h' },
    })
  })

  it('历史序列已经选好的取数范围留着不动', () => {
    const api = bindingsOf(
      docOf([
        {
          ...archiveBinding(FIRST),
          detailJson: { nodeKey: 'old', range: { lastWindow: '7d' } },
        },
      ]),
    )
    api.pickingFieldKey.value = FIRST

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.detailJson?.range).toEqual({
      lastWindow: '7d',
    })
  })

  it('弹窗没开时挑到的点位不写给任何人', () => {
    const api = bindingsOf(docOf())
    api.bind(FIRST)

    api.pickPoint(POINT)

    expect(api.bindings.value[0]?.nodeKey).toBeNull()
  })

  // 选中的槽这一刻已经没有绑定了（比如刚被解绑）：关掉弹窗就是了，不许凭空造一条
  it('那个槽已经没有绑定时什么都不写', () => {
    const api = bindingsOf(docOf())
    api.pickingFieldKey.value = FIRST

    api.pickPoint(POINT)

    expect(api.bindings.value).toEqual([])
    expect(api.pickingFieldKey.value).toBeNull()
  })

  it('关掉弹窗只清开关，不动绑定', () => {
    const api = bindingsOf(docOf())
    api.bind(FIRST)
    api.pickingFieldKey.value = FIRST

    api.closePicker(false)

    expect(api.pickingFieldKey.value).toBeNull()
    expect(api.bindings.value).toHaveLength(1)
  })

  // 弹窗自己回报「我开着」时不许把挑点状态清掉，否则挑完写不回任何一条绑定
  it('弹窗回报开着时不动挑点状态', () => {
    const api = bindingsOf(docOf())
    api.pickingFieldKey.value = FIRST

    api.closePicker(true)

    expect(api.pickingFieldKey.value).toBe(FIRST)
  })
})

/**
 * ⚠ 逐键各落一帧的话，敲一个常量就往撤销栈里塞进十几格，撤销键从此按不回上一步；
 * 而增删各自成帧，否则撤销一次会把「建了这条绑定」也一起撤掉。
 */
describe('落进撤销栈', () => {
  it('同一个槽的连续写入并成一笔', () => {
    const doc = docOf()
    const api = bindingsOf(doc)
    api.bind(FIRST)
    api.write({ ...archiveBinding(FIRST), nodeKey: 'a' })
    api.write({ ...archiveBinding(FIRST), nodeKey: 'b' })

    doc.undo()

    expect(api.bindings.value[0]?.nodeKey).toBeNull()
    expect(doc.canUndo.value).toBe(true)
  })

  it('建一条绑定自己占一笔', () => {
    const doc = docOf()
    const api = bindingsOf(doc)
    api.bind(FIRST)

    doc.undo()

    expect(api.bindings.value).toEqual([])
  })

  it('换一个槽写就另起一笔', () => {
    const doc = docOf()
    const api = bindingsOf(doc)
    api.write({ ...archiveBinding(FIRST), nodeKey: 'a' })
    api.write({ ...archiveBinding(SECOND), nodeKey: 'b' })

    doc.undo()

    expect(api.bindings.value.map((item) => item.fieldKey)).toEqual([FIRST])
  })
})

describe('文档还没读出来', () => {
  it('绑定表是空的，四个动作全是空操作而不是抛异常', () => {
    const api = bindingsOf(null)

    api.bind(FIRST)
    api.drop(FIRST)
    api.removeRow('nodeValues', 0)
    api.write(archiveBinding(FIRST))

    expect(api.bindings.value).toEqual([])
  })

  it('挑点也只是把弹窗关上', () => {
    const api = bindingsOf(null)
    api.pickingFieldKey.value = FIRST

    api.pickPoint(POINT)

    expect(api.bindings.value).toEqual([])
    expect(api.pickingFieldKey.value).toBeNull()
  })
})
