/**
 * @fileoverview 契约：一页的取数与落库。
 *
 * ⚠ 三条最要紧的：路由参数能在同一个组件实例上变，慢的那次后返回**不许**盖掉新
 * 文档（§13.5）；落库走大屏整树替换，同屏其余节点必须原样带回去，漏一个就是把它
 * 删了；`expectedVersion` 撞了要落在冲突出口上，绝不静默覆盖。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { TWIN_2D_CONFIG_KEY, TWIN_2D_DEFAULT_CANVAS_HEIGHT } from '@dt/twin2d'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

vi.mock('@/api/dashboard', async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>('@/api/dashboard')
  return { ...actual, getDashboard: vi.fn(), replaceLayout: vi.fn() }
})

import {
  DASHBOARD_VERSION_CONFLICT_CODE,
  getDashboard,
  replaceLayout,
} from '@/api/dashboard'
import { BizError } from '@/api/client'
import { useTwin2dEditorPage } from '@/pages/Twin2dEditor/scripts/useTwin2dEditorPage'

function node(id: string, twin2d?: unknown): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'twin-2d-view',
    x: 0,
    y: 0,
    w: 640,
    h: 360,
    zIndex: 0,
    isVisible: true,
    configJson: twin2d === undefined ? {} : { [TWIN_2D_CONFIG_KEY]: twin2d },
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function payload(nodes: DashboardNodePayload[]): DashboardPayload {
  return {
    id: 'd1',
    projectId: 'p1',
    name: '一号屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    rowVersion: 7,
    schemaVersion: 1,
    isPublic: false,
    chromeJson: {},
    themeJson: {},
    createdAt: '',
    updatedAt: '',
    nodes,
  }
}

/** 一个可以由用例决定何时返回的请求。 */
function deferred(): {
  promise: Promise<DashboardPayload>
  settle: (value: DashboardPayload) => void
} {
  let settle: (value: DashboardPayload) => void = () => undefined
  const promise = new Promise<DashboardPayload>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

const getMock = vi.mocked(getDashboard)
const saveMock = vi.mocked(replaceLayout)

function page(nodeId = 'n1') {
  return useTwin2dEditorPage(
    () => 'd1',
    () => nodeId,
  )
}

beforeEach(() => {
  getMock.mockReset()
  saveMock.mockReset()
})

describe('取数', () => {
  it('取出节点上那段 2D 孪生配置并归一化', async () => {
    getMock.mockResolvedValue(
      payload([node('n1', { canvas: { width: 900 }, nodes: [{ id: 'a' }] })]),
    )
    const editor = page()

    await flushPromises()

    expect(editor.doc.value?.config.value.canvas.width).toBe(900)
    // 归一化补齐的缺省也在
    expect(editor.doc.value?.config.value.canvas.height).toBe(
      TWIN_2D_DEFAULT_CANVAS_HEIGHT,
    )
  })

  it('节点上没配过时给一份空配置，不报错', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    const editor = page()

    await flushPromises()

    expect(editor.doc.value).not.toBeNull()
    expect(editor.doc.value?.config.value.nodes).toEqual([])
    expect(editor.error.value).toBeNull()
  })

  // ⚠ 节点不在时不能停在空白页：用户得知道是节点没了，而不是页面坏了
  it('这张屏上没有这个节点时给一句能看的话', async () => {
    getMock.mockResolvedValue(payload([node('other')]))
    const editor = page()

    await flushPromises()

    expect(editor.doc.value).toBeNull()
    expect(editor.error.value).toContain('没有这个节点')
  })

  it('取数失败时把错误摆出来，而不是空白页', async () => {
    getMock.mockRejectedValue(new Error('boom'))
    const editor = page()

    await flushPromises()

    expect(editor.error.value).not.toBeNull()
    expect(editor.dashboard.value).toBeNull()
    expect(editor.loading.value).toBe(false)
  })

  it('节点在大屏上的占位尺寸跟着节点走', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    const editor = page()

    await flushPromises()

    expect(editor.targetSize.value).toEqual({ width: 640, height: 360 })
  })

  it('还没读出来时没有占位尺寸', () => {
    getMock.mockResolvedValue(payload([node('n1')]))

    expect(page().targetSize.value).toBeUndefined()
  })
})

