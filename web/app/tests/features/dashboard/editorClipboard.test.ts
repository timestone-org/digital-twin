/**
 * @fileoverview 剪贴板契约：祖先被选中时后代不重复入板、钉位单例不入板、
 * 粘贴全量重发 id 并保住子树结构与 z 序、联动规则跟着选中集走并按新 id 重映射、
 * 两个通道按复制时刻取新的那份、localStorage 兜底防御脏数据。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardNodePayload, InteractionRule } from '@dt/contracts'

import {
  __resetClipboard,
  buildClipboardPayload,
  nextPasteOffset,
  pasteNodes,
  readClipboard,
  writeClipboard,
  type ClipboardPayload,
} from '@/features/dashboard/editorClipboard'

function node(
  id: string,
  parentId: string | null,
  moduleType = 'text-block',
  zIndex = 0,
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd-1',
    parentId,
    clientKey: null,
    moduleType,
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    zIndex,
    isVisible: true,
    configJson: { title: id },
    createdAt: '2026-08-14T00:00:00Z',
    updatedAt: '2026-08-14T00:00:00Z',
    bindings: [],
  }
}

const NEVER_REGION = (): boolean => false

/** 一条显隐规则：`from` 点一下，`targets` 跟着显示。 */
function showRule(
  id: string,
  from: string,
  targets: string[],
): InteractionRule {
  return {
    id,
    source: { nodeId: from, event: 'click' },
    action: { type: 'show', targets },
  }
}

afterEach(__resetClipboard)

describe('构建 payload', () => {
  it('祖先被选中时后代不单独入板，但整棵子树都在', () => {
    const nodes = [node('a', null), node('a1', 'a'), node('a2', 'a')]
    const draft = buildClipboardPayload(nodes, ['a', 'a1'], NEVER_REGION, [])
    expect(draft?.payload.nodes.map((item) => item.ck).sort()).toEqual([
      'a',
      'a1',
      'a2',
    ])
    expect(
      draft?.payload.nodes.filter((item) => item.parentCk === null),
    ).toHaveLength(1)
  })

  it('钉位单例不参与复制；全被剔除时给 null', () => {
    const nodes = [node('h', null, 'header')]
    expect(
      buildClipboardPayload(nodes, ['h'], (type) => type === 'header', []),
    ).toBeNull()
  })

  it('父在子前，粘贴方按序就能建父引用', () => {
    const nodes = [node('a', null), node('a1', 'a'), node('a11', 'a1')]
    const draft = buildClipboardPayload(nodes, ['a'], NEVER_REGION, [])
    const order = draft?.payload.nodes.map((item) => item.ck) ?? []
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('a1'))
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a11'))
  })
})

