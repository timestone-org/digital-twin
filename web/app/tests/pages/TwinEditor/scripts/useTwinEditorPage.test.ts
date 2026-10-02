/**
 * @fileoverview 一页的取数与落库。
 *
 * ⚠ 落库走的是大屏整树替换，不是只存这一个节点——同屏其余节点必须原样带回去，
 * 漏一个就是把它删了，而界面上只会显示「保存成功」。
 */
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { removeMissingAnimations } from '@/pages/TwinEditor/scripts/missingAnimations'
import { TWIN_CONFIG_KEY, normalizeTwinConfig } from '@dt/twin-config'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/dashboard', () => ({
  getDashboard: vi.fn(),
  replaceLayout: vi.fn(),
}))

import { getDashboard, replaceLayout } from '@/api/dashboard'
import { createBinding } from '@/features/dashboard/editorDoc'
import { useTwinEditorPage } from '@/pages/TwinEditor/scripts/useTwinEditorPage'

function node(id: string, twin?: unknown): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'twin-view',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: twin === undefined ? {} : { [TWIN_CONFIG_KEY]: twin },
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

const getMock = vi.mocked(getDashboard)
const saveMock = vi.mocked(replaceLayout)

beforeEach(() => {
  getMock.mockReset()
  saveMock.mockReset()
})

describe('取数', () => {
  it('取出节点上那段孪生配置并归一化', async () => {
    getMock.mockResolvedValue(
      payload([node('n1', { anchors: [{ id: 'a1' }] })]),
    )
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )

    await flushPromises()

    expect(page.doc.value?.config.value.anchors).toHaveLength(1)
    // 归一化补齐的缺省也在
    expect(page.doc.value?.config.value.anchors[0]?.visibility.visible).toBe(
      true,
    )
  })

  it('节点上没配过孪生时给一份空配置，不报错', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )

    await flushPromises()

    expect(page.doc.value).not.toBeNull()
    expect(page.doc.value?.config.value.anchors).toEqual([])
  })

  // ⚠ 节点不在时不能停在空白页：用户得知道是节点没了，而不是页面坏了
  it('这张屏上没有这个节点时给一句能看的话', async () => {
    getMock.mockResolvedValue(payload([node('other')]))
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )

    await flushPromises()

    expect(page.doc.value).toBeNull()
    expect(page.error.value).toContain('没有这个节点')
  })
})

describe('落库', () => {
  it.each(['config', 'binding', 'undo'] as const)(
    '保存等待期间的 %s 操作不会被标记为已保存',
    async (operation) => {
      getMock.mockResolvedValue(payload([node('n1')]))
      let finishSave: (value: DashboardPayload) => void = () => {
        throw new Error('保存尚未发起')
      }
      saveMock.mockImplementation(
        () => new Promise((resolve) => (finishSave = resolve)),
      )
      const page = useTwinEditorPage(
        () => 'd1',
        () => 'n1',
      )
      await flushPromises()
      const doc = page.doc.value
      if (doc === null) throw new Error('文档未加载')
      const sent = normalizeTwinConfig({ anchors: [{ id: 'sent' }] })
      doc.commitMerged(sent, 'gizmo')
      const pending = page.save()

      if (operation === 'config') {
        doc.commitMerged(
          normalizeTwinConfig({ anchors: [{ id: 'later' }] }),
          'gizmo',
        )
      } else if (operation === 'binding') {
        doc.commitBindings([
          {
            ...createBinding('n1', 'anchorValues[0].value'),
            staticValueJson: 42,
          },
        ])
      } else {
        doc.undo()
      }
      finishSave(payload([node('n1', sent)]))

      expect(await pending).toBe(true)
      const [, input] = saveMock.mock.calls[0] ?? []
      expect(input?.nodes[0]?.config_json[TWIN_CONFIG_KEY]).toMatchObject({
        anchors: [{ id: 'sent' }],
      })
      expect(doc.isDirty.value).toBe(true)
      if (operation === 'binding') expect(doc.bindings.value).toHaveLength(1)
      if (operation === 'undo') doc.redo()
      else doc.undo()
      expect(doc.config.value).toBe(sent)
      expect(doc.bindings.value).toEqual([])
      expect(doc.isDirty.value).toBe(false)
    },
  )

  it('把改动写回这个节点，其余节点原样带上', async () => {
    getMock.mockResolvedValue(payload([node('n1'), node('n2')]))
    saveMock.mockResolvedValue(payload([node('n1'), node('n2')]))
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )
    await flushPromises()

    const doc = page.doc.value
    expect(doc).not.toBeNull()
    doc?.commit({ ...doc.config.value, parts: [] })
    await page.save()

    const [, input] = saveMock.mock.calls[0] ?? []
    expect(input?.nodes.map((item) => item.id)).toEqual(['n1', 'n2'])
    expect(input?.expectedVersion).toBe(7)
  })

  it('存成功之后不再脏', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockResolvedValue(payload([node('n1')]))
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )
    await flushPromises()
    const doc = page.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), parts: [] })

    const ok = await page.save()

    expect(ok).toBe(true)
    expect(doc?.isDirty.value).toBe(false)
  })

  // ⚠ 存失败还清脏标记的话，用户会以为存上了，然后关掉页面
  it('存失败时返回 false 且仍然脏着', async () => {
    getMock.mockResolvedValue(payload([node('n1')]))
    saveMock.mockRejectedValue(new Error('boom'))
    const page = useTwinEditorPage(
      () => 'd1',
      () => 'n1',
    )
    await flushPromises()
    const doc = page.doc.value
    doc?.commit({ ...(doc?.config.value ?? {}), parts: [] })

    const ok = await page.save()

    expect(ok).toBe(false)
    expect(doc?.isDirty.value).toBe(true)
  })
})

it('保存入口先清理缺失动画，实际请求携带清理后的配置', async () => {
  getMock.mockResolvedValue(
    payload([
      node('n1', { model: { animations: { controls: [{ clip: 'gone' }] } } }),
    ]),
  )
  saveMock.mockResolvedValue(payload([node('n1')]))
  const page = useTwinEditorPage(
    () => 'd1',
    () => 'n1',
    (doc) => {
      doc.commit(removeMissingAnimations(doc.config.value, new Set(['gone'])))
    },
  )
  await flushPromises()
  expect(page.doc.value?.config.value.model.animations.controls).toHaveLength(1)
  expect(saveMock).not.toHaveBeenCalled()
  expect(await page.save()).toBe(true)
  const [, input] = saveMock.mock.calls[0] ?? []
  expect(input?.nodes[0]?.config_json[TWIN_CONFIG_KEY]).toMatchObject({
    model: { animations: { controls: [] } },
  })
  expect(page.doc.value?.isDirty.value).toBe(false)
})
