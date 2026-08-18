/**
 * @fileoverview 契约：画布上的实时值订阅本屏绑定用到的点位，
 * 绑定一变、或者换了一张屏，就先退旧订阅再订新的，卸载时退干净。
 * ⚠ 不退旧订阅的话，每改一次绑定就多挂一份，大屏开一天能攒出几百份，
 * 表现是「越用越卡」而没有任何报错。
 * ⚠ 换屏那一条同样要重订：订阅的主题是订阅那一刻取的**屏级**主题，
 * 而两张屏的点位集合完全可以一模一样。只看点位表的话，人已经在 B 屏、
 * 订阅还挂在 A 的主题上——画面照样有值，坏的是 hub 那边观看者永远算在 A 头上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type {
  BindingPayload,
  DashboardNodePayload,
  PointValueListener,
} from '@dt/contracts'
import { __resetProviders, registerProvider } from '@dt/datasources'
import { useRuntimeData } from '@dt/runtime'
import type { RuntimeDataSource } from '@dt/runtime'

import { useDashboardValues } from '@/composables/useDashboardValues'

const unsubscribe = vi.fn()
let asked: string[][] = []
let emit: PointValueListener = () => undefined

function registerFakeRealtime(): void {
  registerProvider({
    kind: 'opcua',
    subscribe: (nodeKeys, onValue) => {
      asked.push([...nodeKeys])
      emit = onValue
      return unsubscribe
    },
    readHistory: () => Promise.reject(new Error('不该被调用')),
  })
}

function binding(nodeKey: string | null): BindingPayload {
  return {
    id: `b-${nodeKey ?? 'none'}`,
    nodeId: 'n1',
    fieldKey: `value-${nodeKey ?? 'none'}`,
    sourceKind: 'opcua',
    nodeKey,
    staticValueJson: null,
    computeJson: null,
    detailJson: null,
    transformJson: null,
    createdAt: '',
    updatedAt: '',
  }
}

function node(bindings: BindingPayload[]): DashboardNodePayload {
  return {
    id: 'n1',
    dashboardId: 'd1',
    parentId: null,
    clientKey: null,
    moduleType: 'demo',
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    zIndex: 0,
    isVisible: true,
    configJson: {},
    createdAt: '',
    updatedAt: '',
    bindings,
  }
}

/** 把 composable 挂进组件，并把它 provide 的取数源取出来。 */
function mountValues(initial: DashboardNodePayload[], initialScope = 'd1') {
  const nodes = ref<DashboardNodePayload[]>(initial)
  const scope = ref(initialScope)
  let source: RuntimeDataSource | null = null
  // ⚠ 取数源要在**子组件**里取：provide 在同一个 setup 里 inject 不到自己
  const child = {
    setup() {
      source = useRuntimeData()
      return () => h('span')
    },
  }
  const host = defineComponent({
    setup() {
      const values = useDashboardValues(
        () => nodes.value,
        () => scope.value,
      )
      return () => h('div', [String(values.sampleCount.value), h(child)])
    },
  })
  const wrapper = mount(host)
  return { wrapper, nodes, scope, read: () => source }
}

beforeEach(() => {
  __resetProviders()
  asked = []
  unsubscribe.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('订阅', () => {
  it('只订实时且已挑点的那些点位，去重后升序', () => {
    registerFakeRealtime()
    mountValues([node([binding('s:b'), binding('s:a'), binding(null)])])

    expect(asked).toEqual([['s:a', 's:b']])
  })

  it('一个点位都没有时不去订', () => {
    registerFakeRealtime()
    mountValues([node([])])

    expect(asked).toEqual([])
  })

  it('没登记实时 provider 时也不崩，只是没有值', () => {
    const { wrapper } = mountValues([node([binding('s:a')])])

    expect(asked).toEqual([])
    wrapper.unmount()
  })

  it('绑定变了先退旧订阅再订新的', async () => {
    registerFakeRealtime()
    const { wrapper, nodes } = mountValues([node([binding('s:a')])])

    nodes.value = [node([binding('s:a'), binding('s:b')])]
    await wrapper.vm.$nextTick()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(asked).toEqual([['s:a'], ['s:a', 's:b']])
  })

  it('换了一张屏，点位表一模一样也要先退旧订阅再订新的', async () => {
    registerFakeRealtime()
    const { wrapper, scope } = mountValues([node([binding('s:a')])])

    scope.value = 'd2'
    await wrapper.vm.$nextTick()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(asked).toEqual([['s:a'], ['s:a']])
  })

  it('卸载时退订', () => {
    registerFakeRealtime()
    const { wrapper } = mountValues([node([binding('s:a')])])

    wrapper.unmount()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})

describe('换屏时的快照缓存', () => {
  it('换屏把上一屏的快照清掉，读回「等首帧」而不是上一屏的旧值', async () => {
    registerFakeRealtime()
    const { wrapper, scope, read } = mountValues([node([binding('s:a')])])
    emit('s:a', { state: 'ok', value: 21, timestampMs: 99, quality: 'good' })

    scope.value = 'd2'
    await wrapper.vm.$nextTick()

    expect(read()?.readBinding()(binding('s:a'), {})).toEqual({
      state: 'pending',
    })
    expect(wrapper.text()).toContain('0')
  })

  it('只是绑定变了不清快照——编辑器里改一次绑定就闪一次整屏的值', async () => {
    registerFakeRealtime()
    const { wrapper, nodes, read } = mountValues([node([binding('s:a')])])
    emit('s:a', { state: 'ok', value: 21, timestampMs: 99, quality: 'good' })

    nodes.value = [node([binding('s:a'), binding('s:b')])]
    await wrapper.vm.$nextTick()

    expect(read()?.readBinding()(binding('s:a'), {})).toEqual({
      state: 'ok',
      value: 21,
      timestampMs: 99,
    })
  })
})

describe('取数源', () => {
  it('装上的读取器把快照读成槽结果', () => {
    registerFakeRealtime()
    const { read } = mountValues([node([binding('s:a')])])

    emit('s:a', {
      state: 'ok',
      value: 21,
      timestampMs: 99,
      quality: 'good',
    })

    expect(read()?.readBinding()(binding('s:a'), {})).toEqual({
      state: 'ok',
      value: 21,
      timestampMs: 99,
    })
  })

  it('还没收到过快照的点位是等首帧', () => {
    registerFakeRealtime()
    const { read } = mountValues([node([binding('s:a')])])

    expect(read()?.readBinding()(binding('s:a'), {})).toEqual({
      state: 'pending',
    })
  })

  it('收到的快照数会记进计数，界面据它显示「有几个点位在更新」', async () => {
    registerFakeRealtime()
    const { wrapper } = mountValues([node([binding('s:a')])])

    emit('s:a', { state: 'error', errorMessage: '读不到' })
    await wrapper.vm.$nextTick()

    expect(wrapper.text()).toContain('1')
  })
})
