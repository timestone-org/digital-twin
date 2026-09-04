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
import { computed, defineComponent, h, ref } from 'vue'
import type { DashboardPayload } from '@dt/contracts'
import { __resetProviders, listProviders } from '@dt/datasources'
import { useRuntimeData, type RuntimeDataSource } from '@dt/runtime'

import { useEditorDataSources } from '@/pages/DashboardEditor/scripts/useEditorDataSources'

// ⚠ 通道必须打桩：不桩的话挂载就真的开一条 WebSocket
const connectionState = ref<'open'>('open')
vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    isConnected: computed(() => true),
    connectionState,
    subscribe: vi.fn(() => () => undefined),
    onSystem: vi.fn(() => () => undefined),
  }),
}))

/** 把编辑器的取数装配挂进组件，并从子组件里取回注入的取数源。 */
function mountSources() {
  const dashboard = ref<DashboardPayload | null>(null)
  let source: RuntimeDataSource | null = null
  const child = defineComponent({
    setup() {
      source = useRuntimeData()
      return () => h('span')
    },
  })
  const host = defineComponent({
    setup() {
      useEditorDataSources(dashboard, () => [])
      return () => h('div', [h(child)])
    },
  })
  const wrapper = mount(host)
  return { wrapper, read: () => source }
}

beforeEach(() => {
  __resetProviders()
})

describe('编辑器的序列取数', () => {
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
