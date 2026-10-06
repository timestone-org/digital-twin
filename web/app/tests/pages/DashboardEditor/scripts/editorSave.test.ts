/**
 * @fileoverview 双轴保存的顺序不变量：元数据轴先行、布局轴用推进后的行版本；
 * 只脏一轴就只保存那一轴；任一步失败整体报败且后续不再跑。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import type { DashboardPayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { useDashboardDoc } from '@/composables/useDashboardDoc'
import * as dashboardApi from '@/api/dashboard'
import { BizError } from '@/api/client'
import { setVisible } from '@/features/dashboard/editorDoc'
import { saveDashboard } from '@/pages/DashboardEditor/scripts/editorSave'
import { useEditorMeta } from '@/pages/DashboardEditor/scripts/useEditorMeta'
import { defineComponent, h, nextTick, onUnmounted, ref } from 'vue'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function payload(rowVersion: number): DashboardPayload {
  return {
    id: 'd1',
    projectId: 'p1',
    name: '一号屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: '',
    nodes: [
      {
        id: 'n1',
        dashboardId: 'd1',
        parentId: null,
        clientKey: null,
        moduleType: 'demo',
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        zIndex: 0,
        isVisible: true,
        configJson: {},
        createdAt: '',
        updatedAt: '',
        bindings: [],
      },
    ],
  }
}

function setup(rowVersion = 3) {
  const dashboard = ref<DashboardPayload | null>(payload(rowVersion))
  const editor = useDashboardEditor(() => MANIFEST)
  editor.reset(dashboard.value?.nodes ?? [])
  const meta = useEditorMeta(dashboard)
  const saveMeta = vi.fn(() => {
    const next = payload(rowVersion + 1)
    dashboard.value = next
    return Promise.resolve(next)
  })
  const save = vi.fn(() => {
    const current = dashboard.value
    const next = payload((current?.rowVersion ?? 0) + 1)
    dashboard.value = next
    return Promise.resolve(next)
  })
  const file = {
    resourceVersion: 0,
    dashboard,
    loading: ref(false),
    saving: ref(false),
    load: vi.fn(() => Promise.resolve(dashboard.value)),
    dispose: vi.fn(),
    saveMeta,
    save,
    conflict: ref<string | null>(null),
    error: ref<string | null>(null),
  }
  const onFail = vi.fn()
  return { dashboard, editor, meta, file, saveMeta, save, onFail }
}

describe('双轴顺序', () => {
  it('布局保存期间添加模块，响应保留后续草稿且撤销可回到已保存帧', async () => {
    const deps = setup()
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
    const sent = deps.editor.nodes.value
    let finish: (value: DashboardPayload) => void = () => undefined
    deps.save.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const saving = saveDashboard(deps)
    const first = sent[0]
    if (first === undefined) throw new Error('缺少测试节点')
    deps.editor.apply((nodes) => [...nodes, { ...first, id: 'n2' }])
    finish({ ...payload(4), nodes: [...sent] })
    expect(await saving).toBe(true)
    expect(deps.editor.nodes.value.map((node) => node.id)).toEqual(['n1', 'n2'])
    expect(deps.editor.isDirty.value).toBe(true)
    deps.editor.undo()
    expect(deps.editor.isDirty.value).toBe(false)
    deps.editor.redo()
    expect(deps.editor.isDirty.value).toBe(true)
  })

  it('两轴都脏：先元数据后布局，布局用推进后的行版本', async () => {
    const { editor, meta, file, saveMeta, save, onFail } = setup(3)
    meta.setField('name', '改名')
    editor.apply((nodes) => setVisible(nodes, 'n1', false))

    const done = await saveDashboard({
      editor,
      file,
      meta,
      onFail,
    })

    expect(done).toBe(true)
    expect(saveMeta).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledTimes(1)
    // 元数据 PATCH 把 3 推到 4，布局轴必须带 4
    const layoutArgs: readonly unknown[] = save.mock.calls[0] ?? []
    expect(layoutArgs[0]).toMatchObject({ expectedVersion: 4 })
    expect(saveMeta.mock.invocationCallOrder[0]).toBeLessThan(
      save.mock.invocationCallOrder[0] ?? 0,
    )
    expect(meta.isDirty.value).toBe(false)
    expect(editor.isDirty.value).toBe(false)
  })

  it('只脏元数据：布局轴一次都不跑', async () => {
    const { editor, meta, file, saveMeta, save, onFail } = setup(3)
    meta.setField('description', '只是改描述')

    const done = await saveDashboard({
      editor,
      file,
      meta,
      onFail,
    })

    expect(done).toBe(true)
    expect(saveMeta).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
  })

  it('元数据轴失败：整体报败，布局轴不跑', async () => {
    const { editor, meta, file, saveMeta, save, onFail } = setup(3)
    meta.setField('name', '改名')
    editor.apply((nodes) => setVisible(nodes, 'n1', false))
    saveMeta.mockResolvedValueOnce(null as never)

    const done = await saveDashboard({
      editor,
      file,
      meta,
      onFail,
    })

    expect(done).toBe(false)
    expect(onFail).toHaveBeenCalledTimes(1)
    expect(save).not.toHaveBeenCalled()
    // 草稿仍脏，用户没丢改动
    expect(meta.isDirty.value).toBe(true)
  })
})

/** 使用真实文档 IO，仅替换系统 API 边界。 */
async function apiSetup() {
  vi.spyOn(dashboardApi, 'getDashboard').mockResolvedValue(payload(7))
  const file = useDashboardDoc()
  await file.load('d1')
  const editor = useDashboardEditor(() => MANIFEST)
  editor.reset(file.dashboard.value?.nodes ?? [])
  const meta = useEditorMeta(file.dashboard)
  const onFail = vi.fn()
  return { editor, file, meta, onFail }
}