describe('切节点', () => {
  // ⚠ §13.5 点名的那条：慢的那次后返回会盖掉新文档，且没有任何报错
  it('快速切 nodeId 时旧响应不覆盖新文档', async () => {
    const first = deferred()
    const second = deferred()
    getMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const nodeId = ref('n1')
    const editor = useTwin2dEditorPage(
      () => 'd1',
      () => nodeId.value,
    )

    nodeId.value = 'n2'
    await nextTick()
    second.settle(
      payload([
        node('n1', { canvas: { width: 300 } }),
        node('n2', { canvas: { width: 900 } }),
      ]),
    )
    await flushPromises()
    first.settle(
      payload([
        node('n1', { canvas: { width: 300 } }),
        node('n2', { canvas: { width: 900 } }),
      ]),
    )
    await flushPromises()

    expect(editor.node.value?.id).toBe('n2')
    expect(editor.doc.value?.config.value.canvas.width).toBe(900)
  })

  it('切了节点就整份重建文档态，撤销栈不跨节点', async () => {
    getMock.mockResolvedValue(
      payload([node('n1', { canvas: { width: 300 } }), node('n2')]),
    )
    const nodeId = ref('n1')
    const editor = useTwin2dEditorPage(
      () => 'd1',
      () => nodeId.value,
    )
    await flushPromises()
    const before = editor.doc.value
    before?.commit({ ...before.config.value, nodes: [] })

    nodeId.value = 'n2'
    await nextTick()
    await flushPromises()

    expect(editor.doc.value).not.toBe(before)
    expect(editor.doc.value?.canUndo.value).toBe(false)
  })

  it('作废之后在飞的那一次回来也不写状态', async () => {
    const first = deferred()
    getMock.mockReturnValueOnce(first.promise)
    const editor = page()

    editor.dispose()
    first.settle(payload([node('n1')]))
    await flushPromises()

    expect(editor.doc.value).toBeNull()
  })
})

describe('落库', () => {
  it('把改动写回这个节点，其余节点原样带上', async () => {
    getMock.mockResolvedValue(payload([node('n1'), node('n2'), node('n3')]))
    saveMock.mockResolvedValue(payload([node('n1'), node('n2'), node('n3')]))
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...doc.config.value, marks: [] })

    await editor.save()

    const [, input] = saveMock.mock.calls[0] ?? []
    expect(input?.nodes.map((item) => item.id)).toEqual(['n1', 'n2', 'n3'])
    expect(input?.expectedVersion).toBe(7)
  })

  it('写回的那个节点上带着新配置，别人的 config 原样不动', async () => {
    getMock.mockResolvedValue(
      payload([node('n1'), node('n2', { canvas: { width: 300 } })]),
    )
    saveMock.mockResolvedValue(payload([node('n1'), node('n2')]))
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), version: 1, marks: [] })

    await editor.save()

    const [, input] = saveMock.mock.calls[0] ?? []
    const others = input?.nodes.find((item) => item.id === 'n2')
    expect(others?.config_json).toEqual({
      [TWIN_2D_CONFIG_KEY]: { canvas: { width: 300 } },
    })
  })

  it('存成功之后不再脏', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockResolvedValue(payload([node('n1')]))
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), marks: [] })

    const ok = await editor.save()

    expect(ok).toBe(true)
    expect(doc?.isDirty.value).toBe(false)
  })

  // ⚠ 存失败还清脏标记的话，用户会以为存上了，然后关掉页面
  it('存失败时返回 false 且仍然脏着', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(new Error('boom'))
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), marks: [] })

    const ok = await editor.save()

    expect(ok).toBe(false)
    expect(doc?.isDirty.value).toBe(true)
  })

  it('还没读出来就按保存，什么都不发', async () => {
    getMock.mockResolvedValue(payload([node('other')]))
    const editor = page()
    await flushPromises()

    expect(await editor.save()).toBe(false)
    expect(saveMock).not.toHaveBeenCalled()
  })
})

describe('版本冲突', () => {
  it('版本撞了落在冲突出口上，不静默覆盖', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(
      new BizError(DASHBOARD_VERSION_CONFLICT_CODE, '版本旧了', 409, 't1'),
    )
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), marks: [] })

    const ok = await editor.save()

    expect(ok).toBe(false)
    expect(editor.conflict.value).toContain('重新加载')
    expect(doc?.isDirty.value).toBe(true)
  })

  it('重新加载清掉冲突提示并换一份干净文档', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(
      new BizError(DASHBOARD_VERSION_CONFLICT_CODE, '版本旧了', 409, 't1'),
    )
    const editor = page()
    await flushPromises()
    const doc = editor.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), marks: [] })
    await editor.save()

    await editor.reload()

    expect(editor.conflict.value).toBeNull()
    expect(editor.doc.value?.isDirty.value).toBe(false)
    expect(getMock).toHaveBeenCalledTimes(2)
  })
})
