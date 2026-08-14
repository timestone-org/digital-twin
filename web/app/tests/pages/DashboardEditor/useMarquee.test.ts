/**
 * @fileoverview 契约：框选命中的是与框**相交**的节点（不必被套住），Shift 是累加，
 * 原地单击空白清空选中；`pointercancel` 与卸载都要能把 window 监听收干净——
 * 收不干净就留下一副永远跟着鼠标画框的监听。
 */
import type { DashboardNodePayload, ModuleManifest } from '@dt/contracts'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'

import { layoutFrames } from '@/features/dashboard/editorLayout'
import {
  buildPlacements,
  marqueeHits,
} from '@/pages/DashboardEditor/canvasLayers'
import {
  useMarquee,
  type CanvasMarquee,
} from '@/pages/DashboardEditor/useMarquee'

const DESIGN = { width: 1920, height: 1080 }

const MANIFEST: ModuleManifest = {
  type: 'demo',
  displayName: '演示',
  category: '演示',
  chrome: 'bare',
  defaultSize: { width: 100, height: 100 },
  configSchema: [],
  bindings: [],
  component: () => Promise.resolve({ default: { template: '<i />' } }),
}

function getManifest(): ModuleManifest {
  return MANIFEST
}

function node(id: string, x: number, y: number): DashboardNodePayload {
  return {
    id,
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x,
    y,
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

const NODES = [node('a', 10, 20), node('b', 400, 400)]
const PLACEMENTS = buildPlacements({
  nodes: NODES,
  frames: layoutFrames(NODES, getManifest).frames,
  design: DESIGN,
  getManifest,
})

interface Picked {
  ids: string[]
  additive: boolean
}

function mountMarquee() {
  const picked: Picked[] = []
  let cleared = 0
  let marquee: CanvasMarquee | null = null
  const host = defineComponent({
    setup() {
      marquee = useMarquee({
        // 视口在测试里没有布局，client 坐标直接当设计坐标用
        pointerDesign: (at) => ({ x: at.clientX, y: at.clientY }),
        hitIds: (box) => marqueeHits(PLACEMENTS, box),
        onMarquee: (ids, additive) => picked.push({ ids, additive }),
        onClear: () => {
          cleared += 1
        },
      })
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return {
    wrapper,
    picked,
    cleared: () => cleared,
    marquee: marquee as unknown as CanvasMarquee,
  }
}

function pointer(type: string, clientX: number, clientY: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX, clientY }))
}

function down(shiftKey = false): PointerEvent {
  return new MouseEvent('pointerdown', {
    clientX: 0,
    clientY: 0,
    shiftKey,
  }) as PointerEvent
}

describe('框选命中', () => {
  it('与框相交就算命中，不必被整个套住', () => {
    const { marquee, picked, wrapper } = mountMarquee()

    marquee.start(down())
    pointer('pointermove', 15, 25)
    pointer('pointerup', 15, 25)

    expect(picked).toEqual([{ ids: ['a'], additive: false }])
    wrapper.unmount()
  })

  it('框不到的节点不进选中集', () => {
    const { marquee, picked, wrapper } = mountMarquee()

    marquee.start(down())
    pointer('pointermove', 300, 300)
    pointer('pointerup', 300, 300)

    expect(picked[0]?.ids).toEqual(['a'])
    wrapper.unmount()
  })

  it('按住 Shift 起手就是累加', () => {
    const { marquee, picked, wrapper } = mountMarquee()

    marquee.start(down(true))
    pointer('pointermove', 600, 600)
    pointer('pointerup', 600, 600)

    expect(picked[0]).toEqual({ ids: ['a', 'b'], additive: true })
    wrapper.unmount()
  })

  it('原地单击空白清空选中，不当成框选', () => {
    const { marquee, picked, cleared, wrapper } = mountMarquee()

    marquee.start(down())
    pointer('pointermove', 2, 2)
    pointer('pointerup', 2, 2)

    expect(picked).toEqual([])
    expect(cleared()).toBe(1)
    wrapper.unmount()
  })
})

describe('监听的生死', () => {
  it('pointercancel 只抹掉框，不改选中集', () => {
    const { marquee, picked, cleared, wrapper } = mountMarquee()

    marquee.start(down())
    pointer('pointermove', 40, 40)
    pointer('pointercancel', 40, 40)
    pointer('pointermove', 80, 80)

    expect(marquee.box.value).toBeNull()
    expect(picked).toEqual([])
    expect(cleared()).toBe(0)
    wrapper.unmount()
  })

  it('松手之后再动鼠标不再画框', () => {
    const { marquee, wrapper } = mountMarquee()

    marquee.start(down())
    pointer('pointermove', 40, 40)
    pointer('pointerup', 40, 40)
    pointer('pointermove', 90, 90)

    expect(marquee.box.value).toBeNull()
    wrapper.unmount()
  })

  it('框选中被卸载时监听一起摘掉', () => {
    const { marquee, picked, wrapper } = mountMarquee()

    marquee.start(down())
    wrapper.unmount()
    pointer('pointermove', 40, 40)
    pointer('pointerup', 40, 40)

    expect(marquee.box.value).toBeNull()
    expect(picked).toEqual([])
  })
})
