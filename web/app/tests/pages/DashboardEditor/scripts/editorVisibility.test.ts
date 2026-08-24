/**
 * @fileoverview 大屏编辑画布临时显隐的契约：图层眼睛不读取、也不回写节点的
 * 运行时初始显隐。
 */
import type { DashboardNodePayload } from '@dt/contracts'
import { describe, expect, it } from 'vitest'

import {
  toggleEditorNodeVisibility,
  withEditorNodeVisibility,
} from '@/pages/DashboardEditor/scripts/editorVisibility'

function node(id: string, isVisible: boolean): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

describe('图层编辑态显隐', () => {
  it('进入编辑器时全部显示，不受初始可见影响', () => {
    const nodes = [node('hidden-at-runtime', false)]

    const editing = withEditorNodeVisibility(nodes, new Set())

    expect(editing[0]?.isVisible).toBe(true)
    expect(nodes[0]?.isVisible).toBe(false)
  })

  it('点图层眼睛只隐藏目标，不改持久化节点', () => {
    const nodes = [node('a', true), node('b', false)]
    const hidden = toggleEditorNodeVisibility(new Set(), 'a')

    const editing = withEditorNodeVisibility(nodes, hidden)

    expect(editing.map((item) => item.isVisible)).toEqual([false, true])
    expect(nodes.map((item) => item.isVisible)).toEqual([true, false])
  })

  it('再点一次恢复编辑态显示', () => {
    const hidden = toggleEditorNodeVisibility(
      toggleEditorNodeVisibility(new Set(), 'a'),
      'a',
    )

    expect(hidden.size).toBe(0)
  })
})
