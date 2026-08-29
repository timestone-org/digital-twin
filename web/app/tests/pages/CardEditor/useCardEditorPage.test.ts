/**
 * @fileoverview 契约：自定义卡片页的取数与落库。
 *
 * ⚠ 三条最要紧的：路由参数能在**同一个组件实例**上变（右键菜单反复进出不同节点），
 * 慢的那次后返回不许盖掉新文档；落库走大屏整树替换，同屏其余节点必须原样带回去，
 * 漏一个就是把它删了而界面只说「保存成功」；`expectedVersion` 撞了要落在冲突出口上。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/api/dashboard', async () => {
  const actual =
    await vi.importActual<Record<string, unknown>>('@/api/dashboard')
  return { ...actual, getDashboard: vi.fn(), replaceLayout: vi.fn() }
})

import { BizError } from '@/api/client'
import {
  DASHBOARD_VERSION_CONFLICT_CODE,
  getDashboard,
  replaceLayout,
} from '@/api/dashboard'
import {
  CARD_MISSING_NODE_MESSAGE,
  useCardEditorPage,
} from '@/pages/CardEditor/scripts/useCardEditorPage'

function node(id: string, config: Record<string, unknown> = {}) {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'data-card',
    x: 0,
    y: 0,
    w: 420,
    h: 220,
    zIndex: 0,
    isVisible: true,
    configJson: config,
    createdAt: '',
    updatedAt: '',
    bindings: [],
  } satisfies DashboardNodePayload
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

/** 一个由用例决定何时返回的请求。 */
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
  return useCardEditorPage(
    () => 'd1',
    () => nodeId,
  )
}

beforeEach(() => {
  getMock.mockReset()
  saveMock.mockReset()
})

describe('取数', () => {
  it('取出这个节点，配置原样在手上', async () => {
    getMock.mockResolvedValue(payload([node('n1', { title: '甲' })]))
    const editor = page()

    await editor.load()

    expect(editor.node.value?.id).toBe('n1')
    expect(editor.node.value?.configJson).toEqual({ title: '甲' })
    expect(editor.error.value).toBeNull()
    expect(editor.loading.value).toBe(false)
  })

  // ⚠ 节点不在时不能停在空白页：用户得知道是节点没了，而不是页面坏了
  it('这张屏上没有这个节点时给一句能看的话', async () => {
    getMock.mockResolvedValue(payload([node('other')]))
    const editor = page()

    await editor.load()

    expect(editor.node.value).toBeNull()
    expect(editor.error.value).toBe(CARD_MISSING_NODE_MESSAGE)
  })

  it('取数失败时把错误摆出来，而不是空白页', async () => {
    getMock.mockRejectedValue(new Error('boom'))
    const editor = page()

    await editor.load()

    expect(editor.error.value).not.toBeNull()
    expect(editor.loading.value).toBe(false)
  })

  it('屏 id 还没解析出来时不发请求', async () => {
    const editor = useCardEditorPage(
      () => '',
      () => 'n1',
    )

    await editor.load()

    expect(getMock).not.toHaveBeenCalled()
  })

  // ⚠ 慢的那次后返回会盖掉新文档，且没有任何报错
  it('快速切节点时旧响应不覆盖新文档', async () => {
    const first = deferred()
    const second = deferred()
    getMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const nodeId = ref('n1')
    const editor = useCardEditorPage(
      () => 'd1',
      () => nodeId.value,
    )

    void editor.load()
    nodeId.value = 'n2'
    void editor.load()
    second.settle(
      payload([node('n1', { title: '甲' }), node('n2', { title: '乙' })]),
    )
    await flushPromises()
    first.settle(
      payload([node('n1', { title: '旧' }), node('n2', { title: '旧' })]),
    )
    await flushPromises()

    expect(editor.node.value?.configJson).toEqual({ title: '乙' })
  })

  it('作废之后在飞的那一次回来也不写状态', async () => {
    const first = deferred()
    getMock.mockReturnValueOnce(first.promise)
    const editor = page()

    void editor.load()
    editor.dispose()
    first.settle(payload([node('n1')]))
    await flushPromises()

    expect(editor.node.value).toBeNull()
  })
})

