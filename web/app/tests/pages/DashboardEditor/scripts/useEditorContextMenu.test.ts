/**
 * @fileoverview 契约：右键菜单的每一项都落到既有动作出口上（层序/剪贴板/删除确认
 * 都不另起一份实现），执行完立刻收起，且置灰判定读的是真实状态而不是写死的常量。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { designSize } from '@dt/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { __resetClipboard } from '@/features/dashboard/editorClipboard'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { useEditorContextMenu } from '@/pages/DashboardEditor/scripts/useEditorContextMenu'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  chrome: 'bare',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  preview: { config: {} },
  component: () => Promise.resolve({ default: { template: '<i />' } }),
}

const getManifest = (): ModuleManifest => MANIFEST
const DESIGN = designSize(1920, 1080)

function node(id: string, over: Partial<DashboardNodePayload> = {}) {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
    ...over,
  }
}

function setup(nodes: DashboardNodePayload[] = [node('a'), node('b')]) {
  const editor = useDashboardEditor(getManifest)
  editor.reset(nodes)
  const shared = { editor, getManifest, dashboardId: () => 'd1' }
  const actions = createEditorActions({ ...shared, design: () => DESIGN })
  const arrange = createArrangeActions({
    ...shared,
    design: () => DESIGN,
    steps: () => ({ x: 10, y: 10 }),
    chrome: {
      rules: computed(() => []),
      setInteractions: vi.fn(),
      setSnap: vi.fn(),
      setGrid: vi.fn(),
    },
    notify: vi.fn(),
  })
  const centerOn = vi.fn()
  const removeSelected = vi.fn()
  const zoom = ref<CanvasZoom>(1)
  const openSubEditor = vi.fn()
  const menu = useEditorContextMenu({
    editor,
    actions,
    arrange,
    getManifest: () => undefined,
    openSubEditor,
    centerOn,
    removeSelected,
    zoom,
  })
  return {
    editor,
    arrange,
    menu,
    centerOn,
    removeSelected,
    zoom,
    openSubEditor,
  }
}

/** 右键点在某个节点上：画布会先把它选中，这里照做。 */
function openOn(
  ctx: ReturnType<typeof setup>,
  nodeId: string | null,
): ReturnType<typeof setup> {
  if (nodeId !== null) ctx.editor.select(nodeId)
  ctx.menu.open({ x: 30, y: 40 }, nodeId)
  return ctx
}

beforeEach(() => {
  __resetClipboard()
})

describe('开合', () => {
  it('没开时状态为空，开了带上落点与目标节点', () => {
    const ctx = setup()
    expect(ctx.menu.state.value).toBeNull()

    openOn(ctx, 'a')

    expect(ctx.menu.state.value?.at).toEqual({ x: 30, y: 40 })
    expect(ctx.menu.state.value?.nodeId).toBe('a')
  })

  it('close 收起', () => {
    const ctx = openOn(setup(), 'a')
    ctx.menu.close()
    expect(ctx.menu.state.value).toBeNull()
  })

  it('执行一项之后立刻收起', () => {
    const ctx = openOn(setup(), 'a')
    ctx.menu.run('front')
    expect(ctx.menu.state.value).toBeNull()
  })
})

