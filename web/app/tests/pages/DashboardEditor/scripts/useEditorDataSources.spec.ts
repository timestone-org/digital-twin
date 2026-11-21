/**
 * @fileoverview 契约：编辑器接的是**取数**不是节拍——序列槽在设计态照样出数，
 * 但屏上不会有东西在背后按分钟自己刷新。
 *
 * ⚠ 节拍装进编辑器的表现是：正在配一格的时候，另外几格每分钟重取一轮，
 * 画面自己跳一下，而人以为是刚才那次改动生效了。
 * ⚠ 连接态仍然不给：设计态画一枚说通道断了的角标，只会让人去查一条不存在的故障。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import type { DashboardNodePayload, DashboardPayload } from '@dt/contracts'
import { __resetProviders, listProviders } from '@dt/datasources'
import { useRuntimeData, type RuntimeDataSource } from '@dt/runtime'

import type { ReadPointSample } from '@/runtime/bindingReader'
import type { TopicHandler } from '@/runtime/topicRegistry'
import { useEditorDataSources } from '@/pages/DashboardEditor/scripts/useEditorDataSources'

// ⚠ 通道必须打桩：不桩的话挂载就真的开一条 WebSocket
const connectionState = ref<'open' | 'closed'>('open')
const listeners = new Map<string, Set<TopicHandler>>()
function subscribe(topic: string, handler: TopicHandler): () => void {
  const handlers = listeners.get(topic) ?? new Set<TopicHandler>()
  handlers.add(handler)
  listeners.set(topic, handlers)
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0) listeners.delete(topic)
  }
}

function frame(topic: string, nodeKey: string, value: number): void {
  for (const handler of listeners.get(topic) ?? []) {
    handler({
      items: [
        { nodeKey, value, state: 'ok', timestampMs: 120, quality: 'good' },
      ],
    })
  }
}
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected: computed(() => true),
    connectionState,
    subscribe,
    onSystem: vi.fn(() => () => undefined),
  }),
}))

/** 把编辑器的取数装配挂进组件，并从子组件里取回注入的取数源。 */
function mountSources(initial: DashboardPayload | null = null) {
  const dashboard = ref(initial)
  let source: RuntimeDataSource | null = null
  let readPoint: ReadPointSample = () => undefined
  const child = defineComponent({
    setup() {
      source = useRuntimeData()
      return () => h('span')
    },
  })
  const host = defineComponent({
    setup() {
      readPoint = useEditorDataSources(
        dashboard,
        () => dashboard.value?.nodes ?? [],
      ).read
      return () => h('div', [h(child)])
    },
  })
  const wrapper = mount(host)
  return { wrapper, dashboard, read: () => source, readPoint }
}

beforeEach(() => {
  __resetProviders()
  listeners.clear()
  connectionState.value = 'open'
})

describe('编辑器的序列取数', () => {
  it('断线与重连时，画布和助手使用相同的实时读取状态', () => {
    const dashboard = screen('plant-a', 'source:point')
    const binding = dashboard.nodes[0]?.bindings[0]
    if (binding === undefined) throw new Error('缺少测试绑定')
    const found = mountSources(dashboard)
    try {
      frame('dashboard:plant-a', 'source:point', 41)
      expect(found.readPoint('source:point')).toMatchObject({ value: 41 })
      connectionState.value = 'closed'
      expect(found.readPoint('source:point')).toMatchObject({ state: 'error' })
      expect(found.read()?.readBinding()(binding, {})).toMatchObject({
        state: 'error',
      })
      connectionState.value = 'open'
      expect(found.readPoint('source:point')).toBeUndefined()
      frame('dashboard:plant-a', 'source:point', 42)
      expect(found.readPoint('source:point')).toMatchObject({
        state: 'ok',
        value: 42,
      })
      expect(found.read()?.readBinding()(binding, {})).toMatchObject({
        state: 'ok',
        value: 42,
      })
    } finally {
      found.wrapper.unmount()
    }
  })

  it('装上了批量取数口，序列槽在设计态也出数', () => {
    const found = mountSources()

    expect(found.read()?.readSeries).toBeTypeOf('function')
    found.wrapper.unmount()
  })

  it('不装刷新节拍', () => {
    const found = mountSources()

    expect(found.read()?.seriesEpoch).toBeUndefined()
    found.wrapper.unmount()
  })

  it('不给连接态，设计态不标「数据可能过期」', () => {
    const found = mountSources()

    expect(found.read()?.connectionState).toBeUndefined()
    found.wrapper.unmount()
  })

  it('绑定读取器还在——序列那一份是整份覆盖，漏装实时就整屏没值', () => {
    const found = mountSources()

    const slot = found.read()?.readBinding()(
      {
        id: 'b-1',
        fieldKey: 'value',
        sourceKind: 'static',
        nodeKey: null,
        staticValueJson: 5,
        computeJson: null,
        detailJson: null,
        transformJson: null,
      },
      {},
    )

    expect(slot).toEqual({ state: 'ok', value: 5 })
    found.wrapper.unmount()
  })

  it('点位历史与台账两种 provider 都装上了', () => {
    const found = mountSources()

    const kinds = listProviders().map((provider) => provider.kind)
    expect(kinds).toContain('archive')
    expect(kinds).toContain('dataset')
    found.wrapper.unmount()
  })
})

function screen(id: string, key: string): DashboardPayload {
  const panel: DashboardNodePayload = {
    id: `${id}-panel`,
    dashboardId: id,
    parentId: null,
    clientKey: null,
    moduleType: 'header',
    x: 0,
    y: 0,
    w: 100,
    h: 50,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings: [
      {
        id: `${id}-binding`,
        nodeId: `${id}-panel`,
        fieldKey: 'value',
        sourceKind: 'opcua',
        nodeKey: key,
        staticValueJson: null,
        computeJson: null,
        detailJson: null,
        transformJson: null,
        createdAt: '',
        updatedAt: '',
      },
    ],
  }
  return {
    id,
    projectId: 'park',
    name: id,
    description: null,
    designWidth: 1920,
    designHeight: 1080,
    themeJson: {},
    chromeJson: {},
    rowVersion: 1,
    schemaVersion: 1,
    isPublic: false,
    createdAt: '',
    updatedAt: '',
    nodes: [panel],
  }
}

it('保留两个编辑器时，先开启的页签换绑仍收到自己的大屏帧', async () => {
  const first = mountSources(screen('plant-a', 'source:a-old'))
  const second = mountSources(screen('plant-b', 'source:b'))
  try {
    frame('dashboard:plant-a', 'source:a-old', 18)
    frame('dashboard:plant-b', 'source:b', 41)
    expect(first.readPoint('source:a-old')).toMatchObject({
      value: 18,
    })
    expect(second.readPoint('source:b')).toMatchObject({ value: 41 })

    first.dashboard.value = screen('plant-a', 'source:a-new')
    await nextTick()
    frame('dashboard:plant-a', 'source:a-new', 25)

    expect(first.readPoint('source:a-new')).toMatchObject({
      value: 25,
    })
    expect(second.readPoint('source:b')).toMatchObject({ value: 41 })
  } finally {
    first.wrapper.unmount()
    second.wrapper.unmount()
  }
})