describe('改配置', () => {
  it('只换这个节点的 config，别人一字不动', async () => {
    getMock.mockResolvedValue(
      payload([node('n1', { title: '甲' }), node('n2', { title: '乙' })]),
    )
    const editor = page()
    await editor.load()

    editor.setConfig({ title: '改过了' })

    expect(editor.node.value?.configJson).toEqual({ title: '改过了' })
    expect(editor.isDirty.value).toBe(true)
  })

  it('还没读出来就改，什么都不做', () => {
    const editor = page()

    editor.setConfig({ title: '甲' })

    expect(editor.isDirty.value).toBe(false)
  })

  it('刚读出来时不算脏——用户什么都没动', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    const editor = page()

    await editor.load()

    expect(editor.isDirty.value).toBe(false)
  })
})

describe('落库', () => {
  it('整树替换：同屏其余节点原样带上，且带当前行版本', async () => {
    getMock.mockResolvedValue(payload([node('n1'), node('n2'), node('n3')]))
    saveMock.mockResolvedValue(payload([node('n1'), node('n2'), node('n3')]))
    const editor = page()
    await editor.load()
    editor.setConfig({ title: '改过了' })

    await editor.save()

    const [, input] = saveMock.mock.calls[0] ?? []
    expect(input?.nodes.map((one) => one.id)).toEqual(['n1', 'n2', 'n3'])
    // ⚠ 不带行版本就成了「无条件覆盖」，别人这期间改过的会被静默抹掉
    expect(input?.expectedVersion).toBe(7)
  })

  it('写回的是新配置，别人的 config 原样不动', async () => {
    getMock.mockResolvedValue(
      payload([node('n1'), node('n2', { title: '乙' })]),
    )
    saveMock.mockResolvedValue(payload([node('n1'), node('n2')]))
    const editor = page()
    await editor.load()
    editor.setConfig({ title: '改过了' })

    await editor.save()

    const [, input] = saveMock.mock.calls[0] ?? []
    expect(input?.nodes.find((one) => one.id === 'n1')?.config_json).toEqual({
      title: '改过了',
    })
    expect(input?.nodes.find((one) => one.id === 'n2')?.config_json).toEqual({
      title: '乙',
    })
  })

  it('存成功之后不再脏', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockResolvedValue(payload([node('n1', { title: '改过了' })]))
    const editor = page()
    await editor.load()
    editor.setConfig({ title: '改过了' })

    expect(await editor.save()).toBe(true)
    expect(editor.isDirty.value).toBe(false)
  })

  // ⚠ 存失败还清脏标记的话，用户会以为存上了，然后关掉页面
  it('存失败时返回 false 且仍然脏着', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(new Error('boom'))
    const editor = page()
    await editor.load()
    editor.setConfig({ title: '改过了' })

    expect(await editor.save()).toBe(false)
    expect(editor.isDirty.value).toBe(true)
  })

  it('还没读出来就按保存，什么都不发', async () => {
    const editor = page()

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
    await editor.load()
    editor.setConfig({ title: '改过了' })

    expect(await editor.save()).toBe(false)
    expect(editor.conflict.value).toContain('重新加载')
    expect(editor.isDirty.value).toBe(true)
  })

  it('重新加载清掉冲突提示', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(
      new BizError(DASHBOARD_VERSION_CONFLICT_CODE, '版本旧了', 409, 't1'),
    )
    const editor = page()
    await editor.load()
    editor.setConfig({ title: '改过了' })
    await editor.save()

    await editor.load()

    expect(editor.conflict.value).toBeNull()
    expect(editor.isDirty.value).toBe(false)
  })
})
