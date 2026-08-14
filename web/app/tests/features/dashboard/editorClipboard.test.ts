/**
 * @fileoverview 剪贴板契约：祖先被选中时后代不重复入板、钉位单例不入板、
 * 粘贴全量重发 id 并保住子树结构与 z 序、localStorage 兜底防御脏数据。
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { DashboardNodePayload } from '@dt/contracts'

import {
  __resetClipboard,
  buildClipboardPayload,
  nextPasteOffset,
  pasteNodes,
  readClipboard,
  writeClipboard,
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

afterEach(__resetClipboard)

describe('构建 payload', () => {
  it('祖先被选中时后代不单独入板，但整棵子树都在', () => {
    const nodes = [node('a', null), node('a1', 'a'), node('a2', 'a')]
    const payload = buildClipboardPayload(nodes, ['a', 'a1'], NEVER_REGION)
    expect(payload?.nodes.map((item) => item.ck).sort()).toEqual([
      'a',
      'a1',
      'a2',
    ])
    expect(
      payload?.nodes.filter((item) => item.parentCk === null),
    ).toHaveLength(1)
  })

  it('钉位单例不参与复制；全被剔除时给 null', () => {
    const nodes = [node('h', null, 'header')]
    expect(
      buildClipboardPayload(nodes, ['h'], (type) => type === 'header'),
    ).toBeNull()
  })

  it('父在子前，粘贴方按序就能建父引用', () => {
    const nodes = [node('a', null), node('a1', 'a'), node('a11', 'a1')]
    const payload = buildClipboardPayload(nodes, ['a'], NEVER_REGION)
    const order = payload?.nodes.map((item) => item.ck) ?? []
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('a1'))
    expect(order.indexOf('a1')).toBeLessThan(order.indexOf('a11'))
  })
})

describe('读写通道', () => {
  it('写入后可读回，且复制会把粘贴偏移归零', () => {
    const payload = buildClipboardPayload(
      [node('a', null)],
      ['a'],
      NEVER_REGION,
    )
    expect(payload).not.toBeNull()
    if (payload === null) return
    writeClipboard(payload)
    expect(nextPasteOffset()).toBe(16)
    expect(nextPasteOffset()).toBe(32)
    writeClipboard(payload)
    expect(nextPasteOffset()).toBe(16)
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
    const payload = buildClipboardPayload(source, ['a'], NEVER_REGION)
    expect(payload).not.toBeNull()
    if (payload === null) return
    const result = pasteNodes({
      nodes: source,
      payload,
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
    const payload = buildClipboardPayload(source, ['a'], NEVER_REGION)
    expect(payload).not.toBeNull()
    if (payload === null) return
    const result = pasteNodes({
      nodes: source,
      payload,
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