describe('联动规则跟着选中集走', () => {
  const nodes = [node('a', null), node('b', null), node('out', null)]

  it('源与目标都在复制集内的规则跟着走', () => {
    const draft = buildClipboardPayload(nodes, ['a', 'b'], NEVER_REGION, [
      showRule('r-1', 'a', ['b']),
    ])
    expect(draft?.payload.rules).toEqual([
      {
        sourceCk: 'a',
        event: 'click',
        action: { type: 'show', targets: ['b'] },
      },
    ])
    expect(draft?.droppedRules).toBe(0)
  })

  it('源不在复制集内的规则不是这次复制的事，不算丢弃', () => {
    const draft = buildClipboardPayload(nodes, ['a'], NEVER_REGION, [
      showRule('r-1', 'out', ['a']),
    ])
    expect(draft?.payload.rules).toEqual([])
    expect(draft?.droppedRules).toBe(0)
  })

  it('目标全落在复制集外的规则整条丢弃并计数', () => {
    const draft = buildClipboardPayload(nodes, ['a'], NEVER_REGION, [
      showRule('r-1', 'a', ['out']),
    ])
    expect(draft?.payload.rules).toEqual([])
    expect(draft?.droppedRules).toBe(1)
  })

  it('只有部分目标在复制集内时裁剪着带走，不整条丢', () => {
    const draft = buildClipboardPayload(nodes, ['a', 'b'], NEVER_REGION, [
      showRule('r-1', 'a', ['b', 'out']),
    ])
    expect(draft?.payload.rules[0]?.action).toEqual({
      type: 'show',
      targets: ['b'],
    })
    expect(draft?.droppedRules).toBe(0)
  })

  it('跨屏跳转的目标是大屏句柄不是节点，原样带走', () => {
    const draft = buildClipboardPayload(nodes, ['a'], NEVER_REGION, [
      {
        id: 'r-1',
        source: { nodeId: 'a', event: 'click' },
        action: { type: 'navigate', target: 'other-dashboard' },
      },
    ])
    expect(draft?.payload.rules[0]?.action).toEqual({
      type: 'navigate',
      target: 'other-dashboard',
    })
  })

  it('弹窗内容节点没一起复制时整条丢，一起复制时跟着走', () => {
    const openModal = (id: string, target: string): InteractionRule => ({
      id,
      source: { nodeId: 'a', event: 'click' },
      action: { type: 'openModal', target, title: '详情' },
    })
    const alone = buildClipboardPayload(nodes, ['a'], NEVER_REGION, [
      openModal('r-1', 'out'),
    ])
    expect(alone?.payload.rules).toEqual([])
    expect(alone?.droppedRules).toBe(1)

    const together = buildClipboardPayload(nodes, ['a', 'b'], NEVER_REGION, [
      openModal('r-1', 'b'),
    ])
    expect(together?.payload.rules[0]?.action).toEqual({
      type: 'openModal',
      target: 'b',
      title: '详情',
    })
  })

  it('互斥组里目标全出局的那组丢掉，组全没了整条丢', () => {
    const draft = buildClipboardPayload(nodes, ['a', 'b'], NEVER_REGION, [
      {
        id: 'r-1',
        source: { nodeId: 'a', event: 'select' },
        action: {
          type: 'setActive',
          groups: [
            { value: 'x', targets: ['b'] },
            { value: 'y', targets: ['out'] },
          ],
        },
      },
      {
        id: 'r-2',
        source: { nodeId: 'a', event: 'select' },
        action: {
          type: 'setActive',
          groups: [{ value: 'z', targets: ['out'] }],
        },
      },
    ])
    expect(draft?.payload.rules).toHaveLength(1)
    expect(draft?.payload.rules[0]?.action).toEqual({
      type: 'setActive',
      groups: [{ value: 'x', targets: ['b'] }],
    })
    expect(draft?.droppedRules).toBe(1)
  })
})

describe('读写通道', () => {
  it('写入后可读回，且复制会把粘贴偏移归零', () => {
    const draft = buildClipboardPayload(
      [node('a', null)],
      ['a'],
      NEVER_REGION,
      [],
    )
    expect(draft).not.toBeNull()
    if (draft === null) return
    writeClipboard(draft.payload)
    expect(nextPasteOffset()).toBe(16)
    expect(nextPasteOffset()).toBe(32)
    writeClipboard(draft.payload)
    expect(nextPasteOffset()).toBe(16)
    expect(readClipboard()?.nodes).toHaveLength(1)
  })

  it('别的标签页后来复制的那份更新，就换成它并把偏移归零', () => {
    const mine = buildClipboardPayload(
      [node('a', null)],
      ['a'],
      NEVER_REGION,
      [],
    )
    if (mine === null) return
    writeClipboard(mine.payload)
    expect(nextPasteOffset()).toBe(16)
    // 另一个标签页写的：同一个 key，时刻更晚
    const newer: ClipboardPayload = {
      ...mine.payload,
      stampMs: mine.payload.stampMs + 1,
      nodes: [...mine.payload.nodes, ...mine.payload.nodes],
    }
    localStorage.setItem('dt.editor.clipboard', JSON.stringify(newer))
    expect(readClipboard()?.nodes).toHaveLength(2)
    expect(nextPasteOffset()).toBe(16)
  })

  it('localStorage 里那份更旧时不换，内存里的仍然算数', () => {
    const mine = buildClipboardPayload(
      [node('a', null)],
      ['a'],
      NEVER_REGION,
      [],
    )
    if (mine === null) return
    writeClipboard(mine.payload)
    localStorage.setItem(
      'dt.editor.clipboard',
      JSON.stringify({
        ...mine.payload,
        stampMs: mine.payload.stampMs - 1,
        nodes: [...mine.payload.nodes, ...mine.payload.nodes],
      }),
    )
    expect(readClipboard()?.nodes).toHaveLength(1)
  })

  it('localStorage 里的脏数据读出来是 null 而不是崩', () => {
    localStorage.setItem('dt.editor.clipboard', '{"version":9,"nodes":[]}')
    expect(readClipboard()).toBeNull()
    localStorage.setItem('dt.editor.clipboard', 'not-json')
    expect(readClipboard()).toBeNull()
  })
})

