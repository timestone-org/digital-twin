/**
 * @fileoverview 契约：方向键微调三档的实际步长（默认吸附步进 / Alt 恒 1px /
 * Shift 10 倍步进），以及 Esc 的优先链——帮助弹窗 → 页面前置出口 → 清选中。
 */
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, computed } from 'vue'
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'

import {
  useDashboardEditor,
  type DashboardEditor,
} from '@/composables/useDashboardEditor'
import {
  normalizeEditorGrid,
  normalizeSnapConfig,
} from '@/features/dashboard/canvasSnap'
import type { CanvasZoom } from '@/features/dashboard/canvasZoom'
import {
  createArrangeActions,
  type ArrangeActions,
} from '@/pages/DashboardEditor/scripts/editorArrange'
import { useEditorHotkeys } from '@/pages/DashboardEditor/scripts/useEditorHotkeys'

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  defaultSize: { width: 100, height: 50 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: {} }),
}

function node(id: string): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 100,
    y: 100,
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

interface Harness {
  editor: DashboardEditor
  arrange: ArrangeActions
  helpOpen: ReturnType<typeof ref<boolean>>
  escapeFirst: ReturnType<typeof vi.fn>
  wrapper: ReturnType<typeof mount>
}

function setup(
  escapeConsumed = false,
  // 处理器在装配时就按引用捕获，要探的动作得在装配前换成 spy
  tapArrange?: (arrange: ArrangeActions) => void,
): Harness {
  let editor!: DashboardEditor
  let arrange!: ArrangeActions
  let helpOpen!: ReturnType<typeof ref<boolean>>
  const escapeFirst = vi.fn(() => escapeConsumed)
  const host = defineComponent({
    setup() {
      editor = useDashboardEditor(() => MANIFEST)
      editor.reset([node('a')])
      arrange = createArrangeActions({
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
      })
      tapArrange?.(arrange)
      helpOpen = useEditorHotkeys({
        editor,
        arrange,
        save: vi.fn(),
        removeSelected: vi.fn(),
        design: () => ({ width: 1920, height: 1080 }),
        snap: () => normalizeSnapConfig({ mode: 'px', step: 8 }),
        grid: () => normalizeEditorGrid(),
        zoom: ref<CanvasZoom>(1),
        escapeFirst,
      }).helpOpen
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { editor, arrange, helpOpen, escapeFirst, wrapper }
}

function press(key: string, over: Partial<KeyboardEventInit> = {}): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, ...over }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('方向键三档', () => {
  it('默认按吸附步进、Alt 恒 1px、Shift 10 倍步进', () => {
    const ctx = setup()
    const nudge = vi.spyOn(ctx.arrange, 'nudgeSelected')
    ctx.editor.select('a')

    press('ArrowRight')
    press('ArrowRight', { altKey: true })
    press('ArrowDown', { shiftKey: true })

    expect(nudge.mock.calls).toEqual([
      [8, 0],
      [1, 0],
      [0, 80],
    ])
    ctx.wrapper.unmount()
  })
})

describe('再制手势', () => {
  it('⌘D 与右键菜单落到同一个再制出口', () => {
    let duplicate!: ReturnType<typeof vi.spyOn>
    const ctx = setup(false, (arrange) => {
      duplicate = vi.spyOn(arrange, 'duplicateSelected')
    })
    ctx.editor.select('a')

    press('d', { metaKey: true })

    expect(duplicate).toHaveBeenCalledTimes(1)
    ctx.wrapper.unmount()
  })
})

describe('Esc 优先链', () => {
  it('帮助开着先关帮助，选中与前置出口都不动', () => {
    const ctx = setup()
    ctx.editor.select('a')
    ctx.helpOpen.value = true

    press('Escape')

    expect(ctx.helpOpen.value).toBe(false)
    expect(ctx.escapeFirst).not.toHaveBeenCalled()
    expect(ctx.editor.selectedId.value).toBe('a')
    ctx.wrapper.unmount()
  })

  it('前置出口消费掉这一下时不清选中', () => {
    const ctx = setup(true)
    ctx.editor.select('a')

    press('Escape')

    expect(ctx.escapeFirst).toHaveBeenCalledTimes(1)
    expect(ctx.editor.selectedId.value).toBe('a')
    ctx.wrapper.unmount()
  })

  it('没人消费时才落到清选中', () => {
    const ctx = setup(false)
    ctx.editor.select('a')

    press('Escape')

    expect(ctx.editor.selectedId.value).toBeNull()
    ctx.wrapper.unmount()
  })
})
