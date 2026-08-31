/**
 * @fileoverview 契约：助手配联动那一半。
 *
 * **守的是「配了点着没反应」这一类静默故障**：联动规则是一只自由 JSON，源节点
 * 根本不发那个事件、目标节点已经被删、跳转目标填成画布节点 id——三样都存得下去、
 * 都不报错。所以这里逐条钉住每一类当场拒收，外加那条「删了要能原样交还」。
 */
import { computed, defineComponent, h, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  AssistantToolCall,
  DashboardNodePayload,
  InteractionRule,
  ModuleManifest,
} from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'
import type { AiSurface } from '@/features/ai/surfaces'

/** 一块自己上抛交互事件的控件：分段切换，发得出 click 与 select。 */
const BUTTON: ModuleManifest = {
  type: 'button-demo',
  displayName: '分段按钮',
  category: '控件',
  defaultSize: { width: 100, height: 40 },
  configSchema: [],
  bindings: [],
  emitsInteractions: true,
  interactionEvents: ['click', 'select'],
  component: () => Promise.resolve({ default: {} }),
}

/** 一块纯展示模块：两个标记都没有，当触发源配了也永远不触发。 */
const PANEL: ModuleManifest = {
  type: 'panel-demo',
  displayName: '展示板',
  category: '数据',
  defaultSize: { width: 200, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

const MANIFESTS: Record<string, ModuleManifest> = {
  [BUTTON.type]: BUTTON,
  [PANEL.type]: PANEL,
}

function node(
  id: string,
  moduleType: string,
  isVisible = true,
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible,
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
  rules: Ref<InteractionRule[]>
}

function setup(): Harness {
  let editor!: DashboardEditor
  let surface!: AiSurface
  // 规则表是有状态的：上一次写进去的那条，下一次读得出来
  const rules = ref<InteractionRule[]>([])
  const getManifest = (type: string): ModuleManifest | undefined =>
    MANIFESTS[type]
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(getManifest)
      editor.reset([
        node('btn', BUTTON.type),
        node('panel', PANEL.type),
        node('modal', PANEL.type, false),
      ])
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
            rules: computed(() => rules.value),
            setInteractions: (next) => {
              rules.value = next
            },
            setSnap: vi.fn(),
            setGrid: vi.fn(),
          },
          notify: vi.fn(),
        }),
        chrome: {
          card: computed(() => ({})),
          rules: computed(() => rules.value),
          setCard: vi.fn(),
          setInteractions: (next) => {
            rules.value = next
          },
        },
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
  return { editor, surface, rules }
}

async function run(
  surface: AiSurface,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const got = await surface.run(call(name, args))
  return got as Record<string, unknown>
}

/** 一条最普通的规则：点按钮，显示展示板。 */
function showPanel(): Record<string, unknown> {
  return {
    source_node_id: 'btn',
    event: 'click',
    action: { type: 'show', targets: ['panel'] },
  }
}

describe('读联动', () => {
  it('只有会上抛事件的模块进 sources，纯展示模块不进', async () => {
    const { surface } = setup()
    const got = await run(surface, 'dashboard.read_interactions', {})
    const sources = got.sources as { node_id: string; events: string[] }[]
    expect(sources.map((one) => one.node_id)).toEqual(['btn'])
    // 事件表按清单来，模型据此才知道这一个能不能配 select
    expect(sources[0]?.events).toEqual(['click', 'select'])
  })

  it('目标节点被删过的存量规则，problems 当场报出来', async () => {
    const { surface, rules } = setup()
    rules.value = [
      {
        id: 'r1',
        source: { nodeId: 'btn', event: 'click' },
        action: { type: 'show', targets: ['gone'] },
      },
    ]
    const got = await run(surface, 'dashboard.read_interactions', {})
    const listed = got.rules as { problems: string[] }[]
    expect(listed[0]?.problems.join()).toContain('gone')
  })

  it('源节点自己被删的规则，problems 只报源那一条', async () => {
    const { surface, rules } = setup()
    rules.value = [
      {
        id: 'r1',
        source: { nodeId: 'gone', event: 'click' },
        action: { type: 'show', targets: ['panel'] },
      },
    ]
    const got = await run(surface, 'dashboard.read_interactions', {})
    const listed = got.rules as { problems: string[] }[]
    expect(listed[0]?.problems).toEqual(['源节点已被删，这条规则永远不触发'])
  })
})

describe('写一条联动', () => {
  it('新建一条，落进规则表并选中源节点', async () => {
    const { surface, editor, rules } = setup()
    const got = await run(surface, 'dashboard.write_interaction', showPanel())
    expect(got.is_new).toBe(true)
    expect(rules.value).toHaveLength(1)
    expect(rules.value[0]?.id).toBe(got.rule_id)
    // 用户得看见助手在动哪一个
    expect(editor.selectedId.value).toBe('btn')
  })

  it('回执里明说这一步撤不回来', async () => {
    const { surface } = setup()
    const got = await run(surface, 'dashboard.write_interaction', showPanel())
    expect(String(got.note)).toContain('Ctrl+Z')
  })

  it('给 rule_id 是改那一条，不是再加一条', async () => {
    const { surface, rules } = setup()
    const first = await run(surface, 'dashboard.write_interaction', showPanel())
    await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      rule_id: first.rule_id,
      action: { type: 'hide', targets: ['panel'] },
    })
    expect(rules.value).toHaveLength(1)
    expect(rules.value[0]?.action.type).toBe('hide')
  })

  it('认不出的 rule_id 当场抛，不静默新建', async () => {
    const { surface, rules } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        rule_id: 'nope',
      }),
    ).rejects.toThrow('没有 nope')
    expect(rules.value).toHaveLength(0)
  })
})

