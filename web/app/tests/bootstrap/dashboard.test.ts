/**
 * @fileoverview 契约：启动装配把内置模块与配置控件注册进去、把三类素材引用各接到
 * 自己那条取回地址上、把应用壳的订阅函数注入实时 provider，并把序列取数与刷新
 * 节拍接进运行时的取数源。
 * ⚠ provider 每次打开大屏都要重装：`subscribe` 闭包里绑着当前那张屏的主题，
 * 沿用上一张的会让新屏订到旧主题上——连接是通的、数据永远不来。
 * ⚠ 2D 孪生的两条素材解析分属两种 kind（图标 / 图片）：装成一条服务两种时，
 * 表现是**图标 404**（碎图或空白），零报错，所以两种各一条用例。
 * ⚠ 序列那一份是**整份覆盖**前一次注入：少装一支的表现是整屏的实时值一起
 * 变成「没有装配取数源」，所以有一条比对两次注入键集的用例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import type { BindingView, DashboardNodeView } from '@dt/contracts'
import {
  __resetModules,
  __resetConfigControls,
  listModules,
  missingConfigControls,
} from '@dt/modules'
import { __resetProviders, getProvider, listProviders } from '@dt/datasources'
import { useRuntimeData, type RuntimeDataSource } from '@dt/runtime'
import { __resetTwin2dAssets, twin2dIconUrl, twin2dImageUrl } from '@dt/twin2d'

import {
  __resetDashboardBootstrap,
  installDashboardDataSources,
  installDashboardModules,
  installDashboardSeries,
  useSeriesEpoch,
  type DashboardSeriesPorts,
} from '@/bootstrap/dashboard'
import { useDashboardValues } from '@/composables/useDashboardValues'

beforeEach(() => {
  __resetModules()
  __resetConfigControls()
  __resetProviders()
  __resetTwin2dAssets()
  __resetDashboardBootstrap()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('模块与控件', () => {
  it('注册内置模块并铺满配置控件', () => {
    installDashboardModules()

    expect(listModules().length).toBeGreaterThan(0)
    expect([...missingConfigControls()]).toEqual([])
  })

  it('重复调用只做第一次', () => {
    installDashboardModules()
    const first = listModules().length
    installDashboardModules()

    expect(listModules()).toHaveLength(first)
  })
})

describe('素材引用接到取回地址上', () => {
  /** 一枚合法素材 id；引用形状不对时拼装函数一律回空串。 */
  const REF = 'asset:0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8'

  it('2D 孪生的图标引用拼的是图标前缀', () => {
    installDashboardModules()

    expect(twin2dIconUrl(REF)).toBe(
      '/oss/icons/0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8',
    )
  })

  it('2D 孪生的底图引用拼的是图片前缀', () => {
    installDashboardModules()

    expect(twin2dImageUrl(REF)).toBe(
      '/oss/images/0f9a2b3c-4d5e-4f70-8192-a3b4c5d6e7f8',
    )
  })

  // ⚠ 两条拼出同一个地址就说明装成了一条服务两种 kind，而那一档的表现是图标 404
  it('两条不是同一个前缀', () => {
    installDashboardModules()

    expect(twin2dIconUrl(REF)).not.toBe(twin2dImageUrl(REF))
  })

  // ⚠ 没装之前给空串而不是一条必然 404 的地址：图元与底图两处随即整枝不画
  it('没装之前两条都回空串', () => {
    expect(twin2dIconUrl(REF)).toBe('')
    expect(twin2dImageUrl(REF)).toBe('')
  })
})

describe('取数 provider', () => {
  const subscribe = vi.fn(() => () => undefined)

  it('四种来源里至少装上实时 / 常量 / 派生三种', () => {
    installDashboardDataSources({ subscribe })

    expect(
      listProviders()
        .map((provider) => provider.kind)
        .sort(),
    ).toEqual(['computed', 'opcua', 'static'])
  })

  it('实时 provider 用的是注入进来的订阅函数', () => {
    installDashboardDataSources({ subscribe })

    getProvider('opcua').subscribe(['s:1'], () => undefined)

    expect(subscribe).toHaveBeenCalledWith(['s:1'], expect.any(Function))
  })

  it('注入了历史取数才装历史 provider', () => {
    installDashboardDataSources({
      subscribe,
      fetchHistory: () =>
        Promise.resolve({ points: [], isTruncated: false, isStale: false }),
    })

    expect(listProviders().map((provider) => provider.kind)).toContain(
      'archive',
    )
  })

  it('没注入历史取数时不装它——拿实时通道里那几个点冒充历史会画出假曲线', () => {
    installDashboardDataSources({ subscribe })

    expect(listProviders().map((provider) => provider.kind)).not.toContain(
      'archive',
    )
  })

  it('重装一次会换掉实时 provider，新屏订的是新主题', () => {
    const older = vi.fn(() => () => undefined)
    const newer = vi.fn(() => () => undefined)
    installDashboardDataSources({ subscribe: older })
    installDashboardDataSources({ subscribe: newer })

    getProvider('opcua').subscribe(['s:1'], () => undefined)

    expect(older).not.toHaveBeenCalled()
    expect(newer).toHaveBeenCalledTimes(1)
  })
})

