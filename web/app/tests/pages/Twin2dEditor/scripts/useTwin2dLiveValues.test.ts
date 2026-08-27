/**
 * @fileoverview 契约：2D 孪生子编辑器的实时读数订这张大屏的推送主题，用与运行态
 * 同一份绑定读取器求值，并把「取不到」四档如实说出口。
 *
 * ⚠ 主题必须跟着当前大屏走：订错主题时连接是通的、数据永远不来，而画面上只表现为
 * 「一直是占位符」。
 * ⚠ 没收到快照就是 `pending`，绝不拿 `null` 冒充「现场报的就是空」——两者在墙上
 * 长得一样，但一个要去查推送、一个不用。
 * ⚠ 「绑了没数」与「压根没绑」必须分成两档：合成一档之后，绑定还没保存这条最常见的
 * 原因就再也查不出来了。
 */
import type {
  BindingView,
  PointSample,
  PointValueListener,
} from '@dt/contracts'
import { __resetProviders } from '@dt/datasources'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'

import {
  TWIN_2D_LIVE_STATE_TEXT,
  useTwin2dLiveValues,
} from '@/pages/Twin2dEditor/scripts/useTwin2dLiveValues'

const subscribed: string[] = []
const dropped: string[] = []
let emit: PointValueListener = () => undefined

vi.mock('@/composables/useRealtimeChannel', () => ({
  useRealtimeChannel: () => ({
    subscribe: (topic: string) => {
      subscribed.push(topic)
      return () => {
        dropped.push(topic)
      }
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

/**
 * 一条实时绑定。
 * @param fieldKey 槽键
 * @param nodeKey 点位身份
 */
function point(fieldKey: string, nodeKey: string): BindingView {
  return {
    id: fieldKey,
    fieldKey,
    sourceKind: 'opcua',
    nodeKey,
    staticValueJson: null,
    computeJson: null,
    transformJson: null,
    detailJson: null,
  }
}

/** 一条常量绑定；它不占实时点位，也不该被数进「已绑」。 */
const CONSTANT: BindingView = {
  id: 'c1',
  fieldKey: 'nodeValues[1].value',
  sourceKind: 'static',
  nodeKey: null,
  staticValueJson: 42,
  computeJson: null,
  transformJson: null,
  detailJson: null,
}

const NODE_VALUE = point('nodeValues[0].value', 'src-1:PT101')

function mountLive(dashboardId = 'd1', initial: BindingView[] = [NODE_VALUE]) {
  const bindings = ref<BindingView[]>(initial)
  const screen = ref(dashboardId)
  let latest: ReturnType<typeof useTwin2dLiveValues> | null = null
  const host = defineComponent({
    setup() {
      latest = useTwin2dLiveValues(
        () => screen.value,
        () => bindings.value,
      )
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return {
    wrapper,
    bindings,
    screen,
    state: () => latest?.state.value,
    tally: () => latest?.tally.value,
    read: () => latest?.readBinding(),
  }
}

function sample(value: number): PointSample {
  return { state: 'ok', value, timestampMs: 7, quality: 'good' }
}

beforeEach(() => {
  __resetProviders()
  subscribed.length = 0
  dropped.length = 0
  emit = () => undefined
})

describe('订阅', () => {
  it('订的是这张大屏的主题', () => {
    mountLive('d7')

    expect(subscribed).toEqual(['dashboard:d7'])
  })

  it('大屏 id 还没读出来时一个主题都不订', () => {
    mountLive('')

    expect(subscribed).toEqual([])
  })

  it('换一张屏要重订，哪怕点位表一模一样', async () => {
    const live = mountLive('d1')

    live.screen.value = 'd2'
    await live.wrapper.vm.$nextTick()

    expect(subscribed).toEqual(['dashboard:d1', 'dashboard:d2'])
    expect(dropped).toEqual(['dashboard:d1'])
  })

  it('卸载时退订，切走的页面不再收消息', () => {
    const live = mountLive('d1')

    live.wrapper.unmount()

    expect(dropped).toEqual(['dashboard:d1'])
  })
})

describe('取不到的时候要说出口', () => {
  it('还不知道是哪张屏就说不知道', () => {
    const live = mountLive('')

    expect(live.state()).toBe('unwired')
  })

  it('一条实时绑定都没有时是「没绑」，不是「没数」', () => {
    const live = mountLive('d1', [CONSTANT])

    expect(live.state()).toBe('idle')
    expect(live.tally()).toEqual({ bound: 0, received: 0 })
  })

  it('绑了却一帧都没来时是「在等」，并报出等着的是几个', () => {
    const live = mountLive('d1', [
      NODE_VALUE,
      point('nodeStatus[0].status', 'src-1:ST1'),
    ])

    expect(live.state()).toBe('waiting')
    expect(live.tally()).toEqual({ bound: 2, received: 0 })
  })

  it('收到一帧就转「在推」，并数得出收到几个', async () => {
    const live = mountLive('d1', [
      NODE_VALUE,
      point('nodeStatus[0].status', 'src-1:ST1'),
    ])

    emit('src-1:PT101', sample(3.5))
    await live.wrapper.vm.$nextTick()

    expect(live.state()).toBe('live')
    expect(live.tally()).toEqual({ bound: 2, received: 1 })
  })

  // ⚠ 快照缓存跨绑定改动是保留的（换点位表就清会让整屏的值闪一下），
  // 直接读缓存条目数会把已经不绑了的点位一起数进来，于是「已收到」比「已绑」还多
  it('改绑定之后，已经不绑了的点位不再算进已收到', async () => {
    const live = mountLive('d1')

    emit('src-1:PT101', sample(3.5))
    await live.wrapper.vm.$nextTick()
    live.bindings.value = [point('nodeValues[0].value', 'src-1:PT999')]
    await live.wrapper.vm.$nextTick()

    expect(live.tally()).toEqual({ bound: 1, received: 0 })
    expect(live.state()).toBe('waiting')
  })

  it('四档各说各的，没有两档撞成同一句', () => {
    const texts = Object.values(TWIN_2D_LIVE_STATE_TEXT)

    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('绑定读取器', () => {
  it('还没收到快照时是「在等」，不是一个空值', () => {
    const live = mountLive('d1')

    expect(live.read()?.(NODE_VALUE, {})).toEqual({ state: 'pending' })
  })

  it('收到之后照实给出值与采样时刻', async () => {
    const live = mountLive('d1')

    emit('src-1:PT101', sample(3.5))
    await live.wrapper.vm.$nextTick()

    expect(live.read()?.(NODE_VALUE, {})).toEqual({
      state: 'ok',
      value: 3.5,
      timestampMs: 7,
    })
  })

  // ⚠ 每次求值都要重新取一个读取器：对快照缓存的响应式依赖由那一次调用建立，
  // 存下来反复用的话值再变也不会重算，且不报任何错
  it('每调一次都给一个新的读取器', () => {
    const live = mountLive('d1')

    expect(live.read()).not.toBe(live.read())
  })

  it('常量绑定就地算，不用等推送', () => {
    const live = mountLive('d1', [CONSTANT])

    expect(live.read()?.(CONSTANT, {})).toEqual({ state: 'ok', value: 42 })
  })
})