function deferred() {
  let settle: (value: DashboardPayload) => void = () => undefined
  const promise = new Promise<DashboardPayload>((resolve) => {
    settle = resolve
  })
  return { promise, settle }
}

afterEach(() => vi.restoreAllMocks())

describe('保存期间卸载', () => {
  it.each(['success', 'failure'])(
    '元数据迟到%s不回填卸载页也不发起布局轴',
    async (result) => {
      const deps = await apiSetup()
      let finish: (value: DashboardPayload) => void = () => undefined
      let fail: (error: Error) => void = () => undefined
      vi.spyOn(dashboardApi, 'updateDashboard').mockReturnValue(
        new Promise((resolve, reject) => {
          finish = resolve
          fail = reject
        }),
      )
      const replace = vi
        .spyOn(dashboardApi, 'replaceLayout')
        .mockResolvedValue(payload(9))
      const host = mount(
        defineComponent({
          setup() {
            onUnmounted(deps.file.dispose)
            return () => h('div')
          },
        }),
      )
      deps.meta.setField('name', '保存A')
      deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
      const saving = saveDashboard(deps)
      host.unmount()
      const dashboard = deps.file.dashboard.value
      const draft = deps.meta.draft.value
      if (result === 'success') finish({ ...payload(8), name: '保存A' })
      else fail(new Error('旧请求失败'))
      expect(await saving).toBe(false)
      expect(replace).not.toHaveBeenCalled()
      expect(deps.file.dashboard.value).toBe(dashboard)
      expect(deps.meta.draft.value).toBe(draft)
      expect(deps.meta.isDirty.value).toBe(true)
      expect(deps.editor.isDirty.value).toBe(true)
      expect(deps.file.error.value).toBeNull()
      expect(deps.file.saving.value).toBe(false)
    },
  )
})

