/**
 * @fileoverview 契约：助手改整屏卡片外观缺省那两个工具。
 *
 * **守的是「整屏改了、偏偏那几块没变」这一类静默故障**：节点自己的 `__cardStyle`
 * 盖在整屏缺省上面，两边都不报错。所以两个工具都必须报出 `overridden_by`，
 * 而词汇表外的键要当场拒收——写进去存得下、渲染时一个变量都不注入。
 */
import { computed, defineComponent, h, ref, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import type {
  AssistantToolCall,
  CardChrome,
  DashboardNodePayload,
  ModuleManifest,
} from '@dt/contracts'

import { useDashboardEditor } from '@/composables/useDashboardEditor'
import { createEditorActions } from '@/pages/DashboardEditor/scripts/editorActions'
import { createArrangeActions } from '@/pages/DashboardEditor/scripts/editorArrange'
import { createEditorSurface } from '@/pages/DashboardEditor/scripts/aiSurface'
import type { AiSurface } from '@/features/ai/surfaces'

const MANIFEST: ModuleManifest = {
  type: 'panel-demo',
  displayName: '展示板',
  category: '数据',
  defaultSize: { width: 200, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(
  id: string,
  config: Record<string, unknown>,
): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: MANIFEST.type,
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: config,
    createdAt: '',
    updatedAt: '',
    bindings: [],
  }
}

function call(name: string, args: Record<string, unknown>): AssistantToolCall {
  return { call_id: 'c1', name, arguments: args }
}

interface Harness {
  surface: AiSurface
  card: Ref<Record<string, unknown>>
  written: CardChrome[]
}

function setup(page: Record<string, unknown> = {}): Harness {
  let surface!: AiSurface
  const card = ref<Record<string, unknown>>(page)
  const written: CardChrome[] = []
  const getManifest = (): ModuleManifest => MANIFEST
  const host = defineComponent({
    setup() {
      const editor = useDashboardEditor(getManifest)
      editor.reset([
        // 这一块自己盖了圆角：整屏改圆角时它不会跟着变
        node('own', { __cardStyle: { radius: 2 } }),
        node('plain', {}),
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
            rules: computed(() => []),
            setInteractions: vi.fn(),
            setSnap: vi.fn(),
            setGrid: vi.fn(),
          },
          notify: vi.fn(),
        }),
        chrome: {
          card: computed(() => card.value),
          rules: computed(() => []),
          setCard: (next) => {
            written.push(next)
            card.value = { ...next }
          },
          setInteractions: vi.fn(),
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
  return { surface, card, written }
}

async function run(
  surface: AiSurface,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const got = await surface.run(call(name, args))
  return got as Record<string, unknown>
}

describe('读整屏外观', () => {
  it('报出自己盖了这批键的那些节点', async () => {
    const { surface } = setup({ radius: 12, bg: '#000' })
    const got = await run(surface, 'dashboard.read_page_style', {})
    expect(got.page_card_style).toEqual({ radius: 12, bg: '#000' })
    expect(got.overridden_by).toEqual([
      { node_id: 'own', label: '展示板', keys: ['radius'] },
    ])
  })

  it('词汇表外的键单拎出来报，不混进正常键里', async () => {
    const { surface } = setup({ radius: 12, madeUp: 1 })
    const got = await run(surface, 'dashboard.read_page_style', {})
    expect(got.stray_keys).toEqual(['madeUp'])
  })
})

describe('写整屏外观', () => {
  it('整袋写下去，并报出哪几块不会跟着变', async () => {
    const { surface, written } = setup({ radius: 12 })
    const got = await run(surface, 'dashboard.set_page_style', {
      chrome: { radius: 20, borderStyle: 'none' },
    })
    expect(written).toEqual([{ radius: 20, borderStyle: 'none' }])
    expect(got.chrome_keys).toBe(2)
    expect(got.overridden_by).toEqual([
      { node_id: 'own', label: '展示板', keys: ['radius'] },
    ])
  })

  it('空袋子就是整屏回落平台默认，不是「什么都没做」', async () => {
    const { surface, written } = setup({ radius: 12 })
    await run(surface, 'dashboard.set_page_style', { chrome: {} })
    expect(written).toEqual([{}])
  })

  it('凭印象写的键当场拒收，一个字都不落库', async () => {
    const { surface, written } = setup()
    await expect(
      run(surface, 'dashboard.set_page_style', {
        chrome: { radius: 8, roundness: 8 },
      }),
    ).rejects.toThrow('roundness')
    expect(written).toEqual([])
  })

  it('回执明说这一步撤不回来', async () => {
    const { surface } = setup()
    const got = await run(surface, 'dashboard.set_page_style', {
      chrome: { radius: 8 },
    })
    expect(String(got.note)).toContain('Ctrl+Z')
  })
})
