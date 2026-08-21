/**
 * @fileoverview 契约：本地草稿 v2 带版本号与元数据轴；版本不符（含旧版无版本号）、
 * 形状不符、基于的服务端版本已过期，读取时一律不认并顺手清掉——
 * 旧草稿盖上去等于把别处保存的改动退回去。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DashboardNodePayload } from '@dt/contracts'

import {
  clearDraft,
  readDraft,
  writeDraft,
} from '@/pages/DashboardEditor/scripts/editorDraft'
import type { EditorMetaDraft } from '@/pages/DashboardEditor/scripts/useEditorMeta'

const KEY = 'dt.editor.draft.db1'

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'db1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function meta(over: Partial<EditorMetaDraft> = {}): EditorMetaDraft {
  return {
    name: '一号大屏',
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    chromeJson: { editor: { snap: { mode: 'px' } } },
    ...over,
  }
}

afterEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('写读往返', () => {
  it('v2 草稿带版本号、基版本、节点与元数据，原样读回', () => {
    writeDraft('db1', 'v-2026', [node('a')], meta())

    const draft = readDraft('db1', 'v-2026')

    expect(draft?.version).toBe(2)
    expect(draft?.basedOnUpdatedAt).toBe('v-2026')
    expect(draft?.nodes.map((item) => item.id)).toEqual(['a'])
    expect(draft?.meta).toEqual(meta())
  })

  it('元数据还没加载出来时草稿的 meta 为 null，读回也认', () => {
    writeDraft('db1', 'v-2026', [node('a')], null)

    expect(readDraft('db1', 'v-2026')?.meta).toBeNull()
  })

  it('没写过草稿时读到 null', () => {
    expect(readDraft('db1', 'v-2026')).toBeNull()
  })

  it('clearDraft 之后读不到', () => {
    writeDraft('db1', 'v-2026', [node('a')], null)
    clearDraft('db1')

    expect(readDraft('db1', 'v-2026')).toBeNull()
  })
})

describe('失效即清', () => {
  it('旧版无版本号的草稿（丢元数据轴的那一代）不认并清掉', () => {
    // v1 形状：没有 version 与 meta，只有节点——直接塞进存储模拟存量
    localStorage.setItem(
      KEY,
      JSON.stringify({ basedOnUpdatedAt: 'v-2026', nodes: [node('a')] }),
    )

    expect(readDraft('db1', 'v-2026')).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('版本号不是当前版的不认', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 1,
        basedOnUpdatedAt: 'v-2026',
        nodes: [],
        meta: null,
      }),
    )

    expect(readDraft('db1', 'v-2026')).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('服务端 updatedAt 已推进（别处保存过）的草稿静默丢弃', () => {
    writeDraft('db1', 'v-old', [node('a')], meta())

    expect(readDraft('db1', 'v-new')).toBeNull()
    expect(localStorage.getItem(KEY)).toBeNull()
  })

  it('meta 形状不对（designWidth 不是数字）的不认', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        basedOnUpdatedAt: 'v-2026',
        nodes: [],
        meta: meta({ designWidth: '1920' as unknown as number }),
      }),
    )

    expect(readDraft('db1', 'v-2026')).toBeNull()
  })

  it('chromeJson 不是对象袋（数组/缺失）的不认', () => {
    for (const chromeJson of [null, [1]]) {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          version: 2,
          basedOnUpdatedAt: 'v-2026',
          nodes: [],
          meta: { ...meta(), chromeJson },
        }),
      )
      expect(readDraft('db1', 'v-2026')).toBeNull()
    }
  })

  it('nodes 不是数组的不认', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        version: 2,
        basedOnUpdatedAt: 'v-2026',
        nodes: {},
        meta: null,
      }),
    )

    expect(readDraft('db1', 'v-2026')).toBeNull()
  })

  it('存储里是坏 JSON 时读到 null 且把损坏条目清掉，不留着每次进屏重复失败', () => {
    localStorage.setItem(KEY, '{oops')

    expect(readDraft('db1', 'v-2026')).toBeNull()
    // 与坏形状同口径清除：catch 分支不清的话，这个键会永远留在 localStorage
    expect(localStorage.getItem(KEY)).toBeNull()
  })
})

describe('存储不可用', () => {
  it('写入抛出（无痕/配额满）时静默放弃，不打断编辑', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })

    expect(() => writeDraft('db1', 'v-2026', [node('a')], null)).not.toThrow()
  })

  it('清除抛出时同样静默', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })

    expect(() => clearDraft('db1')).not.toThrow()
  })
})