describe('匿名快照页的装配', () => {
  it('不注入订阅时不装实时 provider，常量与派生照常', () => {
    installDashboardDataSources({})

    expect(listProviders()).not.toContain('opcua')
    expect(getProvider('static')).toBeDefined()
    expect(getProvider('computed')).toBeDefined()
  })
})

describe('台账序列的注入', () => {
  it('注入了台账取数才装台账 provider', () => {
    installDashboardDataSources({
      fetchDatasetSeries: () =>
        Promise.resolve({ points: [], isTruncated: false, isStale: false }),
    })

    expect(listProviders().map((provider) => provider.kind)).toContain(
      'dataset',
    )
  })

  // ⚠ 不注入就一条都不装：装了空壳的话台账绑定会一直等一个永远不来的结果
  it('没注入时不装它', () => {
    installDashboardDataSources({})

    expect(listProviders().map((provider) => provider.kind)).not.toContain(
      'dataset',
    )
  })
})

/** 一条常量绑定，用来验证覆盖之后 `readBinding` 还在。 */
const STATIC_BINDING: BindingView = {
  id: 'b-1',
  fieldKey: 'value',
  sourceKind: 'static',
  nodeKey: null,
  staticValueJson: 42,
  computeJson: null,
  detailJson: null,
  transformJson: null,
}

/**
 * 把 `installDashboardSeries` 挂进组件，并从**子组件**里取回注入的取数源。
 * ⚠ 取数源只能在子组件里取：provide 在同一个 setup 里 inject 不到自己。
 * @param ports 要装的那几样
 */
function mountSeries(ports: DashboardSeriesPorts) {
  let source: RuntimeDataSource | null = null
  const child = defineComponent({
    setup() {
      source = useRuntimeData()
      return () => h('span')
    },
  })
  const host = defineComponent({
    setup() {
      installDashboardSeries(ports)
      return () => h('div', [h(child)])
    },
  })
  const wrapper = mount(host)
  return { wrapper, read: () => source }
}

describe('序列取数接进取数源', () => {
  it('装上了批量取数口', () => {
    const found = mountSeries({ readPoint: () => undefined })

    expect(found.read()?.readSeries).toBeTypeOf('function')
    found.wrapper.unmount()
  })

  // ⚠ 这一份整份覆盖前一次注入，实时那一支漏装的表现是整屏值全变「没有装配取数源」
  it('覆盖之后绑定读取器还在，且读的是传进来的快照', () => {
    const found = mountSeries({
      readPoint: () => ({
        state: 'ok',
        value: 7,
        timestampMs: 1,
        quality: 'good',
      }),
    })

    const slot = found.read()?.readBinding()(
      { ...STATIC_BINDING, sourceKind: 'opcua', nodeKey: 's:1' },
      {},
    )

    expect(slot).toEqual({ state: 'ok', value: 7, timestampMs: 1 })
    found.wrapper.unmount()
  })

  it('常量绑定照常就地算', () => {
    const found = mountSeries({ readPoint: () => undefined })

    expect(found.read()?.readBinding()(STATIC_BINDING, {})).toEqual({
      state: 'ok',
      value: 42,
    })
    found.wrapper.unmount()
  })

  it('给了连接态就带上，不给就没有这一支', () => {
    const withState = mountSeries({
      readPoint: () => undefined,
      connectionState: () => 'closed',
    })
    const without = mountSeries({ readPoint: () => undefined })

    expect(withState.read()?.connectionState?.()).toBe('closed')
    expect(without.read()?.connectionState).toBeUndefined()
    withState.wrapper.unmount()
    without.wrapper.unmount()
  })

  it('给了节拍就带上，不给就没有这一支', () => {
    const withEpoch = mountSeries({
      readPoint: () => undefined,
      seriesEpoch: () => 3,
    })
    const without = mountSeries({ readPoint: () => undefined })

    expect(withEpoch.read()?.seriesEpoch?.()).toBe(3)
    expect(without.read()?.seriesEpoch).toBeUndefined()
    withEpoch.wrapper.unmount()
    without.wrapper.unmount()
  })
})

/** 只有一个节点、一条绑定都没有的一屏，够 `useDashboardValues` 跑起来。 */
const BARE_NODE: DashboardNodeView = {
  id: 'n-1',
  parentId: null,
  clientKey: null,
  moduleType: 'header',
  x: 0,
  y: 0,
  w: 10,
  h: 10,
  zIndex: 0,
  isVisible: true,
  configJson: {},
  bindings: [],
}

/**
 * 取一次注入的取数源上有哪些键。
 * @param install 在 setup 里把取数源装上
 */
