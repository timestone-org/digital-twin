/**
 * @fileoverview 契约：助手改配置那一半。
 *
 * **守的是「配了没反应」这一类静默故障**：配置是一只自由袋子，清单里没有的键
 * 写进去既不报错也不渲染。所以这里逐条钉住——不认识的字段当场抛、往数组里加项
 * 要按 itemSchema 填默认、加项与数据行号一一对应、常量绑定不许写 null。
 */
import { computed } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import type {
  AssistantToolCall,
  DashboardNodePayload,
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

/** 一块「N 个指标」的数据模块：配置里第 i 项 ↔ 数据槽第 i 行。 */
const MANIFEST: ModuleManifest = {
  type: 'metric-demo',
  displayName: '实时数值',
  category: '数据',
  defaultSize: { width: 100, height: 50 },
  configSchema: [
    { key: 'title', label: '标题', type: 'string', default: '' },
    {
      key: 'items',
      label: '指标',
      type: 'array',
      minItems: 1,
      default: [{ label: '指标 1', unit: '', precision: 1 }],
      itemSchema: [
        { key: 'label', label: '名称', type: 'string', default: '' },
        { key: 'unit', label: '单位', type: 'string', default: '' },
        { key: 'precision', label: '小数位', type: 'number', default: 1 },
      ],
    },
    { key: 'align', label: '对齐', type: 'enum', default: 'center' },
  ],
  // 标题与指标列表是内容，`align` 是观感——套样式时只许写后者
  contentKeys: ['title', 'items'],
  unsupportedChromeKeys: ['backdropBlur'],
  bindings: [
    { key: 'itemValues', label: '读数', dataType: 'number', isArray: true },
  ],
  component: () => Promise.resolve({ default: {} }),
}

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'metric-demo',
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: { items: [{ label: '出口温度', unit: '°C', precision: 2 }] },
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

function setup(): { editor: DashboardEditor; surface: AiSurface } {
  let editor!: DashboardEditor
  let surface!: AiSurface
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => MANIFEST)
      editor.reset([node('a')])
      surface = createEditorSurface({
        editor,
        actions: createEditorActions({
          editor,
          dashboardId: () => 'd1',
          getManifest: () => MANIFEST,
          design: () => ({ width: 1920, height: 1080 }),
        }),
        arrange: createArrangeActions({
          editor,
          getManifest: () => MANIFEST,
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
        getManifest: () => MANIFEST,
      })
      return () => h('div')
    },
  })
  mount(host)
  return { editor, surface }
}

async function run(
  surface: AiSurface,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const got = await surface.run(call(name, args))
  return got as Record<string, unknown>
}

function itemsOf(editor: DashboardEditor): Record<string, unknown>[] {
  const target = editor.nodes.value.find((one) => one.id === 'a')
  const rows: unknown = target?.configJson.items
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : []
}

describe('读配置', () => {
  it('给出这个画布节点此刻配成什么样', async () => {
    const { surface } = setup()
    const shot = await run(surface, 'dashboard.read_config', { node_id: 'a' })

    // 不读就写等于把用户已经调好的那几格一起冲掉
    expect(shot.config).toEqual({
      items: [{ label: '出口温度', unit: '°C', precision: 2 }],
    })
    expect(shot.module_type).toBe('metric-demo')
  })

  it('外观单独一格，并说清这个模块画不出哪几个键', async () => {
    const { surface } = setup()
    const shot = await run(surface, 'dashboard.read_config', { node_id: 'a' })

    expect(shot.card_style).toEqual({})
    expect(shot.unsupported_chrome_keys).toEqual(['backdropBlur'])
  })
})

