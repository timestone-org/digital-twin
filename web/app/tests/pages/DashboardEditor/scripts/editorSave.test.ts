/**
 * @fileoverview 双轴保存的顺序不变量：元数据轴先行、布局轴用推进后的行版本；
 * 只脏一轴就只保存那一轴；任一步失败整体报败且后续不再跑。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DashboardPayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { setVisible } from '@/features/dashboard/editorDoc'
import { saveDashboard } from '@/pages/DashboardEditor/scripts/editorSave'
import { useEditorMeta } from '@/pages/DashboardEditor/scripts/useEditorMeta'
import { nextTick, ref } from 'vue'

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
