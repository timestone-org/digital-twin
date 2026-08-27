/**
 * @fileoverview 契约：启动装配把内置模块与配置控件注册进去、把三类素材引用各接到
 * 自己那条取回地址上、把应用壳的订阅函数注入实时 provider。
 * ⚠ provider 每次打开大屏都要重装：`subscribe` 闭包里绑着当前那张屏的主题，
 * 沿用上一张的会让新屏订到旧主题上——连接是通的、数据永远不来。
 * ⚠ 2D 孪生的两条素材解析分属两种 kind（图标 / 图片）：装成一条服务两种时，
 * 表现是**图标 404**（碎图或空白），零报错，所以两种各一条用例。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetModules,
  __resetConfigControls,
  listModules,
  missingConfigControls,
} from '@dt/modules'
import { __resetProviders, getProvider, listProviders } from '@dt/datasources'
import { __resetTwin2dAssets, twin2dIconUrl, twin2dImageUrl } from '@dt/twin2d'

import {
  __resetDashboardBootstrap,
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'

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