describe('数组配置项', () => {
  it('新项按 itemSchema 填默认，再盖上给的那几格', async () => {
    const { editor, surface } = setup()
    const shot = await run(surface, 'dashboard.add_config_item', {
      node_id: 'a',
      field: 'items',
      values: { label: '额定功率', unit: 'MW' },
    })

    // 只写提到的那两格的话，缺的那些在渲染侧落回 undefined，那一格什么都不显示
    expect(shot.index).toBe(1)
    expect(itemsOf(editor)[1]).toEqual({
      label: '额定功率',
      unit: 'MW',
      precision: 1,
    })
  })

  it('不动已有的那几项', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.add_config_item', {
      node_id: 'a',
      field: 'items',
      values: { label: '额定功率' },
    })

    expect(itemsOf(editor)[0]).toEqual({
      label: '出口温度',
      unit: '°C',
      precision: 2,
    })
  })

  it('加一项就是一笔，一次 Ctrl+Z 整个退回', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.add_config_item', {
      node_id: 'a',
      field: 'items',
      values: { label: '额定功率' },
    })
    editor.undo()

    expect(itemsOf(editor)).toHaveLength(1)
  })

  it('不是数组的字段当场抛，不硬写', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.add_config_item', { node_id: 'a', field: 'title' }),
      ),
    ).rejects.toThrow(/不是数组/)
  })

  it('清单里没有的字段当场抛', async () => {
    const { surface } = setup()
    // 写进去既不报错也不渲染，画面上表现为「配了没反应」
    await expect(
      surface.run(
        call('dashboard.add_config_item', { node_id: 'a', field: 'zzz' }),
      ),
    ).rejects.toThrow(/zzz/)
  })

  it('删到低于 minItems 时拒绝', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.remove_config_item', {
          node_id: 'a',
          field: 'items',
          index: 0,
        }),
      ),
    ).rejects.toThrow(/至少/)
  })

  it('删完要说清后面每一行的绑定都挪了位', async () => {
    const { surface } = setup()
    await run(surface, 'dashboard.add_config_item', {
      node_id: 'a',
      field: 'items',
      values: { label: '额定功率' },
    })
    const shot = await run(surface, 'dashboard.remove_config_item', {
      node_id: 'a',
      field: 'items',
      index: 0,
    })

    expect(String(shot.note)).toContain('绑定')
  })
})

describe('外观键词汇表', () => {
  it('给出键、类型与枚举的合法取值', async () => {
    const { surface } = setup()
    const shot = await run(surface, 'dashboard.chrome_keys', {})
    const keys = shot.keys as { key: string; values?: readonly string[] }[]
    const border = keys.find((one) => one.key === 'borderStyle')

    // 服务端的模块目录里没有这一段，只有浏览器手上这份清单知道
    expect(border?.values).toContain('none')
  })
})

describe('绑常量', () => {
  it('写得进去，且来源是 static', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.write_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
      source_kind: 'static',
      value: 380,
    })
    const target = editor.nodes.value.find((one) => one.id === 'a')

    expect(target?.bindings[0]).toMatchObject({
      fieldKey: 'itemValues[0].value',
      sourceKind: 'static',
      staticValueJson: 380,
    })
  })

  it('0 与 false 都是合法常量', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.write_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
      source_kind: 'static',
      value: 0,
    })
    const target = editor.nodes.value.find((one) => one.id === 'a')

    expect(target?.bindings[0]?.staticValueJson).toBe(0)
  })

  it('null 当场拒——那一层把它读成「没配过」', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.write_binding', {
          node_id: 'a',
          field_key: 'itemValues[0].value',
          source_kind: 'static',
          value: null,
        }),
      ),
    ).rejects.toThrow(/null/)
  })

  it('换成点位时沿用同一条绑定的 id', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.write_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
      source_kind: 'static',
      value: 380,
    })
    const before = editor.nodes.value.find((one) => one.id === 'a')
    const firstId = before?.bindings[0]?.id
    await run(surface, 'dashboard.write_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
      source_kind: 'opcua',
      node_key: 'src:K1_TT02',
    })
    const after = editor.nodes.value.find((one) => one.id === 'a')

    // 绑定 id 是实时推送的关联键，重生成会让关联每次保存断一次
    expect(after?.bindings[0]?.id).toBe(firstId)
    expect(after?.bindings[0]).toMatchObject({
      sourceKind: 'opcua',
      nodeKey: 'src:K1_TT02',
    })
  })

  it('认不出的来源直说，不默默当成点位', async () => {
    const { surface } = setup()
    await expect(
      surface.run(
        call('dashboard.write_binding', {
          node_id: 'a',
          field_key: 'itemValues[0].value',
          source_kind: 'dataset',
        }),
      ),
    ).rejects.toThrow(/dataset/)
  })
})