describe('保存快照与实际 IO', () => {
  it.each(['布局', '元数据'])(
    '同屏重载期间不提交%s，加载结束后使用新行版本保存',
    async (axis) => {
      const deps = await apiSetup()
      if (axis === '布局')
        deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
      else deps.meta.setField('name', '重载前草稿')
      const refreshed = deferred()
      vi.mocked(dashboardApi.getDashboard).mockReturnValueOnce(
        refreshed.promise,
      )
      const patch = vi
        .spyOn(dashboardApi, 'updateDashboard')
        .mockResolvedValue({ ...payload(11), name: '重载后草稿' })
      const replace = vi
        .spyOn(dashboardApi, 'replaceLayout')
        .mockResolvedValue(payload(11))
      const loading = deps.file.load('d1')

      expect(await saveDashboard(deps)).toBe(false)
      expect(patch).not.toHaveBeenCalled()
      expect(replace).not.toHaveBeenCalled()
      expect(deps.file.dashboard.value?.rowVersion).toBe(7)
      expect(deps.file.loading.value).toBe(true)
      expect(deps.onFail).not.toHaveBeenCalled()

      refreshed.settle(payload(10))
      const loaded = await loading
      if (loaded === null) throw new Error('缺少重载结果')
      deps.editor.reset(loaded.nodes)
      deps.meta.reset(loaded)
      if (axis === '布局')
        deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
      else deps.meta.setField('name', '重载后草稿')

      expect(await saveDashboard(deps)).toBe(true)
      expect(deps.file.dashboard.value?.rowVersion).toBe(11)
      if (axis === '布局')
        expect(replace.mock.calls[0]?.[1].expectedVersion).toBe(10)
      else expect(patch.mock.calls[0]?.[1].name).toBe('重载后草稿')
      expect(deps.editor.isDirty.value || deps.meta.isDirty.value).toBe(false)
    },
  )

  it('元数据保存期间换大屏，旧回执不覆盖新元数据也不向新大屏提交旧布局', async () => {
    const deps = await apiSetup()
    deps.meta.setField('name', 'A')
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
    const first = deferred()
    vi.spyOn(dashboardApi, 'updateDashboard').mockReturnValueOnce(first.promise)
    const b = { ...payload(10), id: 'd2', name: 'B' }
    const replace = vi.spyOn(dashboardApi, 'replaceLayout').mockResolvedValue(b)
    const saving = saveDashboard(deps)
    vi.mocked(dashboardApi.getDashboard).mockResolvedValueOnce(b)
    await deps.file.load('d2')
    deps.editor.reset(b.nodes)
    deps.meta.reset(b)
    first.settle({ ...payload(8), name: 'A' })
    expect(await saving).toBe(false)
    expect(replace).not.toHaveBeenCalled()
    expect(deps.file.dashboard.value?.id).toBe('d2')
    expect(deps.meta.draft.value?.name).toBe('B')
    expect(deps.editor.isDirty.value).toBe(false)
  })

  it('元数据请求期间的布局编辑不进入已点击的保存，重复保存不发新请求', async () => {
    const deps = await apiSetup()
    deps.meta.setField('name', '已提交名字')
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false), 'visible')
    const sent = deps.editor.nodes.value
    const metadata = deferred()
    const layout = deferred()
    const patch = vi
      .spyOn(dashboardApi, 'updateDashboard')
      .mockReturnValue(metadata.promise)
    const replace = vi
      .spyOn(dashboardApi, 'replaceLayout')
      .mockReturnValueOnce(layout.promise)
    const saving = saveDashboard(deps)
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', true), 'visible')
    expect(await saveDashboard(deps)).toBe(false)
    expect(patch).toHaveBeenCalledTimes(1)
    deps.meta.setField('name', '后续名字')
    metadata.settle({ ...payload(8), name: '已提交名字' })
    await flushPromises()
    expect(replace.mock.calls[0]?.[1]).toMatchObject({
      expectedVersion: 8,
      nodes: [{ is_visible: false }],
    })
    layout.settle({ ...payload(9), name: '已提交名字', nodes: [...sent] })
    expect(await saving).toBe(true)
    expect(deps.editor.nodes.value[0]?.isVisible).toBe(true)
    expect(deps.editor.isDirty.value).toBe(true)
    expect(deps.meta.draft.value?.name).toBe('后续名字')
    expect(deps.meta.isDirty.value).toBe(true)
    deps.editor.undo()
    expect(deps.editor.isDirty.value).toBe(false)
    deps.editor.redo()
    expect(deps.editor.isDirty.value).toBe(true)
  })

  it('只保存元数据期间新改布局，响应不顺带保存新布局', async () => {
    const deps = await apiSetup()
    deps.meta.setField('description', 'A')
    const first = deferred()
    vi.spyOn(dashboardApi, 'updateDashboard').mockReturnValueOnce(first.promise)
    const replace = vi.spyOn(dashboardApi, 'replaceLayout')
    const saving = saveDashboard(deps)
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
    first.settle({ ...payload(8), description: 'A' })
    expect(await saving).toBe(true)
    expect(replace).not.toHaveBeenCalled()
    expect(deps.editor.isDirty.value).toBe(true)
  })

  it('响应期间撤销已发送编辑，响应不覆盖撤销，重做回到已保存基准', async () => {
    const deps = await apiSetup()
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
    const sent = deps.editor.nodes.value
    const first = deferred()
    vi.spyOn(dashboardApi, 'replaceLayout').mockReturnValueOnce(first.promise)
    const saving = saveDashboard(deps)
    deps.editor.undo()
    first.settle({ ...payload(8), nodes: [...sent] })
    expect(await saving).toBe(true)
    expect(deps.editor.nodes.value[0]?.isVisible).toBe(true)
    expect(deps.editor.isDirty.value).toBe(true)
    deps.editor.redo()
    expect(deps.editor.isDirty.value).toBe(false)
  })

  it.each([
    new BizError(
      dashboardApi.DASHBOARD_VERSION_CONFLICT_CODE,
      '旧版本',
      409,
      'test',
    ),
    new Error('服务不可用'),
  ])('失败及409保留请求后的草稿，不重试且仍可撤销重做：%s', async (failure) => {
    const deps = await apiSetup()
    deps.editor.apply((nodes) => setVisible(nodes, 'n1', false))
    let reject: (error: unknown) => void = () => undefined
    const replace = vi.spyOn(dashboardApi, 'replaceLayout').mockReturnValueOnce(
      new Promise((_resolve, fail) => {
        reject = fail
      }),
    )
    const saving = saveDashboard(deps)
    deps.editor.apply((nodes) => nodes.map((node) => ({ ...node, x: 50 })))
    reject(failure)
    expect(await saving).toBe(false)
    expect(replace).toHaveBeenCalledTimes(1)
    expect(deps.onFail).toHaveBeenCalledTimes(1)
    expect(deps.editor.nodes.value[0]?.x).toBe(50)
    expect(deps.editor.isDirty.value).toBe(true)
    expect(deps.file.saving.value).toBe(false)
    expect(deps.file.conflict.value ?? deps.file.error.value).toBeTruthy()
    deps.editor.undo()
    expect(deps.editor.nodes.value[0]?.isVisible).toBe(false)
    expect(deps.editor.isDirty.value).toBe(true)
    deps.editor.redo()
    expect(deps.editor.nodes.value[0]?.x).toBe(50)
  })
})

