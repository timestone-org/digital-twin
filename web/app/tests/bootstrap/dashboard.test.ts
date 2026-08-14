/**
 * @fileoverview 契约：启动装配把内置模块与配置控件注册进去、把应用壳的订阅函数
 * 注入实时 provider。
 * ⚠ provider 每次打开大屏都要重装：`subscribe` 闭包里绑着当前那张屏的主题，
 * 沿用上一张的会让新屏订到旧主题上——连接是通的、数据永远不来。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetModules,
  __resetConfigControls,
  listModules,
  missingConfigControls,
} from '@dt/modules'
import { __resetProviders, getProvider, listProviders } from '@dt/datasources'

import {
  __resetDashboardBootstrap,
  installDashboardDataSources,
  installDashboardModules,
} from '@/bootstrap/dashboard'

beforeEach(() => {
  __resetModules()
  __resetConfigControls()
  __resetProviders()
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
