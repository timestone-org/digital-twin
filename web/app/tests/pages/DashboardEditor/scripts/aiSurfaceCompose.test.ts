/**
 * @fileoverview 契约：助手在大屏编辑器上摆模块、删节点、改几何、对齐排布。
 *
 * 守的仍是 ADR-0023：全部落到已有的动作层上，于是一步一次撤销。另外守两条这一半
 * 特有的：新节点的 id 必须还给模型（不然它下一步无从下手），以及**做不到的事要
 * 抛**——分布不足三个、坐标带小数、模块类型不存在，静默成功都会让模型对着一屏
 * 没动过的画布往下说。
 */
import { computed, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type {
  AssistantToolCall,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import type { AiSurface } from '@/features/ai/surfaces'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'

const DEMO: ModuleManifest = {
  type: 'demo',
  displayName: '演示模块',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [{ key: 'title', label: '标题', type: 'string' }],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

const BOX: ModuleManifest = {
  ...DEMO,
  type: 'box',
  displayName: '容器',
  isContainer: true,
}

const BARE: ModuleManifest = {
  ...DEMO,
  type: 'bare',
  displayName: '自绘壳',
  chromeConfigurable: false,
}

/** 钉位模块：x / y / 宽由钉边算出来，模型只能改高。 */
const FOOT: ModuleManifest = {
  ...DEMO,
  type: 'foot',
  displayName: '页脚',
  isContainer: true,
  region: 'footer',
  defaultSize: { width: 1920, height: 72 },
}

const MANIFESTS = [DEMO, BOX, BARE, FOOT]

function node(id: string, x: number): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x,
    y: 20,
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

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

interface Harness {
  editor: DashboardEditor
  surface: AiSurface
}

function setup(): Harness {
  let editor!: DashboardEditor
  let surface!: AiSurface
  const getManifest = (type: string): ModuleManifest | undefined =>
    MANIFESTS.find((one) => one.type === type)
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(getManifest)
      editor.reset([node('a', 10), node('b', 200), node('c', 500)])
      surface = createEditorSurface({
        editor,
        actions: createEditorActions({
          editor,
          dashboardId: () => 'd1',
          getManifest,
          design: () => ({ width: 1920, height: 1080 }),
        }),
        arrange: createArrangeActions({
          editor,
          getManifest,
          design: () => ({ width: 1920, height: 1080 }),
          steps: () => ({ x: 8, y: 8 }),
          dashboardId: () => 'd1',
          chrome: {
            rules: computed(() => []),
            setInteractions: vi.fn(),
            setSnap: vi.fn(),
            setGrid: vi.fn(),
          },
          notify: vi.fn(),
        }),
        stageEl: () => null,
        readSample: () => undefined,
        save: () => Promise.resolve({ isSaved: true, message: null }),
        savedVersion: () => 1,
        getManifest,
      })
      return () => h('div')
    },
  })
  mount(host)
  return { editor, surface }
}

describe('摆模块', () => {
  it('新节点的 id 要还给模型', async () => {
    const { editor, surface } = setup()
    const got = (await surface.run(
      call('dashboard.add_module', { module_type: 'demo', x: 40, y: 60 }),
    )) as Record<string, unknown>
    // 拿不到 id 的话模型下一步就无从下手，只能重读整个画布再去猜哪个是新的
    expect(typeof got.node_id).toBe('string')
    expect(editor.nodes.value).toHaveLength(4)
  })

  it('落在模型给的坐标上，并顺手选中它', async () => {
    const { editor, surface } = setup()
    const got = (await surface.run(
      call('dashboard.add_module', { module_type: 'demo', x: 40, y: 60 }),
    )) as Record<string, unknown>
    const created = editor.nodes.value.find((one) => one.id === got.node_id)
    expect(created).toMatchObject({ x: 40, y: 60 })
    expect(editor.selectedId.value).toBe(got.node_id)
  })

  it('一次撤销就退回没加之前', async () => {
    const { editor, surface } = setup()
    await surface.run(call('dashboard.add_module', { module_type: 'demo' }))
    editor.undo()
    expect(editor.nodes.value).toHaveLength(3)
  })

  it('不认识的模块类型要抛，并指回清单', async () => {
    const { surface } = setup()
    await expect(
      surface.run(call('dashboard.add_module', { module_type: 'nope' })),
    ).rejects.toThrow(/modules\.catalog/)
  })

  it('落进装不下子节点的东西里要抛', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.add_module', {
          module_type: 'demo',
          parent_id: 'a',
        }),
      ),
    ).rejects.toThrow(/装不下/)
  })
})

