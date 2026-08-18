/**
 * @fileoverview 契约：孪生编辑器的实时读数订这张大屏的推送主题，
 * 并把绑定按**文档序**缝回场景——第 i 行落在扁平化后的第 i 个信息牌字段上。
 *
 * ⚠ 编辑器与运行态必须缝出同一个结果：各缝各的话，在编辑器里核对过的对应关系
 * 到大屏上会接错对象，而两边都不报错。
 * ⚠ 主题必须跟着当前大屏走：订错主题时连接是通的、数据永远不来。
 */
import type { PointValueListener } from '@dt/contracts'
import { __resetProviders } from '@dt/datasources'
import { normalizeTwinConfig } from '@dt/twin-config'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTwinLiveValues } from '@/pages/TwinEditor/scripts/useTwinLiveValues'

const subscribed: string[] = []
let emit: PointValueListener = () => undefined

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    subscribe: (topic: string) => {
      subscribed.push(topic)
      return () => undefined
    },
  }),
}))

// 应用壳把整屏的一帧筛成「本次要的那几个点位」，这里只需要拿到回调本身
vi.mock('@/runtime/pointStream', () => ({
  createPointSubscribe:
    (
      channel: { subscribe: (topic: string) => () => void },
      topicOf: () => string | null,
    ) =>
    (_keys: readonly string[], onValue: PointValueListener) => {
      const topic = topicOf()
      if (topic === null) return () => undefined
      emit = onValue
      return channel.subscribe(topic)
    },
}))

const CONFIG = normalizeTwinConfig({
  anchors: [{ id: 'a1' }],
  panels: [
    {
      id: 'p1',
      fields: [
        { key: 'temp', label: '温度' },
        { key: 'flow', label: '流量' },
      ],
    },
  ],
})

function binding(fieldKey: string, nodeKey: string) {
  return {
    id: fieldKey,
    nodeId: 'n1',
    fieldKey,
    sourceKind: 'opcua' as const,
    nodeKey,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
    createdAt: '',
    updatedAt: '',
  }
}

function mountLive(dashboardId = 'd1') {
  const bindings = ref([
    binding('panelValues[1].value', 'ns=2;s=F'),
    binding('anchorValues[0].value', 'ns=2;s=A'),
  ])
  let latest: ReturnType<typeof useTwinLiveValues> | null = null
  const host = defineComponent({
    setup() {
      latest = useTwinLiveValues(
        () => dashboardId,
        () => CONFIG,
        () => bindings.value,
      )
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { wrapper, values: () => latest?.value }
}

beforeEach(() => {
  __resetProviders()
  subscribed.length = 0
})

describe('订阅', () => {
  it('订的是这张大屏的主题', () => {
    mountLive('d1')

    expect(subscribed).toEqual(['dashboard:d1'])
  })

  it('大屏 id 还没读出来时一个主题都不订', () => {
    mountLive('')

    expect(subscribed).toEqual([])
  })
})

describe('缝回场景', () => {
  it('第 2 行落在扁平化后的第 2 个信息牌字段上', async () => {
    const { wrapper, values } = mountLive()

    emit('ns=2;s=F', {
      state: 'ok',
      value: 3.5,
      timestampMs: 1,
      quality: 'good',
    })
    await wrapper.vm.$nextTick()

    expect(values()?.panels).toEqual({ 'p1::flow': { value: 3.5 } })
  })

  it('锚点那一路各走各的，不与信息牌抢行号', async () => {
    const { wrapper, values } = mountLive()

    emit('ns=2;s=A', { state: 'ok', value: 7, timestampMs: 1, quality: 'good' })
    await wrapper.vm.$nextTick()

    expect(values()?.anchors).toEqual({ a1: { value: 7 } })
  })

  // ⚠ 没有首帧时绝不拿 0 冒充：牌面显示占位符才看得出「这个点还没来数」
  it('一帧都没收到时五路都是空表', () => {
    const { values } = mountLive()

    expect(values()?.panels).toEqual({})
    expect(values()?.anchors).toEqual({})
  })
})