function keysOfInstalled(install: () => void): string[] {
  let source: RuntimeDataSource | null = null
  const child = defineComponent({
    setup() {
      source = useRuntimeData()
      return () => h('span')
    },
  })
  const host = defineComponent({
    setup() {
      install()
      return () => h('div', [h(child)])
    },
  })
  const wrapper = mount(host)
  const found = Object.keys(source ?? {}).sort()
  wrapper.unmount()
  return found
}

describe('两次注入的键集', () => {
  // ⚠ 这条守的是「后装的那一份把先装的整份换掉」：`useDashboardValues` 以后
  // 多注入一支时，这里会红，而不是等到屏上少一半能力才被发现
  it('序列那一份把实时那一份的每一支都装齐了', () => {
    const nodes = ref<DashboardNodeView[]>([BARE_NODE])
    const realtime = keysOfInstalled(() => {
      useDashboardValues(
        () => nodes.value,
        () => 'd-1',
        () => 'open',
      )
    })
    const series = keysOfInstalled(() => {
      const values = useDashboardValues(
        () => nodes.value,
        () => 'd-1',
        () => 'open',
      )
      installDashboardSeries({
        readPoint: values.read,
        connectionState: () => 'open',
        seriesEpoch: () => 0,
      })
    })

    expect(realtime).toEqual(['connectionState', 'readBinding'])
    expect(series).toEqual(
      expect.arrayContaining([...realtime, 'readSeries', 'seriesEpoch']),
    )
  })
})

/** 当前这一刻页面算不算隐藏；下面那条假 `document.hidden` 读的就是它。 */
let pageHidden = false

/** 把 `document.hidden` 换成一个自己说了算的读法。 */
function fakeVisibility(): void {
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => pageHidden,
  })
}

/** 切一次可见性，并像浏览器那样发出事件。 */
function switchVisibility(hidden: boolean): void {
  pageHidden = hidden
  document.dispatchEvent(new Event('visibilitychange'))
}

/** 把节拍挂进组件。 */
function mountEpoch() {
  let read: (() => number) | null = null
  const host = defineComponent({
    setup() {
      read = useSeriesEpoch()
      return () => h('div')
    },
  })
  const wrapper = mount(host)
  return { wrapper, epoch: () => read?.() ?? -1 }
}

describe('刷新节拍', () => {
  beforeEach(() => {
    pageHidden = false
    fakeVisibility()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'hidden')
  })

  it('每到周期 +1', () => {
    const found = mountEpoch()

    expect(found.epoch()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(found.epoch()).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(found.epoch()).toBe(2)
    found.wrapper.unmount()
  })

  // ⚠ 隐藏时必须停：每个人自己电脑上开着的那些标签页照样在按分钟问后端
  it('隐藏之后不再跳', () => {
    const found = mountEpoch()
    switchVisibility(true)

    vi.advanceTimersByTime(600_000)

    expect(found.epoch()).toBe(0)
    found.wrapper.unmount()
  })

  // ⚠ 补的这一拍不能省：停拍期间取数窗口一直在往前滑，不补就停在隐藏那一刻
  it('重新可见时立刻补一拍，并接着按周期走', () => {
    const found = mountEpoch()
    switchVisibility(true)
    vi.advanceTimersByTime(600_000)

    switchVisibility(false)

    expect(found.epoch()).toBe(1)
    vi.advanceTimersByTime(60_000)
    expect(found.epoch()).toBe(2)
    found.wrapper.unmount()
  })

  it('隐藏期间重复收到事件也只是保持停拍', () => {
    const found = mountEpoch()
    switchVisibility(true)
    switchVisibility(true)

    vi.advanceTimersByTime(600_000)

    expect(found.epoch()).toBe(0)
    found.wrapper.unmount()
  })

  // ⚠ 已经在跑的时候不许再开一条：每收到一次事件多开一条，页面切来切去
  // 之后就是一屏几十条定时器在按分钟一起问
  it('本来就可见时再收到一次事件，只补一拍、不多开定时器', () => {
    const found = mountEpoch()

    switchVisibility(false)

    expect(found.epoch()).toBe(1)
    expect(vi.getTimerCount()).toBe(1)
    found.wrapper.unmount()
  })

  it('挂上时页面已经是隐藏的，就一开始都不起拍', () => {
    pageHidden = true
    const found = mountEpoch()

    vi.advanceTimersByTime(600_000)

    expect(found.epoch()).toBe(0)
    found.wrapper.unmount()
  })

  // ⚠ 大屏一开就是几天，一次泄漏会持续累积
  it('卸载后定时器与可见性监听都清了', () => {
    const found = mountEpoch()
    vi.advanceTimersByTime(60_000)
    expect(found.epoch()).toBe(1)

    found.wrapper.unmount()
    vi.advanceTimersByTime(600_000)
    switchVisibility(true)
    switchVisibility(false)

    expect(found.epoch()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