describe('删节点', () => {
  it('连子孙一起数清再删', async () => {
    const { editor, surface } = setup()
    const created = (await surface.run(
      call('dashboard.add_module', { module_type: 'box', x: 0, y: 0 }),
    )) as Record<string, unknown>
    await surface.run(
      call('dashboard.add_module', {
        module_type: 'demo',
        parent_id: String(created.node_id),
      }),
    )
    const got = (await surface.run(
      call('dashboard.remove_node', { node_id: String(created.node_id) }),
    )) as Record<string, unknown>
    // 用户要知道刚才连带没了几个——删完再数是零
    expect(got.removed_count).toBe(2)
    expect(editor.nodes.value).toHaveLength(3)
  })
})

describe('改几何', () => {
  it('只给的那几维变，其余保持原值', async () => {
    const { editor, surface } = setup()
    await surface.run(
      call('dashboard.set_geometry', { node_id: 'a', x: 300, w: 240 }),
    )
    const target = editor.nodes.value.find((one) => one.id === 'a')
    expect(target).toMatchObject({ x: 300, y: 20, w: 240, h: 50 })
  })

  // ⚠ 回执照抄入参的话，模型手里那份坐标与画布上的不是一回事，接着它会对着一个
  //   并不存在的位置继续算下一步
  it('钉位模块的回执报的是落库后的几何，不是入参', async () => {
    const { editor, surface } = setup()
    const added = (await surface.run(
      call('dashboard.add_module', { module_type: 'foot' }),
    )) as Record<string, unknown>
    const nodeId = String(added.node_id)

    const got = (await surface.run(
      call('dashboard.set_geometry', {
        node_id: nodeId,
        x: 300,
        y: 90,
        h: 120,
      }),
    )) as Record<string, unknown>

    // 下沿贴着 1080：y 由钉边与高算出来，x 与宽被铺满
    expect(got).toMatchObject({ x: 0, y: 960, w: 1920, h: 120 })
    expect(editor.nodes.value.find((one) => one.id === nodeId)).toMatchObject({
      x: 0,
      y: 960,
      w: 1920,
      h: 120,
    })
  })

  it('带小数的几何当场抛', async () => {
    const { surface } = setup()
    // 让它过去的话，后端会在保存时回一句字段校验错，看不出坐标是助手算出来的
    await expect(
      surface.run(call('dashboard.set_geometry', { node_id: 'a', x: 12.5 })),
    ).rejects.toThrow(/整数/)
  })
})

describe('对齐排布', () => {
  it('顶对齐把选中的几个拉到同一条线上', async () => {
    const { editor, surface } = setup()
    await surface.run(call('dashboard.set_geometry', { node_id: 'b', y: 400 }))
    await surface.run(
      call('dashboard.arrange', { action: 'top', node_ids: ['a', 'b'] }),
    )
    const tops = editor.nodes.value
      .filter((one) => one.id === 'a' || one.id === 'b')
      .map((one) => one.y)
    expect(new Set(tops).size).toBe(1)
  })

  it('分布不足三个要抛，而不是静默成功', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.arrange', {
          action: 'distribute-x',
          node_ids: ['a', 'b'],
        }),
      ),
    ).rejects.toThrow(/三个/)
  })

  it('画布上没有的 id 一律抛', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.arrange', { action: 'top', node_ids: ['a', 'zzz'] }),
      ),
    ).rejects.toThrow(/zzz/)
  })
})

describe('拦下写得进去但不生效的配置键', () => {
  it('清单里没有的配置字段要抛', async () => {
    const { surface } = setup()
    // 写进去既不报错也不渲染，画面上表现为「配了没反应」
    await expect(
      surface.run(
        call('dashboard.set_config', {
          node_id: 'a',
          path: ['notAField'],
          value: 1,
        }),
      ),
    ).rejects.toThrow(/notAField/)
  })

  it('自绘外壳的模块拒收统一外观键', async () => {
    const { surface } = setup()
    const created = (await surface.run(
      call('dashboard.add_module', { module_type: 'bare', x: 0, y: 0 }),
    )) as Record<string, unknown>
    await expect(
      surface.run(
        call('dashboard.set_config', {
          node_id: String(created.node_id),
          path: ['__cardStyle', 'borderStyle'],
          value: 'none',
        }),
      ),
    ).rejects.toThrow(/外观/)
  })
})
