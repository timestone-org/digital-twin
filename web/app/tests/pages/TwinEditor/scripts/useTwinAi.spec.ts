/**
 * @fileoverview 契约：孪生编辑器这一页与助手之间的那几根线真的接上了。
 *
 * ⚠ 页面不登记工作面 = 助手在这一页什么都干不了，而界面上看不出区别：它照样开得
 * 出来、照样能聊天。
 * ⚠ 选中要一路透到快照里：用户在大纲里点了一个说「把这个接上」，快照里没有选中的
 * 话，模型只能挑一个它自己觉得像的去改。
 * ⚠ 保存必须落到页面**现有**那条路径上：落库走大屏的整树替换，另写一套就会漏掉
 * 同屏其余节点，而界面上只显示保存成功。
 * ⚠ 读数必须问页面那份快照缓存：另开一份的表现是「助手说有值、画面上是占位符」。
 */
import type {
  BindingPayload,
  DashboardNodePayload,
  DashboardPayload,
  PointSample,
} from '@dt/contracts'
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetSurfaces, activeSurface } from '@/features/ai/surfaces'
import { createBinding } from '@/features/dashboard/editorDoc'
import type { TwinBindings } from '@/pages/TwinEditor/scripts/useTwinBindings'
import type { TwinEditorPage } from '@/pages/TwinEditor/scripts/useTwinEditorPage'
import { useTwinAi } from '@/pages/TwinEditor/scripts/useTwinAi'
import { TWIN_SELECT_MODEL } from '@/pages/TwinEditor/scripts/types'
import type { TwinSelection } from '@/pages/TwinEditor/scripts/types'

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1', name: '1号机组出口' }],
})

const NODE: DashboardNodePayload = {
  id: 'n1',
  dashboardId: 'd1',
  parentId: null,
  clientKey: null,
  moduleType: 'twin-view',
  x: 0,
  y: 0,
  w: 1280,
  h: 720,
  zIndex: 1,
  isVisible: true,
  configJson: { __label: '厂区三维' },
  bindings: [],
  createdAt: '',
  updatedAt: '',
}

const SAMPLE: PointSample = {
  state: 'ok',
  value: 42,
  timestampMs: 7,
  quality: 'good',
}

interface Harness {
  save: ReturnType<typeof vi.fn<() => Promise<boolean>>>
  conflict: Ref<string | null>
  selection: Ref<TwinSelection>
  /** 助手问过哪几个点位；「读的是页面那份缓存」这条断言看它。 */
  asked: string[]
}

const DASHBOARD: DashboardPayload = {
  id: 'd1',
  projectId: 'p1',
  name: '一号屏',
  description: null,
  designWidth: 1920,
  designHeight: 1080,
  rowVersion: 9,
  schemaVersion: 1,
  isPublic: false,
  chromeJson: {},
  themeJson: {},
  createdAt: '',
  updatedAt: '',
  nodes: [NODE],
}

function pageOf(harness: Harness): TwinEditorPage {
  const dashboard = ref<DashboardPayload | null>(DASHBOARD)
  return {
    doc: computed(() => null),
    dashboard,
    node: computed(() => NODE),
    targetSize: computed(() => ({ width: 1280, height: 720 })),
    loading: ref(false),
    saving: ref(false),
    error: computed(() => null),
    conflict: harness.conflict,
    save: harness.save,
    dispose: vi.fn(),
  }
}

function bindingsOf(
  harness: Harness,
  bindings: BindingPayload[],
): TwinBindings {
  return {
    bindings: computed(() => bindings),
    write: vi.fn(),
    bind: vi.fn(),
    drop: vi.fn(),
    removeRow: vi.fn(),
    pickingFieldKey: ref<string | null>(null),
    pickPoint: vi.fn(),
    closePicker: vi.fn(),
    liveValues: computed(() => undefined),
    readBinding: () => () => ({ state: 'pending' }),
    readSample: (nodeKey) => {
      harness.asked.push(nodeKey)
      return nodeKey === 'src:A' ? SAMPLE : undefined
    },
  }
}

function setup(bindings: BindingPayload[] = []) {
  const harness: Harness = {
    save: vi.fn(() => Promise.resolve(true)),
    conflict: ref<string | null>(null),
    selection: ref<TwinSelection>(TWIN_SELECT_MODEL),
    asked: [],
  }
  const host = defineComponent({
    setup() {
      useTwinAi(
        pageOf(harness),
        bindingsOf(harness, bindings),
        () => CONFIG,
        () => harness.selection.value,
        () => null,
      )
      return () => h('div')
    },
  })
  return { harness, wrapper: mount(host) }
}

/** 当前登记的工作面；没登记就说清楚，别让断言在别处炸。 */
function surface() {
  const found = activeSurface()
  if (found === null) throw new Error('这一页没登记工作面')
  return found
}

beforeEach(() => {
  __resetSurfaces()
})

afterEach(() => {
  __resetSurfaces()
})

describe('登记', () => {
  it('挂上就登记孪生编辑器这个工作面', () => {
    setup()

    expect(surface().kind).toBe('twin-editor')
  })

  it('卸下来就撤掉，助手不会对着一个已经没了的页面动手', () => {
    const { wrapper } = setup()

    wrapper.unmount()

    expect(activeSurface()).toBeNull()
  })
})

describe('快照', () => {
  it('带上大屏上那个节点的名字，不是模块类型', () => {
    setup()

    expect(surface().snapshot().node_label).toBe('厂区三维')
  })

  it('用户在大纲里选中的那一个一路透到快照里', () => {
    const { harness } = setup()

    harness.selection.value = { kind: 'anchors', id: 'a1' }

    expect(surface().snapshot().selected).toEqual([
      { kind: 'anchor', id: 'a1', name: '1号机组出口' },
    ])
  })
})

describe('读数', () => {
  it('问的是页面那份快照缓存，不另开一份', async () => {
    const { harness } = setup([
      {
        ...createBinding('n1', 'anchorValues[0].value'),
        sourceKind: 'opcua',
        nodeKey: 'src:A',
      },
    ])

    const report = (await surface().run({
      call_id: 'c1',
      name: 'dashboard.read_values',
      arguments: {},
    })) as { items: Record<string, unknown>[] }

    expect(harness.asked).toContain('src:A')
    expect(report.items[0]).toMatchObject({ value: 42, status: 'has_value' })
  })
})

describe('落库', () => {
  it('走页面现有的那条保存，并回落库后的行版本', async () => {
    const { harness } = setup()

    const got = await surface().run({
      call_id: 'c1',
      name: 'dashboard.save',
      arguments: {},
    })

    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(got).toMatchObject({ ok: true, saved_version: 9 })
  })

  // ⚠ 静默吞掉会让模型接着往下绑，而每一条都存不进去
  it('冲突时抛，且抛的是这一次保存写下的那句话', async () => {
    const { harness } = setup()
    harness.save.mockImplementation(() => {
      harness.conflict.value = '这张屏已被别人改过，请重新加载'
      return Promise.resolve(false)
    })

    await expect(
      surface().run({
        call_id: 'c1',
        name: 'dashboard.save',
        arguments: {},
      }),
    ).rejects.toThrow(/重新加载/)
  })
})