describe('元数据草稿', () => {
  it('保存回包保留请求期间新选的主题，并推进已保存基线', async () => {
    const { editor, meta, file, saveMeta, onFail } = setup()
    let finish: (value: DashboardPayload) => void = () => undefined
    const response = new Promise<DashboardPayload>((resolve) => {
      finish = resolve
    })
    saveMeta.mockReturnValueOnce(response)
    meta.setTheme('light')

    const saving = saveDashboard({ editor, file, meta, onFail })
    meta.setTheme('emerald')
    finish({ ...payload(4), themeJson: { __base: 'light' } })

    expect(await saving).toBe(true)
    expect(meta.draft.value?.themeJson).toEqual({ __base: 'emerald' })
    expect(meta.isDirty.value).toBe(true)
    expect(meta.toPatch()?.themeJson).toEqual({ __base: 'emerald' })
    meta.setTheme('light')
    expect(meta.isDirty.value).toBe(false)
    expect(meta.toPatch()).toBeNull()
  })

  it('保存期间改回原主题，回包后相对于新基线仍然未保存', async () => {
    const { editor, meta, file, saveMeta, onFail } = setup()
    let finish: (value: DashboardPayload) => void = () => undefined
    const response = new Promise<DashboardPayload>((resolve) => {
      finish = resolve
    })
    saveMeta.mockReturnValueOnce(response)
    meta.setTheme('light')

    const saving = saveDashboard({ editor, file, meta, onFail })
    meta.setTheme(null)
    expect(meta.isDirty.value).toBe(false)
    finish({ ...payload(4), themeJson: { __base: 'light' } })

    expect(await saving).toBe(true)
    expect(meta.draft.value?.themeJson).toEqual({})
    expect(meta.isDirty.value).toBe(true)
    expect(meta.toPatch()?.themeJson).toEqual({})
  })

  it('未设置主题时跟随系统，选择后写入主题袋并标记为未保存', () => {
    const { meta } = setup()

    expect(meta.draft.value?.themeJson).toEqual({})
    expect(meta.isDirty.value).toBe(false)
    meta.setTheme('light')

    expect(meta.toPatch()?.themeJson).toEqual({ __base: 'light' })
    expect(meta.isDirty.value).toBe(true)
    meta.setTheme(null)
    expect(meta.toPatch()).toBeNull()
    expect(meta.isDirty.value).toBe(false)
  })

  it('切换或恢复跟随系统只改 __base，保留主题袋的其它字段', () => {
    const { meta } = setup()
    const saved = {
      ...payload(3),
      themeJson: { __base: 'light', custom: { accent: 'kept' } },
    }
    meta.reset(saved)

    meta.setTheme('dark-tech')
    expect(meta.toPatch()?.themeJson).toEqual({
      __base: 'dark-tech',
      custom: { accent: 'kept' },
    })
    meta.setTheme(null)
    expect(meta.toPatch()?.themeJson).toEqual({ custom: { accent: 'kept' } })
    expect(saved.themeJson.__base).toBe('light')

    meta.setTheme('light')
    expect(meta.isDirty.value).toBe(false)
    expect(meta.toPatch()).toBeNull()
  })

  it('只改主题时通过元数据轴保存，成功后清除脏状态并可重新打开', async () => {
    const { editor, meta, file, saveMeta, save, onFail } = setup()
    const saved = { ...payload(4), themeJson: { __base: 'light' } }
    saveMeta.mockResolvedValueOnce(saved)
    meta.setTheme('light')

    const done = await saveDashboard({
      editor,
      file,
      meta,
      onFail,
    })

    expect(done).toBe(true)
    expect(saveMeta).toHaveBeenCalledWith(
      expect.objectContaining({ themeJson: { __base: 'light' } }),
    )
    expect(save).not.toHaveBeenCalled()
    expect(meta.isDirty.value).toBe(false)
    expect(meta.draft.value?.themeJson).toEqual({ __base: 'light' })
    const reopened = useEditorMeta(ref(saved))
    expect(reopened.draft.value?.themeJson).toEqual({ __base: 'light' })
    expect(reopened.toPatch()).toBeNull()
  })

  it('重置与切换大屏各自重播主题，未加载时写入安全无操作', async () => {
    const { meta, dashboard } = setup()
    meta.setTheme('light')
    meta.reset(payload(3))
    expect(meta.draft.value?.themeJson).toEqual({})
    expect(meta.isDirty.value).toBe(false)

    dashboard.value = {
      ...payload(1),
      id: 'd2',
      themeJson: { __base: 'dark-tech' },
    }
    await nextTick()
    expect(meta.draft.value?.themeJson).toEqual({ __base: 'dark-tech' })
    dashboard.value = null
    await nextTick()
    meta.setTheme('light')
    meta.setThemeJson({ __base: 'light' })
    expect(meta.draft.value).toBeNull()
    expect(meta.toPatch()).toBeNull()
  })

  it('保存后布局轴换载荷不冲掉未保存的元数据编辑', async () => {
    const { dashboard, meta } = setup(3)
    meta.setField('name', '没保存的新名字')
    meta.setTheme('light')

    // 布局轴保存推进行版本（id 不变）
    dashboard.value = payload(4)
    await Promise.resolve()

    expect(meta.draft.value?.name).toBe('没保存的新名字')
    expect(meta.draft.value?.themeJson).toEqual({ __base: 'light' })
    expect(meta.isDirty.value).toBe(true)
  })

  it('setChromeSection 整段替换与删段', () => {
    const { meta } = setup(3)
    meta.setChromeSection('card', { bg: 'var(--surface-panel)' })
    expect(meta.draft.value?.chromeJson.card).toEqual({
      bg: 'var(--surface-panel)',
    })

    meta.setChromeSection('card', undefined)
    expect('card' in (meta.draft.value?.chromeJson ?? {})).toBe(false)
  })
})
