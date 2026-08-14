/**
 * @fileoverview 双轴保存的顺序不变量：元数据轴先行、布局轴用推进后的行版本；
 * 只脏一轴就只保存那一轴；任一步失败整体报败且后续不再跑。
 */
import { describe, expect, it, vi } from 'vitest'
import type { DashboardPayload, ModuleManifest } from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { setVisible } from '@/features/dashboard/editorDoc'
import { saveDashboard } from '@/pages/DashboardEditor/editorSave'
import { useEditorMeta } from '@/pages/DashboardEditor/useEditorMeta'
import { ref } from 'vue'

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
    publicToken: null,
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
    saveMeta,
    save,
    conflict: ref<string | null>(null),
    error: ref<string | null>(null),
  }
  const onFail = vi.fn()
  return { dashboard, editor, meta, file, saveMeta, save, onFail }
}

type FileArg = Parameters<typeof saveDashboard>[0]['file']

describe('双轴顺序', () => {
  it('两轴都脏：先元数据后布局，布局用推进后的行版本', async () => {
    const { editor, meta, file, saveMeta, save, onFail } = setup(3)
    meta.setField('name', '改名')
    editor.apply((nodes) => setVisible(nodes, 'n1', false))

    const done = await saveDashboard({
      editor,
      file: file as unknown as FileArg,
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
      file: file as unknown as FileArg,
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
      file: file as unknown as FileArg,
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
  it('保存后布局轴换载荷不冲掉未保存的元数据编辑', async () => {
    const { dashboard, meta } = setup(3)
    meta.setField('name', '没保存的新名字')

    // 布局轴保存推进行版本（id 不变）
    dashboard.value = payload(4)
    await Promise.resolve()

    expect(meta.draft.value?.name).toBe('没保存的新名字')
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