describe('每一项落到既有动作上', () => {
  it('置顶 / 置底走排布动作的层序出口', () => {
    const ctx = openOn(setup(), 'a')
    const front = vi.spyOn(ctx.arrange, 'bringSelectedToFront')
    const back = vi.spyOn(ctx.arrange, 'sendSelectedToBack')

    ctx.menu.run('front')
    openOn(ctx, 'a')
    ctx.menu.run('back')

    expect(front).toHaveBeenCalledTimes(1)
    expect(back).toHaveBeenCalledTimes(1)
  })

  it('定位到此节点把落点节点交给画布，不改文档', () => {
    const ctx = openOn(setup(), 'a')

    ctx.menu.run('center')

    expect(ctx.centerOn).toHaveBeenCalledWith('a')
    expect(ctx.editor.isDirty.value).toBe(false)
  })

  it('复制写剪贴板，粘贴据此长出新节点', () => {
    const ctx = openOn(setup(), 'a')
    ctx.menu.run('copy')

    openOn(ctx, null)
    ctx.menu.run('paste')

    expect(ctx.editor.nodes.value).toHaveLength(3)
  })

  it('再制走排布动作的再制出口，不动剪贴板', () => {
    const ctx = openOn(setup(), 'a')
    const duplicate = vi.spyOn(ctx.arrange, 'duplicateSelected')

    ctx.menu.run('duplicate')

    expect(duplicate).toHaveBeenCalledTimes(1)
    expect(ctx.editor.nodes.value).toHaveLength(3)
    expect(ctx.arrange.canPaste()).toBe(false)
  })

  it('空白处菜单的粘贴带落点：包围盒左上角落在指的那个点上，不吃序号偏移', () => {
    const ctx = openOn(setup(), 'a')
    ctx.menu.run('copy')

    ctx.menu.open(
      {
        x: 30,
        y: 40,
        pasteAt: { parentId: null, x: 300, y: 400, layer: DESIGN },
      },
      null,
    )
    ctx.menu.run('paste')

    const pasted = ctx.editor.nodes.value.find(
      (item) => item.id !== 'a' && item.id !== 'b',
    )
    expect(pasted).toMatchObject({ parentId: null, x: 300, y: 400 })
  })

  it('删除走带确认弹窗的那个出口，不直接改文档', () => {
    const ctx = openOn(setup(), 'a')

    ctx.menu.run('remove')

    expect(ctx.removeSelected).toHaveBeenCalledTimes(1)
    expect(ctx.editor.nodes.value).toHaveLength(2)
  })

  it('隐藏本节点只改落点那一个', () => {
    const ctx = openOn(setup(), 'a')

    ctx.menu.run('hide')

    expect(
      ctx.editor.nodes.value.find((item) => item.id === 'a')?.isVisible,
    ).toBe(false)
    expect(
      ctx.editor.nodes.value.find((item) => item.id === 'b')?.isVisible,
    ).toBe(true)
  })

  it('全选选中全部顶层节点', () => {
    const ctx = openOn(setup(), null)

    ctx.menu.run('select-all')

    expect([...ctx.editor.selectedIds.value]).toEqual(['a', 'b'])
  })

  it('适应窗口把缩放档位交还给画布', () => {
    const ctx = openOn(setup(), null)

    ctx.menu.run('fit')

    expect(ctx.zoom.value).toBeNull()
  })
})

describe('置灰读的是真实状态', () => {
  function entryOf(ctx: ReturnType<typeof setup>, action: string) {
    return (ctx.menu.state.value?.groups ?? [])
      .flatMap((group) => group.items)
      .find((item) => item.action === action)
  }

  it('剪贴板空时粘贴置灰，复制过之后可点', () => {
    const ctx = openOn(setup(), null)
    expect(entryOf(ctx, 'paste')?.disabled).toBe(true)

    openOn(ctx, 'a')
    ctx.menu.run('copy')
    openOn(ctx, null)

    expect(entryOf(ctx, 'paste')?.disabled).toBe(false)
  })

  it('一个节点都没有时全选置灰', () => {
    const ctx = openOn(setup([]), null)
    expect(entryOf(ctx, 'select-all')?.disabled).toBe(true)
  })

  it('已经在适应窗口档时适应窗口置灰', () => {
    const ctx = setup()
    ctx.zoom.value = null
    openOn(ctx, null)
    expect(entryOf(ctx, 'fit')?.disabled).toBe(true)
  })

  it('节点已隐藏时给「显示本节点」，点下去把它显示回来', () => {
    const ctx = openOn(setup([node('a', { isVisible: false })]), 'a')
    const entry = entryOf(ctx, 'hide')
    expect(entry?.label).toBe('显示本节点')
    expect(entry?.disabled).toBe(false)

    ctx.menu.run('hide')

    expect(
      ctx.editor.nodes.value.find((item) => item.id === 'a')?.isVisible,
    ).toBe(true)
  })
})

describe('自定义卡片', () => {
  it('点它把落点节点交给子编辑器入口', () => {
    const ctx = openOn(setup(), 'a')

    ctx.menu.run('customize')

    expect(ctx.openSubEditor).toHaveBeenCalledWith('a')
  })

  // ⚠ 空白处右键没有落点节点：不判的话会拿 null 去找节点，界面上只是「点了没反应」
  it('空白处右键点不到它，也不会拿空落点去开', () => {
    const ctx = openOn(setup(), null)

    ctx.menu.run('customize')

    expect(ctx.openSubEditor).not.toHaveBeenCalled()
  })
})