describe('粘贴', () => {
  it('全部重发 id、子树结构保住、根落到目标层并加偏移', () => {
    const source = [node('a', null), node('a1', 'a', 'text-block', 3)]
    const draft = buildClipboardPayload(source, ['a'], NEVER_REGION, [])
    expect(draft).not.toBeNull()
    if (draft === null) return
    const result = pasteNodes({
      nodes: source,
      payload: draft.payload,
      dashboardId: 'd-1',
      targetParentId: null,
      offset: 16,
      zIndexStart: 7,
    })
    expect(result.nodes).toHaveLength(4)
    const pastedRootId = result.pastedIds[0]
    const pastedRoot = result.nodes.find((item) => item.id === pastedRootId)
    expect(pastedRoot).toBeDefined()
    expect(pastedRoot?.id).not.toBe('a')
    expect(pastedRoot?.x).toBe(26)
    expect(pastedRoot?.zIndex).toBe(7)
    const pastedChild = result.nodes.find(
      (item) => item.parentId === pastedRootId,
    )
    expect(pastedChild).toBeDefined()
    expect(pastedChild?.id).not.toBe('a1')
    // 子节点坐标不吃偏移：它是原层局部值，跟着根走
    expect(pastedChild?.x).toBe(10)
  })

  it('粘到另一张大屏时节点认新大屏，规则按新 id 重映射并重发规则 id', () => {
    const source = [node('a', null), node('b', null)]
    const draft = buildClipboardPayload(source, ['a', 'b'], NEVER_REGION, [
      showRule('r-1', 'a', ['b']),
    ])
    if (draft === null) return
    const result = pasteNodes({
      nodes: [],
      payload: draft.payload,
      dashboardId: 'd-2',
      targetParentId: null,
      offset: 16,
      zIndexStart: 0,
    })
    expect(result.nodes.every((item) => item.dashboardId === 'd-2')).toBe(true)
    expect(result.rules).toHaveLength(1)
    const rule = result.rules[0]
    expect(rule?.id).not.toBe('r-1')
    expect(rule?.source.nodeId).toBe(result.pastedIds[0])
    expect(rule?.action).toEqual({
      type: 'show',
      targets: [result.pastedIds[1]],
    })
  })

  it('绑定也重发 id 并挂到新节点上', () => {
    const source: DashboardNodePayload[] = [
      {
        ...node('a', null),
        bindings: [
          {
            id: 'b-1',
            nodeId: 'a',
            fieldKey: 'value',
            sourceKind: 'static',
            nodeKey: null,
            staticValueJson: 42,
            computeJson: null,
            detailJson: null,
            transformJson: null,
            createdAt: '2026-08-14T00:00:00Z',
            updatedAt: '2026-08-14T00:00:00Z',
          },
        ],
      },
    ]
    const draft = buildClipboardPayload(source, ['a'], NEVER_REGION, [])
    expect(draft).not.toBeNull()
    if (draft === null) return
    const result = pasteNodes({
      nodes: source,
      payload: draft.payload,
      dashboardId: 'd-1',
      targetParentId: null,
      offset: 16,
      zIndexStart: 1,
    })
    const pasted = result.nodes.find((item) => item.id === result.pastedIds[0])
    expect(pasted?.bindings).toHaveLength(1)
    expect(pasted?.bindings[0]?.id).not.toBe('b-1')
    expect(pasted?.bindings[0]?.nodeId).toBe(pasted?.id)
    expect(pasted?.bindings[0]?.staticValueJson).toBe(42)
  })
})