describe('写不进去的那几种', () => {
  it('纯展示模块当触发源，拒收', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        source_node_id: 'panel',
      }),
    ).rejects.toThrow('不会上抛交互事件')
  })

  it('源发不出的事件，拒收并说出它发得出哪几个', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        event: 'change',
      }),
    ).rejects.toThrow('click、select')
  })

  it('目标节点不在画布上，拒收', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: { type: 'show', targets: ['panel', 'gone'] },
      }),
    ).rejects.toThrow('gone')
  })

  it('显隐类一个目标都不给，拒收', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: { type: 'show', targets: [] },
      }),
    ).rejects.toThrow('不能为空')
  })

  it('跳转目标填成画布节点 id，拒收——这一档最常见的错', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: { type: 'navigate', target: 'panel' },
      }),
    ).rejects.toThrow('不是大屏 id')
  })

  it('按值跳转的值留空，拒收——留空那条永远不命中', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: {
          type: 'navigateByValue',
          routes: [{ value: '', target: 'other-screen' }],
        },
      }),
    ).rejects.toThrow('不能留空')
  })

  it('按值跳转的值重复，拒收——后面那条永远不生效', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: {
          type: 'navigateByValue',
          routes: [
            { value: 'a', target: 's1' },
            { value: 'a', target: 's2' },
          ],
        },
      }),
    ).rejects.toThrow('重复')
  })

  it('action 的形状不对，拒收并说清每一档要什么', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: { type: 'show' },
      }),
    ).rejects.toThrow('形状不对')
  })
})

describe('互斥切换与跳转', () => {
  it('按值互斥切换写得进去', async () => {
    const { surface, rules } = setup()
    await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      event: 'select',
      action: {
        type: 'setActive',
        groups: [
          { value: 'a', targets: ['panel'] },
          { value: 'b', targets: ['modal'] },
        ],
      },
    })
    expect(rules.value[0]?.action).toEqual({
      type: 'setActive',
      groups: [
        { value: 'a', targets: ['panel'] },
        { value: 'b', targets: ['modal'] },
      ],
    })
  })

  it('一组都不给的互斥切换，拒收', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: { type: 'setActive', groups: [] },
      }),
    ).rejects.toThrow('一条都没有')
  })

  it('互斥切换里已被删的目标，拒收', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.write_interaction', {
        ...showPanel(),
        action: {
          type: 'setActive',
          groups: [{ value: 'a', targets: ['gone'] }],
        },
      }),
    ).rejects.toThrow('gone')
  })

  it('跳到另一张大屏写得进去', async () => {
    const { surface, rules } = setup()
    await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      action: { type: 'navigate', target: 'other-dashboard' },
    })
    expect(rules.value[0]?.action).toEqual({
      type: 'navigate',
      target: 'other-dashboard',
    })
  })

  it('跳转目标是大屏不是节点，读回来时 problems 空', async () => {
    const { surface, rules } = setup()
    rules.value = [
      {
        id: 'r1',
        source: { nodeId: 'btn', event: 'click' },
        action: { type: 'navigate', target: 'other-dashboard' },
      },
    ]
    const got = await run(surface, 'dashboard.read_interactions', {})
    // 按节点校验大屏 id 的话，每一条跨屏跳转都会被判成「目标已被删」
    expect((got.rules as { problems: string[] }[])[0]?.problems).toEqual([])
  })

  it('关闭弹窗那一档不点名任何东西，照样写得进去', async () => {
    const { surface, rules } = setup()
    await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      action: { type: 'closeModal' },
    })
    expect(rules.value[0]?.action).toEqual({ type: 'closeModal' })
  })
})

describe('弹窗那一档', () => {
  it('目标还在屏上时给一条 warnings：两处会各画一份', async () => {
    const { surface } = setup()
    const got = await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      action: { type: 'openModal', target: 'panel' },
    })
    expect(String((got.warnings as string[])[0])).toContain('set_visible')
  })

  it('目标已经是初始隐藏时不啰嗦', async () => {
    const { surface } = setup()
    const got = await run(surface, 'dashboard.write_interaction', {
      ...showPanel(),
      action: { type: 'openModal', target: 'modal' },
    })
    expect(got.warnings).toEqual([])
  })
})

describe('删一条联动', () => {
  it('整条原样交还——这条轴上唯一的撤销依据', async () => {
    const { surface, rules } = setup()
    const first = await run(surface, 'dashboard.write_interaction', showPanel())
    const got = await run(surface, 'dashboard.remove_interaction', {
      rule_id: first.rule_id,
    })
    expect(rules.value).toHaveLength(0)
    expect(got.removed).toEqual({
      rule_id: first.rule_id,
      source_node_id: 'btn',
      event: 'click',
      action: { type: 'show', targets: ['panel'] },
    })
  })

  it('认不出的 rule_id 当场抛', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.remove_interaction', { rule_id: 'nope' }),
    ).rejects.toThrow('没有 nope')
  })
})

describe('初始显隐', () => {
  it('改得动，而且落在撤销栈上', async () => {
    const { surface, editor } = setup()
    await run(surface, 'dashboard.set_visible', {
      node_id: 'panel',
      is_visible: false,
    })
    expect(
      editor.nodes.value.find((one) => one.id === 'panel')?.isVisible,
    ).toBe(false)
    editor.undo()
    expect(
      editor.nodes.value.find((one) => one.id === 'panel')?.isVisible,
    ).toBe(true)
  })

  it('不给真假值当场抛，不当成 false', async () => {
    const { surface } = setup()
    await expect(
      run(surface, 'dashboard.set_visible', { node_id: 'panel' }),
    ).rejects.toThrow('必须是真假值')
  })
})