describe('解绑', () => {
  it('解掉之后那个槽上没有绑定了', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.write_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
      source_kind: 'static',
      value: 380,
    })
    await run(surface, 'dashboard.remove_binding', {
      node_id: 'a',
      field_key: 'itemValues[0].value',
    })
    const target = editor.nodes.value.find((one) => one.id === 'a')

    expect(target?.bindings).toEqual([])
  })

  it('本来就没有那条绑定时当场抛', async () => {
    const { surface } = setup()
    // 静默成功会让模型以为解掉了，接着往下走
    await expect(
      surface.run(
        call('dashboard.remove_binding', {
          node_id: 'a',
          field_key: 'itemValues[9].value',
        }),
      ),
    ).rejects.toThrow(/没有/)
  })
})

describe('选中项', () => {
  it('快照把用户选中的那些单拎出来', async () => {
    const { editor, surface } = setup()
    editor.select('a')
    editor.flush()
    const shot = await run(surface, 'dashboard.read_canvas', {})

    // 埋在几十个节点中间的几格 id，模型读不出「用户说的『这个』指的是它」
    expect(shot.selected).toMatchObject([
      { id: 'a', module_type: 'metric-demo' },
    ])
  })

  it('没选中时给空数组，不是一格 null', async () => {
    const { surface } = setup()
    const shot = await run(surface, 'dashboard.read_canvas', {})

    expect(shot.selected).toEqual([])
    expect(shot.selected_ids).toEqual([])
  })
})

describe('套一整套观感', () => {
  it('外壳整袋换掉，内芯逐键覆盖，一次一步撤销', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.set_config', {
      node_id: 'a',
      path: ['__cardStyle', 'titleRule'],
      value: 'hatch',
    })

    const got = await run(surface, 'dashboard.apply_style', {
      node_id: 'a',
      chrome: { radius: 4 },
      config: { align: 'left' },
    })
    const config = editor.nodes.value[0]?.configJson ?? {}

    expect(got.ok).toBe(true)
    // ⚠ 整袋换：上一套的 titleRule 必须消失，否则就是「换了样式没换干净」
    expect(config.__cardStyle).toEqual({ radius: 4 })
    expect(config.align).toBe('left')
    // 内容键原样留着：样式换的是观感，不是把用户配好的指标抹掉
    expect(config.items).toHaveLength(1)
  })

  it('空外壳袋按删键处理，回落平台默认', async () => {
    const { editor, surface } = setup()
    await run(surface, 'dashboard.set_config', {
      node_id: 'a',
      path: ['__cardStyle', 'radius'],
      value: 8,
    })

    await run(surface, 'dashboard.apply_style', { node_id: 'a', chrome: {} })

    expect(editor.nodes.value[0]?.configJson).not.toHaveProperty('__cardStyle')
  })

  // ⚠ 一个模块的观感键写到另一个模块上，既不报错也不生效——这里把它翻成一句能读的错
  it('内芯里有这个模块没有的观感键就当场拒绝', async () => {
    const { surface } = setup()

    await expect(
      run(surface, 'dashboard.apply_style', {
        node_id: 'a',
        chrome: {},
        config: { cellShell: 'accent' },
      }),
    ).rejects.toThrow(/cellShell/)
  })

  it('内容键混进内芯里同样拒绝：它会把用户配好的指标抹掉', async () => {
    const { surface } = setup()

    await expect(
      run(surface, 'dashboard.apply_style', {
        node_id: 'a',
        chrome: {},
        config: { items: [] },
      }),
    ).rejects.toThrow(/items/)
  })

  it('词汇表外的外壳键当场拒绝，并指路 chrome_keys', async () => {
    const { surface } = setup()

    await expect(
      run(surface, 'dashboard.apply_style', {
        node_id: 'a',
        chrome: { 出土文物: 1 },
      }),
    ).rejects.toThrow(/chrome_keys/)
  })

  it('只套外壳时内芯一个键都不动', async () => {
    const { editor, surface } = setup()

    await run(surface, 'dashboard.apply_style', {
      node_id: 'a',
      chrome: { radius: 4 },
    })
    const config = editor.nodes.value[0]?.configJson ?? {}

    expect(config.items).toHaveLength(1)
    expect(config.align).toBeUndefined()
  })
})
